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
  readonly entraNoEstoque:  boolean
  readonly contaComoCompra: boolean
  readonly custoZero:       boolean   // entra no estoque, mas sem preço (não estraga o preço médio)
  readonly rotulo:          string    // português claro, para log e mensagem
}

const COMPRA_NORMAL: EfeitoItem = Object.freeze({
  entraNoEstoque: true, contaComoCompra: true, custoZero: false, rotulo: 'compra',
})

const TABELA: Record<string, EfeitoItem> = {}

function registrar(cfops: string[], efeito: EfeitoItem) {
  // Congela cada objeto de efeito para impedir corrupção silenciosa: toda família
  // de CFOPs compartilha a mesma referência. Mexer nela afetaria todos os demais
  // silenciosamente — o mesmo erro latente que causou R$ 1,2 mi de gasto fantasma.
  // Object.freeze no compile-time (readonly) + runtime (Object.freeze) não deixa
  // passar. Falhar ruidosamente é sempre melhor que silencioso.
  Object.freeze(efeito)
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

// ─── As mesmas famílias, em português de produtor ───────────────────────────
//
// Existe porque a tela de conferência do PDF (aba Notas → "Upload PDF") precisa
// deixar o dono corrigir o efeito de um item quando a IA não conseguiu ler a
// coluna CFOP do DANFE — e um CFOP ilegível que vira "compra" por omissão é
// exatamente o caminho que já produziu R$ 1,2 mi de gasto fantasma (achado do
// Apolo, 24/08/2026, provado com a nota real da SYAGRI).
//
// A escolha na tela é do EFEITO ("já paguei isso antes"), nunca do código
// fiscal: ninguém que trabalha na fazenda sabe o que é 5117, mas todo mundo
// sabe o que já pagou. O código representante é gravado a partir da escolha.
//
// Mora AQUI, e não no front, de propósito: regra fiscal tem um dono só neste
// projeto. A rota devolve esta lista pronta para a tela desenhar.
export type FamiliaItem = {
  readonly chave:           string
  readonly rotulo:          string    // o que o dono lê na tela
  readonly cfop:            string    // código representante, gravado quando ele escolhe
  // Se esta família conta como GASTO no Financeiro — mesmo campo que
  // efeitoDoCfop() decide para o lançamento real (nfeProcessor.ts, seção 3).
  // Calculado a partir do CFOP representante, não digitado à mão: a tela de
  // conferência soma "R$ X vão virar gasto" em cima disto (achado [médio] do
  // Apolo, 3ª rodada, 24/08/2026) — duplicar a regra ali, escrita de cabeça,
  // já rendeu engano ('faturamento' PARECE que não devia contar como compra,
  // mas conta: é a nota que cobra na hora e entrega depois).
  readonly contaComoCompra: boolean
}

export const FAMILIAS_ITEM: readonly FamiliaItem[] = Object.freeze([
  Object.freeze({ chave: 'compra',            rotulo: 'Compra normal (entra no estoque e conta como gasto)', cfop: '5102', contaComoCompra: efeitoDoCfop('5102').contaComoCompra }),
  Object.freeze({ chave: 'entrega-faturada',  rotulo: 'Entrega de pedido que já paguei (entra no estoque, sem gasto novo)', cfop: '5117', contaComoCompra: efeitoDoCfop('5117').contaComoCompra }),
  Object.freeze({ chave: 'faturamento',       rotulo: 'Faturamento — paguei agora, mercadoria vem depois (gasto, sem estoque)', cfop: '5922', contaComoCompra: efeitoDoCfop('5922').contaComoCompra }),
  Object.freeze({ chave: 'bonificacao',       rotulo: 'Bonificação — veio de graça (entra no estoque com custo zero)', cfop: '5910', contaComoCompra: efeitoDoCfop('5910').contaComoCompra }),
])

// Qual família descreve o CFOP que a IA leu. Comparação pelo EFEITO, não pelo
// código: qualquer CFOP da mesma família (5117/6117/5116/6116...) devolve a
// mesma chave, sem precisar repetir a lista de códigos aqui.
export function familiaDoCfop(cfop: string): string {
  const efeito = efeitoDoCfop(cfop)
  const familia = FAMILIAS_ITEM.find(f => efeitoDoCfop(f.cfop) === efeito)
  // CFOP de família que a tela não oferece (consignação, remessa sem compra):
  // devolve '' para a tela mostrar o código cru e não mentir que é compra.
  return familia?.chave ?? ''
}
