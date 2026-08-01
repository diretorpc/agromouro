import { diasEntre } from './datas'
import { APP_URL, reais, ddmm } from './formato'

// Dias sem resposta a partir dos quais a conta sem data sobe de tom.
// Motivo do escalonamento: conta sem vencimento NUNCA pode ficar "atrasada",
// porque não há data para comparar — o boleto vence no mundo real e o sistema
// não tem como saber. É o único ponto cego, então ele grita em vez de calar.
const DIAS_PARA_ESCALAR = 5

export type ContaResumo = {
  descricao:         string
  fornecedor:        string | null
  vencimento:        string | null   // vazio = o fornecedor não informou
  valor:             number | null
  status:            string
  avisar_dias_antes: number
  criada_em:         string          // 'YYYY-MM-DD' — base do escalonamento
}

export type Resumo = {
  atrasadas:            ContaResumo[]
  vencendo:             ContaResumo[]
  naoChegaram:          ContaResumo[]
  semVencimento:        ContaResumo[]
  semVencimentoAntigas: ContaResumo[]
}

const ENCERRADAS = new Set(['paga', 'dispensada'])

export function montarResumo(contas: ContaResumo[], hojeISO: string): Resumo {
  const r: Resumo = {
    atrasadas: [], vencendo: [], naoChegaram: [],
    semVencimento: [], semVencimentoAntigas: [],
  }

  for (const c of contas) {
    if (ENCERRADAS.has(c.status)) continue

    // Sem data não dá para calcular atraso. Vai para o grupo próprio, e sobe
    // de tom conforme envelhece sem resposta.
    if (!c.vencimento) {
      const esperando = diasEntre(c.criada_em, hojeISO)
      if (esperando > DIAS_PARA_ESCALAR) r.semVencimentoAntigas.push(c)
      else                                r.semVencimento.push(c)
      continue
    }

    const dias = diasEntre(hojeISO, c.vencimento)

    // Uma conta aguardando (não chegou) que venceu já deve ser alertada como atrasada,
    // pois "atrasada" é a situação mais urgente — o fornecedor não apenas esqueceu,
    // mas agora deveria ter chegado.
    if (dias < 0) { r.atrasadas.push(c); continue }
    if (dias > c.avisar_dias_antes) continue

    if (c.status === 'aguardando') r.naoChegaram.push(c)
    else                           r.vencendo.push(c)
  }
  return r
}

export function resumoVazio(r: Resumo): boolean {
  return r.atrasadas.length === 0 && r.vencendo.length === 0 &&
         r.naoChegaram.length === 0 && r.semVencimento.length === 0 &&
         r.semVencimentoAntigas.length === 0
}

export function textoResumo(r: Resumo, hojeISO: string): string {
  const linhas: string[] = [`📋 *Contas — ${ddmm(hojeISO)}*`]

  const criticas = r.atrasadas.length + r.semVencimentoAntigas.length
  if (criticas > 0) {
    linhas.push(`\n🔴 ${criticas} urgente${criticas > 1 ? 's' : ''}:`)
    for (const c of r.atrasadas) {
      linhas.push(`• ${c.descricao} — venceu ${ddmm(c.vencimento!)}, ${reais(c.valor)}`)
    }
    for (const c of r.semVencimentoAntigas) {
      const dias = diasEntre(c.criada_em, hojeISO)
      linhas.push(`• ${c.descricao} — ${reais(c.valor)}, há ${dias} dias sem vencimento informado`)
    }
  }
  if (r.vencendo.length) {
    linhas.push(`\n🟡 ${r.vencendo.length} vencendo:`)
    for (const c of r.vencendo) linhas.push(`• ${c.descricao} — dia ${ddmm(c.vencimento!)}, ${reais(c.valor)}`)
  }
  if (r.naoChegaram.length) {
    const n = r.naoChegaram.length
    linhas.push(`\n⏳ ${n} ainda ${n > 1 ? 'não chegaram' : 'não chegou'}:`)
    for (const c of r.naoChegaram) linhas.push(`• ${c.descricao} — esperada dia ${ddmm(c.vencimento!)}`)
  }
  if (r.semVencimento.length) {
    linhas.push(`\n❓ ${r.semVencimento.length} sem vencimento:`)
    for (const c of r.semVencimento) linhas.push(`• ${c.descricao} — ${reais(c.valor)}`)
  }
  if (r.semVencimento.length || r.semVencimentoAntigas.length) {
    linhas.push(`👉 ${APP_URL}/contas?filtro=sem-vencimento`)
  }
  return linhas.join('\n')
}
