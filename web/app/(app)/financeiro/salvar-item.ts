// Regra PURA da edição de um item de `itens_nfe` na tela Financeiro — extraída
// para dar para testar sem montar componente, mesmo padrão de
// `web/app/(app)/talhoes/salvar-talhao.ts` e
// `web/app/(app)/nfe/regras-conferencia.ts`.
//
// POR QUE EXISTE: o `handleEdit` gravava `valor_total: quantidade × valor_unitario`,
// RECALCULANDO o total em vez de preservar o que veio da nota fiscal. Medido no
// banco de produção em 28/08/2026: **31 das 368 linhas de `itens_nfe` não
// satisfazem `quantidade × valor_unitario === valor_total`**, e 8 delas encolhem
// o gasto quando recalculadas — R$ 413.495,52 no total.
//
// O caminho para o estrago não exige o dono querer mexer em dinheiro: o diálogo
// existe principalmente para trocar o CENTRO DE CUSTO, e salvar já recalculava.
// Quatro linhas de CANA DE AÇÚCAR estão gravadas com `quantidade 0` e
// `valor_unitario 0` contra totais de R$ 9 mil a R$ 119 mil — um salvar zerava
// cada uma.
//
// Medir de novo (número em documento apodrece; o comando não):
//   select count(*) from itens_nfe
//   where abs(coalesce(quantidade,0) * coalesce(valor_unitario,0) - valor_total) > 0.02;

export type ItemOriginal = {
  quantidade:     number
  valor_unitario: number
  valor_total:    number
}

export type FormularioItem = {
  descricao:      string
  quantidade:     string
  unidade:        string
  valor_unitario: string
  centro_custo:   string
}

export type PatchItem = {
  descricao:      string
  quantidade:     number
  unidade:        string
  valor_unitario: number
  valor_total:    number
  centro_custo:   string
}

// Campo numérico vazio, em branco ou ilegível significa "o dono não mexeu
// nisto", NUNCA um valor novo. A versão anterior fazia
// `parseFloat(form.quantidade) || 1`, que transformava campo vazio — e o próprio
// zero legítimo — em **1**, calado: nas linhas de cana com `quantidade 0` isso
// sozinho já reescrevia o dado.
function numeroOuOriginal(texto: string, original: number): number {
  const n = parseFloat(texto)
  return Number.isFinite(n) ? n : original
}

// Comparação DERIVADA, não flag de "mexeu". Flag pegajosa com reset à mão já
// custou um achado [alto] em `nfe/regras-conferencia.ts` nesta mesma semana:
// ligava com qualquer tecla, nunca desligava, e o reset morava no JSX.
// Aqui, digitar e desfazer volta ao estado de "não mexeu", como tem que ser.
function mudou(a: number, b: number): boolean {
  return Math.abs(a - b) > 1e-9
}

export function patchDoItemEditado(original: ItemOriginal, form: FormularioItem): PatchItem {
  const quantidade     = numeroOuOriginal(form.quantidade, original.quantidade)
  const valorUnitario  = numeroOuOriginal(form.valor_unitario, original.valor_unitario)

  // O TOTAL é o número que a nota fiscal afirma e o que a tela soma (ver a
  // memória `financeiro-soma-itens-nao-lancamentos`: as duas telas de dinheiro
  // somam tabelas diferentes). Ele só muda quando o dono mexeu, de propósito,
  // em quantidade ou unitário — aí recalcular é a intenção dele, e a tela
  // mostra o novo total antes de gravar.
  const mexeuNaConta = mudou(quantidade, original.quantidade) || mudou(valorUnitario, original.valor_unitario)

  return {
    descricao:      form.descricao.trim(),
    quantidade,
    unidade:        form.unidade,
    valor_unitario: valorUnitario,
    valor_total:    mexeuNaConta ? quantidade * valorUnitario : original.valor_total,
    centro_custo:   form.centro_custo,
  }
}

// O que a tela precisa imprimir ANTES de gravar. Hoje o diálogo mostra só o
// produto `qtd × unit` e nunca o total ATUAL do item — então não existe com o
// que comparar, e um total prestes a cair de R$ 119 mil para zero não aparece
// em lugar nenhum.
export function previaDoTotal(original: ItemOriginal, form: FormularioItem): {
  totalAtual: number
  totalNovo:  number
  vaiMudar:   boolean
} {
  const totalNovo = patchDoItemEditado(original, form).valor_total
  return {
    totalAtual: original.valor_total,
    totalNovo,
    vaiMudar:   mudou(totalNovo, original.valor_total),
  }
}
