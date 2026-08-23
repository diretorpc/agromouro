import { supabase } from '../supabase'
import { contasDoContrato } from './deContrato'
import type { DocumentoLido } from '../controle/documentoPdf'

// Grava no banco as contas montadas por deContrato.ts.
//
// NUNCA estoura: quem chama (gravarDocumentoPdf.ts) já gravou o documento e
// os itens quando chega aqui, e perder tudo isso por causa de uma conta a
// pagar seria trocar um problema pequeno (o dono digita o vencimento à mão)
// por um grande (reimportar o PDF inteiro). Todo erro vira texto no
// resultado, para a tela avisar.

export type ResultadoContasContrato = {
  criadas:    number
  duplicadas: number
  erro:       string | null
}

export async function gravarContasDoContrato(
  documento: DocumentoLido,
  documentoId: string,
  fazendaId: string,
): Promise<ResultadoContasContrato> {
  const contas = contasDoContrato(documento, documentoId)
  if (contas.length === 0) return { criadas: 0, duplicadas: 0, erro: null }

  let criadas = 0
  let duplicadas = 0
  let erro: string | null = null

  // Uma por vez, não em lote: um INSERT em lote é UMA instrução SQL, e um
  // único 23505 (parcela já gravada numa importação anterior) derrubaria as
  // outras parcelas junto — mesma lição já aprendida em
  // gravarDocumentoPdf.ts/inserirItensUmAUm.
  for (const conta of contas) {
    const { error } = await supabase
      .from('contas_a_pagar')
      .insert({ ...conta, fazenda_id: fazendaId })

    if (!error) { criadas++; continue }

    if (error.code === '23505') {
      // Índice contas_a_pagar_contrato_unico (migration 012): esta parcela
      // deste documento, neste vencimento, já existe. Reimportação normal.
      duplicadas++
      continue
    }

    // Erro de verdade (RLS, conexão): registra o PRIMEIRO e continua tentando
    // as demais parcelas — uma pode falhar por motivo pontual enquanto as
    // outras passam, e o dono prefere 2 contas de 3 a nenhuma.
    console.error(`[ContasDoContrato] Erro ao gravar conta ${conta.vencimento}:`, error.message)
    erro ??= error.message
  }

  console.log(
    `[ContasDoContrato] documento ${documentoId}: ${criadas} conta(s) criada(s), ` +
    `${duplicadas} já existente(s)${erro ? `, com erro: ${erro}` : ''}.`,
  )

  return { criadas, duplicadas, erro }
}
