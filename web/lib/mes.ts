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

// A DATA de hoje, em hora local, no formato `YYYY-MM-DD` que a coluna `date` e o
// `<input type="date">` esperam.
//
// Mora aqui pelo MESMO motivo do `mesCorrente` logo acima, e nasceu do mesmo
// defeito: `new Date().toISOString().slice(0, 10)` roda em UTC, e às 21h de
// Brasília já devolve o dia SEGUINTE. Estava espalhado pelo Financeiro em
// quatro pontos — e um deles congelava no carregamento do módulo, oferecendo a
// data de ontem a quem deixasse a aba aberta.
//
// Recebe `agora` injetável pela mesma razão que o `mesCorrente`: sem isso não há
// como testar a virada do dia, e o Apolo mediu (3ª rodada, 28/08/2026) que a
// versão sem parâmetro morria em zero testes ao ser revertida.
export function hojeLocal(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`
}
