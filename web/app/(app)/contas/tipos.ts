// Tipos compartilhados da tela de Contas a Pagar.
//
// Ficam num arquivo próprio, separado de page.tsx e de lista-contas.tsx, para
// evitar importação circular: se os tipos ficassem em page.tsx, lista-contas.tsx
// precisaria importar de lá — e page.tsx já importa `ListaContas` de
// lista-contas.tsx. Duas pontas se importando uma da outra quebra de um jeito
// confuso de diagnosticar (ver Step 1 do brief da Task 8).

export type Conta = {
  id: string
  descricao: string
  fornecedor: string | null
  categoria: string | null
  vencimento: string | null   // 'YYYY-MM-DD' — vazio quando a NF-e não informou
  valor: number | null
  valor_estimado: boolean
  status: 'aguardando' | 'aberta' | 'paga' | 'dispensada'
}

export type ContaAPI = Conta & {
  data_pagamento: string | null
  valor_pago: number | null
  observacao: string | null
  nota_fiscal_id: string | null
  // Id do lançamento que este pagamento criou em lancamentos_financeiros — null
  // quando a conta veio de NF-e (o gasto já mora nos itens da nota, nenhum
  // lançamento "conta paga" é criado; ver precisaCriarLancamento em
  // api/src/services/contas/pagamento.ts). Usado pra saber se o aviso "corrija
  // também no Financeiro" faz sentido pra ESTA conta (achado do Apolo, 18/08/2026).
  lancamento_id: string | null
  numero_parcela: number | null
  total_parcelas: number | null
  created_at: string
  contas_recorrentes: { avisar_dias_antes: number; periodicidade: string } | null
  // Número da nota fiscal que originou a conta — vem do join com notas_fiscais
  // (ver rota GET /contas). null para conta fixa/avulsa (sem nota_fiscal_id).
  notas_fiscais: { numero: string } | null
}

// Rótulo de cada status para o usuário final. Mora aqui, e não em
// lista-contas.tsx, porque a exportação para Excel (exportar.ts) precisa do
// MESMO texto: um relatório que chama de "Quitada" o que a tela chama de
// "Paga" faz o leitor duvidar se são a mesma coisa. E `exportar.ts` é lógica
// pura — importar de um .tsx arrastaria React e ícones pro teste unitário.
export const STATUS_LABEL: Record<Conta['status'], string> = {
  aguardando: 'Aguardando',
  aberta:     'Aberta',
  paga:       'Paga',
  dispensada: 'Dispensada',
}

// Começo do texto que a API grava em `observacao` quando o boleto nasceu apesar de a
// nota dizer cartão/dinheiro (PREFIXO_CONFERIR em api/src/services/contas/deNotaFiscal.ts).
// Repetido aqui porque o front não importa do back — os dois lados PRECISAM mudar juntos
// se este texto mudar. A coluna é campo livre e guarda outras anotações; só o que começa
// com este prefixo vira alerta na tela.
export const PREFIXO_CONFERIR = 'Conferir antes de pagar:'

// Conta encerrada (paga ou dispensada) não entra em nenhum total pendente, não
// pode ficar "atrasada" e sai da fila de ações. page.tsx usa isto em
// calcularTotais e no filtro/ordenação da lista; lista-contas.tsx usa isto para
// decidir quais botões mostrar em cada linha. Um só lugar de verdade, em vez de
// repetir `new Set(['paga', 'dispensada'])` nos dois arquivos.
export const ENCERRADAS = new Set<Conta['status']>(['paga', 'dispensada'])
