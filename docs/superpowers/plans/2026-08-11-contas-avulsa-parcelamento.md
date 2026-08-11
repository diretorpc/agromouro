# Parcelamento em "Nova conta avulsa" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o Matheus criar N contas parceladas de uma vez em "Nova conta avulsa" (ex: 4x de R$ 4.000), em vez de preencher o formulário 4 vezes.

**Architecture:** Função pura que gera as N linhas (data/descrição calculadas), chamada pela rota `POST /contas` quando o corpo trouxer `parcelas`; a rota faz um único insert múltiplo (atômico) em vez de N inserts separados. Frontend ganha um checkbox + campo de quantidade no formulário existente.

**Tech Stack:** TypeScript, Express, Zod, Supabase (Postgres), React (Next.js App Router), Vitest.

## Global Constraints

- Data é sempre string `'YYYY-MM-DD'` — nunca `new Date('2026-07-01')` (bug de fuso horário já documentado em `api/src/services/contas/datas.ts:1-3`).
- Valor de cada parcela é o valor DIGITADO, repetido em todas — nunca dividido (decisão explícita do spec).
- Sem `parcelas` no corpo do POST, o comportamento tem que ficar **idêntico** ao de hoje (mudança aditiva, não pode quebrar quem já usa "Nova conta avulsa" sem parcelar).
- Parcelas nascem **todas de uma vez ou nenhuma** — um único `.insert([...])`, nunca um loop de inserts separados.
- Spec completo: `docs/superpowers/specs/2026-08-11-contas-avulsa-parcelamento-design.md`.

---

### Task 1: Função que gera as N parcelas

**Files:**
- Create: `api/src/services/contas/parcelamento.ts`
- Test: `api/src/services/contas/parcelamento.test.ts`

**Interfaces:**
- Consumes: `somarMeses(base: {ano: number, mes: number}, n: number): {ano: number, mes: number}`, `vencimentoDoMes(ano: number, mes: number, diaDesejado: number): string`, `competenciaDoMes(ano: number, mes: number): string` — todas já existem em `api/src/services/contas/datas.ts`, nenhuma muda.
- Produces: `montarParcelas(entrada: EntradaParcelamento): DadosParcela[]` — Task 2 importa e chama esta função.

- [ ] **Step 1: Escrever o teste (vai falhar — o arquivo `parcelamento.ts` ainda não existe)**

Criar `api/src/services/contas/parcelamento.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { montarParcelas } from './parcelamento'

describe('montarParcelas', () => {
  const base = {
    descricao: 'Trator John Deere',
    fornecedor: 'Agrishow Máquinas',
    categoria: 'peca_maquina',
    vencimento: '2026-09-10',
    valor: 4000,
    parcelas: 4,
  }

  it('cria uma linha por parcela, com o MESMO valor em todas (não divide)', () => {
    const linhas = montarParcelas(base)
    expect(linhas).toHaveLength(4)
    linhas.forEach(l => expect(l.valor).toBe(4000))
  })

  it('numera a descrição (i/total), preservando o texto original', () => {
    const linhas = montarParcelas(base)
    expect(linhas.map(l => l.descricao)).toEqual([
      'Trator John Deere (1/4)',
      'Trator John Deere (2/4)',
      'Trator John Deere (3/4)',
      'Trator John Deere (4/4)',
    ])
  })

  it('cada parcela vence um mês depois da anterior, no mesmo dia', () => {
    const linhas = montarParcelas(base)
    expect(linhas.map(l => l.vencimento)).toEqual([
      '2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10',
    ])
  })

  it('competência acompanha o mês do vencimento de CADA parcela', () => {
    const linhas = montarParcelas(base)
    expect(linhas.map(l => l.competencia)).toEqual([
      '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01',
    ])
  })

  it('dia que não existe no mês seguinte cai no último dia daquele mês', () => {
    const linhas = montarParcelas({ ...base, vencimento: '2026-01-31', parcelas: 2 })
    expect(linhas.map(l => l.vencimento)).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('atravessa a virada do ano corretamente', () => {
    const linhas = montarParcelas({ ...base, vencimento: '2026-11-15', parcelas: 3 })
    expect(linhas.map(l => l.vencimento)).toEqual([
      '2026-11-15', '2026-12-15', '2027-01-15',
    ])
  })

  it('preserva fornecedor e categoria nulos', () => {
    const linhas = montarParcelas({ ...base, fornecedor: null, categoria: null })
    linhas.forEach(l => {
      expect(l.fornecedor).toBeNull()
      expect(l.categoria).toBeNull()
    })
  })

  it('nasce sempre com status "aberta" e valor_estimado false — é valor digitado, não chute', () => {
    const linhas = montarParcelas(base)
    linhas.forEach(l => {
      expect(l.status).toBe('aberta')
      expect(l.valor_estimado).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd api && npx vitest run src/services/contas/parcelamento.test.ts`
Expected: FAIL — `Cannot find module './parcelamento'` (o arquivo ainda não existe).

- [ ] **Step 3: Escrever a implementação**

Criar `api/src/services/contas/parcelamento.ts`:

```ts
import { somarMeses, vencimentoDoMes, competenciaDoMes } from './datas'

export type EntradaParcelamento = {
  descricao:  string
  fornecedor: string | null
  categoria:  string | null
  vencimento: string   // 'YYYY-MM-DD' — vencimento da 1ª parcela
  valor:      number
  parcelas:   number   // >= 2 — validado pelo Zod na rota, não aqui
}

export type DadosParcela = {
  descricao:      string
  fornecedor:     string | null
  categoria:      string | null
  vencimento:     string
  valor:          number
  competencia:    string
  valor_estimado: boolean
  status:         string
}

// Gera as N linhas de uma compra parcelada — mesma descrição sufixada
// "(i/N)", mesmo valor em todas (não divide, decisão do Matheus), vencimento
// um mês depois do anterior, no mesmo dia (cai no último dia do mês quando o
// dia não existe — mesma regra que "Nova conta fixa" já usa).
export function montarParcelas(entrada: EntradaParcelamento): DadosParcela[] {
  const [anoBase, mesBase, dia] = entrada.vencimento.split('-').map(Number)

  const parcelas: DadosParcela[] = []
  for (let i = 0; i < entrada.parcelas; i++) {
    const { ano, mes } = somarMeses({ ano: anoBase, mes: mesBase }, i)
    const vencimento = vencimentoDoMes(ano, mes, dia)
    parcelas.push({
      descricao:      `${entrada.descricao} (${i + 1}/${entrada.parcelas})`,
      fornecedor:     entrada.fornecedor,
      categoria:      entrada.categoria,
      vencimento,
      valor:          entrada.valor,
      competencia:    competenciaDoMes(ano, mes),
      valor_estimado: false,
      status:         'aberta',
    })
  }
  return parcelas
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd api && npx vitest run src/services/contas/parcelamento.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Checagem de tipos do projeto inteiro**

Run: `cd api && npx tsc --noEmit`
Expected: sem erro (saída vazia).

- [ ] **Step 6: Commit**

```bash
git add api/src/services/contas/parcelamento.ts api/src/services/contas/parcelamento.test.ts
git commit -m "feat(contas): gera N parcelas de uma compra (valor repetido, vencimento mensal)"
```

---

### Task 2: Ligar `montarParcelas` na rota `POST /contas`

**Files:**
- Modify: `api/src/routes/contas.ts`

**Interfaces:**
- Consumes: `montarParcelas(entrada: EntradaParcelamento): DadosParcela[]` (Task 1).
- Produces: `POST /contas` aceita `parcelas?: number` (2 a 60) no corpo. Sem esse campo, resposta é o objeto único de sempre (`res.status(201).json(objeto)`). Com o campo, resposta é um array com as N contas criadas — Task 3 não precisa ler essa resposta (só chama `onSalvo()` depois do `await`), então o formato novo não quebra o frontend existente.

- [ ] **Step 1: Adicionar o campo `parcelas` ao schema de validação**

Em `api/src/routes/contas.ts`, localizar `avulsaSchema` (linha ~45) e trocar:

```ts
const avulsaSchema = z.object({
  descricao:  z.string().min(1),
  fornecedor: z.string().nullable().optional(),
  categoria:  z.string().nullable().optional(),
  vencimento: z.string().regex(ISO),
  valor:      z.number().nonnegative(),
})
```

por:

```ts
const avulsaSchema = z.object({
  descricao:  z.string().min(1),
  fornecedor: z.string().nullable().optional(),
  categoria:  z.string().nullable().optional(),
  vencimento: z.string().regex(ISO),
  valor:      z.number().nonnegative(),
  parcelas:   z.number().int().min(2).max(60).optional(),
})
```

- [ ] **Step 2: Importar `montarParcelas` no topo do arquivo**

Adicionar junto dos outros imports de `../services/contas/*` (perto da linha 5):

```ts
import { montarParcelas } from '../services/contas/parcelamento'
```

- [ ] **Step 3: Trocar o corpo da rota `POST /contas` (linha ~194)**

Trocar:

```ts
// ─── POST /contas — conta avulsa ──────────────────────────────────────────────
contaRoutes.post('/', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = avulsaSchema.parse(req.body)

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .insert({
        ...body,
        competencia:    `${body.vencimento.slice(0, 7)}-01`,
        valor_estimado: false,
        status:         'aberta',
        fazenda_id:     fazendaId,
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

por:

```ts
// ─── POST /contas — conta avulsa (parcelada ou não) ───────────────────────────
contaRoutes.post('/', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = avulsaSchema.parse(req.body)
    const fornecedor = body.fornecedor ?? null
    const categoria  = body.categoria ?? null

    // Sem `parcelas`: uma linha só, comportamento idêntico ao de antes desta
    // mudança. Com `parcelas`: N linhas, um único insert atômico — ou todas
    // nascem juntas, ou nenhuma nasce (ver docs/superpowers/specs/2026-08-11-
    // contas-avulsa-parcelamento-design.md).
    const linhas = body.parcelas
      ? montarParcelas({
          descricao:  body.descricao,
          fornecedor,
          categoria,
          vencimento: body.vencimento,
          valor:      body.valor,
          parcelas:   body.parcelas,
        })
      : [{
          descricao:      body.descricao,
          fornecedor,
          categoria,
          vencimento:     body.vencimento,
          valor:          body.valor,
          competencia:    `${body.vencimento.slice(0, 7)}-01`,
          valor_estimado: false,
          status:         'aberta',
        }]

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .insert(linhas.map(l => ({ ...l, fazenda_id: fazendaId })))
      .select()

    if (error) throw error
    res.status(201).json(body.parcelas ? data : data?.[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})
```

- [ ] **Step 4: Checagem de tipos**

Run: `cd api && npx tsc --noEmit`
Expected: sem erro (saída vazia).

- [ ] **Step 5: Rodar a suíte de testes inteira do backend (regressão)**

Run: `cd api && npx vitest run`
Expected: PASS — nenhum teste existente quebrou (esta rota não tinha teste
próprio antes desta mudança; a verificação ao vivo acontece na Task 3, pela
tela, porque a rota exige um usuário autenticado com fazenda ativa —
não dá pra simular isso com `curl` sem montar um mock de sessão só pra isso,
e nenhuma outra rota deste arquivo tem esse tipo de teste hoje).

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/contas.ts
git commit -m "feat(contas): POST /contas aceita parcelas (2 a 60), insert atomico"
```

---

### Task 3: Checkbox "Parcelar esta conta" no formulário

**Files:**
- Modify: `web/app/(app)/contas/formulario-conta-avulsa.tsx`

**Interfaces:**
- Consumes: `POST /contas` aceita `parcelas?: number` no corpo (Task 2).
- Produces: nada — é a ponta final da funcionalidade.

- [ ] **Step 1: Substituir o arquivo inteiro**

`web/app/(app)/contas/formulario-conta-avulsa.tsx` (conteúdo completo):

```tsx
'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox } from '@/components/ui/combobox'
import { api } from '@/lib/api'

type FormState = {
  descricao: string
  fornecedor: string
  categoria: string
  vencimento: string
  valor: string
  parcelado: boolean
  quantidadeParcelas: string
}

const FORM_VAZIO: FormState = {
  descricao: '',
  fornecedor: '',
  categoria: '',
  vencimento: '',
  valor: '',
  parcelado: false,
  quantidadeParcelas: '',
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSalvo: () => void
  categoriasExistentes: string[]
}

export function FormularioContaAvulsa({ open, onOpenChange, onSalvo, categoriasExistentes }: Props) {
  const [form, setForm]         = useState<FormState>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState<string | null>(null)

  function fechar() {
    onOpenChange(false)
    setForm(FORM_VAZIO)
    setErro(null)
  }

  const valorNum    = parseFloat(form.valor)
  const valorValido = form.valor !== '' && !isNaN(valorNum) && valorNum >= 0

  const parcelasNum    = parseInt(form.quantidadeParcelas, 10)
  const parcelasValido = !form.parcelado ||
    (Number.isInteger(parcelasNum) && parcelasNum >= 2 && parcelasNum <= 60)

  const podeSalvar = form.descricao.trim() !== '' && form.vencimento !== '' && valorValido && parcelasValido

  async function handleSalvar() {
    if (!podeSalvar) {
      setErro(form.parcelado && !parcelasValido
        ? 'Quantidade de parcelas precisa ser um número entre 2 e 60.'
        : 'Preencha descrição, vencimento e valor.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      await api.post('/contas', {
        descricao:  form.descricao.trim(),
        fornecedor: form.fornecedor.trim() || undefined,
        categoria:  form.categoria.trim() || undefined,
        vencimento: form.vencimento,
        valor:      valorNum,
        parcelas:   form.parcelado ? parcelasNum : undefined,
      })
      onSalvo()
      fechar()
    } catch (err) {
      console.error('[ContaAvulsa] Erro ao salvar:', err)
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar a conta. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) fechar() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova conta avulsa</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input
              placeholder="Ex: Conserto do trator"
              value={form.descricao}
              onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <Input
                placeholder="Opcional"
                value={form.fornecedor}
                onChange={e => setForm(f => ({ ...f, fornecedor: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Combobox
                placeholder="Opcional"
                value={form.categoria}
                onValueChange={categoria => setForm(f => ({ ...f, categoria }))}
                items={categoriasExistentes}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{form.parcelado ? 'Vencimento da 1ª parcela' : 'Vencimento'}</Label>
              <Input
                type="date"
                value={form.vencimento}
                onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor (R$){form.parcelado ? ' — de cada parcela' : ''}</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0,00"
                value={form.valor}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.parcelado}
              onChange={e => setForm(f => ({ ...f, parcelado: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 accent-green-600"
            />
            Parcelar esta conta
          </label>

          {form.parcelado && (
            <div className="space-y-1.5">
              <Label>Quantidade de parcelas</Label>
              <Input
                type="number" min="2" max="60" placeholder="Ex: 4"
                value={form.quantidadeParcelas}
                onChange={e => setForm(f => ({ ...f, quantidadeParcelas: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Cria {Number.isInteger(parcelasNum) && parcelasNum >= 2 ? parcelasNum : 'N'} contas, uma por mês a
                partir do vencimento acima, todas com o mesmo valor.
              </p>
            </div>
          )}
        </div>

        {erro && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{erro}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando || !podeSalvar}>
            {salvando
              ? 'Salvando…'
              : form.parcelado && parcelasValido
                ? `Salvar ${parcelasNum} parcelas`
                : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Checagem de tipos do frontend**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro (saída vazia).

- [ ] **Step 3: Verificação ao vivo (login necessário — pedir para o Matheus, ou testar você mesmo se tiver sessão aberta)**

1. Abrir Contas a Pagar → "Nova conta avulsa".
2. Preencher Descrição "Trator John Deere", Vencimento 10/09/2026, Valor 4000, marcar
   "Parcelar esta conta", Quantidade de parcelas = 4. Confirmar que o botão passa a
   dizer "Salvar 4 parcelas" e o texto de ajuda mostra "Cria 4 contas...".
3. Salvar. Confirmar na lista de Contas a Pagar: 4 linhas novas —
   "Trator John Deere (1/4)" vencendo 10/09, "(2/4)" 10/10, "(3/4)" 10/11,
   "(4/4)" 10/12 — cada uma com valor R$ 4.000,00.
4. Repetir SEM marcar "Parcelar esta conta" (uma conta avulsa normal) e confirmar que
   continua criando 1 conta só, sem sufixo nenhum na descrição — a regressão que mais
   importa.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/contas/formulario-conta-avulsa.tsx"
git commit -m "feat(contas): checkbox 'Parcelar esta conta' em Nova conta avulsa"
```

---

## Self-Review (feito antes de entregar este plano)

- **Cobertura do spec:** as 4 decisões do spec (valor repetido, vencimento mensal
  sequencial, sufixo `(i/N)` na descrição, sem agrupamento visual) estão todas
  cobertas — as três primeiras nas Tasks 1-3; a quarta é a AUSÊNCIA de mudança na
  lista (`lista-contas.tsx` não é tocada por este plano), que é exatamente o
  combinado.
- **Tipos consistentes:** `EntradaParcelamento`/`DadosParcela` (Task 1) são os
  únicos tipos novos; a rota (Task 2) não precisa importá-los por nome — só chama
  `montarParcelas(...)` e usa o retorno estruturalmente. Nenhuma outra task
  redefine ou renomeia esses tipos.
- **Placeholder scan:** nenhum "TBD"/"depois eu vejo" — todo passo tem código
  completo ou comando exato para rodar.
