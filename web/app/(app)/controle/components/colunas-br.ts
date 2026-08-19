import { createTextColumn, isoDateColumn } from 'react-datasheet-grid'

// Colunas de número e data em pt-BR — a biblioteca `react-datasheet-grid`
// vem com `floatColumn`/`isoDateColumn` prontos, mas os dois têm bugs de
// locale/paste medidos ao vivo (achados 1 e 4 da revisão do Apolo,
// 18/08/2026):
//
// `floatColumn` EXIBE com `new Intl.NumberFormat()` sem locale (herda o
// idioma do NAVEGADOR, não do país do usuário) mas LÊ (digitação e colar)
// com `parseFloat` cru — que não entende separador de milhar nem vírgula
// decimal: `parseFloat("1.234,56")` = 1.234 (perde o "56", e ainda lê o
// ponto de milhar como decimal). Medido: R$ 1.234,56 virava R$ 1,23 com
// 200 OK, sem erro nenhum.
//
// `isoDateColumn.pasteValue` troca "/" e "." por "-" e joga no `new
// Date(...)` — que interpreta "18-08-2026" como formato AMBÍGUO (não é
// ISO), e o resultado depende de heurística do motor JS. Medido:
// "18/08/2026"→null (some) · "01/12/2025"→"2025-01-12" (1º de dezembro
// virou 12 de janeiro, calado).

// ─── Número (quantidade, valor_unitario, valor_total) ──────────────────────

// Usada tanto pra digitação direta quanto pra colar do Excel — pedido
// explícito da correção: as duas entradas passam pela MESMA função, sem
// caminho divergente que possa ficar destreinado.
export function parseNumeroBR(bruto: string): number | null {
  if (bruto == null) return null
  let texto = String(bruto).trim()
  if (texto === '') return null

  // "R$ 1.234,56" — símbolo de moeda nunca impede a leitura. NBSP (espaço
  // sem quebra de linha, código U+00A0) é trocado por espaço comum ANTES do
  // `.trim()` — artefato comum de copiar valor monetário do Excel, que o
  // `.trim()` sozinho não remove (NBSP não conta como espaço em branco pro
  // JavaScript).
  texto = texto.replace(/^R\$\s*/i, '').replace(/\u00A0/g, ' ').trim()
  if (texto === '') return null

  if (texto.includes(',')) {
    // pt-BR: '.' é separador de MILHAR, ',' é separador DECIMAL — remove os
    // pontos antes da vírgula, depois troca a vírgula por ponto (formato
    // que `parseFloat` entende).
    texto = texto.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
    // Sem vírgula, mas com ponto(s) no padrão EXATO de agrupamento de milhar
    // (ex.: "1.234", "12.345.678") — típico de colar um inteiro grande do
    // Excel em pt-BR sem casa decimal. Qualquer outro formato com ponto
    // (ex.: "44.2", vindo de teclado numérico/estilo en-US) NÃO bate nesse
    // padrão e cai direto no parseFloat abaixo, que já entende ponto como
    // decimal — sem essa distinção, "44.2" viraria 442 por engano.
    texto = texto.replace(/\./g, '')
  }

  const numero = parseFloat(texto)
  return Number.isFinite(numero) ? numero : null
}

// O que aparece no INPUT enquanto a célula está em edição — sem separador de
// milhar (mais fácil de editar, sem cursor pulando), vírgula como decimal.
// `.toString()` de um `number` em JS NUNCA insere separador de milhar, então
// o resultado é sempre reinterpretável por `parseNumeroBR` sem ambiguidade —
// fecha o ciclo focar→editar→confirmar sem risco de ler errado o que a
// própria coluna acabou de escrever.
function formatarParaEdicao(valor: number | null): string {
  return valor === null ? '' : valor.toString().replace('.', ',')
}

// O que aparece fora de foco (célula "em repouso") — com separador de
// milhar, formato brasileiro. `toLocaleString('pt-BR')` CRAVADO, nunca o
// locale do navegador (era a causa raiz do achado 1).
function formatarExibicao(valor: number | null): string {
  return valor === null ? '' : valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
}

// Sem anotação de retorno explícita: `createTextColumn<T>()` já devolve
// `Partial<Column<T, TextColumnData<T>, string>>` — forçar `unknown` no
// parâmetro de `columnData` (como as outras colunas fazem via
// `Partial<Column<ItemControleFlat, any, any>>[]` em grade-itens.tsx) só
// pra "documentar" o tipo aqui quebrava a atribuição real. Deixa o
// TypeScript inferir; quem consome (grade-itens.tsx) já usa `any` no lugar
// certo.
export function colunaNumeroBR() {
  return createTextColumn<number | null>({
    alignRight: true,
    // Confirma só ao sair da célula (Enter/Tab/clicar fora) — bate com a
    // decisão nº 1 do Matheus ("Enter salva, Tab anda pro lado"), e reduz
    // a enxurrada de onChange por tecla que agravava o achado 2 (autosave
    // perdendo edição anterior). `continuousUpdates: true` é o padrão da
    // biblioteca — aqui é sempre desligado de propósito.
    continuousUpdates: false,
    parseUserInput:    parseNumeroBR,
    parsePastedValue:  parseNumeroBR,
    formatInputOnFocus: formatarParaEdicao,
    formatBlurredInput: formatarExibicao,
    formatForCopy:       formatarExibicao,
  })
}

// ─── Texto que NUNCA vira null (descricao, unidade) ─────────────────────────
//
// Bug relatado pelo Matheus, 18/08/2026: apertar Delete numa célula de
// Produto fazia "a página recarregar e o produto voltar". Causa raiz:
// `createTextColumn` PADRÃO devolve `null` de TRÊS jeitos diferentes —
// (1) `deletedValue` (tecla Delete numa célula selecionada, sem entrar em
// edição) é `null` por padrão; (2) `parseUserInput` padrão é
// `(value) => value.trim() || null` — digitar e apagar tudo (Backspace)
// também vira `null` ao confirmar; (3) `parsePastedValue` padrão tem a
// MESMA armadilha pra colar célula vazia. `descricao` é `text not null` no
// banco (confirmado na fonte viva: api/src/database/schema.sql:100 — a
// migration 017_controle.sql nunca mexe nessa constraint); `unidade` é
// nullable no banco, mas o zod da rota (camposItemEditavel,
// controleItens.ts) exigia `.min(1)` nas DUAS, então `null` OU string vazia
// batiam 400 de qualquer jeito.
//
// Decisão do Matheus (confirmada explicitamente, risco explicado): SIM, ele
// quer poder deixar o campo vazio ("máxima liberdade, igual Excel"), mesmo
// sabendo que isso atrapalha a conferência contra a NF-e. Não usamos `null`
// pra representar "vazio" — usamos STRING VAZIA (`''`), que satisfaz o
// `not null` do banco sem precisar de migration, e mantém o TIPO
// `ItemControleFlat.descricao: string`/`unidade: string` HONESTO (nunca
// `string | null`) em vez de espalhar `?? ''` defensivo pela grade inteira.
// `camposItemEditavel.descricao`/`.unidade` (controleItens.ts) tiveram o
// `.min(1)` removido — continuam exigindo `string`, só não mais "não-vazia".
export function colunaTextoSemNulo() {
  return {
    ...createTextColumn<string>({
      continuousUpdates: false,
      deletedValue: '',
      parseUserInput:   value => value.trim(),
      parsePastedValue: value => value.replace(/[\n\r]+/g, ' ').trim(),
    }),
    // Achado 5 da revisão do Apolo (18/08/2026, 3ª rodada): `createTextColumn`
    // não expõe `isCellEmpty` como opção — é FIXO dentro do pacote como
    // `rowData === null || rowData === undefined` (dist/columns/textColumn.js).
    // `DataSheetGrid.js` só apaga a LINHA INTEIRA (tecla Delete com a linha
    // selecionada) quando TODAS as colunas concordam que a célula está
    // vazia — como esta coluna nunca devolve `null` (é o propósito dela,
    // ver comentário acima), `''` nunca batia nesse critério, e o Delete de
    // linha parou de funcionar (o menu de contexto/botão direito continuava
    // funcionando, mas o gesto natural do Excel quebrou). Sobrescrever
    // aqui — mesmo padrão que `isoDateColumn` já usa nativamente
    // (`isCellEmpty: ({rowData}) => !rowData`) — não muda nada do
    // `deleteValue`/`parseUserInput`: só ensina a grade a reconhecer ''
    // como "vazia" pra essa decisão específica.
    isCellEmpty: ({ rowData }: { rowData: string | null }) => !rowData,
  }
}

// ─── Data (data_manual) ─────────────────────────────────────────────────────

// Mesmo padrão de `dataExiste` em api/src/services/contas/datas.ts — não
// pode ser importado direto (pacote/runtime diferentes), replicado aqui
// porque é pouco código e já provado no backend: o formato bater não prova
// que a data existe (ex.: 31/02 passa no regex), Date.UTC absorve o erro
// rolando pro mês seguinte sem avisar.
function dataExisteISO(ano: number, mes: number, dia: number): boolean {
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

// Aceita os dois formatos que realmente aparecem colando de uma célula:
// "aaaa-mm-dd" (ISO — colar de outra célula desta mesma grade) e
// "dd/mm/aaaa" (o que o Excel/Google Sheets em pt-BR copiam de verdade).
// Substitui `isoDateColumn.pasteValue`, que tenta os dois com `new Date()`
// sem checagem de formato — heurística ambígua, é a causa do achado 4.
export function parseDataBR(bruto: string): string | null {
  const texto = bruto.trim()
  if (texto === '') return null

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const [, anoStr, mesStr, diaStr] = iso
    const ano = Number(anoStr), mes = Number(mesStr), dia = Number(diaStr)
    return dataExisteISO(ano, mes, dia) ? `${anoStr}-${mesStr}-${diaStr}` : null
  }

  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (br) {
    const [, diaStr, mesStr, anoStr] = br
    const dia = Number(diaStr), mes = Number(mesStr), ano = Number(anoStr)
    if (!dataExisteISO(ano, mes, dia)) return null
    return `${anoStr}-${mesStr.padStart(2, '0')}-${diaStr.padStart(2, '0')}`
  }

  return null
}

// Mesmo motivo de `colunaNumeroBR` acima: sem anotação de retorno explícita,
// deixa o TypeScript inferir a partir do próprio `isoDateColumn` espalhado.
export function colunaDataBR() {
  return {
    ...isoDateColumn,
    pasteValue: ({ value }: { value: string }) => parseDataBR(value),
  }
}
