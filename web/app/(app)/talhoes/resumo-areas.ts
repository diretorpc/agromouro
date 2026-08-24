import type { Talhao } from '@/lib/types'

// Área arrendada é terra NOSSA operada por terceiro. Ela conta no patrimônio
// (decisão do dono: o número grande responde "quanta terra nós temos") mas não
// conta como área de trabalho. Separar aqui, uma vez, evita que cada KPI
// invente a sua própria conta e as telas se contradigam.

export interface ResumoAreas {
  /** Patrimônio inteiro: própria em operação + arrendada. */
  total: number
  arrendada: number
  emOperacao: number
  qtdTotal: number
  qtdArrendados: number
  qtdEmOperacao: number
}

export function resumirAreas(talhoes: Talhao[]): ResumoAreas {
  let total = 0, arrendada = 0
  let qtdTotal = 0, qtdArrendados = 0

  for (const t of talhoes) {
    const area = t.area_ha ?? 0
    total += area
    qtdTotal++
    if (t.status === 'arrendado') {
      arrendada += area
      qtdArrendados++
    }
  }

  return {
    total,
    arrendada,
    emOperacao: total - arrendada,
    qtdTotal,
    qtdArrendados,
    qtdEmOperacao: qtdTotal - qtdArrendados,
  }
}
