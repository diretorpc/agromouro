import { supabase } from './supabase'
import { parseXmlNFe, nfeJaProcessada, processarNFe } from './nfeProcessor'

export type ResultadoImportacao =
  | { status: 'criada'; numero: string; emitenteNome: string; valorTotal: number }
  | { status: 'duplicada'; nota: { id: string; numero: string; data_emissao: string; emitente_nome: string } }
  | { status: 'invalida' }
  | { status: 'erro'; mensagem: string }

export async function importarXmlManual(xml: string, fazenda_id: string): Promise<ResultadoImportacao> {
  const nfe = parseXmlNFe(xml)
  if (!nfe) return { status: 'invalida' }

  const jaExiste = await nfeJaProcessada(nfe.numero, nfe.emitenteCnpj, fazenda_id)
  if (jaExiste) {
    const { data: notaExistente } = await supabase
      .from('notas_fiscais')
      .select('id, numero, data_emissao, emitente_nome')
      .eq('numero', nfe.numero)
      .eq('emitente_cnpj', nfe.emitenteCnpj)
      .eq('fazenda_id', fazenda_id)
      .maybeSingle()

    return {
      status: 'duplicada',
      // Fallback defensivo: nfeJaProcessada() já confirmou que existe, mas se
      // a linha sumir entre as duas consultas (janela mínima), não quebra —
      // devolve o que se sabe pelo próprio XML em vez de lançar erro.
      nota: notaExistente ?? { id: '', numero: nfe.numero, data_emissao: '', emitente_nome: nfe.emitenteNome },
    }
  }

  try {
    await processarNFe(nfe, 'manual', fazenda_id)
    return { status: 'criada', numero: nfe.numero, emitenteNome: nfe.emitenteNome, valorTotal: nfe.valorTotal }
  } catch (err) {
    return { status: 'erro', mensagem: err instanceof Error ? err.message : 'Erro desconhecido' }
  }
}

export type ResultadoExclusao =
  | { status: 'excluida' }
  | { status: 'nao_encontrada' }
  | { status: 'erro'; mensagem: string }

// Desfaz tudo que a nota criou, na ordem que respeita as referências entre
// tabelas. Se qualquer passo falhar, PARA ali — nunca segue apagando o resto
// e finge que deu certo (mesmo princípio de contas/cfop.ts: falhar ruidosamente
// é sempre melhor que silencioso).
export async function excluirNotaManual(notaId: string): Promise<ResultadoExclusao> {
  try {
    const { data: movimentacoes, error: errMov } = await supabase
      .from('movimentacoes_estoque')
      .select('insumo_id, tipo, quantidade')
      .eq('nota_fiscal_id', notaId)
    if (errMov) throw errMov

    // incrementar_estoque soma p_quantidade ao saldo — entrada devolve com
    // sinal negativo, saída (defensivo; não deveria existir vindo de NF-e)
    // devolve com sinal positivo.
    for (const mov of movimentacoes ?? []) {
      const delta = mov.tipo === 'entrada' ? -mov.quantidade : mov.quantidade
      const { error: errRpc } = await supabase.rpc('incrementar_estoque', {
        p_insumo_id:  mov.insumo_id,
        p_quantidade: delta,
      })
      if (errRpc) throw errRpc
    }

    const { error: errDelMov } = await supabase
      .from('movimentacoes_estoque')
      .delete()
      .eq('nota_fiscal_id', notaId)
    if (errDelMov) throw errDelMov

    const { error: errDelContas } = await supabase
      .from('contas_a_pagar')
      .delete()
      .eq('nota_fiscal_id', notaId)
    if (errDelContas) throw errDelContas

    const { error: errDelItens } = await supabase
      .from('itens_nfe')
      .delete()
      .eq('nota_fiscal_id', notaId)
    if (errDelItens) throw errDelItens

    const { data: deleted, error: errDelNota } = await supabase
      .from('notas_fiscais')
      .delete()
      .eq('id', notaId)
      .select('id')
    if (errDelNota) throw errDelNota
    if (!deleted || deleted.length === 0) return { status: 'nao_encontrada' }

    return { status: 'excluida' }
  } catch (err) {
    console.error('[NFeManual] Erro ao excluir nota:', err instanceof Error ? err.message : err)
    return { status: 'erro', mensagem: err instanceof Error ? err.message : 'Erro desconhecido' }
  }
}
