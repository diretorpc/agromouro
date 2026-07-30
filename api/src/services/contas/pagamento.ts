// A regra que impede dinheiro contado duas vezes.
//
// Conta vinda de NF-e já tem lançamento no Financeiro desde que a nota entrou
// (nfeProcessor.ts cria um). Marcar como paga só carimba data e valor.
// Conta cadastrada à mão não tem lançamento nenhum — sem criar um aqui, a conta
// de luz nunca apareceria no gasto.

export function precisaCriarLancamento(conta: { nota_fiscal_id: string | null }): boolean {
  return conta.nota_fiscal_id === null
}

export type DadosLancamento = {
  data:       string
  descricao:  string
  valor:      number
  tipo:       'despesa'
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
    categoria:  conta.categoria,
    fazenda_id: conta.fazenda_id,
  }
}
