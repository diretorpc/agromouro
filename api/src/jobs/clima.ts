import https from 'https'
import { supabase } from '../services/supabase'

interface OpenMeteoDay {
  date: string
  tempMin: number
  precipitation: number
  windspeed: number
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function buscarPrevisao(lat: number, lng: number): Promise<OpenMeteoDay[]> {
  const url = [
    'https://api.open-meteo.com/v1/forecast',
    `?latitude=${lat}&longitude=${lng}`,
    '&daily=temperature_2m_min,precipitation_sum,windspeed_10m_max',
    '&forecast_days=7&timezone=America%2FSao_Paulo',
  ].join('')

  const raw = await httpsGet(url)
  const json = JSON.parse(raw)
  const { time, temperature_2m_min, precipitation_sum, windspeed_10m_max } = json.daily

  return (time as string[]).map((date: string, i: number) => ({
    date,
    tempMin:       temperature_2m_min[i] as number,
    precipitation: precipitation_sum[i]   as number,
    windspeed:     windspeed_10m_max[i]   as number,
  }))
}

export async function buscarClimaFazendas(): Promise<void> {
  const { data: fazendas, error } = await supabase
    .from('fazendas')
    .select('id, nome, lat, lng')
    .not('lat', 'is', null)
    .not('lng', 'is', null)

  if (error || !fazendas?.length) {
    console.warn('[Clima] Nenhuma fazenda com coordenadas — pulando.')
    return
  }

  for (const fazenda of fazendas) {
    try {
      const previsao = await buscarPrevisao(fazenda.lat as number, fazenda.lng as number)
      const novos: Record<string, unknown>[] = []

      for (const dia of previsao) {
        const dataFmt = dia.date.split('-').reverse().join('/')
        const candidatos: Array<{ tipo: string; titulo: string; mensagem: string; nivel: string }> = []

        if (dia.tempMin < 2) {
          candidatos.push({
            tipo:    'geada',
            titulo:  `Risco de Geada — ${dataFmt}`,
            mensagem: `Temperatura mínima prevista: ${dia.tempMin.toFixed(1)}°C. Alto risco de geada.`,
            nivel:   'critico',
          })
        }

        if (dia.precipitation > 30) {
          candidatos.push({
            tipo:    'chuva_intensa',
            titulo:  `Chuva Intensa — ${dataFmt}`,
            mensagem: `${dia.precipitation.toFixed(0)} mm previstos. Evite pulverizações e operações pesadas.`,
            nivel:   'aviso',
          })
        } else if (dia.precipitation < 2 && dia.windspeed < 15) {
          candidatos.push({
            tipo:    'janela_pulverizacao',
            titulo:  `Janela de Pulverização — ${dataFmt}`,
            mensagem: `Condições favoráveis: ${dia.precipitation.toFixed(0)} mm de chuva, vento ${dia.windspeed.toFixed(0)} km/h.`,
            nivel:   'info',
          })
        }

        for (const c of candidatos) {
          // Deduplicação por título — evita reinserir no mesmo ciclo ou em reexecuções do job
          const { data: existente } = await supabase
            .from('alertas')
            .select('id')
            .eq('fazenda_id', fazenda.id)
            .eq('titulo', c.titulo)
            .maybeSingle()

          if (!existente) {
            novos.push({ ...c, fazenda_id: fazenda.id, lido: false, enviado_whatsapp: false })
          }
        }
      }

      if (novos.length > 0) {
        await supabase.from('alertas').insert(novos)
        console.log(`[Clima] ${fazenda.nome}: ${novos.length} alerta(s) inserido(s).`)
      } else {
        console.log(`[Clima] ${fazenda.nome}: sem novos alertas.`)
      }
    } catch (err) {
      console.error(`[Clima] Erro em ${fazenda.nome}:`, err instanceof Error ? err.message : err)
    }
  }
}
