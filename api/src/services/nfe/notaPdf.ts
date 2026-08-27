import Anthropic from '@anthropic-ai/sdk'
import { dataExiste, diasEntre } from '../contas/datas'
import type { NFeData, NFeItem, NFeDuplicata } from '../nfeProcessor'

// Lê o DANFE (ou a NFS-e) em PDF que o fornecedor mandou e devolve os campos
// de uma nota fiscal — sem XML nenhum. Esta é só a LEITURA e a VALIDAÇÃO;
// gravar é `gravarNotaDoPdf.ts`, que entrega o resultado daqui ao MESMO
// `processarNFe` que o XML usa (estoque, financeiro, boleto e WhatsApp saem
// pelo cano que já existe).
//
// Regra que manda em tudo aqui: RECUSAR em vez de adivinhar. O PDF é a IA
// lendo papel, e um dígito errado no número ou no CNPJ fura o índice único da
// nota — quando a mesma nota chegar depois pelo Make, estoque e gasto contam
// duas vezes, calados (memória "nfe-corrida-duas-portas", corrida de 11 ms
// medida em produção).

// Mesma regra ETC de documentoPdf.ts/boletoPdf.ts: o modelo vem do ambiente,
// nunca cravado. Sem `effort: 'low'` — uma DANFE tem tabela de produtos com
// NCM e CFOP por linha, e errar uma linha é estoque ou dinheiro errado.
const MODELO = process.env.ANTHROPIC_MODEL_NOTA_PDF ?? 'claude-opus-5'

// Mesmo teto do bucket "notas-pdf" (10 MB, configurado no painel). Aceitar em
// código mais do que o bucket aceita faria a leitura passar e o upload falhar
// depois — gastando uma chamada de IA para nada.
const LIMITE_MB = 10

// Tetos de sanidade de NEGÓCIO, não de banco. A maior nota já vista no projeto
// é a da SYAGRI, R$ 1,06 mi (ver VALOR_MAX em contas/boletoPdf.ts). Acima
// disso é leitura errada, não compra real.
const VALOR_MAX_NOTA     = 5_000_000
const VALOR_MAX_ITEM     = 2_000_000
const VALOR_MAX_UNITARIO = 50_000_000
const QUANTIDADE_MAX     = 1_000_000_000

// 200 é o MESMO corte que processarNFe aplica (`itensSeguros`). Cortar aqui, e
// não só lá, é o que permite CONTAR o excedente e avisar na tela — lá o
// excedente some calado.
const MAX_ITENS      = 200
const MAX_DUPLICATAS = 24

// Janela da data de EMISSÃO: nota velha existe (importação de histórico), nota
// emitida no futuro não. 30 dias de folga cobrem fuso e relógio torto.
const DIAS_PASSADO_MAX = 5 * 365
const DIAS_FUTURO_MAX  = 30

// Janela do VENCIMENTO das duplicatas: bem mais larga no futuro — defensivo é
// pago em duas datas fixas por ano, e contrato de adubo passa de 12 meses.
const DIAS_VENCIMENTO_FUTURO_MAX = 730

export type ItemNotaLido = {
  descricao:      string
  // `null` = a nota NÃO TRAZ quantidade impressa — é o caso da NFS-e, que não
  // tem a coluna. O `1` é fabricado só em `converterParaNFeData`, no instante
  // em que o item vira NFeData, e NUNCA fica guardado aqui.
  //
  // Isto é fail-CLOSED de propósito, e foi a 2ª tentativa. A 1ª carregava
  // `quantidade: 1` mais uma marca `quantidadeInferida: true` que fazia a ida e
  // volta pelo navegador — achado [médio] do Apolo (27/08/2026), medido:
  // bastava a chave não voltar para a trava evaporar e o "1" inventado entrar
  // no ESTOQUE como mercadoria de verdade. Com `null`, perder o campo
  // FORTALECE a defesa: quantidade ausente numa DANFE cai na régua que já
  // existe, e a única forma de virar 1 é a nota continuar sendo NFS-e.
  quantidade:     number | null
  unidade:        string
  valorUnitario:  number
  valorTotal:     number
  quantidadeTrib: number | null
  unidadeTrib:    string
  ncm:            string   // '' quando ilegível — a cascata de processarNFe trata
  cfop:           string   // '' quando ilegível
  // Escolhido pelo DONO na conferência, nunca lido do papel (o DANFE não traz
  // centro de custo). '' = "o sistema decide", que é o comportamento de sempre:
  // a tela Financeiro cai em `insumos.tipo ?? 'outro'`.
  centroCusto:    string
}

export type DuplicataLida = {
  numero:     string
  vencimento: string | null
  valor:      number | null
}

export type NotaLidaDoPdf = {
  modelo:         'nfe' | 'nfse'
  numero:         string
  emitenteNome:   string
  emitenteCnpj:   string
  dataEmissao:    string
  valorTotal:     number
  formaPagamento: string | null
  // O texto CRU que a IA leu no quadro de pagamento, ANTES de tPagNormalizado
  // recusar tudo que não é código puro. Achado [alto] do Apolo, 3ª rodada
  // (24/08/2026): quando `formaPagamento` vira null (ex.: "03 - Cartão de
  // Crédito", que tPagNormalizado recusa por doutrina), a tela de conferência
  // não tinha como mostrar ao dono o que sumiu — ele via a conta nascer sem a
  // tarja "Conferir antes de pagar" e sem explicação nenhuma. Só para a tela:
  // converterParaNFeData NÃO repassa este campo pro NFeData (processarNFe
  // nunca precisa saber o que a IA leu antes da normalização).
  formaPagamentoLido: string | null
  duplicatas:     DuplicataLida[]
  itens:          ItemNotaLido[]
}

export type ValidacaoNota =
  | { status: 'nota'; nota: NotaLidaDoPdf; itensDescartados: number; duplicatasDescartadas: number }
  // Número ou CNPJ ilegível. É recusa dura: sem os dois, a trava de
  // duplicidade do banco não tem chave, e a nota entraria sem defesa nenhuma.
  | { status: 'sem-identidade' }
  | { status: 'dados-invalidos'; campo: 'dataEmissao' | 'valorTotal' }
  // Nota sem nenhum item aproveitável NÃO vira NFeData vazio: em processarNFe,
  // `every` de lista vazia é `true`, então ela cairia em "tudo é compra" e
  // lançaria o valor cheio no Financeiro sem um único item que justifique.
  | { status: 'sem-itens' }

export type ResultadoLeituraNota =
  | ValidacaoNota
  | { status: 'nao-nota' }
  | { status: 'grande-demais' }
  // "falha" é INFRA (rede, sobrecarga, chave inválida, resposta truncada) —
  // vira 503 "tente de novo", nunca 422 "seu arquivo é inválido".
  | { status: 'falha'; motivo: string }

export const SCHEMA = {
  type: 'object',
  properties: {
    ehNotaFiscal: {
      type: 'boolean',
      description:
        'true SOMENTE se o documento for uma nota fiscal: DANFE (Documento Auxiliar da Nota Fiscal Eletrônica, ' +
        'com quadro EMITENTE, DESTINATÁRIO e tabela DADOS DO PRODUTO/SERVIÇO) ou nota fiscal de serviço (NFS-e) ' +
        'de uma prefeitura. Boleto bancário, extrato de "contas a receber", contrato de compra e venda, ' +
        'comprovante de pagamento, propaganda ou orçamento = false.',
    },
    // ⚠️ NÃO troque `type: 'string'` por `type: ['string','null']` aqui — a API
    // da Anthropic RECUSA a requisição inteira com HTTP 400 quando uma
    // propriedade combina `enum` com `type` em array, mesmo que o enum liste
    // null: "Invalid schema: Enum value 'nfe' does not match declared type
    // '['string','null']'". Medido em runtime em 23/08/2026 no schema irmão
    // (documentoPdf.ts), fora dos testes — a suíte mocka a IA e nunca manda o
    // schema pra API de verdade. Guarda contra recaída: teste de invariante em
    // notaPdf.test.ts. `null` não faz falta: quem não for 'nfse' vira 'nfe'.
    modelo: {
      type: 'string',
      enum: ['nfe', 'nfse'],
      description:
        '"nfe" para nota de PRODUTO (DANFE, com CFOP e NCM por item). "nfse" para nota de SERVIÇO ' +
        '(NFS-e municipal, sem CFOP/NCM, com ISS e descrição de serviço prestado). Na dúvida, "nfe".',
    },
    numero: {
      type: ['string', 'null'],
      description:
        'Número da nota, como impresso, só os dígitos (ex.: "Nº 000.058.717" → "58717"). ' +
        'NÃO é a chave de acesso de 44 dígitos e NÃO é a série. null se ilegível.',
    },
    emitenteNome: {
      type: ['string', 'null'],
      description:
        'Razão social de quem EMITIU a nota (o fornecedor/vendedor, quadro "EMITENTE"). ' +
        'NUNCA o DESTINATÁRIO/REMETENTE (que é o dono da fazenda) nem a transportadora. null se ilegível.',
    },
    emitenteCnpj: {
      type: ['string', 'null'],
      description:
        'CNPJ do EMITENTE, só dígitos, sem ponto/barra/traço (14 dígitos; 11 se for CPF de produtor rural). ' +
        'NUNCA o CNPJ do destinatário nem o da transportadora. null se ilegível.',
    },
    dataEmissao: {
      type: ['string', 'null'],
      description:
        'Data de EMISSÃO da nota, formato AAAA-MM-DD. Não é a data de saída/entrada nem a de vencimento. ' +
        'null se ilegível.',
    },
    valorTotal: {
      type: ['number', 'null'],
      description:
        'VALOR TOTAL DA NOTA (campo "V. TOTAL DA NOTA" no quadro CÁLCULO DO IMPOSTO) — o valor cheio, com ' +
        'frete e impostos, NÃO o "valor total dos produtos". Use ponto decimal. null se ilegível.',
    },
    formaPagamento: {
      type: ['string', 'null'],
      description:
        'Código tPag impresso no quadro de pagamento, quando houver (ex.: "15" boleto, "01" dinheiro, ' +
        '"03" cartão de crédito, "90" sem pagamento). Só o código, sem descrição. null se não impresso.',
    },
    duplicatas: {
      type: 'array',
      description:
        'Quadro FATURA/DUPLICATA da nota — uma entrada por parcela/boleto. Lista VAZIA quando a nota não ' +
        'traz quadro de cobrança (é o caso das notas de remessa de entrega futura).',
      items: {
        type: 'object',
        properties: {
          numero:     { type: ['string', 'null'], description: 'Número da duplicata/parcela, como impresso (ex.: "001", "58717/1"). null se não houver.' },
          vencimento: { type: ['string', 'null'], description: 'Data de vencimento desta parcela, formato AAAA-MM-DD. null se não impressa.' },
          valor:      { type: ['number', 'null'], description: 'Valor desta parcela. Use ponto decimal. null se não impresso.' },
        },
        required: ['numero', 'vencimento', 'valor'],
        additionalProperties: false,
      },
    },
    itens: {
      type: 'array',
      description:
        'Uma entrada por LINHA da tabela DADOS DO PRODUTO/SERVIÇO. Não agrupe linhas parecidas, não invente ' +
        'linha que não está impressa, e não pule linha que continua na página seguinte.',
      items: {
        type: 'object',
        properties: {
          descricao:     { type: ['string', 'null'], description: 'DESCRIÇÃO DO PRODUTO/SERVIÇO, como impressa. null se ilegível.' },
          quantidade:    { type: ['number', 'null'], description: 'Coluna QUANT. (quantidade comercial). Use ponto decimal. null se ilegível.' },
          unidade:       { type: ['string', 'null'], description: 'Coluna UN (unidade comercial: "UN", "KG", "L", "BD", "SC"...). null se ilegível.' },
          valorUnitario: { type: ['number', 'null'], description: 'Coluna V. UNIT. (preço unitário). Use ponto decimal. null se ilegível.' },
          valorTotal:    { type: ['number', 'null'], description: 'Coluna V. TOTAL da linha (quantidade × unitário). Use ponto decimal. null se ilegível.' },
          ncm: {
            type: ['string', 'null'],
            description:
              'Coluna NCM/SH — exatamente 8 dígitos, só números (ex.: "38089329"). É o código que decide se o ' +
              'produto entra no estoque. NÃO invente, NÃO complete com zeros e NÃO deduza pelo nome do ' +
              'produto: null quando a coluna não estiver legível.',
          },
          cfop: {
            type: ['string', 'null'],
            description:
              'O número IMPRESSO na coluna CFOP daquela LINHA da tabela DADOS DO PRODUTO/SERVIÇO — exatamente ' +
              '4 dígitos, copiado, nunca deduzido. A coluna fica entre NCM/SH e a unidade, e a maioria das ' +
              'notas de compra traz "5102", "5405", "6102" ou "6108". ' +
              'PROIBIDO deduzir o CFOP da NATUREZA DA OPERAÇÃO impressa no cabeçalho, do nome do produto, do ' +
              'tipo de fornecedor ou do CFOP de outra linha — cada linha tem o seu, e "compre 20, leve 2" vem ' +
              'com códigos diferentes na mesma nota. ' +
              'Em 24/08/2026 uma nota de loja de material de construção (CFOPs 5405 e 5102 impressos) foi lida ' +
              'como "5922" nos cinco itens: 5922 é faturamento de entrega futura, que faz a mercadoria NÃO ' +
              'entrar no estoque. Se você não conseguir LER o número na coluna, devolva null — null é tratado ' +
              'com segurança pelo sistema; um código inventado some com mercadoria do galpão sem avisar ninguém.',
          },
        },
        required: ['descricao', 'quantidade', 'unidade', 'valorUnitario', 'valorTotal', 'ncm', 'cfop'],
        additionalProperties: false,
      },
    },
  },
  required: ['ehNotaFiscal', 'modelo', 'numero', 'emitenteNome', 'emitenteCnpj', 'dataEmissao', 'valorTotal', 'formaPagamento', 'duplicatas', 'itens'],
  additionalProperties: false,
} as const

const INSTRUCAO =
  'Você está lendo uma nota fiscal de compra de insumo agrícola, em PDF — um DANFE (nota de produto) ou uma ' +
  'NFS-e (nota de serviço). Extraia os campos exatamente como impressos. ' +
  'NÃO calcule, NÃO estime e NÃO complete o que estiver ilegível: devolva null no campo. ' +
  'O EMITENTE é o fornecedor que vendeu; o DESTINATÁRIO é a fazenda que comprou — nunca troque os dois, e ' +
  'nunca use os dados da transportadora. ' +
  'Na tabela DADOS DO PRODUTO/SERVIÇO, uma linha impressa = um item, inclusive quando a tabela continua na ' +
  'página seguinte. As colunas NCM/SH e CFOP são as mais importantes de todas: elas decidem se o produto ' +
  'entra no estoque e se a nota é compra, remessa de entrega futura ou bonificação. ' +
  'O CFOP é COPIADO da coluna CFOP daquela linha — nunca deduzido da natureza da operação do cabeçalho, do ' +
  'nome do produto ou do CFOP de outra linha. Compra comum de loja costuma trazer 5102, 5405, 6102 ou 6108; ' +
  'códigos como 5922, 5117 e 5910 significam faturamento sem mercadoria, entrega de pedido já pago e ' +
  'bonificação, e só aparecem quando estão IMPRESSOS na linha. Se a coluna estiver ilegível, devolva null: ' +
  'um código inventado vale menos que nenhum código, e um 5922 inventado faz a mercadoria sumir do estoque. ' +
  'O valor total é o "V. TOTAL DA NOTA" do quadro CÁLCULO DO IMPOSTO, não o "valor total dos produtos". ' +
  'O quadro FATURA/DUPLICATA vira a lista de duplicatas, uma entrada por parcela; nota sem esse quadro tem ' +
  'lista vazia. ' +
  'Se o arquivo não for nota fiscal (boleto, extrato de contas a receber, contrato, comprovante, propaganda), ' +
  'responda ehNotaFiscal = false e deixe o resto em null ou lista vazia.'

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function numeroFinito(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Só dígitos: o DANFE imprime "04.063.805/0001-35" e o dado fiscal é o número
// puro. 11 (CPF de produtor rural) ou 14 (CNPJ) — qualquer outro tamanho é
// leitura errada, e leitura errada de CNPJ é o que fura a trava de duplicidade.
function cnpjLimpo(v: unknown): string | null {
  const digitos = String(v ?? '').replace(/\D/g, '')
  return digitos.length === 11 || digitos.length === 14 ? digitos : null
}

// O DANFE imprime "Nº 000.058.717"; o parser de XML lê <nNF> como NÚMERO e
// grava "58717". Os dois caminhos PRECISAM produzir o mesmo texto: a trava de
// duplicidade é (numero, emitente_cnpj, fazenda_id, modelo) comparada como
// string — "000058717" e "58717" seriam duas notas diferentes para o banco, e
// a compra entraria duas vezes quando o XML chegasse pelo Make.
function numeroDaNota(v: unknown): string | null {
  const digitos = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '')
  return digitos.length > 0 ? digitos : null
}

// tPag TEM que sair daqui com dois dígitos ('03', '15', '90') — é assim que o
// parser de XML grava (`String(primeiroPag.tPag).padStart(2, '0')`, ver
// nfeProcessor.ts) e é assim que motivoSemBoletoDaNota/
// motivoVencidoPelaDuplicata comparam. Achado [alto] do Apolo em 24/08/2026,
// provado executando: com '3', 'Cartão de Crédito' ou '03 - Cartão de Crédito',
// NENHUM dos dois casa — e a nota de cartão COM duplicata perde o aviso
// "Conferir antes de pagar" nos três lugares onde ele deveria aparecer (a
// observação da conta, a mensagem do WhatsApp e o resumo diário). Pelo XML esse
// mesmo papel avisa; pelo PDF calava.
//
// Códigos tPag válidos da NF-e (Nota Técnica 2023.004 — acrescentou '20', '21'
// e '22': PIX estático, crédito em loja e pagamento eletrônico não informado;
// citação conferida em 24/08/2026, contas/deNotaFiscal.ts já chama o '20' de
// "PIX estático"): tudo que NÃO está aqui é lido errado, não é forma de
// pagamento nova.
// Exportada só para teste-guarda: deNotaFiscal.test.ts varre '00'..'99' e
// confere que todo código para o qual motivoSemBoletoDaNota() devolve algo
// diferente de null está dentro desta tabela — protege contra alguém mapear
// um código novo em MOTIVO_SEM_BOLETO (contas/deNotaFiscal.ts) e o caminho do
// PDF ignorar esse código calado por não reconhecê-lo aqui.
export const TPAG_VALIDOS = new Set([
  '01', '02', '03', '04', '05', '10', '11', '12', '13', '14', '15',
  '16', '17', '18', '19', '20', '21', '22', '90', '99',
])

// Achado [crítico] do Apolo em 24/08/2026, medido: a versão anterior fazia
// `.replace(/\D/g, '')`, que CATA dígito de dentro de frase inteira —
// "90 dias" virava '90' (= "sem pagamento", a nota fica SEM conta a pagar) e
// "1 - A prazo" virava '01' (= "dinheiro à vista", e havendo duplicata o
// sistema ainda escrevia "pode já ter sido pago, dispense esta conta").
// Agora só aceitamos ENTRADA que já É o código (1 ou 2 dígitos, nada mais) —
// e mesmo assim só se o código existir na tabela oficial. Frase inteira,
// mistura de texto com número, ou código que a tabela não conhece: tudo null.
//
// O custo assumido aqui é o CERTO por doutrina do projeto (comentário em
// contas/deNotaFiscal.ts): "03 - Cartão de Crédito" agora vira null e a nota
// ganha um boleto A MAIS para o dono dispensar num toque — é o erro barato,
// de propósito, porque o erro caro (perder um boleto real) vence sem ninguém
// avisar.
//
// EXIGE dois dígitos, sem padStart — achado [médio] do Apolo, 3ª rodada
// (24/08/2026), medido: o DANFE imprime `indPag` no quadro de fatura com UM
// dígito ('0' = à vista, '1' = A PRAZO — a nota que TEM boleto, '2' = outros),
// e um `padStart` aqui transformava '1' em '01' = "dinheiro à vista" no mapa
// de tPag: exatamente o oposto de "a prazo", calando o aviso justo na nota que
// mais precisa dele. O padStart do parser de XML (nfeProcessor.ts) é
// caminho DIFERENTE, que lê tPag (não indPag) já como número do XML — este
// comentário não se aplica a ele, e ele continua padded. Aqui, no papel, tPag
// sempre vem impresso com dois dígitos; um dígito só é indPag vazando, nunca
// tPag de verdade.
function tPagNormalizado(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{2}$/.test(s)) return null // frase inteira, ou 1 dígito (indPag), != código -> "não li"
  return TPAG_VALIDOS.has(s) ? s : null
}

function dataNaJanela(v: unknown, hojeISO: string, diasPassado: number, diasFuturo: number): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !dataExiste(v)) return null
  const dias = diasEntre(hojeISO, v)
  return dias >= -diasPassado && dias <= diasFuturo ? v : null
}

function codigoDeNDigitos(v: unknown, n: number): string {
  const digitos = String(v ?? '').replace(/\D/g, '')
  return digitos.length === n ? digitos : ''
}

// Exportada só para teste: é a única parte desta leitura que dá para provar sem
// gastar uma chamada de IA, e é onde mora a decisão de aceitar ou recusar. Roda
// DUAS vezes no fluxo real — na leitura (passo 1) e de novo quando o dono
// confirma o que editou na tela (passo 2), para não existirem duas réguas
// diferentes para a mesma nota.
export function validarNotaLida(bruto: unknown, hojeISO: string): ValidacaoNota {
  const b = (bruto ?? {}) as Record<string, unknown>

  // 1. Identidade — sem ela a nota não tem chave de duplicidade.
  const numero = numeroDaNota(b.numero)
  const cnpj   = cnpjLimpo(b.emitenteCnpj)
  if (!numero || !cnpj) return { status: 'sem-identidade' }

  // 2. Data e valor — recusa dura, não descarte de linha.
  const dataEmissao = dataNaJanela(b.dataEmissao, hojeISO, DIAS_PASSADO_MAX, DIAS_FUTURO_MAX)
  if (!dataEmissao) return { status: 'dados-invalidos', campo: 'dataEmissao' }

  const valorTotal = numeroFinito(b.valorTotal)
  if (valorTotal === null || valorTotal <= 0 || valorTotal > VALOR_MAX_NOTA) {
    return { status: 'dados-invalidos', campo: 'valorTotal' }
  }

  // 3. Itens — a unidade de recusa aqui é a LINHA, nunca a nota. Uma nota com
  //    20 itens e 1 ilegível não pode perder os outros 19.
  //
  //    O `modelo` é decidido ANTES do laço porque a régua da linha depende
  //    dele: NFS-e não tem coluna de quantidade (ver `quantidadeValida` abaixo).
  //    Quem não é 'nfse' é 'nfe' — mesma doutrina do enum do SCHEMA.
  const modelo: 'nfe' | 'nfse' = b.modelo === 'nfse' ? 'nfse' : 'nfe'
  const ehServico = modelo === 'nfse'

  const itensBrutos = Array.isArray(b.itens) ? b.itens : []
  let itensDescartados = 0
  if (itensBrutos.length > MAX_ITENS) {
    itensDescartados += itensBrutos.length - MAX_ITENS
    console.warn(`[NotaPDF] ${itensBrutos.length} itens lidos — cortando em ${MAX_ITENS}.`)
  }

  const itens: ItemNotaLido[] = []
  for (const cru of itensBrutos.slice(0, MAX_ITENS)) {
    const i = (cru ?? {}) as Record<string, unknown>
    const descricao  = texto(i.descricao)
    const quantidade = numeroFinito(i.quantidade)
    const total      = numeroFinito(i.valorTotal)

    // Uma NFS-e NÃO TEM as colunas QUANT/UN/V.UNIT do DANFE — tem um parágrafo
    // de "Discriminação dos Serviços" e um valor. `quantidade: null` numa nota
    // de serviço é a IA acertando (não existe "quantidade" de licença de
    // software), não falhando. Exigir quantidade ali recusava a nota inteira
    // com 'sem-itens' e a tela mentia "não consegui ler nenhum item" — medido
    // em 27/08/2026 com a NFS-e real da MAQNELSON (licença, R$ 4.370), cujo
    // JSON cru está preso em notaPdf.test.ts.
    //
    // Numa DANFE (`modelo: 'nfe'`) a exigência CONTINUA de pé, e é de propósito:
    // ali a quantidade é o que entra no galpão, e um "1" inventado tiraria
    // mercadoria real do controle sem ninguém ver. A folga vale só onde a
    // coluna não existe no papel.
    const quantidadeValida = quantidade !== null && quantidade > 0 && quantidade < QUANTIDADE_MAX

    // Numa DANFE, quantidade ausente é recusa — inclusive quando o `null` está
    // voltando do navegador no passo 2 porque o dono corrigiu o campo "Tipo"
    // de NFS-e para NF-e. Cair aqui devolve o item para `itensDescartados`.
    if (!descricao
      || total === null || total < 0 || total > VALOR_MAX_ITEM
      || (!ehServico && !quantidadeValida)) {
      itensDescartados++
      continue
    }

    const unidade      = texto(i.unidade) ?? 'un'

    // Serviço sem quantidade impressa vira "1 un", igual ao que parseXmlNFSe
    // (nfeProcessor.ts) monta quando a MESMA nota chega por XML — os dois
    // caminhos precisam produzir o mesmo item. Quantidade IMPRESSA e legível
    // ("3 x hora técnica") é preservada: copiar o papel vence inventar, mesma
    // doutrina do CFOP.
    const quantidadeFinal = quantidadeValida ? quantidade : null   // null só sobrevive em NFS-e

    // ── O valor unitário e a invariante `quantidade × unitário === total` ────
    //
    // Por que a invariante importa: a tela Financeiro RECALCULA
    // `valor_total = quantidade × valor_unitario` ao salvar um item
    // (web/app/(app)/financeiro/page.tsx, `handleEdit`). Toda linha que sai
    // daqui violando a invariante é um gasto que muda sozinho no primeiro
    // clique — inclusive quando o dono só queria trocar o CENTRO DE CUSTO, que
    // é a razão de aquele campo existir.
    //
    // O unitário é SEMPRE derivado do total, e essa foi a 4ª tentativa. Todas
    // as anteriores foram achados do Apolo, todas medidas:
    //   2ª rodada: preservava o unitário lido → {q:1, vu:200, vt:600}.
    //   4ª rodada: fabricava `0` para o ilegível → {q:3, vu:0, vt:6000}.
    //   5ª rodada: aceitava qualquer POSITIVO → {q:3, vu:200, vt:6000} passava,
    //              e {q:5, vu:880, vt:0} criava R$ 4.400 do nada.
    //   6ª rodada: aceitava o lido dentro de 0,1% do total. Parecia apertado, e
    //              não era: 0,1% é um ORÇAMENTO DE DERIVA que o `handleEdit`
    //              materializa depois — R$ 490 medidos numa linha de R$ 500 mil,
    //              e até ~R$ 2.000 no teto de VALOR_MAX_ITEM.
    //
    // Derivar sempre limita a deriva ao arredondamento da coluna —
    // `quantidade × 0,00005`, uma FÓRMULA e não um número, porque número em
    // comentário apodrece: a 1ª versão deste texto dizia "R$ 0,05" e só valia
    // para quantidade ~1.000. Nas quantidades reais deste projeto (46.000 kg de
    // adubo, 466.000 kg da SYAGRI) dá alguns reais, não centavos — ainda assim
    // duas ordens de grandeza abaixo da régua anterior. E não se perde nada: o
    // unitário lido não alimenta nenhuma
    // outra conta — `converterParaNFeData` só o repassa, e quem soma dinheiro é
    // o TOTAL, que é o número que a nota fiscal afirma.
    const valorUnitario = quantidadeFinal === null
      ? total                                   // NFS-e: quantidade vira 1 na conversão
      : total / quantidadeFinal

    // Duas bordas do `numeric(12,4)` da coluna, as duas derrubando a LINHA em
    // vez de a nota inteira, e as duas CONTADAS para o dono ver:
    //
    // 1. ACIMA DO TETO: `{q: 0.001, vt: 2.000.000}` deriva 2 bilhões. Gravar
    //    mataria o INSERT e levaria a nota inteira junto (achado [baixo] do
    //    Apolo, 5ª rodada).
    //
    // 2. ARREDONDAMENTO QUE MEXE NO DINHEIRO: `{q: 700.000, vt: 100}` deriva
    //    0,00014285…; a coluna guarda 0,0001, e o `handleEdit` do Financeiro
    //    refaz o total como R$ 70 — 30% a menos (achado [baixo] do Apolo, 6ª
    //    rodada). A régua não é o VALOR do unitário, é o EFEITO do
    //    arredondamento: simula o que a coluna vai guardar e mede quanto o
    //    total se move. Linha que a coluna não consegue representar sem mexer
    //    no dinheiro é leitura errada, não compra.
    //    O `handleEdit` multiplica os DOIS valores já arredondados pelo banco:
    //    `valor_unitario` é numeric(12,4) e `quantidade` é numeric(12,3). A 1ª
    //    versão desta guarda simulava só metade do INSERT, e uma linha de
    //    `q = 0,0005` passava com o total dobrando depois — achado [médio] do
    //    Apolo, 7ª rodada (27/08/2026).
    const unitarioNaColuna   = Math.round(valorUnitario * 10_000) / 10_000
    const quantidadeNaColuna = quantidadeFinal === null ? null : Math.round(quantidadeFinal * 1_000) / 1_000
    const derivaDaColuna = quantidadeNaColuna === null
      ? 0
      : Math.abs(unitarioNaColuna * quantidadeNaColuna - total)
    if (valorUnitario > VALOR_MAX_UNITARIO || derivaDaColuna > Math.max(0.02, total * 0.001)) {
      itensDescartados++
      continue
    }

    itens.push({
      descricao,
      quantidade: quantidadeFinal,
      unidade,
      valorUnitario,
      valorTotal:    total,
      // O DANFE imprime uma quantidade só — não existe qTrib/uTrib no papel.
      // Espelhar as comerciais faz processarNFe pular a conversão de unidade
      // comercial (ele exige uTrib DIFERENTE de uCom para converter).
      quantidadeTrib: quantidadeFinal,
      unidadeTrib:    unidade,
      ncm:  codigoDeNDigitos(i.ncm, 8),
      cfop: codigoDeNDigitos(i.cfop, 4),
      // Texto livre, igual à coluna do banco (migration 013 de
      // api/src/database/migrations) — o dropdown da tela mistura categoria
      // agrícola com categoria de cartão, e um CHECK aqui recriaria o bug de
      // "não salva em silêncio". Cortado em 40 para não virar entrada de texto
      // arbitrário vinda do navegador.
      centroCusto: (texto(i.centroCusto) ?? '').slice(0, 40),
    })
  }

  if (itens.length === 0) return { status: 'sem-itens' }

  // 4. Duplicatas — nunca derrubam a nota. Vencimento ilegível vira null (caso
  //    ERCAL, medido em 31/07/2026): duplicataEhReal já sabe tratar isso, e
  //    sumir com a linha esconderia uma cobrança real.
  const dupsBrutas = Array.isArray(b.duplicatas) ? b.duplicatas : []
  let duplicatasDescartadas = 0
  if (dupsBrutas.length > MAX_DUPLICATAS) {
    duplicatasDescartadas += dupsBrutas.length - MAX_DUPLICATAS
    console.warn(`[NotaPDF] ${dupsBrutas.length} duplicatas lidas — cortando em ${MAX_DUPLICATAS}.`)
  }

  const duplicatas: DuplicataLida[] = dupsBrutas.slice(0, MAX_DUPLICATAS).map(cru => {
    const d = (cru ?? {}) as Record<string, unknown>
    const valor = numeroFinito(d.valor)
    return {
      numero:     texto(d.numero) ?? '',
      vencimento: dataNaJanela(d.vencimento, hojeISO, DIAS_PASSADO_MAX, DIAS_VENCIMENTO_FUTURO_MAX),
      valor:      valor !== null && valor > 0 && valor <= VALOR_MAX_NOTA ? valor : null,
    }
  })

  return {
    status: 'nota',
    nota: {
      modelo,
      numero,
      // Nome ilegível não derruba a nota: quem identifica é o CNPJ. Recusar
      // por causa do nome seria perder uma nota real por detalhe cosmético.
      emitenteNome: texto(b.emitenteNome) ?? 'Fornecedor não identificado',
      emitenteCnpj: cnpj,
      dataEmissao,
      valorTotal,
      formaPagamento: tPagNormalizado(b.formaPagamento),
      formaPagamentoLido: texto(b.formaPagamento),
      duplicatas,
      itens,
    },
    itensDescartados,
    duplicatasDescartadas,
  }
}

// Tradução pura para o formato que processarNFe consome. Sem I/O, sem banco —
// é o ponto exato onde o mundo do PDF encontra o mundo do XML.
export function converterParaNFeData(nota: NotaLidaDoPdf): NFeData {
  const items: NFeItem[] = nota.itens.map(i => ({
    description:  i.descricao,
    quantity:     i.quantidade ?? 1,
    unit:         i.unidade,
    unitValue:    i.valorUnitario,
    totalValue:   i.valorTotal,
    quantityTrib: i.quantidadeTrib ?? 1,
    unitTrib:     i.unidadeTrib,
    // NFS-e sai daqui SEMPRE com ncm e cfop vazios, como `parseXmlNFSe` já
    // fazia — e a quantidade que o papel não trouxe vira 1 aqui, nunca antes.
    //
    // Quem faz o trabalho é o CFOP. O `ncm: ''` é simetria com o parser de XML,
    // não defesa: o NCM não é gravado em coluna nenhuma, e seu único consumidor
    // (`fronteiraPorNCM`) já é curto-circuitado por `servico: true` em
    // processarNFe. Não conte com ele para proteger nada — achado [baixo] do
    // Apolo, 3ª rodada (27/08/2026).
    //
    // Achado [alto] do Apolo (27/08/2026), medido: `servico: true` protege o
    // ESTOQUE, não o DINHEIRO. `processarNFe` roda `efeitoDoCfop` em TODOS os
    // itens sem olhar `servico` (nfeProcessor.ts, `efeitosDosItens`), então um
    // CFOP que a IA inventasse numa nota de serviço — 5910 "bonificação", 5117
    // "entrega de pedido já faturado", 5905 "remessa sem compra" — zerava o
    // `valorCompra` e a nota era gravada SEM lançamento nenhum: o gasto
    // evaporava calado. E a IA inventa CFOP com frequência medida (memória
    // `cfop-lido-como-5922`: 3 de 4 notas por PDF).
    //
    // Zerar AQUI e não em `validarNotaLida` é de propósito: a tela de
    // conferência continua enxergando o código que a IA leu (`cfopLido`), que é
    // a pista de que uma nota de PRODUTO pode ter sido rotulada como serviço.
    // Neutraliza o efeito sem apagar a evidência.
    ncm:          nota.modelo === 'nfse' ? '' : i.ncm,
    cfop:         nota.modelo === 'nfse' ? '' : i.cfop,
    // undefined quando o dono não escolheu: processarNFe grava null e a tela
    // Financeiro segue derivando de insumos.tipo, como sempre fez.
    ...(i.centroCusto ? { centroCusto: i.centroCusto } : {}),
    // `servico: true` vence a cascata de estoque sem consultar a IA de
    // categorização — mesma trava que parseXmlNFSe usa. Serviço nunca é
    // estocável, ponto final.
    ...(nota.modelo === 'nfse' ? { servico: true } : {}),
  }))

  const duplicatas: NFeDuplicata[] = nota.duplicatas.map(d => ({
    numero:     d.numero,
    vencimento: d.vencimento,
    valor:      d.valor,
  }))

  return {
    numero:         nota.numero,
    dataEmissao:    nota.dataEmissao,
    emitenteNome:   nota.emitenteNome,
    emitenteCnpj:   nota.emitenteCnpj,
    valorTotal:     nota.valorTotal,
    items,
    duplicatas,
    formaPagamento: nota.formaPagamento,
    modelo:         nota.modelo,
  }
}

export async function lerNotaPdf(
  pdf: Buffer,
  nomeArquivo: string,
  hojeISO: string,
  anthropic: Anthropic,
): Promise<ResultadoLeituraNota> {
  if (pdf.length > LIMITE_MB * 1024 * 1024) {
    console.log(`[NotaPDF] "${nomeArquivo}" tem ${(pdf.length / 1024 / 1024).toFixed(1)} MB — acima do limite.`)
    return { status: 'grande-demais' }
  }

  try {
    // `.stream().finalMessage()` e não `.create()`: com max_tokens alto o SDK
    // RECUSA rodar sem streaming e lança antes mesmo da chamada de rede
    // ("Streaming is required for operations that may take longer than 10
    // minutes") — medido ao vivo em 18/08/2026 no leitor irmão, fora dos
    // testes, porque a suíte mocka a IA. 200 itens × ~180 bytes de JSON por
    // linha ≈ 36.000 caracteres: 32.000 tokens dão folga.
    const resposta = await anthropic.messages.stream({
      model:      MODELO,
      max_tokens: 32000,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
          { type: 'text', text: INSTRUCAO },
        ],
      }],
    }).finalMessage()

    if (resposta.stop_reason === 'max_tokens') {
      return { status: 'falha', motivo: 'resposta truncada (max_tokens)' }
    }

    const bloco = resposta.content.find(b => b.type === 'text')
    if (!bloco || bloco.type !== 'text') {
      return { status: 'falha', motivo: 'resposta sem bloco de texto' }
    }

    let bruto: unknown
    try {
      bruto = JSON.parse(bloco.text)
    } catch {
      return { status: 'falha', motivo: 'resposta não é JSON válido' }
    }

    // `ehNotaFiscal` é conclusão sobre o ARQUIVO, não sobre os dados — por isso
    // é decidida aqui e não dentro de validarNotaLida, que só cuida do conteúdo
    // e é reusada no passo 2, quando o dono confirma o que editou.
    if ((bruto as Record<string, unknown>)?.ehNotaFiscal !== true) {
      return { status: 'nao-nota' }
    }

    return validarNotaLida(bruto, hojeISO)
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'erro desconhecido'
    console.error(`[NotaPDF] Falha ao ler "${nomeArquivo}":`, motivo)
    return { status: 'falha', motivo }
  }
}
