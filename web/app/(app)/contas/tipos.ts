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
  numero_parcela: number | null
  total_parcelas: number | null
  created_at: string
  contas_recorrentes: { avisar_dias_antes: number; periodicidade: string } | null
}

// Conta encerrada (paga ou dispensada) não entra em nenhum total pendente, não
// pode ficar "atrasada" e sai da fila de ações. page.tsx usa isto em
// calcularTotais e no filtro/ordenação da lista; lista-contas.tsx usa isto para
// decidir quais botões mostrar em cada linha. Um só lugar de verdade, em vez de
// repetir `new Set(['paga', 'dispensada'])` nos dois arquivos.
export const ENCERRADAS = new Set<Conta['status']>(['paga', 'dispensada'])
