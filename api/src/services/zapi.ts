import https from 'https'

// Retorna config Z-API para a fazenda informada.
// Fallback para as vars genéricas (compatibilidade com env legado).
function getZapiConfig(fazendaCodigo: string) {
  const code = fazendaCodigo.toUpperCase()
  return {
    instance:    process.env[`ZAPI_INSTANCE_${code}`]     ?? process.env.ZAPI_INSTANCE_ID ?? '',
    token:       process.env[`ZAPI_TOKEN_${code}`]        ?? process.env.ZAPI_TOKEN       ?? '',
    clientToken: process.env[`ZAPI_CLIENT_TOKEN_${code}`] ?? process.env.ZAPI_CLIENT_TOKEN ?? '',
  }
}

export function getAuthorizedPhones(fazendaCodigo: string): string[] {
  const code = fazendaCodigo.toUpperCase()
  const raw = process.env[`WHATSAPP_AUTHORIZED_PHONES_${code}`]
    ?? process.env.WHATSAPP_AUTHORIZED_PHONES
    ?? ''
  return raw.split(',').map(p => p.trim()).filter(Boolean)
}

export async function enviarMensagem(
  phone: string,
  message: string,
  fazendaCodigo: string = 'mg',
): Promise<void> {
  const { instance, token, clientToken } = getZapiConfig(fazendaCodigo)
  const baseUrl = `https://api.z-api.io/instances/${instance}/token/${token}/send-text`

  const mensagemSegura = message.trim().slice(0, 4096)
  const body = JSON.stringify({ phone, message: mensagemSegura })

  return new Promise((resolve, reject) => {
    const url     = new URL(baseUrl)
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      timeout:  15_000,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Client-Token':   clientToken,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          console.error(`[Z-API][${fazendaCodigo}] Erro ${res.statusCode}:`, data.slice(0, 200))
        } else {
          console.log(`[Z-API][${fazendaCodigo}] Resposta ${res.statusCode}:`, data.slice(0, 200))
        }
        resolve()
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Z-API timeout')) })
    req.write(body)
    req.end()
  })
}
