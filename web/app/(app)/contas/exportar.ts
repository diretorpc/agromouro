// Regras da exportação da tabela de Contas a Pagar para Excel.
//
// Mora FORA do `page.tsx` pelo mesmo motivo de `cartoes/exportar.ts`: aqui é
// lógica pura (o que vira linha, com que conteúdo, com que nome de arquivo) e
// dá pra testar sem montar componente nenhum. O `page.tsx` só chama.
//
// FORMATO: LIVRO CAIXA. Desde 01/09/2026 este arquivo NÃO desenha mais colunas
// próprias — ele preenche as 18 colunas do modelo de extrato que o Matheus
// mandou, para o arquivo colar direto na planilha do contador. O desenho das
// colunas, os estilos e o XML moram em `lib/xlsx-livro-caixa.ts`; o spec e o
// modelo original em `docs/superpowers/specs/2026-09-01-contas-livro-caixa-*`.
//
// O QUE SE PERDEU NA TROCA, e por decisão explícita do dono:
//   · o rodapé de TOTAL CONFIRMADO / TOTAL ESTIMADO;
//   · a frase que descrevia o recorte dos filtros dentro do arquivo;
//   · a coluna "Estimado" (o crachá âmbar da tela).
// O modelo não tem rodapé nem coluna para nada disso, e qualquer um dos três
// quebraria a colagem numa planilha mestre. Os achados 1, 2 e 5 do Apolo
// (31/08/2026) que criaram essas três coisas continuam válidos — a resposta a
// eles mudou de lugar, não sumiu: ver `contasExportaveis` logo abaixo e o
// aviso na tela, em `page.tsx`.

import { categoriaLabel } from '@/lib/centro-custo'
import type { LinhaLivroCaixa } from '@/lib/xlsx-livro-caixa'
import type { FiltroStatus, FiltroTipo } from './filtros'
import type { ContaAPI } from './tipos'

// A data no banco é 'AAAA-MM-DD' (só o dia, sem hora) — `data_pagamento` é
// coluna `DATE` em `004_contas_a_pagar.sql`, não `timestamptz`, e é por isso
// que a concatenação abaixo funciona. Virar Date às 12h LOCAIS de propósito:
// `new Date('2026-08-01')` é meia-noite UTC, que no Brasil (UTC-3) é 31/07 às
// 21h — o dia 1º sairia como último dia do mês anterior na planilha. Mesmo
// cuidado do `fmtDate` da tela.
//
// SE A COLUNA VIRAR TIMESTAMP, isto quebra CALADO: o valor chega
// '2026-08-01T00:00:00+00:00', a concatenação vira lixo, `Date` dá
// `Invalid Date` e a linha sai com DIA/MÊS/ANO em branco — sem erro em lugar
// nenhum. É aqui que se mexe.
function dataDoBanco(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Quais contas entram no arquivo: **só as PAGAS**.
 *
 * Decisão do Matheus em 01/09/2026, depois da 1ª revisão do Apolo. Livro caixa
 * registra dinheiro que SAIU — e o formato do modelo não tem coluna de status,
 * então uma conta em aberto entrava com valor cheio, sinal negativo e "D" de
 * débito, indistinguível de um pagamento feito. Só a data ficava em branco, e
 * data em branco não grita. Medido na tela em 01/09/2026: com o filtro padrão,
 * as 7 linhas do arquivo eram TODAS de conta ainda não paga.
 *
 * `status === 'paga'` sozinho já resolve três coisas que antes eram regra
 * separada:
 *   · conta DISPENSADA (decisão de não pagar) nunca é 'paga';
 *   · conta em aberto, aguardando ou atrasada também não;
 *   · `POST /contas/:id/pagar` grava `valor_estimado: false` junto com o
 *     status (`api/src/routes/contas.ts`), então conta paga não é estimada.
 *
 * O `!valor_estimado` fica como CINTO DE SEGURANÇA para linha antiga, gravada
 * antes daquela regra existir: uma conta 'paga' com estimativa sairia como
 * número duro num arquivo que o contador lança como fato. Se ela aparecer, o
 * aviso da tela conta — não some calada.
 *
 * O PREÇO é que o arquivo passa a mentir por OMISSÃO: some conta do relatório
 * e a planilha não tem onde avisar. Por isso os avisos são obrigação da TELA
 * (`avisosDoArquivo` logo abaixo, renderizado em `page.tsx`), último ponto
 * antes do arquivo virar anexo de e-mail.
 */
export function contasExportaveis(contas: ContaAPI[]): ContaAPI[] {
  return contas.filter(c => c.status === 'paga' && !c.valor_estimado)
}

/**
 * As frases que a tela precisa mostrar ao lado do botão.
 *
 * MORAM AQUI, e não soltas no JSX, porque são a ÚNICA defesa contra o arquivo
 * omitir e distorcer em silêncio — e JSX não tem teste neste projeto (`web/`
 * roda vitest em ambiente `node`, sem jsdom, por decisão registrada no
 * `vitest.config.mts`). Solto no `page.tsx`, um refactor de layout apagaria o
 * parágrafo e os 491 testes seguiriam verdes. Achado 6 do Apolo.
 *
 * Devolve lista vazia quando não há nada a avisar: um aviso permanente treina
 * quem lê a ignorar o âmbar, e aí o dia em que ele importa passa batido.
 */
export function avisosDoArquivo(contas: ContaAPI[], filtroStatus: FiltroStatus): string[] {
  const avisos: string[] = []

  // O MAIS TRAIÇOEIRO VEM PRIMEIRO, e é o único que não tem número: a aba
  // "Todas" esconde conta paga há mais de 30 dias (`contaBateFiltro` em
  // `filtros.ts`). Isso era detalhe enquanto o arquivo levava conta em aberto;
  // agora que ele é SÓ pagamento, é dinheiro que saiu de verdade e não aparece
  // em lugar nenhum — nem na tela, nem no arquivo, nem numa contagem. Exportar
  // o mês fechado pela aba errada devolve um livro caixa furado.
  if (filtroStatus === 'todas') {
    avisos.push(
      'A aba "Todas" esconde pagamento com mais de 30 dias, e o que ela esconde também' +
      ' fica de fora do arquivo. Para o mês fechado, exporte pela aba "Pagas" — essa não' +
      ' tem limite de data.',
    )
  }

  // As três contagens abaixo são DISJUNTAS por construção e, somadas, dão
  // exatamente o que o filtro achou menos o que o arquivo leva. Toda conta é
  // dispensada, ou não-paga-nem-dispensada, ou paga.
  const naoPagas = contas.filter(c => c.status !== 'paga' && c.status !== 'dispensada').length
  if (naoPagas > 0) {
    avisos.push(
      plural(
        naoPagas,
        'conta deste recorte não entra no arquivo porque ainda não foi paga',
        'contas deste recorte não entram no arquivo porque ainda não foram pagas',
      ) +
      ' — livro caixa registra dinheiro que saiu, e o formato não tem coluna de status' +
      ' onde marcar "a pagar".',
    )
  }

  // Separada da anterior porque o motivo é OUTRO e o dono lê diferente:
  // dispensar é a decisão de não pagar, não uma pendência.
  const dispensadas = contas.filter(c => c.status === 'dispensada').length
  if (dispensadas > 0) {
    avisos.push(
      plural(
        dispensadas,
        'conta dispensada não entra no arquivo',
        'contas dispensadas não entram no arquivo',
      ) +
      ' — dispensar é decidir NÃO pagar.',
    )
  }

  // Quase inalcançável: pagar grava `valor_estimado: false` junto com o status.
  // Só linha antiga cai aqui — e é justamente por ser rara que precisa de
  // aviso: uma conta some do arquivo e nada mais no sistema comenta.
  const pagasEstimadas = contas.filter(c => c.status === 'paga' && c.valor_estimado).length
  if (pagasEstimadas > 0) {
    avisos.push(
      plural(
        pagasEstimadas,
        'conta paga tem valor ESTIMADO e não entra no arquivo',
        'contas pagas têm valor ESTIMADO e não entram no arquivo',
      ) +
      ' — o formato não tem onde marcar palpite. Registre o valor real.',
    )
  }

  // ESTE é sobre o que o arquivo LEVA, não sobre o que ele omite. Também quase
  // inalcançável (a rota de pagar sempre grava a data), mas se acontecer a
  // linha sai com DIA, MÊS e ANO em branco no meio de um livro cronológico.
  const semData = contasExportaveis(contas).filter(c => !c.data_pagamento).length
  if (semData > 0) {
    avisos.push(
      plural(
        semData,
        'conta do arquivo está paga mas sem data de pagamento: sai com DIA, MÊS e ANO em branco',
        'contas do arquivo estão pagas mas sem data de pagamento: saem com DIA, MÊS e ANO em branco',
      ) + '.',
    )
  }

  return avisos
}

/**
 * A FRASE INTEIRA concorda em número, não só o primeiro verbo.
 *
 * Foi assim que o defeito nasceu: a 1ª versão passava só "N conta(s)" por aqui
 * e grudava um sufixo fixo, produzindo "2 contas ... e não ENTRA no arquivo".
 * Consertei num aviso e deixei o mesmo erro nos outros dois — achado 2 da 2ª
 * rodada. Por isso `um` e `varios` recebem a oração toda; o que sobra do lado
 * de fora não pode ter verbo nem substantivo que concorde.
 *
 * `toLocaleString` porque o número chega a quatro dígitos: `pareceTruncado`
 * desconfia justamente de 1.000 linhas carregadas, e "1000 contas" no meio de
 * uma tela que escreve "R$ 1.099,22" é descuido visível.
 */
function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
}

/**
 * A coluna HISTÓRICO do modelo é a linha do extrato — no banco viria
 * "TED Transf.Eletr.Disponiv - 237 3857 ... MARCIA DIB MOURO". O mais próximo
 * que temos é fornecedor + descrição.
 *
 * A PARCELA entra aqui, no fim, entre parênteses. Ela tinha coluna própria na
 * exportação antiga e o modelo não tem onde pôr — mas sem ela duas parcelas do
 * mesmo contrato, mesmo fornecedor e mesmo valor viram duas linhas idênticas, e
 * quem confere não sabe se é parcela 2 ou lançamento em duplicidade. Número de
 * parcela é parte da descrição da transação, não anotação — por isso vai no
 * HISTÓRICO e não em OBS.
 *
 * SÓ a partir de duas parcelas. Boleto de nota comum nasce com
 * `numero_parcela = 1, total_parcelas = 1` (visto em produção em 01/09/2026,
 * na conta da HIGA), e "(1/1)" no fim de toda linha é ruído — e ruído treina
 * quem lê a ignorar o parêntese que IMPORTA, o "(2/3)".
 *
 * E SÓ SE A DESCRIÇÃO AINDA NÃO TIVER. Os dois lugares que criam parcela já
 * gravam o sufixo dentro da própria `descricao`:
 * `deNotaFiscal.ts` (`total > 1 ? \`${base} (${i + 1}/${total})\` : base`) e
 * `parcelamento.ts`. Sem esta guarda, toda conta de NF-e parcelada — o caso
 * mais comum do sistema — saía no arquivo do contador como
 * "MIKAMI - DIESEL S10 (1/3) (1/3)", que é exatamente a cara de lançamento
 * duplicado que este código existe para evitar. Achado 1 da 2ª rodada do Apolo.
 */
export function historicoDaConta(c: ContaAPI): string | null {
  const partes = [c.fornecedor, c.descricao]
    .map(t => (typeof t === 'string' ? t.trim() : ''))
    .filter(t => t !== '')
  let texto = partes.join(' - ')
  if (c.numero_parcela && c.total_parcelas && c.total_parcelas > 1) {
    const sufixo = `(${c.numero_parcela}/${c.total_parcelas})`
    if (texto === '') {
      texto = `Parcela ${c.numero_parcela}/${c.total_parcelas}`
    } else if (!texto.endsWith(sufixo)) {
      texto = `${texto} ${sufixo}`
    }
  }
  return texto === '' ? null : texto
}

/**
 * O rótulo da coluna TRANSAÇÃO.
 *
 * `categoriaLabel` devolve o valor CRU quando não conhece a categoria — e o
 * caso mais comum do sistema cai exatamente aí: **toda** conta nascida de
 * boleto de NF-e grava `categoria: 'insumos'`
 * (`api/src/services/contas/gravarDeNota.ts`), e `'insumos'` não está em
 * `CATEGORIAS_FINANCEIRAS`. Sem esta função, a coluna sai "insumos" em
 * minúscula no meio de "Combustível" e "Manutenção" — num arquivo que vai
 * para o contador.
 *
 * O conserto mora AQUI e não no `categoriaLabel`, que é compartilhado com a
 * tela do Financeiro: consertar lá mudaria gráfico e crachá de outra tela sem
 * ninguém ter pedido. A dívida de verdade (três listas de categoria que não se
 * conhecem) está registrada no cabeçalho de `lib/centro-custo.ts`.
 */
export function rotuloTransacao(categoria: string | null): string | null {
  if (!categoria) return null
  const label = categoriaLabel(categoria)
  // Rótulo conhecido já vem bonito ('Combustível'). Só o cru precisa de banho.
  if (label !== categoria) return label
  const legivel = categoria.replace(/_/g, ' ')
  return legivel.charAt(0).toUpperCase() + legivel.slice(1)
}

/**
 * Cronológica pela data do pagamento, sem data no fim.
 *
 * Compara as STRINGS 'AAAA-MM-DD', que ordenam igual à data por serem de
 * tamanho fixo e zero à esquerda — sem `Date`, sem fuso, sem chance de
 * escorregar. Empate mantém a ordem que chegou (`sort` do V8 é estável desde o
 * Node 11), então duas contas do mesmo dia saem na ordem da tela.
 *
 * COPIA antes de ordenar: `sort` mexe no array original, e quem chama passa
 * `contasFiltradas`, que é estado do React — ordenar no lugar re-renderizaria a
 * tabela na ordem do ARQUIVO no meio de um clique de exportar.
 *
 * EXPORTADA só para o teste alcançá-la com o array cru. Chamada por
 * `linhasLivroCaixa` sempre depois do `.filter()` de `contasExportaveis`, que
 * já devolve array novo — então hoje a cópia é cinto de segurança, e um teste
 * feito através de `linhasLivroCaixa` passaria mesmo sem ela (achado 4 da 2ª
 * rodada do Apolo: mutante sobrevivente). Testada direto, a cópia tem guarda.
 */
export function ordenarPorData(contas: ContaAPI[]): ContaAPI[] {
  return [...contas].sort((a, b) => {
    const da = a.data_pagamento ?? ''
    const db = b.data_pagamento ?? ''
    if (da === db) return 0
    if (da === '') return 1  // sem data vai pro fim
    if (db === '') return -1
    return da < db ? -1 : 1
  })
}

/**
 * Uma conta a pagar vira uma linha do livro caixa.
 *
 * 7 das 18 colunas ficam vazias porque o sistema não tem esse dado: BANCO, AG,
 * CC (a conta bancária de onde o dinheiro saiu), DEPENDÊNCIA ORIGEM (a forma
 * de pagamento — Pix, cartão, TED), TERCEIRO, IMÓVEL e INSCRIÇÃO IMÓVEL. É
 * fiel ao modelo, que traz TERCEIRO, IMÓVEL e INSCRIÇÃO IMÓVEL vazias nas
 * quatro linhas de exemplo. Omitidas por ausência de fonte, não por
 * esquecimento — quando o dado existir, é uma linha aqui.
 *
 * ORDENADAS POR DATA, e não na ordem da tela. Livro caixa é documento
 * cronológico, e a tela ordena por vencimento (ou pelo que o dono tiver
 * clicado no cabeçalho da tabela — fornecedor, valor, categoria...). Duas
 * contas que vencem 05/08 e 10/08 podem ter sido pagas 20/08 e 06/08: herdar a
 * ordem da tela punha 20/08 antes de 06/08 no arquivo. E um clique em
 * "Fornecedor", que parecia ser só sobre a tela, sairia como ordem alfabética
 * no livro caixa. Achado 3 do Apolo. Sem data vai para o fim.
 */
export function linhasLivroCaixa(contas: ContaAPI[], fazenda: string | null): LinhaLivroCaixa[] {
  // Maiúsculo porque `codigo` vem minúsculo do banco. O modelo usa códigos de
  // DUAS LETRAS ('MG', 'TJ') e os nossos hoje batem ('mg', 'sp', 'mt' — ver
  // `001_multi_fazenda.sql`). Uma fazenda futura com código longo sairia
  // 'TEJUCO' onde o contador filtra 'TJ': centro de custo novo criado em
  // silêncio na planilha mestre. Se isso acontecer, o conserto é uma tabela de
  // apelidos aqui, não um `slice(0,2)`.
  const centroCusto = fazenda ? fazenda.toUpperCase() : null

  return ordenarPorData(contasExportaveis(contas)).map(c => ({
    // DIA / MÊS / ANO saem da DATA DO PAGAMENTO — é livro CAIXA, registra
    // quando o dinheiro saiu, não quando venceria. Conta ainda não paga sai com
    // as três colunas em branco: consequência aceita da decisão de 01/09/2026.
    data: dataDoBanco(c.data_pagamento),
    historico: historicoDaConta(c),
    // Literal: isto é Contas a PAGAR. Não existe receita nesta tela, e é este
    // texto que o contador usa para separar as duas metades do livro.
    custoOuReceita: 'Custo',
    transacao: rotuloTransacao(c.categoria),
    // Texto, e não número: nota fiscal com zero à esquerda perderia o zero.
    numeroDocumento: c.notas_fiscais?.numero ?? null,
    // NEGATIVO. No modelo, custo é negativo (-720,15) e é o SINAL que faz a
    // coluna C/D calcular "D" de débito. `Math.abs` antes do menos porque a
    // origem sempre grava positivo — se um dia gravar negativo, o resultado
    // aqui não muda.
    valor: c.valor === null ? null : -Math.abs(c.valor),
    centroCusto,
    observacao: c.observacao,
  }))
}

// ─── Truncamento ──────────────────────────────────────────────────────────────

// GET /contas não tem `.limit()`, mas o PostgREST do Supabase pode ter um teto
// próprio (`db-max-rows`) que corta a resposta SEM avisar — nenhum erro,
// nenhum campo de "tem mais". A única pista disponível hoje é o total voltar
// num número redondo suspeito.
//
// ISTO É SUSPEITA, NÃO FATO. Uma medição parcial existe desde 31/08/2026: uma
// consulta a `lancamentos_financeiros` devolveu 594 de 594 linhas
// (`Content-Range: 0-593/594`), então o teto real é **pelo menos 594** — a
// hipótese "pode ser 500" morreu. Onde ele está de verdade continua sem
// resposta, e 1.000 segue sendo palpite.
//
// Para medir você mesmo, sem depender desta linha:
//   curl -sI -H "Range: 0-" "$SUPABASE_URL/rest/v1/<tabela>?select=id" \
//     -H "apikey: $SUPABASE_SERVICE_KEY" | grep -i content-range
//
// O conserto de verdade é a rota devolver `count: 'exact'`, como a tela de
// Cartões já faz consultando o Supabase direto (cartoes/page.tsx). Até lá, o
// mínimo honesto é: marcar o nome do arquivo e avisar na tela.
const TETOS_SUSPEITOS = new Set([1000, 10000])

export function pareceTruncado(total: number): boolean {
  return TETOS_SUSPEITOS.has(total)
}

// ─── Nome do arquivo ──────────────────────────────────────────────────────────

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    // Faixa das marcas de acento que o NFD separa da letra. Declarada por
    // CODIGO e nunca como caractere literal: acento solto e invisivel na
    // revisao e some numa copia -- mesma licao do NBSP em `lib/numeros-br.ts`
    // (por isso este comentario esta sem acento nenhum).
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Rótulo curto de cada filtro no nome do arquivo. "paga" vira "pagas" porque o
// arquivo tem várias contas, não uma. Filtro desconhecido cai no próprio nome
// em vez de sumir — nome estranho é melhor que dois arquivos diferentes com o
// mesmo nome.
const SLUG_STATUS: Record<string, string> = {
  todas: 'todas',
  'sem-vencimento': 'sem-vencimento',
  aguardando: 'aguardando',
  aberta: 'abertas',
  atrasada: 'atrasadas',
  paga: 'pagas',
  dispensada: 'dispensadas',
}

const SLUG_TIPO: Record<string, string> = {
  fixas: 'fixas',
  nota: 'boletos',
}

export type ContextoNome = {
  filtroStatus: FiltroStatus
  filtroTipo: FiltroTipo
  filtroMes: string
  /** Código da fazenda ativa. Dimensão que mais muda os números. */
  fazenda: string | null
  /** `true` quando a lista carregada PODE ser só um pedaço — ver `pareceTruncado`. */
  parcial: boolean
}

/**
 * Nome do arquivo baixado. Carrega fazenda, filtros e o aviso de parcial,
 * senão três exports seguidos viram `contas.xlsx`, `contas (1).xlsx`,
 * `contas (2).xlsx` na pasta de Downloads e ninguém sabe qual é qual depois.
 *
 * Começa com `livro-caixa` desde 01/09/2026: o conteúdo mudou de formato, e um
 * arquivo novo com nome velho se confunde com os antigos já salvos na pasta.
 *
 * A fazenda entra logo em seguida: em multi-fazenda, exportar sem filtro na MG
 * e depois na Tejuco daria dois arquivos de nome idêntico e conteúdo
 * completamente diferente. Ela é omitida quando `fazenda` vem nulo — quem
 * chama é responsável por só exportar com a fazenda já carregada, e a tela faz
 * isso mantendo o botão desabilitado até lá.
 *
 * O nome NÃO conta o recorte inteiro, e agora não conta MESMO: a frase que
 * descrevia os filtros DENTRO do arquivo morreu junto com o rodapé. Quem
 * precisar saber o recorte exato tem que perguntar a quem exportou.
 */
export function nomeArquivoExport(ctx: ContextoNome): string {
  const partes = ['livro-caixa']
  const fazenda = ctx.fazenda ? semAcento(ctx.fazenda) : ''
  if (fazenda) partes.push(fazenda)
  if (ctx.parcial) partes.push('parcial')
  partes.push(SLUG_STATUS[ctx.filtroStatus] ?? semAcento(ctx.filtroStatus))
  const tipo = SLUG_TIPO[ctx.filtroTipo]
  if (tipo) partes.push(tipo)
  partes.push(ctx.filtroMes === 'todos' ? 'tudo' : ctx.filtroMes)
  return partes.join('-') + '.xlsx'
}
