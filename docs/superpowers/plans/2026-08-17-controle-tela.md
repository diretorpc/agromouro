# Tela `/controle` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a interface da aba Controle — upload de PDF (extrato/contrato de
fornecedor), lista paginada com filtro por coluna estilo Excel (célula mesclada quando
um documento tem vários itens), e visualização do PDF original.

**Architecture:** `GET /controle/documentos` (já existe) ganha filtro e paginação no
servidor; rota nova `GET /controle/documentos/filtros` alimenta os menus de filtro com
os valores que realmente existem no banco. No frontend, um hook
(`use-controle-data.ts`) concentra toda chamada de API; três componentes puros
(`filtro-coluna`, `tabela-documentos`, `dialogo-importar`) só recebem dados e emitem
eventos — sem chamada de rede própria.

**Tech Stack:** Node.js + Express + TypeScript + Zod + Vitest (API) · Next.js 16 +
TypeScript + Tailwind (Web, sem test runner) · Supabase (Postgres) · `@base-ui/react`
(dialog/tabela usam os componentes de `web/components/ui/`, já existentes)

**Spec:** `docs/superpowers/specs/2026-08-17-controle-tela-design.md`

## Global Constraints

- TypeScript em tudo — nunca JavaScript puro
- Validação de entrada com Zod nas rotas novas/alteradas (POST já tinha; GET ganha
  validação de query string nesta obra)
- `fazenda_id` SEMPRE do middleware de auth (`fazendaDe(req)`), nunca do corpo/query da
  requisição — mesmo cuidado que as 3 rotas de Controle já seguem
- Mensagens ao usuário final sempre em português brasileiro
- `web/` não tem test runner configurado — tarefas de frontend verificam com
  `npx tsc --noEmit` + roteiro manual no navegador, não com testes automatizados
- `GET /controle/documentos` muda de shape (array → objeto paginado) SEM quebrar nada:
  a rota não tem chamador nenhum ainda (Epic 2.4 é o primeiro consumidor real)

---

## Task 1: Backend — `GET /controle/documentos/filtros`

**Files:**
- Modify: `api/src/routes/controle.ts`
- Modify: `api/src/routes/controle.test.ts`

**Interfaces:**
- Produces: `GET /controle/documentos/filtros` → `200 { fornecedores: string[], status: string[] }` — consumido pelo hook do frontend na Task 4.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/src/routes/controle.test.ts`, adicionar um novo `describe` logo **antes** do
`describe('GET /controle/documentos', ...)` existente (linha 243):

```typescript
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /controle/documentos/filtros', () => {
  const handler = pegarHandler('get', '/filtros')

  it('devolve fornecedores distintos (sem repetir) e a lista fixa de status', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS SOLUÇÕES', status: 'processado' },
      { id: 'doc-2', fazenda_id: FAZENDA_A, fornecedor: 'SYAGRI', status: 'processado' },
      { id: 'doc-3', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS SOLUÇÕES', status: 'erro' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })

    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(res.body.fornecedores).toEqual(['SOLOS SOLUÇÕES', 'SYAGRI'])
    expect(res.body.status).toEqual(['importado', 'processando', 'processado', 'erro'])
  })

  it('isola por fazenda — não mistura fornecedor de outra fazenda', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS SOLUÇÕES', status: 'processado' },
      { id: 'doc-2', fazenda_id: FAZENDA_B, fornecedor: 'MOSAIC', status: 'processado' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })

    await handler(req, res, next)

    expect(res.body.fornecedores).toEqual(['SOLOS SOLUÇÕES'])
  })

  it('sem documento nenhum: fornecedores vazio, status continua fixo', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })

    await handler(req, res, next)

    expect(res.body.fornecedores).toEqual([])
    expect(res.body.status).toEqual(['importado', 'processando', 'processado', 'erro'])
  })

  it('sem fazenda identificada no token: 400, não consulta o banco', async () => {
    const { req, res, next } = criarReqRes()

    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd api && npx vitest run src/routes/controle.test.ts -t "GET /controle/documentos/filtros"`
Expected: FAIL — `Rota não encontrada: GET /filtros` (o `pegarHandler` lança).

- [ ] **Step 3: Implementar a rota**

Em `api/src/routes/controle.ts`, adicionar **depois** da rota `POST /` (depois da linha
`})` que fecha `controleRoutes.post('/', ...)`) e **antes** de `controleRoutes.get('/', ...)`:

```typescript
// GET /controle/documentos/filtros — valores disponíveis pra popular os menus de
// filtro por coluna da tela (Epic 2.4). `fornecedores` vem de TODOS os documentos
// da fazenda, não só da página carregada — um filtro que só oferece os fornecedores
// da primeira página seria enganoso. `status` é fixo (mesmo enum do CHECK da
// migration 017), não precisa consultar o banco.
controleRoutes.get('/filtros', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  try {
    const { data, error } = await supabase
      .from('documentos_controle')
      .select('fornecedor')
      .eq('fazenda_id', fazendaId)

    if (error) throw error

    const fornecedores = [...new Set(
      (data ?? []).map(d => d.fornecedor).filter((f): f is string => !!f),
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'))

    res.json({
      fornecedores,
      status: ['importado', 'processando', 'processado', 'erro'],
    })
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd api && npx vitest run src/routes/controle.test.ts`
Expected: PASS — todos os testes do arquivo, incluindo os 4 novos.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/controle.ts api/src/routes/controle.test.ts
git commit -m "feat(controle): rota GET /controle/documentos/filtros"
```

---

## Task 2: Backend — `GET /controle/documentos` ganha filtro e paginação

**Files:**
- Modify: `api/src/routes/controle.ts`
- Modify: `api/src/routes/controle.test.ts`

**Interfaces:**
- Consumes: query string `?pagina=1&porPagina=20&fornecedor=X&fornecedor=Y&status=erro&dataInicio=2026-01-01&dataFim=2026-12-31` (todos opcionais, `fornecedor`/`status` repetíveis)
- Produces: `GET /controle/documentos` → `200 { documentos: DocumentoComItens[], paginaAtual: number, totalPaginas: number, totalDocumentos: number }` — **muda de array pra objeto**, consumido pelo hook na Task 4. Sem chamador hoje, então não quebra nada em produção.

- [ ] **Step 1: Estender o mock do banco e o helper de request no teste**

Em `api/src/routes/controle.test.ts`, trocar a função `builder` inteira (linhas 33-74)
por esta versão, que ganha `gte`, `lte`, `range` e contagem via `select(cols, {count})`
— sem tirar nada do que já existia:

```typescript
  function builder(tabela: 'documentos_controle' | 'itens_nfe') {
    const filtros: Record<string, any> = {}
    const filtrosIn: Record<string, any[]> = {}
    const filtrosGte: Record<string, any> = {}
    const filtrosLte: Record<string, any> = {}
    let colunas: string[] | null = null
    let contarTotal = false
    let rangeSlice: [number, number] | null = null

    function linhasBase() {
      return tabela === 'documentos_controle' ? estadoBanco.documentos : estadoBanco.itens
    }
    function filtrar() {
      return linhasBase().filter(l =>
        Object.entries(filtros).every(([campo, valor]) => l[campo] === valor) &&
        Object.entries(filtrosIn).every(([campo, valores]) => valores.includes(l[campo])) &&
        Object.entries(filtrosGte).every(([campo, valor]) => l[campo] >= valor) &&
        Object.entries(filtrosLte).every(([campo, valor]) => l[campo] <= valor),
      )
    }
    function projetar(linha: any) {
      if (!colunas) return linha
      const out: any = {}
      for (const c of colunas) out[c] = linha[c]
      return out
    }

    const obj: any = {
      select: vi.fn((cols?: string, opts?: { count?: 'exact' }) => {
        colunas = cols ? cols.split(',').map(c => c.trim()) : null
        contarTotal = opts?.count === 'exact'
        return obj
      }),
      order: vi.fn(() => obj),
      eq: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      in: vi.fn((campo: string, valores: any[]) => { filtrosIn[campo] = valores; return obj }),
      gte: vi.fn((campo: string, valor: any) => { filtrosGte[campo] = valor; return obj }),
      lte: vi.fn((campo: string, valor: any) => { filtrosLte[campo] = valor; return obj }),
      range: vi.fn((de: number, ate: number) => { rangeSlice = [de, ate]; return obj }),
      single: vi.fn(() => {
        const linhas = filtrar()
        if (linhas.length === 0) {
          return Promise.resolve({ data: null, error: { message: 'not found', code: 'PGRST116' } })
        }
        return Promise.resolve({ data: projetar(linhas[0]), error: null })
      }),
      then(resolve: any) {
        const todasFiltradas = filtrar()
        const pagina = rangeSlice ? todasFiltradas.slice(rangeSlice[0], rangeSlice[1] + 1) : todasFiltradas
        return Promise.resolve(resolve({
          data: pagina.map(projetar),
          error: null,
          count: contarTotal ? todasFiltradas.length : null,
        }))
      },
    }
    return obj
  }
```

Trocar a assinatura de `criarReqRes` (linha 106) e o corpo do `req` (linhas 107-113)
para aceitar `query`:

```typescript
function criarReqRes(overrides: { fazendaId?: string; body?: any; params?: Record<string, string>; query?: Record<string, any> } = {}) {
  const req: any = {
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    user: overrides.fazendaId
      ? { app_metadata: { fazenda_ativa_id: overrides.fazendaId } }
      : undefined,
  }
```

- [ ] **Step 2: Atualizar os 3 testes existentes de `GET /controle/documentos` pro novo shape**

No mesmo arquivo, dentro de `describe('GET /controle/documentos', ...)` (a partir da
linha 243):

Trocar (teste "lista os documentos..."):
```typescript
    expect(next).not.toHaveBeenCalled()
    expect(res.body).toHaveLength(2) // só os 2 documentos da fazenda A
    expect(res.body.every((d: any) => d.fazenda_id === FAZENDA_A)).toBe(true)

    const doc1 = res.body.find((d: any) => d.id === 'doc-1')
    expect(doc1.itens).toHaveLength(2)
    expect(doc1.itens.map((i: any) => i.id).sort()).toEqual(['item-1', 'item-2'])
    // item de outra fazenda nunca aparece agrupado, mesmo apontando pro doc-1.
    expect(doc1.itens.some((i: any) => i.id === 'item-x')).toBe(false)

    const doc2 = res.body.find((d: any) => d.id === 'doc-2')
    expect(doc2.itens).toEqual([])
```
por:
```typescript
    expect(next).not.toHaveBeenCalled()
    expect(res.body.totalDocumentos).toBe(2) // só os 2 documentos da fazenda A
    expect(res.body.documentos).toHaveLength(2)
    expect(res.body.documentos.every((d: any) => d.fazenda_id === FAZENDA_A)).toBe(true)

    const doc1 = res.body.documentos.find((d: any) => d.id === 'doc-1')
    expect(doc1.itens).toHaveLength(2)
    expect(doc1.itens.map((i: any) => i.id).sort()).toEqual(['item-1', 'item-2'])
    // item de outra fazenda nunca aparece agrupado, mesmo apontando pro doc-1.
    expect(doc1.itens.some((i: any) => i.id === 'item-x')).toBe(false)

    const doc2 = res.body.documentos.find((d: any) => d.id === 'doc-2')
    expect(doc2.itens).toEqual([])
```

Trocar (teste "lista vazia..."):
```typescript
    expect(res.body).toEqual([])
```
por:
```typescript
    expect(res.body).toEqual({ documentos: [], paginaAtual: 1, totalPaginas: 1, totalDocumentos: 0 })
```

Trocar (teste "nunca devolve arquivo_path..."):
```typescript
    expect(res.body[0]).not.toHaveProperty('arquivo_path')
```
por:
```typescript
    expect(res.body.documentos[0]).not.toHaveProperty('arquivo_path')
```

- [ ] **Step 3: Escrever os testes novos de paginação e filtro**

Ainda dentro de `describe('GET /controle/documentos', ...)`, adicionar ao final (antes
do `})` que fecha o describe):

```typescript

  it('pagina e conta o total — porPagina 2, pagina 1 devolve 2 e informa 2 páginas/3 documentos', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'A', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'B', numero_documento: '2', data_documento: '2026-01-02', valor_total: 20, status: 'processado', erro_mensagem: null, nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
      { id: 'doc-3', fornecedor: 'C', numero_documento: '3', data_documento: '2026-01-03', valor_total: 30, status: 'processado', erro_mensagem: null, nome_arquivo: 'c.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-12' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { pagina: '1', porPagina: '2' } })

    await handler(req, res, next)

    expect(res.body.documentos).toHaveLength(2)
    expect(res.body.paginaAtual).toBe(1)
    expect(res.body.totalPaginas).toBe(2)
    expect(res.body.totalDocumentos).toBe(3)
  })

  it('filtra por fornecedor — só devolve documento do fornecedor pedido', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'SOLOS', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'MOSAIC', numero_documento: '2', data_documento: '2026-01-02', valor_total: 20, status: 'processado', erro_mensagem: null, nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { fornecedor: 'SOLOS' } })

    await handler(req, res, next)

    expect(res.body.documentos).toHaveLength(1)
    expect(res.body.documentos[0].id).toBe('doc-1')
  })

  it('filtra por status combinado com fornecedor — os dois valem ao mesmo tempo', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'SOLOS', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'SOLOS', numero_documento: '2', data_documento: '2026-01-02', valor_total: 20, status: 'erro', erro_mensagem: 'x', nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { fornecedor: 'SOLOS', status: 'erro' } })

    await handler(req, res, next)

    expect(res.body.documentos).toHaveLength(1)
    expect(res.body.documentos[0].id).toBe('doc-2')
  })

  it('filtra por período (dataInicio/dataFim)', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'A', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'A', numero_documento: '2', data_documento: '2026-06-15', valor_total: 20, status: 'processado', erro_mensagem: null, nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { dataInicio: '2026-03-01', dataFim: '2026-12-31' } })

    await handler(req, res, next)

    expect(res.body.documentos).toHaveLength(1)
    expect(res.body.documentos[0].id).toBe('doc-2')
  })

  it('parâmetro de paginação inválido: 400', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { pagina: 'abc' } })

    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `cd api && npx vitest run src/routes/controle.test.ts -t "GET /controle/documentos"`
Expected: FAIL — a rota ainda devolve array, os testes esperam `res.body.documentos`.

- [ ] **Step 5: Implementar a mudança na rota**

Em `api/src/routes/controle.ts`, adicionar este schema logo depois de `const
uploadSchema = ...` (antes da rota `POST /`):

```typescript
const listarSchema = z.object({
  pagina:     z.coerce.number().int().min(1).default(1),
  porPagina:  z.coerce.number().int().min(1).max(100).default(20),
  fornecedor: z.union([z.string(), z.array(z.string())]).optional()
    .transform(v => v === undefined ? [] : Array.isArray(v) ? v : [v]),
  status:     z.union([z.string(), z.array(z.string())]).optional()
    .transform(v => v === undefined ? [] : Array.isArray(v) ? v : [v]),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
```

Trocar o handler inteiro de `controleRoutes.get('/', ...)` (do comentário
`// GET /controle/documentos — lista...` até o `})` que fecha a rota) por:

```typescript
// GET /controle/documentos — lista os documentos da fazenda ativa, mais recentes
// primeiro, já COM os itens vinculados (decisão do Matheus, 17/08/2026: mais peso
// na resposta, mas a tela nasce com tudo numa chamada só). Busca os itens de TODOS
// os documentos da PÁGINA com um único IN() e agrupa em memória — evita 1 query
// por documento (N+1).
//
// Filtro e paginação (Epic 2.4) acontecem no BANCO, não em memória: a lista pode
// crescer bastante ao longo dos anos, e um filtro que só operasse sobre a página já
// carregada seria incapaz de achar documento fora dela.
//
// arquivo_path nunca sai daqui: é o caminho interno do bucket privado, sem
// utilidade pro front (que usa a rota /:id/arquivo pra abrir o PDF via signed URL
// de vida curta) — devolver o path cru só exporia a convenção interna de Storage
// sem dar acesso real a nada (o bucket é privado).
controleRoutes.get('/', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = listarSchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Parâmetros de busca inválidos.', detalhe: parsed.error.flatten() })
    return
  }
  const { pagina, porPagina, fornecedor, status, dataInicio, dataFim } = parsed.data

  try {
    let query = supabase
      .from('documentos_controle')
      .select(
        'id, fornecedor, numero_documento, data_documento, valor_total, status, erro_mensagem, nome_arquivo, fazenda_id, created_at',
        { count: 'exact' },
      )
      .eq('fazenda_id', fazendaId)

    if (fornecedor.length > 0) query = query.in('fornecedor', fornecedor)
    if (status.length > 0) query = query.in('status', status)
    if (dataInicio) query = query.gte('data_documento', dataInicio)
    if (dataFim) query = query.lte('data_documento', dataFim)

    const offset = (pagina - 1) * porPagina
    const { data: documentos, error: errDocumentos, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + porPagina - 1)

    if (errDocumentos) throw errDocumentos

    const totalDocumentos = count ?? 0
    const totalPaginas = Math.max(1, Math.ceil(totalDocumentos / porPagina))

    if (!documentos || documentos.length === 0) {
      res.json({ documentos: [], paginaAtual: pagina, totalPaginas, totalDocumentos })
      return
    }

    const documentoIds = documentos.map(d => d.id)

    // Filtro por fazenda_id junto com o IN() de documento_controle_id fecha, na
    // mesma query, tanto a mistura entre fazendas quanto o caso (que não deveria
    // acontecer, mas por defesa) de um item apontar pra documento de outra fazenda.
    const { data: itens, error: errItens } = await supabase
      .from('itens_nfe')
      .select('id, descricao, quantidade, unidade, valor_unitario, valor_total, fornecedor, numero_documento, ocorrencia_no_documento, documento_controle_id, conta_como_compra, data_manual, insumo_id')
      .in('documento_controle_id', documentoIds)
      .eq('fazenda_id', fazendaId)

    if (errItens) throw errItens

    const itensPorDocumento = new Map<string, typeof itens>()
    for (const item of itens ?? []) {
      const lista = itensPorDocumento.get(item.documento_controle_id) ?? []
      lista.push(item)
      itensPorDocumento.set(item.documento_controle_id, lista)
    }

    const resposta = documentos.map(doc => ({
      ...doc,
      itens: itensPorDocumento.get(doc.id) ?? [],
    }))

    res.json({ documentos: resposta, paginaAtual: pagina, totalPaginas, totalDocumentos })
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 6: Rodar toda a suíte da API**

Run: `cd api && npm test`
Expected: PASS — nenhuma suíte quebrada.

Run: `cd api && npx tsc --noEmit`
Expected: sem erro de tipo.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/controle.ts api/src/routes/controle.test.ts
git commit -m "feat(controle): GET /controle/documentos ganha filtro e paginação"
```

---

## Task 3: Frontend — tipos novos

**Files:**
- Modify: `web/lib/types.ts`

**Interfaces:**
- Produces: `ItemDocumentoControle`, `DocumentoControle`, `ListaDocumentosControle`, `FiltrosControle`, `ResultadoGravarDocumento` — usados pela Task 4 em diante.

- [ ] **Step 1: Adicionar os tipos ao final de `web/lib/types.ts`**

```typescript
export interface ItemDocumentoControle {
  id: string
  descricao: string
  quantidade: number | null
  unidade: string
  valor_unitario: number | null
  valor_total: number
  fornecedor: string | null
  numero_documento: string | null
  ocorrencia_no_documento: number
  documento_controle_id: string
  conta_como_compra: boolean
  data_manual: string | null
  insumo_id: string | null
}

export interface DocumentoControle {
  id: string
  fornecedor: string | null
  numero_documento: string | null
  data_documento: string | null
  valor_total: number | null
  status: 'importado' | 'processando' | 'processado' | 'erro'
  erro_mensagem: string | null
  nome_arquivo: string
  fazenda_id: string
  created_at: string
  itens: ItemDocumentoControle[]
}

export interface ListaDocumentosControle {
  documentos: DocumentoControle[]
  paginaAtual: number
  totalPaginas: number
  totalDocumentos: number
}

export interface FiltrosControle {
  fornecedores: string[]
  status: string[]
}

// Espelha ResultadoGravarDocumento de api/src/services/controle/gravarDocumentoPdf.ts
// — só as 2 variantes que chegam como JSON 200/201 (gravado/duplicada-*). Os outros 5
// status (nao-documento, sem-itens-aproveitaveis, sem-identidade, falha, erro) chegam
// como erro HTTP lançado (422/503/500), tratado no catch — api.ts já lança Error com
// `.message` pronto pra mostrar.
export type ResultadoGravarDocumento =
  | { status: 'gravado'; documentoId: string; itensGravados: number; itensDescartados: number; itensDuplicados: number }
  | { status: 'duplicada-hash' }
  | { status: 'duplicada-conteudo' }
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro (tipos novos, ninguém usa ainda).

- [ ] **Step 3: Commit**

```bash
git add web/lib/types.ts
git commit -m "feat(controle): tipos da tela de Controle"
```

---

## Task 4: Frontend — hook `use-controle-data.ts`

**Files:**
- Create: `web/app/(app)/controle/hooks/use-controle-data.ts`

**Interfaces:**
- Consumes: `api.get<T>(path)`, `api.post<T>(path, body)` de `@/lib/api` (já existem); tipos da Task 3.
- Produces: `useControleData()` → `{ documentos, paginaAtual, totalPaginas, totalDocumentos, pagina, setPagina, filtros, aplicarFiltros, filtrosDisponiveis, loading, erroCarregamento, recarregar, importarDocumento, abrirPdf }` e o tipo `FiltrosSelecionados` — usados pela Task 8 (page.tsx).

- [ ] **Step 1: Criar o arquivo**

```typescript
'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type {
  DocumentoControle, FiltrosControle, ListaDocumentosControle, ResultadoGravarDocumento,
} from '@/lib/types'

export type FiltrosSelecionados = {
  fornecedores: string[]
  status: string[]
  dataInicio: string
  dataFim: string
}

const FILTROS_VAZIOS: FiltrosSelecionados = { fornecedores: [], status: [], dataInicio: '', dataFim: '' }
const POR_PAGINA = 20

function montarQuery(pagina: number, filtros: FiltrosSelecionados): string {
  const params = new URLSearchParams()
  params.set('pagina', String(pagina))
  params.set('porPagina', String(POR_PAGINA))
  filtros.fornecedores.forEach(f => params.append('fornecedor', f))
  filtros.status.forEach(s => params.append('status', s))
  if (filtros.dataInicio) params.set('dataInicio', filtros.dataInicio)
  if (filtros.dataFim) params.set('dataFim', filtros.dataFim)
  return params.toString()
}

export function useControleData() {
  const [documentos, setDocumentos] = useState<DocumentoControle[]>([])
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [totalDocumentos, setTotalDocumentos] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [filtros, setFiltros] = useState<FiltrosSelecionados>(FILTROS_VAZIOS)
  const [filtrosDisponiveis, setFiltrosDisponiveis] = useState<FiltrosControle>({ fornecedores: [], status: [] })
  const [loading, setLoading] = useState(true)
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null)

  const recarregar = useCallback(async () => {
    setLoading(true)
    try {
      const resposta = await api.get<ListaDocumentosControle>(`/controle/documentos?${montarQuery(pagina, filtros)}`)
      setDocumentos(resposta.documentos)
      setPaginaAtual(resposta.paginaAtual)
      setTotalPaginas(resposta.totalPaginas)
      setTotalDocumentos(resposta.totalDocumentos)
      setErroCarregamento(null)
    } catch {
      setErroCarregamento('Não foi possível carregar os documentos agora. Tente recarregar a página em instantes.')
    } finally {
      setLoading(false)
    }
  }, [pagina, filtros])

  useEffect(() => { recarregar() }, [recarregar])

  // Valores de filtro (fornecedores/status) só precisam recarregar depois de um
  // upload novo — não a cada troca de página/filtro. Busca separada da lista.
  const recarregarFiltrosDisponiveis = useCallback(async () => {
    try {
      const resposta = await api.get<FiltrosControle>('/controle/documentos/filtros')
      setFiltrosDisponiveis(resposta)
    } catch {
      // Silencioso: sem os valores disponíveis, o menu de filtro fica sem opção
      // pra marcar — não impede o resto da tela de funcionar.
    }
  }, [])

  useEffect(() => { recarregarFiltrosDisponiveis() }, [recarregarFiltrosDisponiveis])

  // Ao trocar qualquer filtro, volta pra página 1 — senão o usuário pode ficar
  // numa página que não existe mais dentro do resultado filtrado.
  function aplicarFiltros(novos: FiltrosSelecionados) {
    setFiltros(novos)
    setPagina(1)
  }

  async function importarDocumento(pdf: File): Promise<ResultadoGravarDocumento> {
    const arquivo = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const resultado = reader.result as string
        // readAsDataURL devolve "data:application/pdf;base64,XXXX" — a API espera
        // só o base64 puro.
        resolve(resultado.split(',')[1] ?? '')
      }
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
      reader.readAsDataURL(pdf)
    })

    const resultado = await api.post<ResultadoGravarDocumento>('/controle/documentos', {
      arquivo,
      nomeArquivo: pdf.name,
    })

    if (resultado.status === 'gravado') {
      await Promise.all([recarregar(), recarregarFiltrosDisponiveis()])
    }
    return resultado
  }

  async function abrirPdf(documentoId: string) {
    const { url } = await api.get<{ url: string }>(`/controle/documentos/${documentoId}/arquivo`)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return {
    documentos, paginaAtual, totalPaginas, totalDocumentos, pagina, setPagina,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading, erroCarregamento, recarregar,
    importarDocumento, abrirPdf,
  }
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/controle/hooks/use-controle-data.ts"
git commit -m "feat(controle): hook use-controle-data"
```

---

## Task 5: Frontend — componente `filtro-coluna.tsx`

**Files:**
- Create: `web/app/(app)/controle/components/filtro-coluna.tsx`

**Interfaces:**
- Consumes: `cn` de `@/lib/utils` (já existe, usado em `components/ui/table.tsx` etc.); ícone `Filter` de `lucide-react`.
- Produces: `<FiltroColuna label valores selecionados onChange />` — usado pela Task 6.

- [ ] **Step 1: Criar o arquivo**

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import { Filter } from 'lucide-react'
import { cn } from '@/lib/utils'

type FiltroColunaProps = {
  label: string
  valores: string[]
  selecionados: string[]
  onChange: (novos: string[]) => void
}

// Menu de filtro por coluna, estilo Excel/planilha: busca + checkbox de valores
// únicos. Implementação própria (não usa um Popover de biblioteca) — o projeto usa
// @base-ui/react, mas nenhum componente de popover posicionado está em uso em
// nenhuma outra tela hoje; um `useEffect` de "clicar fora fecha" é suficiente e
// evita introduzir uma dependência nova pra uma peça pequena.
export function FiltroColuna({ label, valores, selecionados, onChange }: FiltroColunaProps) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [])

  const valoresFiltrados = valores.filter(v => v.toLowerCase().includes(busca.toLowerCase()))
  const ativo = selecionados.length > 0

  function alternar(valor: string) {
    onChange(
      selecionados.includes(valor)
        ? selecionados.filter(v => v !== valor)
        : [...selecionados, valor],
    )
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium rounded px-1 py-0.5 hover:bg-muted',
          ativo && 'text-primary',
        )}
        aria-label={`Filtrar por ${label}`}
      >
        {label}
        <Filter className={cn('h-3 w-3', ativo && 'fill-current')} aria-hidden="true" />
      </button>

      {aberto && (
        <div className="absolute top-full left-0 z-20 mt-1 w-56 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
          {valores.length > 8 && (
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar..."
              className="mb-2 w-full rounded border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {valoresFiltrados.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-1">Nenhum valor encontrado.</p>
            )}
            {valoresFiltrados.map(valor => (
              <label key={valor} className="flex items-center gap-2 px-1 py-1 text-xs rounded hover:bg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={selecionados.includes(valor)}
                  onChange={() => alternar(valor)}
                  className="h-3.5 w-3.5"
                />
                <span className="truncate">{valor}</span>
              </label>
            ))}
          </div>
          {ativo && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 w-full text-left text-xs text-muted-foreground hover:text-foreground"
            >
              Limpar filtro
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/controle/components/filtro-coluna.tsx"
git commit -m "feat(controle): componente FiltroColuna (filtro estilo Excel)"
```

---

## Task 6: Frontend — componente `tabela-documentos.tsx`

**Files:**
- Create: `web/app/(app)/controle/components/tabela-documentos.tsx`

**Interfaces:**
- Consumes: `Badge` (`@/components/ui/badge`), `Table/TableBody/TableCell/TableHead/TableHeader/TableRow` (`@/components/ui/table`), `FiltroColuna` (Task 5), `cn` (`@/lib/utils`), ícone `FileText` (`lucide-react`); tipos `DocumentoControle`/`FiltrosControle` (Task 3), `FiltrosSelecionados` (Task 4).
- Produces: `<TabelaDocumentos documentos filtrosDisponiveis filtros onFiltrosChange pagina totalPaginas onPaginaChange onAbrirPdf />` — usado pela Task 8.

**Nota de escopo:** o filtro por coluna (checkbox de valores únicos) vale pra
Fornecedor e Status — são os dois campos que o Matheus explicitamente disse precisar
("conferir loja por loja"), e têm um número pequeno de valores distintos. Data usa um
filtro de período (de/até) em vez de checkbox — uma lista de "valores únicos de data"
não ajudaria em nada (seriam quase todas diferentes). Valor não ganha filtro nesta
versão — não foi pedido, e por ser moeda também teria pouquíssimos valores repetidos.

- [ ] **Step 1: Criar o arquivo**

```typescript
'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FiltroColuna } from './filtro-coluna'
import type { DocumentoControle, FiltrosControle } from '@/lib/types'
import type { FiltrosSelecionados } from '../hooks/use-controle-data'

const STATUS_STYLE: Record<string, string> = {
  importado:   'bg-blue-100 text-blue-700 border-blue-200',
  processando: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  processado:  'bg-green-100 text-green-700 border-green-200',
  erro:        'bg-red-100 text-red-700 border-red-200',
}

type TabelaDocumentosProps = {
  documentos: DocumentoControle[]
  filtrosDisponiveis: FiltrosControle
  filtros: FiltrosSelecionados
  onFiltrosChange: (novos: FiltrosSelecionados) => void
  pagina: number
  totalPaginas: number
  onPaginaChange: (pagina: number) => void
  onAbrirPdf: (documentoId: string) => void
}

function formatarValor(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(d: string | null): string {
  return d ? d.slice(0, 10).split('-').reverse().join('/') : '—'
}

export function TabelaDocumentos({
  documentos, filtrosDisponiveis, filtros, onFiltrosChange,
  pagina, totalPaginas, onPaginaChange, onAbrirPdf,
}: TabelaDocumentosProps) {
  const [dataInicioLocal, setDataInicioLocal] = useState(filtros.dataInicio)
  const [dataFimLocal, setDataFimLocal] = useState(filtros.dataFim)

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <FiltroColuna
                label="Fornecedor"
                valores={filtrosDisponiveis.fornecedores}
                selecionados={filtros.fornecedores}
                onChange={fornecedores => onFiltrosChange({ ...filtros, fornecedores })}
              />
            </TableHead>
            <TableHead>
              <div className="flex items-center gap-1 text-xs">
                Data
                <input
                  type="date"
                  value={dataInicioLocal}
                  onChange={e => { setDataInicioLocal(e.target.value); onFiltrosChange({ ...filtros, dataInicio: e.target.value }) }}
                  className="w-28 rounded border px-1 py-0.5 text-xs"
                  aria-label="Data inicial"
                />
                <span>–</span>
                <input
                  type="date"
                  value={dataFimLocal}
                  onChange={e => { setDataFimLocal(e.target.value); onFiltrosChange({ ...filtros, dataFim: e.target.value }) }}
                  className="w-28 rounded border px-1 py-0.5 text-xs"
                  aria-label="Data final"
                />
              </div>
            </TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>
              <FiltroColuna
                label="Status"
                valores={filtrosDisponiveis.status}
                selecionados={filtros.status}
                onChange={status => onFiltrosChange({ ...filtros, status })}
              />
            </TableHead>
            <TableHead className="text-center">PDF</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documentos.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                Nenhum documento importado ainda.
              </TableCell>
            </TableRow>
          )}
          {documentos.map(doc => {
            // Documento sem item algum (reimportação onde tudo já existia — ver
            // migration 018) ainda precisa de UMA linha, com explicação — sem isso
            // ele fica invisível ou parece que a gravação falhou (achado do Apolo).
            const linhas = doc.itens.length > 0 ? doc.itens : [null]
            return linhas.map((item, i) => (
              <TableRow key={item ? item.id : `${doc.id}-vazio`}>
                {i === 0 && <TableCell rowSpan={linhas.length}>{doc.fornecedor ?? '—'}</TableCell>}
                {i === 0 && <TableCell rowSpan={linhas.length}>{formatarData(doc.data_documento)}</TableCell>}
                <TableCell>
                  {item ? item.descricao : (
                    <span className="italic text-muted-foreground">
                      (nenhum item novo — documento já importado antes)
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {item ? formatarValor(item.valor_total) : formatarValor(doc.valor_total)}
                </TableCell>
                {i === 0 && (
                  <TableCell rowSpan={linhas.length}>
                    <Badge variant="outline" className={STATUS_STYLE[doc.status] ?? ''}>
                      {doc.status}
                    </Badge>
                  </TableCell>
                )}
                {i === 0 && (
                  <TableCell rowSpan={linhas.length} className="text-center">
                    <button
                      type="button"
                      onClick={() => onAbrirPdf(doc.id)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Abrir PDF de ${doc.fornecedor ?? doc.nome_arquivo}`}
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))
          })}
        </TableBody>
      </Table>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-2 py-4">
          {Array.from({ length: totalPaginas }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => onPaginaChange(p)}
              className={cn(
                'h-7 w-7 rounded text-xs',
                p === pagina ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/controle/components/tabela-documentos.tsx"
git commit -m "feat(controle): componente TabelaDocumentos (celulas mescladas + paginacao)"
```

---

## Task 7: Frontend — componente `dialogo-importar.tsx`

**Files:**
- Create: `web/app/(app)/controle/components/dialogo-importar.tsx`

**Interfaces:**
- Consumes: `Dialog/DialogContent/DialogFooter/DialogHeader/DialogTitle` (`@/components/ui/dialog`), `Button` (`@/components/ui/button`), ícones `Plus`/`Loader2` (`lucide-react`); tipo `ResultadoGravarDocumento` (Task 3).
- Produces: `<DialogoImportar onImportar />` — usado pela Task 8. `onImportar` é a função `importarDocumento` do hook (Task 4).

- [ ] **Step 1: Criar o arquivo**

Segue o MESMO padrão de dialog controlado que `web/app/(app)/nfe/page.tsx` já usa
(botão de disparo fora do `<Dialog>`, estado `open` controlado à mão — não usa
`DialogTrigger`):

```typescript
'use client'

import { useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ResultadoGravarDocumento } from '@/lib/types'

type DialogoImportarProps = {
  onImportar: (pdf: File) => Promise<ResultadoGravarDocumento>
}

type Estado =
  | { fase: 'ocioso' }
  | { fase: 'lendo' }
  | { fase: 'aviso'; mensagem: string }  // duplicada — não é erro, não fecha sozinho
  | { fase: 'erro'; mensagem: string }

export function DialogoImportar({ onImportar }: DialogoImportarProps) {
  const [aberto, setAberto] = useState(false)
  const [estado, setEstado] = useState<Estado>({ fase: 'ocioso' })
  const inputRef = useRef<HTMLInputElement>(null)

  function reiniciar() {
    setEstado({ fase: 'ocioso' })
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleArquivo(file: File) {
    setEstado({ fase: 'lendo' })
    try {
      const resultado = await onImportar(file)

      if (resultado.status === 'gravado') {
        setAberto(false)
        reiniciar()
        return
      }
      // duplicada-hash / duplicada-conteudo
      setEstado({ fase: 'aviso', mensagem: 'Este documento já foi importado antes.' })
    } catch (err) {
      // 422 (não reconhecido / sem item aproveitável / sem identidade), 503 (IA
      // indisponível) e 500 chegam aqui como Error — a API já manda a mensagem
      // certa em português no campo `error` (web/lib/api.ts repassa em .message).
      setEstado({ fase: 'erro', mensagem: err instanceof Error ? err.message : 'Erro ao importar o documento.' })
    }
  }

  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
        Importar Documento
      </Button>

      <Dialog open={aberto} onOpenChange={o => { setAberto(o); if (!o) reiniciar() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar documento de fornecedor</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Extrato &quot;Contas a Receber&quot; ou contrato de compra (PDF, até 10 MB).
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            disabled={estado.fase === 'lendo'}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleArquivo(file)
            }}
            className="text-sm"
          />

          {estado.fase === 'lendo' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Lendo documento... isso pode levar alguns segundos.
            </div>
          )}

          {estado.fase === 'aviso' && (
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {estado.mensagem}
            </p>
          )}

          {estado.fase === 'erro' && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-destructive">
              {estado.mensagem}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAberto(false); reiniciar() }}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/controle/components/dialogo-importar.tsx"
git commit -m "feat(controle): componente DialogoImportar (upload com os 4 estados)"
```

---

## Task 8: Frontend — `page.tsx` + item no menu lateral

**Files:**
- Create: `web/app/(app)/controle/page.tsx`
- Modify: `web/components/sidebar.tsx`

**Interfaces:**
- Consumes: `useControleData` (Task 4), `TabelaDocumentos` (Task 6), `DialogoImportar` (Task 7).

- [ ] **Step 1: Criar `page.tsx`**

```typescript
'use client'

import { useControleData } from './hooks/use-controle-data'
import { TabelaDocumentos } from './components/tabela-documentos'
import { DialogoImportar } from './components/dialogo-importar'

export default function ControlePage() {
  const {
    documentos, pagina, setPagina, totalPaginas,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading, erroCarregamento, importarDocumento, abrirPdf,
  } = useControleData()

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Controle</h1>
          <p className="text-sm text-muted-foreground">
            Extratos e contratos de fornecedor importados manualmente.
          </p>
        </div>
        <DialogoImportar onImportar={importarDocumento} />
      </div>

      {erroCarregamento && (
        <p className="text-sm text-destructive">{erroCarregamento}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <TabelaDocumentos
          documentos={documentos}
          filtrosDisponiveis={filtrosDisponiveis}
          filtros={filtros}
          onFiltrosChange={aplicarFiltros}
          pagina={pagina}
          totalPaginas={totalPaginas}
          onPaginaChange={setPagina}
          onAbrirPdf={abrirPdf}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Registrar o item no menu lateral**

Em `web/components/sidebar.tsx`, adicionar `Files` ao import de ícones já existente do
`lucide-react` (junto de `LayoutDashboard, MapPin, Package, ...`):

Trocar:
```typescript
  { href: '/nfe',        label: 'NF-e',             icon: FileText },
  { href: '/cartoes',    label: 'Cartões',          icon: CreditCard },
```
por:
```typescript
  { href: '/nfe',        label: 'NF-e',             icon: FileText },
  { href: '/controle',   label: 'Controle',         icon: Files },
  { href: '/cartoes',    label: 'Cartões',          icon: CreditCard },
```

- [ ] **Step 3: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificação manual**

Com a API (`cd api && npm run dev`) e o site (`cd web && npm run dev`) rodando:

1. Abrir `/controle` — deve mostrar "Nenhum documento importado ainda." e o botão
   "Importar Documento"
2. Clicar "Importar Documento", escolher um PDF de extrato/contrato real (ex.: de
   `.tmp/notas-exemplo/`, se houver algum lá — senão qualquer PDF de teste)
   Expected: "Lendo documento..." aparece, depois o diálogo fecha e o documento surge
   na lista
3. Repetir com o MESMO arquivo
   Expected: mensagem azul "Este documento já foi importado antes.", diálogo continua
   aberto
4. Testar com um PDF que não é extrato/contrato (ex.: um boleto avulso, ou qualquer
   PDF aleatório)
   Expected: mensagem vermelha explicando o motivo da recusa
5. Clicar no ícone de PDF na linha de um documento importado
   Expected: abre o PDF original em nova aba
6. Clicar no filtro "Fornecedor" no cabeçalho
   Expected: menu abre com os fornecedores existentes, marcar um filtra a lista
7. Se houver mais de 20 documentos: conferir que os números de página aparecem embaixo
   e trocam a lista ao clicar

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/controle/page.tsx" web/components/sidebar.tsx
git commit -m "feat(controle): pagina /controle e item no menu lateral"
```

---

## Self-Review

**Cobertura do spec** (`docs/superpowers/specs/2026-08-17-controle-tela-design.md`):
- Decisão #1 (página nova) — Task 8, item no sidebar ✅
- Decisão #2 (escopo v1: upload+lista+ver PDF) — todas as tasks, sem cruzamento com NF-e ✅
- Decisão #3 (upload via diálogo com "lendo...") — Task 7 ✅
- Decisão #4 (erro visível com selo vermelho) — Task 6, `STATUS_STYLE.erro` ✅
- Decisão #5 (célula mesclada) — Task 6, `rowSpan` ✅
- Decisão #6 (ícone abre PDF) — Task 6, coluna PDF ✅
- Decisão #7 (páginas numeradas) — Task 6, rodapé de paginação ✅
- Decisão #8 (filtro por coluna estilo Excel) — Task 5 (componente) + Task 6
  (Fornecedor/Status) + Task 2 (backend) ✅ — com a nota de escopo explicando por que
  Data usa período em vez de checkbox, e Valor não ganha filtro nesta versão
- API ganha filtro/paginação (Task 1 + 2), resolvendo de brinde a pendência do Apolo
  sobre `GET /` sem `.limit()` ✅
- "Fora de escopo" do spec (cruzamento com NF-e, editar/reprocessar, excluir) —
  nenhuma task toca nisso ✅

**Placeholder scan:** nenhum "TBD"/"depois" sem código — todo step tem código completo
ou comando exato pra rodar.

**Consistência de tipos:** `ListaDocumentosControle` (Task 3) bate com o shape que a
Task 2 devolve (`{ documentos, paginaAtual, totalPaginas, totalDocumentos }`).
`FiltrosSelecionados` (Task 4) é o mesmo tipo usado em `TabelaDocumentos` (Task 6) e
`FiltroColuna` (Task 5, via `string[]` genérico). `ResultadoGravarDocumento` (Task 3)
tem as mesmas 2 variantes JSON que `DialogoImportar` (Task 7) trata explicitamente
(`gravado` / duplicada-*), com o resto tratado via `catch`.
