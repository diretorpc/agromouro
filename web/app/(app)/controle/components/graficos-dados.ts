import type { FatiaGrafico, FatiaMesGrafico } from '@/lib/types'

// Funções PURAS dos gráficos de Controle — sem React, sem Recharts, sem CSS.
// Arquivo próprio pelo mesmo motivo de `deletar-linha.ts`: `web/` roda vitest
// sem jsdom de propósito (ver vitest.config.mts), então lógica que precisa de
// teste não pode morar dentro do componente.
//
// ⚠️ NENHUMA destas funções soma dinheiro do zero. Os totais chegam prontos
// da função `controle_graficos` (migration 020), que agrega no Postgres sobre
// a fazenda INTEIRA — a grade tem só 500 itens carregados. Aqui só se
// reorganiza o que o servidor já somou.

export type ResultadoAgrupamento = {
  barras: FatiaGrafico[]
  /** Quantas fatias foram dobradas dentro de "Outros". 0 = nada escondido. */
  ocultos: number
  /** Quanto dinheiro está dentro de "Outros" — a legenda precisa poder dizer. */
  valorOcultos: number
}

export const ROTULO_OUTROS = 'Outros'
export const ROTULO_SEM_PRODUTO = 'Sem produto'

// Tira o balde 'Sem produto' do RANKING antes do top-N.
//
// Achado 2 da revisão do Apolo (19/08/2026), provado por execução: com mais de
// 10 produtos e o balde pequeno (que é o caso normal — item sem nome costuma
// ser uma célula apagada, não a maior compra do ano), o 'Sem produto' caía
// dentro de "Outros". E a tela, ao mesmo tempo, escrevia "aparecem agrupados
// na barra 'Sem produto'" — mandando o Matheus procurar uma barra que não
// existe. Ele precisa VER essa barra justamente pra ir consertar as linhas.
export function separarSemProduto(fatias: FatiaGrafico[]): {
  comNome: FatiaGrafico[]
  semProduto: FatiaGrafico | null
} {
  const semProduto = fatias.find(f => f.rotulo === ROTULO_SEM_PRODUTO) ?? null
  return { comNome: fatias.filter(f => f.rotulo !== ROTULO_SEM_PRODUTO), semProduto }
}

// Achado 12: `porMes` só traz mês COM compra. Sem preencher os buracos, jan /
// mar / jul aparecem colados e com a mesma distância entre si — quem bate o
// olho lê três meses seguidos de gasto.
//
// ⚠️ Sem `Date`, de propósito (mesmo motivo de `rotuloMes`): aritmética de mês
// aqui é soma de inteiros sobre a string, que não tem fuso.
export function preencherMesesVazios(meses: FatiaMesGrafico[]): FatiaMesGrafico[] {
  const validos = meses.filter(m => /^\d{4}-\d{2}$/.test(m.mes))
  if (validos.length < 2) return [...meses]

  const ordenados = [...validos].sort((a, b) => a.mes.localeCompare(b.mes))
  const porMes = new Map(ordenados.map(m => [m.mes, m]))
  const emNumero = (mes: string) => Number(mes.slice(0, 4)) * 12 + (Number(mes.slice(5, 7)) - 1)
  const emTexto = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`

  const saida: FatiaMesGrafico[] = []
  for (let n = emNumero(ordenados[0].mes); n <= emNumero(ordenados[ordenados.length - 1].mes); n++) {
    const mes = emTexto(n)
    saida.push(porMes.get(mes) ?? { mes, total: 0, itens: 0 })
  }
  return saida
}

// "Top N + Outros" — decisão nº 4 do desenho: muita barra vira sopa.
//
// ⚠️ AGRUPA, NUNCA DESCARTA. A soma das barras devolvidas é sempre igual à
// soma da entrada. Um "top 10" que jogasse o resto fora faria o gráfico
// discordar do total mostrado ao lado, sem erro nenhum na tela — que é o
// defeito que esta feature inteira existe pra evitar.
export function agruparTopMaisOutros(fatias: FatiaGrafico[], limite: number): ResultadoAgrupamento {
  const ordenadas = [...fatias].sort((a, b) => b.total - a.total)

  // `limite <= 0` cairia em `slice(0, 0)` e devolveria só "Outros" — que é
  // exatamente o comportamento correto (tudo agrupado), não uma lista vazia.
  const teto = Math.max(0, limite)
  if (ordenadas.length <= teto) {
    return { barras: ordenadas, ocultos: 0, valorOcultos: 0 }
  }

  const visiveis = ordenadas.slice(0, teto)
  const resto = ordenadas.slice(teto)
  const valorOcultos = resto.reduce((soma, f) => soma + f.total, 0)

  return {
    barras: [
      ...visiveis,
      { rotulo: ROTULO_OUTROS, total: valorOcultos, itens: resto.reduce((s, f) => s + f.itens, 0) },
    ],
    ocultos: resto.length,
    valorOcultos,
  }
}

// ⚠️ LOCALE 'pt-BR' EXPLÍCITO, sempre. `toLocaleString()` sem locale usa o do
// navegador: em en-US, R$ 1.234,56 sai como "R$ 1,234.56" — foi exatamente
// assim que R$ 1.234,56 virou R$ 1,23 nesta mesma tela.
export function fmtBRL(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Rótulo de eixo: "R$ 1.406.915,25" não cabe embaixo de uma barra.
export function fmtBRLCurto(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—'
  const abs = Math.abs(valor)
  if (abs >= 1_000_000) return `${(valor / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000)     return `${(valor / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

// Eixo do gráfico de PREÇO por unidade, não de gasto. Achado 11: reusar
// `fmtBRLCurto` aqui apagava os centavos — abaixo de mil ele arredonda pra
// inteiro, então um produto que foi de R$ 3,20 pra R$ 3,80 (+19%) tinha os
// ticks "0 1 2 3" e a subida ficava ilegível. Duas casas quando o valor é
// pequeno; acima disso o comportamento é o mesmo do eixo de dinheiro.
export function fmtPrecoCurto(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—'
  // Zero é o único tick que aparece em QUALQUER escala, então ele tem que
  // combinar com os vizinhos: num eixo de 0 a 600 os ticks saem "150, 300,
  // 450, 600" e um "0,00" no pé fica visivelmente fora de padrão (visto na
  // tela em 19/08/2026). Só o intervalo pequeno de verdade ganha centavos.
  if (valor === 0) return '0'
  if (Math.abs(valor) < 10) return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return fmtBRLCurto(valor)
}

// Achado 9: `toFixed(1)` devolve "75.0" — ponto decimal, num arquivo cujo
// cabeçalho inteiro é sobre não deixar o locale escapar. Pior, o fallback ao
// lado já usava vírgula, então a mesma tela mostrava os dois formatos.
export function fmtPct(parte: number, total: number): string {
  const pct = total > 0 ? (parte / total) * 100 : 0
  return pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// 'YYYY-MM' → 'mar/26'.
//
// ⚠️ NÃO usa `new Date(...)` de propósito. `new Date('2026-01-01')` é
// interpretado como UTC e, lido em horário de Brasília (UTC-3), volta para
// 31/12/2025 — o mês do gráfico apareceria errado. Este projeto já teve esse
// bug no Financeiro (datas 1 dia atrás). Fatiar a string não tem fuso.
export function rotuloMes(mes: string): string {
  const partes = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!partes) return mes
  const indice = Number(partes[2]) - 1
  const nome = MESES_CURTOS[indice]
  if (!nome) return mes
  return `${nome}/${partes[1].slice(2)}`
}
