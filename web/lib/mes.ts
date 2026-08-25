// AAAA-MM de hoje no fuso de QUEM ESTÁ OLHANDO.
//
// Mora em lib/ porque DUAS telas dependem dele: a aba NF-e e o Financeiro. As
// duas abrem filtradas por mês, e as duas somem com a nota se o mês estiver
// errado — a mesma verdade em dois arquivos acabaria discordando.
//
// NÃO usa toISOString(): ele converte para UTC, e nas últimas 3 horas de todo
// mês no Brasil isso já aponta para o mês seguinte. Era o que o Financeiro fazia
// (achado [médio] do Apolo, 25/08/2026): das 21h do dia 31 até a virada, a tela
// do dinheiro abria num mês vazio.
export function mesCorrente(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`
}
