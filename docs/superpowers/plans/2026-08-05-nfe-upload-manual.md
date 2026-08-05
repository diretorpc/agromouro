# Fechar a porta cega do upload manual de XML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o upload manual de XML na tela de NF-e passar pelo mesmo processador
que o e-mail automático usa (CFOP, estoque, boleto, WhatsApp), consertar o modo
"Manual" para não perder o gasto, e fazer "Excluir nota" desfazer estoque e boleto.

**Architecture:** Duas funções novas de serviço no backend (`api/src/services/nfeManual.ts`)
reaproveitam `parseXmlNFe`, `nfeJaProcessada` e `processarNFe` — já existem, já têm
teste. Uma rota fina (`api/src/routes/nfe.ts`) expõe as duas como HTTP autenticado. O
navegador para de processar XML sozinho e passa a chamar essas rotas.

**Tech Stack:** Node.js + Express + TypeScript + Zod (API, Railway) · Next.js 14 +
TypeScript (Web, Vercel) · Supabase (Postgres) · Vitest

**Spec:** `docs/superpowers/specs/2026-08-05-nfe-upload-manual-design.md`

## Global Constraints

- TypeScript em tudo — nunca JavaScript puro
- Validação de entrada com Zod na rota POST nova
- Erros sempre logados com contexto, nunca engolidos em silêncio — falhar ruidosamente
  é sempre melhor que silencioso (mesmo princípio de `contas/cfop.ts`)
- Mensagens ao usuário final sempre em português brasileiro
- Rotas novas seguem o padrão de autorização das demais rotas autenticadas:
  `requireAuth` confere login; a fazenda vem do corpo do pedido — **sem** verificação
  de posse de fazenda nova (spec, decisão #6 — é o mesmo nível de proteção que
  `/estoque`, `/talhoes` etc. já têm hoje, não uma regressão)
- `web/` não tem test runner configurado — tarefas de frontend verificam com
  `npx tsc --noEmit` + roteiro manual no navegador, não com testes automatizados

---

## Task 1: `processarNFe` aceita origem `'manual'`

**Files:**
- Modify: `api/src/services/nfeProcessor.ts:280` (assinatura da função)
- Modify: `api/src/services/nfeProcessor.ts:527` (ícone da mensagem)
- Test: `api/src/services/nfeProcessor.test.ts`

**Interfaces:**
- Produces: `processarNFe(nfe: NFeData, origem: 'webhook' | 'email' | 'manual', fazenda_id: string): Promise<void>` — Task 2 depende deste tipo aceitar `'manual'`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `api/src/services/nfeProcessor.test.ts` (mesmo arquivo, novo
`describe` no nível superior, fora do bloco "isolamento do bloco de boletos"):

```typescript
describe('processarNFe — origem manual', () => {
  const nfeMinima: NFeData = {
    numero:         '9001',
    dataEmissao:    '2026-08-05T10:00:00-03:00',
    emitenteNome:   'CHEGOU STORE COMERCIO E DISTRIBUICAO LTDA',
    emitenteCnpj:   '34839053000112',
    valorTotal:     1199,
    items: [{
      description:  'Kit 4 Cartuchos Hp 950xl 951xl Original',
      quantity:     1,
      unit:         'UN',
      unitValue:    1199,
      totalValue:   1199,
      quantityTrib: 1,
      unitTrib:     'UN',
      ncm:          '84433100',
      cfop:         '5102',
    }],
    duplicatas:     [],
    formaPagamento: null,
  }

  beforeEach(() => {
    chamadas.length = 0
    estadoBanco.falharUpsertContas = false
    vi.mocked(enviarMensagem).mockClear()
  })

  it('mensagem do WhatsApp usa o ícone de upload manual, não o de e-mail nem webhook', async () => {
    await processarNFe(nfeMinima, 'manual', 'fazenda-fake-id')

    const mensagem = vi.mocked(enviarMensagem).mock.calls[0]?.[1] as string
    expect(mensagem.startsWith('💻')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd api && npx vitest run src/services/nfeProcessor.test.ts -t "origem manual"`
Expected: FAIL — o ícone hoje é `📄` (o `else` do ternário `origem === 'email' ? '📧' : '📄'`), não `💻`.

- [ ] **Step 3: Implementar**

Em `api/src/services/nfeProcessor.ts:280`, trocar:

```typescript
export async function processarNFe(nfe: NFeData, origem: 'webhook' | 'email' = 'webhook', fazenda_id: string): Promise<void> {
```

por:

```typescript
export async function processarNFe(nfe: NFeData, origem: 'webhook' | 'email' | 'manual' = 'webhook', fazenda_id: string): Promise<void> {
```

Em `api/src/services/nfeProcessor.ts:527`, trocar:

```typescript
    const icone = origem === 'email' ? '📧' : '📄'
```

por:

```typescript
    const icone = origem === 'email' ? '📧' : origem === 'manual' ? '💻' : '📄'
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd api && npx vitest run src/services/nfeProcessor.test.ts`
Expected: PASS — todos os testes do arquivo, incluindo o novo.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/nfeProcessor.ts api/src/services/nfeProcessor.test.ts
git commit -m "feat(nfe): processarNFe aceita origem manual"
```

---

## Task 2: Importar XML manual — serviço e rota

**Files:**
- Create: `api/src/services/nfeManual.ts`
- Create: `api/src/services/nfeManual.test.ts`
- Create: `api/src/routes/nfe.ts`
- Modify: `api/src/index.ts`

**Interfaces:**
- Consumes: `parseXmlNFe(xmlStr: string): NFeData | null`, `nfeJaProcessada(numero: string, emitenteCnpj: string, fazenda_id: string): Promise<boolean>`, `processarNFe(nfe: NFeData, origem: 'webhook'|'email'|'manual', fazenda_id: string): Promise<void>` — todas de `./nfeProcessor` (Task 1 concluída)
- Produces: `importarXmlManual(xml: string, fazenda_id: string): Promise<ResultadoImportacao>` e o tipo `ResultadoImportacao` — usados pela rota neste mesmo task, e pelo frontend na Task 4 (o *shape* do JSON, replicado em `web/lib/types.ts`)

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/nfeManual.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./nfeProcessor', () => ({
  parseXmlNFe:     vi.fn(),
  nfeJaProcessada: vi.fn(),
  processarNFe:    vi.fn(),
}))

const { estadoBanco, chamadasRpc } = vi.hoisted(() => ({
  estadoBanco: {
    duplicada:     { data: null as any, error: null as any },
    movimentacoes: { data: [] as any[], error: null as any },
    deleteMov:     { error: null as any },
    deleteContas:  { error: null as any },
    deleteItens:   { error: null as any },
    deleteNota:    { data: [{ id: 'nota-1' }] as any[] | null, error: null as any },
    rpcErro:       null as any,
  },
  chamadasRpc: [] as { fn: string; args: any }[],
}))

vi.mock('./supabase', () => {
  function builder(table: string) {
    let isDelete = false
    const obj: any = {
      select:      vi.fn(() => obj),
      eq:          vi.fn(() => obj),
      delete:      vi.fn(() => { isDelete = true; return obj }),
      maybeSingle: vi.fn(() => Promise.resolve(estadoBanco.duplicada)),
      then: (resolve: any) => {
        if (table === 'movimentacoes_estoque') return resolve(isDelete ? estadoBanco.deleteMov : estadoBanco.movimentacoes)
        if (table === 'contas_a_pagar')        return resolve(estadoBanco.deleteContas)
        if (table === 'itens_nfe')             return resolve(estadoBanco.deleteItens)
        if (table === 'notas_fiscais')         return resolve(estadoBanco.deleteNota)
        return resolve({ data: null, error: null })
      },
    }
    return obj
  }
  return {
    supabase: {
      from: vi.fn((table: string) => builder(table)),
      rpc:  vi.fn((fn: string, args: any) => {
        chamadasRpc.push({ fn, args })
        return Promise.resolve({ error: estadoBanco.rpcErro })
      }),
    },
  }
})

import { parseXmlNFe, nfeJaProcessada, processarNFe } from './nfeProcessor'
import { importarXmlManual } from './nfeManual'

describe('importarXmlManual', () => {
  beforeEach(() => {
    vi.mocked(parseXmlNFe).mockReset()
    vi.mocked(nfeJaProcessada).mockReset()
    vi.mocked(processarNFe).mockReset()
    estadoBanco.duplicada = { data: null, error: null }
  })

  const nfeFake = {
    numero: '9001', dataEmissao: '2026-08-05', emitenteNome: 'CHEGOU STORE',
    emitenteCnpj: '34839053000112', valorTotal: 1199,
    items: [], duplicatas: [], formaPagamento: null,
  } as any

  it('XML inválido: devolve status invalida e não chama processarNFe', async () => {
    vi.mocked(parseXmlNFe).mockReturnValue(null)

    const resultado = await importarXmlManual('<xml-qualquer/>', 'fazenda-1')

    expect(resultado.status).toBe('invalida')
    expect(processarNFe).not.toHaveBeenCalled()
  })

  it('nota já existe: devolve status duplicada com os dados da nota encontrada', async () => {
    vi.mocked(parseXmlNFe).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(true)
    estadoBanco.duplicada = {
      data: { id: 'nota-existente', numero: '9001', data_emissao: '2026-06-02', emitente_nome: 'CHEGOU STORE' },
      error: null,
    }

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('duplicada')
    if (resultado.status === 'duplicada') {
      expect(resultado.nota.id).toBe('nota-existente')
    }
    expect(processarNFe).not.toHaveBeenCalled()
  })

  it('nota nova: chama processarNFe com origem manual e devolve status criada', async () => {
    vi.mocked(parseXmlNFe).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(false)
    vi.mocked(processarNFe).mockResolvedValue(undefined)

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('criada')
    expect(processarNFe).toHaveBeenCalledWith(nfeFake, 'manual', 'fazenda-1')
  })

  it('processarNFe lança erro: devolve status erro com a mensagem', async () => {
    vi.mocked(parseXmlNFe).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(false)
    vi.mocked(processarNFe).mockRejectedValue(new Error('banco fora do ar'))

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('erro')
    if (resultado.status === 'erro') {
      expect(resultado.mensagem).toBe('banco fora do ar')
    }
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd api && npx vitest run src/services/nfeManual.test.ts`
Expected: FAIL — `./nfeManual` não existe ainda.

- [ ] **Step 3: Implementar `nfeManual.ts`**

Criar `api/src/services/nfeManual.ts`:

```typescript
import { supabase } from './supabase'
import { parseXmlNFe, nfeJaProcessada, processarNFe } from './nfeProcessor'

export type ResultadoImportacao =
  | { status: 'criada'; numero: string; emitenteNome: string; valorTotal: number }
  | { status: 'duplicada'; nota: { id: string; numero: string; data_emissao: string; emitente_nome: string } }
  | { status: 'invalida' }
  | { status: 'erro'; mensagem: string }

export async function importarXmlManual(xml: string, fazenda_id: string): Promise<ResultadoImportacao> {
  const nfe = parseXmlNFe(xml)
  if (!nfe) return { status: 'invalida' }

  const jaExiste = await nfeJaProcessada(nfe.numero, nfe.emitenteCnpj, fazenda_id)
  if (jaExiste) {
    const { data: notaExistente } = await supabase
      .from('notas_fiscais')
      .select('id, numero, data_emissao, emitente_nome')
      .eq('numero', nfe.numero)
      .eq('emitente_cnpj', nfe.emitenteCnpj)
      .eq('fazenda_id', fazenda_id)
      .maybeSingle()

    return {
      status: 'duplicada',
      // Fallback defensivo: nfeJaProcessada() já confirmou que existe, mas se
      // a linha sumir entre as duas consultas (janela mínima), não quebra —
      // devolve o que se sabe pelo próprio XML em vez de lançar erro.
      nota: notaExistente ?? { id: '', numero: nfe.numero, data_emissao: '', emitente_nome: nfe.emitenteNome },
    }
  }

  try {
    await processarNFe(nfe, 'manual', fazenda_id)
    return { status: 'criada', numero: nfe.numero, emitenteNome: nfe.emitenteNome, valorTotal: nfe.valorTotal }
  } catch (err) {
    return { status: 'erro', mensagem: err instanceof Error ? err.message : 'Erro desconhecido' }
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd api && npx vitest run src/services/nfeManual.test.ts`
Expected: PASS — as 4 asserções de `importarXmlManual`.

- [ ] **Step 5: Criar a rota**

Criar `api/src/routes/nfe.ts`:

```typescript
import { Router } from 'express'
import { z } from 'zod'
import { importarXmlManual } from '../services/nfeManual'

export const nfeRoutes = Router()

const importarSchema = z.object({
  xml:        z.string().min(50),
  fazenda_id: z.string().uuid(),
})

// POST /nfe/importar-xml — upload manual de XML pela tela, processado pelo
// mesmo caminho do e-mail automático (CFOP, estoque, boleto, WhatsApp).
// 'criada' e 'duplicada' voltam como 200: as duas são respostas válidas do
// pedido, não erro de requisição. Só XML inválido (422) e falha de
// processamento (500) viram erro HTTP de verdade.
nfeRoutes.post('/importar-xml', async (req, res, next) => {
  const parsed = importarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const resultado = await importarXmlManual(parsed.data.xml, parsed.data.fazenda_id)

    if (resultado.status === 'invalida') {
      res.status(422).json({ error: 'Arquivo XML inválido ou formato não reconhecido.' })
      return
    }
    if (resultado.status === 'erro') {
      res.status(500).json({ error: 'Erro ao processar a nota fiscal.', detalhe: resultado.mensagem })
      return
    }

    res.status(200).json(resultado)
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 6: Registrar a rota em `index.ts`**

Em `api/src/index.ts`, depois da linha `import { contaRoutes } from './routes/contas'`, adicionar:

```typescript
import { nfeRoutes } from './routes/nfe'
```

E depois da linha `app.use('/contas', requireAuth, contaRoutes)`, adicionar:

```typescript
app.use('/nfe', requireAuth, nfeRoutes)
```

- [ ] **Step 7: Rodar toda a suíte da API**

Run: `cd api && npm test`
Expected: PASS — nenhuma suíte quebrada.

Run: `cd api && npx tsc --noEmit`
Expected: sem erro de tipo.

- [ ] **Step 8: Commit**

```bash
git add api/src/services/nfeManual.ts api/src/services/nfeManual.test.ts api/src/routes/nfe.ts api/src/index.ts
git commit -m "feat(nfe): rota POST /nfe/importar-xml reaproveita o processador do e-mail"
```

---

## Task 3: Excluir nota — serviço e rota (desfaz estoque e boleto)

**Files:**
- Modify: `api/src/services/nfeManual.ts`
- Modify: `api/src/services/nfeManual.test.ts`
- Modify: `api/src/routes/nfe.ts`

**Interfaces:**
- Consumes: RPC `incrementar_estoque(p_insumo_id uuid, p_quantidade numeric)` — já existe no banco (`api/src/database/schema.sql:166`), soma `p_quantidade` ao saldo; chamado aqui com valor **negativo** para devolver estoque.
- Produces: `excluirNotaManual(notaId: string): Promise<ResultadoExclusao>` e o tipo `ResultadoExclusao` — usados pela rota neste mesmo task.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/src/services/nfeManual.test.ts`, adicionar ao final do arquivo (depois do
`describe('importarXmlManual', ...)`):

```typescript
import { excluirNotaManual } from './nfeManual'

describe('excluirNotaManual', () => {
  beforeEach(() => {
    estadoBanco.movimentacoes = { data: [], error: null }
    estadoBanco.deleteMov     = { error: null }
    estadoBanco.deleteContas  = { error: null }
    estadoBanco.deleteItens   = { error: null }
    estadoBanco.deleteNota    = { data: [{ id: 'nota-1' }], error: null }
    estadoBanco.rpcErro       = null
    chamadasRpc.length = 0
  })

  it('nota sem movimentação de estoque: apaga tudo sem chamar o RPC', async () => {
    const resultado = await excluirNotaManual('nota-1')

    expect(resultado.status).toBe('excluida')
    expect(chamadasRpc).toHaveLength(0)
  })

  it('nota com entrada em estoque: devolve a quantidade com sinal negativo', async () => {
    estadoBanco.movimentacoes = {
      data: [{ insumo_id: 'insumo-1', tipo: 'entrada', quantidade: 50 }],
      error: null,
    }

    await excluirNotaManual('nota-1')

    expect(chamadasRpc).toEqual([
      { fn: 'incrementar_estoque', args: { p_insumo_id: 'insumo-1', p_quantidade: -50 } },
    ])
  })

  it('nota que não existe mais: devolve nao_encontrada', async () => {
    estadoBanco.deleteNota = { data: [], error: null }

    const resultado = await excluirNotaManual('nota-inexistente')

    expect(resultado.status).toBe('nao_encontrada')
  })

  it('erro ao apagar o boleto: para ali e não tenta apagar os itens', async () => {
    estadoBanco.deleteContas = { error: { message: 'falha de rede' } }

    const resultado = await excluirNotaManual('nota-1')

    expect(resultado.status).toBe('erro')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd api && npx vitest run src/services/nfeManual.test.ts -t "excluirNotaManual"`
Expected: FAIL — `excluirNotaManual` não existe ainda.

- [ ] **Step 3: Implementar `excluirNotaManual`**

Em `api/src/services/nfeManual.ts`, adicionar ao final do arquivo:

```typescript
export type ResultadoExclusao =
  | { status: 'excluida' }
  | { status: 'nao_encontrada' }
  | { status: 'erro'; mensagem: string }

// Desfaz tudo que a nota criou, na ordem que respeita as referências entre
// tabelas. Se qualquer passo falhar, PARA ali — nunca segue apagando o resto
// e finge que deu certo (mesmo princípio de contas/cfop.ts: falhar ruidosamente
// é sempre melhor que silencioso).
export async function excluirNotaManual(notaId: string): Promise<ResultadoExclusao> {
  try {
    const { data: movimentacoes, error: errMov } = await supabase
      .from('movimentacoes_estoque')
      .select('insumo_id, tipo, quantidade')
      .eq('nota_fiscal_id', notaId)
    if (errMov) throw errMov

    // incrementar_estoque soma p_quantidade ao saldo — entrada devolve com
    // sinal negativo, saída (defensivo; não deveria existir vindo de NF-e)
    // devolve com sinal positivo.
    for (const mov of movimentacoes ?? []) {
      const delta = mov.tipo === 'entrada' ? -mov.quantidade : mov.quantidade
      const { error: errRpc } = await supabase.rpc('incrementar_estoque', {
        p_insumo_id:  mov.insumo_id,
        p_quantidade: delta,
      })
      if (errRpc) throw errRpc
    }

    const { error: errDelMov } = await supabase
      .from('movimentacoes_estoque')
      .delete()
      .eq('nota_fiscal_id', notaId)
    if (errDelMov) throw errDelMov

    const { error: errDelContas } = await supabase
      .from('contas_a_pagar')
      .delete()
      .eq('nota_fiscal_id', notaId)
    if (errDelContas) throw errDelContas

    const { error: errDelItens } = await supabase
      .from('itens_nfe')
      .delete()
      .eq('nota_fiscal_id', notaId)
    if (errDelItens) throw errDelItens

    const { data: deleted, error: errDelNota } = await supabase
      .from('notas_fiscais')
      .delete()
      .eq('id', notaId)
      .select('id')
    if (errDelNota) throw errDelNota
    if (!deleted || deleted.length === 0) return { status: 'nao_encontrada' }

    return { status: 'excluida' }
  } catch (err) {
    console.error('[NFeManual] Erro ao excluir nota:', err instanceof Error ? err.message : err)
    return { status: 'erro', mensagem: err instanceof Error ? err.message : 'Erro desconhecido' }
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd api && npx vitest run src/services/nfeManual.test.ts`
Expected: PASS — as 4 asserções de `importarXmlManual` + as 4 de `excluirNotaManual`.

- [ ] **Step 5: Adicionar a rota**

Em `api/src/routes/nfe.ts`, adicionar o import e a rota:

```typescript
import { importarXmlManual, excluirNotaManual } from '../services/nfeManual'
```

(substitui a linha de import existente, que só trazia `importarXmlManual`)

```typescript
// DELETE /nfe/:id — apaga a nota e desfaz o que ela criou (estoque e boleto).
nfeRoutes.delete('/:id', async (req, res, next) => {
  try {
    const resultado = await excluirNotaManual(req.params.id)

    if (resultado.status === 'nao_encontrada') {
      res.status(404).json({ error: 'Nota não encontrada.' })
      return
    }
    if (resultado.status === 'erro') {
      res.status(500).json({ error: 'Erro ao excluir a nota.', detalhe: resultado.mensagem })
      return
    }

    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 6: Rodar toda a suíte da API**

Run: `cd api && npm test`
Expected: PASS.

Run: `cd api && npx tsc --noEmit`
Expected: sem erro de tipo.

- [ ] **Step 7: Commit**

```bash
git add api/src/services/nfeManual.ts api/src/services/nfeManual.test.ts api/src/routes/nfe.ts
git commit -m "feat(nfe): rota DELETE /nfe/:id desfaz estoque e boleto ao excluir"
```

---

## Task 4: Frontend — upload de XML usa a API nova

**Files:**
- Modify: `web/app/(app)/nfe/page.tsx`
- Modify: `web/lib/types.ts`

**Interfaces:**
- Consumes: `POST /nfe/importar-xml` (Task 2) — corpo `{ xml: string, fazenda_id: string }`, resposta 200 `ResultadoImportacaoXml`, ou erro lançado (422/500) com `.message` pronto para mostrar.
- Consumes: `api.post<T>(path: string, body: unknown): Promise<T>` de `web/lib/api.ts` (já existe).

- [ ] **Step 1: Adicionar o tipo da resposta em `web/lib/types.ts`**

Adicionar ao final do arquivo:

```typescript
export type ResultadoImportacaoXml =
  | { status: 'criada'; numero: string; emitenteNome: string; valorTotal: number }
  | { status: 'duplicada'; nota: { id: string; numero: string; data_emissao: string; emitente_nome: string } }
```

- [ ] **Step 2: Remover o parser local e o tipo `ParsedNFe`**

Em `web/app/(app)/nfe/page.tsx`, remover por completo (linhas 39-80 do arquivo
original) o bloco:

```typescript
type ParsedNFe = {
  numero: string
  emitente_nome: string
  emitente_cnpj: string
  data_emissao: string
  valor_total: number
  itens: { descricao: string; quantidade: number; unidade: string; valor_unitario: number; valor_total: number }[]
}

function parseNFeXML(xmlStr: string): ParsedNFe | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlStr, 'text/xml')
    if (doc.querySelector('parsererror')) return null

    const getTag = (tag: string, ctx?: Element | Document) =>
      (ctx ?? doc).getElementsByTagName(tag)[0]?.textContent?.trim() ?? ''

    const numero = getTag('nNF')
    const emitente_nome = getTag('xNome')
    const emitente_cnpj = doc.getElementsByTagName('CNPJ')[0]?.textContent?.trim() ?? ''
    const data_emissao = getTag('dhEmi') || getTag('dEmi')
    const valor_total = parseFloat(getTag('vNF')) || 0

    const dets = Array.from(doc.getElementsByTagName('det'))
    const itens = dets.map(det => {
      const prod = det.getElementsByTagName('prod')[0]
      return {
        descricao: getTag('xProd', prod),
        quantidade: parseFloat(getTag('qCom', prod)) || 0,
        unidade: getTag('uCom', prod),
        valor_unitario: parseFloat(getTag('vUnCom', prod)) || 0,
        valor_total: parseFloat(getTag('vProd', prod)) || 0,
      }
    })

    if (!numero || !emitente_nome) return null
    return { numero, emitente_nome, emitente_cnpj, data_emissao, valor_total, itens }
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Importar `api` e o novo tipo**

Adicionar ao bloco de imports do topo do arquivo (junto de `import { supabase } from '@/lib/supabase'`):

```typescript
import { api } from '@/lib/api'
```

E acrescentar `ResultadoImportacaoXml` ao import existente de tipos:

```typescript
import type { NotaFiscal, ItemNfe, ResultadoImportacaoXml } from '@/lib/types'
```

- [ ] **Step 4: Trocar o estado `xmlPreview` por `xmlFileContent`/`xmlFileName`**

Trocar:

```typescript
  const [xmlPreview, setXmlPreview] = useState<ParsedNFe | null>(null)
```

por:

```typescript
  const [xmlFileContent, setXmlFileContent] = useState<string | null>(null)
  const [xmlFileName, setXmlFileName] = useState<string | null>(null)
```

- [ ] **Step 5: Trocar `handleXmlFile` — só lê o arquivo, não interpreta**

Trocar:

```typescript
  function handleXmlFile(file: File) {
    setXmlError('')
    setXmlPreview(null)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseNFeXML(text)
      if (!parsed) {
        setXmlError('Arquivo XML inválido ou formato não reconhecido.')
      } else {
        setXmlPreview(parsed)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }
```

por:

```typescript
  function handleXmlFile(file: File) {
    setXmlError('')
    setXmlFileContent(null)
    setXmlFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      if (!text || text.length < 50) {
        setXmlError('Arquivo vazio ou pequeno demais para ser uma NF-e.')
        return
      }
      setXmlFileContent(text)
    }
    reader.readAsText(file, 'UTF-8')
  }
```

- [ ] **Step 6: Trocar o branch `addMode === 'xml'` em `handleSaveNF`**

Trocar (bloco inteiro, do `if (addMode === 'xml' && xmlPreview) {` até o
`} else if (addMode === 'manual') {`):

```typescript
      if (addMode === 'xml' && xmlPreview) {
        const { data: nota, error: errNota } = await supabase
          .from('notas_fiscais')
          .insert({
            fazenda_id: fazendaAtiva.id,
            numero: xmlPreview.numero,
            emitente_nome: xmlPreview.emitente_nome,
            emitente_cnpj: xmlPreview.emitente_cnpj,
            data_emissao: xmlPreview.data_emissao,
            valor_total: xmlPreview.valor_total,
            status: 'recebida',
          })
          .select()
          .single()
        if (errNota) { setAddErro(errNota.message); return }
        if (nota && xmlPreview.itens.length > 0) {
          // ATENÇÃO: este upload manual lê o XML no NAVEGADOR e grava direto em
          // itens_nfe — não passa pelo processador da API (api/src/services/nfeProcessor.ts).
          // Por isso NÃO grava `cfop` nem `conta_como_compra` aqui: uma nota de
          // entrega (remessa) enviada por este caminho continua contando como
          // gasto na tela Financeiro, do jeito que a Fase 2 (leitura de CFOP)
          // consertou para o caminho automático. É raro — a porta principal é a
          // integração automática via Make — mas é uma lacuna real, pendente de
          // tarefa própria. Não resolvida nesta revisão.
          const { error: errItens } = await supabase.from('itens_nfe').insert(
            xmlPreview.itens.map(item => ({
              nota_fiscal_id: nota.id,
              fazenda_id: fazendaAtiva.id,
              descricao: item.descricao,
              quantidade: item.quantidade,
              unidade: item.unidade,
              valor_unitario: item.valor_unitario,
              valor_total: item.valor_total,
              insumo_id: null,
            }))
          )
          if (errItens) { setAddErro(errItens.message); return }
        }
      } else if (addMode === 'manual') {
```

por:

```typescript
      if (addMode === 'xml' && xmlFileContent) {
        try {
          const resultado = await api.post<ResultadoImportacaoXml>('/nfe/importar-xml', {
            xml: xmlFileContent,
            fazenda_id: fazendaAtiva.id,
          })
          if (resultado.status === 'duplicada') {
            const dataFmt = resultado.nota.data_emissao
              ? resultado.nota.data_emissao.slice(0, 10).split('-').reverse().join('/')
              : 'data desconhecida'
            setAddErro(`Esta nota já está no sistema (entrou em ${dataFmt}).`)
            return
          }
        } catch (err) {
          setAddErro(err instanceof Error ? err.message : 'Erro ao importar a nota.')
          return
        }
      } else if (addMode === 'manual') {
```

- [ ] **Step 7: Ajustar o reset de estado no fim de `handleSaveNF`**

Trocar:

```typescript
      setAddDialog(false)
      setXmlPreview(null)
      setXmlError('')
```

por:

```typescript
      setAddDialog(false)
      setXmlFileContent(null)
      setXmlFileName(null)
      setXmlError('')
```

- [ ] **Step 8: Ajustar `canSave`**

Trocar:

```typescript
  const canSave = addMode === 'xml' ? !!xmlPreview : !!(manualForm.numero && manualForm.emitente_nome && manualForm.data_emissao)
```

por:

```typescript
  const canSave = addMode === 'xml' ? !!xmlFileContent : !!(manualForm.numero && manualForm.emitente_nome && manualForm.data_emissao)
```

- [ ] **Step 9: Trocar o bloco de prévia na UI**

Trocar:

```typescript
              {xmlPreview && (
                <div className="border rounded-lg p-3 space-y-2 bg-green-50/50">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prévia</p>
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    <span className="text-muted-foreground">Número:</span>
                    <span className="font-medium">{xmlPreview.numero}</span>
                    <span className="text-muted-foreground">Emitente:</span>
                    <span className="font-medium">{xmlPreview.emitente_nome}</span>
                    <span className="text-muted-foreground">CNPJ:</span>
                    <span>{xmlPreview.emitente_cnpj}</span>
                    <span className="text-muted-foreground">Valor total:</span>
                    <span className="font-semibold text-green-700">
                      {xmlPreview.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                    <span className="text-muted-foreground">Itens:</span>
                    <span>{xmlPreview.itens.length} produto{xmlPreview.itens.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              )}
```

por:

```typescript
              {xmlFileName && !xmlError && (
                <div className="border rounded-lg p-3 bg-green-50/50 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-green-700 shrink-0" aria-hidden="true" />
                  <span className="text-sm font-medium truncate">{xmlFileName}</span>
                </div>
              )}
```

- [ ] **Step 10: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro. Se aparecer erro sobre `ParsedNFe` ou `xmlPreview` não definidos,
sobrou alguma referência — buscar `xmlPreview` no arquivo inteiro e conferir que só
resta código dos outros modos (ex.: `manualForm`).

- [ ] **Step 11: Verificação manual**

Com a API (`cd api && npm run dev`) e o site (`cd web && npm run dev`) rodando:

1. Abrir `/nfe`, clicar "Adicionar NF", aba "Upload XML"
2. Selecionar um arquivo XML de NF-e real (ex.: de `.tmp/notas-exemplo/`, mesmo que
   já processado — serve para confirmar que a rota responde "já está no sistema")
   Expected: aparece o nome do arquivo, botão "Importar" habilita
3. Clicar "Importar"
   Expected: mensagem "Esta nota já está no sistema (entrou em .../.../....)" — a
   nota é uma das já processadas em sessões anteriores
4. Repetir com um XML de nota fiscal real que NUNCA foi processada
   Expected: dialog fecha, a lista de notas recarrega e a nova nota aparece com
   status `processada`, `cfop` preenchido nos itens (conferir abrindo "Ver itens")

- [ ] **Step 12: Commit**

```bash
git add web/app/\(app\)/nfe/page.tsx web/lib/types.ts
git commit -m "feat(nfe): upload manual de XML passa pelo processador do servidor"
```

---

## Task 5: Frontend — modo "Manual" cria o item do gasto

**Files:**
- Modify: `web/app/(app)/nfe/page.tsx`

**Interfaces:**
- Consumes: nenhuma nova — só o cliente Supabase do navegador já em uso no arquivo.

- [ ] **Step 1: Trocar o branch `addMode === 'manual'` em `handleSaveNF`**

Trocar:

```typescript
      } else if (addMode === 'manual') {
        const { error: errManual } = await supabase.from('notas_fiscais').insert({
          fazenda_id: fazendaAtiva.id,
          numero: manualForm.numero.trim(),
          emitente_nome: manualForm.emitente_nome.trim(),
          emitente_cnpj: manualForm.emitente_cnpj.trim(),
          data_emissao: manualForm.data_emissao,
          valor_total: parseFloat(manualForm.valor_total) || 0,
          status: 'recebida',
        })
        if (errManual) { setAddErro(errManual.message); return }
      }
```

por:

```typescript
      } else if (addMode === 'manual') {
        const valor = parseFloat(manualForm.valor_total) || 0
        const { data: nota, error: errManual } = await supabase.from('notas_fiscais').insert({
          fazenda_id: fazendaAtiva.id,
          numero: manualForm.numero.trim(),
          emitente_nome: manualForm.emitente_nome.trim(),
          emitente_cnpj: manualForm.emitente_cnpj.trim(),
          data_emissao: manualForm.data_emissao,
          valor_total: valor,
          status: 'recebida',
        }).select().single()
        if (errManual) { setAddErro(errManual.message); return }

        // Sem isto, a nota fica com zero itens e o gasto some do Financeiro
        // (que soma itens_nfe, não notas_fiscais) — achado em 05/08/2026.
        if (nota) {
          const { error: errItem } = await supabase.from('itens_nfe').insert({
            nota_fiscal_id: nota.id,
            fazenda_id: fazendaAtiva.id,
            descricao: manualForm.emitente_nome.trim(),
            quantidade: 1,
            unidade: 'un',
            valor_unitario: valor,
            valor_total: valor,
            insumo_id: null,
            cfop: null,
            conta_como_compra: true,
          })
          if (errItem) { setAddErro(errItem.message); return }
        }
      }
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Verificação manual**

1. Abrir `/nfe`, "Adicionar NF", aba "Manual"
2. Preencher número, emitente, data, valor (ex.: R$ 500,00) — sem CNPJ
3. Salvar
   Expected: dialog fecha, nota aparece na lista com status `recebida`
4. Abrir `/financeiro`
   Expected: o valor de R$ 500,00 aparece na lista — **antes deste conserto,
   não aparecia**

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/nfe/page.tsx
git commit -m "fix(nfe): modo Manual cria o item do gasto — antes sumia do Financeiro"
```

---

## Task 6: Frontend — "Excluir nota" usa a API nova

**Files:**
- Modify: `web/app/(app)/nfe/page.tsx`

**Interfaces:**
- Consumes: `DELETE /nfe/:id` (Task 3) — 204 em sucesso, erro lançado com `.message`
  pronto para mostrar em qualquer outro caso.
- Consumes: `api.del(path: string): Promise<void>` de `web/lib/api.ts` (já existe).

- [ ] **Step 1: Trocar `handleDeleteNota`**

Trocar:

```typescript
  async function handleDeleteNota() {
    if (!deleteNota) return
    setDeletandoNota(true)
    setDeleteNotaErro(null)

    await supabase.from('itens_nfe').delete().eq('nota_fiscal_id', deleteNota.id)

    const { data: deleted, error } = await supabase
      .from('notas_fiscais')
      .delete()
      .eq('id', deleteNota.id)
      .select('id')

    setDeletandoNota(false)

    if (error) {
      setDeleteNotaErro(`Erro: ${error.message}`)
      return
    }

    if (!deleted || deleted.length === 0) {
      setDeleteNotaErro('Sem permissão para excluir esta nota. Verifique as políticas do banco.')
      return
    }

    if (selected?.id === deleteNota.id) setSelected(null)
    setDeleteNota(null)
    loadNotas()
  }
```

por:

```typescript
  async function handleDeleteNota() {
    if (!deleteNota) return
    setDeletandoNota(true)
    setDeleteNotaErro(null)

    try {
      await api.del(`/nfe/${deleteNota.id}`)
    } catch (err) {
      setDeletandoNota(false)
      setDeleteNotaErro(err instanceof Error ? err.message : 'Erro ao excluir a nota.')
      return
    }

    setDeletandoNota(false)
    if (selected?.id === deleteNota.id) setSelected(null)
    setDeleteNota(null)
    loadNotas()
  }
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Verificação manual**

1. Importar uma nota de teste com XML (Task 4) que dê entrada em estoque
2. Anotar a quantidade em `/estoque` do insumo antes de excluir
3. Voltar em `/nfe`, excluir essa nota
   Expected: nota some da lista
4. Conferir `/estoque` de novo
   Expected: quantidade voltou ao valor de antes da importação
5. Se a nota tinha vencimento (gerou boleto), conferir `/contas`
   Expected: o boleto dessa nota não aparece mais

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/nfe/page.tsx
git commit -m "fix(nfe): excluir nota desfaz estoque e boleto, não só as linhas do banco"
```

---

## Self-Review

**Cobertura da spec:**
- Upload de XML → servidor, um clique: Task 2 (serviço+rota) + Task 4 (frontend) ✅
- Origem `'manual'` na mensagem: Task 1 ✅
- Modo Manual cria o item: Task 5 ✅
- Excluir desfaz estoque e boleto: Task 3 (serviço+rota) + Task 6 (frontend) ✅
- Autorização no padrão das outras rotas (sem verificação de posse de fazenda nova):
  Task 2 e 3 usam só `requireAuth`, igual `/estoque` e `/talhoes` ✅
- Nota antiga da CHEGOU STORE, nota de serviço, teste de encaminhamento: fora de
  escopo por decisão da spec — nenhuma task toca nisso ✅

**Placeholder scan:** nenhum "TBD"/"depois" — todo step tem código completo ou
comando exato para rodar.

**Consistência de tipos:** `ResultadoImportacao` (backend, `nfeManual.ts`) tem 4
variantes; `ResultadoImportacaoXml` (frontend, `lib/types.ts`) tem só as 2 que
chegam como JSON 200 (`criada`/`duplicada`) — `invalida`/`erro` chegam como erro
HTTP lançado, tratado no `catch`. Confirmado que bate com `api.post` de
`lib/api.ts`, que lança `Error` para qualquer resposta `!res.ok`.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-05-nfe-upload-manual.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session, batch execution with checkpoints

Which approach?
