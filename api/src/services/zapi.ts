import https from 'https'

// FIX #12 — token não fica na URL (ficaria em logs de proxy/servidor).
// A instância fica na URL (não é segredo), o token vai no header Client-Token.
const INSTANCE = process.env.ZAPI_INSTANCE_ID!
const TOKEN    = process.env.ZAPI_TOKEN!
// Z-API: token obrigatório no caminho da URL
const BASE_URL = `https://api.z-api.io/instances/${INSTANCE}/token/${TOKEN}/send-text`

// ─── Enviar mensagem de texto ─────────────────────────────────────────────────
export async function enviarMensagem(phone: string, message: string): Promise<void> {
  // Sanitização básica antes de enviar
  const mensagemSegura = message.trim().slice(0, 4096) // limite do WhatsApp
  const body = JSON.stringify({ phone, message: mensagemSegura })

  return new Promise((resolve, reject) => {
    const url     = new URL(BASE_URL)
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      timeout:  15_000,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          console.error(`[Z-API] Erro ${res.statusCode} ao enviar mensagem:`, data.slice(0, 200))
        } else {
          console.log(`[Z-API] Mensagem enviada — status ${res.statusCode}`)
        }
        resolve()
      })
    })

    req.on('timeout', () => {
      req.destroy()
      console.error('[Z-API] Timeout ao enviar mensagem')
      resolve() // resolve mesmo com timeout — não bloquear o fluxo principal
    })

    req.on('error', (err) => {
      console.error('[Z-API] Erro de rede:', err.message)
      resolve() // idem — falha no envio não deve derrubar o processamento
    })

    req.write(body)
    req.end()
  })
}
