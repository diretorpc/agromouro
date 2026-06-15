# AgroMouro — API

Backend do AgroMouro. **Node.js · Express · TypeScript**, deploy na **Railway**.
Recebe eventos de WhatsApp e NF-e, roda jobs agendados e expõe a API REST do painel.

> Parte do monorepo AgroMouro. Visão geral e arquitetura no [README da raiz](../README.md).

## Estrutura

```
src/
├── routes/       # Rotas REST (protegidas por auth): talhoes, estoque,
│                 #   operacoes, alertas, cartoes
├── services/     # Lógica de negócio: supabase, zapi, nfeProcessor,
│                 #   categorizador, xlsxParser
├── webhooks/     # Eventos externos: whatsapp, nfe, nfeEmail
├── jobs/         # node-cron: clima, cotações, NF-e por e-mail
├── middleware/   # auth, errorHandler, requestLogger, validateWebhook
├── database/     # schema.sql, seed.sql, migrations/
└── index.ts      # entrada da aplicação
```

## Rodando localmente

```bash
npm install
npm run dev      # http://localhost:3001/health
```

`npm run dev` lê o `.env` da raiz do monorepo (`../.env`). Copie de `../.env.example`.

Na inicialização a API valida as variáveis obrigatórias
(`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `WEBHOOK_SECRET`)
e avisa sobre as opcionais (`ANTHROPIC_API_KEY`, Z-API).

## Scripts

| Comando | Ação |
|---------|------|
| `npm run dev` | Dev com hot reload (`tsx watch`) |
| `npm run build` | Compila TypeScript → `dist/` |
| `npm start` | Roda o build (`node dist/index.js`) |

## Endpoints

**Públicos**

- `GET /health` — health check (sem auth)
- `POST /webhook/whatsapp` — eventos da Z-API
- `POST /webhook/nfe` — NF-e
- `POST /webhook/nfe-email` — XML enviado pelo Make.com

Webhooks têm validação de origem própria + rate limit dedicado.

**Protegidos (Supabase auth)**

- `/talhoes` · `/estoque` · `/operacoes` · `/alertas` · `/cartoes`
- `POST /admin/run-cotacoes` — dispara o job de cotações manualmente

## Jobs agendados (`node-cron`, timezone America/Sao_Paulo)

| Horário | Job |
|---------|-----|
| 06:00 | Alertas de clima (geada, chuva, janela de pulverização) |
| 06:30 | Cotações CEPEA (soja, milho, trigo) |
| a cada 30min | Busca NF-es no e-mail |

## Banco de dados

Schema, seed e migrations em [src/database/](src/database/). Migrations numeradas
sequencialmente (`001_*.sql` …). Acesso protegido por RLS no Supabase.

## Deploy

Railway via `nixpacks.toml`: `npm run build` → `npm start`. Defina as variáveis de
ambiente no painel da Railway — nunca commite o `.env`.
