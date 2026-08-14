import { diasEntre } from './datas'
import { APP_URL, reais, ddmm } from './formato'
import type { ContaDeNota, ParcelaDescartada } from './deNotaFiscal'

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

// O boleto nasceu APESAR de o código de pagamento da nota dizer que não haveria
// cobrança (ver motivoVencidoPelaDuplicata em deNotaFiscal.ts). Não é erro: desde
// 14/08/2026 a duplicata com data e valor vence o tPag, porque perder um boleto de
// verdade é o erro mais caro que existe.
//
// Mas o outro lado desse acordo é este aviso. Um fornecedor pode espelhar uma compra
// no cartão como duplicata no XML — aí a cobrança vem pela fatura do cartão, e o
// boleto criado aqui é fantasma. Sem esta linha, o dono pagaria os dois. Escrita para
// um leigo: sem "tPag", sem "duplicata" — só "confira, pode ser que já esteja pago".
// `quantos` pluraliza igual linhaParcelasPerdidas acima: uma nota de cartão com 3
// duplicatas gera 3 boletos suspeitos, e "Confira este boleto" no singular faria o
// dono achar que só um dos três é o duvidoso — dispensando um e pagando dois.
// Achado [médio] do Apolo, 14/08/2026.
function linhaBoletoContraOCodigo(motivoVencido: string | null, quantos: number): string {
  if (!motivoVencido) return ''

  const alvo = quantos === 1 ? 'este boleto' : `estes ${quantos} boletos`
  const pago = quantos === 1
    ? 'Se já foi pago (ou vem na fatura do cartão)'
    : 'Se já foram pagos (ou vêm na fatura do cartão)'

  return `\n\n👀 *Confira ${alvo}:* ${motivoVencido}, mas veio com cobrança marcada. ` +
    `${pago}, dispense em ${APP_URL}/contas`
}

// A linha de boleto da mensagem de "NF-e processada".
// O sistema SEMPRE diz o que concluiu: criou, não criou e por quê, ou falhou.
// Recusa silenciosa faria um boleto sumir sem ninguém perceber — inclusive o
// caso mais sorrateiro: uma nota que, no geral, deu certo, mas perdeu 1 parcela
// no meio (`descartadas`), sem nenhum erro visível no resto do fluxo.
// `motivoVencido` é o oposto de `motivo`: o código de pagamento dizia "sem cobrança",
// mas a duplicata venceu ele e o boleto FOI criado. Os dois nunca vêm preenchidos
// juntos (ver as duas funções em deNotaFiscal.ts — uma só responde com duplicata, a
// outra só sem), então cada mensagem sai com um dos dois, nunca com os dois.
export function linhaBoleto(
  contas: ContaDeNota[],
  motivo: string | null,
  hojeISO: string,
  houveErro: boolean,
  descartadas: ParcelaDescartada[] = [],
  motivoVencido: string | null = null,
): string {
  const avisoDescartadas = linhaParcelasPerdidas(descartadas)

  if (houveErro) {
    return `\n\n⚠️ *Boleto:* não consegui registrar o boleto desta nota. Confira em ${APP_URL}/contas` + avisoDescartadas
  }

  if (motivo) return `\n\n💳 *Sem boleto* — ${motivo}` + avisoDescartadas

  if (contas.length === 0) return avisoDescartadas

  // Só depois de confirmar que existe boleto: avisar "confira este boleto" quando
  // boleto nenhum foi criado seria mandar o dono procurar o que não existe.
  const rodape = avisoDescartadas + linhaBoletoContraOCodigo(motivoVencido, contas.length)

  const semData = contas.filter(c => !c.vencimento)
  if (semData.length === contas.length) {
    return `\n\n💳 *Boleto sem data de vencimento* — informe em ${APP_URL}/contas?filtro=sem-vencimento` + rodape
  }

  if (contas.length === 1) {
    const c = contas[0]
    return `\n\n💳 *Boleto:* ${reais(c.valor)} vence ${ddmm(c.vencimento!)} (${quando(c.vencimento!, hojeISO)})` + rodape
  }

  const datas = contas.map(c => (c.vencimento ? ddmm(c.vencimento) : 'sem data')).join(', ')
  const total = contas.reduce((s, c) => s + (c.valor ?? 0), 0)
  return `\n\n💳 *${contas.length} boletos:* ${datas} — ${reais(total)} no total` + rodape
}
