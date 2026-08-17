import { supabase } from './supabase'
import { parseXmlNota, nfeJaProcessada, processarNFe } from './nfeProcessor'

export type ResultadoImportacao =
  | { status: 'criada'; numero: string; emitenteNome: string; valorTotal: number }
  | { status: 'duplicada'; nota: { id: string; numero: string; data_emissao: string; emitente_nome: string } }
  | { status: 'invalida' }
  | { status: 'erro'; mensagem: string }

export async function importarXmlManual(xml: string, fazenda_id: string): Promise<ResultadoImportacao> {
  const nfe = parseXmlNota(xml)
  if (!nfe) return { status: 'invalida' }

  const jaExiste = await nfeJaProcessada(nfe.numero, nfe.emitenteCnpj, fazenda_id, nfe.modelo)
  if (jaExiste) {
    const { data: notaExistente } = await supabase
      .from('notas_fiscais')
      .select('id, numero, data_emissao, emitente_nome')
      .eq('numero', nfe.numero)
      .eq('emitente_cnpj', nfe.emitenteCnpj)
      .eq('fazenda_id', fazenda_id)
      .eq('modelo', nfe.modelo)
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
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido'

    // ACHADO 2 (revisão do Apolo, 05/08/2026): processarNFe grava a nota como
    // PRIMEIRO passo (status 'processando'), antes de tocar em qualquer item —
    // não depois de terminar, como o design original desta função assumia
    // (errado, corrigido aqui). Se o processamento falhar no meio (ex.: a IA
    // de classificação fora do ar), a casca fica no banco com status 'erro' e
    // NUNCA é removida. Quando a nota de verdade chegar depois por e-mail,
    // nfeJaProcessada() só confere se a nota EXISTE — acha a casca, e ignora a
    // nota real para sempre (o mesmo envenenamento que este trabalho existe
    // para fechar, só que agora escondido no caminho de erro). Por isso: se
    // processarNFe falhou, procurar a casca pela mesma chave que ele usa
    // (número + CNPJ + fazenda) e apagar antes de devolver o erro.
    const { data: notaFalha } = await supabase
      .from('notas_fiscais')
      .select('id')
      .eq('numero', nfe.numero)
      .eq('emitente_cnpj', nfe.emitenteCnpj)
      .eq('fazenda_id', fazenda_id)
      .eq('modelo', nfe.modelo)
      .maybeSingle()

    if (notaFalha) {
      const { error: errLimpeza } = await supabase.rpc('excluir_nota_fiscal', {
        p_nota_id:    notaFalha.id,
        p_fazenda_id: fazenda_id,
      })
      if (errLimpeza) {
        // Não é para acontecer (nota recém-criada não tem boleto pago nem
        // está 'processando' de novo) — mas se acontecer, falha ruidosamente
        // no log em vez de mascarar a falha original.
        console.error('[NFeManual] Falha ao limpar nota após erro de processamento:', errLimpeza.message)
      }
    }

    return { status: 'erro', mensagem }
  }
}

export type ResultadoExclusao =
  | { status: 'excluida' }
  | { status: 'nao_encontrada' }
  | { status: 'em_processamento' }
  | { status: 'boleto_pago' }
  | { status: 'erro'; mensagem: string }

// ACHADOS 1, 3 e 5 (revisão do Apolo, 05/08/2026): a versão anterior desta
// função apagava em vários passos separados, do lado do Node — sem
// transação (falha no meio podia devolver o mesmo estoque duas vezes numa
// segunda tentativa), sem apagar o lançamento financeiro (gasto fantasma
// ficava para sempre no Dashboard), e sem checar se o boleto já tinha sido
// pago (apagava o único rastro do pagamento). A exclusão inteira agora é
// UMA função no Postgres (migration 009_excluir_nota_fiscal.sql) — ou tudo
// acontece, ou nada acontece. Esta função só traduz o resultado.
export async function excluirNotaManual(notaId: string, fazendaId: string): Promise<ResultadoExclusao> {
  const { error } = await supabase.rpc('excluir_nota_fiscal', {
    p_nota_id:    notaId,
    p_fazenda_id: fazendaId,
  })

  if (!error) return { status: 'excluida' }

  const msg = error.message ?? ''
  if (msg.includes('nota_nao_encontrada'))   return { status: 'nao_encontrada' }
  if (msg.includes('nota_em_processamento')) return { status: 'em_processamento' }
  if (msg.includes('boleto_ja_pago'))        return { status: 'boleto_pago' }

  console.error('[NFeManual] Erro ao excluir nota:', msg)
  return { status: 'erro', mensagem: msg }
}
