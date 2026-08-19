import { supabase } from '../supabase'

// Apaga UM item de Controle — diferente de excluirDocumentoControle.ts, que
// apaga o documento inteiro (e todos os itens dele). Existe porque a tela
// editável estilo Excel (decisão travada nº 2 do Matheus) permite apagar
// QUALQUER linha da grade, sem distinguir se ela veio de PDF importado ou
// foi digitada avulsa.
//
// ⚠️ RISCO ACEITO, DOCUMENTADO (decisão travada, não um bug a corrigir):
// apagar um item importado de PDF (`documento_controle_id not null`) libera
// a chave de dedupe `idx_itens_nfe_dedupe_item` (migration 018) — o índice
// só barra ENQUANTO a linha existe. Reimportar o MESMO extrato depois pode
// trazer essa linha de volta, porque a trava não "lembra" de uma linha
// apagada. Ver docs/superpowers/specs/2026-08-18-controle-tabela-editavel-
// design.md, seção "DELETE /controle/itens/:id".

export type ResultadoExcluirItem =
  | { status: 'excluido' }
  | { status: 'nao_encontrado' }
  | { status: 'erro'; mensagem: string }

export async function excluirItemControle(itemId: string, fazendaId: string): Promise<ResultadoExcluirItem> {
  // Mesmo cuidado de editarItemControle.ts: confirma fazenda E
  // `nota_fiscal_id is null` ANTES de apagar — item de NF-e tem exclusão
  // própria (DELETE /nfe/:id, migration 009, que desfaz estoque/lançamento
  // em cascata). Apagar um item de NF-e por aqui deixaria o resto da nota
  // (estoque, lançamento financeiro) órfão, sem o desfazer que aquela rota
  // faz.
  const { data: existente, error: errBusca } = await supabase
    .from('itens_nfe')
    .select('id')
    .eq('id', itemId)
    .eq('fazenda_id', fazendaId)
    .is('nota_fiscal_id', null)
    .maybeSingle()

  if (errBusca) return { status: 'erro', mensagem: errBusca.message }
  if (!existente) return { status: 'nao_encontrado' }

  const { error: errDelete } = await supabase
    .from('itens_nfe')
    .delete()
    .eq('id', itemId)
    .eq('fazenda_id', fazendaId)

  if (errDelete) return { status: 'erro', mensagem: errDelete.message }

  return { status: 'excluido' }
}
