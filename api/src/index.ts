import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import { talhaoRoutes }   from './routes/talhoes'
import { estoqueRoutes }  from './routes/estoque'
import { operacaoRoutes } from './routes/operacoes'
import { alertaRoutes }   from './routes/alertas'
import { whatsappWebhook } from './webhooks/whatsapp'
import { nfeWebhook }      from './webhooks/nfe'
import { errorHandler }    from './middleware/errorHandler'
import { requestLogger }   from './middleware/requestLogger'
import { requireAuth }          from './middleware/auth'
import { validateNfeWebhook, validateZapiWebhook } from './middleware/validateWebhook'

const app  = express()
const PORT = process.env.PORT || 3001

// ─── Validação de variáveis obrigatórias na inicialização ─────────────────────
const REQUIRED_ENV = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY',
  'ANTHROPIC_API_KEY', 'ZAPI_INSTANCE_ID', 'ZAPI_TOKEN', 'ZAPI_PHONE',
  'WEBHOOK_SECRET',
]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Variável de ambiente obrigatória não definida: ${key}`)
}

// ─── Segurança — Helmet ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // desabilitado para API JSON pura
  crossOriginEmbedderPolicy: false,
}))

// ─── CORS — apenas origens permitidas ────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL, // ex: https://agromouro.vercel.app
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
app.use('/webhook', express.json({ limit: '5mb' }))
app.use(express.json({ limit: '100kb' })) // todas as outras rotas: 100kb

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
app.use('/webhook/whatsapp', webhookLimiter, validateZapiWebhook, whatsappWebhook)
app.use('/webhook/nfe',      webhookLimiter, validateNfeWebhook,  nfeWebhook)

// ─── Erros ────────────────────────────────────────────────────────────────────
app.use(errorHandler)

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ API rodando na porta ${PORT} [${process.env.NODE_ENV}]`)
})
