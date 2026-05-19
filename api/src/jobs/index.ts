// ─── Jobs agendados (node-cron) ───────────────────────────────────────────────
// Implementar na Fase 7 (expansão) após validação do MVP.
//
// Jobs planejados:
//   06:00 diário  → buscar previsão do tempo (Open-Meteo)
//   07:00 diário  → buscar cotação de commodities (CEPEA)
//   08:00 semanal → buscar NDVI por talhão (Sentinel Hub)
//   09:00 diário  → sincronizar operações John Deere
//   19:00 diário  → enviar resumo do dia no WhatsApp
//   a cada hora   → verificar alertas de estoque abaixo do mínimo
//
// Exemplo de estrutura quando implementar:
//
// import cron from 'node-cron'
// import { resumoDiario } from './resumoDiario'
//
// export function iniciarJobs() {
//   cron.schedule('0 19 * * *', resumoDiario, { timezone: 'America/Sao_Paulo' })
// }

export {}
