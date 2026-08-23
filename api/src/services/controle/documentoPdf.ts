import Anthropic from '@anthropic-ai/sdk'
import { dataExiste, diasEntre } from '../contas/datas'

// Lê um documento de gasto com insumo — extrato de "contas a receber" que a
// revenda manda (Solos, Syagri, Protec...) ou contrato de compra e venda de
// adubo/fertilizante (Mosaic e afins) — e devolve os itens comprados, sem
// XML nenhum envolvido. Existe porque a aba "Controle" (Epic 2.1) cruza a
// NF-e automática com PDF importado manualmente, e é este segundo lado que
// não tem documento fiscal para se apoiar.
//
// Esta é só a LEITURA. Gravar em `documentos_controle`/`itens_nfe` é a
// próxima story (gravarDocumentoPdf.ts) — ver o cabeçalho de
// database/migrations/017_controle.sql para o fluxo completo (a linha só
// nasce DEPOIS da leitura, com fornecedor e número já resolvidos).

// Mesma regra ETC de boletoPdf.ts: o modelo vem do ambiente, não cravado.
// Aqui, diferente do boleto, NÃO usamos `effort: 'low'` — um boleto tem 4
// números fixos para ler; um extrato tem dezenas de linhas de duplicata (ou
// duas tabelas para cruzar, no caso da Syagri) e um contrato de 10+ páginas
// onde é preciso ACHAR a página 1 e IGNORAR o resto. Aqui precisão importa
// mais que velocidade — errar uma linha é gasto fantasma ou gasto perdido.
const MODELO = process.env.ANTHROPIC_MODEL_DOCUMENTO ?? 'claude-opus-5'

// Mesmo teto pensado para o bucket "controle-documentos" (ver comentário da
// migration 017): configurado para 10 MB no painel do Supabase. Um anexo
// maior que isso não é extrato nem contrato — e deixar o código aceitar mais
// do que o bucket aceita faria a leitura passar e o upload falhar depois.
const LIMITE_MB = 10

// Teto de sanidade de NEGÓCIO por ITEM (não por documento — um extrato de
// vários meses pode somar mais que uma nota única) — NÃO é limite de banco:
// a coluna itens_nfe.valor_total é NUMERIC(12,2), que aceita até ~R$ 10
// bilhões sem estourar. R$ 2 milhões fica bem acima da maior nota já vista
// no projeto (SYAGRI, R$ 1,06 mi — ver VALOR_MAX em boletoPdf.ts); acima
// disso é sinal de leitura errada, não compra real.
const VALOR_MAX_ITEM = 2_000_000

// Mesma lógica, para valorUnitario: a coluna itens_nfe.valor_unitario é
// NUMERIC(12,4), que estoura perto de R$ 100 milhões. 50 milhões dá folga
// enorme para qualquer preço unitário real de insumo agrícola e ainda fica
// bem longe do teto da coluna.
const VALOR_MAX_UNITARIO = 50_000_000

// Mesma lógica para quantidade: a coluna itens_nfe.quantidade é
// NUMERIC(12,3). Um valor >= 1 bilhão nunca é compra real de insumo — é
// dígito repetido ou tabela confundida na leitura. Vira null (não descarta
// o item, só a quantidade — ver achado do Apolo sobre quantidade opcional).
const QUANTIDADE_MAX = 1_000_000_000

// Teto de sanidade de NEGÓCIO para o TOTAL DO DOCUMENTO — maior que o de
// item porque um documento soma vários itens — NÃO é limite de banco: a
// coluna documentos_controle.valor_total é NUMERIC(12,2), que aceita até
// ~R$ 10 bilhões sem estourar. R$ 5 milhões fica bem acima da maior nota já
// vista no projeto (SYAGRI, R$ 1,06 mi — ver VALOR_MAX em boletoPdf.ts);
// acima disso é sinal de leitura errada, não compra real. Acima disto vira
// null — não recusa o documento por causa disso, só perde a conferência
// contra a soma dos itens.
const VALOR_MAX_DOCUMENTO = 5_000_000

// Janela de sanidade de data, para o documento inteiro E para cada item.
// Bem mais larga que a do boleto (180 dias passado / 730 futuro): um extrato
// cobre vários meses de histórico, não um vencimento só. Ainda existe para
// pegar erro grosseiro de dígito (um "2026" lido como "2126" ou "1926") —
// não para restringir documento antigo legítimo.
const DIAS_PASSADO_MAX = 5 * 365
const DIAS_FUTURO_MAX  = 3 * 365

// Um extrato de vários meses pode ter muitas duplicatas, mas não infinitas.
// Acima disto é sinal de leitura repetindo linha ou confundindo tabela — corta
// e loga, em vez de gravar centenas de itens sem ninguém perceber o excesso.
const MAX_ITENS = 300

// Um contrato de insumo não tem cem parcelas. Acima disto é leitura repetindo
// linha — corta e loga, em vez de criar dezenas de contas a pagar fantasma.
const MAX_PAGAMENTOS = 24

// ⚠️ CINTO DE SEGURANÇA DETERMINÍSTICO DO TIPO (Important 4 da revisão
// final, 23/08/2026). Até aqui, a decisão que liga R$ 647 mil de gasto — e
// que, errada para o outro lado, dobraria os R$ 2,77 milhões de extrato já
// em produção — dependia SÓ do julgamento da IA. `tipoDeDocumento()` já
// resolve a INDECISÃO (nulo/desconhecido → 'extrato'); o que faltava era
// conferir uma resposta CONFIANTE e errada.
//
// A forma dos dois documentos difere de verdade: um extrato de "Contas a
// Receber" lista muitas duplicatas, cada uma com o SEU número; um contrato
// tem poucas linhas de mercadoria e nenhuma numeração por linha (o número
// que existe é o do contrato inteiro). Quando o documento tem cara de
// extrato, a resposta 'contrato' é rebaixada.
//
// ⚠️ ESTES DOIS NÚMEROS FORAM ESTIMADOS, NÃO MEDIDOS. Os 3 PDFs reais
// (Syagri, Solos, Protec) e o contrato 280451 da Mosaic não estavam
// disponíveis para calibrar quando isto foi escrito. Referência conhecida
// pela spec: o contrato Mosaic tem 1 item; os extratos têm dezenas de
// duplicatas numeradas. A folga é grande, mas se um contrato de várias
// mercadorias numeradas aparecer um dia, ele será rebaixado a extrato — o
// gasto deixa de somar (lado BARATO, o dono corrige na tela) em vez de
// contar duas vezes. Recalibrar contra os PDFs reais continua pendente.
const ITENS_PARA_PARECER_EXTRATO = 5
const ITENS_NUMERADOS_PARA_PARECER_EXTRATO = 3

// Só aperta para UM LADO: pode rebaixar 'contrato' → 'extrato', NUNCA o
// contrário. Promover é o movimento que dobra dinheiro; rebaixar só deixa um
// valor sem somar, visível na tela.
function pareceExtrato(itens: ItemDocumentoLido[]): boolean {
  return itens.length > ITENS_PARA_PARECER_EXTRATO
    && itens.filter(i => i.numeroDocumento !== null).length > ITENS_NUMERADOS_PARA_PARECER_EXTRATO
}

export type ItemDocumentoLido = {
  descricao:      string
  // NULLABLE de propósito: a coluna itens_nfe.quantidade é NULLABLE, e um
  // extrato "Contas a Receber" frequentemente só traz o valor da duplicata,
  // sem quantidade nenhuma. Faltar quantidade não pode jogar fora o VALOR
  // junto — que é o que importa (achado crítico do Apolo).
  quantidade:     number | null
  unidade:        string
  valorUnitario:  number | null
  valorTotal:     number
  // Número da duplicata/nota/contrato ao qual este item pertence. Nulo
  // quando o documento não numera item por item (raro, mas o schema não
  // pode forçar um número que a IA não viu).
  numeroDocumento: string | null
  // 'YYYY-MM-DD'. Herda de `dataDocumento` quando o item não tem data
  // própria — nunca vira "hoje": ver `validarDocumentoLido`.
  data: string | null
}

// Uma data de pagamento do Quadro Resumo do contrato. `data` NUNCA é nula
// aqui (pagamento sem data válida é descartado inteiro — uma dívida sem
// vencimento não é conta a pagar, é palpite). `valor` pode ser nulo: muito
// contrato imprime a data sem repetir o valor ao lado, e quem monta a conta
// sabe resolver (ver deContrato.ts).
export type PagamentoLido = {
  data:  string
  valor: number | null
}

export type DocumentoLido = {
  fornecedor:          string | null
  dataDocumento:       string | null   // 'YYYY-MM-DD'
  // Identidade de nível DOCUMENTO — diferente do numeroDocumento de cada
  // item (que é o número da duplicata). NUNCA pedido pronto para a IA: é
  // montado EM CÓDIGO (ver `montarNumeroDocumento`) a partir de dois campos
  // crus (`codigoCliente` + `dataDocumento`) que a IA só lê, não formata —
  // texto livre gerado pela IA não pode virar chave de dedupe, porque duas
  // leituras do mesmo extrato podem grafar a mesma informação de jeitos
  // diferentes ("000786-2026-07-29" vs "000786 - 29/07/2026") e a constraint
  // `unique (fazenda_id, fornecedor_normalizado, numero_documento)` da
  // migration 017 não pegaria a duplicidade. Uma chave montada em código com
  // formato fixo é imune a isso. Pode vir null quando falta qualquer uma das
  // duas partes: aplicar a constraint `dedupe_exige_identidade` da migration
  // 017 é responsabilidade de quem grava, não desta leitura.
  numeroDocumento:     string | null
  // Metade CRUA de `numeroDocumento` (sem a data embutida) — devolvida à
  // parte porque `gravarDocumentoPdf.ts` precisa dela como fallback ESTÁVEL
  // de `numeroDocumento` do item, para item sem numeração própria (contrato
  // sem numeração por linha, ex.: Mosaic). `numeroDocumento` do documento
  // muda a cada reimportação (embute `dataDocumento`, a data de GERAÇÃO do
  // relatório/contrato relido) — usar aquele fallback faria a trava de
  // dedupe por item (migration 018) nunca disparar para este caso (achado C
  // da revisão do Apolo, rodada 3). `codigoCliente` sozinho não muda entre
  // reimportações do mesmo documento. Mesma regra de null de `numeroDocumento`:
  // quando `numeroDocumento` é não-nulo, `codigoCliente` também é (os dois
  // nascem juntos em `montarNumeroDocumento`).
  codigoCliente:       string | null
  // 'extrato' | 'contrato' — decide se os itens deste documento contam como
  // gasto no Financeiro (ver gravarDocumentoPdf.ts). NUNCA é nulo aqui:
  // `tipoDeDocumento` já resolveu a indefinição para o lado seguro.
  tipoDocumento:       'extrato' | 'contrato'
  valorTotalDocumento: number | null
  // somaDosItens - valorTotalDocumento, só quando valorTotalDocumento não é
  // null. Não recusa nada — é a defesa determinística contra item duplicado
  // ou perdido na leitura (ou separador decimal lido errado); quem grava usa
  // isto para decidir se avisa o dono.
  divergenciaTotal:    number | null
  itens:               ItemDocumentoLido[]
  // Quantos itens a IA listou mas a validação recusou (sem derrubar os
  // outros). Quem grava usa isto para decidir se avisa o dono que a leitura
  // ficou incompleta.
  itensDescartados:    number
  // Datas de pagamento do contrato (vazio para extrato) — viram conta a pagar
  // em gravarContasDoContrato.ts.
  pagamentos:          PagamentoLido[]
  // Quantas parcelas a IA listou e a validação recusou (data ilegível, ou
  // excedente do teto). Sempre 0 para extrato. NÃO é só telemetria: com
  // qualquer descarte, `deContrato.ts` fica PROIBIDO de derivar valor do
  // total do documento — a parcela sobrevivente não pode herdar o dinheiro
  // da que se perdeu (Important 1 da revisão final, 23/08/2026).
  pagamentosDescartados: number
}

// Retorno de `validarDocumentoLido` — separado de `ResultadoLeituraDocumento`
// porque a validação não conhece "falha" (essa só existe no nível da chamada
// de IA: rede, timeout, resposta truncada). Os mesmos dois motivos de recusa
// do resultado final (não é documento / reconhecido mas sem item
// aproveitável) já nascem aqui, onde a decisão é tomada.
export type ResultadoValidacaoDocumento =
  | { status: 'documento'; documento: DocumentoLido }
  | { status: 'nao-documento' }
  | { status: 'sem-itens-aproveitaveis'; itensDescartados: number }

// Mesma distinção de `ResultadoLeitura` em boletoPdf.ts: "não é documento" é
// conclusão (documento tratado, não precisa reler), "falha" é ausência de
// conclusão (quem chama decide se tenta de novo).
//
// `sem-itens-aproveitaveis` é um terceiro caminho, separado de
// `nao-documento` (achado do Apolo, rodada 3): "não reconheci este PDF como
// extrato/contrato" e "reconheci, mas recusei toda linha de cobrança" são
// informações DIFERENTES para quem sobe o PDF pela tela — a primeira não
// pede ação nenhuma, a segunda pede reler o documento à mão. Também é
// conclusão, não falha: reprocessar o mesmo PDF amanhã produz a mesma
// recusa item a item.
export type ResultadoLeituraDocumento =
  | { status: 'documento'; documento: DocumentoLido }
  | { status: 'nao-documento' }
  | { status: 'sem-itens-aproveitaveis'; itensDescartados: number }
  | { status: 'falha'; motivo: string }

// Schema fechado em todo nível, inclusive dentro do array — mesmo padrão de
// boletoPdf.ts. `ehDocumentoValido` vem PRIMEIRO: sem a pergunta explícita,
// um boleto avulso ou uma NF-e/DANFE anexada por engano seria respondido com
// itens inventados para preencher o formato.
const SCHEMA = {
  type: 'object',
  properties: {
    ehDocumentoValido: {
      type: 'boolean',
      description:
        'true SOMENTE se o documento for um extrato de "contas a receber" que uma revenda agrícola envia a um cliente ' +
        '(listando duplicatas/notas em aberto) OU um contrato de compra e venda de adubo/fertilizante/semente, ' +
        'e houver pelo menos 1 linha de cobrança (duplicata, produto ou item de contrato) com valor identificável — ' +
        'nem toda duplicata nomeia produto explicitamente. ' +
        'Boleto bancário avulso, nota fiscal (DANFE), comprovante de pagamento, propaganda, ' +
        'ou documento sem nenhuma linha de cobrança com valor legível = false.',
    },
    tipoDocumento: {
      type: ['string', 'null'],
      enum: ['extrato', 'contrato', null],
      description:
        'Qual dos dois formatos é este documento. "extrato" = relatório de "Contas a Receber" que uma ' +
        'revenda agrícola emite listando duplicatas/notas em aberto do cliente. "contrato" = contrato de ' +
        'compra e venda de mercadoria, com Quadro Resumo, VENDEDORA/COMPRADOR e número de contrato ' +
        '(ex: Mosaic). null se não der para decidir com segurança — não chute. ' +
        'NA DÚVIDA ENTRE OS DOIS, responda "extrato": errar para "contrato" faz o sistema contar a ' +
        'mesma compra duas vezes, e ninguém é avisado; errar para "extrato" só deixa um valor sem ' +
        'somar, que a pessoa corrige na tela.',
    },
    fornecedor: {
      type: ['string', 'null'],
      description:
        'Nome do fornecedor (a revenda que emitiu o extrato, ou a "Vendedora" no contrato — NUNCA a "Compradora"/"Cliente", ' +
        'que é o dono da fazenda). null se não identificável.',
    },
    dataDocumento: {
      type: ['string', 'null'],
      description:
        'Data de referência do documento inteiro, formato AAAA-MM-DD. No extrato, a data de emissão/geração do ' +
        'relatório (não a data de vencimento das duplicatas listadas). No contrato, a "Data de Início" do Quadro ' +
        'Resumo (não a data de assinatura, que fica no certificado Docusign). null se não identificável.',
    },
    codigoCliente: {
      type: ['string', 'null'],
      description:
        'Identificador CRU impresso no documento, sem formatar — não monte data nem combine com nada aqui, ' +
        'o código sozinho. CONTRATO (Mosaic e afins) — o número do contrato, do Quadro Resumo (ex: "288658"). ' +
        'EXTRATO "Contas a Receber" — o código do cliente/contrato impresso no cabeçalho (campo tipo "Código ' +
        'Cliente"/"Contrato", ex: "000786"). null se não identificável.',
    },
    valorTotalDocumento: {
      type: ['number', 'null'],
      description:
        'Total declarado no documento ("Total Geral" ou "Total A Vencer" no extrato; soma dos preços totais no contrato). ' +
        'Use ponto decimal. null se não houver total impresso.',
    },
    pagamentos: {
      type: 'array',
      description:
        'SOMENTE para contrato: as datas de pagamento do Quadro Resumo (campo "Data de pagamento"). ' +
        'Uma entrada por parcela — a maioria dos contratos tem uma só. NÃO confunda com a "Data de ' +
        'Início"/"Data Fim" (prazo de retirada da mercadoria, que é o dataDocumento). Lista VAZIA para ' +
        'extrato: as duplicatas de um extrato já viram itens, não pagamentos.',
      items: {
        type: 'object',
        properties: {
          data:  { type: 'string', description: 'Data de pagamento, formato AAAA-MM-DD.' },
          valor: {
            type: ['number', 'null'],
            description: 'Valor desta parcela, se impresso ao lado da data. Use ponto decimal. null se não houver.',
          },
        },
        required: ['data', 'valor'],
        additionalProperties: false,
      },
    },
    itens: {
      type: 'array',
      description: 'Todos os produtos do documento, um item por produto — mesmo repetido em duplicatas diferentes.',
      items: {
        type: 'object',
        properties: {
          descricao: {
            type: ['string', 'null'],
            description: 'Nome/descrição do produto como impresso. null se ilegível.',
          },
          quantidade: {
            type: ['number', 'null'],
            description: 'Quantidade do produto. null se não impressa ou ilegível — não estime.',
          },
          unidade: {
            type: ['string', 'null'],
            description:
              'Unidade da quantidade (ex: "KG", "L", "MTN", "SC", "UN"). Procure PRIMEIRO uma coluna própria de ' +
              'unidade na tabela. Se não houver coluna separada (padrão Syagri), a unidade normalmente vem GRUDADA ' +
              'no FINAL da descrição do produto, no formato "NÚMERO + SIGLA" (ex.: "DUAL GOLD 960 EC - 20 LT" → ' +
              '"LT"; "GESAPRIM GRDA - 10 KG" → "KG"; "VANIVA SC - 1 L" → "L"; "FERTILIZANTE CIBRA KCL 60 GR" → ' +
              '"GR") — nesse caso use a SIGLA encontrada no final da descrição, não invente nem devolva null só ' +
              'porque não existe coluna separada. null apenas quando genuinamente não houver pista nenhuma (nem ' +
              'coluna, nem sigla no fim da descrição).',
          },
          valor_unitario: {
            type: ['number', 'null'],
            description: 'Preço unitário do produto, se impresso. Use ponto decimal. null se não houver.',
          },
          valor_total: {
            type: ['number', 'null'],
            description:
              'Valor total da linha/duplicata deste item. Quando o documento trouxer "Valor Original" (ou "Valor Inicial") ' +
              'E "Valor Corrigido" lado a lado, use SEMPRE o Valor Corrigido (é o que sai do bolso de verdade, já reflete ' +
              'juro/correção e qualquer baixa/devolução já aplicada). Use ponto decimal. null se não houver valor nenhum.',
          },
          numero_documento: {
            type: ['string', 'null'],
            description:
              'Número da duplicata/nota/contrato deste item, como impresso (ex: "57106", "1-75249-1"). ' +
              'Quando o documento trouxer os produtos numa tabela SEPARADA da tabela de duplicatas (padrão Syagri, ' +
              '"Resumo de Produtos" cruzado pelo número da duplicata, ex: "44766/3"), cruze as duas tabelas e ' +
              'preencha o número da duplicata correspondente, não um índice da tabela de produtos. null se não houver.',
          },
          data: {
            type: ['string', 'null'],
            description:
              'Data específica deste item/duplicata, formato AAAA-MM-DD, quando diferente da data geral do documento. ' +
              'Quando a duplicata/linha trouxer data de EMISSÃO e data de VENCIMENTO lado a lado, use SEMPRE a de ' +
              'EMISSÃO — é a data da compra, não a do pagamento. Se só houver vencimento, use-o. ' +
              'null quando o item não tiver data própria (quem grava usa a data do documento nesse caso).',
          },
        },
        required: ['descricao', 'quantidade', 'unidade', 'valor_unitario', 'valor_total', 'numero_documento', 'data'],
        additionalProperties: false,
      },
    },
  },
  required: ['ehDocumentoValido', 'tipoDocumento', 'fornecedor', 'dataDocumento', 'codigoCliente', 'valorTotalDocumento', 'pagamentos', 'itens'],
  additionalProperties: false,
} as const

const INSTRUCAO =
  'Você está lendo um documento de compra de insumo agrícola (defensivo, adubo/fertilizante ou semente), sem XML de nota fiscal. ' +
  'Existem dois formatos possíveis, com o MESMO formato de saída esperado (lista de itens): ' +
  '(1) um extrato "Contas a Receber por Cliente" que a revenda (fornecedor) envia, listando várias duplicatas/notas em aberto ' +
  'do cliente, cobrindo vários meses — em alguns casos os produtos aparecem junto de cada duplicata, em outros (ex: Syagri) ' +
  'aparecem numa tabela separada de "Resumo de Produtos" no fim, cruzada pelo número da duplicata; ' +
  '(2) um contrato de compra e venda de adubo/fertilizante (ex: Mosaic), de várias páginas, onde SÓ a primeira página ' +
  '("Quadro Resumo": número do contrato, Vendedora, mercadoria, quantidade, preços, Data de Início e Data Fim) importa — ' +
  'ignore completamente cláusulas jurídicas, termos de uso e, se houver, o "Certificado de Conclusão" do Docusign com ' +
  'rastreamento de assinatura: isso nunca é produto ou valor de compra. ' +
  'Quando o documento trouxer dois valores por duplicata (Valor Original/Inicial e Valor Corrigido), use sempre o Valor ' +
  'Corrigido. Não calcule, não estime e não complete o que estiver ilegível — devolva null no campo. ' +
  'Liste TODOS os produtos do documento, um item por produto, mesmo que o mesmo produto se repita em duplicatas diferentes. ' +
  'Quando a duplicata/linha trouxer data de EMISSÃO e data de VENCIMENTO, use a de EMISSÃO — é a data da compra, não a ' +
  'do pagamento. Se só houver vencimento, use-o. ' +
  'Quando o documento tiver uma tabela de duplicatas E uma tabela separada de produtos (cruzadas pelo número do ' +
  'documento), cada duplicata vira UM OU MAIS itens vindos da tabela de produtos — NUNCA gere um item pra linha da ' +
  'duplicata E outro pros produtos dela: se a duplicata tiver 1 produto só, é 1 item; se tiver 3, são 3 itens, mas a ' +
  'duplicata em si nunca vira uma linha adicional. Nesse caso, a SOMA dos itens gerados a partir de uma mesma ' +
  'duplicata precisa fechar com o valor daquela duplicata — NUNCA repita o valor cheio da duplicata em mais de um ' +
  'item derivado dela (3 produtos com o valor cheio da duplicata cada um triplicaria o gasto). Se a tabela de ' +
  'produtos não trouxer o valor de cada produto individualmente, gere um único item para a duplicata inteira ' +
  '(a descrição pode listar os produtos juntos), em vez de dividir em vários itens sem saber o valor de cada um. ' +
  'Preste atenção especial na UNIDADE de cada item: quando não houver coluna própria de unidade (padrão Syagri), ' +
  'ela costuma vir grudada no final da descrição do produto, no formato "NÚMERO + SIGLA" (ex.: "- 20 LT", "- 10 KG", ' +
  '"- 1 L", "60 GR") — extraia essa sigla como unidade em vez de devolver null. ' +
  'No CONTRATO, além dos produtos, leia a DATA DE PAGAMENTO do Quadro Resumo (campo "Data de pagamento", ' +
  'às vezes junto de "Forma de pagamento") e devolva em `pagamentos` — é o compromisso financeiro, e é ' +
  'DIFERENTE da "Data de Início" (que é o prazo de retirada da mercadoria e vai em dataDocumento). ' +
  'Havendo mais de uma parcela, uma entrada por parcela. No EXTRATO, `pagamentos` é sempre lista vazia. ' +
  // Frase de desempate — Important 4 da revisão final (23/08/2026). O prompt
  // descrevia os dois formatos, mas em nenhum lugar dizia o que fazer na
  // dúvida, nem que os dois erros custam coisas MUITO diferentes. A IA
  // decidia como se o custo fosse simétrico; não é.
  'DESEMPATE, se você ficar em dúvida entre os dois formatos: responda "extrato". Errar para ' +
  '"contrato" faz o sistema contar a mesma compra duas vezes, em silêncio, porque a nota fiscal ' +
  'dessa compra vai chegar depois por outro caminho. Errar para "extrato" só deixa um valor sem ' +
  'somar, e a pessoa corrige na tela. Só responda "contrato" quando o documento for claramente um ' +
  'contrato de compra e venda com Quadro Resumo.'

// O formato bater não prova que a data existe ('2026-02-31' passa no regex e
// `dataExiste`/`diasEntre` — importados de contas/datas.ts, mesma checagem
// que o boleto usa — pegam isso), e mesmo uma data que existe pode ser fruto
// de dígito mal lido pela IA ('2126-07-10', '1926-07-10'). Data fora da
// janela vira null, não derruba a linha: o item herda a data do documento
// (ou fica sem data), nunca é descartado só por causa disto.
function dataSanitizada(v: unknown, hojeISO: string): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !dataExiste(v)) return null
  const dias = diasEntre(hojeISO, v)
  return dias >= -DIAS_PASSADO_MAX && dias <= DIAS_FUTURO_MAX ? v : null
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// O default MAIS BARATO, não o mais provável — e a assimetria é de propósito.
// Um contrato lido como "extrato" só deixa de somar um valor, e o dono
// conserta na tela quando estranhar o total. Um extrato lido como "contrato"
// grava conta_como_compra=true numa compra cuja NF-e o Make ainda vai
// derrubar, e o Financeiro passa a somar o mesmo dinheiro duas vezes SEM
// avisar ninguém. Por isso: só a string exata 'contrato' vira contrato.
// Nada de trim/lowercase — se a IA devolveu ' CONTRATO ', a resposta não
// obedeceu ao enum do schema, e resposta fora do contrato não merece
// interpretação generosa.
export function tipoDeDocumento(v: unknown): 'extrato' | 'contrato' {
  return v === 'contrato' ? 'contrato' : 'extrato'
}

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Chave de dedupe montada EM CÓDIGO, nunca pedida pronta à IA (achado do
// Apolo, rodada 3): formato fixo e determinístico é imune a variação de
// redação — a mesma dupla (código, data) sempre produz o mesmo texto, ao
// contrário de pedir para a IA formatar, onde duas leituras do mesmo
// documento podem sair grafadas diferente e furar a constraint de
// duplicidade da migration 017. Se faltar qualquer uma das duas partes, o
// resultado é null — não monta chave parcial (metade de uma identidade não
// identifica nada, e uma chave curta demais poderia colidir por acaso).
function montarNumeroDocumento(codigoCliente: string | null, dataDocumento: string | null): string | null {
  return codigoCliente && dataDocumento ? `${codigoCliente}-${dataDocumento}` : null
}

// Recusa em vez de adivinhar, mesmo espírito de `validarBoletoLido` — mas com
// uma diferença: aqui a unidade de recusa é o ITEM, não o documento inteiro.
// Um extrato com 20 duplicatas e 1 linha ilegível não pode perder as outras
// 19 — só descarta a linha ruim e conta em `itensDescartados`, para quem
// grava avisar que a leitura ficou incompleta. Mas um documento em que TODOS
// os itens foram descartados (ou que não trouxe nenhum) não pode devolver
// "sucesso" com uma lista vazia — e também não pode devolver o MESMO `null`
// que "isto não é um extrato/contrato" devolve: são informações diferentes
// para quem sobe o PDF pela tela (achado do Apolo, rodada 3) — por isso o
// retorno é sempre um objeto com `status`, nunca `null` puro.
//
// Exportada só para teste: é a única parte desta leitura que dá para provar
// sem gastar uma chamada de IA, e é onde mora a decisão de aceitar ou
// recusar cada linha.
// O que a validação dos pagamentos devolve. `descartados` NÃO é enfeite de
// log: é o sinal que impede o bug mais caro desta feature (Important 1 da
// revisão final, 23/08/2026). Um contrato de duas parcelas de R$ 323 mil em
// que uma data sai ilegível deixava UMA parcela de pé — e a regra "1
// pagamento herda o total" de deContrato.ts transformava isso numa dívida de
// R$ 647.986,35 marcada como valor CONFIRMADO. Sem este contador, quem monta
// a conta não tem como saber que o "1 pagamento" na verdade era 2.
export type PagamentosValidados = {
  pagamentos:  PagamentoLido[]
  descartados: number
}

// Exportada só para teste, mesmo motivo de `validarDocumentoLido`.
export function validarPagamentos(
  bruto: unknown,
  tipoDocumento: 'extrato' | 'contrato',
  hojeISO: string,
): PagamentosValidados {
  // Extrato nunca tem pagamento: cada duplicata dele já vira ITEM, e o boleto
  // correspondente chega por e-mail pelo Make (nfeEmail.ts → gravarBoletoDoPdf).
  // Criar conta a pagar aqui duplicaria a mesma cobrança em dois lugares.
  if (tipoDocumento !== 'contrato') return { pagamentos: [], descartados: 0 }
  if (!Array.isArray(bruto)) return { pagamentos: [], descartados: 0 }

  let descartados = 0

  // MAX_PAGAMENTOS corta a ENTRADA, não só os aceitos (minor da revisão
  // final): antes o laço percorria a resposta inteira — 5.000 entradas
  // alucinadas eram 5.000 iterações e 5.000 linhas de log, mesmo aceitando
  // 24. E o excedente cortado conta como DESCARTADO de propósito: perder
  // parcela por excesso é perder parcela igual, e a sobrevivente não pode
  // herdar o total do contrato por causa disso.
  const entrada = bruto.slice(0, MAX_PAGAMENTOS)
  if (bruto.length > MAX_PAGAMENTOS) {
    descartados += bruto.length - MAX_PAGAMENTOS
    console.warn(`[DocumentoPDF] pagamentos acima de ${MAX_PAGAMENTOS} — ${bruto.length - MAX_PAGAMENTOS} descartado(s).`)
  }

  // Chaveado pela DATA, não uma lista: mesma data de pagamento = mesma
  // parcela (Important 2). Sem isto, a IA lendo a mesma linha do Quadro
  // Resumo duas vezes gerava duas contas com o mesmo vencimento — a segunda
  // batia no índice único `contas_a_pagar_contrato_unico` (migration 012),
  // era contada como "duplicada" e o dono via "1 conta criada" com metade
  // da dívida, sem nada explicando. Deduplicar aqui, ANTES de virar conta,
  // resolve o problema onde ele nasce (leitura repetida) em vez de deixar o
  // banco arbitrar em silêncio.
  const porData = new Map<string, PagamentoLido>()

  for (const cru of entrada) {
    const p = cru as Record<string, unknown>
    const data = dataSanitizada(p?.data, hojeISO)
    // Sem data válida não há conta a pagar possível. Descarta o pagamento
    // (não o documento) e loga — o documento e o gasto continuam valendo.
    if (!data) {
      descartados++
      console.warn(`[DocumentoPDF] pagamento sem data utilizável, descartado: ${JSON.stringify(p?.data)}`)
      continue
    }

    // Mesma ordem do resto do arquivo: arredonda ANTES de comparar com o
    // teto, senão sobra de ponto flutuante decide a recusa.
    const bruto2 = numero(p?.valor)
    const arredondado = bruto2 !== null ? Math.round(bruto2 * 100) / 100 : null
    // Fora da faixa vira null (não descarta o pagamento): a data continua
    // valendo e quem monta a conta preenche o valor a partir do total.
    const valor = arredondado !== null && arredondado > 0 && arredondado <= VALOR_MAX_DOCUMENTO
      ? arredondado
      : null

    const jaVisto = porData.get(data)
    if (!jaVisto) {
      porData.set(data, { data, valor })
      continue
    }

    // Repetição NÃO é perda — a parcela continua de pé, só foi lida duas
    // vezes. Por isso não entra em `descartados`: fazer a regra do valor
    // travar por causa de uma leitura repetida deixaria a conta sem valor à
    // toa. A única coisa aproveitada da repetição é um valor que a primeira
    // leitura não trouxe.
    console.warn(`[DocumentoPDF] pagamento com data repetida (${data}) — tratado como a MESMA parcela.`)
    if (jaVisto.valor === null && valor !== null) jaVisto.valor = valor
  }

  return { pagamentos: [...porData.values()], descartados }
}

export function validarDocumentoLido(bruto: any, hojeISO: string): ResultadoValidacaoDocumento {
  // `=== true`, não frouxo: a string 'false' é truthy em JavaScript e
  // aceitaria como válido um documento que o modelo acabou de recusar.
  if (bruto?.ehDocumentoValido !== true) return { status: 'nao-documento' }

  const fornecedor      = texto(bruto.fornecedor)
  const dataDocumento   = dataSanitizada(bruto.dataDocumento, hojeISO)
  const codigoCliente   = texto(bruto.codigoCliente)
  const numeroDocumento = montarNumeroDocumento(codigoCliente, dataDocumento)
  // Resposta CRUA da IA, ainda sujeita ao cinto determinístico lá embaixo —
  // que só pode rodar depois de os itens estarem validados, porque é a forma
  // deles que denuncia um extrato. Por isso `pagamentos` também só é
  // calculado no fim: ele depende do tipo FINAL.
  const tipoDaIA        = tipoDeDocumento(bruto.tipoDocumento)

  const valorTotalDocumentoBruto = numero(bruto.valorTotalDocumento)
  // Arredonda ANTES de aplicar o teto, mesma ordem que os itens já seguem —
  // um valor que só estoura o teto por causa de sobra de ponto flutuante
  // seria recusado à toa se comparado antes de arredondar.
  const valorTotalDocumentoArredondado = valorTotalDocumentoBruto !== null
    ? Math.round(valorTotalDocumentoBruto * 100) / 100
    : null
  // Só é válido entre 0 (exclusivo) e o teto — negativo/zero é erro de sinal
  // ou leitura de estorno, não um total real; fora dessa faixa, pra qualquer
  // lado, vira null. Não recusa o documento por causa disso, só perde a
  // conferência contra a soma dos itens (ver `divergenciaTotal`).
  const valorTotalDocumento = valorTotalDocumentoArredondado !== null
    && valorTotalDocumentoArredondado > 0
    && valorTotalDocumentoArredondado <= VALOR_MAX_DOCUMENTO
    ? valorTotalDocumentoArredondado
    : null

  const brutos: unknown[] = Array.isArray(bruto.itens) ? bruto.itens : []

  let itensDescartados = 0
  const itens: ItemDocumentoLido[] = []

  // Motivo específico no log, não só o contador final — quem investiga uma
  // leitura incompleta precisa saber SE foi "sem valor" ou "acima do teto"
  // sem ter que reler o PDF do zero.
  const descarta = (motivo: string, itemBruto: unknown): void => {
    itensDescartados++
    const desc = texto((itemBruto as Record<string, unknown> | null)?.descricao) ?? '(sem descrição)'
    console.warn(`[DocumentoPDF] item descartado (${motivo}): "${desc.slice(0, 40)}"`)
  }

  for (const itemBruto of brutos) {
    if (itens.length >= MAX_ITENS) {
      // O resto é descartado, não silenciosamente ignorado: cada um que
      // sobrar do laço ainda incrementa o contador abaixo.
      descarta('limite de itens', itemBruto)
      continue
    }

    const item = itemBruto as Record<string, unknown>

    const descricao = texto(item?.descricao)
    if (!descricao) { descarta('sem descrição', itemBruto); continue }

    // Quantidade é OPCIONAL (coluna NULLABLE no banco): um extrato "Contas a
    // Receber" frequentemente só traz o valor da duplicata, sem quantidade
    // nenhuma. Faltar aqui NUNCA descarta o item — só quantidade fica null.
    // <=0 ou absurdamente grande (>= QUANTIDADE_MAX, dígito repetido/tabela
    // confundida) recebe o mesmo tratamento: vira null, não derruba a linha.
    // Arredonda para 3 casas ANTES de comparar com o teto — a coluna
    // itens_nfe.quantidade é NUMERIC(12,3), e comparar antes de arredondar
    // deixaria passar um valor que só estoura (ou só sobrevive) por causa de
    // sobra de ponto flutuante na 4ª casa em diante (achado do Apolo).
    let quantidade = numero(item.quantidade)
    if (quantidade !== null) {
      quantidade = Math.round(quantidade * 1000) / 1000
      if (quantidade <= 0 || quantidade >= QUANTIDADE_MAX) {
        quantidade = null
      }
    }

    // valorUnitario acima do teto de sanidade É motivo de descarte do item
    // inteiro (diferente da quantidade): um preço unitário desse tamanho
    // significa que a leitura da linha inteira não é confiável.
    let valorUnitario = numero(item.valor_unitario)
    if (valorUnitario !== null && valorUnitario > VALOR_MAX_UNITARIO) {
      descarta('valorUnitario acima do teto', itemBruto)
      continue
    }

    const valorTotalInformado = numero(item.valor_total)

    // Precisa de PELO MENOS um valor bruto (unitário ou total) — sem
    // nenhum, não há gasto para registrar, só uma linha de produto sem
    // preço.
    if (valorUnitario === null && valorTotalInformado === null) {
      descarta('sem valor', itemBruto)
      continue
    }

    // O cálculo só roda quando quantidade E valorUnitario existem os DOIS —
    // uma quantidade ausente não pode virar "1" ou "0" só para o cálculo
    // fechar.
    const valorTotalCalculado = quantidade !== null && valorUnitario !== null
      ? Math.round(quantidade * valorUnitario * 100) / 100
      : null

    const valorTotal = valorTotalInformado ?? valorTotalCalculado

    // Sem total informado e sem como calcular (valorUnitario sozinho, sem
    // quantidade) — não há valor de fato para registrar como gasto.
    if (valorTotal === null) { descarta('sem valor calculável', itemBruto); continue }
    // Negativo ou zero não é gasto — é estorno, desconto total ou leitura
    // errada de sinal. Mesma regra vale para o valorUnitario quando ele é a
    // base do cálculo: o produto (quantidade positiva × unitário <= 0) já
    // cai aqui.
    if (valorTotal <= 0) { descarta('valor negativo/zero', itemBruto); continue }
    if (valorTotal > VALOR_MAX_ITEM) { descarta('valorTotal acima do teto', itemBruto); continue }

    // valorUnitario negativo/zero que sobrevive até aqui só pode ter vindo
    // de um valorTotal informado PRONTO no documento (achado do Apolo,
    // rodada 3) — quando ele é a BASE do cálculo, um valorUnitario <= 0 já
    // produz um valorTotal <= 0 e a linha inteira é descartada acima, antes
    // de chegar aqui. Mesmo tratamento que quantidade recebe: zera só o
    // campo errado, não descarta a linha — o valorTotal continua valendo.
    if (valorUnitario !== null && valorUnitario <= 0) {
      console.warn(`[DocumentoPDF] valorUnitario negativo/zero, mantido null: "${descricao.slice(0, 40)}"`)
      valorUnitario = null
    }

    itens.push({
      descricao,
      quantidade,
      // Ausente não afeta dinheiro — seguro assumir um default em vez de
      // descartar a linha inteira por falta de unidade.
      unidade: texto(item.unidade) ?? 'UN',
      valorUnitario,
      valorTotal: Math.round(valorTotal * 100) / 100,
      numeroDocumento: texto(item.numero_documento),
      // Data do item; senão a do documento; senão null. NUNCA cai em "hoje"
      // por default — um item sem data nenhuma no PDF não pode fingir que
      // foi comprado hoje, isso mentiria sobre quando o gasto aconteceu.
      data: dataSanitizada(item.data, hojeISO) ?? dataDocumento,
    })
  }

  // Documento sem NENHUM item aproveitável não é sucesso, mas também não é a
  // mesma recusa de "isto não é um extrato/contrato" — status separado
  // (achado do Apolo, rodada 3) para quem sobe o PDF pela tela distinguir
  // "não reconheci este documento" de "reconheci, mas recusei toda linha".
  // Cobre também `itens` ausente/vazio/não-array (brutos fica [] e o laço
  // acima nunca roda) — nesse caso `itensDescartados` fica em 0, o que já é
  // verdade: nada foi listado para descartar.
  if (itens.length === 0) return { status: 'sem-itens-aproveitaveis', itensDescartados }

  const somaItens = Math.round(itens.reduce((acc, i) => acc + i.valorTotal, 0) * 100) / 100

  // Cinto determinístico (Important 4): a IA pode ter dito 'contrato' com
  // confiança sobre um documento que tem forma de extrato. Rebaixa, loga
  // alto (esta é uma decisão de dinheiro) e segue. Nunca promove.
  const tipoDocumento = tipoDaIA === 'contrato' && pareceExtrato(itens) ? 'extrato' : tipoDaIA
  if (tipoDocumento !== tipoDaIA) {
    console.warn(
      `[DocumentoPDF] IA classificou como 'contrato', mas o documento tem ${itens.length} itens e ` +
      `${itens.filter(i => i.numeroDocumento !== null).length} com número próprio — forma de EXTRATO. ` +
      'Rebaixado para extrato: os itens NÃO contam como gasto e nenhuma conta a pagar será criada.',
    )
  }

  // Depois do tipo final, nunca antes: extrato não tem pagamento, e um
  // documento rebaixado precisa perder os pagamentos junto — senão viraria
  // conta a pagar de um extrato, que é exatamente a cobrança em duplicidade
  // que `validarPagamentos` existe para impedir.
  const pagamentosLidos = validarPagamentos(bruto.pagamentos, tipoDocumento, hojeISO)

  return {
    status: 'documento',
    documento: {
      fornecedor,
      dataDocumento,
      numeroDocumento,
      codigoCliente,
      tipoDocumento,
      valorTotalDocumento,
      // Defesa determinística contra item duplicado/perdido na leitura, ou
      // separador decimal lido errado — só existe quando o documento trouxe
      // um total impresso para conferir contra. Não recusa nada aqui: quem
      // grava decide se a diferença é grande o bastante para avisar o dono.
      divergenciaTotal: valorTotalDocumento !== null
        ? Math.round((somaItens - valorTotalDocumento) * 100) / 100
        : null,
      itens,
      itensDescartados,
      pagamentos:            pagamentosLidos.pagamentos,
      pagamentosDescartados: pagamentosLidos.descartados,
    },
  }
}

// NUNCA estoura: erro de rede, 529, chave inválida ou modelo com nome errado
// caem todos no catch e viram FALHA (não "não é documento"), para quem chama
// poder tentar de novo em vez de descartar o documento por instabilidade da
// API. `hojeISO` É usado: toda data lida (documento e item) passa pela
// janela de sanidade de `dataSanitizada` — diferente do boleto, a janela
// aqui é bem mais larga (5 anos pra trás, 3 pra frente), porque um documento
// de compra pode legitimamente ter meses de idade (extrato cobre vários
// meses em aberto).
export async function lerDocumentoPdf(
  pdf: Buffer,
  nomeArquivo: string,
  hojeISO: string,
  anthropic: Anthropic,
): Promise<ResultadoLeituraDocumento> {
  if (pdf.length > LIMITE_MB * 1024 * 1024) {
    console.log(`[DocumentoPDF] "${nomeArquivo}" tem ${(pdf.length / 1024 / 1024).toFixed(1)} MB — acima do limite, ignorado.`)
    return { status: 'nao-documento' }
  }

  try {
    // `hojeISO` malformado ou uma data que não existe (ex: '2026-13-01')
    // não é incerteza de fornecedor — é erro de programação de QUEM CHAMA
    // esta função, e hoje passava batido: `dataSanitizada` comparava contra
    // ele em silêncio, `diasEntre` devolvia lixo, TODA data do documento e
    // dos itens virava null sem log nenhum explicando o motivo (achado do
    // Apolo, rodada 3). Lançar aqui joga no `catch` abaixo, que já vira
    // `{status:'falha'}` — não precisa de tratamento novo, só não pode ficar
    // silencioso.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hojeISO) || !dataExiste(hojeISO)) {
      throw new Error(`hojeISO inválido: "${hojeISO}" — esperado 'YYYY-MM-DD' com data existente`)
    }

    // `.stream().finalMessage()`, não `.create()`: com `max_tokens: 32000` (bem
    // acima do teto de ~21.333 que o próprio SDK calcula — 3.600.000ms × max_tokens
    // ÷ 128.000 > 600.000ms) o SDK RECUSA rodar sem streaming e lança
    // "Streaming is required for operations that may take longer than 10 minutes"
    // antes mesmo de fazer a chamada de rede — todo PDF caía no catch abaixo e
    // virava falha, sempre (achado ao vivo, 18/08/2026, fora dos testes porque a
    // suíte mocka `anthropic.messages.create`). `.finalMessage()` devolve a
    // resposta completa já montada a partir dos eventos do stream — mesmo
    // formato de `resposta.stop_reason`/`resposta.content` que `.create()`
    // devolvia, então nada abaixo desta chamada precisou mudar. boletoPdf.ts NÃO
    // tem este problema: `max_tokens: 1024` fica bem abaixo do teto (ver
    // comentário lá).
    const resposta = await anthropic.messages.stream({
      model:      MODELO,
      // 300 itens (MAX_ITENS) × ~200 bytes por linha do JSON deste schema
      // (chaves + aspas + vírgulas de descricao/quantidade/unidade/
      // valor_unitario/valor_total/numero_documento/data) ≈ 60.000
      // caracteres ÷ ~4 caracteres por token ≈ 15.000 tokens de saída, mais
      // os campos de nível documento. 32.000 dá folga confortável sem
      // chegar perto do teto — achado do Apolo: 8192 (o valor anterior)
      // truncava um extrato grande no meio do JSON.
      max_tokens: 32000,
      // Sem `effort: 'low'` — ver comentário de MODELO acima: aqui precisão
      // vale mais que velocidade.
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          // Documento antes do texto: ordem recomendada pela API para PDF,
          // gera menos alucinação que pedir a instrução primeiro.
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
          { type: 'text', text: INSTRUCAO },
        ],
      }],
    }).finalMessage()

    // Recusa por política: 200 com stop_reason 'refusal' e conteúdo vazio.
    // Não é erro, é conclusão — reler amanhã dá a mesma recusa.
    if (resposta.stop_reason === 'refusal') {
      console.warn(`[DocumentoPDF] Leitura de "${nomeArquivo}" recusada pelo modelo — ignorado.`)
      return { status: 'nao-documento' }
    }

    // Resposta cortada: JSON incompleto, leitura inútil. FALHA, não
    // conclusão — o documento precisa ser reprocessado.
    if (resposta.stop_reason === 'max_tokens') {
      return { status: 'falha', motivo: 'resposta truncada (max_tokens)' }
    }

    const bloco = resposta.content.find(b => b.type === 'text')
    if (!bloco || bloco.type !== 'text') {
      return { status: 'falha', motivo: 'resposta sem texto' }
    }

    const validado = validarDocumentoLido(JSON.parse(bloco.text), hojeISO)

    if (validado.status === 'nao-documento') {
      console.log(`[DocumentoPDF] "${nomeArquivo}" não é extrato/contrato válido (ou está ilegível) — ignorado.`)
      return { status: 'nao-documento' }
    }

    // Diferente de "nao-documento": o PDF FOI reconhecido como extrato ou
    // contrato, mas nenhuma linha sobreviveu à validação. Quem sobe o PDF
    // pela tela precisa dessa distinção pra saber se deve reler o documento
    // à mão em vez de simplesmente ignorar o upload.
    if (validado.status === 'sem-itens-aproveitaveis') {
      console.warn(
        `[DocumentoPDF] "${nomeArquivo}": documento reconhecido, mas nenhuma linha pôde ser lida com ` +
        `segurança (${validado.itensDescartados} descartadas) — confira o PDF.`,
      )
      return { status: 'sem-itens-aproveitaveis', itensDescartados: validado.itensDescartados }
    }

    const lido = validado.documento

    if (lido.itensDescartados > 0) {
      console.warn(`[DocumentoPDF] "${nomeArquivo}": ${lido.itensDescartados} item(ns) descartado(s) na validação, ${lido.itens.length} aceito(s).`)
    }

    return { status: 'documento', documento: lido }

  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err)
    console.error(`[DocumentoPDF] Falha ao ler "${nomeArquivo}":`, motivo)
    return { status: 'falha', motivo }
  }
}
