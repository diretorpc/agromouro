import { supabase } from '../supabase'
import type { ItemControleRow } from './editarItemControle'

// Cria uma linha "avulsa" na grade de Controle — pedido do Matheus (tela
// editável estilo Excel, decisão travada nº 2): "adicionar linha nova".
// Diferente de item importado de PDF, uma linha avulsa não tem
// `documento_controle_id` (nasceu direto na grade, sem PDF de origem) —
// por isso NUNCA cai na trava de dedupe `idx_itens_nfe_dedupe_item`
// (migration 018), que só existe `where documento_controle_id is not
// null`. É uma decisão consciente, não uma lacuna: uma linha digitada à mão
// é, por definição, uma entrada nova e deliberada — não existe "reimportação"
// da qual proteger.

export type NovoItemControleAvulso = {
  descricao:        string
  quantidade:       number | null
  unidade:          string
  valor_unitario:   number | null
  valor_total:      number
  // Nullable de propósito (diferente de item importado de PDF, onde a
  // constraint `item_de_documento_completo` da migration 017 EXIGE data —
  // ela só se aplica quando `documento_controle_id is not null`). Uma linha
  // avulsa pode nascer sem data ainda; o Matheus preenche depois clicando
  // na célula, como qualquer outra.
  data_manual:      string | null
  fornecedor:       string | null
  numero_documento: string | null
}

export type ResultadoCriarItemAvulso =
  | { status: 'criado'; item: ItemControleRow }
  | { status: 'erro'; mensagem: string }

const COLUNAS =
  'id, descricao, quantidade, unidade, valor_unitario, valor_total, fornecedor, ' +
  'numero_documento, ocorrencia_no_documento, documento_controle_id, conta_como_compra, ' +
  'data_manual, insumo_id, fazenda_id, duplicata_confirmada_em, duplicata_confirmada_vezes'

export async function criarItemControleAvulso(
  novo: NovoItemControleAvulso,
  fazendaId: string,
): Promise<ResultadoCriarItemAvulso> {
  const { data, error } = await supabase
    .from('itens_nfe')
    .insert({
      ...novo,
      nota_fiscal_id:          null,
      documento_controle_id:   null,
      ocorrencia_no_documento: 0,
      insumo_id:               null,
      // Sempre false — mesma trava de editarItemControle.ts, mesmo motivo:
      // Controle é conferência, o gasto real vem só da NF-e.
      conta_como_compra:       false,
      fazenda_id:               fazendaId,
    })
    .select(COLUNAS)
    .single()

  if (error) return { status: 'erro', mensagem: error.message }

  return { status: 'criado', item: data as unknown as ItemControleRow }
}
