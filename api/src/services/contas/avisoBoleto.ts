import { diasEntre } from './datas'
import type { ContaDeNota, ParcelaDescartada } from './deNotaFiscal'

// Endereço do site. Variável de ambiente porque quem manda no domínio não sou
// eu: mudou o endereço, muda a variável — não o código.
const APP_URL = process.env.APP_URL ?? 'https://agromouro.com.br'

function reais(v: number | null): string {
  if (v == null) return 'valor a definir'
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function quando(vencimentoISO: string, hojeISO: string): string {
  const dias = diasEntre(hojeISO, vencimentoISO)
  if (dias < 0)  return `venceu há ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? 's' : ''}`
  if (dias === 0) return 'vence hoje'
  return `em ${dias} dia${dias > 1 ? 's' : ''}`
}

// Uma parcela BOA perdida no meio de uma nota que, no geral, deu certo (data de
// vencimento malformada) — ver parcelasDescartadasDaNota() em deNotaFiscal.ts.
// Sem esta linha, a nota "dá certo" (os outros boletos saem, o estoque bate) e
// ninguém percebe que faltou 1 boleto no meio: o dono vai descobrir só quando o
// fornecedor cobrar por fora. Escrita para um leigo: sem "parcela malformada",
// sem "data inválida" cru — só "faltou um boleto, vá olhar".
function linhaParcelasPerdidas(descartadas: ParcelaDescartada[]): string {
  if (descartadas.length === 0) return ''

  const n = descartadas.length
  const titulo = n === 1 ? 'Falta 1 boleto desta nota' : `Faltam ${n} boletos desta nota`
  const corpo  = n === 1
    ? 'uma parcela não pôde virar boleto porque a data de vencimento dela veio errada'
    : `${n} parcelas não puderam virar boleto porque as datas de vencimento vieram erradas`

  return `\n\n⚠️ *${titulo}* — ${corpo}. Confira e lance à mão em ${APP_URL}/contas`
}

// A linha de boleto da mensagem de "NF-e processada".
// O sistema SEMPRE diz o que concluiu: criou, não criou e por quê, ou falhou.
// Recusa silenciosa faria um boleto sumir sem ninguém perceber — inclusive o
// caso mais sorrateiro: uma nota que, no geral, deu certo, mas perdeu 1 parcela
// no meio (`descartadas`), sem nenhum erro visível no resto do fluxo.
export function linhaBoleto(
  contas: ContaDeNota[],
  motivo: string | null,
  hojeISO: string,
  houveErro: boolean,
  descartadas: ParcelaDescartada[] = [],
): string {
  const avisoDescartadas = linhaParcelasPerdidas(descartadas)

  if (houveErro) {
    return `\n\n⚠️ *Boleto:* não consegui registrar o boleto desta nota. Confira em ${APP_URL}/contas` + avisoDescartadas
  }

  if (motivo) return `\n\n💳 *Sem boleto* — ${motivo}` + avisoDescartadas

  if (contas.length === 0) return avisoDescartadas

  const semData = contas.filter(c => !c.vencimento)
  if (semData.length === contas.length) {
    return `\n\n💳 *Boleto sem data de vencimento* — informe em ${APP_URL}/contas?filtro=sem-vencimento` + avisoDescartadas
  }

  if (contas.length === 1) {
    const c = contas[0]
    return `\n\n💳 *Boleto:* ${reais(c.valor)} vence ${ddmm(c.vencimento!)} (${quando(c.vencimento!, hojeISO)})` + avisoDescartadas
  }

  const datas = contas.map(c => (c.vencimento ? ddmm(c.vencimento) : 'sem data')).join(', ')
  const total = contas.reduce((s, c) => s + (c.valor ?? 0), 0)
  return `\n\n💳 *${contas.length} boletos:* ${datas} — ${reais(total)} no total` + avisoDescartadas
}
