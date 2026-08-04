// A regra que impede dinheiro contado duas vezes.
//
// Conta vinda de NF-e já tem lançamento no Financeiro desde que a nota entrou
// (nfeProcessor.ts cria um). Marcar como paga só carimba data e valor.
// Conta cadastrada à mão não tem lançamento nenhum — sem criar um aqui, a conta
// de luz nunca apareceria no gasto.
//
// ⚠️ ESSA GARANTIA NÃO VALE MAIS PARA NOTA DE ENTREGA (nota de remessa) — achado
// na revisão final de 03/08/2026. O boleto (bloco `contas_a_pagar`, decidido
// pelos campos de pagamento da nota) e o gasto (`valorCompra`, decidido pelo
// CFOP de cada item) são calculados por regras INDEPENDENTES em nfeProcessor.ts
// — de propósito, porque perder um boleto de verdade é o erro mais caro que
// existe. Mas isso abre a brecha: uma nota de remessa pode gerar um boleto
// cheio enquanto lança R$ 0,00 de gasto. Caso medido: ERCAL nota 82398 — CFOP
// 5116, tPag 15, zero duplicata → gasto R$ 0,00, conta a pagar de R$ 8.258,40
// cheia. Quando o dono marcar essa conta como paga, `precisaCriarLancamento`
// abaixo devolve `false` (porque `nota_fiscal_id` não é nulo) e NENHUM
// lançamento é criado — o dinheiro sai do banco e nunca aparece em despesa
// nenhuma tela.
//
// O código abaixo AINDA ASSUME a regra antiga (nota de NF-e sempre já tem
// lançamento) e continua assim de propósito — não foi corrigido nesta revisão.
// Criar um lançamento aqui sempre que `nota_fiscal_id` não for nulo arriscaria
// o erro oposto: se a nota de faturamento (a que já lançou o gasto de verdade)
// também chegou ao sistema, o dono pagaria a mesma compra duas vezes no
// Financeiro — e o sistema não tem hoje como saber se essa outra nota existe.
// Essa escolha é do dono, não foi tomada aqui. nfeProcessor.ts agora avisa no
// WhatsApp quando o boleto de uma nota vale mais que o gasto lançado (ver
// `linhaCobrancaMaiorQueGasto`), mas a lacuna em `precisaCriarLancamento`
// continua aberta — é um problema conhecido, não uma garantia resolvida.

export function precisaCriarLancamento(conta: { nota_fiscal_id: string | null }): boolean {
  return conta.nota_fiscal_id === null
}

export type DadosLancamento = {
  data:       string
  descricao:  string
  valor:      number
  tipo:       'despesa'
  // A tela Financeiro só carrega lançamento com origem conhecida
  // (`.in('origem', [...])`), e no SQL o IN nunca casa com nulo. Sem carimbar a
  // origem aqui, o gasto some do Financeiro e continua contando no Dashboard —
  // duas telas, dois totais para o mesmo mês.
  // Origem própria, não 'manual': assim o Financeiro não deixa editar um valor
  // que na verdade mora na conta a pagar.
  origem:     'conta'
  categoria:  string | null
  fazenda_id: string
}

export function montarLancamento(
  conta: { descricao: string; fornecedor: string | null; categoria: string | null; fazenda_id: string },
  dataPagamento: string,
  valorPago: number,
): DadosLancamento {
  return {
    data:       dataPagamento,
    descricao:  conta.fornecedor ? `${conta.fornecedor} — ${conta.descricao}` : conta.descricao,
    valor:      valorPago,
    tipo:       'despesa',
    origem:     'conta',
    categoria:  conta.categoria,
    fazenda_id: conta.fazenda_id,
  }
}
