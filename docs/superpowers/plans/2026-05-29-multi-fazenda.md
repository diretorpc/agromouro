# Multi-Fazenda (Multi-Tenant) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suportar 3 fazendas isoladas (MG, SP, MT) com troca via sidebar — dados, NF-e e WhatsApp completamente separados por fazenda.

**Architecture:** Todas as 10 tabelas existentes ganham `fazenda_id UUID NOT NULL`. Isolamento via RLS usando `app_metadata.fazenda_ativa_id` do JWT — o frontend troca de fazenda invocando uma Edge Function que atualiza o JWT, sem reload forçado. Webhooks de NF-e e WhatsApp aceitam `?fazenda=<codigo>` como query param para rotear ao farm correto. O `nfeProcessor` e o `whatsappWebhook` recebem `fazenda_id` por parâmetro e o injetam em todos os inserts.

**Tech Stack:** Supabase (PostgreSQL + RLS + Edge Functions + Auth JWT `app_metadata`), Next.js 14 App Router + React Context, Node.js/Express, Z-API multi-instância

---

## File Map

### New
| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/001_multi_fazenda.sql` | Toda a migração DB: rename, fazenda_id em 10 tabelas, índices, RLS |
| `supabase/functions/switch-farm/index.ts` | Edge Function Deno: atualiza `app_metadata.fazenda_ativa_id` no JWT |
| `web/context/fazenda-context.tsx` | React Context com `fazendaAtiva`, `fazendas[]`, `switchFazenda()` |
| `web/components/fazenda-switcher.tsx` | Dropdown no sidebar para trocar fazenda |

### Modified
| Arquivo | O que muda |
|---|---|
| `web/components/sidebar.tsx` | Adiciona `<FazendaSwitcher />` abaixo do logo |
| `web/app/(app)/layout.tsx` | Envolve com `<FazendaProvider>` |
| `api/src/webhooks/nfeEmailWebhook.ts` | Aceita `?fazenda=mg` query param, resolve `fazenda_id` |
| `api/src/services/nfeProcessor.ts` | `processarNFe` + `vincularOuCriarInsumo` + `nfeJaProcessada` recebem `fazenda_id` |
| `api/src/webhooks/whatsapp.ts` | Aceita `?fazenda=mg`, passa `fazenda_id` a todos os inserts |
| `api/src/services/zapi.ts` | `getZapiConfig(codigo)` + `enviarMensagem` aceita `fazendaCodigo` |
| `.env.example` | Vars por fazenda: `ZAPI_INSTANCE_MG`, `ZAPI_TOKEN_MG`, `ZAPI_CLIENT_TOKEN_MG`, etc. |

---

## Task 0: Branch

- [ ] **0.1: Criar branch de feature**

```bash
git checkout main && git pull
git checkout -b feat/multi-fazenda
```

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/001_multi_fazenda.sql`

> Executar no SQL Editor do Supabase uma única vez. Idempotente: usa `IF NOT EXISTS` em toda alteração de schema.

- [ ] **1.1: Criar arquivo de migração**

Create `supabase/migrations/001_multi_fazenda.sql`:

```sql
-- ============================================================
-- AgroMouro — Multi-Fazenda Migration
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- EDITAR os UPDATE/INSERT com os dados reais das fazendas antes de rodar.
-- ============================================================

-- 1. Renomear fazenda → fazendas
ALTER TABLE fazenda RENAME TO fazendas;

-- 2. Adicionar campos de configuração por fazenda
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS codigo     TEXT UNIQUE;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS nfe_email  TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS zapi_instance TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS zapi_phone    TEXT;

-- 3. Marcar fazenda existente como MG (EDITAR estado/nome com dados reais)
UPDATE fazendas
SET codigo = 'mg', estado = 'MG'
WHERE id = (SELECT id FROM fazendas LIMIT 1);

-- 4. Inserir SP e MT (EDITAR nome, municipio, hectares, lat, lng com dados reais)
INSERT INTO fazendas (nome, codigo, estado, hectares, municipio)
VALUES
  ('Fazenda SP', 'sp', 'SP', 0, 'A preencher'),
  ('Fazenda MT', 'mt', 'MT', 0, 'A preencher')
ON CONFLICT (codigo) DO NOTHING;

-- 5. Adicionar fazenda_id em todas as tabelas (backfill com o id da MG)
DO $$
DECLARE
  mg_id UUID;
  t     TEXT;
BEGIN
  SELECT id INTO mg_id FROM fazendas WHERE codigo = 'mg';

  FOREACH t IN ARRAY ARRAY[
    'talhoes','safras','operacoes','insumos','estoque',
    'movimentacoes_estoque','notas_fiscais','itens_nfe',
    'lancamentos_financeiros','alertas'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS fazenda_id UUID REFERENCES fazendas(id)', t
    );
    EXECUTE format('UPDATE %I SET fazenda_id = $1 WHERE fazenda_id IS NULL', t) USING mg_id;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN fazenda_id SET NOT NULL', t);
  END LOOP;
END $$;

-- 6. Índices de performance (um por tabela)
CREATE INDEX IF NOT EXISTS idx_talhoes_faz           ON talhoes(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_safras_faz            ON safras(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_operacoes_faz         ON operacoes(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_insumos_faz           ON insumos(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_estoque_faz           ON estoque(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_movest_faz            ON movimentacoes_estoque(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_nfe_faz               ON notas_fiscais(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_itens_nfe_faz         ON itens_nfe(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_faz       ON lancamentos_financeiros(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_alertas_faz           ON alertas(fazenda_id);

-- 7. Função helper para extrair fazenda ativa do JWT
-- Usada pelas RLS policies. Fallback = fazenda mais antiga (MG).
CREATE OR REPLACE FUNCTION get_fazenda_ativa_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'fazenda_ativa_id')::uuid,
    (SELECT id FROM fazendas ORDER BY created_at LIMIT 1)
  );
$$;

-- 8. Dropar TODAS as policies existentes nas tabelas afetadas e recriar
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE tablename IN (
      'talhoes','safras','operacoes','insumos','estoque',
      'movimentacoes_estoque','notas_fiscais','itens_nfe',
      'lancamentos_financeiros','alertas','fazendas','fazenda'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- fazendas: leitura por qualquer usuário autenticado (switcher precisa listar todas)
CREATE POLICY "fazendas_read" ON fazendas
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Todas as outras tabelas: filtro por fazenda ativa do JWT
CREATE POLICY "talhoes_tenant"       ON talhoes              FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "safras_tenant"        ON safras               FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "operacoes_tenant"     ON operacoes            FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "insumos_tenant"       ON insumos              FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "estoque_tenant"       ON estoque              FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "movest_tenant"        ON movimentacoes_estoque FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "notas_fiscais_tenant" ON notas_fiscais        FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "itens_nfe_tenant"     ON itens_nfe            FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "lancamentos_tenant"   ON lancamentos_financeiros FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "alertas_tenant"       ON alertas              FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
```

- [ ] **1.2: Preencher dados reais antes de rodar**

Editar o arquivo acima:
1. `UPDATE fazendas SET codigo = 'mg', estado = 'MG'` — confirmar estado da fazenda existente
2. `INSERT INTO fazendas` para SP e MT — preencher `nome`, `municipio`, `hectares`, `lat`, `lng`

- [ ] **1.3: Rodar no Supabase SQL Editor**

Supabase Dashboard → SQL Editor → New query → colar o arquivo → Run (⌘+Enter).

Esperado: sem erros, mensagem de sucesso.

- [ ] **1.4: Verificar resultado**

Rodar no SQL Editor:

```sql
-- 3 fazendas com codigo preenchido
SELECT id, nome, codigo, estado FROM fazendas ORDER BY estado;

-- Todos os talhões têm fazenda_id
SELECT COUNT(*) FROM talhoes WHERE fazenda_id IS NULL; -- deve retornar 0

-- Policies criadas
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('talhoes','estoque','notas_fiscais')
ORDER BY tablename;
```

Esperado: 3 fazendas, 0 talhões sem fazenda_id, políticas `*_tenant` visíveis.

- [ ] **1.5: Setar fazenda_ativa_id nos usuários existentes**

No Supabase Dashboard → Authentication → Users → clicar em cada usuário → editar **Raw App Meta Data** → adicionar:

```json
{ "fazenda_ativa_id": "<UUID_DA_FAZENDA_MG>" }
```

(pegar o UUID com `SELECT id FROM fazendas WHERE codigo = 'mg'`)

- [ ] **1.6: Commit**

```bash
git add supabase/migrations/001_multi_fazenda.sql
git commit -m "feat(db): multi-fazenda — fazenda_id em 10 tabelas + RLS tenant por JWT"
```

---

## Task 2: Supabase Edge Function — switch-farm

**Files:**
- Create: `supabase/functions/switch-farm/index.ts`

Atualiza `app_metadata.fazenda_ativa_id` do usuário. O frontend chama após selecionar nova fazenda e faz `refreshSession()` para receber o JWT atualizado.

- [ ] **2.1: Criar arquivo**

```bash
mkdir -p supabase/functions/switch-farm
```

Create `supabase/functions/switch-farm/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
  }

  // Client com JWT do usuário para validar autenticação e pegar user.id
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
  }

  const { fazenda_id } = await req.json()
  if (!fazenda_id) {
    return new Response(JSON.stringify({ error: 'Missing fazenda_id' }), { status: 400, headers: corsHeaders })
  }

  // Admin client (service role) para atualizar app_metadata
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Validar que fazenda_id existe
  const { data: fazenda } = await adminClient
    .from('fazendas')
    .select('id')
    .eq('id', fazenda_id)
    .single()

  if (!fazenda) {
    return new Response(JSON.stringify({ error: 'Fazenda não encontrada' }), { status: 400, headers: corsHeaders })
  }

  // Atualizar JWT claims do usuário
  const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
    app_metadata: { fazenda_ativa_id: fazenda_id }
  })

  if (updateError) {
    return new Response(JSON.stringify({ error: 'Falha ao atualizar' }), { status: 500, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
```

- [ ] **2.2: Deploy**

```bash
# Instalar Supabase CLI se não tiver: npm install -g supabase
supabase login
supabase link --project-ref <PROJECT_REF>
# PROJECT_REF fica em: Supabase Dashboard → Settings → General → Reference ID

supabase functions deploy switch-farm
```

Esperado: `Deployed switch-farm`

- [ ] **2.3: Testar via curl**

```bash
# 1. Pegar JWT do usuário logado (browser → DevTools → Application → Local Storage → sb-*-auth-token → access_token)
# 2. Pegar UUID de SP: SELECT id FROM fazendas WHERE codigo = 'sp'

curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/switch-farm' \
  -H 'Authorization: Bearer <USER_JWT>' \
  -H 'Content-Type: application/json' \
  -d '{ "fazenda_id": "<UUID_SP>" }'
```

Esperado: `{"success":true}`

- [ ] **2.4: Commit**

```bash
git add supabase/functions/switch-farm/index.ts
git commit -m "feat(supabase): edge function switch-farm — troca fazenda_ativa_id no JWT"
```

---

## Task 3: Frontend — FazendaContext + FazendaSwitcher

**Files:**
- Create: `web/context/fazenda-context.tsx`
- Create: `web/components/fazenda-switcher.tsx`
- Modify: `web/components/sidebar.tsx`
- Modify: `web/app/(app)/layout.tsx`

- [ ] **3.1: Criar FazendaContext**

Create `web/context/fazenda-context.tsx`:

```typescript
'use client'

import {
  createContext, useContext, useState, useEffect,
  useCallback, ReactNode
} from 'react'
import { supabase } from '@/lib/supabase'

interface Fazenda {
  id: string
  nome: string
  codigo: string
  estado: string
}

interface FazendaContextType {
  fazendaAtiva: Fazenda | null
  fazendas: Fazenda[]
  switchFazenda: (fazendaId: string) => Promise<void>
  loading: boolean
}

const FazendaContext = createContext<FazendaContextType | null>(null)

export function FazendaProvider({ children }: { children: ReactNode }) {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaAtiva, setFazendaAtiva] = useState<Fazenda | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setLoading(false); return }

      const fazendaAtivaId: string | undefined =
        session.user.app_metadata?.fazenda_ativa_id

      const { data } = await supabase
        .from('fazendas')
        .select('id, nome, codigo, estado')
        .order('estado')

      if (!data || data.length === 0) { setLoading(false); return }

      setFazendas(data)

      const ativa = data.find(f => f.id === fazendaAtivaId) ?? data[0]
      setFazendaAtiva(ativa)

      // Primeiro login: inicializar fazenda_ativa_id no JWT
      if (!fazendaAtivaId) {
        await supabase.functions.invoke('switch-farm', {
          body: { fazenda_id: ativa.id }
        })
        await supabase.auth.refreshSession()
      }

      setLoading(false)
    }
    init()
  }, [])

  const switchFazenda = useCallback(async (fazendaId: string) => {
    const { error } = await supabase.functions.invoke('switch-farm', {
      body: { fazenda_id: fazendaId }
    })
    if (error) throw error

    // Atualizar JWT local com novo fazenda_ativa_id
    await supabase.auth.refreshSession()

    const fazenda = fazendas.find(f => f.id === fazendaId) ?? null
    setFazendaAtiva(fazenda)

    // Forçar remount das páginas para refazer queries com o novo JWT
    window.location.reload()
  }, [fazendas])

  return (
    <FazendaContext.Provider value={{ fazendaAtiva, fazendas, switchFazenda, loading }}>
      {children}
    </FazendaContext.Provider>
  )
}

export function useFazenda() {
  const ctx = useContext(FazendaContext)
  if (!ctx) throw new Error('useFazenda must be used inside FazendaProvider')
  return ctx
}
```

- [ ] **3.2: Criar FazendaSwitcher**

Create `web/components/fazenda-switcher.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useFazenda } from '@/context/fazenda-context'
import { cn } from '@/lib/utils'

const ESTADO_ICON: Record<string, string> = {
  MG: '🌿',
  SP: '🌾',
  MT: '🌻',
}

export function FazendaSwitcher() {
  const { fazendaAtiva, fazendas, switchFazenda, loading } = useFazenda()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  // Não renderizar se só tiver 1 fazenda ou ainda carregando
  if (loading || !fazendaAtiva || fazendas.length <= 1) return null

  async function handleSwitch(fazendaId: string) {
    if (fazendaId === fazendaAtiva?.id) { setOpen(false); return }
    setSwitching(true)
    setOpen(false)
    try {
      await switchFazenda(fazendaId)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="relative px-3 pb-3">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={switching}
        className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-white/70 hover:text-white hover:bg-white/8 transition-all disabled:opacity-50"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{ESTADO_ICON[fazendaAtiva.estado] ?? '🏡'}</span>
          <span className="truncate">{fazendaAtiva.nome}</span>
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <>
          {/* Backdrop — fecha ao clicar fora */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-white/10 bg-[#192d08] shadow-2xl overflow-hidden">
            {fazendas.map(f => (
              <button
                key={f.id}
                onClick={() => handleSwitch(f.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] hover:bg-white/8 transition-colors text-left"
              >
                <span className="shrink-0">{ESTADO_ICON[f.estado] ?? '🏡'}</span>
                <span className={cn(
                  'flex-1 truncate font-medium',
                  f.id === fazendaAtiva.id ? 'text-white' : 'text-white/55'
                )}>
                  {f.nome}
                </span>
                {f.id === fazendaAtiva.id && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[#8FB840]" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **3.3: Adicionar FazendaSwitcher ao Sidebar**

Modify `web/components/sidebar.tsx`:

Adicionar import após os imports existentes:
```typescript
import { FazendaSwitcher } from '@/components/fazenda-switcher'
```

Adicionar `<FazendaSwitcher />` entre o bloco do logo e o `<nav>`:
```typescript
      </div>  {/* ← fim do bloco Logo */}

      <FazendaSwitcher />

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
```

- [ ] **3.4: Envolver AppLayout com FazendaProvider**

Modify `web/app/(app)/layout.tsx`:

```typescript
// Adicionar import
import { FazendaProvider } from '@/context/fazenda-context'
```

```typescript
// BEFORE:
      <AuthGuard>
        <div className="flex h-screen overflow-hidden">

// AFTER:
      <AuthGuard>
        <FazendaProvider>
        <div className="flex h-screen overflow-hidden">
```

```typescript
// BEFORE:
        </div>
      </AuthGuard>

// AFTER:
        </div>
        </FazendaProvider>
      </AuthGuard>
```

- [ ] **3.5: Build TypeScript**

```bash
cd web && npm run build
```

Esperado: compilação limpa. Corrigir tipos antes de continuar.

- [ ] **3.6: Commit**

```bash
git add web/context/fazenda-context.tsx web/components/fazenda-switcher.tsx web/components/sidebar.tsx "web/app/(app)/layout.tsx"
git commit -m "feat(web): FazendaContext + FazendaSwitcher — troca de fazenda no sidebar"
```

---

## Task 4: API — NF-e multi-fazenda

**Files:**
- Modify: `api/src/webhooks/nfeEmailWebhook.ts`
- Modify: `api/src/services/nfeProcessor.ts`

A NF-e chega via Make.com com query param `?fazenda=mg`. O webhook resolve o `fazenda_id` e o passa por toda a cadeia de processamento.

- [ ] **4.1: Atualizar nfeEmailWebhook.ts**

Modify `api/src/webhooks/nfeEmailWebhook.ts`:

Localizar a linha `import { parseXmlNFe, nfeJaProcessada, processarNFe }` e adicionar o import do supabase se não existir:

```typescript
import { Router } from 'express'
import { supabase } from '../services/supabase'
import { parseXmlNFe, nfeJaProcessada, processarNFe } from '../services/nfeProcessor'

export const nfeEmailWebhook = Router()

nfeEmailWebhook.post('/', async (req, res) => {
  res.status(200).json({ ok: true })

  try {
    // Identificar fazenda pelo query param (Make.com adiciona ?fazenda=mg na URL)
    const fazenda_codigo = (req.query.fazenda as string) ?? 'mg'

    const { data: fazenda } = await supabase
      .from('fazendas')
      .select('id, codigo')
      .eq('codigo', fazenda_codigo)
      .single()

    if (!fazenda) {
      console.error(`[NFeEmail] Fazenda não encontrada: ${fazenda_codigo}`)
      return
    }

    const xmlStr: string = Buffer.isBuffer(req.body)
      ? req.body.toString('utf-8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body)

    if (!xmlStr || xmlStr.length < 100) {
      console.warn('[NFeEmail] Body vazio ou muito curto — ignorando.')
      return
    }

    const nfe = parseXmlNFe(xmlStr)
    if (!nfe) {
      console.warn('[NFeEmail] XML não é uma NF-e válida.')
      return
    }

    if (await nfeJaProcessada(nfe.numero, fazenda.id)) {
      console.log(`[NFeEmail] NF-e ${nfe.numero} já processada para ${fazenda_codigo} — ignorando.`)
      return
    }

    console.log(`[NFeEmail][${fazenda_codigo}] Processando NF-e ${nfe.numero}...`)
    await processarNFe(nfe, 'email', fazenda.id)
    console.log(`[NFeEmail][${fazenda_codigo}] NF-e ${nfe.numero} processada.`)

  } catch (err) {
    console.error('[NFeEmail] Erro:', err instanceof Error ? err.message : err)
  }
})
```

- [ ] **4.2: Atualizar nfeJaProcessada para filtrar por fazenda**

Modify `api/src/services/nfeProcessor.ts` — localizar `nfeJaProcessada` (linha ~94) e substituir:

```typescript
// BEFORE:
export async function nfeJaProcessada(numero: string): Promise<boolean> {
  const { data } = await supabase
    .from('notas_fiscais')
    .select('id')
    .eq('numero', numero)
    .limit(1)
    .single()
  return !!data
}

// AFTER:
export async function nfeJaProcessada(numero: string, fazenda_id: string): Promise<boolean> {
  const { data } = await supabase
    .from('notas_fiscais')
    .select('id')
    .eq('numero', numero)
    .eq('fazenda_id', fazenda_id)
    .limit(1)
    .single()
  return !!data
}
```

- [ ] **4.3: Atualizar vincularOuCriarInsumo para receber fazenda_id**

Modify `api/src/services/nfeProcessor.ts` — localizar `vincularOuCriarInsumo` (linha ~119) e adicionar `fazenda_id` como parâmetro:

```typescript
// BEFORE:
async function vincularOuCriarInsumo(
  descricao: string, tipo: TipoInsumo, unidadeBase: string,
): Promise<{ id: string; nome: string; unidade: string; autoCreated: boolean }> {
  const primeirasPalavras = descricao.trim().split(' ').slice(0, 2).join(' ')
  const { data: existente } = await supabase
    .from('insumos')
    .select('id, nome, unidade')
    .ilike('nome', `%${primeirasPalavras}%`)
    .limit(1)
    .single()

  if (existente) return { ...existente, autoCreated: false }

  const nome    = descricao.trim().slice(0, 200)
  const unidade = unidadeBase?.trim().slice(0, 20) || 'un'

  const { data: novoInsumo, error } = await supabase
    .from('insumos')
    .insert({ nome, tipo, unidade })
    .select('id, nome, unidade')
    .single()

  if (error || !novoInsumo) throw new Error(`Falha ao criar insumo: ${error?.message}`)

  await supabase.from('estoque').insert({
    insumo_id: novoInsumo.id, quantidade_atual: 0, quantidade_minima_alerta: 0,
  })

  return { ...novoInsumo, autoCreated: true }
}

// AFTER:
async function vincularOuCriarInsumo(
  descricao: string, tipo: TipoInsumo, unidadeBase: string, fazenda_id: string,
): Promise<{ id: string; nome: string; unidade: string; autoCreated: boolean }> {
  const primeirasPalavras = descricao.trim().split(' ').slice(0, 2).join(' ')
  const { data: existente } = await supabase
    .from('insumos')
    .select('id, nome, unidade')
    .ilike('nome', `%${primeirasPalavras}%`)
    .eq('fazenda_id', fazenda_id)   // ← scoped ao farm
    .limit(1)
    .single()

  if (existente) return { ...existente, autoCreated: false }

  const nome    = descricao.trim().slice(0, 200)
  const unidade = unidadeBase?.trim().slice(0, 20) || 'un'

  const { data: novoInsumo, error } = await supabase
    .from('insumos')
    .insert({ nome, tipo, unidade, fazenda_id })  // ← fazenda_id
    .select('id, nome, unidade')
    .single()

  if (error || !novoInsumo) throw new Error(`Falha ao criar insumo: ${error?.message}`)

  await supabase.from('estoque').insert({
    insumo_id: novoInsumo.id, quantidade_atual: 0, quantidade_minima_alerta: 0,
    fazenda_id,  // ← fazenda_id
  })

  return { ...novoInsumo, autoCreated: true }
}
```

- [ ] **4.4: Atualizar processarNFe para aceitar e propagar fazenda_id**

Modify `api/src/services/nfeProcessor.ts` — localizar `export async function processarNFe` (linha ~151) e:

1. Adicionar `fazenda_id: string` como terceiro parâmetro:
```typescript
// BEFORE:
export async function processarNFe(nfe: NFeData, origem: 'webhook' | 'email' = 'webhook'): Promise<void> {

// AFTER:
export async function processarNFe(nfe: NFeData, origem: 'webhook' | 'email' = 'webhook', fazenda_id: string): Promise<void> {
```

2. No INSERT de `notas_fiscais` (linha ~163), adicionar `fazenda_id`:
```typescript
// Adicionar fazenda_id ao objeto de insert:
      .insert({
        numero,
        emitente_nome: emitenteNome,
        emitente_cnpj: emitenteCnpj,
        data_emissao:  dataEmissao,
        valor_total:   valorTotal,
        status:        'processando',
        fazenda_id,    // ← adicionar
      })
```

3. Na chamada de `vincularOuCriarInsumo` (dentro do loop de itens), passar `fazenda_id`:
```typescript
// BEFORE:
      const insumo = await vincularOuCriarInsumo(item.description, tipo, unidadeBase)

// AFTER:
      const insumo = await vincularOuCriarInsumo(item.description, tipo, unidadeBase, fazenda_id)
```

4. No INSERT de `itens_nfe`, adicionar `fazenda_id`:
```typescript
      await supabase.from('itens_nfe').insert({
        nota_fiscal_id: nfeId,
        descricao:      item.description.slice(0, 500),
        quantidade:     item.quantity,
        unidade:        item.unit,
        valor_unitario: item.unitValue,
        valor_total:    item.totalValue,
        insumo_id:      insumo.id,
        fazenda_id,    // ← adicionar
      })
```

5. No INSERT de `movimentacoes_estoque`, adicionar `fazenda_id`:
```typescript
      await supabase.from('movimentacoes_estoque').insert({
        insumo_id:         insumo.id,
        tipo:              'entrada',
        quantidade:        quantidade,
        data:              dataFormatada,
        origem:            'nfe',
        nota_fiscal_id:    nfeId,
        fazenda_id,        // ← adicionar
        // ... restante dos campos existentes
      })
```

6. No INSERT de `lancamentos_financeiros` (buscar pelo `.from('lancamentos_financeiros').insert` no arquivo), adicionar `fazenda_id`.

7. No INSERT de `alertas` (buscar pelo `.from('alertas').insert`), adicionar `fazenda_id`.

- [ ] **4.5: Build TypeScript da API**

```bash
cd api && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Esperado: zero erros TypeScript.

- [ ] **4.6: Atualizar URL do Make.com por cenário**

Para cada cenário Make.com (MG, SP, MT), editar o módulo HTTP:
- MG: `https://<railway-url>/webhook/nfe-email?fazenda=mg`
- SP: `https://<railway-url>/webhook/nfe-email?fazenda=sp`
- MT: `https://<railway-url>/webhook/nfe-email?fazenda=mt`

- [ ] **4.7: Commit**

```bash
git add api/src/webhooks/nfeEmailWebhook.ts api/src/services/nfeProcessor.ts
git commit -m "feat(api): NF-e processa por fazenda — fazenda_id injetado em todos os inserts"
```

---

## Task 5: API — WhatsApp + Z-API multi-instância

**Files:**
- Modify: `api/src/services/zapi.ts`
- Modify: `api/src/webhooks/whatsapp.ts`
- Modify: `.env.example`

- [ ] **5.1: Atualizar .env.example**

Modify `.env.example` — adicionar após as vars existentes de Z-API:

```bash
# Z-API por fazenda (substitui as vars genéricas quando multi-fazenda ativo)
ZAPI_INSTANCE_MG=
ZAPI_TOKEN_MG=
ZAPI_CLIENT_TOKEN_MG=
ZAPI_PHONE_MG=

ZAPI_INSTANCE_SP=
ZAPI_TOKEN_SP=
ZAPI_CLIENT_TOKEN_SP=
ZAPI_PHONE_SP=

ZAPI_INSTANCE_MT=
ZAPI_TOKEN_MT=
ZAPI_CLIENT_TOKEN_MT=
ZAPI_PHONE_MT=

# Phones autorizados por fazenda (vírgula-separados)
WHATSAPP_AUTHORIZED_PHONES_MG=
WHATSAPP_AUTHORIZED_PHONES_SP=
WHATSAPP_AUTHORIZED_PHONES_MT=
```

- [ ] **5.2: Atualizar zapi.ts para múltiplas instâncias**

Modify `api/src/services/zapi.ts` — substituir as constantes globais e a função por:

```typescript
import https from 'https'

// Retorna config Z-API para a fazenda informada.
// Fallback para as vars genéricas (compatibilidade com env legado).
function getZapiConfig(fazendaCodigo: string) {
  const code = fazendaCodigo.toUpperCase()
  return {
    instance:    process.env[`ZAPI_INSTANCE_${code}`]     ?? process.env.ZAPI_INSTANCE_ID ?? '',
    token:       process.env[`ZAPI_TOKEN_${code}`]        ?? process.env.ZAPI_TOKEN       ?? '',
    clientToken: process.env[`ZAPI_CLIENT_TOKEN_${code}`] ?? process.env.ZAPI_CLIENT_TOKEN ?? '',
  }
}

export function getAuthorizedPhones(fazendaCodigo: string): string[] {
  const code = fazendaCodigo.toUpperCase()
  const raw = process.env[`WHATSAPP_AUTHORIZED_PHONES_${code}`]
    ?? process.env.WHATSAPP_AUTHORIZED_PHONES
    ?? ''
  return raw.split(',').map(p => p.trim()).filter(Boolean)
}

export async function enviarMensagem(
  phone: string,
  message: string,
  fazendaCodigo: string = 'mg',
): Promise<void> {
  const { instance, token, clientToken } = getZapiConfig(fazendaCodigo)
  const baseUrl = `https://api.z-api.io/instances/${instance}/token/${token}/send-text`

  const mensagemSegura = message.trim().slice(0, 4096)
  const body = JSON.stringify({ phone, message: mensagemSegura })

  return new Promise((resolve, reject) => {
    const url     = new URL(baseUrl)
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      timeout:  15_000,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Client-Token':   clientToken,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          console.error(`[Z-API][${fazendaCodigo}] Erro ${res.statusCode}:`, data.slice(0, 200))
        } else {
          console.log(`[Z-API][${fazendaCodigo}] Resposta ${res.statusCode}:`, data.slice(0, 200))
        }
        resolve()
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Z-API timeout')) })
    req.write(body)
    req.end()
  })
}
```

- [ ] **5.3: Atualizar whatsapp.ts para rotear por fazenda**

Modify `api/src/webhooks/whatsapp.ts`:

1. Adicionar import de `getAuthorizedPhones` no topo (junto com `enviarMensagem`):
```typescript
import { enviarMensagem, getAuthorizedPhones } from '../services/zapi'
import { supabase } from '../services/supabase'
```

2. No handler `whatsappWebhook.post('/')`, adicionar antes da verificação de whitelist:
```typescript
// ADICIONAR logo após router.post('/', async (req, res) => {:
  const fazenda_codigo = (req.query.fazenda as string) ?? 'mg'

  const { data: fazenda } = await supabase
    .from('fazendas')
    .select('id, codigo')
    .eq('codigo', fazenda_codigo)
    .single()

  if (!fazenda) {
    console.warn(`[WA] Fazenda não encontrada: ${fazenda_codigo}`)
    return res.sendStatus(200)
  }
```

3. Substituir a leitura de `WHATSAPP_AUTHORIZED_PHONES` pela função:
```typescript
// BEFORE:
  const authorizedPhones = (process.env.WHATSAPP_AUTHORIZED_PHONES ?? '')
    .split(',').map(p => p.trim()).filter(Boolean)

// AFTER:
  const authorizedPhones = getAuthorizedPhones(fazenda_codigo)
```

4. Em todos os INSERTs de `operacoes`, `movimentacoes_estoque`, `alertas` dentro do handler, adicionar `fazenda_id: fazenda.id`.

5. Em todos os UPDATEs de `estoque` dentro do handler, adicionar `.eq('fazenda_id', fazenda.id)` como filtro extra.

6. Em todas as chamadas de `enviarMensagem(phone, msg)`, adicionar o terceiro argumento:
```typescript
// BEFORE:
await enviarMensagem(phone, mensagem)

// AFTER:
await enviarMensagem(phone, mensagem, fazenda_codigo)
```

- [ ] **5.4: Build TypeScript**

```bash
cd api && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Esperado: zero erros TypeScript.

- [ ] **5.5: Configurar URLs de webhook no Z-API quando chips chegarem**

Para cada instância Z-API no painel z-api.io:
- MG: Webhook URL → `https://<railway-url>/webhook/whatsapp?fazenda=mg`
- SP: Webhook URL → `https://<railway-url>/webhook/whatsapp?fazenda=sp`
- MT: Webhook URL → `https://<railway-url>/webhook/whatsapp?fazenda=mt`

- [ ] **5.6: Adicionar vars no Railway**

Railway Dashboard → Variables → adicionar as vars do `.env.example` para cada fazenda (preencher com valores reais quando chips chegarem; para MG usar os valores já existentes nas vars genéricas).

- [ ] **5.7: Commit**

```bash
git add api/src/services/zapi.ts api/src/webhooks/whatsapp.ts .env.example
git commit -m "feat(api): WhatsApp + Z-API roteados por fazenda via query param"
```

---

## Task 6: PR, Merge e Validação Final

- [ ] **6.1: Abrir PR**

```bash
git push -u origin feat/multi-fazenda
gh pr create --title "feat: multi-fazenda — MG, SP e MT isolados por RLS + switcher no sidebar" \
  --body "Adiciona suporte a 3 fazendas isoladas. DB migration com fazenda_id em 10 tabelas, RLS via JWT claims, Edge Function switch-farm, FazendaSwitcher no sidebar, NF-e e WhatsApp roteados por ?fazenda=<codigo>."
```

- [ ] **6.2: Checklist de validação**

Antes de mergear, testar manualmente:

- [ ] Sidebar mostra dropdown com 3 fazendas
- [ ] Trocar para SP: dados mudam (estoque/talhões da SP — inicialmente vazios)
- [ ] Voltar para MG: dados MG voltam
- [ ] NF-e de MG enviada via Make.com com `?fazenda=mg` → aparece na tela de NF-e quando logado em MG
- [ ] A mesma NF-e NÃO aparece quando logado em SP
- [ ] WhatsApp de MG (`?fazenda=mg`) salva operação visível apenas em MG

- [ ] **6.3: Merge e limpeza**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
```

---

## Notas Importantes

**Performance RLS:** `get_fazenda_ativa_id()` é chamada em cada row check. Marcada como `STABLE` — Postgres a executa uma vez por query, não por linha. Para este volume (fazenda pequena), sem impacto.

**Primeiro login:** Se `fazenda_ativa_id` não está no JWT (usuário novo), o `FazendaProvider` chama `switch-farm` automaticamente com a primeira fazenda. O fallback no SQL também cobre queries antes do refresh.

**Legado:** As vars genéricas (`ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, etc.) continuam funcionando como fallback — não quebra a fazenda MG existente enquanto as novas vars não estão configuradas.

**Make.com — único cenário atual:** Se hoje só existe 1 cenário Make para MG, basta adicionar `?fazenda=mg` na URL do webhook desse cenário. SP e MT virão depois.
