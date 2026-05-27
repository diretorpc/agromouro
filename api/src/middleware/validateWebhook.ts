import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

/**
 * Valida que o webhook veio de uma origem legítima (NFE.io, n8n/Make ou Z-API),
 * comparando a assinatura/token enviado no header com o segredo correspondente.
 *
 * NFE.io envia: header x-nfeio-signature = HMAC-SHA256(body, WEBHOOK_SECRET)
 * n8n/Make:     header x-webhook-secret  = WEBHOOK_SECRET
 * Z-API envia:  header Client-Token      = ZAPI_CLIENT_TOKEN configurado na conta Z-API
 *
 * Qualquer request sem assinatura válida é rejeitado com 401.
 */

const SECRET            = process.env.WEBHOOK_SECRET!
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN ?? ''

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

// ─── Validação para n8n (token fixo no header x-webhook-secret) ──────────────
export function validateN8nWebhook(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-webhook-secret'] as string | undefined

  if (!token) {
    console.warn('[n8n] Webhook recebido sem secret — bloqueado')
    return res.status(401).json({ error: 'Assinatura ausente' })
  }

  const tokenBuffer  = Buffer.from(token)
  const secretBuffer = Buffer.from(SECRET)

  if (tokenBuffer.length !== secretBuffer.length || !crypto.timingSafeEqual(tokenBuffer, secretBuffer)) {
    console.warn('[n8n] Secret inválido — bloqueado')
    return res.status(401).json({ error: 'Assinatura inválida' })
  }

  next()
}

// ─── Validação para Z-API (header padrão Client-Token) ────────────────────────
export function validateZapiWebhook(req: Request, res: Response, next: NextFunction) {
  if (!ZAPI_CLIENT_TOKEN) {
    console.error('[WhatsApp] ZAPI_CLIENT_TOKEN não configurada no servidor — bloqueado')
    return res.status(500).json({ error: 'Configuração do servidor incompleta' })
  }

  // Z-API envia o token em "Client-Token" (Express normaliza para lowercase)
  const token = req.headers['client-token'] as string | undefined

  if (!token) {
    console.warn('[WhatsApp] Webhook recebido sem token — bloqueado')
    return res.status(401).json({ error: 'Token ausente' })
  }

  // Comparação em tempo constante
  const tokenBuffer  = Buffer.from(token)
  const secretBuffer = Buffer.from(ZAPI_CLIENT_TOKEN)

  if (tokenBuffer.length !== secretBuffer.length || !crypto.timingSafeEqual(tokenBuffer, secretBuffer)) {
    console.warn('[WhatsApp] Token inválido — bloqueado')
    return res.status(401).json({ error: 'Token inválido' })
  }

  next()
}
