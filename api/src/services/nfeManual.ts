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
