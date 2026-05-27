import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import { talhaoRoutes }   from './routes/talhoes'
import { estoqueRoutes }  from './routes/estoque'
import { operacaoRoutes } from './routes/operacoes'
import { alertaRoutes }   from './routes/alertas'
import { whatsappWebhook }   from './webhooks/whatsapp'
import { nfeWebhook }        from './webhooks/nfe'
import { nfeEmailWebhook }   from './webhooks/nfeEmailWebhook'
import { errorHandler }    from './middleware/errorHandler'
import { requestLogger }   from './middleware/requestLogger'
import { requireAuth }          from './middleware/auth'
import { validateNfeWebhook, validateZapiWebhook, validateN8nWebhook } from './middleware/validateWebhook'
import { iniciarJobs }     from './jobs'

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

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sem origin (ex: Postman em dev, Railway health checks)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origem não permitida — ${origin}`))
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

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

// ─── Body parsing — limite alto SOMENTE para webhooks (NF-e XMLs são grandes) ─
app.use('/webhook/nfe-email', express.raw({ type: '*/*', limit: '5mb' }))
app.use('/webhook', express.json({ limit: '5mb' }))
app.use(express.json({ limit: '100kb' }))

// ─── Health check — público, sem auth ────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Rotas da API — protegidas por autenticação ───────────────────────────────
app.use('/talhoes',   requireAuth, talhaoRoutes)
app.use('/estoque',   requireAuth, estoqueRoutes)
app.use('/operacoes', requireAuth, operacaoRoutes)
app.use('/alertas',   requireAuth, alertaRoutes)

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
