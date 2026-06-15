# AgroMouro — Web

AgroMouro frontend. Farm management panel built with **Next.js 16 (App Router)**,
**Tailwind CSS**, and **shadcn/ui**, authenticated via **Supabase**.

> Part of the AgroMouro monorepo. Overview, architecture, and the backend are in
> the [root README](../README.md).

## Stack

- **Next.js 16** (App Router) + **React 19**
- **Tailwind CSS v4** + **shadcn/ui**
- **Supabase** (`@supabase/supabase-js`) — auth and data
- **Recharts** — dashboard charts
- **Leaflet / react-leaflet** — fields map
- **TanStack Table** + **dnd-kit** — tables and drag-and-drop ordering

## Routes

Under `app/(app)/`, all protected by authentication:

| Route | Page |
|------|--------|
| `/dashboard` | Farm overview |
| `/estoque` | Input stock |
| `/operacoes` | Field operations |
| `/talhoes` | Fields and map |
| `/nfe` | Received e-invoices |
| `/cartoes` | Cards / statements |
| `/financeiro` | Financial entries |
| `/custos` | Cost centers |
| `/alertas` | Alerts center |

`app/login/` is the public login page.

## Running locally

```bash
npm install
npm run dev      # http://localhost:3000
```

### Environment variables

Create a `.env.local` with the Supabase public keys:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
NEXT_PUBLIC_API_URL=http://localhost:3001   # local API
```

> Use **only** the `anon key` in the frontend — the `service key` never leaves the backend.

## Scripts

| Command | Action |
|---------|--------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the build |

## Deploy

Automatic deploy on **Vercel** from the `web/` folder. Set the `NEXT_PUBLIC_*`
variables in the project dashboard.

> ⚠️ This is a recent Next.js version (16) with breaking changes. Before writing
> code, check the guides in `node_modules/next/dist/docs/` — see `AGENTS.md`.
