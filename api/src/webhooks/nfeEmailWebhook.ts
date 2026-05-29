import { Router } from 'express'
import { supabase } from '../services/supabase'
import { parseXmlNFe, nfeJaProcessada, processarNFe } from '../services/nfeProcessor'

export const nfeEmailWebhook = Router()

nfeEmailWebhook.post('/', async (req, res) => {
  res.status(200).json({ ok: true })

  try {
    // Identificar fazenda pelo query param (Make.com adiciona ?fazenda=mg na URL)
    const fazenda_codigo = (req.query.fazenda as string) ?? 'mg'

    const { data: fazenda } = await supabase
      .from('fazendas')
      .select('id, codigo')
      .eq('codigo', fazenda_codigo)
      .single()

    if (!fazenda) {
      console.error(`[NFeEmail] Fazenda não encontrada: ${fazenda_codigo}`)
      return
    }

    const xmlStr: string = Buffer.isBuffer(req.body)
      ? req.body.toString('utf-8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body)

    if (!xmlStr || xmlStr.length < 100) {
      console.warn('[NFeEmail] Body vazio ou muito curto — ignorando.')
      return
    }

    const nfe = parseXmlNFe(xmlStr)
    if (!nfe) {
      console.warn('[NFeEmail] XML não é uma NF-e válida.')
      return
    }

    if (await nfeJaProcessada(nfe.numero, fazenda.id)) {
      console.log(`[NFeEmail] NF-e ${nfe.numero} já processada para ${fazenda_codigo} — ignorando.`)
      return
    }

    console.log(`[NFeEmail][${fazenda_codigo}] Processando NF-e ${nfe.numero}...`)
    await processarNFe(nfe, 'email', fazenda.id)
    console.log(`[NFeEmail][${fazenda_codigo}] NF-e ${nfe.numero} processada.`)

  } catch (err) {
    console.error('[NFeEmail] Erro:', err instanceof Error ? err.message : err)
  }
})
