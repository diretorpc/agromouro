import cron from 'node-cron'
import { buscarNFesNoEmail } from './nfeEmail'

export function iniciarJobs(): void {
  // A cada 30 minutos — buscar NF-es no e-mail
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Jobs] Buscando NF-es no e-mail...')
    await buscarNFesNoEmail()
  }, { timezone: 'America/Sao_Paulo' })

  console.log('[Jobs] Jobs agendados: NF-e e-mail (30min)')
}
