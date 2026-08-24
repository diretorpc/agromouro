# Talhões Arrendados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir cadastrar áreas próprias arrendadas a terceiros (ex.: Usina Uberaba) como talhões de categoria separada, sem contaminar custo por hectare, culturas plantadas nem lançamento de operações.

**Architecture:** `arrendado` entra como quarto valor de `talhoes.status` (não como coluna booleana — ver a spec para o porquê), acompanhado de uma coluna `arrendatario text` que o banco só aceita preenchida quando o status é `arrendado`. Toda agregação afetada é extraída para função PURA em arquivo próprio, testada com vitest, e a tela passa a consumi-la — mesmo padrão já usado em `salvar-talhao.ts` e `numeros-br.ts`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (PostgreSQL + RLS), Tailwind, Recharts, vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-talhoes-arrendados-design.md`

## Global Constraints

- **TypeScript sempre**, nunca JavaScript puro.
- **Mensagens ao usuário final em português brasileiro.** Nomes de função e variável em inglês ou português conforme o arquivo vizinho já faz.
- **Import de VALOR usa `@/...`** — o alias funciona no vitest desde 24/08/2026 (`web/vitest.config.mts`).
- **Testes são de lógica PURA**, sem DOM: o vitest deste projeto roda no ambiente `node`, sem jsdom, de propósito. Lógica que precisa de tela fica na tela e não é testada aqui.
- **Migration é colada à mão no SQL Editor do Supabase.** O arquivo `.sql` no repo é registro, não automação. O agente NUNCA aplica migration — entrega o SQL ao dono.
- **Comando que mede, ao fim de cada tarefa:** `cd web && npx tsc --noEmit && npx vitest run`
- **Byte-check depois de criar ou mover arquivo com acento:**
  `python -X utf8 -c "import io;t=io.open('CAMINHO',encoding='utf-8').read();print([i+1 for i,l in enumerate(t.split(chr(10))) if chr(160) in l or chr(65533) in l] or 'limpo')"`  (chr(160)=NBSP, chr(65533)=mojibake; por CODIGO, nunca literal)
- **`web/CLAUDE.md` avisa que este Next.js tem breaking changes** em relação ao conhecimento de treino. Antes de usar API do Next (rotas, metadata, server actions), ler `node_modules/next/dist/docs/`. Este plano não usa nenhuma — todas as telas tocadas já são `'use client'`.

---

### Task 1: Migration e tipos

Base de tudo: sem o tipo, o TypeScript não deixa nenhuma tarefa seguinte compilar; sem a migration, o banco recusa o INSERT.

**Files:**
- Create: `api/src/database/migrations/021_talhoes_arrendados.sql`
- Modify: `web/lib/types.ts:1-8`

**Interfaces:**
- Consumes: nada.
- Produces: `Talhao.status` passa a incluir `'arrendado'`; `Talhao.arrendatario: string | null`.

- [ ] **Step 1: Escrever a migration**

Criar `api/src/database/migrations/021_talhoes_arrendados.sql`:

```sql
-- Migration 021 — Talhões arrendados (áreas próprias operadas por terceiro)
-- Execute no SQL Editor do Supabase. Uma vez só.
-- Spec: docs/superpowers/specs/2026-08-24-talhoes-arrendados-design.md

-- 1. Trocar o CHECK de status. O nome da constraint em produção NÃO pode ser
--    presumido (schema.sql está desatualizado e as migrations foram coladas à
--    mão), então descobrimos o nome em vez de cravá-lo.
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'talhoes'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then
    execute format('alter table talhoes drop constraint %I', c);
  end if;
end $$;

alter table talhoes add constraint talhoes_status_check
  check (status in ('ativo','pousio','colhido','arrendado'));

-- 2. Arrendatário. Nullable, e o banco impede preencher fora do status certo.
alter table talhoes add column if not exists arrendatario text;

alter table talhoes add constraint talhoes_arrendatario_so_se_arrendado
  check (arrendatario is null or status = 'arrendado');

-- Conferir depois de aplicar (esperado: as duas constraints acima):
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint where conrelid = 'talhoes'::regclass and contype = 'c';
```

- [ ] **Step 2: Atualizar o tipo `Talhao`**

Em `web/lib/types.ts`, substituir a interface `Talhao` inteira por:

```typescript
export interface Talhao {
  id: string
  nome: string
  area_ha: number
  cultura_atual: string | null
  status: 'ativo' | 'pousio' | 'colhido' | 'arrendado'
  /** Só preenchido quando `status === 'arrendado'` — o banco impõe isso. */
  arrendatario: string | null
  coordenadas?: [number, number][] | null
}
```

- [ ] **Step 3: Rodar o typecheck para VER o que quebrou**

Run: `cd web && npx tsc --noEmit`

Expected: **FALHA**, com erro em `web/app/(app)/talhoes/page.tsx` apontando que
`STATUS_STYLE` (`Record<Talhao['status'], …>`) não tem a propriedade `arrendado`.
Isso é o TypeScript fazendo o trabalho de encontrar os pontos afetados — anotar a
lista de erros, ela guia as tarefas seguintes.

- [ ] **Step 4: Fechar o buraco do `STATUS_STYLE`**

Em `web/app/(app)/talhoes/page.tsx:28-35`, substituir as duas constantes por:

```typescript
const STATUS_OPTIONS: Talhao['status'][] = ['ativo', 'pousio', 'colhido', 'arrendado']

const STATUS_STYLE: Record<Talhao['status'], { bg: string; color: string }> = {
  ativo:     { bg: '#EDFAF1', color: '#16A34A' },
  pousio:    { bg: '#FFFBEB', color: '#D97706' },
  colhido:   { bg: '#F3F4F6', color: '#6B7280' },
  // Azul: distinto dos três acima, que são verde/âmbar/cinza. Área arrendada
  // não é estado de lavoura — é regime de posse, e a cor precisa dizer isso.
  arrendado: { bg: '#EFF6FF', color: '#2563EB' },
}
```

- [ ] **Step 5: Rodar typecheck e testes**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; **139 testes passando** (o número de antes desta feature).

- [ ] **Step 6: Commit**

```bash
git add api/src/database/migrations/021_talhoes_arrendados.sql "web/lib/types.ts" "web/app/(app)/talhoes/page.tsx"
git commit -m "feat(talhoes): tipo e migration para area arrendada

arrendado entra como quarto valor de talhoes.status, com coluna
arrendatario que o banco so aceita preenchida nesse status.

Migration NAO aplicada ainda -- precisa ser colada no SQL Editor."
```

- [ ] **Step 7: Entregar o SQL ao dono**

Colar o conteúdo da migration em bloco de código NA MENSAGEM do chat (não só o
caminho do arquivo) e pedir que ele rode no SQL Editor, mais a query de
conferência. **Nenhuma tarefa seguinte pode ser testada ao vivo antes disso** —
os testes de unidade rodam sem o banco, mas gravar talhão arrendado, não.

---

### Task 2: `prepararTalhao` grava o arrendatário

**Files:**
- Modify: `web/app/(app)/talhoes/salvar-talhao.ts:11-24` (interfaces) e o corpo de `prepararTalhao`
- Test: `web/app/(app)/talhoes/salvar-talhao.test.ts`

**Interfaces:**
- Consumes: `Talhao` da Task 1.
- Produces: `FormTalhao.arrendatario: string`; `PayloadTalhao.arrendatario: string | null`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `web/app/(app)/talhoes/salvar-talhao.test.ts`:

```typescript
describe('prepararTalhao — arrendamento', () => {
  it('grava o arrendatário aparado quando o status é arrendado', () => {
    const r = prepararTalhao(
      { ...FORM_BASE, status: 'arrendado', arrendatario: '  Usina Uberaba  ' },
      FAZENDA, null,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.arrendatario).toBe('Usina Uberaba')
  })

  // NÃO minusculiza: é nome próprio, e a exibição usa CSS `capitalize`, que
  // transformaria "usina de uberaba" em "Usina De Uberaba".
  it('preserva a caixa do nome — não é normalizado como a cultura', () => {
    const r = prepararTalhao(
      { ...FORM_BASE, status: 'arrendado', arrendatario: 'Usina de Uberaba' },
      FAZENDA, null,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.arrendatario).toBe('Usina de Uberaba')
  })

  it('arrendatário vazio vira null, nunca string vazia', () => {
    const r = prepararTalhao(
      { ...FORM_BASE, status: 'arrendado', arrendatario: '   ' },
      FAZENDA, null,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.arrendatario).toBeNull()
  })

  // O usuário pode digitar o arrendatário e DEPOIS trocar o status. Sem esta
  // limpeza o INSERT bate na CHECK `arrendatario is null or status = 'arrendado'`
  // e o produtor leva um erro que não fez por merecer.
  it.each(['ativo', 'pousio', 'colhido'] as const)(
    'status %s zera o arrendatário mesmo se o formulário trouxer texto',
    (status) => {
      const r = prepararTalhao(
        { ...FORM_BASE, status, arrendatario: 'Usina Uberaba' },
        FAZENDA, null,
      )
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.payload.arrendatario).toBeNull()
    },
  )
})
```

E acrescentar o campo ao `FORM_BASE` no topo do mesmo arquivo:

```typescript
const FORM_BASE: FormTalhao = {
  nome: '3M',
  area_ha: '450',
  cultura_atual: 'cana',
  status: 'ativo',
  arrendatario: '',
}
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd web && npx vitest run app/\(app\)/talhoes`
Expected: FALHA de compilação — `arrendatario` não existe em `FormTalhao`.

- [ ] **Step 3: Implementar**

Em `web/app/(app)/talhoes/salvar-talhao.ts`, acrescentar o campo às duas
interfaces:

```typescript
export interface FormTalhao {
  nome: string
  area_ha: string
  cultura_atual: string
  status: Talhao['status']
  arrendatario: string
}

export interface PayloadTalhao {
  nome: string
  area_ha: number
  status: Talhao['status']
  cultura_atual: string | null
  arrendatario: string | null
  fazenda_id?: string
}
```

E, dentro de `prepararTalhao`, trocar a construção de `base` por:

```typescript
  const base: PayloadTalhao = {
    nome,
    area_ha: area,
    status: form.status,
    cultura_atual: normalizarCultura(form.cultura_atual),
    // Só `.trim()`, sem minusculizar: nome próprio. E zerado fora do status
    // arrendado, senão o INSERT bate na CHECK do banco.
    arrendatario: form.status === 'arrendado' ? (form.arrendatario.trim() || null) : null,
  }
```

- [ ] **Step 4: Rodar os testes**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; todos passando. `page.tsx` vai acusar erro de tipo nos dois
`setForm({...})` que ainda não têm `arrendatario` — corrigir na Task 4. Se o tsc
falhar SÓ por isso, seguir; se falhar por outro motivo, parar e investigar.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/talhoes/salvar-talhao.ts" "web/app/(app)/talhoes/salvar-talhao.test.ts"
git commit -m "feat(talhoes): prepararTalhao grava o arrendatario

Aparado mas NAO minusculizado (nome proprio), e zerado quando o status
nao e arrendado -- senao o INSERT bate na CHECK do banco."
```

---

### Task 3: Resumo de áreas (própria x arrendada)

Função pura que os KPIs de Talhões vão consumir. Separada da tela porque o
vitest deste projeto roda sem DOM.

**Files:**
- Create: `web/app/(app)/talhoes/resumo-areas.ts`
- Test: `web/app/(app)/talhoes/resumo-areas.test.ts`

**Interfaces:**
- Consumes: `Talhao` da Task 1.
- Produces: `resumirAreas(talhoes: Talhao[]): ResumoAreas` com os campos
  `total`, `arrendada`, `emOperacao`, `qtdTotal`, `qtdArrendados`, `qtdEmOperacao` (todos `number`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/app/(app)/talhoes/resumo-areas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resumirAreas } from './resumo-areas'
import type { Talhao } from '@/lib/types'

function talhao(over: Partial<Talhao>): Talhao {
  return {
    id: 'x', nome: 'T', area_ha: 100, cultura_atual: null,
    status: 'ativo', arrendatario: null, ...over,
  }
}

describe('resumirAreas', () => {
  it('soma tudo no total e separa a arrendada', () => {
    const r = resumirAreas([
      talhao({ id: '1', area_ha: 450, status: 'ativo' }),
      talhao({ id: '2', area_ha: 128.8, status: 'colhido' }),
      talhao({ id: '3', area_ha: 350, status: 'arrendado', arrendatario: 'Usina Uberaba' }),
    ])
    expect(r.total).toBe(928.8)
    expect(r.arrendada).toBe(350)
    expect(r.emOperacao).toBe(578.8)
  })

  // A invariante que impede a tela de se contradizer.
  it('em operação + arrendada é SEMPRE igual ao total', () => {
    const r = resumirAreas([
      talhao({ id: '1', area_ha: 105.9 }),
      talhao({ id: '2', area_ha: 80.5, status: 'arrendado' }),
      talhao({ id: '3', area_ha: 196.4, status: 'pousio' }),
    ])
    expect(r.emOperacao + r.arrendada).toBeCloseTo(r.total, 10)
  })

  it('conta os talhões nos três recortes', () => {
    const r = resumirAreas([
      talhao({ id: '1' }),
      talhao({ id: '2', status: 'arrendado' }),
      talhao({ id: '3', status: 'arrendado' }),
    ])
    expect(r.qtdTotal).toBe(3)
    expect(r.qtdArrendados).toBe(2)
    expect(r.qtdEmOperacao).toBe(1)
  })

  it('lista vazia devolve tudo zerado, não NaN', () => {
    const r = resumirAreas([])
    expect(r).toEqual({
      total: 0, arrendada: 0, emOperacao: 0,
      qtdTotal: 0, qtdArrendados: 0, qtdEmOperacao: 0,
    })
  })

  it('area_ha nula não vira NaN e contamina o total', () => {
    const r = resumirAreas([
      talhao({ id: '1', area_ha: null as unknown as number }),
      talhao({ id: '2', area_ha: 100 }),
    ])
    expect(r.total).toBe(100)
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd web && npx vitest run app/\(app\)/talhoes/resumo-areas`
Expected: FALHA — `Cannot find module './resumo-areas'`.

- [ ] **Step 3: Implementar**

Criar `web/app/(app)/talhoes/resumo-areas.ts`:

```typescript
import type { Talhao } from '@/lib/types'

// Área arrendada é terra NOSSA operada por terceiro. Ela conta no patrimônio
// (decisão do dono: o número grande responde "quanta terra nós temos") mas não
// conta como área de trabalho. Separar aqui, uma vez, evita que cada KPI
// invente a sua própria conta e as telas se contradigam.

export interface ResumoAreas {
  /** Patrimônio inteiro: própria em operação + arrendada. */
  total: number
  arrendada: number
  emOperacao: number
  qtdTotal: number
  qtdArrendados: number
  qtdEmOperacao: number
}

export function resumirAreas(talhoes: Talhao[]): ResumoAreas {
  let total = 0, arrendada = 0
  let qtdTotal = 0, qtdArrendados = 0

  for (const t of talhoes) {
    const area = t.area_ha ?? 0
    total += area
    qtdTotal++
    if (t.status === 'arrendado') {
      arrendada += area
      qtdArrendados++
    }
  }

  return {
    total,
    arrendada,
    emOperacao: total - arrendada,
    qtdTotal,
    qtdArrendados,
    qtdEmOperacao: qtdTotal - qtdArrendados,
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd web && npx vitest run app/\(app\)/talhoes/resumo-areas`
Expected: 5 testes passando.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/talhoes/resumo-areas.ts" "web/app/(app)/talhoes/resumo-areas.test.ts"
git commit -m "feat(talhoes): resumirAreas separa area propria de arrendada"
```

---

### Task 4: Tela de Talhões — formulário, KPIs e tabela

**Files:**
- Modify: `web/app/(app)/talhoes/page.tsx` — estado do formulário, `abrirNovo`, `abrirEdicao`, métricas, os três KpiCards, a tabela e o diálogo

**Interfaces:**
- Consumes: `resumirAreas` (Task 3), `FormTalhao.arrendatario` (Task 2), `STATUS_OPTIONS`/`STATUS_STYLE` (Task 1).
- Produces: nada consumido por outras tarefas.

- [ ] **Step 1: Importar e trocar as métricas**

No topo do arquivo, junto aos outros imports locais:

```typescript
import { resumirAreas } from './resumo-areas'
```

Em `web/app/(app)/talhoes/page.tsx`, no bloco `// ── Métricas ──`, substituir as
duas primeiras linhas por:

```typescript
  const resumo         = resumirAreas(talhoes)
  // Culturas ignora arrendados: a cultura plantada lá é da usina, não nossa.
  const culturas       = [...new Set(
    talhoes.filter(t => t.status !== 'arrendado')
           .map(t => normalizarCultura(t.cultura_atual))
           .filter(Boolean),
  )]
  const comMapa        = talhoes.filter(t => t.coordenadas && t.coordenadas.length > 2)
```

Apagar as linhas `const talhoesAtivos = …` e `const areaTotal = …` (substituídas
pelo `resumo`).

- [ ] **Step 2: Trocar os três KpiCards**

Substituir os três `<KpiCard>` do bloco `{/* KPIs */}` por:

```tsx
        <KpiCard
          label="Talhões Cadastrados"
          value={erroSemDados ? '—' : resumo.qtdTotal}
          sub={erroSemDados
            ? 'não foi possível carregar'
            : resumo.qtdArrendados > 0
              ? `${resumo.qtdEmOperacao} em operação · ${resumo.qtdArrendados} arrendado${resumo.qtdArrendados !== 1 ? 's' : ''}`
              : `${resumo.qtdEmOperacao} em operação`}
          icon={<MapPin className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          label="Área Total"
          value={erroSemDados ? '—' : `${resumo.total.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha`}
          sub={erroSemDados
            ? 'não foi possível carregar'
            : resumo.arrendada > 0
              ? `${resumo.qtdTotal} talh${resumo.qtdTotal !== 1 ? 'ões' : 'ão'} · sendo ${resumo.arrendada.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha arrendados`
              : `${resumo.qtdTotal} talh${resumo.qtdTotal !== 1 ? 'ões' : 'ão'}`}
          icon={<Layers className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          label="Culturas Ativas"
          value={erroSemDados ? '—' : culturas.length}
          sub={erroSemDados ? 'não foi possível carregar' : (culturas.length > 0 ? culturas.join(', ') : 'nenhuma plantada')}
          icon={<Sprout className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
```

- [ ] **Step 3: Acertar o formulário**

Trocar o `useState` do formulário e as duas funções que o preenchem.

O estado inicial (`const [form, setForm] = useState({…})`) vira:

```typescript
  const [form, setForm] = useState({
    nome: '', area_ha: '', cultura_atual: '', status: 'ativo' as Talhao['status'],
    arrendatario: '',
  })
```

Em `abrirNovo`:

```typescript
    setForm({ nome: '', area_ha: '', cultura_atual: '', status: 'ativo', arrendatario: '' })
```

Em `abrirEdicao`:

```typescript
    setForm({
      nome: t.nome,
      area_ha: String(t.area_ha),
      cultura_atual: t.cultura_atual ?? '',
      status: t.status,
      arrendatario: t.arrendatario ?? '',
    })
```

- [ ] **Step 4: Campo condicional no diálogo**

No diálogo, logo DEPOIS do bloco do `<Label>Status</Label>` e ANTES do bloco de
Cultura Atual, inserir:

```tsx
            {form.status === 'arrendado' && (
              <div className="space-y-1.5">
                <Label>Arrendatário <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input placeholder="ex: Usina Uberaba" value={form.arrendatario}
                  onChange={e => setForm(f => ({ ...f, arrendatario: e.target.value }))} />
                <p className="text-xs text-muted-foreground">
                  Esta área não aparece em Operações nem entra no custo por hectare.
                </p>
              </div>
            )}
```

- [ ] **Step 5: Mostrar o arrendatário na tabela**

Na `<TableCell className="font-semibold">{t.nome}</TableCell>`, trocar por:

```tsx
                    <TableCell className="font-semibold">
                      {t.nome}
                      {t.arrendatario && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {t.arrendatario}
                        </span>
                      )}
                    </TableCell>
```

- [ ] **Step 6: Rodar typecheck, testes e build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc exit 0; todos os testes passando; build compila `/talhoes`.

- [ ] **Step 7: Verificar ao vivo**

Só possível depois da migration aplicada (Task 1, Step 7). Com o dono logado:
abrir `/talhoes`, criar um talhão com status Arrendado e arrendatário
"Usina Uberaba", conferir que (a) o badge azul aparece, (b) Área Total cresceu e
a sublinha diz "sendo X ha arrendados", (c) "Talhões Cadastrados" diz
"N em operação · 1 arrendado", (d) "Culturas Ativas" NÃO ganhou cultura nova.
Conferir o console por erros.

- [ ] **Step 8: Commit**

```bash
git add "web/app/(app)/talhoes/page.tsx"
git commit -m "feat(talhoes): status Arrendado no formulario, KPIs e tabela

Area Total passa a somar o patrimonio inteiro com sublinha do quanto e
arrendado; Culturas Ativas ignora arrendados (a cultura la e da usina)."
```

---

### Task 5: Dashboard — fatia "Arrendado" em Culturas por Área

**Files:**
- Create: `web/app/(app)/dashboard/culturas-por-area.ts`
- Test: `web/app/(app)/dashboard/culturas-por-area.test.ts`
- Modify: `web/app/(app)/dashboard/page.tsx` — o bloco `culturasPorArea`

**Interfaces:**
- Consumes: `Talhao` (Task 1), `normalizarCultura` de `@/lib/cultura`.
- Produces: `FATIA_ARRENDADO: string` e
  `agruparCulturasPorArea(talhoes: Talhao[]): { name: string; value: number }[]`,
  já ordenado do maior para o menor e com `value` arredondado a 1 casa.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/app/(app)/dashboard/culturas-por-area.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { agruparCulturasPorArea, FATIA_ARRENDADO } from './culturas-por-area'
import type { Talhao } from '@/lib/types'

function talhao(over: Partial<Talhao>): Talhao {
  return {
    id: 'x', nome: 'T', area_ha: 100, cultura_atual: null,
    status: 'ativo', arrendatario: null, ...over,
  }
}

describe('agruparCulturasPorArea', () => {
  it('junta "Cana" e "cana" numa fatia só', () => {
    const r = agruparCulturasPorArea([
      talhao({ id: '1', area_ha: 450, cultura_atual: 'cana' }),
      talhao({ id: '2', area_ha: 128.8, cultura_atual: 'Cana' }),
    ])
    expect(r).toEqual([{ name: 'cana', value: 578.8 }])
  })

  // A cana da usina NÃO é a nossa cana.
  it('talhão arrendado vai para a fatia Arrendado, não para a cultura dele', () => {
    const r = agruparCulturasPorArea([
      talhao({ id: '1', area_ha: 450, cultura_atual: 'cana' }),
      talhao({ id: '2', area_ha: 80.5, cultura_atual: 'cana', status: 'arrendado' }),
    ])
    expect(r).toEqual([
      { name: 'cana', value: 450 },
      { name: FATIA_ARRENDADO, value: 80.5 },
    ])
  })

  // A invariante que impede o gráfico de discordar do "ha total" do topo.
  it('a soma das fatias é igual à área de TODOS os talhões', () => {
    const talhoes = [
      talhao({ id: '1', area_ha: 450, cultura_atual: 'cana' }),
      talhao({ id: '2', area_ha: 80.5, status: 'arrendado' }),
      talhao({ id: '3', area_ha: 105.9, cultura_atual: null }),
    ]
    const soma = agruparCulturasPorArea(talhoes).reduce((s, f) => s + f.value, 0)
    expect(soma).toBeCloseTo(636.4, 1)
  })

  it('talhão sem cultura cai em "Sem cultura"', () => {
    const r = agruparCulturasPorArea([talhao({ id: '1', area_ha: 10, cultura_atual: '  ' })])
    expect(r).toEqual([{ name: 'Sem cultura', value: 10 }])
  })

  it('ordena da maior área para a menor', () => {
    const r = agruparCulturasPorArea([
      talhao({ id: '1', area_ha: 10, cultura_atual: 'milho' }),
      talhao({ id: '2', area_ha: 90, cultura_atual: 'soja' }),
    ])
    expect(r.map(f => f.name)).toEqual(['soja', 'milho'])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(agruparCulturasPorArea([])).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd web && npx vitest run app/\(app\)/dashboard`
Expected: FALHA — `Cannot find module './culturas-por-area'`.

- [ ] **Step 3: Implementar**

Criar `web/app/(app)/dashboard/culturas-por-area.ts`:

```typescript
import { normalizarCultura } from '@/lib/cultura'
import type { Talhao } from '@/lib/types'

/**
 * Talhão arrendado entra numa fatia PRÓPRIA, não na cultura dele.
 *
 * Por que fatia e não exclusão: o gráfico calcula a porcentagem sobre a soma das
 * próprias fatias, e o "ha total" logo acima soma TODOS os talhões. Excluir os
 * arrendados faria as duas coisas discordarem na mesma tela. A fatia nomeada
 * mantém a soma correta E impede confundir a cana da usina com a nossa.
 *
 * Comparado por STATUS, nunca pelo texto da cultura — uma cultura chamada
 * "arrendado" não pode sequestrar a fatia.
 */
export const FATIA_ARRENDADO = 'Arrendado'

export function agruparCulturasPorArea(
  talhoes: Talhao[],
): { name: string; value: number }[] {
  const porChave = talhoes.reduce<Record<string, number>>((acc, t) => {
    const chave = t.status === 'arrendado'
      ? FATIA_ARRENDADO
      : normalizarCultura(t.cultura_atual) ?? 'Sem cultura'
    acc[chave] = (acc[chave] ?? 0) + (t.area_ha ?? 0)
    return acc
  }, {})

  return Object.entries(porChave)
    .map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }))
    .sort((a, b) => b.value - a.value)
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd web && npx vitest run app/\(app\)/dashboard`
Expected: 6 testes passando.

- [ ] **Step 5: Ligar na tela**

Em `web/app/(app)/dashboard/page.tsx`, acrescentar o import:

```typescript
import { agruparCulturasPorArea } from './culturas-por-area'
```

E substituir todo o bloco `const culturasPorArea = Object.entries(…)…` por:

```typescript
  const culturasPorArea = agruparCulturasPorArea(talhoes)
    .map((fatia, i) => ({ ...fatia, color: getCultureColor(fatia.name, i) }))
```

**Remover também o import agora órfão** `import { normalizarCultura } from
'@/lib/cultura'` (linha 13 do `page.tsx`). Conferido: a linha 175 era o ÚNICO uso
dele no arquivo, e este passo a substitui. Não contar com o `tsc` para avisar —
import não usado não é erro de tipo por padrão. Confirmar com:
`grep -n "normalizarCultura" "web/app/(app)/dashboard/page.tsx"` (esperado: nada).

- [ ] **Step 6: Rodar typecheck, testes e build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/dashboard/culturas-por-area.ts" "web/app/(app)/dashboard/culturas-por-area.test.ts" "web/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): area arrendada vira fatia propria em Culturas por Area

Fatia nomeada em vez de exclusao: o grafico precisa continuar batendo com
o ha total exibido acima dele."
```

---

### Task 6: Operações não oferece talhão arrendado

A trava que impede lançar pulverização e gasto em terra operada pela usina.

**Files:**
- Modify: `web/app/(app)/operacoes/page.tsx` — o `<SelectContent>` do seletor de talhão (por volta da linha 668)

**Interfaces:**
- Consumes: `Talhao.status` (Task 1).
- Produces: nada.

- [ ] **Step 1: Filtrar a lista do seletor**

Em `web/app/(app)/operacoes/page.tsx`, logo antes do `return` do componente (junto
das outras derivações de dados), acrescentar:

```typescript
  // Área arrendada é operada pela usina, não por nós. Deixá-la no seletor
  // permitiria lançar operação e gasto em terra que não trabalhamos — e o custo
  // por hectare de TODOS os talhões ficaria mais barato do que é.
  const talhoesOperaveis = talhoes.filter(t => t.status !== 'arrendado')
```

E no `<SelectContent>` do seletor de talhão, trocar `talhoes.map(...)` por
`talhoesOperaveis.map(...)`:

```tsx
                <SelectContent>
                  {talhoesOperaveis.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome} — {t.area_ha} ha
                    </SelectItem>
                  ))}
                </SelectContent>
```

**NÃO trocar** as outras ocorrências de `talhoes.find(...)` no arquivo: elas
resolvem o nome de operações JÁ EXISTENTES para exibição. Se um talhão virar
arrendado depois de ter operações, o histórico precisa continuar legível.

- [ ] **Step 2: Rodar typecheck, testes e build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tudo verde.

- [ ] **Step 3: Verificar ao vivo**

Com o dono logado e a migration aplicada: abrir `/operacoes`, clicar em nova
operação e conferir que o talhão arrendado **não** aparece na lista, e que os
demais aparecem. Abrir uma operação antiga e conferir que o nome do talhão
continua sendo exibido.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/operacoes/page.tsx"
git commit -m "feat(operacoes): seletor de talhao nao oferece area arrendada

Impede lancar operacao e gasto em terra operada por terceiro. O historico
de operacoes antigas continua exibindo o nome do talhao normalmente."
```

---

## Fechamento

- [ ] **Conferir o Custos ao vivo, sem presumir.** A spec afirma que ele se corrige
  sozinho — `web/app/(app)/custos/page.tsx` monta `talhaoMap` a partir de `operacoes`,
  então talhão sem operação nunca aparece, e a Task 6 impede que ele ganhe operação.
  **Isso é raciocínio, não medição.** Abrir `/custos` com o talhão arrendado já
  cadastrado e confirmar que ele não está na lista e que o KPI "X ha no total" não
  cresceu. Se aparecer, abrir tarefa — não remendar aqui.
- [ ] **Rodar a revisão do Apolo** (ferramenta `Agent`, `subagent_type="apolo"`) sobre o conjunto das seis tarefas, informando os arquivos tocados e as medições já feitas. Corrigir o que ele achar antes do PR.
- [ ] **Atualizar `ESTADO.md`** com o que entrou no ar, a migration aplicada e o que ficou de fora (contrato de arrendamento).
- [ ] **Abrir PR** com o resumo do problema, a evidência ao vivo e o link para a spec.
