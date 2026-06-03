# Cartões de Crédito — Milestone 1: DB + Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a migration do banco + parser XLSX + rotas da API para cartões de crédito, entregando backend completo e testável via curl.

**Architecture:** Nova tabela `cartoes` + 3 colunas em `lancamentos_financeiros`. Parser SheetJS lê o formato real do Banco do Brasil (colunas Titular|Bandeira|Dia|Mês|Ano|Descrição|Moeda|Valor). Routes Express seguem o padrão existente do projeto (Router + Zod + service client Supabase). Upload via base64 em JSON (sem multer).

**Tech Stack:** Node.js + Express + TypeScript, Supabase (PostgreSQL), SheetJS (`xlsx` v0.18.5 — já instalado), Node `crypto` (hash SHA-256 nativo), Zod (validação).

---

## Contexto do projeto

- API em `api/src/`, deploy no Railway
- Arquivo de entrada do servidor: `api/src/index.ts`
- Pattern de route: `export const xRoutes = Router()` em `api/src/routes/x.ts`
- Pattern de serviço: funções exportadas em `api/src/services/x.ts`
- Auth middleware: `requireAuth` de `api/src/middleware/auth.ts` — disponibiliza `req.user`
- `fazenda_id` extração: `req.user?.app_metadata?.fazenda_ativa_id as string`
- Supabase service client (bypassa RLS): `import { supabase } from '../services/supabase'`
- Migrations: arquivos SQL em `supabase/migrations/`, executados manualmente no Supabase SQL Editor
- `xlsx` já está em `api/package.json` — **não é preciso `npm install`**

---

## Arquivos do Milestone

| Ação | Arquivo |
|------|---------|
| Criar | `supabase/migrations/002_cartoes.sql` |
| Criar | `api/src/services/xlsxParser.ts` |
| Criar | `api/src/routes/cartoes.ts` |
| Modificar | `api/src/index.ts` |

---

## Task 1: Migration SQL

**Files:**
- Create: `supabase/migrations/002_cartoes.sql`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- ============================================================
-- AgroMouro — Cartões de Crédito
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- ============================================================

-- 1. Criar tabela cartoes
CREATE TABLE IF NOT EXISTS cartoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apelido          TEXT NOT NULL,
  ultimos_digitos  CHAR(4),
  banco            TEXT DEFAULT 'Banco do Brasil',
  responsavel      TEXT,
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id),
  ativo            BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- 2. Adicionar colunas em lancamentos_financeiros
ALTER TABLE lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS cartao_id   UUID REFERENCES cartoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem      TEXT CHECK (origem IN ('nfe', 'cartao', 'manual')),
  ADD COLUMN IF NOT EXISTS dedup_hash  TEXT;

-- 3. Índice de unicidade para deduplicação de importações
CREATE UNIQUE INDEX IF NOT EXISTS idx_lancamentos_dedup
  ON lancamentos_financeiros (cartao_id, dedup_hash)
  WHERE dedup_hash IS NOT NULL;

-- 4. Índice de performance
CREATE INDEX IF NOT EXISTS idx_cartoes_fazenda ON cartoes(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_cartao ON lancamentos_financeiros(cartao_id);

-- 5. RLS para cartoes
ALTER TABLE cartoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cartoes_tenant" ON cartoes
  FOR ALL
  USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
```

- [ ] **Step 2: Executar no Supabase SQL Editor**

Acesse o Supabase → SQL Editor → cole o conteúdo acima → Run.

Verificar que retornou sem erros. Depois confirmar:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'lancamentos_financeiros'
AND column_name IN ('cartao_id', 'origem', 'dedup_hash');
-- Deve retornar 3 linhas
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_cartoes.sql
git commit -m "feat(cartoes): migration DB — tabela cartoes + colunas lancamentos"
```

---

## Task 2: Parser XLSX

**Files:**
- Create: `api/src/services/xlsxParser.ts`

O arquivo XLSX real do BB tem esta estrutura (confirmada na análise):
- Linha 0: cabeçalho `[Titular, Bandeira, Dia, Mês, Ano, Descrição, Moeda, Valor]`
- Linhas 1+: dados — `["CC Matheus", "Visa", 7, 1, 2026, "POSTO SHELL", "R$ ", 240]`
- `Valor` já é `number` — sem parsing de formato brasileiro
- `Dia`, `Mês`, `Ano` são `number` — reconstrução: `new Date(Ano, Mês-1, Dia)`

- [ ] **Step 1: Criar o serviço xlsxParser.ts**

```typescript
import * as XLSX from 'xlsx'
import { createHash } from 'crypto'

export interface TransacaoExtrato {
  titular:   string
  data:      string   // "YYYY-MM-DD"
  descricao: string
  valor:     number   // sempre positivo
  dedupHash: string   // SHA-256 para deduplicação
}

/**
 * Parseia o relatório XLSX do Banco do Brasil.
 * Formato esperado: Titular|Bandeira|Dia|Mês|Ano|Descrição|Moeda|Valor
 * Linha 0 é cabeçalho, dados começam na linha 1.
 */
export function parseXLSX(buffer: Buffer): TransacaoExtrato[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })

  const resultado: TransacaoExtrato[] = []

  // Linha 0 é cabeçalho — pular
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]

    const titular  = String(row[0] ?? '').trim()
    const dia      = Number(row[2])
    const mes      = Number(row[3])
    const ano      = Number(row[4])
    const descricao = String(row[5] ?? '').trim()
    const valor    = Number(row[7])

    // Pular linhas inválidas ou totalizadoras
    if (!titular || !descricao || isNaN(valor) || isNaN(dia) || isNaN(mes) || isNaN(ano)) {
      continue
    }

    // Reconstruir data ISO a partir das 3 colunas numéricas
    const date = new Date(ano, mes - 1, dia)
    const data = date.toISOString().split('T')[0]

    const dedupHash = createHash('sha256')
      .update(`${titular}|${data}|${valor}|${descricao.toLowerCase()}`)
      .digest('hex')

    resultado.push({ titular, data, descricao, valor: Math.abs(valor), dedupHash })
  }

  return resultado
}
```

- [ ] **Step 2: Verificar que compila sem erro**

```bash
cd api
npx tsx -e "
const { parseXLSX } = require('./src/services/xlsxParser')
const fs = require('fs')
const buf = fs.readFileSync('../Cartões BB - Matheus, Alexandre, Marcia, Ivan.xlsx')
const result = parseXLSX(buf)
console.log('Total transações:', result.length)
console.log('Primeira:', JSON.stringify(result[0], null, 2))
console.log('Titulares:', [...new Set(result.map(r => r.titular))])
"
```

Saída esperada:
```
Total transações: 458
Primeira: {
  "titular": "CC Matheus",
  "data": "2026-01-07",
  "descricao": "HORTIFRUTI MERCES LTDA UBERABA BR",
  "valor": 240,
  "dedupHash": "..."
}
Titulares: [ 'CC Matheus', 'CC Alexandre', 'CC Marcia', 'CC Ivan' ]
```

- [ ] **Step 3: Commit**

```bash
git add api/src/services/xlsxParser.ts
git commit -m "feat(cartoes): serviço xlsxParser para formato BB real"
```

---

## Task 3: Routes — CRUD de cartões

**Files:**
- Create: `api/src/routes/cartoes.ts`

- [ ] **Step 1: Criar o arquivo de routes com CRUD**

```typescript
import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../services/supabase'
import { parseXLSX } from '../services/xlsxParser'

export const cartaoRoutes = Router()

// ─── Schema de validação ──────────────────────────────────────────────────────

const cartaoSchema = z.object({
  apelido:         z.string().min(1),
  ultimos_digitos: z.string().length(4).regex(/^\d{4}$/).optional(),
  banco:           z.string().default('Banco do Brasil'),
  responsavel:     z.string().optional(),
})

// ─── GET /cartoes — listar cartões da fazenda ─────────────────────────────────
cartaoRoutes.get('/', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('cartoes')
      .select('*')
      .eq('fazenda_id', fazendaId)
      .eq('ativo', true)
      .order('apelido', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// ─── POST /cartoes — cadastrar cartão ────────────────────────────────────────
cartaoRoutes.post('/', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = cartaoSchema.parse(req.body)

    const { data, error } = await supabase
      .from('cartoes')
      .insert({ ...body, fazenda_id: fazendaId })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── PUT /cartoes/:id — atualizar cartão ─────────────────────────────────────
cartaoRoutes.put('/:id', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = cartaoSchema.partial().parse(req.body)

    const { data, error } = await supabase
      .from('cartoes')
      .update(body)
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Cartão não encontrado' })
    res.json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── DELETE /cartoes/:id — desativar cartão (soft delete) ────────────────────
cartaoRoutes.delete('/:id', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { error } = await supabase
      .from('cartoes')
      .update({ ativo: false })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)

    if (error) throw error
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
```

> ⚠️ **Ainda não fechar o arquivo** — as tasks 4 e 5 adicionam mais routes no mesmo arquivo.

- [ ] **Step 2: Commit parcial**

```bash
git add api/src/routes/cartoes.ts
git commit -m "feat(cartoes): routes CRUD (GET, POST, PUT, DELETE)"
```

---

## Task 4: Route — importar-preview

**Files:**
- Modify: `api/src/routes/cartoes.ts` (continuar o mesmo arquivo)

- [ ] **Step 1: Adicionar route `POST /importar-preview` ao arquivo cartoes.ts**

Append no final do arquivo (antes do `export`):

```typescript
// ─── POST /cartoes/importar-preview — parseia XLSX, retorna prévia ────────────
// Body: { arquivo: string (base64 do .xlsx) }
cartaoRoutes.post('/importar-preview', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { arquivo } = req.body as { arquivo?: string }
    if (!arquivo) return res.status(400).json({ error: 'Campo arquivo (base64) obrigatório' })

    const buffer = Buffer.from(arquivo, 'base64')
    const transacoes = parseXLSX(buffer)

    if (transacoes.length === 0) {
      return res.status(400).json({ error: 'Nenhuma transação encontrada no arquivo' })
    }

    // Buscar cartões cadastrados para a fazenda (match por apelido)
    const { data: cartoes, error: errCartoes } = await supabase
      .from('cartoes')
      .select('id, apelido')
      .eq('fazenda_id', fazendaId)
      .eq('ativo', true)

    if (errCartoes) throw errCartoes

    const cartaoMap = new Map<string, string>(
      (cartoes ?? []).map(c => [c.apelido.toLowerCase(), c.id])
    )

    // Buscar hashes já importados para detectar duplicatas
    const hashesDoArquivo = transacoes.map(t => t.dedupHash)
    const { data: jaImportados } = await supabase
      .from('lancamentos_financeiros')
      .select('dedup_hash')
      .in('dedup_hash', hashesDoArquivo)
      .eq('fazenda_id', fazendaId)

    const hashesImportados = new Set((jaImportados ?? []).map(r => r.dedup_hash))

    // Montar resposta agrupada por titular
    const grupos: Record<string, {
      cartao_id:    string | null
      transacoes:   Array<{
        dedupHash:    string
        data:         string
        descricao:    string
        valor:        number
        categoria:    string
        incluir:      boolean
        ja_importado: boolean
      }>
    }> = {}

    for (const t of transacoes) {
      const titular = t.titular
      if (!grupos[titular]) {
        grupos[titular] = {
          cartao_id: cartaoMap.get(titular.toLowerCase()) ?? null,
          transacoes: [],
        }
      }
      grupos[titular].transacoes.push({
        dedupHash:    t.dedupHash,
        data:         t.data,
        descricao:    t.descricao,
        valor:        t.valor,
        categoria:    'outros',           // default — usuário edita na UI
        incluir:      !hashesImportados.has(t.dedupHash),
        ja_importado: hashesImportados.has(t.dedupHash),
      })
    }

    res.json({
      total:         transacoes.length,
      ja_importados: hashesImportados.size,
      grupos,
    })
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add api/src/routes/cartoes.ts
git commit -m "feat(cartoes): route importar-preview (parse XLSX + dedup check)"
```

---

## Task 5: Routes — confirmar-importacao + lançamento manual

**Files:**
- Modify: `api/src/routes/cartoes.ts` (continuar o mesmo arquivo)

- [ ] **Step 1: Adicionar as 2 routes finais ao arquivo cartoes.ts**

Append no final:

```typescript
// ─── POST /cartoes/confirmar-importacao — salvar transações confirmadas ───────
const confirmarSchema = z.array(z.object({
  dedupHash:  z.string(),
  cartao_id:  z.string().uuid(),
  data:       z.string(),
  descricao:  z.string(),
  valor:      z.number().positive(),
  categoria:  z.string(),
  incluir:    z.boolean(),
}))

cartaoRoutes.post('/confirmar-importacao', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const itens = confirmarSchema.parse(req.body)
    const selecionados = itens.filter(i => i.incluir)

    if (selecionados.length === 0) {
      return res.status(400).json({ error: 'Nenhuma transação selecionada para importar' })
    }

    const registros = selecionados.map(i => ({
      data:        i.data,
      descricao:   i.descricao,
      valor:       i.valor,
      tipo:        'despesa' as const,
      categoria:   i.categoria,
      origem:      'cartao' as const,
      cartao_id:   i.cartao_id,
      dedup_hash:  i.dedupHash,
      fazenda_id:  fazendaId,
    }))

    // ignoreDuplicates: se o hash já existe, pula silenciosamente
    const { data, error } = await supabase
      .from('lancamentos_financeiros')
      .upsert(registros, { onConflict: 'cartao_id,dedup_hash', ignoreDuplicates: true })
      .select()

    if (error) throw error
    res.status(201).json({ importados: data?.length ?? 0 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /cartoes/lancamento — lançamento manual avulso ─────────────────────
const lancamentoManualSchema = z.object({
  data:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descricao:  z.string().min(1),
  valor:      z.number().positive(),
  categoria:  z.enum(['peca_maquina', 'manutencao', 'alimentacao', 'combustivel', 'servico', 'outros']),
  cartao_id:  z.string().uuid(),
})

cartaoRoutes.post('/lancamento', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = lancamentoManualSchema.parse(req.body)

    const { data, error } = await supabase
      .from('lancamentos_financeiros')
      .insert({
        ...body,
        tipo:       'despesa',
        origem:     'manual',
        dedup_hash: null,
        fazenda_id: fazendaId,
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add api/src/routes/cartoes.ts
git commit -m "feat(cartoes): routes confirmar-importacao + lancamento manual"
```

---

## Task 6: Registrar rotas no index.ts

**Files:**
- Modify: `api/src/index.ts`

- [ ] **Step 1: Adicionar o import no topo do index.ts**

Após a linha `import { alertaRoutes } from './routes/alertas'`, adicionar:

```typescript
import { cartaoRoutes }  from './routes/cartoes'
```

- [ ] **Step 2: Registrar a rota após as outras rotas protegidas**

Após a linha `app.use('/alertas',   requireAuth, alertaRoutes)`, adicionar:

```typescript
app.use('/cartoes',   requireAuth, cartaoRoutes)
```

- [ ] **Step 3: Ajustar limite do JSON para uploads base64 (XLSX ~80KB)**

Localizar a linha:
```typescript
app.use(express.json({ limit: '100kb' }))
```

Alterar para:
```typescript
app.use(express.json({ limit: '2mb' }))
```

> Justificativa: upload base64 de XLSX com 458 linhas fica em ~80KB. O limite de 100KB seria insuficiente. 2MB é seguro e cobre arquivos maiores no futuro sem exagero.

- [ ] **Step 4: Commit**

```bash
git add api/src/index.ts
git commit -m "feat(cartoes): registra rotas /cartoes no servidor"
```

---

## Task 7: Smoke test via curl

Com a API rodando localmente (`npm run dev` na pasta `api/`), testar cada rota. Obtenha um token válido via login no frontend (copie do Network tab no navegador).

- [ ] **Step 1: Cadastrar um cartão**

```bash
TOKEN="seu-jwt-aqui"

curl -X POST http://localhost:3001/cartoes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apelido":"CC Matheus","ultimos_digitos":"1234","responsavel":"Matheus"}'
```

Saída esperada: `{"id":"uuid...","apelido":"CC Matheus","banco":"Banco do Brasil",...}`

- [ ] **Step 2: Listar cartões**

```bash
curl http://localhost:3001/cartoes \
  -H "Authorization: Bearer $TOKEN"
```

Saída esperada: array com o cartão criado.

- [ ] **Step 3: Testar importar-preview com o arquivo real**

```bash
# Converter o XLSX para base64
node -e "
const fs = require('fs')
const b64 = fs.readFileSync('Cartões BB - Matheus, Alexandre, Marcia, Ivan.xlsx').toString('base64')
fs.writeFileSync('/tmp/xlsx_b64.txt', b64)
console.log('Tamanho base64:', b64.length, 'chars')
"

# Enviar para a rota
curl -X POST http://localhost:3001/cartoes/importar-preview \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"arquivo\":\"$(cat /tmp/xlsx_b64.txt)\"}"
```

Saída esperada:
```json
{
  "total": 458,
  "ja_importados": 0,
  "grupos": {
    "CC Matheus": { "cartao_id": "uuid-ou-null", "transacoes": [...] },
    "CC Alexandre": { ... },
    ...
  }
}
```

- [ ] **Step 4: Testar lançamento manual**

```bash
CARTAO_ID="uuid-do-cartao-criado"

curl -X POST http://localhost:3001/cartoes/lancamento \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":\"2026-06-03\",\"descricao\":\"FERRAGEM CENTRO UBERABA\",\"valor\":450.00,\"categoria\":\"peca_maquina\",\"cartao_id\":\"$CARTAO_ID\"}"
```

Saída esperada: `{"id":"...","data":"2026-06-03","descricao":"FERRAGEM CENTRO UBERABA","valor":450,"tipo":"despesa","origem":"manual",...}`

- [ ] **Step 5: Commit final do milestone**

```bash
git push origin HEAD
```

---

## Checklist de conclusão do Milestone 1

- [ ] Migration executada no Supabase sem erros — tabela `cartoes` existe + 3 colunas em `lancamentos_financeiros`
- [ ] `parseXLSX` retorna 458 transações com dados corretos para o arquivo real
- [ ] `GET /cartoes` retorna lista vazia (sem cartões cadastrados ainda)
- [ ] `POST /cartoes` cria cartão com `fazenda_id` correto
- [ ] `POST /cartoes/importar-preview` retorna 458 transações agrupadas por 4 titulares
- [ ] `POST /cartoes/lancamento` cria lançamento manual com `origem: 'manual'`
- [ ] `POST /cartoes/confirmar-importacao` salva lançamentos e responde `{ importados: N }`
- [ ] Reimportar o mesmo arquivo retorna todos com `ja_importado: true` — zero novos inseridos

---

## Próximo passo: Milestone 2

Spec: `docs/superpowers/specs/2026-06-03-cartoes-credito-design.md`  
Milestone 2 constrói a página `/cartoes` no frontend (Next.js).
