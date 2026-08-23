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
  // Important 3 da revisão final da branch do contrato de adubo
  // (23/08/2026): o item veio de um documento que TEM conta a pagar ainda
  // não encerrada. Apagar aqui faria R$ 647.986,35 sumirem das três telas —
  // ver o comentário grande do bloco que devolve este status.
  | { status: 'divida_em_aberto' }
  | { status: 'erro'; mensagem: string }

// "Ainda em aberto" = ainda vai sair dinheiro. `paga` e `dispensada` são os
// dois desfechos ENCERRADOS de contas_a_pagar (CHECK da migration 004) — com
// a conta encerrada, apagar o item não esconde dívida nenhuma.
const STATUS_EM_ABERTO = ['aguardando', 'aberta']

export async function excluirItemControle(itemId: string, fazendaId: string): Promise<ResultadoExcluirItem> {
  // Mesmo cuidado de editarItemControle.ts: confirma fazenda E
  // `nota_fiscal_id is null` ANTES de apagar — item de NF-e tem exclusão
  // própria (DELETE /nfe/:id, migration 009, que desfaz estoque/lançamento
  // em cascata). Apagar um item de NF-e por aqui deixaria o resto da nota
  // (estoque, lançamento financeiro) órfão, sem o desfazer que aquela rota
  // faz.
  const { data: existente, error: errBusca } = await supabase
    .from('itens_nfe')
    .select('id, documento_controle_id')
    .eq('id', itemId)
    .eq('fazenda_id', fazendaId)
    .is('nota_fiscal_id', null)
    .maybeSingle()

  if (errBusca) return { status: 'erro', mensagem: errBusca.message }
  if (!existente) return { status: 'nao_encontrado' }

  // ⚠️ TRAVA DE DINHEIRO (Important 3, 23/08/2026) — não é zelo excessivo,
  // é o único ponto que impede R$ 647.986,35 de sumirem por completo.
  //
  // Desde a branch do contrato de adubo, o item de um documento tipo
  // 'contrato' carrega `conta_como_compra: true`: ele É o gasto no
  // Financeiro (a Mosaic nunca manda NF-e). E o mesmo documento gerou uma
  // conta em contas_a_pagar com `documento_controle_id` preenchido.
  //
  // Apagar só o item deixava o pior de dois mundos:
  //   1. o gasto sai do Financeiro na hora (o item era a fonte);
  //   2. a conta a pagar SOBREVIVE vinculada — `on delete set null`
  //      (migration 012) só solta a conta quando o DOCUMENTO é apagado, e
  //      aqui o documento fica de pé;
  //   3. como ela continua com `documento_controle_id`,
  //      `precisaCriarLancamento` (contas/pagamento.ts) recusa criar o
  //      lançamento quando ela for paga — de propósito, para não dobrar o
  //      gasto que o item trazia.
  // Resultado: paga-se a conta e o dinheiro não aparece em lugar nenhum.
  //
  // Recusar é a correção mais barata (a alternativa era reescrever
  // `precisaCriarLancamento` para reconferir o item, ampliando a superfície
  // da trava que protege os R$ 2,77 mi). O dono tem duas saídas claras, ditas
  // na mensagem da rota: dispensar/pagar a conta antes, ou apagar o
  // documento inteiro pela tela do Controle.
  if (existente.documento_controle_id !== null && existente.documento_controle_id !== undefined) {
    const { data: contaAberta, error: errConta } = await supabase
      .from('contas_a_pagar')
      .select('id')
      .eq('documento_controle_id', existente.documento_controle_id)
      .eq('fazenda_id', fazendaId)
      .in('status', STATUS_EM_ABERTO)
      .limit(1)
      .maybeSingle()

    // Falhar a consulta NÃO libera a exclusão. "Não sei se há dívida" tem
    // que se comportar como "há" — recusar é reversível (o dono tenta de
    // novo), apagar não é.
    if (errConta) {
      console.error('[Controle] Falha ao conferir conta a pagar antes de excluir item:', errConta.message)
      return { status: 'erro', mensagem: errConta.message }
    }
    if (contaAberta) return { status: 'divida_em_aberto' }
  }

  const { error: errDelete } = await supabase
    .from('itens_nfe')
    .delete()
    .eq('id', itemId)
    .eq('fazenda_id', fazendaId)

  if (errDelete) return { status: 'erro', mensagem: errDelete.message }

  return { status: 'excluido' }
}
