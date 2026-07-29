# Contas a Pagar — Fase 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Matheus uma agenda de contas fixas recorrentes (luz, água, impostos, folha) que se preenche sozinha todo mês, avisa o que está atrasado / vencendo / ainda não chegou, e lança o gasto no Financeiro quando a conta é paga.

**Architecture:** Duas tabelas novas (`contas_recorrentes` = a regra, `contas_a_pagar` = a ocorrência de cada mês), uma tarefa diária às 07:00 que garante que as ocorrências existam e monta um aviso agrupado, uma rota `/contas` na API e uma página `/contas` no site. Toda a lógica de calendário vive em **funções puras sem banco** (`api/src/services/contas/`), que é o que os testes cobrem; a camada que fala com o Supabase fica fina de propósito.

**Tech Stack:** Node + Express + TypeScript (API, deploy Railway), Next.js 16 + React 19 + Tailwind + shadcn/ui (site, deploy Vercel), Supabase (PostgreSQL + Auth + RLS), node-cron, Zod, Vitest (novo).

**Spec:** `docs/superpowers/specs/2026-07-29-contas-a-pagar-design.md` — leia antes de começar.

## Global Constraints

- **TypeScript sempre**, nunca JavaScript puro.
- Nomes de função e variável em **inglês camelCase**; nomes de rota e de coluna em **português**; mensagens ao usuário final em **português brasileiro**.
- Validação de entrada com **Zod** em toda rota POST/PATCH.
- Variáveis de ambiente via `process.env` — nunca cravadas no código.
- **Nada neste plano altera o fluxo de NF-e.** `nfeProcessor.ts`, `jobs/nfeEmail.ts`, `webhooks/nfe*.ts` não são tocados. O único ponto de contato com o que já existe é **inserir** (nunca alterar) uma linha em `lancamentos_financeiros` quando uma conta é marcada como paga.
- **Datas nunca passam por `new Date('2026-07-01')`.** Esse formato é interpretado como UTC e já causou um defeito neste projeto (datas do Financeiro apareciam com 1 dia a menos no fuso do Brasil). Neste módulo, data é **texto `YYYY-MM-DD`** e toda conta de calendário usa números de ano/mês/dia ou `Date.UTC` nos dois lados da subtração.
- **RLS com `FOR ALL`** nas tabelas novas. Tabela com permissão só de leitura faz escrita do site falhar em silêncio — já aconteceu neste projeto com `itens_nfe`.
- Toda tabela nova tem `fazenda_id NOT NULL`.
- Commits em português, prefixo `feat:` / `test:` / `chore:`, no ramo `docs/contas-a-pagar-spec` (ou num ramo `feat/contas-a-pagar` criado a partir dele).

---

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/004_contas_a_pagar.sql` | As duas tabelas, índices e permissões |
| `api/src/services/contas/datas.ts` | Contas de calendário. Puro, sem banco |
| `api/src/services/contas/datas.test.ts` | Testes de calendário |
| `api/src/services/contas/ocorrencias.ts` | Quais ocorrências deveriam existir. Puro |
| `api/src/services/contas/ocorrencias.test.ts` | Testes de geração de ocorrências |
| `api/src/services/contas/resumo.ts` | O que entra no aviso do dia. Puro |
| `api/src/services/contas/resumo.test.ts` | Testes das três regras de aviso |
| `api/src/services/contas/pagamento.ts` | A regra anti-duplicidade do "pago". Puro |
| `api/src/services/contas/pagamento.test.ts` | Teste da regra |
| `api/src/services/contas/sincronizar.ts` | Única peça que fala com o Supabase |
| `api/src/routes/contas.ts` | Rotas HTTP do módulo |
| `api/src/jobs/contas.ts` | A tarefa diária das 07:00 |
| `web/app/(app)/contas/page.tsx` | A página |
| `web/app/(app)/contas/formulario-conta-fixa.tsx` | Cadastro/edição da regra recorrente |
| `web/app/(app)/contas/formulario-conta-avulsa.tsx` | Cadastro de conta que não se repete |

**Modificar:**

| Arquivo | O quê |
|---|---|
| `api/package.json` | Vitest + script `test` |
| `api/src/index.ts:117` | Registrar `app.use('/contas', requireAuth, contaRoutes)` |
| `api/src/jobs/index.ts` | Agendar a tarefa das 07:00 |
| navegação do site (o mesmo arquivo que hoje lista Financeiro/Estoque) | Link para `/contas` |

---

### Task 1: Ferramenta de teste + contas de calendário

Entrega: `npm test` funcionando na API e as contas de calendário provadas — inclusive o dia 31 em fevereiro, que é onde esse tipo de código costuma quebrar.

**Files:**
- Modify: `api/package.json`
- Create: `api/src/services/contas/datas.ts`
- Test: `api/src/services/contas/datas.test.ts`

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces:
  - `type AnoMes = { ano: number; mes: number }` (`mes` de 1 a 12)
  - `ultimoDiaDoMes(ano: number, mes: number): number`
  - `dataISO(ano: number, mes: number, dia: number): string`
  - `competenciaDoMes(ano: number, mes: number): string`
  - `vencimentoDoMes(ano: number, mes: number, diaDesejado: number): string`
  - `somarMeses(base: AnoMes, n: number): AnoMes`
  - `diasEntre(aISO: string, bISO: string): number`

- [ ] **Step 1: Instalar o Vitest**

```bash
cd api && npm install -D vitest@^3.2.4
```

- [ ] **Step 2: Adicionar o script de teste**

Em `api/package.json`, dentro de `"scripts"`, junto de `dev`/`build`/`start`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Escrever o teste que falha**

Criar `api/src/services/contas/datas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ultimoDiaDoMes, dataISO, competenciaDoMes,
  vencimentoDoMes, somarMeses, diasEntre,
} from './datas'

describe('ultimoDiaDoMes', () => {
  it('fevereiro comum tem 28', () => {
    expect(ultimoDiaDoMes(2026, 2)).toBe(28)
  })
  it('fevereiro bissexto tem 29', () => {
    expect(ultimoDiaDoMes(2028, 2)).toBe(29)
  })
  it('abril tem 30 e julho tem 31', () => {
    expect(ultimoDiaDoMes(2026, 4)).toBe(30)
    expect(ultimoDiaDoMes(2026, 7)).toBe(31)
  })
})

describe('dataISO', () => {
  it('preenche mes e dia com zero a esquerda', () => {
    expect(dataISO(2026, 7, 5)).toBe('2026-07-05')
  })
})

describe('competenciaDoMes', () => {
  it('e sempre o primeiro dia do mes', () => {
    expect(competenciaDoMes(2026, 7)).toBe('2026-07-01')
  })
})

describe('vencimentoDoMes', () => {
  it('usa o dia pedido quando ele existe', () => {
    expect(vencimentoDoMes(2026, 7, 10)).toBe('2026-07-10')
  })
  it('dia 31 em fevereiro cai no ultimo dia do mes', () => {
    expect(vencimentoDoMes(2026, 2, 31)).toBe('2026-02-28')
  })
  it('dia 31 em abril cai no dia 30', () => {
    expect(vencimentoDoMes(2026, 4, 31)).toBe('2026-04-30')
  })
})

describe('somarMeses', () => {
  it('atravessa a virada de ano', () => {
    expect(somarMeses({ ano: 2026, mes: 12 }, 1)).toEqual({ ano: 2027, mes: 1 })
  })
  it('soma dentro do mesmo ano', () => {
    expect(somarMeses({ ano: 2026, mes: 3 }, 6)).toEqual({ ano: 2026, mes: 9 })
  })
})

describe('diasEntre', () => {
  it('conta dias para frente', () => {
    expect(diasEntre('2026-07-29', '2026-08-01')).toBe(3)
  })
  it('devolve negativo quando a segunda data ja passou', () => {
    expect(diasEntre('2026-07-29', '2026-07-25')).toBe(-4)
  })
  it('nao escorrega no horario de verao', () => {
    expect(diasEntre('2026-10-01', '2026-11-01')).toBe(31)
  })
})
```

- [ ] **Step 4: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — `Failed to resolve import "./datas"`

- [ ] **Step 5: Escrever a implementação mínima**

Criar `api/src/services/contas/datas.ts`:

```ts
// Contas de calendário do módulo de contas a pagar.
// REGRA: data aqui é sempre texto 'YYYY-MM-DD'. Nunca use new Date('2026-07-01')
// — esse formato é lido como UTC e volta 1 dia atrás no fuso do Brasil.

export type AnoMes = { ano: number; mes: number }   // mes de 1 a 12

// Dia 0 do mês seguinte é o último dia do mês pedido.
export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate()
}

export function dataISO(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

export function competenciaDoMes(ano: number, mes: number): string {
  return dataISO(ano, mes, 1)
}

// Dia que não existe no mês (31 em fevereiro) cai no último dia do mês.
export function vencimentoDoMes(ano: number, mes: number, diaDesejado: number): string {
  return dataISO(ano, mes, Math.min(diaDesejado, ultimoDiaDoMes(ano, mes)))
}

export function somarMeses(base: AnoMes, n: number): AnoMes {
  const total = base.ano * 12 + (base.mes - 1) + n
  return { ano: Math.floor(total / 12), mes: (total % 12) + 1 }
}

// Diferença em dias entre duas datas 'YYYY-MM-DD'.
// Usa Date.UTC nos DOIS lados: sem fuso, sem horário de verão, sem escorregão.
export function diasEntre(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number)
  const [by, bm, bd] = bISO.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — todos os testes de `datas.test.ts` verdes

- [ ] **Step 7: Commit**

```bash
git add api/package.json api/package-lock.json api/src/services/contas/datas.ts api/src/services/contas/datas.test.ts
git commit -m "test: vitest na API + contas de calendario do modulo de contas a pagar"
```

---

### Task 2: Quais ocorrências deveriam existir

Entrega: dada uma regra recorrente e uma janela de tempo, a lista exata de ocorrências que deveriam existir — e, cruzando com o que já está no banco, quais faltam. Puro, sem banco.

**Files:**
- Create: `api/src/services/contas/ocorrencias.ts`
- Test: `api/src/services/contas/ocorrencias.test.ts`

**Interfaces:**
- Consumes: de `./datas` — `AnoMes`, `competenciaDoMes`, `vencimentoDoMes`
- Produces:
  - `type Periodicidade = 'mensal' | 'bimestral' | 'trimestral' | 'semestral' | 'anual'`
  - `type Regra = { id: string; periodicidade: Periodicidade; dia_vencimento: number; mes_primeira: number | null; ativa: boolean }`
  - `type Ocorrencia = { recorrente_id: string; competencia: string; vencimento: string }`
  - `ocorrenciasEsperadas(regra: Regra, de: AnoMes, ate: AnoMes): Ocorrencia[]`
  - `ocorrenciasFaltantes(esperadas: Ocorrencia[], existentes: Array<{ recorrente_id: string; competencia: string }>): Ocorrencia[]`

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/contas/ocorrencias.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ocorrenciasEsperadas, ocorrenciasFaltantes, type Regra } from './ocorrencias'

const base: Regra = {
  id: 'r1', periodicidade: 'mensal', dia_vencimento: 10,
  mes_primeira: null, ativa: true,
}

describe('ocorrenciasEsperadas', () => {
  it('mensal gera uma por mes da janela', () => {
    const r = ocorrenciasEsperadas(base, { ano: 2026, mes: 7 }, { ano: 2026, mes: 9 })
    expect(r.map(o => o.competencia)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(r[0].vencimento).toBe('2026-07-10')
    expect(r[0].recorrente_id).toBe('r1')
  })

  it('regra inativa nao gera nada', () => {
    const r = ocorrenciasEsperadas({ ...base, ativa: false }, { ano: 2026, mes: 7 }, { ano: 2026, mes: 9 })
    expect(r).toEqual([])
  })

  it('semestral com mes_primeira 3 cai em marco e setembro, e em mais nenhum', () => {
    const regra: Regra = { ...base, periodicidade: 'semestral', mes_primeira: 3 }
    const r = ocorrenciasEsperadas(regra, { ano: 2026, mes: 1 }, { ano: 2026, mes: 12 })
    expect(r.map(o => o.competencia)).toEqual(['2026-03-01', '2026-09-01'])
  })

  it('anual so cai no mes da primeira', () => {
    const regra: Regra = { ...base, periodicidade: 'anual', mes_primeira: 5 }
    const r = ocorrenciasEsperadas(regra, { ano: 2026, mes: 1 }, { ano: 2027, mes: 12 })
    expect(r.map(o => o.competencia)).toEqual(['2026-05-01', '2027-05-01'])
  })

  it('trimestral com mes_primeira 2 cai de 3 em 3 meses', () => {
    const regra: Regra = { ...base, periodicidade: 'trimestral', mes_primeira: 2 }
    const r = ocorrenciasEsperadas(regra, { ano: 2026, mes: 1 }, { ano: 2026, mes: 12 })
    expect(r.map(o => o.competencia)).toEqual(['2026-02-01', '2026-05-01', '2026-08-01', '2026-11-01'])
  })

  it('aplica o dia 31 ao ultimo dia de fevereiro', () => {
    const regra: Regra = { ...base, dia_vencimento: 31 }
    const r = ocorrenciasEsperadas(regra, { ano: 2026, mes: 2 }, { ano: 2026, mes: 2 })
    expect(r[0].vencimento).toBe('2026-02-28')
  })

  it('atravessa a virada de ano', () => {
    const r = ocorrenciasEsperadas(base, { ano: 2026, mes: 12 }, { ano: 2027, mes: 1 })
    expect(r.map(o => o.competencia)).toEqual(['2026-12-01', '2027-01-01'])
  })
})

describe('ocorrenciasFaltantes', () => {
  it('tira as que ja existem no banco', () => {
    const esperadas = ocorrenciasEsperadas(base, { ano: 2026, mes: 7 }, { ano: 2026, mes: 9 })
    const faltam = ocorrenciasFaltantes(esperadas, [
      { recorrente_id: 'r1', competencia: '2026-08-01' },
    ])
    expect(faltam.map(o => o.competencia)).toEqual(['2026-07-01', '2026-09-01'])
  })

  it('nao confunde competencia igual de regras diferentes', () => {
    const esperadas = ocorrenciasEsperadas(base, { ano: 2026, mes: 7 }, { ano: 2026, mes: 7 })
    const faltam = ocorrenciasFaltantes(esperadas, [
      { recorrente_id: 'OUTRA', competencia: '2026-07-01' },
    ])
    expect(faltam).toHaveLength(1)
  })

  it('devolve vazio quando tudo ja existe', () => {
    const esperadas = ocorrenciasEsperadas(base, { ano: 2026, mes: 7 }, { ano: 2026, mes: 7 })
    expect(ocorrenciasFaltantes(esperadas, esperadas)).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — `Failed to resolve import "./ocorrencias"`

- [ ] **Step 3: Escrever a implementação mínima**

Criar `api/src/services/contas/ocorrencias.ts`:

```ts
import { type AnoMes, competenciaDoMes, vencimentoDoMes } from './datas'

export type Periodicidade = 'mensal' | 'bimestral' | 'trimestral' | 'semestral' | 'anual'

// Todos os intervalos dividem 12 — por isso a âncora de mês é estável ano após ano.
const INTERVALO_MESES: Record<Periodicidade, number> = {
  mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
}

export type Regra = {
  id:             string
  periodicidade:  Periodicidade
  dia_vencimento: number
  mes_primeira:   number | null   // 1..12; só vale quando não é mensal
  ativa:          boolean
}

export type Ocorrencia = {
  recorrente_id: string
  competencia:   string   // 'YYYY-MM-01'
  vencimento:    string   // 'YYYY-MM-DD'
}

export function ocorrenciasEsperadas(regra: Regra, de: AnoMes, ate: AnoMes): Ocorrencia[] {
  if (!regra.ativa) return []

  const intervalo = INTERVALO_MESES[regra.periodicidade]
  if (!intervalo) return []

  // Mês âncora (0..11). Mensal cai em todo mês, então a âncora não importa.
  const ancora = intervalo === 1 ? 0 : (regra.mes_primeira ?? 1) - 1

  const inicio = de.ano * 12 + (de.mes - 1)
  const fim    = ate.ano * 12 + (ate.mes - 1)

  const out: Ocorrencia[] = []
  for (let i = inicio; i <= fim; i++) {
    const mesIndex = ((i % 12) + 12) % 12
    if ((((mesIndex - ancora) % intervalo) + intervalo) % intervalo !== 0) continue

    const ano = Math.floor(i / 12)
    const mes = mesIndex + 1
    out.push({
      recorrente_id: regra.id,
      competencia:   competenciaDoMes(ano, mes),
      vencimento:    vencimentoDoMes(ano, mes, regra.dia_vencimento),
    })
  }
  return out
}

export function ocorrenciasFaltantes(
  esperadas: Ocorrencia[],
  existentes: Array<{ recorrente_id: string; competencia: string }>,
): Ocorrencia[] {
  const chave = (r: string, c: string) => `${r}|${c}`
  const jaTem = new Set(existentes.map(e => chave(e.recorrente_id, e.competencia)))
  return esperadas.filter(o => !jaTem.has(chave(o.recorrente_id, o.competencia)))
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — os novos verdes e os da Task 1 continuam verdes

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/ocorrencias.ts api/src/services/contas/ocorrencias.test.ts
git commit -m "feat: gerar ocorrencias esperadas de conta recorrente (puro, sem banco)"
```

---

### Task 3: As tabelas no banco

Entrega: o arquivo de migração pronto para colar no editor de SQL do Supabase, com as duas tabelas, os índices, as permissões e as consultas de conferência.

**Files:**
- Create: `supabase/migrations/004_contas_a_pagar.sql`

**Interfaces:**
- Consumes: função `get_fazenda_ativa_id()`, já criada em `supabase/migrations/001_multi_fazenda.sql`
- Produces: tabelas `contas_recorrentes` e `contas_a_pagar` (colunas exatamente como o código das Tasks 4–6 espera)

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/004_contas_a_pagar.sql`:

```sql
-- ============================================================
-- AgroMouro — Contas a Pagar, Fase 1
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Spec: docs/superpowers/specs/2026-07-29-contas-a-pagar-design.md
-- ============================================================

-- 1. A REGRA que se repete ("Cemig, todo dia 10")
CREATE TABLE IF NOT EXISTS contas_recorrentes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao          TEXT NOT NULL,
  fornecedor         TEXT NOT NULL,
  categoria          TEXT NOT NULL,
  periodicidade      TEXT NOT NULL
                     CHECK (periodicidade IN ('mensal','bimestral','trimestral','semestral','anual')),
  dia_vencimento     SMALLINT NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  mes_primeira       SMALLINT CHECK (mes_primeira BETWEEN 1 AND 12),
  valor_referencia   NUMERIC(12,2),
  avisar_dias_antes  SMALLINT NOT NULL DEFAULT 3 CHECK (avisar_dias_antes BETWEEN 0 AND 30),
  ativa              BOOLEAN NOT NULL DEFAULT true,
  fazenda_id         UUID NOT NULL REFERENCES fazendas(id),
  created_at         TIMESTAMPTZ DEFAULT now(),
  -- quando não é mensal, mes_primeira é obrigatório
  CONSTRAINT mes_primeira_obrigatorio
    CHECK (periodicidade = 'mensal' OR mes_primeira IS NOT NULL)
);

-- 2. A OCORRÊNCIA concreta ("Cemig, julho/2026")
CREATE TABLE IF NOT EXISTS contas_a_pagar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorrente_id   UUID REFERENCES contas_recorrentes(id) ON DELETE SET NULL,
  competencia     DATE NOT NULL,
  descricao       TEXT NOT NULL,
  fornecedor      TEXT,
  categoria       TEXT,
  vencimento      DATE NOT NULL,
  valor           NUMERIC(12,2),
  valor_estimado  BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'aguardando'
                  CHECK (status IN ('aguardando','aberta','paga','dispensada')),
  data_pagamento  DATE,
  valor_pago      NUMERIC(12,2),
  lancamento_id   UUID REFERENCES lancamentos_financeiros(id) ON DELETE SET NULL,
  nota_fiscal_id  UUID REFERENCES notas_fiscais(id) ON DELETE SET NULL,
  observacao      TEXT,
  fazenda_id      UUID NOT NULL REFERENCES fazendas(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 3. Idempotência da tarefa diária: uma ocorrência por regra por competência.
--    É ESTE índice que impede a tarefa de duplicar conta ao rodar todo dia.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conta_recorrente_competencia
  ON contas_a_pagar (recorrente_id, competencia)
  WHERE recorrente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_faz_venc   ON contas_a_pagar (fazenda_id, vencimento);
CREATE INDEX IF NOT EXISTS idx_contas_faz_status ON contas_a_pagar (fazenda_id, status);
CREATE INDEX IF NOT EXISTS idx_recorrentes_faz   ON contas_recorrentes (fazenda_id, ativa);

-- 4. Permissões — FOR ALL cobre ler, inserir, alterar e apagar.
--    Só de SELECT faria a escrita do site falhar em silêncio.
ALTER TABLE contas_recorrentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contas_recorrentes_tenant" ON contas_recorrentes
  FOR ALL
  USING      (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());

ALTER TABLE contas_a_pagar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contas_a_pagar_tenant" ON contas_a_pagar
  FOR ALL
  USING      (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
```

- [ ] **Step 2: Rodar a migração no Supabase**

Abrir o painel do Supabase → **SQL Editor** → colar o arquivo inteiro → **Run**.

- [ ] **Step 3: Conferir que subiu do jeito certo**

Rodar no mesmo editor. **Todas as três consultas precisam devolver linha:**

```sql
-- (a) as duas tabelas existem
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('contas_recorrentes','contas_a_pagar');

-- (b) as permissões são FOR ALL (cmd = 'ALL'), não só SELECT
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('contas_recorrentes','contas_a_pagar');

-- (c) o índice único da idempotência existe
SELECT indexname FROM pg_indexes
WHERE indexname = 'idx_conta_recorrente_competencia';
```

Expected: (a) 2 linhas · (b) 2 linhas, ambas com `cmd = ALL` · (c) 1 linha.
Se (b) devolver `SELECT` em vez de `ALL`, **pare** — a escrita vai falhar calada.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/004_contas_a_pagar.sql
git commit -m "feat: tabelas contas_recorrentes e contas_a_pagar com RLS FOR ALL"
```

---

### Task 4: Sincronizar as ocorrências com o banco

Entrega: a tarefa consegue olhar as regras de uma fazenda e criar no banco as ocorrências que faltam, sem nunca duplicar.

**Files:**
- Create: `api/src/services/contas/estimativa.ts`
- Test: `api/src/services/contas/estimativa.test.ts`
- Create: `api/src/services/contas/sincronizar.ts`

**Interfaces:**
- Consumes: de `./ocorrencias` — `ocorrenciasEsperadas`, `ocorrenciasFaltantes`, `Regra`; de `./datas` — `somarMeses`; de `../supabase` — `supabase`
- Produces:
  - `estimativaDaOcorrencia(ultimoValorPago: number | null, valorReferencia: number | null): number | null`
  - `sincronizarOcorrencias(fazendaId: string, hojeISO: string): Promise<number>` (devolve quantas criou)

- [ ] **Step 1: Escrever o teste que falha (regra da estimativa)**

Criar `api/src/services/contas/estimativa.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { estimativaDaOcorrencia } from './estimativa'

describe('estimativaDaOcorrencia', () => {
  it('a segunda ocorrencia herda o ultimo valor PAGO, nao o do cadastro', () => {
    expect(estimativaDaOcorrencia(912.35, 800)).toBe(912.35)
  })

  it('sem pagamento anterior, usa o valor de referencia do cadastro', () => {
    expect(estimativaDaOcorrencia(null, 800)).toBe(800)
  })

  it('sem pagamento e sem referencia, fica sem valor', () => {
    expect(estimativaDaOcorrencia(null, null)).toBeNull()
  })

  it('valor pago zero e um valor valido, nao e ausencia', () => {
    expect(estimativaDaOcorrencia(0, 800)).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — `Failed to resolve import "./estimativa"`

- [ ] **Step 3: Escrever a implementação mínima**

Criar `api/src/services/contas/estimativa.ts`:

```ts
// Com que valor nasce a próxima ocorrência de uma conta recorrente.
// Sempre uma ESTIMATIVA — quem grava marca valor_estimado = true.
//
// Cuidado: usar ?? e não ||. Com ||, um valor pago de R$ 0,00 seria
// descartado como se fosse ausência de valor.
export function estimativaDaOcorrencia(
  ultimoValorPago: number | null,
  valorReferencia: number | null,
): number | null {
  return ultimoValorPago ?? valorReferencia ?? null
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — os novos verdes e os anteriores continuam verdes

- [ ] **Step 5: Escrever a camada que fala com o banco**

Criar `api/src/services/contas/sincronizar.ts`:

```ts
import { supabase } from '../supabase'
import { somarMeses } from './datas'
import { ocorrenciasEsperadas, ocorrenciasFaltantes, type Regra } from './ocorrencias'
import { estimativaDaOcorrencia } from './estimativa'

// Janela de antecipação: cria as ocorrências dos próximos ~45 dias (2 meses).
const MESES_A_FRENTE = 2

// Cria no banco as ocorrências que deveriam existir e ainda não existem.
// Idempotente: rodar duas vezes no mesmo dia não duplica (índice único no banco).
export async function sincronizarOcorrencias(fazendaId: string, hojeISO: string): Promise<number> {
  const [ano, mes] = hojeISO.split('-').map(Number)
  const de  = { ano, mes }
  const ate = somarMeses(de, MESES_A_FRENTE)

  const { data: regras, error: erroRegras } = await supabase
    .from('contas_recorrentes')
    .select('id, descricao, fornecedor, categoria, periodicidade, dia_vencimento, mes_primeira, valor_referencia, ativa')
    .eq('fazenda_id', fazendaId)
    .eq('ativa', true)

  if (erroRegras) throw erroRegras
  if (!regras?.length) return 0

  const { data: existentes, error: erroExistentes } = await supabase
    .from('contas_a_pagar')
    .select('recorrente_id, competencia')
    .eq('fazenda_id', fazendaId)
    .not('recorrente_id', 'is', null)

  if (erroExistentes) throw erroExistentes

  const novas: any[] = []

  for (const regra of regras) {
    const esperadas = ocorrenciasEsperadas(regra as unknown as Regra, de, ate)
    const faltam    = ocorrenciasFaltantes(esperadas, existentes ?? [])
    if (!faltam.length) continue

    // Valor da estimativa: o último valor realmente pago dessa regra.
    // Se nunca foi paga, cai no valor de referência do cadastro.
    const { data: ultimaPaga } = await supabase
      .from('contas_a_pagar')
      .select('valor_pago')
      .eq('recorrente_id', regra.id)
      .eq('status', 'paga')
      .order('competencia', { ascending: false })
      .limit(1)
      .maybeSingle()

    const estimativa = estimativaDaOcorrencia(
      ultimaPaga?.valor_pago ?? null,
      regra.valor_referencia ?? null,
    )

    for (const o of faltam) {
      novas.push({
        recorrente_id:  o.recorrente_id,
        competencia:    o.competencia,
        vencimento:     o.vencimento,
        descricao:      regra.descricao,
        fornecedor:     regra.fornecedor,
        categoria:      regra.categoria,
        valor:          estimativa,
        valor_estimado: true,
        status:         'aguardando',
        fazenda_id:     fazendaId,
      })
    }
  }

  if (!novas.length) return 0

  // ignoreDuplicates: se duas execuções cruzarem, o índice único resolve sem estourar erro.
  const { data, error } = await supabase
    .from('contas_a_pagar')
    .upsert(novas, { onConflict: 'recorrente_id,competencia', ignoreDuplicates: true })
    .select('id')

  if (error) throw error
  return data?.length ?? 0
}
```

- [ ] **Step 6: Conferir que o TypeScript compila**

Run: `cd api && npx tsc --noEmit`
Expected: sem erro

- [ ] **Step 7: Rodar a bateria de testes**

Run: `cd api && npm test`
Expected: PASS — todos verdes

- [ ] **Step 8: Commit**

```bash
git add api/src/services/contas/estimativa.ts api/src/services/contas/estimativa.test.ts api/src/services/contas/sincronizar.ts
git commit -m "feat: sincronizar ocorrencias de contas recorrentes com o banco"
```

---

### Task 5: O que entra no aviso do dia

Entrega: as três regras de aviso (atrasada, vencendo, não chegou) provadas por teste, e o texto agrupado da mensagem. Puro, sem banco.

**Files:**
- Create: `api/src/services/contas/resumo.ts`
- Test: `api/src/services/contas/resumo.test.ts`

**Interfaces:**
- Consumes: de `./datas` — `diasEntre`
- Produces:
  - `type ContaResumo = { descricao: string; fornecedor: string | null; vencimento: string; valor: number | null; status: string; avisar_dias_antes: number }`
  - `type Resumo = { atrasadas: ContaResumo[]; vencendo: ContaResumo[]; naoChegaram: ContaResumo[] }`
  - `montarResumo(contas: ContaResumo[], hojeISO: string): Resumo`
  - `resumoVazio(r: Resumo): boolean`
  - `textoResumo(r: Resumo, hojeISO: string): string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/contas/resumo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { montarResumo, resumoVazio, textoResumo, type ContaResumo } from './resumo'

const HOJE = '2026-07-29'

function conta(over: Partial<ContaResumo> = {}): ContaResumo {
  return {
    descricao: 'Energia', fornecedor: 'Cemig', vencimento: '2026-08-10',
    valor: 890, status: 'aberta', avisar_dias_antes: 3, ...over,
  }
}

describe('montarResumo', () => {
  it('conta vencida e nao paga entra como atrasada', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-25' })], HOJE)
    expect(r.atrasadas).toHaveLength(1)
    expect(r.vencendo).toHaveLength(0)
  })

  it('conta aberta dentro do prazo de aviso entra como vencendo', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-31' })], HOJE)
    expect(r.vencendo).toHaveLength(1)
  })

  it('conta aberta ainda longe do vencimento nao entra', () => {
    const r = montarResumo([conta({ vencimento: '2026-08-20' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('conta aguardando perto do vencimento entra como nao chegou', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-31', status: 'aguardando' })], HOJE)
    expect(r.naoChegaram).toHaveLength(1)
    expect(r.vencendo).toHaveLength(0)
  })

  it('conta paga nunca entra em aviso, nem vencida', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-01', status: 'paga' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('conta dispensada nunca entra em aviso, nem vencida', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-01', status: 'dispensada' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('respeita o prazo de aviso configurado em cada conta', () => {
    const r = montarResumo([conta({ vencimento: '2026-08-05', avisar_dias_antes: 10 })], HOJE)
    expect(r.vencendo).toHaveLength(1)
  })

  it('vencendo hoje ainda conta como vencendo, nao como atrasada', () => {
    const r = montarResumo([conta({ vencimento: HOJE })], HOJE)
    expect(r.vencendo).toHaveLength(1)
    expect(r.atrasadas).toHaveLength(0)
  })
})

describe('textoResumo', () => {
  it('descreve as tres situacoes na mensagem', () => {
    const r = montarResumo([
      conta({ descricao: 'Agua',    vencimento: '2026-07-25', valor: 340 }),
      conta({ descricao: 'Energia', vencimento: '2026-07-31', valor: 890 }),
      conta({ descricao: 'Telefone', vencimento: '2026-07-30', status: 'aguardando', valor: 120 }),
    ], HOJE)
    const txt = textoResumo(r, HOJE)
    expect(txt).toContain('atrasada')
    expect(txt).toContain('Agua')
    expect(txt).toContain('Energia')
    expect(txt).toContain('Telefone')
    expect(txt).toContain('ainda não chegou')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — `Failed to resolve import "./resumo"`

- [ ] **Step 3: Escrever a implementação mínima**

Criar `api/src/services/contas/resumo.ts`:

```ts
import { diasEntre } from './datas'

export type ContaResumo = {
  descricao:         string
  fornecedor:        string | null
  vencimento:        string
  valor:             number | null
  status:            string
  avisar_dias_antes: number
}

export type Resumo = {
  atrasadas:   ContaResumo[]
  vencendo:    ContaResumo[]
  naoChegaram: ContaResumo[]
}

const ENCERRADAS = new Set(['paga', 'dispensada'])

export function montarResumo(contas: ContaResumo[], hojeISO: string): Resumo {
  const r: Resumo = { atrasadas: [], vencendo: [], naoChegaram: [] }

  for (const c of contas) {
    if (ENCERRADAS.has(c.status)) continue

    const dias = diasEntre(hojeISO, c.vencimento)

    if (dias < 0) { r.atrasadas.push(c); continue }
    if (dias > c.avisar_dias_antes) continue

    if (c.status === 'aguardando') r.naoChegaram.push(c)
    else                           r.vencendo.push(c)
  }
  return r
}

export function resumoVazio(r: Resumo): boolean {
  return r.atrasadas.length === 0 && r.vencendo.length === 0 && r.naoChegaram.length === 0
}

function reais(v: number | null): string {
  return v == null ? 'valor a definir' : `R$ ${v.toFixed(2).replace('.', ',')}`
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function textoResumo(r: Resumo, hojeISO: string): string {
  const linhas: string[] = [`📋 *Contas — ${ddmm(hojeISO)}*`]

  if (r.atrasadas.length) {
    linhas.push(`\n🔴 ${r.atrasadas.length} atrasada${r.atrasadas.length > 1 ? 's' : ''}:`)
    for (const c of r.atrasadas) linhas.push(`• ${c.descricao} — venceu ${ddmm(c.vencimento)}, ${reais(c.valor)}`)
  }
  if (r.vencendo.length) {
    linhas.push(`\n🟡 ${r.vencendo.length} vencendo:`)
    for (const c of r.vencendo) linhas.push(`• ${c.descricao} — dia ${ddmm(c.vencimento)}, ${reais(c.valor)}`)
  }
  if (r.naoChegaram.length) {
    linhas.push(`\n⏳ ${r.naoChegaram.length} ainda não chegou:`)
    for (const c of r.naoChegaram) linhas.push(`• ${c.descricao} — esperada dia ${ddmm(c.vencimento)}`)
  }
  return linhas.join('\n')
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — os novos verdes e os anteriores continuam verdes

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/resumo.ts api/src/services/contas/resumo.test.ts
git commit -m "feat: regras do aviso diario de contas (atrasada, vencendo, nao chegou)"
```

---

### Task 6: A tarefa diária das 07:00

Entrega: uma vez por dia o sistema garante que as contas do mês existem, monta o resumo e grava **um** alerta agrupado — mandando no WhatsApp quando der, mas nunca dependendo disso.

**Files:**
- Create: `api/src/jobs/contas.ts`
- Modify: `api/src/jobs/index.ts`

**Interfaces:**
- Consumes: `sincronizarOcorrencias` (Task 4); `montarResumo`, `resumoVazio`, `textoResumo` (Task 5); `enviarMensagem(phone, message, fazendaCodigo)` e `getAuthorizedPhones(fazendaCodigo)` de `../services/zapi`; `supabase` de `../services/supabase`
- Produces: `rodarContasDoDia(): Promise<void>`

- [ ] **Step 1: Escrever a tarefa**

Criar `api/src/jobs/contas.ts`:

```ts
import { supabase } from '../services/supabase'
import { enviarMensagem, getAuthorizedPhones } from '../services/zapi'
import { sincronizarOcorrencias } from '../services/contas/sincronizar'
import { montarResumo, resumoVazio, textoResumo, type ContaResumo } from '../services/contas/resumo'

// Data de hoje como 'YYYY-MM-DD' no fuso de São Paulo.
// NÃO usar toISOString(): ele devolve UTC e vira o dia seguinte depois das 21h.
function hojeSaoPauloISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export async function rodarContasDoDia(): Promise<void> {
  const hoje = hojeSaoPauloISO()

  const { data: fazendas, error } = await supabase.from('fazendas').select('id, nome, codigo')
  if (error) { console.error('[Contas] Erro ao listar fazendas:', error.message); return }

  for (const fazenda of fazendas ?? []) {
    try {
      const criadas = await sincronizarOcorrencias(fazenda.id, hoje)
      if (criadas > 0) console.log(`[Contas] ${fazenda.nome}: ${criadas} ocorrência(s) criada(s).`)

      const { data: contas } = await supabase
        .from('contas_a_pagar')
        .select('descricao, fornecedor, vencimento, valor, status, contas_recorrentes(avisar_dias_antes)')
        .eq('fazenda_id', fazenda.id)
        .in('status', ['aguardando', 'aberta'])

      const paraResumo: ContaResumo[] = (contas ?? []).map((c: any) => ({
        descricao:         c.descricao,
        fornecedor:        c.fornecedor,
        vencimento:        c.vencimento,
        valor:             c.valor,
        status:            c.status,
        avisar_dias_antes: c.contas_recorrentes?.avisar_dias_antes ?? 3,
      }))

      const resumo = montarResumo(paraResumo, hoje)
      if (resumoVazio(resumo)) {
        console.log(`[Contas] ${fazenda.nome}: nada a avisar hoje.`)
        continue
      }

      const titulo = `Contas — ${hoje}`

      // Um alerta por fazenda por dia. Se a tarefa rodar de novo, não duplica.
      const { data: existente } = await supabase
        .from('alertas')
        .select('id')
        .eq('fazenda_id', fazenda.id)
        .eq('titulo', titulo)
        .maybeSingle()

      if (existente) { console.log(`[Contas] ${fazenda.nome}: aviso de hoje já existe.`); continue }

      const mensagem = textoResumo(resumo, hoje)
      const nivel    = resumo.atrasadas.length > 0 ? 'critico' : 'aviso'

      // O alerta é gravado SEMPRE. O WhatsApp é o extra — se a instância Z-API
      // estiver desconectada, o envio falha calado e a informação não pode sumir junto.
      const { data: alerta, error: erroAlerta } = await supabase
        .from('alertas')
        .insert({
          tipo: 'contas_resumo', titulo, mensagem, nivel,
          lido: false, enviado_whatsapp: false, fazenda_id: fazenda.id,
        })
        .select('id')
        .single()

      if (erroAlerta) { console.error(`[Contas] ${fazenda.nome}: erro ao gravar alerta:`, erroAlerta.message); continue }

      const telefones = getAuthorizedPhones(fazenda.codigo)
      let enviou = false
      for (const phone of telefones) {
        try {
          await enviarMensagem(phone, mensagem, fazenda.codigo)
          enviou = true
        } catch (err) {
          console.error(`[Contas] Falha ao enviar para ${phone}:`, err instanceof Error ? err.message : err)
        }
      }

      if (enviou) {
        await supabase.from('alertas').update({ enviado_whatsapp: true }).eq('id', alerta.id)
      }
    } catch (err) {
      console.error(`[Contas] Erro em ${fazenda.nome}:`, err instanceof Error ? err.message : err)
      // segue para a próxima fazenda
    }
  }
}
```

- [ ] **Step 2: Agendar às 07:00**

Em `api/src/jobs/index.ts`, adicionar o import junto dos outros:

```ts
import { rodarContasDoDia } from './contas'
```

E o agendamento, depois do bloco das cotações (06:30):

```ts
  // 07:00 — contas a pagar: cria as ocorrências do mês e monta o aviso do dia.
  // Roda TODO DIA (não no dia 1º): se o servidor reiniciar num dia 1º, uma tarefa
  // mensal perderia o mês inteiro em silêncio. Diária, ela se conserta sozinha.
  cron.schedule('0 7 * * *', async () => {
    console.log('[Jobs] Contas a pagar do dia...')
    await rodarContasDoDia()
  }, { timezone: 'America/Sao_Paulo' })
```

E atualizar a linha final de log:

```ts
  console.log('[Jobs] Jobs agendados: clima (06:00), cotações (06:30), contas (07:00), NF-e e-mail (30min)')
```

- [ ] **Step 3: Conferir que compila e que os testes seguem verdes**

Run: `cd api && npx tsc --noEmit && npm test`
Expected: sem erro de tipo; 33 testes verdes

- [ ] **Step 4: Commit**

```bash
git add api/src/jobs/contas.ts api/src/jobs/index.ts
git commit -m "feat: tarefa diaria de contas a pagar as 07:00 com aviso agrupado"
```

---

### Task 7: A regra do "pago" (anti-duplicidade)

Entrega: a decisão de criar ou não um lançamento no Financeiro, isolada numa função pura e provada por teste — é a regra que impede dinheiro contado duas vezes.

**Files:**
- Create: `api/src/services/contas/pagamento.ts`
- Test: `api/src/services/contas/pagamento.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `precisaCriarLancamento(conta: { nota_fiscal_id: string | null }): boolean`
  - `type DadosLancamento = { data: string; descricao: string; valor: number; tipo: 'despesa'; categoria: string | null; fazenda_id: string }`
  - `montarLancamento(conta: { descricao: string; fornecedor: string | null; categoria: string | null; fazenda_id: string }, dataPagamento: string, valorPago: number): DadosLancamento`

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/contas/pagamento.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { precisaCriarLancamento, montarLancamento } from './pagamento'

describe('precisaCriarLancamento', () => {
  it('conta sem nota fiscal precisa gerar lancamento', () => {
    expect(precisaCriarLancamento({ nota_fiscal_id: null })).toBe(true)
  })
  it('conta vinda de nota fiscal NAO gera lancamento (ja existe desde a NF-e)', () => {
    expect(precisaCriarLancamento({ nota_fiscal_id: 'abc-123' })).toBe(false)
  })
})

describe('montarLancamento', () => {
  const conta = {
    descricao: 'Energia', fornecedor: 'Cemig',
    categoria: 'energia', fazenda_id: 'faz-1',
  }

  it('usa a data e o valor REALMENTE pagos, nao os previstos', () => {
    const l = montarLancamento(conta, '2026-08-11', 912.35)
    expect(l.data).toBe('2026-08-11')
    expect(l.valor).toBe(912.35)
  })

  it('e sempre despesa', () => {
    expect(montarLancamento(conta, '2026-08-11', 100).tipo).toBe('despesa')
  })

  it('descricao junta fornecedor e descricao', () => {
    expect(montarLancamento(conta, '2026-08-11', 100).descricao).toBe('Cemig — Energia')
  })

  it('sem fornecedor usa so a descricao', () => {
    const l = montarLancamento({ ...conta, fornecedor: null }, '2026-08-11', 100)
    expect(l.descricao).toBe('Energia')
  })

  it('carrega a categoria e a fazenda da conta', () => {
    const l = montarLancamento(conta, '2026-08-11', 100)
    expect(l.categoria).toBe('energia')
    expect(l.fazenda_id).toBe('faz-1')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — `Failed to resolve import "./pagamento"`

- [ ] **Step 3: Escrever a implementação mínima**

Criar `api/src/services/contas/pagamento.ts`:

```ts
// A regra que impede dinheiro contado duas vezes.
//
// Conta vinda de NF-e já tem lançamento no Financeiro desde que a nota entrou
// (nfeProcessor.ts cria um). Marcar como paga só carimba data e valor.
// Conta cadastrada à mão não tem lançamento nenhum — sem criar um aqui, a conta
// de luz nunca apareceria no gasto.

export function precisaCriarLancamento(conta: { nota_fiscal_id: string | null }): boolean {
  return conta.nota_fiscal_id === null
}

export type DadosLancamento = {
  data:       string
  descricao:  string
  valor:      number
  tipo:       'despesa'
  categoria:  string | null
  fazenda_id: string
}

export function montarLancamento(
  conta: { descricao: string; fornecedor: string | null; categoria: string | null; fazenda_id: string },
  dataPagamento: string,
  valorPago: number,
): DadosLancamento {
  return {
    data:       dataPagamento,
    descricao:  conta.fornecedor ? `${conta.fornecedor} — ${conta.descricao}` : conta.descricao,
    valor:      valorPago,
    tipo:       'despesa',
    categoria:  conta.categoria,
    fazenda_id: conta.fazenda_id,
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — os novos verdes e os anteriores continuam verdes

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/pagamento.ts api/src/services/contas/pagamento.test.ts
git commit -m "feat: regra anti-duplicidade ao marcar conta como paga"
```

---

### Task 8: As rotas da API

Entrega: o site consegue listar, cadastrar, editar, pagar, desfazer pagamento e dispensar contas — tudo isolado por fazenda.

**Files:**
- Create: `api/src/routes/contas.ts`
- Modify: `api/src/index.ts` (import junto dos outros e `app.use` na linha 117)

**Interfaces:**
- Consumes: `precisaCriarLancamento`, `montarLancamento` (Task 7); `sincronizarOcorrencias` (Task 4); `supabase`
- Produces: `export const contaRoutes: Router`

Rotas:

| Método e caminho | O que faz |
|---|---|
| `GET /contas` | Lista ocorrências da fazenda, ordenadas por vencimento |
| `GET /contas/recorrentes` | Lista as regras fixas |
| `POST /contas/recorrentes` | Cadastra uma regra fixa e já cria as ocorrências da janela |
| `PATCH /contas/recorrentes/:id` | Edita ou desativa a regra |
| `POST /contas` | Cadastra conta avulsa (sem recorrência) |
| `PATCH /contas/:id` | Edita valor/vencimento; registrar o valor real muda `aguardando` → `aberta` |
| `POST /contas/:id/pagar` | Marca paga, cria o lançamento quando for o caso |
| `POST /contas/:id/desfazer-pagamento` | Volta para `aberta` e apaga o lançamento criado |
| `POST /contas/:id/dispensar` | Marca `dispensada` |

- [ ] **Step 1: Escrever as rotas**

Criar `api/src/routes/contas.ts`. Siga o padrão de `api/src/routes/cartoes.ts`: `req.user?.app_metadata?.fazenda_ativa_id`, Zod, `next(err)`.

```ts
import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../services/supabase'
import { sincronizarOcorrencias } from '../services/contas/sincronizar'
import { precisaCriarLancamento, montarLancamento } from '../services/contas/pagamento'

export const contaRoutes = Router()

const ISO = /^\d{4}-\d{2}-\d{2}$/

const recorrenteSchema = z.object({
  descricao:         z.string().min(1),
  fornecedor:        z.string().min(1),
  categoria:         z.string().min(1),
  periodicidade:     z.enum(['mensal', 'bimestral', 'trimestral', 'semestral', 'anual']),
  dia_vencimento:    z.number().int().min(1).max(31),
  mes_primeira:      z.number().int().min(1).max(12).nullable().optional(),
  valor_referencia:  z.number().nonnegative().nullable().optional(),
  avisar_dias_antes: z.number().int().min(0).max(30).default(3),
}).refine(r => r.periodicidade === 'mensal' || r.mes_primeira != null, {
  message: 'Conta que não é mensal precisa do mês da primeira ocorrência',
  path: ['mes_primeira'],
})

const avulsaSchema = z.object({
  descricao:  z.string().min(1),
  fornecedor: z.string().nullable().optional(),
  categoria:  z.string().nullable().optional(),
  vencimento: z.string().regex(ISO),
  valor:      z.number().nonnegative(),
})

const edicaoSchema = z.object({
  valor:      z.number().nonnegative().optional(),
  vencimento: z.string().regex(ISO).optional(),
  categoria:  z.string().nullable().optional(),
  observacao: z.string().nullable().optional(),
})

const pagamentoSchema = z.object({
  data_pagamento: z.string().regex(ISO),
  valor_pago:     z.number().nonnegative(),
})

function fazendaDe(req: any): string | undefined {
  return req.user?.app_metadata?.fazenda_ativa_id as string | undefined
}

// ─── GET /contas ──────────────────────────────────────────────────────────────
contaRoutes.get('/', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .select('*, contas_recorrentes(avisar_dias_antes, periodicidade)')
      .eq('fazenda_id', fazendaId)
      .order('vencimento', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) { next(err) }
})

// ─── GET /contas/recorrentes ──────────────────────────────────────────────────
contaRoutes.get('/recorrentes', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .select('*')
      .eq('fazenda_id', fazendaId)
      .order('descricao', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) { next(err) }
})

// ─── POST /contas/recorrentes ─────────────────────────────────────────────────
contaRoutes.post('/recorrentes', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = recorrenteSchema.parse(req.body)

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .insert({ ...body, fazenda_id: fazendaId })
      .select()
      .single()

    if (error) throw error

    // Já cria as ocorrências da janela para a conta aparecer na hora,
    // sem esperar a tarefa das 07:00 do dia seguinte.
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    await sincronizarOcorrencias(fazendaId, hoje)

    res.status(201).json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── PATCH /contas/recorrentes/:id ────────────────────────────────────────────
contaRoutes.patch('/recorrentes/:id', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = recorrenteSchema.partial().parse(req.body)

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .update(body)
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta fixa não encontrada' })
    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

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

// ─── PATCH /contas/:id — registrar o valor real ───────────────────────────────
contaRoutes.patch('/:id', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = edicaoSchema.parse(req.body)

    // Informar o valor confirma a conta: deixa de ser estimativa e passa a 'aberta'.
    const patch: Record<string, unknown> = { ...body }
    if (body.valor !== undefined) {
      patch.valor_estimado = false
      patch.status = 'aberta'
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update(patch)
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /contas/:id/pagar ───────────────────────────────────────────────────
contaRoutes.post('/:id/pagar', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = pagamentoSchema.parse(req.body)

    const { data: conta, error: erroBusca } = await supabase
      .from('contas_a_pagar')
      .select('*')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (erroBusca) throw erroBusca
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' })
    if (conta.status === 'paga') return res.status(409).json({ error: 'Esta conta já está paga' })

    let lancamentoId: string | null = null

    if (precisaCriarLancamento(conta)) {
      const { data: lanc, error: erroLanc } = await supabase
        .from('lancamentos_financeiros')
        .insert(montarLancamento(conta, body.data_pagamento, body.valor_pago))
        .select('id')
        .single()

      if (erroLanc) throw erroLanc
      lancamentoId = lanc.id
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({
        status:         'paga',
        data_pagamento: body.data_pagamento,
        valor_pago:     body.valor_pago,
        lancamento_id:  lancamentoId,
      })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /contas/:id/desfazer-pagamento ──────────────────────────────────────
contaRoutes.post('/:id/desfazer-pagamento', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data: conta } = await supabase
      .from('contas_a_pagar')
      .select('id, lancamento_id')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' })

    // Só apaga o lançamento que ESTA conta criou.
    if (conta.lancamento_id) {
      await supabase.from('lancamentos_financeiros').delete().eq('id', conta.lancamento_id)
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({ status: 'aberta', data_pagamento: null, valor_pago: null, lancamento_id: null })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    res.json(data[0])
  } catch (err) { next(err) }
})

// ─── POST /contas/:id/dispensar ───────────────────────────────────────────────
contaRoutes.post('/:id/dispensar', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({ status: 'dispensada' })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) { next(err) }
})
```

- [ ] **Step 2: Registrar as rotas**

Em `api/src/index.ts`, junto dos outros imports de rota (perto da linha 11):

```ts
import { contaRoutes }    from './routes/contas'
```

E logo depois de `app.use('/cartoes', requireAuth, cartaoRoutes)` (linha 117):

```ts
app.use('/contas',    requireAuth, contaRoutes)
```

- [ ] **Step 3: Conferir compilação e testes**

Run: `cd api && npx tsc --noEmit && npm test`
Expected: sem erro de tipo; 40 testes verdes

- [ ] **Step 4: Conferir a rota de pé**

Run: `cd api && npm run dev` e, noutro terminal: `curl -i http://localhost:3001/contas`
Expected: **401** (não autorizado) — prova que a rota existe e está protegida. 404 significaria que não foi registrada.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/contas.ts api/src/index.ts
git commit -m "feat: rotas /contas (listar, cadastrar, pagar, desfazer, dispensar)"
```

---

### Task 9: A página `/contas`

Entrega: a tela onde o Matheus vê os três números, a lista e age em cada conta.

> ⚠️ **Antes de escrever qualquer linha de frontend:** `web/AGENTS.md` avisa que este Next.js **não é o que você conhece** (versão 16.2.6, React 19). Leia primeiro:
> - `web/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
> - `web/node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md`
>
> E abra `web/app/(app)/financeiro/page.tsx` para copiar o esqueleto que o projeto já usa (cliente Supabase, fazenda ativa via `web/context/fazenda-context.tsx`, componentes shadcn/ui, paleta e formatação de moeda).

**Files:**
- Create: `web/app/(app)/contas/page.tsx`
- Modify: o arquivo de navegação que hoje lista Financeiro/Estoque (achar com `grep -rn "financeiro" web/components`)

**Interfaces:**
- Consumes: as rotas da Task 8
- Produces: rota `/contas` no site

- [ ] **Step 1: Ler os dois guias do Next e a página do Financeiro**

Não pule. A versão do Next mudou convenções em relação ao que você aprendeu.

- [ ] **Step 2: Escrever a página**

Requisitos exatos:

1. **Três cartões no topo:**
   - *Vence esta semana* — mostrando **confirmado e estimado separados**: `R$ 12.400 confirmados + R$ 3.100 estimados`. **Nunca somar os dois num número só** — misturar chute com fato faz o número mentir.
   - *Atrasado* — total e quantidade de contas com `vencimento < hoje` e status fora de `paga`/`dispensada`.
   - *Aguardando* — quantidade com status `aguardando`.
2. **Lista** ordenada por vencimento, com filtro Todas / Aguardando / Abertas / Atrasadas / Pagas.
3. Cada linha: fornecedor, descrição, vencimento, valor (com etiqueta **estimado** quando `valor_estimado` for verdadeiro), categoria.
4. **Ações por linha:** registrar valor real, marcar como paga, dispensar.
5. **Conferir que salvou de verdade:** depois de todo `update`, checar `error` **e** `data.length === 0`, e mostrar mensagem ao usuário quando não persistir. Tabela com permissão errada devolve sucesso com zero linhas — o usuário acha que salvou e não salvou.
6. Formatação de moeda e de data em português brasileiro, igual ao resto do site.

O cálculo dos três números é a parte que erra calada — use exatamente este código, dentro da página:

```ts
type Conta = {
  id: string
  descricao: string
  fornecedor: string | null
  categoria: string | null
  vencimento: string          // 'YYYY-MM-DD'
  valor: number | null
  valor_estimado: boolean
  status: 'aguardando' | 'aberta' | 'paga' | 'dispensada'
}

// Hoje no fuso de São Paulo, como 'YYYY-MM-DD'.
// NÃO usar toISOString(): devolve UTC e vira o dia seguinte depois das 21h.
function hojeISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function diasEntre(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number)
  const [by, bm, bd] = bISO.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

const ENCERRADAS = new Set(['paga', 'dispensada'])

export function calcularTotais(contas: Conta[], hoje: string) {
  let semanaConfirmado = 0, semanaEstimado = 0
  let atrasadoTotal = 0, atrasadoQtd = 0, aguardandoQtd = 0

  for (const c of contas) {
    if (ENCERRADAS.has(c.status)) continue

    const dias  = diasEntre(hoje, c.vencimento)
    const valor = c.valor ?? 0

    if (dias < 0) { atrasadoTotal += valor; atrasadoQtd++; continue }

    if (c.status === 'aguardando') aguardandoQtd++

    // "esta semana" = de hoje até 7 dias à frente
    if (dias <= 7) {
      // NUNCA somar estimativa com valor real num número só:
      // um número que mistura chute com fato mente sem avisar.
      if (c.valor_estimado) semanaEstimado += valor
      else                  semanaConfirmado += valor
    }
  }

  return { semanaConfirmado, semanaEstimado, atrasadoTotal, atrasadoQtd, aguardandoQtd }
}
```

- [ ] **Step 3: Adicionar o link na navegação**

Run: `grep -rn "financeiro" web/components web/app --include=*.tsx | grep -i "href\|nav"`
Adicionar `/contas` na mesma lista, com rótulo **Contas**.

- [ ] **Step 4: Conferir que o site compila**

Run: `cd web && npm run build`
Expected: build sem erro

- [ ] **Step 5: Conferir na tela**

Run: `cd web && npm run dev`, abrir `http://localhost:3000/contas`
Expected: página abre, os três cartões aparecem (zerados enquanto não houver conta cadastrada), sem erro no console do navegador

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/contas/page.tsx web/components
git commit -m "feat: pagina /contas com os tres numeros e lista por vencimento"
```

---

### Task 10: Os formulários de cadastro

Entrega: o Matheus consegue cadastrar uma conta fixa (a regra) e uma conta avulsa, sem sair da página.

**Files:**
- Create: `web/app/(app)/contas/formulario-conta-fixa.tsx`
- Create: `web/app/(app)/contas/formulario-conta-avulsa.tsx`
- Modify: `web/app/(app)/contas/page.tsx` (botões que abrem os formulários)

**Interfaces:**
- Consumes: `POST /contas/recorrentes`, `PATCH /contas/recorrentes/:id`, `POST /contas` (Task 8)
- Produces: dois componentes de formulário usados pela página

- [ ] **Step 1: Escrever o formulário de conta fixa**

Campos, na ordem: descrição, fornecedor, categoria, periodicidade (mensal / bimestral / trimestral / semestral / anual), dia do vencimento (1–31), **mês da primeira ocorrência** (só aparece quando a periodicidade **não** é mensal — e é obrigatório aí), valor de referência, avisar quantos dias antes (padrão 3), ativa.

Textos de ajuda que precisam aparecer na tela, em português:
- Dia do vencimento: *"Se o mês não tiver esse dia (ex.: 31 em fevereiro), a conta cai no último dia do mês."*
- Mês da primeira: *"Em que mês cai a primeira. As seguintes são contadas a partir dela."*
- Valor de referência: *"Só a primeira estimativa. Depois o sistema usa o último valor que você pagou."*

- [ ] **Step 2: Escrever o formulário de conta avulsa**

Campos: descrição, fornecedor, categoria, vencimento, valor. Sem recorrência.

- [ ] **Step 3: Ligar os botões na página**

Dois botões no topo: **Nova conta fixa** e **Nova conta avulsa**.

- [ ] **Step 4: Conferir de ponta a ponta, com a API de pé**

Run: `cd api && npm run dev` num terminal e `cd web && npm run dev` noutro.

Roteiro de conferência (fazer na tela, nesta ordem):
1. Cadastrar uma conta fixa mensal, dia 10 → ela **aparece na lista na hora**, com status *aguardando* e etiqueta *estimado*.
2. Registrar o valor real → a etiqueta *estimado* some e o status vira *aberta*.
3. Marcar como paga → sai da lista de abertas; **conferir na página Financeiro que apareceu UM lançamento**, com a data e o valor que você informou.
4. Desfazer o pagamento → o lançamento **some** do Financeiro e a conta volta para *aberta*.
5. Cadastrar uma conta fixa **anual** com mês da primeira = mês que vem → conferir que **não** nasceu ocorrência para este mês.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/contas/
git commit -m "feat: formularios de conta fixa e conta avulsa"
```

---

## Conferência final da Fase 1

- [ ] `cd api && npm test` — todos verdes
- [ ] `cd api && npx tsc --noEmit` — sem erro
- [ ] `cd web && npm run build` — sem erro
- [ ] Rodar a tarefa do dia à mão para provar a idempotência: chamar `rodarContasDoDia()` duas vezes seguidas e conferir no Supabase que **não** nasceu ocorrência duplicada:

```sql
SELECT recorrente_id, competencia, count(*)
FROM contas_a_pagar
WHERE recorrente_id IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1;
```

Expected: **zero linhas**.

- [ ] Conferir o isolamento por fazenda: trocar de fazenda no painel e confirmar que as contas de Uberaba (`mg`) não aparecem.
- [ ] Conferir que o fluxo de NF-e continua intacto: `git diff main --stat` **não** pode listar `nfeProcessor.ts`, `jobs/nfeEmail.ts` nem `webhooks/nfe*.ts`.
