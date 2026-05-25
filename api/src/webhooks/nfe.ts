import { Router } from 'express'
import { processarNFe, nfeJaProcessada, type NFeData } from '../services/nfeProcessor'

export const nfeWebhook = Router()

// ─── Webhook NFE.io (legado — mantido caso futuramente tenha CNPJ) ───────────
nfeWebhook.post('/', async (req, res) => {
  res.status(200).json({ ok: true }) // Responder 200 imediatamente

  const payload = req.body

  try {
    const {
      number:     numero,
      issuedOn:   dataEmissao,
      issuerName: emitenteNome,
      issuerCnpj: emitenteCnpj,
      grandTotal: valorTotal,
      items = [],
    } = payload

    if (await nfeJaProcessada(numero)) {
      console.log(`[NFeWebhook] NF-e ${numero} já processada — ignorando.`)
      return
    }

    const nfe: NFeData = {
      numero,
      dataEmissao,
      emitenteNome,
      emitenteCnpj,
      valorTotal,
      items: (items as any[]).slice(0, 200).map((item: any) => ({
        description:  item.description || '',
        quantity:     item.quantity,
        unit:         item.unit,
        unitValue:    item.unitValue,
        totalValue:   item.totalValue,
        quantityTrib: item.quantityTrib ?? item.quantity,
        unitTrib:     item.unitTrib     ?? item.unit,
      })),
    }

    await processarNFe(nfe, 'webhook')

  } catch (err) {
    console.error('[NFeWebhook] Erro:', err instanceof Error ? err.message : err)
  }
})
