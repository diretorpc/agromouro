// Leitura de número digitado ou colado em pt-BR. Mora em `lib/` desde
// 24/08/2026 (achado 4 da 2ª revisão do Apolo): nasceu em
// `app/(app)/controle/components/colunas-br.ts`, mas aquele arquivo importa
// `react-datasheet-grid` — usá-lo de outra tela arrastaria a biblioteca de
// planilha para dentro do bundle dela. E o terceiro parser de número no mesmo
// `web/` seria dívida garantida: o bug que ele evita já foi medido em
// produção uma vez (R$ 1.234,56 virando R$ 1,23, com 200 OK e sem erro).

// Usada tanto pra digitação direta quanto pra colar do Excel — pedido
// explícito da correção original: as duas entradas passam pela MESMA função,
// sem caminho divergente que possa ficar destreinado.
// U+00A0 declarado por CODIGO, nunca como caractere literal no fonte: um
// NBSP colado dentro de uma regex e invisivel na revisao e some em copia.
const NBSP = String.fromCharCode(160)

export function parseNumeroBR(bruto: string): number | null {
  if (bruto == null) return null
  let texto = String(bruto).trim()
  if (texto === '') return null

  // "R$ 1.234,56" — símbolo de moeda nunca impede a leitura. NBSP (espaço
  // sem quebra de linha, código U+00A0) é trocado por espaço comum ANTES do
  // `.trim()` — artefato comum de copiar valor monetário do Excel, que o
  // `.trim()` sozinho não remove (NBSP não conta como espaço em branco pro
  // JavaScript).
  texto = texto.replace(/^R\$\s*/i, '').split(NBSP).join(' ').trim()
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
