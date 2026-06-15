# 🌱 AgroMouro

> Plataforma de gestão agrícola para fazendas de grãos (soja, milho, trigo).
> O agricultor opera tudo pelo **WhatsApp** — o sistema coleta os dados sozinho
> (NF-e, clima, cotações) e só incomoda quando não há outro jeito.

---

## O que é

O produtor rural não é técnico e não quer preencher planilhas. O AgroMouro
inverte o esforço: em vez de pedir dados, ele os **captura automaticamente** e
cruza tudo para dar visibilidade total da fazenda sem trabalho manual.

- 📲 **WhatsApp** — o agricultor registra operações de campo em linguagem natural; o Claude interpreta.
- 🧾 **NF-e automática** — notas dos fornecedores chegam por e-mail, são lidas e viram estoque + despesa.
- 🌦️ **Clima e cotações** — alertas de geada/pulverização e preços CEPEA (soja, milho, trigo) diários.
- 📊 **Painel web** — dashboard, estoque, operações, talhões, financeiro e alertas em um só lugar.

---

## Arquitetura

```
                          ┌─────────────────────────┐
   Fornecedor ──(e-mail)─▶│  Make.com (a cada 15min) │──┐
                          └─────────────────────────┘  │  XML da NF-e
                                                        ▼
  Agricultor ──(WhatsApp)──▶ Z-API ──▶ ┌──────────────────────────┐
                                       │   API (Node + Express)    │
   Clima / CEPEA ──(cron)────────────▶ │   Railway                 │
                                       └────────────┬─────────────┘
                                                    │
                                          ┌─────────▼─────────┐
                                          │  Supabase (Postgres│
                                          │  + Auth + RLS)     │
                                          └─────────▲─────────┘
                                                    │
   Agricultor ──(navegador)──▶ ┌────────────────────┴─────────────┐
                               │   Web (Next.js 16 + Tailwind)     │
                               │   Vercel                          │
                               └──────────────────────────────────┘
```

| Camada | Stack | Deploy |
|--------|-------|--------|
| **api/** | Node.js · Express · TypeScript | Railway |
| **web/** | Next.js 16 (App Router) · Tailwind · shadcn/ui | Vercel |
| **Banco** | Supabase — PostgreSQL + Auth + RLS + Realtime | Supabase Cloud |
| **WhatsApp** | Z-API + Claude Haiku (parsing de mensagens) | — |
| **NF-e** | Make.com monitora e-mails Outlook → `POST /webhook/nfe-email` | — |
| **IA** | Anthropic Claude (Haiku: parsing · Sonnet: prescrições de solo) | — |

> ℹ️ **NF-e é 100% automática.** O Make.com vigia dois e-mails Outlook a cada 15min
> e envia o XML para a API. Não há etapa manual.

---

## Estrutura do monorepo

```
agromouro-base/
├── api/                  # Backend — Node + Express + TypeScript (Railway)
│   └── src/
│       ├── routes/       # Rotas REST: talhoes, estoque, operacoes, alertas, cartoes
│       ├── services/     # Lógica de negócio: supabase, zapi, nfeProcessor, categorizador
│       ├── webhooks/     # Eventos externos: whatsapp, nfe, nfeEmail
│       ├── jobs/         # node-cron: clima (06:00), cotações (06:30), NF-e e-mail (30min)
│       ├── middleware/   # auth, errorHandler, requestLogger, validateWebhook
│       ├── database/     # schema.sql, seed.sql, migrations/
│       └── index.ts      # entrada da aplicação
├── web/                  # Frontend — Next.js 16 (Vercel) — ver web/README.md
│   └── app/(app)/        # dashboard, estoque, operacoes, talhoes, nfe, cartoes,
│                         # financeiro, custos, alertas
├── supabase/             # configuração do projeto Supabase
├── docs/                 # documentação, auditorias e setup do Make.com
├── .env.example          # todas as variáveis de ambiente, comentadas
└── PLAN.md               # plano de produto e roadmap detalhado
```

---

## Como rodar localmente

**Pré-requisitos:** Node.js 20+, conta Supabase, credenciais Z-API e Anthropic.

### 1. Variáveis de ambiente

```bash
cp .env.example .env
# Preencha com suas credenciais (Supabase, Z-API, Anthropic, etc.)
```

O mesmo `.env` da raiz é usado pela API (`npm run dev` lê `../.env`).

### 2. API (backend)

```bash
cd api
npm install
npm run dev
# → http://localhost:3001/health
```

Na inicialização a API valida as variáveis obrigatórias
(`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `WEBHOOK_SECRET`)
e avisa sobre as opcionais (Z-API, Anthropic).

### 3. Web (frontend)

```bash
cd web
npm install
npm run dev
# → http://localhost:3000
```

> Configure as variáveis `NEXT_PUBLIC_*` do Supabase para o frontend. Detalhes em [web/README.md](web/README.md).

---

## Banco de dados (MVP)

Tabelas principais: `fazenda`, `talhoes`, `safras`, `operacoes`, `insumos`,
`estoque`, `movimentacoes_estoque`, `notas_fiscais`, `itens_nfe`,
`lancamentos_financeiros`, `alertas`.

Schema e migrations versionados em [api/src/database/](api/src/database/).
Acesso protegido por **Row Level Security (RLS)** no Supabase.

---

## Deploy

| Serviço | Plataforma | Observação |
|---------|-----------|------------|
| API | **Railway** | `npm run build` → `npm start`. Config em `api/nixpacks.toml`. |
| Web | **Vercel** | Build automático do Next.js a partir de `web/`. |
| Banco | **Supabase** | PostgreSQL gerenciado + Auth. |

Defina todas as variáveis de ambiente no painel de cada serviço — **nunca commite o `.env`**.

---

## Segurança

- `.env` está no `.gitignore` — segredos nunca vão para o Git.
- Webhooks externos têm validação de origem própria (`validateWebhook`) + rate limit.
- Rotas da API protegidas por autenticação Supabase (`requireAuth`).
- Helmet, CORS por allowlist e rate limiting global ativos na API.

---

## Roadmap (pós-MVP)

John Deere Operations Center · Stara Hércules 6.0 · Open Finance (Pluggy) ·
NDVI via Sentinel Hub · sensores IoT (LoRaWAN/TTN).

Detalhes e prioridades em [PLAN.md](PLAN.md).

---

## Créditos

Projetado e desenvolvido pela **Serafim IA**.

