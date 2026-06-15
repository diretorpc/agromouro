# AgroMouro — Web

Frontend do AgroMouro. Painel de gestão da fazenda em **Next.js 16 (App Router)**,
**Tailwind CSS** e **shadcn/ui**, autenticado via **Supabase**.

> Parte do monorepo AgroMouro. Visão geral, arquitetura e o backend estão no
> [README da raiz](../README.md).

## Stack

- **Next.js 16** (App Router) + **React 19**
- **Tailwind CSS v4** + **shadcn/ui**
- **Supabase** (`@supabase/supabase-js`) — auth e dados
- **Recharts** — gráficos do dashboard
- **Leaflet / react-leaflet** — mapa dos talhões
- **TanStack Table** + **dnd-kit** — tabelas e ordenação

## Rotas

Sob `app/(app)/`, todas protegidas por autenticação:

| Rota | Página |
|------|--------|
| `/dashboard` | Resumo da fazenda |
| `/estoque` | Estoque de insumos |
| `/operacoes` | Operações de campo |
| `/talhoes` | Talhões e mapa |
| `/nfe` | Notas fiscais recebidas |
| `/cartoes` | Cartões / extratos |
| `/financeiro` | Lançamentos financeiros |
| `/custos` | Centros de custo |
| `/alertas` | Central de alertas |

`app/login/` é a página pública de login.

## Rodando localmente

```bash
npm install
npm run dev      # http://localhost:3000
```

### Variáveis de ambiente

Crie um `.env.local` com as chaves públicas do Supabase:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
NEXT_PUBLIC_API_URL=http://localhost:3001   # API local
```

> Use **apenas** a `anon key` no frontend — a `service key` nunca sai do backend.

## Scripts

| Comando | Ação |
|---------|------|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm start` | Servir o build |

## Deploy

Deploy automático na **Vercel** a partir da pasta `web/`. Configure as variáveis
`NEXT_PUBLIC_*` no painel do projeto.

> ⚠️ Esta é uma versão recente do Next.js (16) com breaking changes. Antes de
> escrever código, consulte os guias em `node_modules/next/dist/docs/` — veja `AGENTS.md`.
