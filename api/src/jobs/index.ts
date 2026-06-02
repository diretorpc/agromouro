import cron from 'node-cron'
import { buscarNFesNoEmail } from './nfeEmail'
import { buscarClimaFazendas } from './clima'
import { buscarCotacoes } from './cotacoes'

export function iniciarJobs(): void {
  // 06:00 — alertas de clima (geada, chuva intensa, janela de pulverização)
  cron.schedule('0 6 * * *', async () => {
    console.log('[Jobs] Buscando previsão do tempo...')
    await buscarClimaFazendas()
  }, { timezone: 'America/Sao_Paulo' })

  // 06:30 — cotações CEPEA (soja, milho, trigo)
  cron.schedule('30 6 * * *', async () => {
    console.log('[Jobs] Buscando cotações CEPEA...')
    await buscarCotacoes()
  }, { timezone: 'America/Sao_Paulo' })

  // A cada 30 minutos — buscar NF-es no e-mail
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Jobs] Buscando NF-es no e-mail...')
    await buscarNFesNoEmail()
  }, { timezone: 'America/Sao_Paulo' })

  console.log('[Jobs] Jobs agendados: clima (06:00), cotações (06:30), NF-e e-mail (30min)')
}
