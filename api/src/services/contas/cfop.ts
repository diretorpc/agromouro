// O que cada código de operação (CFOP) da NF-e faz com estoque e com custo.
//
// POR QUE ISTO EXISTE: em 03/08/2026 descobrimos que uma compra de 400 t de KCl
// entrou no sistema DUAS vezes — uma pela nota de faturamento e outra por cada
// nota de entrega — porque o sistema tratava as duas iguais. R$ 1,2 milhão de
// gasto que não existiu e 400 toneladas que não estavam no galpão.
//
// Base legal da separação: Convênio SINIEF s/nº de 15/12/1970, cláusula terceira.
// A nota de faturamento formaliza a venda SEM mover mercadoria; a de remessa move
// a mercadoria SEM cobrar de novo.
//
// ⚠️ Esta função decide ESTOQUE e CUSTO. Ela NÃO decide boleto — quem decide boleto
// são os campos de pagamento da nota (cobr/tPag/vPag), porque existe revenda que
// pula o passo do faturamento e embute a cobrança na própria remessa. Cravar
// "remessa nunca gera boleto" perderia esse boleto, que é o erro mais caro.

export type EfeitoItem = {
  entraNoEstoque:  boolean
  contaComoCompra: boolean
  custoZero:       boolean   // entra no estoque, mas sem preço (não estraga o preço médio)
  rotulo:          string    // português claro, para log e mensagem
}

const COMPRA_NORMAL: EfeitoItem = {
  entraNoEstoque: true, contaComoCompra: true, custoZero: false, rotulo: 'compra',
}

const TABELA: Record<string, EfeitoItem> = {}

function registrar(cfops: string[], efeito: EfeitoItem) {
  for (const c of cfops) TABELA[c] = efeito
}

// Faturamento para entrega futura: é a VENDA. Dinheiro sim, mercadoria não.
registrar(['5922', '6922'], {
  entraNoEstoque: false, contaComoCompra: true, custoZero: false,
  rotulo: 'faturamento de entrega futura',
})

// Remessa de entrega futura: é a ENTREGA. Mercadoria sim, dinheiro não
// (o custo já entrou com a nota de faturamento).
registrar(['5116', '6116', '5117', '6117'], {
  entraNoEstoque: true, contaComoCompra: false, custoZero: false,
  rotulo: 'entrega de pedido já faturado',
})

// Bonificação e amostra: o produto existe e vai ser aplicado, mas nenhum dinheiro
// saiu. Lançar como compra estragaria o preço médio do insumo (STJ, Súmula 457).
registrar(['5910', '6910'], {
  entraNoEstoque: true, contaComoCompra: false, custoZero: true,
  rotulo: 'bonificação (produto de graça)',
})
registrar(['5911', '6911'], {
  entraNoEstoque: true, contaComoCompra: false, custoZero: true,
  rotulo: 'amostra grátis',
})

// Mercadoria que passa pela fazenda mas não é compra nem consumo.
registrar(
  ['5912', '6912', '5913', '6913', '5915', '6915', '5916', '6916',
   '5920', '6920', '5921', '6921', '5905', '6905', '5934', '6934',
   '5924', '6924', '5925', '6925'],
  { entraNoEstoque: false, contaComoCompra: false, custoZero: false,
    rotulo: 'remessa sem compra' },
)

// Consignação: o produto fica na fazenda, mas só vira compra quando é usado
// (a devolução simbólica é que fecha a venda).
registrar(['5917', '6917'], {
  entraNoEstoque: true, contaComoCompra: false, custoZero: false,
  rotulo: 'consignação (ainda não é compra)',
})
registrar(['5919', '6919'], {
  entraNoEstoque: false, contaComoCompra: true, custoZero: false,
  rotulo: 'consignação usada (virou compra)',
})

// Na dúvida — código desconhecido, ausente, ou venda normal — faz o que sempre fez.
// Deixar de registrar por não reconhecer um código seria pior que registrar demais.
export function efeitoDoCfop(cfop: string): EfeitoItem {
  return TABELA[cfop] ?? COMPRA_NORMAL
}
