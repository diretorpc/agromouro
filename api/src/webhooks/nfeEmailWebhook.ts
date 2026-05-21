import { Router } from 'express'
import { parseXmlNFe, nfeJaProcessada, processarNFe } from '../services/nfeProcessor'

export const nfeEmailWebhook = Router()

// ─── Recebe XML de NF-e enviado pelo n8n ─────────────────────────────────────
// n8n envia o arquivo como binary (application/octet-stream ou text/xml)
nfeEmailWebhook.post('/', async (req, res) => {
  res.status(200).json({ ok: true }) // Responder 200 imediatamente

  try {
    // Suporta body como Buffer (binary) ou string (text/xml)
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
      console.warn('[NFeEmail] XML recebido não é uma NF-e válida.')
      return
    }

    if (await nfeJaProcessada(nfe.numero)) {
      console.log(`[NFeEmail] NF-e ${nfe.numero} já processada — ignorando.`)
      return
    }

    console.log(`[NFeEmail] Processando NF-e ${nfe.numero} de ${nfe.emitenteNome}...`)
    await processarNFe(nfe, 'email')
    console.log(`[NFeEmail] NF-e ${nfe.numero} processada com sucesso.`)

  } catch (err) {
    console.error('[NFeEmail] Erro:', err instanceof Error ? err.message : err)
  }
})
