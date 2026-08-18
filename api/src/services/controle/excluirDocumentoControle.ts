import { supabase } from '../supabase'

// Mesmo nome de bucket usado em controle.ts e gravarDocumentoPdf.ts.
const BUCKET = 'controle-documentos'

export type ResultadoExclusaoDocumento =
  | { status: 'excluido' }
  | { status: 'nao_encontrado' }
  | { status: 'erro'; mensagem: string }

// Diferente de excluir_nota_fiscal (migration 009_excluir_nota_fiscal.sql),
// este documento NÃO tem função atômica própria no Postgres — de propósito,
// não por descuido. Item importado de PDF de Controle nunca mexe em estoque
// nem gera lançamento financeiro: `conta_como_compra` é sempre `false` pra
// linha vinda daqui (Controle é conferência; o gasto de verdade continua
// vindo só da NF-e — ver comentário da migration 017). Não existe nada pra
// "desfazer" se a segunda escrita falhar depois da primeira ter sido
// confirmada: o pior cenário de uma falha no meio destas duas é um
// documento sem item nenhum — e esse caso JÁ é aceito e mostrado na tela
// (`GET /controle/documentos`, "nenhum item novo — documento já importado
// antes"), não é dado financeiro incoerente. Criar uma função nova só pra
// isto custaria um passo de deploy manual (colar SQL no Supabase) sem
// reduzir nenhum risco real — ver CLAUDE.md, "caminho mais simples primeiro".
export async function excluirDocumentoControle(
  documentoId: string,
  fazendaId: string,
): Promise<ResultadoExclusaoDocumento> {
  const { data: documento, error: errBusca } = await supabase
    .from('documentos_controle')
    .select('id, arquivo_path')
    .eq('id', documentoId)
    .eq('fazenda_id', fazendaId)
    .maybeSingle()

  if (errBusca) {
    console.error('[Controle] Falha ao buscar documento para exclusão:', errBusca.message)
    return { status: 'erro', mensagem: errBusca.message }
  }
  // Também cobre documento de OUTRA fazenda: o filtro .eq('fazenda_id', ...)
  // acima faz a linha não aparecer, então chega aqui como "não encontrado" —
  // nunca revela que o id existe em outro tenant.
  if (!documento) return { status: 'nao_encontrado' }

  // Itens ANTES do documento: `itens_nfe_doc_controle_fk` (migration 017) é
  // ON DELETE RESTRICT de propósito — apagar um documento com item já
  // gravado exige decisão explícita, não pode ser cascata silenciosa. Apagar
  // na ordem errada (documento primeiro) falha com violação de FK.
  const { error: errItens } = await supabase
    .from('itens_nfe')
    .delete()
    .eq('documento_controle_id', documentoId)
    .eq('fazenda_id', fazendaId)

  if (errItens) {
    console.error('[Controle] Falha ao excluir itens do documento:', errItens.message)
    return { status: 'erro', mensagem: errItens.message }
  }

  const { error: errDocumento } = await supabase
    .from('documentos_controle')
    .delete()
    .eq('id', documentoId)
    .eq('fazenda_id', fazendaId)

  if (errDocumento) {
    // Achado do Apolo: os itens JÁ FORAM apagados nesta altura — devolver só
    // o erro e deixar a linha de documentos_controle como estava (parada em
    // 'processado'/'importado') faz a tela mentir. `GET /` mostraria "nenhum
    // item novo — documento já importado antes" (a frase pensada pra
    // REIMPORTAÇÃO, migration 018), quando na verdade os itens foram
    // DESTRUÍDOS agora e não estão em lugar nenhum. Marca 'erro' — mesmo
    // recurso que marcarDocumentoComErro usa em gravarDocumentoPdf.ts — pra
    // a tela mostrar o selo de erro em vez da frase de reimportação, e pra
    // não fingir que o documento ainda representa os itens originais.
    console.error('[Controle] Itens já excluídos, mas falha ao excluir o documento — marcando como erro:', errDocumento.message)
    const mensagemErro = `Exclusão incompleta: os itens foram removidos, mas o documento não. Motivo: ${errDocumento.message}`
    const { error: errMarcar } = await supabase
      .from('documentos_controle')
      .update({ status: 'erro', erro_mensagem: mensagemErro })
      .eq('id', documentoId)
      .eq('fazenda_id', fazendaId)
    if (errMarcar) {
      // Documento fica com status desatualizado (não reflete o erro real) —
      // logar é o máximo que dá pra fazer aqui, mesmo padrão de
      // marcarDocumentoComErro em gravarDocumentoPdf.ts.
      console.error('[Controle] Falha ao marcar documento como erro após exclusão incompleta:', errMarcar.message)
    }
    return { status: 'erro', mensagem: mensagemErro }
  }

  // Best-effort: a linha que apontava pro PDF acabou de sumir, então nada na
  // tela referencia mais este objeto do bucket. Falhar aqui não desfaz a
  // exclusão já confirmada no banco (não faz sentido reverter um DELETE que
  // deu certo por causa de limpeza de arquivo) — só sobra um PDF órfão no
  // Storage, que não aparece em tela nenhuma e não é dinheiro. Fica registrado
  // no log pra limpeza manual eventual, não bloqueia a resposta ao usuário.
  const { error: errStorage } = await supabase.storage.from(BUCKET).remove([documento.arquivo_path])
  if (errStorage) {
    console.error('[Controle] Documento excluído do banco, mas falha ao remover PDF do Storage:', errStorage.message)
  }

  return { status: 'excluido' }
}
