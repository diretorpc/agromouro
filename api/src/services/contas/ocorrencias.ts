import { type AnoMes, competenciaDoMes, vencimentoDoMes } from './datas'

export type Periodicidade = 'mensal' | 'bimestral' | 'trimestral' | 'semestral' | 'anual'

// Todos os intervalos dividem 12 — por isso a âncora de mês é estável ano após ano.
const INTERVALO_MESES: Record<Periodicidade, number> = {
  mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
}

export type Regra = {
  id:             string
  periodicidade:  Periodicidade
  dia_vencimento: number
  mes_primeira:   number | null   // 1..12; só vale quando não é mensal
  ativa:          boolean
}

export type Ocorrencia = {
  recorrente_id: string
  competencia:   string   // 'YYYY-MM-01'
  vencimento:    string   // 'YYYY-MM-DD'
}

export function ocorrenciasEsperadas(regra: Regra, de: AnoMes, ate: AnoMes): Ocorrencia[] {
  if (!regra.ativa) return []

  const intervalo = INTERVALO_MESES[regra.periodicidade]
  if (!intervalo) return []

  // Mês âncora (0..11). Mensal cai em todo mês, então a âncora não importa.
  const ancora = intervalo === 1 ? 0 : (regra.mes_primeira ?? 1) - 1

  const inicio = de.ano * 12 + (de.mes - 1)
  const fim    = ate.ano * 12 + (ate.mes - 1)

  const out: Ocorrencia[] = []
  for (let i = inicio; i <= fim; i++) {
    const mesIndex = ((i % 12) + 12) % 12
    if ((((mesIndex - ancora) % intervalo) + intervalo) % intervalo !== 0) continue

    const ano = Math.floor(i / 12)
    const mes = mesIndex + 1
    out.push({
      recorrente_id: regra.id,
      competencia:   competenciaDoMes(ano, mes),
      vencimento:    vencimentoDoMes(ano, mes, regra.dia_vencimento),
    })
  }
  return out
}

export function ocorrenciasFaltantes(
  esperadas: Ocorrencia[],
  existentes: Array<{ recorrente_id: string; competencia: string }>,
): Ocorrencia[] {
  const chave = (r: string, c: string) => `${r}|${c}`
  const jaTem = new Set(existentes.map(e => chave(e.recorrente_id, e.competencia)))
  return esperadas.filter(o => !jaTem.has(chave(o.recorrente_id, o.competencia)))
}
