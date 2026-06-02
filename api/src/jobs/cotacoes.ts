import https from 'https'
import { IncomingMessage } from 'http'
import { supabase } from '../services/supabase'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const doGet = (targetUrl: string) => {
      const req = https.get(targetUrl, {
        timeout: 15_000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
      }, (res: IncomingMessage) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location)
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')))
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    }
    doGet(url)
  })
}

// Extrai o preço à vista em R$/saca da página CEPEA
function extrairPreco(html: string): number | null {
  // CEPEA tabelas: linha com data + preço à vista
  // Tenta capturar o primeiro número decimal no formato brasileiro após "À Vista"
  const patterns = [
    // Padrão principal: coluna "À Vista (R$)" na tabela
    /vista[^<]{0,200}?<td[^>]*>\s*([\d]+[.,][\d]{2})\s*<\/td>/is,
    // Alternativa: qualquer célula com número de preço típico de grãos (R$30-R$300/saca)
    /id="[^"]*table[^"]*"[^>]*>.*?<td[^>]*>\s*(\d{2,3},\d{2})\s*<\/td>/is,
    // Last resort: primeiro número entre 30 e 500 com 2 casas decimais
    />\s*((?:[1-4]\d{2}|[3-9]\d),\d{2})\s*</,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      const preco = parseFloat(match[1].replace(/\./g, '').replace(',', '.'))
      if (!isNaN(preco) && preco > 10 && preco < 2000) return preco
    }
  }
  return null
}

const COMMODITIES = [
  { nome: 'soja',  url: 'https://www.cepea.esalq.usp.br/br/cotacoes/soja.aspx' },
  { nome: 'milho', url: 'https://www.cepea.esalq.usp.br/br/cotacoes/milho.aspx' },
  { nome: 'trigo', url: 'https://www.cepea.esalq.usp.br/br/cotacoes/trigo.aspx' },
]

export async function buscarCotacoes(): Promise<void> {
  const hoje = new Date().toISOString().slice(0, 10)

  for (const commodity of COMMODITIES) {
    try {
      const html = await httpsGet(commodity.url)
      const preco = extrairPreco(html)

      if (preco === null) {
        console.warn(`[Cotações] Preço não encontrado para ${commodity.nome} — verifique o HTML da CEPEA.`)
        continue
      }

      const { error } = await supabase
        .from('cotacoes_commodities')
        .upsert(
          { commodity: commodity.nome, preco_rs: preco, data: hoje },
          { onConflict: 'commodity,data' }
        )

      if (error) {
        console.error(`[Cotações] Erro ao salvar ${commodity.nome}:`, error.message)
      } else {
        console.log(`[Cotações] ${commodity.nome}: R$ ${preco.toFixed(2)}/sc (${hoje})`)
      }
    } catch (err) {
      console.error(`[Cotações] Erro ao buscar ${commodity.nome}:`, err instanceof Error ? err.message : err)
    }
  }
}
