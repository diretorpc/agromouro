import { diasEntre } from './datas'

export type ContaResumo = {
  descricao:         string
  fornecedor:        string | null
  vencimento:        string
  valor:             number | null
  status:            string
  avisar_dias_antes: number
}

export type Resumo = {
  atrasadas:   ContaResumo[]
  vencendo:    ContaResumo[]
  naoChegaram: ContaResumo[]
}

const ENCERRADAS = new Set(['paga', 'dispensada'])

export function montarResumo(contas: ContaResumo[], hojeISO: string): Resumo {
  const r: Resumo = { atrasadas: [], vencendo: [], naoChegaram: [] }

  for (const c of contas) {
    if (ENCERRADAS.has(c.status)) continue

    const dias = diasEntre(hojeISO, c.vencimento)

    if (dias < 0) { r.atrasadas.push(c); continue }
    if (dias > c.avisar_dias_antes) continue

    if (c.status === 'aguardando') r.naoChegaram.push(c)
    else                           r.vencendo.push(c)
  }
  return r
}

export function resumoVazio(r: Resumo): boolean {
  return r.atrasadas.length === 0 && r.vencendo.length === 0 && r.naoChegaram.length === 0
}

function reais(v: number | null): string {
  return v == null ? 'valor a definir' : `R$ ${v.toFixed(2).replace('.', ',')}`
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function textoResumo(r: Resumo, hojeISO: string): string {
  const linhas: string[] = [`📋 *Contas — ${ddmm(hojeISO)}*`]

  if (r.atrasadas.length) {
    linhas.push(`\n🔴 ${r.atrasadas.length} atrasada${r.atrasadas.length > 1 ? 's' : ''}:`)
    for (const c of r.atrasadas) linhas.push(`• ${c.descricao} — venceu ${ddmm(c.vencimento)}, ${reais(c.valor)}`)
  }
  if (r.vencendo.length) {
    linhas.push(`\n🟡 ${r.vencendo.length} vencendo:`)
    for (const c of r.vencendo) linhas.push(`• ${c.descricao} — dia ${ddmm(c.vencimento)}, ${reais(c.valor)}`)
  }
  if (r.naoChegaram.length) {
    linhas.push(`\n⏳ ${r.naoChegaram.length} ainda não chegou:`)
    for (const c of r.naoChegaram) linhas.push(`• ${c.descricao} — esperada dia ${ddmm(c.vencimento)}`)
  }
  return linhas.join('\n')
}
