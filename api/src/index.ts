import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import { talhaoRoutes }   from './routes/talhoes'
import { estoqueRoutes }  from './routes/estoque'
import { operacaoRoutes } from './routes/operacoes'
import { alertaRoutes }   from './routes/alertas'
import { cartaoRoutes }   from './routes/cartoes'
import { whatsappWebhook }   from './webhooks/whatsapp'
import { nfeWebhook }        from './webhooks/nfe'
import { nfeEmailWebhook }   from './webhooks/nfeEmailWebhook'
import { errorHandler }    from './middleware/errorHandler'
import { requestLogger }   from './middleware/requestLogger'
import { requireAuth }          from './middleware/auth'
import { validateNfeWebhook, validateZapiWebhook, validateN8nWebhook } from './middleware/validateWebhook'
import { iniciarJobs }     from './jobs'
import { buscarCotacoes }  from './jobs/cotacoes'

const app  = express()
const PORT = process.env.PORT || 3001

// Railway / Render ficam atrás de proxy reverso — necessário para rate-limit funcionar corretamente
app.set('trust proxy', 1)

// ─── Validação de variáveis obrigatórias na inicialização ─────────────────────
// Fase 1: Supabase + segurança mínima
const REQUIRED_ENV = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY',
  'WEBHOOK_SECRET',
]
// Fase 2: Z-API (WhatsApp) — opcional até o chip dedicado estar disponível
const OPTIONAL_WARN_ENV = [
  'ANTHROPIC_API_KEY', 'ZAPI_INSTANCE_ID', 'ZAPI_TOKEN', 'ZAPI_PHONE', 'ZAPI_CLIENT_TOKEN',
]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Variável de ambiente obrigatória não definida: ${key}`)
}
for (const key of OPTIONAL_WARN_ENV) {
  if (!process.env[key]) console.warn(`⚠️  Variável não definida (funcionalidade limitada): ${key}`)
}

// ─── Segurança — Helmet ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // desabilitado para API JSON pura
  crossOriginEmbedderPolicy: false,
}))

// ─── CORS — apenas origens permitidas ────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  // suporta múltiplas URLs separadas por vírgula: https://a.vercel.app,https://meudominio.com
  ...(process.env.FRONTEND_URL ?? '').split(',').map(s => s.trim()).filter(Boolean),
].filter(Boolean) as string[]

const corsHandler = cors({
  origin: (origin, callback) => {
    // Permitir requests sem origin (ex: Postman em dev, Railway health checks)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    // Origem não permitida: não setar headers CORS (navegador bloqueia) em vez de
    // lançar Error — lançar vira 500 no errorHandler e vaza config de CORS na resposta.
    console.warn(`CORS bloqueado — origem não permitida: ${origin}`)
    callback(null, false)
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
})

// Webhooks externos (Z-API, NFE.io, Make/n8n) são server-to-server e já têm
// autenticação própria via header (Client-Token, x-nfeio-signature, etc.).
// CORS é uma proteção de navegador — aplicar em webhook bloqueia origens
// legítimas como api.z-api.io. Só aplicar nas rotas consumidas pelo frontend.
app.use((req, res, next) => {
  if (req.path.startsWith('/webhook')) return next()
  corsHandler(req, res, next)
})

// ─── Rate limiting global ─────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200,                  // máx 200 requests por IP a cada 15min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
})

// Rate limit mais restrito para webhooks externos
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60,             // máx 60 eventos por minuto (mais que suficiente para NFE.io e Z-API)
  message: { error: 'Limite de eventos excedido.' },
})

app.use(globalLimiter)
app.use(requestLogger)

// ─── Body parsing — limites por rota ─────────────────────────────────────────
app.use('/webhook/nfe-email', express.raw({ type: '*/*', limit: '5mb' }))
app.use('/webhook', express.json({ limit: '5mb' }))
// XLSX de extrato bancário chega como base64: 1 MB de arquivo → ~1.37 MB encoded
app.use('/cartoes/importar-preview', express.json({ limit: '10mb' }))
app.use(express.json({ limit: '2mb' }))

// ─── Health check — público, sem auth ────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Rotas da API — protegidas por autenticação ───────────────────────────────
app.use('/talhoes',   requireAuth, talhaoRoutes)
app.use('/estoque',   requireAuth, estoqueRoutes)
app.use('/operacoes', requireAuth, operacaoRoutes)
app.use('/alertas',   requireAuth, alertaRoutes)
app.use('/cartoes',   requireAuth, cartaoRoutes)

// ─── Admin — trigger manual de jobs (requer autenticação) ────────────────────
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false })
let cotacoesInFlight = false

app.post('/admin/run-cotacoes', requireAuth, adminLimiter, async (_req, res) => {
  if (cotacoesInFlight) {
    res.status(429).json({ ok: false, message: 'Job já está em execução, aguarde.' })
    return
  }
  cotacoesInFlight = true
  res.json({ ok: true, message: 'Job iniciado.' })
  try {
    await buscarCotacoes()
  } finally {
    cotacoesInFlight = false
  }
})

// ─── Webhooks externos — rate limit próprio, validação de origem no handler ───
app.use('/webhook/whatsapp',   webhookLimiter, validateZapiWebhook, whatsappWebhook)
app.use('/webhook/nfe',        webhookLimiter, validateNfeWebhook,  nfeWebhook)
app.use('/webhook/nfe-email',  webhookLimiter, validateN8nWebhook,  nfeEmailWebhook)

// ─── Erros ────────────────────────────────────────────────────────────────────
app.use(errorHandler)

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ API rodando na porta ${PORT} [${process.env.NODE_ENV}]`)
  iniciarJobs()
})
