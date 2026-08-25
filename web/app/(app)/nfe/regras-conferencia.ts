// Regras PURAS da tela de conferência do PDF (conferencia-pdf.tsx), extraídas
// para dar para testar sem montar componente nenhum — mesmo padrão já usado em
// web/app/(app)/talhoes/salvar-talhao.ts e
// web/app/(app)/controle/components/deletar-linha.ts.
//
// Achado [médio] do Apolo, 3ª rodada (24/08/2026): os 5 consertos de front da
// rodada anterior (lidoOriginal, trava do botão, preservar CFOP ao confirmar a
// mesma família, etc.) foram entregues com ZERO teste — a lógica morava
// inteira dentro do componente React, sem forma de provar de mesa.

export type FamiliaItem = {
  chave:           string
  rotulo:          string
  cfop:            string
  contaComoCompra: boolean
}

export type ItemComCfop = {
  cfop:     string
  familia?: string
}

// Nota em que NENHUM item é "compra normal" é rara e cara. A leitura de
// 24/08/2026 (loja de material de construção, CFOPs 5405 e 5102 impressos no
// papel) voltou com 5922 — faturamento de entrega futura — nos CINCO itens: o
// dinheiro contou certo por acaso, mas a mesma leitura numa nota de adubo faria
// a mercadoria NÃO entrar no estoque, calada.
//
// O menu de efeito por item existia e não bastou: ele apresenta a leitura como
// fato consumado, num campo pequeno. Quando a nota inteira cai fora de "compra",
// a tela precisa PARAR o dono, não sussurrar.
//
// Nota MISTA (parte compra, parte bonificação) não dispara: é o caso legítimo
// mais comum ("compre 20, leve 2").
export function precisaConfirmarEfeitoIncomum(itens: readonly ItemComCfop[]): boolean {
  if (itens.length === 0) return false
  return !itens.some(i => i.familia === 'compra')
}

// Trocar o efeito de um item grava o CFOP representante daquela família — o
// dono escolhe "já paguei antes", não "5117". Duas travas, nesta ordem:
//
// 1. Se a família escolhida é a MESMA que o item já tinha, e ele já veio com
//    um CFOP lido, NÃO reescreve: mantém o código real da nota. Sem isto,
//    confirmar a família de um item 6117 (interestadual) gravava 5117
//    (interno) — um código que a nota nunca imprimiu, só porque o dono
//    confirmou o que a IA já tinha acertado (achado 5, rodada anterior).
//
// 2. Família DIFERENTE, e o CFOP lido é interestadual (começa com '6'):
//    preserva o dígito de estado. Um item lido como 6117 cuja família o dono
//    troca para "Bonificação" grava 6910, NUNCA 5910 — 5910 é um código que a
//    nota nunca imprimiu, e num estado errado (achado 7, 3ª rodada,
//    24/08/2026). As 4 famílias têm gêmeo 6xxx com efeito idêntico
//    (6102/6117/6922/6910).
export function cfopAposEscolha(item: ItemComCfop, familiaEscolhida: FamiliaItem): string {
  const mantemCfopOriginal = item.familia === familiaEscolhida.chave && !!item.cfop
  if (mantemCfopOriginal) return item.cfop

  if (item.cfop.startsWith('6')) return '6' + familiaEscolhida.cfop.slice(1)

  return familiaEscolhida.cfop
}

// Item cujo efeito a tela NÃO deixa trocar: veio com CFOP lido, mas de uma
// família fora das quatro oferecidas (remessa sem compra 5905/5912/5920…,
// consignação 5917). A coluna "O que é este item" imprime o código cru para
// esses, sem select, porque trocá-los por "compra" seria piorar.
//
// Mora aqui, e não dentro do componente, porque DOIS lugares precisam da mesma
// resposta: o que decide se renderiza select e o que aplica família em massa.
// Quando essa pergunta existia só no JSX, o botão de conserto em massa passou
// por cima da trava e transformou remessa de depósito em compra nova — achado
// [alto] do Apolo, 25/08/2026.
export function itemTrancado(item: ItemComCfop): boolean {
  return !!item.cfop && !item.familia
}

// Aplica UMA família a TODOS os itens de uma vez, item por item, com a mesma
// regra de `cfopAposEscolha` — inclusive a preservação do dígito de estado e a
// de não reescrever um CFOP que já é daquela família.
//
// Item trancado (ver `itemTrancado`) fica INTOCADO: o botão conserta o que a
// tela deixaria consertar à mão, nunca mais que isso.
//
// Existe porque o aviso de `precisaConfirmarEfeitoIncomum` não bastou: em
// 25/08/2026 a nota 289122 (RURALCENTRO, 19 itens, CFOP 5102 e 5405 impressos)
// voltou com 5922 em TODAS as linhas. O aviso vermelho apareceu na tela e foi
// dispensado pela caixa "conferi no papel" — porque o conserto de verdade eram
// 19 dropdowns, um a um, e a caixa era um clique. Nenhum item entrou no estoque.
//
// Regra de UX que este caso ensina: quando a tela sabe qual é o conserto certo,
// ela tem que oferecer o conserto — não só o aviso e uma caixa de dispensa.
export function aplicarFamiliaATodos<T extends ItemComCfop>(
  itens: readonly T[],
  familia: FamiliaItem,
): T[] {
  return itens.map(item => (
    itemTrancado(item)
      ? item
      : { ...item, cfop: cfopAposEscolha(item, familia), familia: familia.chave }
  ))
}

// A condição que HABILITA o botão "Confirmar e gravar" — devolve `true`
// quando pode gravar, o INVERSO do que o componente usa em `disabled`.
//
// Item sem efeito escolhido TRAVA a gravação: deixar passar equivale a
// decidir "é compra" por omissão, que é o caminho do gasto dobrado. Mas só
// trava quando existe ESCOLHA possível (`familias` não vazia) — um botão que
// trava sem oferecer a ação que destrava é pior que o default que ele evita
// (achado do Apolo, 24/08/2026: API antiga sem `familias` deixava o dono sem
// nenhum caminho para gravar a nota).
export function podeGravar(params: {
  quantidadeItens:    number
  semCfop:            number
  familias:           readonly unknown[] | null | undefined
  duplicataValendo:   unknown
  gravando:           boolean
  // true quando a nota inteira caiu fora de "compra normal" E o dono ainda não
  // confirmou que é isso mesmo. Ver precisaConfirmarEfeitoIncomum.
  efeitoIncomumPendente?: boolean
}): boolean {
  if (params.gravando) return false
  if (params.quantidadeItens === 0) return false
  if (params.duplicataValendo) return false
  if (params.semCfop > 0 && (params.familias?.length ?? 0) > 0) return false
  if (params.efeitoIncomumPendente) return false
  return true
}
