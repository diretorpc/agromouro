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

// A data no banco é 'AAAA-MM-DD' (só o dia, sem hora). Virar Date às 12h
// LOCAIS de propósito: `new Date('2026-08-01')` é meia-noite UTC, que no
// Brasil (UTC-3) é 31/07 às 21h — o dia 1º sairia como último dia do mês
// anterior na planilha. Mesmo cuidado do `fmtDate` da tela.
function dataDoBanco(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Quais contas entram no arquivo.
 *
 * ESTIMADA FICA DE FORA. Decisão do Matheus em 01/09/2026, tomada com o custo
 * na mesa. O motivo dela: toda ocorrência de conta fixa nasce com valor
 * chutado a partir do último pagamento
 * (`api/src/services/contas/sincronizar.ts`), e no formato do livro caixa não
 * existe coluna, crachá ou rodapé onde dizer "este número é palpite". Um
 * arrendamento estimado em R$ 380.000 sairia com a mesma cara de um boleto
 * conferido, dentro de um arquivo que o contador lança como fato.
 *
 * O PREÇO disso é que o arquivo passa a mentir por OMISSÃO — some conta do
 * relatório e a planilha não tem onde avisar. Por isso o aviso é obrigação da
 * TELA, ao lado do botão (`page.tsx`), onde ainda dá para dizer em português
 * quantas contas ficaram de fora. Mexer aqui sem mexer lá reabre o buraco.
 */
export function contasExportaveis(contas: ContaAPI[]): ContaAPI[] {
  return contas.filter(c => !c.valor_estimado)
}

/** Quantas contas o filtro atual encontrou mas o arquivo NÃO vai levar. */
export function quantasEstimadas(contas: ContaAPI[]): number {
  return contas.length - contasExportaveis(contas).length
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
 */
export function historicoDaConta(c: ContaAPI): string | null {
  const partes = [c.fornecedor, c.descricao]
    .map(t => (typeof t === 'string' ? t.trim() : ''))
    .filter(t => t !== '')
  let texto = partes.join(' - ')
  if (c.numero_parcela && c.total_parcelas && c.total_parcelas > 1) {
    texto = texto === ''
      ? `Parcela ${c.numero_parcela}/${c.total_parcelas}`
      : `${texto} (${c.numero_parcela}/${c.total_parcelas})`
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
 * Uma conta a pagar vira uma linha do livro caixa.
 *
 * 7 das 18 colunas ficam vazias porque o sistema não tem esse dado: BANCO, AG,
 * CC (a conta bancária de onde o dinheiro saiu), DEPENDÊNCIA ORIGEM (a forma
 * de pagamento — Pix, cartão, TED), TERCEIRO, IMÓVEL e INSCRIÇÃO IMÓVEL. É
 * fiel ao modelo, que já traz as três últimas vazias, e o cabeçalho AMARELO
 * delas é justamente a marca de "preenche à mão". Omitidas por ausência de
 * fonte, não por esquecimento — quando o dado existir, é uma linha aqui.
 */
export function linhasLivroCaixa(contas: ContaAPI[], fazenda: string | null): LinhaLivroCaixa[] {
  // Maiúsculo: `codigo` vem minúsculo do banco, e o modelo usa 'MG' / 'TJ'.
  const centroCusto = fazenda ? fazenda.toUpperCase() : null

  return contasExportaveis(contas).map(c => ({
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
