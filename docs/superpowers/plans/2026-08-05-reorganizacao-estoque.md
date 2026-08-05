# Reorganização da tela de Estoque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar `web/app/(app)/estoque/page.tsx` (hoje ~1016 linhas monolíticas) em abas "Produtos"/"Histórico", com ordenação por data de entrada no estoque e ações destrutivas escondidas atrás de um menu — sem mudar nenhuma regra de negócio existente.

**Architecture:** Um hook central (`use-estoque-data`) concentra toda leitura/escrita no Supabase e expõe funções nomeadas (`ajustarEstoque`, `excluirInsumo`, etc.) em vez de handlers de formulário genéricos. Dois hooks de filtro (um por aba) isolam busca/ordenação/URL. `page.tsx` só orquestra: monta os hooks, decide a aba ativa, renderiza os componentes de tabela e os dialogs. Cada dialog vira um arquivo próprio, recebendo só o item selecionado + a função de dados que precisa.

**Tech Stack:** Next.js 14 App Router, React (client components), Tailwind CSS, `@base-ui/react` (primitivas por trás de `Button`/`Dialog`, e agora `Tabs`), Supabase (Postgres + RLS), `lucide-react` (ícones).

**Spec:** [docs/superpowers/specs/2026-08-05-reorganizacao-estoque-design.md](../specs/2026-08-05-reorganizacao-estoque-design.md)

## Global Constraints

- Nenhuma mudança de regra de negócio (cálculo de saldo, preço médio, conversão de unidade) — só reorganização de onde/como o código vive.
- Sempre TypeScript, nomes de funções/variáveis em inglês... **exceto**: este projeto usa nomes de domínio em português (`estoque`, `insumo`, `ajustarEstoque`) — siga o padrão já existente no arquivo original, não o genérico do CLAUDE.md raiz.
- Mensagens ao usuário final sempre em português brasileiro.
- Sem framework de teste configurado em `web/` — verificação de UI é manual, via `npm run dev` e clique na tela (não existe `npm test` no `web/package.json`).
- `api/` usa Vitest (`npm test` dentro de `api/`) — mudanças ali devem manter a suíte verde.
- Migrations SQL deste projeto são aplicadas manualmente no Supabase SQL Editor (não há CLI/push automatizado configurado) — a Tarefa 1 termina com um passo manual que só o Matheus (dono do banco) deve executar.

---

## Mapa de arquivos

```
supabase/migrations/010_estoque_created_at.sql   [novo]

api/src/routes/estoque.ts                         [modificar]
web/lib/types.ts                                   [modificar]

web/components/ui/tabs.tsx                         [novo]

web/app/(app)/estoque/
├── page.tsx                              [reescrever — some o monolito]
├── constants.ts                          [novo]
├── lib/
│   └── url-params.ts                     [novo]
├── hooks/
│   ├── use-estoque-data.ts               [novo]
│   ├── use-filtros-produtos.ts           [novo]
│   └── use-filtros-historico.ts          [novo]
└── components/
    ├── kpis-estoque.tsx                  [novo]
    ├── tabela-produtos.tsx               [novo]
    ├── tabela-historico.tsx              [novo]
    └── dialogs/
        ├── novo-insumo-dialog.tsx        [novo]
        ├── ajustar-estoque-dialog.tsx    [novo]
        ├── converter-unidade-dialog.tsx  [novo]
        ├── excluir-insumo-dialog.tsx     [novo]
        ├── editar-movimentacao-dialog.tsx   [novo]
        └── excluir-movimentacao-dialog.tsx  [novo]
```

---

### Task 1: Migração — `estoque.created_at` + backfill

**Files:**
- Create: `supabase/migrations/010_estoque_created_at.sql`

**Interfaces:**
- Produces: coluna `estoque.created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, consumida pela Task 2 (ordenação da API) e pela Task 5/hook (tipo `Estoque.created_at`).

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================
-- AgroMouro — estoque.created_at: data de entrada de cada produto
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Plano: docs/superpowers/plans/2026-08-05-reorganizacao-estoque.md
-- ============================================================
--
-- POR QUE: a tela de Estoque precisa ordenar produtos por "mais recente
-- primeiro" (o que entrou por último). A tabela `estoque` só tinha
-- `updated_at`, que muda a cada ajuste — não serve pra saber quando o
-- produto entrou. `movimentacoes_estoque` já tem `created_at`, e como a
-- linha em `estoque` é criada uma única vez (na primeira entrada do
-- produto, nunca recriada depois — ver nfeProcessor.ts e o cadastro manual
-- em estoque/page.tsx), a data da primeira movimentação de "entrada" é a
-- data de entrada real do produto no estoque.
--
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE estoque e
SET created_at = primeira_entrada.data
FROM (
  SELECT insumo_id, MIN(created_at) AS data
  FROM movimentacoes_estoque
  WHERE tipo = 'entrada'
  GROUP BY insumo_id
) AS primeira_entrada
WHERE e.insumo_id = primeira_entrada.insumo_id;

-- Produtos sem nenhuma movimentação de "entrada" registrada (raro — só
-- existem por ajuste manual direto) ficam com o valor padrão (o momento em
-- que esta migration rodou) e aparecem por último na ordenação "mais
-- recentes primeiro". Não precisam de tratamento especial na aplicação.

-- VERIFICAÇÃO — confira o resultado antes de considerar concluído.
SELECT
  count(*) FILTER (WHERE created_at::date = current_date) AS sem_entrada_registrada,
  count(*) AS total_produtos
FROM estoque;

SELECT i.nome, e.created_at
FROM estoque e JOIN insumos i ON i.id = e.insumo_id
ORDER BY e.created_at ASC
LIMIT 5;
```

- [ ] **Step 2: Aplicar manualmente (só o Matheus, ou com autorização explícita dele)**

Esta é uma mudança direta em produção. Não execute via ferramenta automatizada — copie o conteúdo do arquivo, cole no SQL Editor do Supabase Studio, rode, e confira os dois `SELECT` de verificação no final:
- `sem_entrada_registrada` deve ser um número pequeno (produtos raros sem histórico de entrada) — se vier igual a `total_produtos`, algo deu errado (a junção com `movimentacoes_estoque` não encontrou nada, pare e investigue antes de seguir).
- A segunda consulta deve mostrar produtos antigos de verdade (não todos "hoje").

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_estoque_created_at.sql
git commit -m "feat(estoque): adiciona created_at em estoque com backfill pela 1a entrada"
```

---

### Task 2: API ordena por `created_at` + tipo `Estoque` ganha o campo

**Files:**
- Modify: `api/src/routes/estoque.ts:9-14`
- Modify: `web/lib/types.ts:17-24`

**Interfaces:**
- Consumes: coluna `estoque.created_at` (Task 1)
- Produces: `Estoque.created_at: string`, consumido pelas Tasks 6 e 8 (ordenação no frontend)

- [ ] **Step 1: Atualizar a query da API**

Em `api/src/routes/estoque.ts`, troque:

```ts
    const { data, error } = await supabase
      .from('estoque')
      .select('*, insumos(nome, tipo, unidade)')
      // Supabase não suporta .order() em colunas de tabela relacionada.
      // Ordenamos pelo campo local e deixamos o frontend ordenar por nome se precisar.
      .order('quantidade_atual', { ascending: false })
```

por:

```ts
    const { data, error } = await supabase
      .from('estoque')
      .select('*, insumos(nome, tipo, unidade)')
      // Supabase não suporta .order() em colunas de tabela relacionada.
      // "Mais recente primeiro" é a ordem padrão da tela; o frontend
      // reordena por nome quando o usuário pedir.
      .order('created_at', { ascending: false })
```

- [ ] **Step 2: Adicionar `created_at` ao tipo `Estoque`**

Em `web/lib/types.ts`:

```ts
export interface Estoque {
  id: string
  insumo_id: string
  quantidade_atual: number
  quantidade_minima_alerta: number
  preco_medio_unitario: number
  created_at: string
  insumos: Insumo
}
```

- [ ] **Step 3: Verificar manualmente**

Depois de aplicar a Task 1 no banco: `cd api && npm run dev`, chame `GET /estoque` (ex. `curl http://localhost:3001/estoque` com um token válido, ou pelo próprio frontend depois da Task 12) e confira que a resposta vem ordenada do `created_at` mais recente pro mais antigo e que cada item tem o campo `created_at`.

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/estoque.ts web/lib/types.ts
git commit -m "feat(estoque): API ordena por created_at; tipo Estoque ganha o campo"
```

---

### Task 3: Componente `Tabs`

**Files:**
- Create: `web/components/ui/tabs.tsx`

**Interfaces:**
- Consumes: `@base-ui/react/tabs` (já é dependência do projeto — usado por `Button`/`Dialog` o mesmo padrão de wrapping)
- Produces: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, consumidos pela Task 12 (`page.tsx`)

- [ ] **Step 1: Criar o componente**

```tsx
"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none transition-all",
        "text-muted-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm",
        "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

`data-active` é o atributo real que `@base-ui/react/tabs` coloca na tab selecionada (confirmado em `node_modules/@base-ui/react/tabs/tab/TabsTabDataAttributes.d.ts`) — não é `data-selected` (nome comum em outras libs, mas errado aqui).

- [ ] **Step 2: Verificar manualmente**

Crie temporariamente um teste visual (ou aguarde a Task 12, que já usa o componente na tela real) — não é necessário um harness isolado, a Task 12 serve como verificação end-to-end deste componente.

- [ ] **Step 3: Commit**

```bash
git add web/components/ui/tabs.tsx
git commit -m "feat(ui): adiciona componente Tabs (wrapper de @base-ui/react/tabs)"
```

---

### Task 4: Constantes e utilitário de URL compartilhados

**Files:**
- Create: `web/app/(app)/estoque/constants.ts`
- Create: `web/app/(app)/estoque/lib/url-params.ts`

**Interfaces:**
- Produces: `TIPOS`, `UNIDADES`, `UNIDADES_BASE`, `SELECT_CLASS`, `ORIGENS` (constants.ts); `getUrlParam`, `setUrlParam`, `limparUrlParams` (url-params.ts) — consumidos pelas Tasks 5, 6, 7 e pelos componentes de tabela/dialog

- [ ] **Step 1: Extrair as constantes**

```ts
// web/app/(app)/estoque/constants.ts
import { TIPOS_INSUMO } from '@/lib/insumos'

export const TIPOS: [string, string][] = Object.entries(TIPOS_INSUMO)

export const UNIDADES      = ['L', 'KG', 'ml', 't', 'sc', 'un']
export const UNIDADES_BASE = new Set(['L', 'KG', 'kg', 'ml', 'ML', 'g', 't', 'sc', 'un', 'UN', 'ha'])

export const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

export const ORIGENS: [string, string][] = [
  ['nfe',              'NF-e'],
  ['operacao',         'Operação'],
  ['whatsapp',         'WhatsApp'],
  ['manual',           'Manual'],
  ['correcao_unidade', 'Correção de unidade'],
]
```

- [ ] **Step 2: Criar o utilitário de parâmetros de URL**

O `setUrlParam` original zerava a URL inteira no botão "Limpar" (`window.history.replaceState(null, '', window.location.pathname)`), o que era inofensivo quando só existiam 3 parâmetros (`q`, `tipo`, `status`). A partir desta reorganização a URL também guarda a aba ativa (`tab`) e a ordenação (`ordenar`) — se "Limpar filtros" continuasse apagando a URL inteira, ele derrubaria também a aba/ordenação escolhidas pelo usuário sem necessidade. Por isso `limparUrlParams` recebe a lista exata de chaves a remover, em vez de zerar tudo.

```ts
// web/app/(app)/estoque/lib/url-params.ts

export function getUrlParam(key: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(key)
}

export function setUrlParam(key: string, value: string, dflt = 'todos') {
  const p = new URLSearchParams(window.location.search)
  if (!value || value === dflt) p.delete(key)
  else p.set(key, value)
  window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname)
}

export function limparUrlParams(keys: string[]) {
  const p = new URLSearchParams(window.location.search)
  keys.forEach(k => p.delete(k))
  window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname)
}
```

- [ ] **Step 3: Commit**

```bash
git add web/app/\(app\)/estoque/constants.ts web/app/\(app\)/estoque/lib/url-params.ts
git commit -m "refactor(estoque): extrai constantes e utilitário de URL compartilhados"
```

---

### Task 5: Hook `use-estoque-data`

**Files:**
- Create: `web/app/(app)/estoque/hooks/use-estoque-data.ts`

**Interfaces:**
- Consumes: `Estoque`, `MovimentacaoEstoque` (`@/lib/types`), `supabase` (`@/lib/supabase`), `api` (`@/lib/api`)
- Produces:
  ```ts
  export type MovimentacaoComFornecedor = MovimentacaoEstoque & { fornecedor_nome?: string; talhao_nome?: string }
  type ResultadoExclusao = { ok: true } | { ok: false; erro: string }

  function useEstoqueData(): {
    estoque: Estoque[]
    movimentacoes: MovimentacaoComFornecedor[]
    loading: boolean
    recarregar: () => Promise<void>
    ajustarEstoque: (item: Estoque, novaQuantidade: number, novoPreco: number | null) => Promise<void>
    editarMovimentacao: (mov: MovimentacaoComFornecedor, novoTipo: 'entrada' | 'saida', novaQuantidade: number, novaData: string) => Promise<void>
    excluirMovimentacao: (mov: MovimentacaoComFornecedor) => Promise<ResultadoExclusao>
    criarInsumo: (form: { nome: string; tipo: string; unidade: string; quantidade: number; minimo: number; preco: number }) => Promise<void>
    excluirInsumo: (item: Estoque) => Promise<ResultadoExclusao>
    converterUnidade: (item: Estoque, novaUnidade: string, fator: number) => Promise<void>
  }
  ```
  Consumido pela Task 12 (`page.tsx`) e por todos os dialogs (Tasks 9-11).

- [ ] **Step 1: Escrever o hook**

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { Estoque, MovimentacaoEstoque } from '@/lib/types'

export type MovimentacaoComFornecedor = MovimentacaoEstoque & {
  fornecedor_nome?: string
  talhao_nome?: string
}

type ResultadoExclusao = { ok: true } | { ok: false; erro: string }

// Duplicado antes em handleEditMov e handleDeleteMov: lê o saldo atual do
// banco (não confia em estado do React, que pode estar desatualizado),
// soma o delta e nunca deixa passar de zero pra negativo por engano de
// arredondamento — igual ao comportamento original nos dois lugares.
async function ajustarSaldoPorDelta(insumoId: string, delta: number) {
  if (delta === 0) return
  const { data: row } = await supabase
    .from('estoque').select('id, quantidade_atual').eq('insumo_id', insumoId).single()
  if (!row) return
  await supabase.from('estoque')
    .update({ quantidade_atual: Math.max(0, row.quantidade_atual + delta) })
    .eq('id', row.id)
}

export function useEstoqueData() {
  const [estoque, setEstoque] = useState<Estoque[]>([])
  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoComFornecedor[]>([])
  const [loading, setLoading] = useState(true)

  const recarregar = useCallback(async () => {
    const [e, movs] = await Promise.all([
      api.get<Estoque[]>('/estoque').catch(() => [] as Estoque[]),
      supabase
        .from('movimentacoes_estoque')
        .select('*, insumos(nome, unidade), operacoes(talhoes(nome))')
        .order('created_at', { ascending: false })
        .limit(100)
        .then(({ data }) => (data ?? []) as MovimentacaoEstoque[]),
    ])

    const nfeIds = [...new Set(movs.filter(m => m.nota_fiscal_id).map(m => m.nota_fiscal_id!))]
    let fornecedorMap: Record<string, string> = {}
    if (nfeIds.length > 0) {
      const { data: notas } = await supabase
        .from('notas_fiscais').select('id, emitente_nome').in('id', nfeIds)
      fornecedorMap = Object.fromEntries((notas ?? []).map(n => [n.id, n.emitente_nome]))
    }

    setEstoque(e)
    setMovimentacoes(movs.map(m => ({
      ...m,
      fornecedor_nome: m.nota_fiscal_id ? fornecedorMap[m.nota_fiscal_id] : undefined,
      talhao_nome: m.operacoes?.talhoes?.nome ?? undefined,
    })))
    setLoading(false)
  }, [])

  useEffect(() => { recarregar() }, [recarregar])

  async function ajustarEstoque(item: Estoque, novaQuantidade: number, novoPreco: number | null) {
    const diff = novaQuantidade - item.quantidade_atual
    const tipo = diff >= 0 ? 'entrada' : 'saida'
    await supabase.from('movimentacoes_estoque').insert({
      insumo_id: item.insumo_id,
      tipo,
      quantidade: Math.abs(diff),
      data: new Date().toISOString(),
      origem: 'manual',
    })
    const updatePayload: Record<string, unknown> = { quantidade_atual: novaQuantidade }
    if (novoPreco !== null && novoPreco >= 0) updatePayload.preco_medio_unitario = novoPreco
    await supabase.from('estoque').update(updatePayload).eq('id', item.id)
    await recarregar()
  }

  async function editarMovimentacao(
    mov: MovimentacaoComFornecedor,
    novoTipo: 'entrada' | 'saida',
    novaQuantidade: number,
    novaData: string,
  ) {
    let delta = mov.tipo === 'entrada' ? -mov.quantidade : mov.quantidade
    delta += novoTipo === 'entrada' ? novaQuantidade : -novaQuantidade

    await supabase.from('movimentacoes_estoque').update({
      tipo: novoTipo,
      quantidade: novaQuantidade,
      data: novaData,
    }).eq('id', mov.id)

    await ajustarSaldoPorDelta(mov.insumo_id, delta)
    await recarregar()
  }

  async function excluirMovimentacao(mov: MovimentacaoComFornecedor): Promise<ResultadoExclusao> {
    const { data: deleted, error } = await supabase
      .from('movimentacoes_estoque').delete().eq('id', mov.id).select('id')

    if (error) return { ok: false, erro: `Erro: ${error.message}` }
    if (!deleted || deleted.length === 0) {
      return { ok: false, erro: 'Sem permissão para excluir. Verifique as políticas do banco.' }
    }

    const delta = mov.tipo === 'entrada' ? -mov.quantidade : mov.quantidade
    await ajustarSaldoPorDelta(mov.insumo_id, delta)
    await recarregar()
    return { ok: true }
  }

  async function criarInsumo(form: {
    nome: string; tipo: string; unidade: string
    quantidade: number; minimo: number; preco: number
  }) {
    const { data: insumo, error } = await supabase
      .from('insumos')
      .insert({ nome: form.nome, tipo: form.tipo, unidade: form.unidade })
      .select()
      .single()
    if (insumo && !error) {
      await supabase.from('estoque').insert({
        insumo_id: insumo.id,
        quantidade_atual: form.quantidade,
        quantidade_minima_alerta: form.minimo,
        preco_medio_unitario: form.preco,
      })
      if (form.quantidade > 0) {
        await supabase.from('movimentacoes_estoque').insert({
          insumo_id: insumo.id,
          tipo: 'entrada',
          quantidade: form.quantidade,
          data: new Date().toISOString(),
          origem: 'manual',
        })
      }
    }
    await recarregar()
  }

  async function excluirInsumo(item: Estoque): Promise<ResultadoExclusao> {
    const { error } = await supabase.from('insumos').delete().eq('id', item.insumo_id)
    if (error) return { ok: false, erro: `Erro: ${error.message}` }
    await recarregar()
    return { ok: true }
  }

  async function converterUnidade(item: Estoque, novaUnidade: string, fator: number) {
    const novaQtd   = parseFloat((item.quantidade_atual * fator).toFixed(3))
    const novoPreco = item.preco_medio_unitario > 0
      ? parseFloat((item.preco_medio_unitario / fator).toFixed(4))
      : 0

    await supabase.from('insumos').update({ unidade: novaUnidade }).eq('id', item.insumo_id)
    await supabase.from('estoque').update({
      quantidade_atual: novaQtd,
      ...(novoPreco > 0 ? { preco_medio_unitario: novoPreco } : {}),
    }).eq('id', item.id)
    await supabase.from('movimentacoes_estoque').insert({
      insumo_id: item.insumo_id,
      tipo:      'entrada',
      quantidade: novaQtd,
      data:      new Date().toISOString().split('T')[0],
      origem:    'correcao_unidade',
    })
    await recarregar()
  }

  return {
    estoque, movimentacoes, loading, recarregar,
    ajustarEstoque, editarMovimentacao, excluirMovimentacao,
    criarInsumo, excluirInsumo, converterUnidade,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/\(app\)/estoque/hooks/use-estoque-data.ts
git commit -m "refactor(estoque): extrai use-estoque-data (dados + CRUD centralizados)"
```

(Verificação end-to-end deste hook acontece na Task 12, quando `page.tsx` volta a renderizar de verdade.)

---

### Task 6: Hook `use-filtros-produtos`

**Files:**
- Create: `web/app/(app)/estoque/hooks/use-filtros-produtos.ts`

**Interfaces:**
- Consumes: `Estoque[]` (de `use-estoque-data`), `getUrlParam`/`setUrlParam`/`limparUrlParams` (Task 4)
- Produces:
  ```ts
  export type OrdenacaoProdutos = 'recentes' | 'nome'
  export type FiltroStatus = 'todos' | 'ok' | 'critico' | 'negativo'

  function useFiltrosProdutos(estoque: Estoque[]): {
    busca: string; setBusca: (v: string) => void
    filtroTipo: string; setFiltroTipo: (v: string) => void
    filtroStatus: FiltroStatus; setFiltroStatus: (v: FiltroStatus) => void
    ordenacao: OrdenacaoProdutos; setOrdenacao: (v: OrdenacaoProdutos) => void
    estoqueFiltrado: Estoque[]
    filtroAtivo: boolean
    limpar: () => void
  }
  ```
  Consumido pela Task 8 (`tabela-produtos.tsx`) e pela Task 12 (`page.tsx`).

- [ ] **Step 1: Escrever o hook**

```ts
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Estoque } from '@/lib/types'
import { getUrlParam, setUrlParam, limparUrlParams } from '../lib/url-params'

export type OrdenacaoProdutos = 'recentes' | 'nome'
export type FiltroStatus = 'todos' | 'ok' | 'critico' | 'negativo'

export function useFiltrosProdutos(estoque: Estoque[]) {
  const [busca, setBuscaState]             = useState('')
  const [filtroTipo, setFiltroTipoState]   = useState('todos')
  const [filtroStatus, setFiltroStatusState] = useState<FiltroStatus>('todos')
  const [ordenacao, setOrdenacaoState]     = useState<OrdenacaoProdutos>('recentes')

  useEffect(() => {
    setBuscaState(getUrlParam('q') ?? '')
    setFiltroTipoState(getUrlParam('tipo') ?? 'todos')
    setFiltroStatusState((getUrlParam('status') as FiltroStatus) ?? 'todos')
    setOrdenacaoState((getUrlParam('ordenar') as OrdenacaoProdutos) ?? 'recentes')
  }, [])

  function setBusca(v: string)               { setBuscaState(v); setUrlParam('q', v, '') }
  function setFiltroTipo(v: string)          { setFiltroTipoState(v); setUrlParam('tipo', v) }
  function setFiltroStatus(v: FiltroStatus)  { setFiltroStatusState(v); setUrlParam('status', v) }
  function setOrdenacao(v: OrdenacaoProdutos) { setOrdenacaoState(v); setUrlParam('ordenar', v, 'recentes') }

  function limpar() {
    setBuscaState(''); setFiltroTipoState('todos'); setFiltroStatusState('todos')
    limparUrlParams(['q', 'tipo', 'status'])
  }

  const estoqueFiltrado = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase()
    const filtrado = estoque.filter(item => {
      if (buscaLower && !item.insumos.nome.toLowerCase().includes(buscaLower)) return false
      if (filtroTipo !== 'todos' && item.insumos.tipo !== filtroTipo) return false
      if (filtroStatus !== 'todos') {
        const negativo = item.quantidade_atual < 0
        const critico  = !negativo && item.quantidade_atual <= item.quantidade_minima_alerta
        const ok       = !negativo && !critico
        if (filtroStatus === 'negativo' && !negativo) return false
        if (filtroStatus === 'critico'  && !critico)  return false
        if (filtroStatus === 'ok'       && !ok)       return false
      }
      return true
    })
    const ordenado = [...filtrado]
    if (ordenacao === 'nome') {
      ordenado.sort((a, b) => a.insumos.nome.localeCompare(b.insumos.nome, 'pt-BR'))
    } else {
      ordenado.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    return ordenado
  }, [estoque, busca, filtroTipo, filtroStatus, ordenacao])

  const filtroAtivo = busca.trim() !== '' || filtroTipo !== 'todos' || filtroStatus !== 'todos'

  return {
    busca, setBusca, filtroTipo, setFiltroTipo, filtroStatus, setFiltroStatus,
    ordenacao, setOrdenacao, estoqueFiltrado, filtroAtivo, limpar,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/\(app\)/estoque/hooks/use-filtros-produtos.ts
git commit -m "refactor(estoque): extrai use-filtros-produtos com ordenacao por mais recente"
```

---

### Task 7: Hook `use-filtros-historico`

**Files:**
- Create: `web/app/(app)/estoque/hooks/use-filtros-historico.ts`

**Interfaces:**
- Consumes: `MovimentacaoComFornecedor[]` (de `use-estoque-data`, Task 5), `getUrlParam`/`setUrlParam`/`limparUrlParams` (Task 4)
- Produces:
  ```ts
  export type FiltroOrigem = 'todos' | 'nfe' | 'operacao' | 'whatsapp' | 'manual' | 'correcao_unidade'

  function useFiltrosHistorico(movimentacoes: MovimentacaoComFornecedor[]): {
    busca: string; setBusca: (v: string) => void
    filtroOrigem: FiltroOrigem; setFiltroOrigem: (v: FiltroOrigem) => void
    movimentacoesFiltradas: MovimentacaoComFornecedor[]
    filtroAtivo: boolean
    limpar: () => void
  }
  ```
  Consumido pela Task 9 (`tabela-historico.tsx`) e pela Task 12 (`page.tsx`). Usa a chave de URL `hq` (não `q`) para não colidir com a busca da aba Produtos — as duas abas guardam filtro próprio na mesma URL.

- [ ] **Step 1: Escrever o hook**

```ts
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MovimentacaoComFornecedor } from './use-estoque-data'
import { getUrlParam, setUrlParam, limparUrlParams } from '../lib/url-params'

export type FiltroOrigem = 'todos' | 'nfe' | 'operacao' | 'whatsapp' | 'manual' | 'correcao_unidade'

export function useFiltrosHistorico(movimentacoes: MovimentacaoComFornecedor[]) {
  const [busca, setBuscaState]             = useState('')
  const [filtroOrigem, setFiltroOrigemState] = useState<FiltroOrigem>('todos')

  useEffect(() => {
    setBuscaState(getUrlParam('hq') ?? '')
    setFiltroOrigemState((getUrlParam('origem') as FiltroOrigem) ?? 'todos')
  }, [])

  function setBusca(v: string)             { setBuscaState(v); setUrlParam('hq', v, '') }
  function setFiltroOrigem(v: FiltroOrigem) { setFiltroOrigemState(v); setUrlParam('origem', v, 'todos') }

  function limpar() {
    setBuscaState(''); setFiltroOrigemState('todos')
    limparUrlParams(['hq', 'origem'])
  }

  const movimentacoesFiltradas = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase()
    return movimentacoes.filter(m => {
      if (buscaLower && !m.insumos.nome.toLowerCase().includes(buscaLower)) return false
      if (filtroOrigem !== 'todos' && m.origem !== filtroOrigem) return false
      return true
    })
  }, [movimentacoes, busca, filtroOrigem])

  const filtroAtivo = busca.trim() !== '' || filtroOrigem !== 'todos'

  return { busca, setBusca, filtroOrigem, setFiltroOrigem, movimentacoesFiltradas, filtroAtivo, limpar }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/\(app\)/estoque/hooks/use-filtros-historico.ts
git commit -m "feat(estoque): adiciona use-filtros-historico (busca + filtro de origem)"
```

---

### Task 8: Componente `kpis-estoque.tsx`

**Files:**
- Create: `web/app/(app)/estoque/components/kpis-estoque.tsx`

**Interfaces:**
- Consumes: `Estoque[]`, `TIPOS` (Task 4)
- Produces: `<KpisEstoque estoque={...} />`, consumido pela Task 12

- [ ] **Step 1: Escrever o componente**

```tsx
import { AlertTriangle, PackageX, Boxes, Wallet } from 'lucide-react'
import { KpiCard } from '@/components/ui/kpi-card'
import type { Estoque } from '@/lib/types'
import { TIPOS } from '../constants'

export function KpisEstoque({ estoque }: { estoque: Estoque[] }) {
  const estoqueNegativo = estoque.filter(e => e.quantidade_atual < 0)
  const estoqueCritico  = estoque.filter(e => e.quantidade_atual >= 0 && e.quantidade_atual <= e.quantidade_minima_alerta)
  const valorInventario = estoque.reduce(
    (s, e) => s + Math.max(0, e.quantidade_atual) * (e.preco_medio_unitario ?? 0), 0,
  )

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        label="Valor em Estoque"
        value={valorInventario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
        sub="soma quantidade × preço médio"
        icon={<Wallet className="h-5 w-5" />}
        iconBg="#EFF6FF" iconColor="#2563EB"
      />
      <KpiCard
        label="Insumos Cadastrados"
        value={estoque.length}
        sub={`${TIPOS.length} tipos disponíveis`}
        icon={<Boxes className="h-5 w-5" />}
        iconBg="#EEF5E5" iconColor="#5B8C2A"
      />
      <KpiCard
        label="Críticos"
        value={estoqueCritico.length}
        sub={estoqueCritico.length === 0 ? 'tudo acima do mínimo' : 'abaixo do mínimo'}
        icon={<AlertTriangle className="h-5 w-5" />}
        iconBg={estoqueCritico.length > 0 ? '#FFFBEB' : '#EDFAF1'}
        iconColor={estoqueCritico.length > 0 ? '#D97706' : '#16A34A'}
        valueColor={estoqueCritico.length > 0 ? 'text-amber-600' : undefined}
      />
      <KpiCard
        label="Negativos"
        value={estoqueNegativo.length}
        sub={estoqueNegativo.length === 0 ? 'nenhum saldo negativo' : 'saldo abaixo de zero'}
        icon={<PackageX className="h-5 w-5" />}
        iconBg={estoqueNegativo.length > 0 ? '#FEF2F2' : '#EDFAF1'}
        iconColor={estoqueNegativo.length > 0 ? '#DC2626' : '#16A34A'}
        valueColor={estoqueNegativo.length > 0 ? 'text-red-600' : undefined}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/\(app\)/estoque/components/kpis-estoque.tsx
git commit -m "refactor(estoque): extrai kpis-estoque.tsx"
```

---

### Task 9: Componente `tabela-produtos.tsx`

**Files:**
- Create: `web/app/(app)/estoque/components/tabela-produtos.tsx`

**Interfaces:**
- Consumes: `Estoque[]`, retorno de `useFiltrosProdutos` (Task 6), `TIPOS`/`UNIDADES_BASE`/`SELECT_CLASS` (Task 4), `ActionMenu`/`ActionMenuItem` (`@/components/ui/action-menu`, já existe no projeto)
- Produces: `<TabelaProdutos estoque={...} filtros={...} onNovoInsumo={...} onAjustar={...} onConverter={...} onExcluir={...} />`, consumido pela Task 12

- [ ] **Step 1: Escrever o componente**

```tsx
'use client'

import { Package, Plus, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { Trash2 } from 'lucide-react'
import type { Estoque } from '@/lib/types'
import { TIPOS, UNIDADES_BASE, SELECT_CLASS } from '../constants'
import type { useFiltrosProdutos } from '../hooks/use-filtros-produtos'

type Filtros = ReturnType<typeof useFiltrosProdutos>

export function TabelaProdutos({
  estoque, filtros, onNovoInsumo, onAjustar, onConverter, onExcluir,
}: {
  estoque: Estoque[]
  filtros: Filtros
  onNovoInsumo: () => void
  onAjustar: (item: Estoque) => void
  onConverter: (item: Estoque) => void
  onExcluir: (item: Estoque) => void
}) {
  const {
    busca, setBusca, filtroTipo, setFiltroTipo, filtroStatus, setFiltroStatus,
    ordenacao, setOrdenacao, estoqueFiltrado, filtroAtivo, limpar,
  } = filtros

  const situacaoBadge = (negativo: boolean, critico: boolean) =>
    negativo ? <Badge variant="destructive" className="font-bold">Negativo</Badge>
    : critico ? <Badge variant="destructive">Crítico</Badge>
    : <Badge variant="outline" className="text-green-700 border-green-200">OK</Badge>

  const acoesInsumo = (item: Estoque) => {
    const menuItems: ActionMenuItem[] = []
    if (!UNIDADES_BASE.has(item.insumos.unidade)) {
      menuItems.push({ label: 'Converter Unidade', onClick: () => onConverter(item) })
    }
    menuItems.push({
      label: 'Excluir', destructive: true,
      icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
      onClick: () => onExcluir(item),
    })
    return (
      <>
        <Button size="sm" variant="ghost" onClick={() => onAjustar(item)}>Ajustar</Button>
        <ActionMenu items={menuItems} label={`Mais ações — ${item.insumos.nome}`} />
      </>
    )
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Insumos
            {filtroAtivo && (
              <span className="text-xs font-normal text-muted-foreground ml-1">
                {estoqueFiltrado.length} de {estoque.length}
              </span>
            )}
          </CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome…"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <select
            aria-label="Filtrar por tipo"
            className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[140px]'}
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
          >
            <option value="todos">Todos os tipos</option>
            {TIPOS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar por situação"
            className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[140px]'}
            value={filtroStatus}
            onChange={e => setFiltroStatus(e.target.value as typeof filtroStatus)}
          >
            <option value="todos">Todas situações</option>
            <option value="ok">OK</option>
            <option value="critico">Crítico</option>
            <option value="negativo">Negativo</option>
          </select>
          <select
            aria-label="Ordenar por"
            className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[140px]'}
            value={ordenacao}
            onChange={e => setOrdenacao(e.target.value as typeof ordenacao)}
          >
            <option value="recentes">Mais recentes</option>
            <option value="nome">Nome (A-Z)</option>
          </select>
          {filtroAtivo && (
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={limpar}>
              Limpar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {estoque.length === 0 ? (
          <div className="py-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">Nenhum insumo cadastrado</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cadastre seu primeiro insumo ou importe via NF-e.
                </p>
              </div>
              <Button size="sm" onClick={onNovoInsumo}>
                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Cadastrar insumo
              </Button>
            </div>
          </div>
        ) : estoqueFiltrado.length === 0 ? (
          <div className="py-10">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">Nenhum insumo corresponde aos filtros aplicados.</p>
              <Button variant="ghost" size="sm" onClick={limpar}>Limpar filtros</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop: tabela */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Qtd. Atual</TableHead>
                  <TableHead className="text-right">Preço Médio</TableHead>
                  <TableHead className="text-right">Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {estoqueFiltrado.map(item => {
                  const negativo = item.quantidade_atual < 0
                  const critico  = !negativo && item.quantidade_atual <= item.quantidade_minima_alerta
                  const linhaBg  = negativo ? 'bg-red-100' : critico ? 'bg-red-50/50' : ''
                  const qtdClass = negativo
                    ? 'text-right font-bold text-red-700'
                    : critico
                      ? 'text-right font-semibold text-red-600'
                      : 'text-right font-semibold'
                  return (
                    <TableRow key={item.id} className={linhaBg}>
                      <TableCell className={`font-medium max-w-[180px] ${negativo ? 'font-bold' : ''}`}>
                        <Tooltip>
                          <TooltipTrigger className="truncate block w-full text-left cursor-default bg-transparent border-0 p-0 font-[inherit]">
                            {item.insumos.nome}
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            {item.insumos.nome}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {TIPOS.find(([v]) => v === item.insumos.tipo)?.[1] ?? item.insumos.tipo}
                        </span>
                      </TableCell>
                      <TableCell className={qtdClass}>
                        {item.quantidade_atual} {item.insumos.unidade}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {item.preco_medio_unitario > 0 ? `R$ ${item.preco_medio_unitario.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right">{situacaoBadge(negativo, critico)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">{acoesInsumo(item)}</div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Mobile: cards */}
            <ul className="md:hidden divide-y">
              {estoqueFiltrado.map(item => {
                const negativo = item.quantidade_atual < 0
                const critico  = !negativo && item.quantidade_atual <= item.quantidade_minima_alerta
                const linhaBg  = negativo ? 'bg-red-100' : critico ? 'bg-red-50/50' : ''
                const qtdColor = negativo ? 'font-bold text-red-700' : critico ? 'font-semibold text-red-600' : 'font-semibold'
                return (
                  <li key={item.id} className={`px-4 py-3 ${linhaBg}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${negativo ? 'font-bold' : ''}`}>{item.insumos.nome}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {TIPOS.find(([v]) => v === item.insumos.tipo)?.[1] ?? item.insumos.tipo}
                        </p>
                      </div>
                      {situacaoBadge(negativo, critico)}
                    </div>
                    <div className="flex items-end justify-between gap-2 mt-2">
                      <p className="text-sm tabular-nums">
                        <span className={qtdColor}>{item.quantidade_atual} {item.insumos.unidade}</span>
                        <span className="text-muted-foreground">
                          {' · '}{item.preco_medio_unitario > 0 ? `R$ ${item.preco_medio_unitario.toFixed(2)}` : '—'}
                        </span>
                      </p>
                      <div className="flex items-center gap-1 shrink-0">{acoesInsumo(item)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
```

Nota: troquei `formatTipoInsumo(item.insumos.tipo)` por uma busca direta em `TIPOS` porque o import de `formatTipoInsumo` puxaria `@/lib/insumos` de novo — mesma saída, já que `TIPOS` vem exatamente de `Object.entries(TIPOS_INSUMO)`. Se preferir manter a função helper original em vez desse `.find`, importe `formatTipoInsumo` de `@/lib/insumos` e use como antes — comportamento idêntico, é só estilo.

- [ ] **Step 2: Commit**

```bash
git add web/app/\(app\)/estoque/components/tabela-produtos.tsx
git commit -m "refactor(estoque): extrai tabela-produtos.tsx com ordenacao e menu de acoes"
```

---

### Task 10: Componente `tabela-historico.tsx`

**Files:**
- Create: `web/app/(app)/estoque/components/tabela-historico.tsx`

**Interfaces:**
- Consumes: retorno de `useFiltrosHistorico` (Task 7), `ORIGENS`/`SELECT_CLASS` (Task 4), `ActionMenu` (existente)
- Produces: `<TabelaHistorico filtros={...} onEditar={...} onExcluir={...} />`, consumido pela Task 12

- [ ] **Step 1: Escrever o componente**

```tsx
'use client'

import { Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { Pencil, Trash2 } from 'lucide-react'
import { ORIGENS, SELECT_CLASS } from '../constants'
import type { MovimentacaoComFornecedor } from '../hooks/use-estoque-data'
import type { useFiltrosHistorico } from '../hooks/use-filtros-historico'

type Filtros = ReturnType<typeof useFiltrosHistorico>

export function TabelaHistorico({
  filtros, onEditar, onExcluir,
}: {
  filtros: Filtros
  onEditar: (mov: MovimentacaoComFornecedor) => void
  onExcluir: (mov: MovimentacaoComFornecedor) => void
}) {
  const { busca, setBusca, filtroOrigem, setFiltroOrigem, movimentacoesFiltradas, filtroAtivo, limpar } = filtros

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Histórico de Movimentações</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome do produto…"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <select
            aria-label="Filtrar por origem"
            className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[160px]'}
            value={filtroOrigem}
            onChange={e => setFiltroOrigem(e.target.value as typeof filtroOrigem)}
          >
            <option value="todos">Todas origens</option>
            {ORIGENS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {filtroAtivo && (
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={limpar}>
              Limpar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Insumo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Quantidade</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {movimentacoesFiltradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {filtroAtivo ? 'Nenhuma movimentação corresponde aos filtros aplicados.' : 'Nenhuma movimentação registrada.'}
                </TableCell>
              </TableRow>
            ) : movimentacoesFiltradas.map(m => {
              const menuItems: ActionMenuItem[] = [{
                label: 'Excluir', destructive: true,
                icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
                onClick: () => onExcluir(m),
              }]
              return (
                <TableRow key={m.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.data.slice(0, 10).split('-').reverse().join('/')}
                  </TableCell>
                  <TableCell className="font-medium">{m.insumos.nome}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={m.tipo === 'entrada' ? 'text-green-700 border-green-200' : 'text-red-600 border-red-200'}
                    >
                      {m.tipo === 'entrada' ? '+ entrada' : '− saída'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {m.quantidade} {m.insumos.unidade}
                  </TableCell>
                  <TableCell>
                    <OrigemLabel origem={m.origem} fornecedor={m.fornecedor_nome} talhao={m.talhao_nome} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onEditar(m)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        Editar
                      </Button>
                      <ActionMenu items={menuItems} label={`Mais ações — movimentação de ${m.insumos.nome}`} />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function OrigemLabel({ origem, fornecedor, talhao }: { origem: string; fornecedor?: string; talhao?: string }) {
  if (origem === 'nfe') {
    return (
      <div>
        <p className="text-xs text-muted-foreground">📄 NF-e</p>
        {fornecedor && (
          <Tooltip>
            <TooltipTrigger className="text-xs font-medium text-foreground truncate max-w-[160px] cursor-default block w-full text-left bg-transparent border-0 p-0">
              {fornecedor}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">{fornecedor}</TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }
  if (origem === 'operacao') {
    return (
      <div>
        <p className="text-xs text-muted-foreground">🌾 Operação</p>
        {talhao && <p className="text-xs font-medium text-foreground">{talhao}</p>}
      </div>
    )
  }
  const map: Record<string, string> = {
    whatsapp:         '💬 WhatsApp',
    manual:           '✏️ Manual',
    correcao_unidade: '🔄 Correção',
  }
  return <span className="text-sm text-muted-foreground">{map[origem] ?? origem}</span>
}
```

Note que a mensagem do estado vazio original ("Nenhuma movimentação registrada.") agora se divide em dois casos: sem filtro (mesma mensagem de antes) e com filtro sem resultado ("Nenhuma movimentação corresponde aos filtros aplicados.") — igual ao padrão que já existe na tabela de Produtos, só que essa distinção não existia aqui porque não havia filtro nenhum.

- [ ] **Step 2: Commit**

```bash
git add web/app/\(app\)/estoque/components/tabela-historico.tsx
git commit -m "feat(estoque): extrai tabela-historico.tsx com busca e filtro de origem"
```

---

### Task 11: Dialogs — grupo Produtos

**Files:**
- Create: `web/app/(app)/estoque/components/dialogs/novo-insumo-dialog.tsx`
- Create: `web/app/(app)/estoque/components/dialogs/ajustar-estoque-dialog.tsx`
- Create: `web/app/(app)/estoque/components/dialogs/converter-unidade-dialog.tsx`
- Create: `web/app/(app)/estoque/components/dialogs/excluir-insumo-dialog.tsx`

**Interfaces:**
- Consumes: funções de `use-estoque-data` (Task 5): `criarInsumo`, `ajustarEstoque`, `converterUnidade`, `excluirInsumo`; `TIPOS`/`UNIDADES`/`SELECT_CLASS` (Task 4)
- Produces: os 4 componentes de dialog, consumidos pela Task 12

- [ ] **Step 1: `novo-insumo-dialog.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TIPOS, UNIDADES, SELECT_CLASS } from '../../constants'

const FORM_INICIAL = { nome: '', tipo: 'herbicida', unidade: 'L', quantidade: '0', minimo: '0', preco: '' }

export function NovoInsumoDialog({
  open, onOpenChange, onCriar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCriar: (form: { nome: string; tipo: string; unidade: string; quantidade: number; minimo: number; preco: number }) => Promise<void>
}) {
  const [form, setForm] = useState(FORM_INICIAL)
  const [salvando, setSalvando] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    await onCriar({
      nome: form.nome.trim(),
      tipo: form.tipo,
      unidade: form.unidade,
      quantidade: parseFloat(form.quantidade) || 0,
      minimo: parseFloat(form.minimo) || 0,
      preco: parseFloat(form.preco) || 0,
    })
    setSalvando(false)
    onOpenChange(false)
    setForm(FORM_INICIAL)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo Insumo</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome do produto</Label>
            <Input
              id="nome"
              placeholder="Ex: Roundup Original"
              value={form.nome}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <select
                id="tipo" className={SELECT_CLASS} value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
              >
                {TIPOS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unidade">Unidade</Label>
              <select
                id="unidade" className={SELECT_CLASS} value={form.unidade}
                onChange={e => setForm(f => ({ ...f, unidade: e.target.value }))}
              >
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="quantidade">Qtd. inicial</Label>
              <Input
                id="quantidade" type="number" step="0.01" min="0"
                value={form.quantidade}
                onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minimo">Qtd. mínima (alerta)</Label>
              <Input
                id="minimo" type="number" step="0.01" min="0"
                value={form.minimo}
                onChange={e => setForm(f => ({ ...f, minimo: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="preco">Preço médio unitário (R$) <span className="text-muted-foreground text-xs">opcional</span></Label>
            <Input
              id="preco" type="number" step="0.01" min="0" placeholder="0,00"
              value={form.preco}
              onChange={e => setForm(f => ({ ...f, preco: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Adicionar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: `ajustar-estoque-dialog.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Estoque } from '@/lib/types'

export function AjustarEstoqueDialog({
  item, onOpenChange, onAjustar,
}: {
  item: Estoque | null
  onOpenChange: (open: boolean) => void
  onAjustar: (item: Estoque, novaQuantidade: number, novoPreco: number | null) => Promise<void>
}) {
  const [ajuste, setAjuste] = useState('')
  const [ajustePreco, setAjustePreco] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (item) {
      setAjuste(String(item.quantidade_atual))
      setAjustePreco(item.preco_medio_unitario > 0 ? String(item.preco_medio_unitario) : '')
    }
  }, [item])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return
    const novaQtd = parseFloat(ajuste)
    if (isNaN(novaQtd)) return
    setSalvando(true)
    const novoPreco = parseFloat(ajustePreco)
    await onAjustar(item, novaQtd, !isNaN(novoPreco) && novoPreco >= 0 ? novoPreco : null)
    setSalvando(false)
    onOpenChange(false)
    setAjustePreco('')
  }

  function fechar() { onOpenChange(false); setAjustePreco('') }

  return (
    <Dialog open={!!item} onOpenChange={open => { if (!open) fechar() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ajustar Estoque</DialogTitle></DialogHeader>
        {item && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Produto: <span className="font-medium text-foreground">{item.insumos.nome}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Quantidade atual:{' '}
              <span className="font-medium text-foreground">{item.quantidade_atual} {item.insumos.unidade}</span>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="ajuste">Nova quantidade ({item.insumos.unidade})</Label>
              <Input id="ajuste" type="number" step="0.01" value={ajuste} onChange={e => setAjuste(e.target.value)} required />
              <p className="text-xs text-muted-foreground">
                Valores negativos são permitidos (estoque vai aparecer em vermelho).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ajuste-preco">
                Preço unitário (R$) <span className="text-muted-foreground text-xs">opcional</span>
              </Label>
              <Input
                id="ajuste-preco" type="number" step="0.01" min="0" placeholder="0,00"
                value={ajustePreco} onChange={e => setAjustePreco(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={fechar}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: `converter-unidade-dialog.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Estoque } from '@/lib/types'
import { UNIDADES, SELECT_CLASS } from '../../constants'

export function ConverterUnidadeDialog({
  item, onOpenChange, onConverter,
}: {
  item: Estoque | null
  onOpenChange: (open: boolean) => void
  onConverter: (item: Estoque, novaUnidade: string, fator: number) => Promise<void>
}) {
  const [form, setForm] = useState({ novaUnidade: 'L', fator: '' })
  const [salvando, setSalvando] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return
    const fator = parseFloat(form.fator.replace(',', '.'))
    if (isNaN(fator) || fator <= 0) return
    setSalvando(true)
    await onConverter(item, form.novaUnidade, fator)
    setSalvando(false)
    onOpenChange(false)
    setForm({ novaUnidade: 'L', fator: '' })
  }

  const fatorNum = parseFloat(form.fator.replace(',', '.'))

  return (
    <Dialog open={!!item} onOpenChange={open => { if (!open) onOpenChange(false) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Converter Unidade</DialogTitle></DialogHeader>
        {item && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Produto: <span className="font-medium text-foreground">{item.insumos.nome}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Situação atual:{' '}
              <span className="font-semibold text-amber-600">{item.quantidade_atual} {item.insumos.unidade}</span>
            </p>
            <div className="space-y-1.5">
              <Label>Nova unidade</Label>
              <select
                className={SELECT_CLASS} value={form.novaUnidade}
                onChange={e => setForm(f => ({ ...f, novaUnidade: e.target.value }))}
              >
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fator">
                Quantos <span className="font-semibold">{form.novaUnidade}</span> tem em 1{' '}
                <span className="font-semibold">{item.insumos.unidade}</span>?
              </Label>
              <Input
                id="fator" type="number" step="0.001" min="0.001" placeholder="Ex: 20"
                value={form.fator} onChange={e => setForm(f => ({ ...f, fator: e.target.value }))} required
              />
            </div>
            {form.fator && !isNaN(fatorNum) && (
              <p className="text-sm bg-muted rounded px-3 py-2">
                Resultado:{' '}
                <span className="font-semibold">
                  {(item.quantidade_atual * fatorNum).toFixed(2)} {form.novaUnidade}
                </span>
                {item.preco_medio_unitario > 0 && (
                  <> · preço{' '}
                    <span className="font-semibold">
                      R$ {(item.preco_medio_unitario / fatorNum).toFixed(2)}/{form.novaUnidade}
                    </span>
                  </>
                )}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={salvando || !form.fator}>{salvando ? 'Salvando…' : 'Converter'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: `excluir-insumo-dialog.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Estoque } from '@/lib/types'

export function ExcluirInsumoDialog({
  item, onOpenChange, onExcluir,
}: {
  item: Estoque | null
  onOpenChange: (open: boolean) => void
  onExcluir: (item: Estoque) => Promise<{ ok: true } | { ok: false; erro: string }>
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  function fechar() { onOpenChange(false); setErro(null) }

  async function handleExcluir() {
    if (!item) return
    setExcluindo(true)
    setErro(null)
    const resultado = await onExcluir(item)
    setExcluindo(false)
    if (!resultado.ok) { setErro(resultado.erro); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={!!item} onOpenChange={open => { if (!open) fechar() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Excluir insumo?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Isso vai remover permanentemente{' '}
          <span className="font-medium text-foreground">{item?.insumos.nome}</span>{' '}
          e todo o seu histórico de movimentações. Esta ação não pode ser desfeita.
        </p>
        {erro && (
          <p aria-live="polite" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button variant="destructive" onClick={handleExcluir} disabled={excluindo}>
            {excluindo ? 'Excluindo…' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/estoque/components/dialogs/novo-insumo-dialog.tsx \
        web/app/\(app\)/estoque/components/dialogs/ajustar-estoque-dialog.tsx \
        web/app/\(app\)/estoque/components/dialogs/converter-unidade-dialog.tsx \
        web/app/\(app\)/estoque/components/dialogs/excluir-insumo-dialog.tsx
git commit -m "refactor(estoque): extrai dialogs de produtos (novo, ajustar, converter, excluir)"
```

---

### Task 12: Dialogs — grupo Movimentação

**Files:**
- Create: `web/app/(app)/estoque/components/dialogs/editar-movimentacao-dialog.tsx`
- Create: `web/app/(app)/estoque/components/dialogs/excluir-movimentacao-dialog.tsx`

**Interfaces:**
- Consumes: `editarMovimentacao`, `excluirMovimentacao` (Task 5), `SELECT_CLASS` (Task 4), `MovimentacaoComFornecedor` (Task 5)
- Produces: os 2 componentes de dialog, consumidos pela Task 13

- [ ] **Step 1: `editar-movimentacao-dialog.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SELECT_CLASS } from '../../constants'
import type { MovimentacaoComFornecedor } from '../../hooks/use-estoque-data'

export function EditarMovimentacaoDialog({
  mov, onOpenChange, onEditar,
}: {
  mov: MovimentacaoComFornecedor | null
  onOpenChange: (open: boolean) => void
  onEditar: (mov: MovimentacaoComFornecedor, novoTipo: 'entrada' | 'saida', novaQuantidade: number, novaData: string) => Promise<void>
}) {
  const [form, setForm] = useState({ tipo: 'entrada' as 'entrada' | 'saida', quantidade: '', data: '' })
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (mov) setForm({ tipo: mov.tipo, quantidade: String(mov.quantidade), data: mov.data.slice(0, 10) })
  }, [mov])

  async function handleSalvar() {
    if (!mov) return
    setSalvando(true)
    await onEditar(mov, form.tipo, parseFloat(form.quantidade) || 0, form.data)
    setSalvando(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={!!mov} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Editar Movimentação</DialogTitle></DialogHeader>
        {mov && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Insumo: <span className="font-medium text-foreground">{mov.insumos.nome}</span>
            </p>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <select
                className={SELECT_CLASS} value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value as 'entrada' | 'saida' }))}
              >
                <option value="entrada">+ Entrada</option>
                <option value="saida">− Saída</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantidade ({mov.insumos.unidade})</Label>
              <Input
                type="number" step="0.01" min="0" value={form.quantidade}
                onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando || !form.quantidade}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: `excluir-movimentacao-dialog.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { MovimentacaoComFornecedor } from '../../hooks/use-estoque-data'

export function ExcluirMovimentacaoDialog({
  mov, onOpenChange, onExcluir,
}: {
  mov: MovimentacaoComFornecedor | null
  onOpenChange: (open: boolean) => void
  onExcluir: (mov: MovimentacaoComFornecedor) => Promise<{ ok: true } | { ok: false; erro: string }>
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  function fechar() { onOpenChange(false); setErro(null) }

  async function handleExcluir() {
    if (!mov) return
    setExcluindo(true)
    setErro(null)
    const resultado = await onExcluir(mov)
    setExcluindo(false)
    if (!resultado.ok) { setErro(resultado.erro); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={!!mov} onOpenChange={open => { if (!open) fechar() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Excluir movimentação?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Será removida a {mov?.tipo === 'entrada' ? 'entrada' : 'saída'} de{' '}
          <span className="font-medium text-foreground">{mov?.quantidade} {mov?.insumos.unidade}</span>{' '}
          de <span className="font-medium text-foreground">{mov?.insumos.nome}</span>.
          O saldo do estoque será ajustado automaticamente.
        </p>
        {erro && (
          <p aria-live="polite" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button variant="destructive" onClick={handleExcluir} disabled={excluindo}>
            {excluindo ? 'Excluindo…' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add web/app/\(app\)/estoque/components/dialogs/editar-movimentacao-dialog.tsx \
        web/app/\(app\)/estoque/components/dialogs/excluir-movimentacao-dialog.tsx
git commit -m "refactor(estoque): extrai dialogs de movimentacao (editar, excluir)"
```

---

### Task 13: `page.tsx` final — monta tudo e remove o monolito

**Files:**
- Modify (reescrever por completo): `web/app/(app)/estoque/page.tsx`

**Interfaces:**
- Consumes: tudo das Tasks 3-12
- Produces: a página funcionando de ponta a ponta — última tarefa do plano

- [ ] **Step 1: Reescrever `page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useEstoqueData } from './hooks/use-estoque-data'
import type { MovimentacaoComFornecedor } from './hooks/use-estoque-data'
import { useFiltrosProdutos } from './hooks/use-filtros-produtos'
import { useFiltrosHistorico } from './hooks/use-filtros-historico'
import { KpisEstoque } from './components/kpis-estoque'
import { TabelaProdutos } from './components/tabela-produtos'
import { TabelaHistorico } from './components/tabela-historico'
import { NovoInsumoDialog } from './components/dialogs/novo-insumo-dialog'
import { AjustarEstoqueDialog } from './components/dialogs/ajustar-estoque-dialog'
import { ConverterUnidadeDialog } from './components/dialogs/converter-unidade-dialog'
import { ExcluirInsumoDialog } from './components/dialogs/excluir-insumo-dialog'
import { EditarMovimentacaoDialog } from './components/dialogs/editar-movimentacao-dialog'
import { ExcluirMovimentacaoDialog } from './components/dialogs/excluir-movimentacao-dialog'
import { getUrlParam, setUrlParam } from './lib/url-params'
import type { Estoque } from '@/lib/types'

export default function EstoquePage() {
  const dados = useEstoqueData()
  const filtrosProdutos = useFiltrosProdutos(dados.estoque)
  const filtrosHistorico = useFiltrosHistorico(dados.movimentacoes)

  const [tab, setTabState] = useState<'produtos' | 'historico'>(
    () => (getUrlParam('tab') === 'historico' ? 'historico' : 'produtos')
  )
  function setTab(v: string) {
    const val = v === 'historico' ? 'historico' : 'produtos'
    setTabState(val)
    setUrlParam('tab', val, 'produtos')
  }

  const [novoDialog, setNovoDialog]       = useState(false)
  const [ajustarItem, setAjustarItem]     = useState<Estoque | null>(null)
  const [converterItem, setConverterItem] = useState<Estoque | null>(null)
  const [excluirItem, setExcluirItem]     = useState<Estoque | null>(null)
  const [editarMov, setEditarMov]         = useState<MovimentacaoComFornecedor | null>(null)
  const [excluirMov, setExcluirMov]       = useState<MovimentacaoComFornecedor | null>(null)

  if (dados.loading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Estoque</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">Insumos cadastrados e histórico de movimentações</p>
        </div>
        <Button size="sm" onClick={() => setNovoDialog(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Novo Insumo
        </Button>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="produtos" className="space-y-6">
          <KpisEstoque estoque={dados.estoque} />
          <TabelaProdutos
            estoque={dados.estoque}
            filtros={filtrosProdutos}
            onNovoInsumo={() => setNovoDialog(true)}
            onAjustar={setAjustarItem}
            onConverter={setConverterItem}
            onExcluir={setExcluirItem}
          />
        </TabsContent>

        <TabsContent value="historico">
          <TabelaHistorico
            filtros={filtrosHistorico}
            onEditar={setEditarMov}
            onExcluir={setExcluirMov}
          />
        </TabsContent>
      </Tabs>

      <NovoInsumoDialog open={novoDialog} onOpenChange={setNovoDialog} onCriar={dados.criarInsumo} />
      <AjustarEstoqueDialog item={ajustarItem} onOpenChange={open => !open && setAjustarItem(null)} onAjustar={dados.ajustarEstoque} />
      <ConverterUnidadeDialog item={converterItem} onOpenChange={open => !open && setConverterItem(null)} onConverter={dados.converterUnidade} />
      <ExcluirInsumoDialog item={excluirItem} onOpenChange={open => !open && setExcluirItem(null)} onExcluir={dados.excluirInsumo} />
      <EditarMovimentacaoDialog mov={editarMov} onOpenChange={open => !open && setEditarMov(null)} onEditar={dados.editarMovimentacao} />
      <ExcluirMovimentacaoDialog mov={excluirMov} onOpenChange={open => !open && setExcluirMov(null)} onExcluir={dados.excluirMovimentacao} />
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-28 bg-muted rounded" />
      <div className="h-64 bg-muted rounded-xl" />
      <div className="h-48 bg-muted rounded-xl" />
    </div>
  )
}
```

- [ ] **Step 2: Rodar o projeto e checar erros de tipo/build**

```bash
cd web && npx tsc --noEmit
```

Expected: sem erros. Se algum import quebrar (caminho errado, nome trocado), corrigir antes de seguir.

- [ ] **Step 3: Verificação manual ponta a ponta (dev server)**

```bash
cd web && npm run dev
```

Abrir `/estoque` logado e conferir, na ordem:
1. Abre na aba "Produtos", os 4 KPIs aparecem
2. Trocar pra aba "Histórico" — KPIs somem, aparece busca + filtro de origem
3. Trocar ordenação "Mais recentes" / "Nome (A-Z)" na aba Produtos e ver a lista mudar de ordem
4. Cadastrar um "Novo Insumo" e ver ele aparecer no topo da lista (ordenação padrão = mais recente)
5. Clicar "Ajustar" num produto, mudar a quantidade, salvar, conferir que atualizou
6. Abrir o menu "⋯" de um produto com unidade não-base e usar "Converter Unidade"
7. Abrir o menu "⋯" e excluir um insumo de teste — conferir mensagem de confirmação e que ele some da lista
8. Na aba Histórico, usar o filtro de origem e a busca, conferir que filtram de verdade
9. Editar uma movimentação (trocar quantidade) e conferir que o saldo do produto muda de acordo
10. Excluir uma movimentação e conferir que o saldo volta (efeito revertido)
11. Testar em largura mobile (redimensionar a janela ou emular) — conferir que a lista de produtos vira cards e continua com "Ajustar" + menu "⋯"

Qualquer divergência de comportamento em relação à tela original é bug de regressão — parar e corrigir antes do commit final.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/estoque/page.tsx
git commit -m "refactor(estoque): page.tsx vira orquestracao — abas, hooks e componentes extraidos"
```

---

## Self-Review (registro)

- **Cobertura da spec:** abas Produtos/Histórico (Task 13), ordenação por `created_at` (Tasks 1, 2, 6, 9), menu "⋯" escondendo ações destrutivas (Tasks 9, 10 via `ActionMenu`), decomposição de arquivos (Tasks 3-13) — todas as seções da spec têm tarefa correspondente.
- **Correção descoberta durante o planejamento:** a spec original sugeria usar o `DropdownMenu` do shadcn/ui para o menu "⋯", mas o projeto já tem `web/components/ui/action-menu.tsx` pronto pro mesmo fim — o plano usa o componente existente em vez de introduzir um novo, e a spec foi corrigida para refletir isso.
- **Risco de regressão identificado e corrigido:** o botão "Limpar filtros" original zerava a URL inteira; como a reorganização acrescenta parâmetros novos (`tab`, `ordenar`, `hq`, `origem`), isso quebraria a aba/ordenação ativas sem necessidade — corrigido com `limparUrlParams` recebendo só as chaves da aba em questão (Task 4).
- **Consistência de tipos:** `MovimentacaoComFornecedor`, `ResultadoExclusao`, `OrdenacaoProdutos`, `FiltroStatus`, `FiltroOrigem` são definidos uma única vez cada (Tasks 5-7) e importados nos consumidores — conferido que os nomes batem em todas as tasks que os usam.
