// Contas de calendário do módulo de contas a pagar.
// REGRA: data aqui é sempre texto 'YYYY-MM-DD'. Nunca use new Date('2026-07-01')
// — esse formato é lido como UTC e volta 1 dia atrás no fuso do Brasil.

export type AnoMes = { ano: number; mes: number }   // mes de 1 a 12

// Dia 0 do mês seguinte é o último dia do mês pedido.
export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate()
}

export function dataISO(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

export function competenciaDoMes(ano: number, mes: number): string {
  return dataISO(ano, mes, 1)
}

// Dia que não existe no mês (31 em fevereiro) cai no último dia do mês.
export function vencimentoDoMes(ano: number, mes: number, diaDesejado: number): string {
  return dataISO(ano, mes, Math.min(diaDesejado, ultimoDiaDoMes(ano, mes)))
}

export function somarMeses(base: AnoMes, n: number): AnoMes {
  const total = base.ano * 12 + (base.mes - 1) + n
  return { ano: Math.floor(total / 12), mes: (total % 12) + 1 }
}

// Diferença em dias entre duas datas 'YYYY-MM-DD'.
// Usa Date.UTC nos DOIS lados: sem fuso, sem horário de verão, sem escorregão.
export function diasEntre(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number)
  const [by, bm, bd] = bISO.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}
