import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

/**
 * Valida que o webhook veio de uma origem legítima (NFE.io ou Z-API),
 * comparando a assinatura HMAC enviada no header com o WEBHOOK_SECRET local.
 *
 * NFE.io envia: header x-nfeio-signature = HMAC-SHA256(body, secret)
 * Z-API envia:  header x-z-api-token = WEBHOOK_SECRET configurado no painel
 *
 * Qualquer request sem assinatura válida é rejeitado com 401.
 */

const SECRET = process.env.WEBHOOK_SECRET!

// ─── Validação para NFE.io (HMAC-SHA256) ─────────────────────────────────────
export function validateNfeWebhook(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers['x-nfeio-signature'] as string | undefined

  if (!signature) {
    console.warn('[NFe] Webhook recebido sem assinatura — bloqueado')
    return res.status(401).json({ error: 'Assinatura ausente' })
  }

  try {
    const body    = JSON.stringify(req.body)
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(body)
      .digest('hex')

    // Comparação em tempo constante para evitar timing attacks
    const sigBuffer = Buffer.from(signature)
    const expBuffer = Buffer.from(expected)

    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      console.warn('[NFe] Assinatura inválida — bloqueado')
      return res.status(401).json({ error: 'Assinatura inválida' })
    }

    next()
  } catch {
    res.status(401).json({ error: 'Falha na validação da assinatura' })
  }
}

// ─── Validação para Z-API (token fixo no header) ──────────────────────────────
export function validateZapiWebhook(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-z-api-token'] as string | undefined

  if (!token) {
    console.warn('[WhatsApp] Webhook recebido sem token — bloqueado')
    return res.status(401).json({ error: 'Token ausente' })
  }

  // Comparação em tempo constante
  const tokenBuffer  = Buffer.from(token)
  const secretBuffer = Buffer.from(SECRET)

  if (tokenBuffer.length !== secretBuffer.length || !crypto.timingSafeEqual(tokenBuffer, secretBuffer)) {
    console.warn('[WhatsApp] Token inválido — bloqueado')
    return res.status(401).json({ error: 'Token inválido' })
  }

  next()
}
