import https from 'https'
import { supabase } from '../services/supabase'

function httpsGetJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 15_000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// Futuros CBOT: preços em USX (centavos de dólar) por bushel
// Soja ZS=F | Milho ZC=F | Trigo ZW=F
const COMMODITIES = [
  { nome: 'soja',  ticker: 'ZS%3DF', kgPerBushel: 27.215 },
  { nome: 'milho', ticker: 'ZC%3DF', kgPerBushel: 25.401 },
  { nome: 'trigo', ticker: 'ZW%3DF', kgPerBushel: 27.215 },
]

export interface ResultadoCotacoes {
  salvos: number
  erros: string[]
}

// Busca a cotação USD/BRL com fallback entre fontes. A awesomeapi é a melhor
// (tempo real, BR), mas bloqueia IPs de datacenter (ex: Railway) — daí o
// fallback para open.er-api.com, que é feita para uso server-side.
async function buscarUsdBrl(): Promise<number> {
  // Fonte 1: awesomeapi (tempo real) — parse defensivo, não crasha se vier vazio
  try {
    const r = await httpsGetJson('https://economia.awesomeapi.com.br/json/last/USD-BRL') as { USDBRL?: { bid?: string } }
    const v = parseFloat(r?.USDBRL?.bid ?? '')
    if (v > 0) return v
    console.warn('[Cotações] awesomeapi: shape inesperado, tentando fallback')
  } catch (err) {
    console.warn('[Cotações] awesomeapi falhou:', err instanceof Error ? err.message : err)
  }

  // Fonte 2: open.er-api.com (sem key, server-friendly)
  try {
    const r = await httpsGetJson('https://open.er-api.com/v6/latest/USD') as { result?: string; rates?: { BRL?: number } }
    const v = r?.rates?.BRL
    if (r?.result === 'success' && typeof v === 'number' && v > 0) return v
    console.warn('[Cotações] open.er-api: shape inesperado')
  } catch (err) {
    console.warn('[Cotações] open.er-api falhou:', err instanceof Error ? err.message : err)
  }

  throw new Error('nenhuma fonte de câmbio USD/BRL respondeu')
}

export async function buscarCotacoes(): Promise<ResultadoCotacoes> {
  const hoje = new Date().toISOString().slice(0, 10)
  const erros: string[] = []
  let salvos = 0

  // Busca taxa USD/BRL — sem ela não dá para converter os futuros CBOT
  let usdBrl: number
  try {
    usdBrl = await buscarUsdBrl()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Cotações] Erro ao buscar USD/BRL:', msg)
    return { salvos: 0, erros: [`câmbio USD/BRL: ${msg}`] }
  }

  for (const commodity of COMMODITIES) {
    try {
      const data = await httpsGetJson(
        `https://query2.finance.yahoo.com/v8/finance/chart/${commodity.ticker}?range=1d&interval=1d`
      ) as { chart: { result: { meta: { regularMarketPrice: number } }[] } }

      const priceUSX = data?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (!priceUSX || priceUSX <= 0) {
        console.warn(`[Cotações] Preço não encontrado para ${commodity.nome}`)
        erros.push(`${commodity.nome}: preço não encontrado`)
        continue
      }

      // Converter USX/bushel → BRL/saca (saca = 60 kg)
      const precoBrl = (priceUSX / 100) * (60 / commodity.kgPerBushel) * usdBrl

      const { error } = await supabase
        .from('cotacoes_commodities')
        .upsert(
          { commodity: commodity.nome, preco_rs: parseFloat(precoBrl.toFixed(2)), data: hoje },
          { onConflict: 'commodity,data' }
        )

      if (error) {
        console.error(`[Cotações] Erro ao salvar ${commodity.nome}:`, error.message)
        erros.push(`${commodity.nome}: ${error.message}`)
      } else {
        salvos++
        console.log(`[Cotações] ${commodity.nome}: R$ ${precoBrl.toFixed(2)}/sc (CBOT ref · ${hoje})`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Cotações] Erro ao buscar ${commodity.nome}:`, msg)
      erros.push(`${commodity.nome}: ${msg}`)
    }
  }

  return { salvos, erros }
}
