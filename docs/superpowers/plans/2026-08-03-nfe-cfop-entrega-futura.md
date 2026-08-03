# NF-e: ler o CFOP e parar de dobrar estoque e gasto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para executar tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** O sistema passa a ler o código de operação (CFOP) de cada item da NF-e e para de somar estoque e gasto duas vezes quando a compra vem em duas notas — a de faturamento e as de entrega.

**Architecture:** `parseXmlNFe` ganha o CFOP por item (hoje é lido e descartado, igual ao vencimento antes da Fase 2). Uma função **pura e testada** classifica cada item em "entra no estoque?" e "conta como compra?". `processarNFe` consulta essa função em vez de decidir sozinho. A decisão de **boleto** continua vindo dos campos de pagamento, nunca do CFOP.

**Tech Stack:** Node + Express + TypeScript (API, Railway), Supabase (PostgreSQL), Vitest, fast-xml-parser.

**Contexto — por que este plano existe:**

Em 03/08/2026 o produtor recebeu a primeira NF-e depois da Fase 2 e o sistema revelou um defeito **muito maior** que o previsto. Compra real, conferida no banco:

| | Toneladas | Valor |
|---|---|---|
| Nota **61968** (09/07, faturamento) | 400 | R$ 1.060.000 |
| **12 notas de entrega** (20/07 a 03/08) | 455 | R$ 1.205.750 |
| **Registrado no sistema** | **855** | **R$ 2.265.750** |
| **Realidade** (um PIX só) | ~455 recebidas | **R$ 1.060.000** |

O sistema tratou as duas espécies de nota igual. A informação que as distingue **sempre esteve no arquivo** — CFOP `5117`, `natOp = VENDA MERC.ORIG.FAT.P/ENT.FUTURA`, `tPag = 90` (sem pagamento), `vPag = 0.00`, sem bloco `<cobr>` — e nunca foi lida.

**Validação fiscal:** feita pela especialista de agro em 03/08. Base legal: Convênio SINIEF s/nº de 15/12/1970, cláusula terceira. Achados que mudaram o desenho estão nas Decisões abaixo.

## Global Constraints

- **TypeScript sempre**, nunca JavaScript puro.
- Nomes de função e variável em **inglês camelCase**; colunas e rotas em **português**; mensagens ao usuário final em **português brasileiro, sem jargão** — o dono é leigo em tecnologia.
- **Datas nunca via `new Date('2026-07-01')`** — lido como UTC, já causou defeito neste projeto.
- Variáveis de ambiente via `process.env` — nunca cravadas no código.
- **Índice único nunca leva cláusula `WHERE`** (erro 42P10 silencioso).
- Nunca `catch` mudo. Falha de banco nunca pode virar silêncio indistinguível de "não há nada".
- **A criação de boletos continua isolada** em `try/catch` no fim de `processarNFe`, DEPOIS do `update({status:'processada'})`. Há teste que afirma essa ordem — **não mexer**.
- Ramo: `feat/nfe-cfop`, a partir de `main`.
- Commits em português, prefixo `feat:` / `fix:` / `test:`. Nunca `--no-verify`.
- Hoje a suíte tem **128 testes verdes** e nenhum pode quebrar.

---

## Decisões fechadas (o que mandou no desenho)

| # | Decisão | Por quê |
|---|---|---|
| 1 | **Estoque é decidido pelo CFOP** | É o campo que diz se houve circulação física de mercadoria |
| 2 | **Boleto é decidido pelos campos de pagamento (`cobr`/`tPag`/`vPag`), NUNCA pelo CFOP** | Existe revenda que pula o passo do faturamento e embute a cobrança na própria remessa. Cravar "remessa nunca gera boleto" engoliria esse boleto — o erro mais caro possível |
| 3 | **Gasto conta quando o CFOP diz compra OU quando há cobrança de verdade** | Cobre os dois lados: a nota de entrega normal não duplica o custo, e a revenda desorganizada não perde o custo |
| 4 | **CFOP é lido POR ITEM, não por nota** | É prática comercial pôr "compre 20, leve 2 de bonificação" na mesma NF-e, com códigos diferentes por item |
| 5 | **Bonificação soma ao estoque com custo ZERO** | O produto existe fisicamente e vai ser aplicado, mas nenhum dinheiro saiu. Lançar como compra estragaria o preço médio do insumo (STJ, Súmula 457) |
| 6 | **O CFOP passa a ser GRAVADO em `itens_nfe`** | Mesma lição do `forma_pagamento`: decisão que não deixa rastro não dá para auditar depois |
| 7 | **CFOP desconhecido → comporta-se como compra normal** | Na dúvida, o sistema faz o que já fazia. Nunca deixa de registrar por não reconhecer um código |

### Fora de escopo (de propósito)

| O quê | Por quê |
|---|---|
| **As três datas do gasto** (dinheiro saiu / mercadoria chegou / adubo aplicado) | A especialista levantou que o "gasto" do sistema hoje significa "a nota chegou", mas o contador dele (pessoa física, regime de caixa) quer "o dinheiro saiu", e o custo de talhão quer "foi aplicado". São três perguntas diferentes. **Vai voltar** — 400 t podem atravessar duas safras — mas é outro projeto |
| Ligar a nota de entrega à nota mãe automaticamente | O campo `xPed` veio **vazio** na amostra real. A referência existe só em texto livre no campo de observações. Não é base confiável |
| A diferença de 55 t (455 entregues × 400 faturadas) | **Pergunta para a SYAGRI, não para o sistema.** 13,75% é grande demais para quebra de balança (o normal é 0,5%–2%) |

---

## Tabela de CFOP (validada em 03/08/2026)

> ⚠️ **Confirmar contra a tabela oficial vigente ao implementar.** Fonte usada: Convênio SINIEF s/nº de 1970 e tabela CFOP publicada.

| CFOP | O que é | Estoque | Conta como compra |
|---|---|---|---|
| `5922` `6922` | Faturamento para entrega futura | **NÃO** | **SIM** |
| `5116` `6116` `5117` `6117` | Remessa de entrega futura | **SIM** | **NÃO** |
| `5910` `6910` | Bonificação, doação ou brinde | **SIM, custo zero** | **NÃO** |
| `5911` `6911` | Amostra grátis | **SIM, custo zero** | **NÃO** |
| `5912` `6912` `5913` `6913` | Demonstração | **NÃO** | **NÃO** |
| `5915` `6915` `5916` `6916` | Conserto / retorno de conserto | **NÃO** | **NÃO** |
| `5920` `6920` `5921` `6921` | Vasilhame / sacaria retornável | **NÃO** | **NÃO** |
| `5905` `6905` `5934` `6934` | Armazém geral / depósito | **NÃO** | **NÃO** |
| `5924` `6924` `5925` `6925` | Industrialização por encomenda | **NÃO** | **NÃO** |
| `5917` `6917` | Remessa em consignação | **SIM** | **NÃO** |
| `5919` `6919` | Devolução simbólica (consignação vira compra) | **NÃO** | **SIM** |
| **qualquer outro** | venda normal, venda à ordem (`5118`–`5120`), desconhecido | **SIM** | **SIM** |

**`5118`/`5119`/`5120` (venda à ordem) NÃO entram na família de entrega futura** — é triangulação com três partes, e para quem recebe é compra normal.

---

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/007_cfop_em_itens_nfe.sql` | Coluna `cfop` em `itens_nfe` |
| `api/src/services/contas/cfop.ts` | A regra: o que cada CFOP faz. **Pura, sem banco** |
| `api/src/services/contas/cfop.test.ts` | Testes da regra |

**Modificar:**

| Arquivo | O quê |
|---|---|
| `api/src/services/nfeProcessor.ts` | `parseXmlNFe` lê `CFOP` por item; `processarNFe` consulta a regra antes de mexer em estoque e gasto |
| `api/src/services/nfeProcessor.test.ts` | Testes novos de leitura e de comportamento |
| `api/src/services/contas/deNotaFiscal.ts` | `tPag = 90` passa a significar "sem boleto" |
| `api/src/services/contas/deNotaFiscal.test.ts` | Teste do `90` |

---

### Task 1: Ler o CFOP de cada item

Entrega: `parseXmlNFe` devolve o CFOP por item, sem mudar nada do que já devolvia.

**Files:**
- Modify: `api/src/services/nfeProcessor.ts` (interface `NFeItem` e o `.map()` dos itens)
- Test: `api/src/services/nfeProcessor.test.ts`

**Interfaces:**
- Produces: `NFeItem` ganha `cfop: string` (4 dígitos, só números; `''` quando ausente)

- [ ] **Step 1: Criar o ramo**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/nfe-cfop
```

- [ ] **Step 2: Escrever o teste que falha**

Acrescentar a `api/src/services/nfeProcessor.test.ts`. A função `nfeXml()` já existe no arquivo — reaproveite-a.

```ts
describe('parseXmlNFe — CFOP por item', () => {
  it('le o CFOP do item', () => {
    const r = parseXmlNFe(nfeXml())!
    expect(r.items[0].cfop).toBe('5102')
  })

  it('item sem CFOP devolve string vazia, nao quebra', () => {
    const semCfop = nfeXml().replace(/<CFOP>\d+<\/CFOP>/, '')
    expect(parseXmlNFe(semCfop)!.items[0].cfop).toBe('')
  })

  it('CFOP com pontuacao vira so digitos', () => {
    const comPonto = nfeXml().replace(/<CFOP>\d+<\/CFOP>/, '<CFOP>5.117</CFOP>')
    expect(parseXmlNFe(comPonto)!.items[0].cfop).toBe('5117')
  })

  it('nota com dois itens de CFOP diferente le os dois', () => {
    const doisItens = nfeXml().replace(
      '</det>',
      `</det><det><prod><xProd>BRINDE</xProd><qCom>2</qCom><uCom>UN</uCom>
       <vUnCom>0</vUnCom><vProd>0</vProd><NCM>31051000</NCM><CFOP>5910</CFOP></prod></det>`,
    )
    const r = parseXmlNFe(doisItens)!
    expect(r.items.map(i => i.cfop)).toEqual(['5102', '5910'])
  })

  it('os campos que ja eram lidos continuam identicos', () => {
    const r = parseXmlNFe(nfeXml())!
    expect(r.numero).toBe('4516')
    expect(r.items[0].description).toBe('OLEO DIESEL S10')
    expect(r.items[0].ncm).toBe('27101259')
  })
})
```

> A função `nfeXml()` do arquivo hoje **não** tem `<CFOP>` no item. Acrescente `<CFOP>5102</CFOP>` dentro de `<prod>` na fixture, junto do `<NCM>`. Isso não quebra os testes existentes — nenhum deles afirma nada sobre CFOP.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd api && npm test`
Expected: FAIL — `cfop` não existe em `NFeItem`

- [ ] **Step 4: Implementar**

Em `api/src/services/nfeProcessor.ts`, na interface `NFeItem`, acrescentar depois de `ncm`:

```ts
  cfop:         string   // código da operação, 4 dígitos. '' quando o item não traz
```

E no `.map()` que monta os itens, junto da linha do `ncm`:

```ts
        cfop:         String(prod.CFOP ?? '').replace(/\D/g, ''),
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — os novos verdes, os 128 anteriores intactos

- [ ] **Step 6: Conferir contra os arquivos reais**

Run:
```bash
cd api && npx tsx -e "
import { readFileSync, readdirSync } from 'fs'
import { parseXmlNFe } from './src/services/nfeProcessor'
const dir = '../.tmp/notas-exemplo'
for (const f of readdirSync(dir).filter(n => n.endsWith('.xml'))) {
  const r = parseXmlNFe(readFileSync(\`\${dir}/\${f}\`, 'utf-8'))
  console.log(r?.emitenteNome?.slice(0,28), '| CFOP:', r?.items.map(i => i.cfop).join(','), '| tPag:', r?.formaPagamento)
}"
```
Expected: a nota da SYAGRI (`NFe 62402-3 Empresa 1.xml`) precisa mostrar **`CFOP: 5117`** e **`tPag: 90`**. Se não mostrar, **pare**.

- [ ] **Step 7: Commit**

```bash
git add api/src/services/nfeProcessor.ts api/src/services/nfeProcessor.test.ts
git commit -m "feat: ler o CFOP de cada item da NF-e"
```

---

### Task 2: A regra — o que cada CFOP faz

Entrega: uma função pura que responde, para cada item, se ele entra no estoque e se conta como compra. Puro, sem banco, coberto por teste.

**Files:**
- Create: `api/src/services/contas/cfop.ts`
- Test: `api/src/services/contas/cfop.test.ts`

**Interfaces:**
- Produces:
  - `type EfeitoItem = { entraNoEstoque: boolean; contaComoCompra: boolean; custoZero: boolean; rotulo: string }`
  - `efeitoDoCfop(cfop: string): EfeitoItem`

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/contas/cfop.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { efeitoDoCfop } from './cfop'

describe('efeitoDoCfop — entrega futura (o caso que originou este trabalho)', () => {
  it('faturamento 5922: conta o gasto e NAO mexe no estoque', () => {
    const e = efeitoDoCfop('5922')
    expect(e.entraNoEstoque).toBe(false)
    expect(e.contaComoCompra).toBe(true)
  })

  it('remessa 5117: soma o estoque e NAO conta o gasto de novo', () => {
    const e = efeitoDoCfop('5117')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(false)
  })

  it('remessa 5116 e as versoes interestaduais seguem a mesma regra', () => {
    for (const c of ['5116', '6116', '6117']) {
      expect(efeitoDoCfop(c).entraNoEstoque).toBe(true)
      expect(efeitoDoCfop(c).contaComoCompra).toBe(false)
    }
    expect(efeitoDoCfop('6922').contaComoCompra).toBe(true)
    expect(efeitoDoCfop('6922').entraNoEstoque).toBe(false)
  })
})

describe('efeitoDoCfop — bonificacao', () => {
  it('5910 entra no estoque com custo ZERO e nao conta como compra', () => {
    const e = efeitoDoCfop('5910')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(false)
    expect(e.custoZero).toBe(true)
  })

  it('amostra gratis 5911 idem', () => {
    expect(efeitoDoCfop('5911').custoZero).toBe(true)
  })

  it('compra normal NAO e custo zero', () => {
    expect(efeitoDoCfop('5102').custoZero).toBe(false)
  })
})

describe('efeitoDoCfop — mercadoria que passa mas nao e compra', () => {
  it('conserto, demonstracao, vasilhame, armazem e industrializacao nao mexem em nada', () => {
    for (const c of ['5915', '5912', '5920', '5905', '5924', '6925', '5934']) {
      const e = efeitoDoCfop(c)
      expect(e.entraNoEstoque).toBe(false)
      expect(e.contaComoCompra).toBe(false)
    }
  })
})

describe('efeitoDoCfop — consignacao', () => {
  it('remessa em consignacao 5917 entra no estoque mas ainda nao e compra', () => {
    const e = efeitoDoCfop('5917')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(false)
  })

  it('devolucao simbolica 5919 vira compra sem mexer no estoque de novo', () => {
    const e = efeitoDoCfop('5919')
    expect(e.entraNoEstoque).toBe(false)
    expect(e.contaComoCompra).toBe(true)
  })
})

describe('efeitoDoCfop — na duvida, faz o que sempre fez', () => {
  it('venda normal soma estoque e conta compra', () => {
    for (const c of ['5101', '5102', '6101', '6102']) {
      const e = efeitoDoCfop(c)
      expect(e.entraNoEstoque).toBe(true)
      expect(e.contaComoCompra).toBe(true)
    }
  })

  it('venda a ordem (5118-5120) e compra normal, NAO entrega futura', () => {
    for (const c of ['5118', '5119', '5120']) {
      const e = efeitoDoCfop(c)
      expect(e.entraNoEstoque).toBe(true)
      expect(e.contaComoCompra).toBe(true)
    }
  })

  it('CFOP desconhecido se comporta como compra normal', () => {
    const e = efeitoDoCfop('7777')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(true)
  })

  it('CFOP vazio se comporta como compra normal', () => {
    const e = efeitoDoCfop('')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(true)
  })
})

describe('efeitoDoCfop — rotulo em portugues, para a mensagem do WhatsApp', () => {
  it('descreve a operacao sem jargao', () => {
    expect(efeitoDoCfop('5117').rotulo).toMatch(/entrega/i)
    expect(efeitoDoCfop('5910').rotulo).toMatch(/bonifica/i)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd api && npm test`
Expected: FAIL — `Failed to resolve import "./cfop"`

- [ ] **Step 3: Implementar**

Criar `api/src/services/contas/cfop.ts`:

```ts
// O que cada código de operação (CFOP) da NF-e faz com estoque e com custo.
//
// POR QUE ISTO EXISTE: em 03/08/2026 descobrimos que uma compra de 400 t de KCl
// entrou no sistema DUAS vezes — uma pela nota de faturamento e outra por cada
// nota de entrega — porque o sistema tratava as duas iguais. R$ 1,2 milhão de
// gasto que não existiu e 400 toneladas que não estavam no galpão.
//
// Base legal da separação: Convênio SINIEF s/nº de 15/12/1970, cláusula terceira.
// A nota de faturamento formaliza a venda SEM mover mercadoria; a de remessa move
// a mercadoria SEM cobrar de novo.
//
// ⚠️ Esta função decide ESTOQUE e CUSTO. Ela NÃO decide boleto — quem decide boleto
// são os campos de pagamento da nota (cobr/tPag/vPag), porque existe revenda que
// pula o passo do faturamento e embute a cobrança na própria remessa. Cravar
// "remessa nunca gera boleto" perderia esse boleto, que é o erro mais caro.

export type EfeitoItem = {
  entraNoEstoque:  boolean
  contaComoCompra: boolean
  custoZero:       boolean   // entra no estoque, mas sem preço (não estraga o preço médio)
  rotulo:          string    // português claro, para log e mensagem
}

const COMPRA_NORMAL: EfeitoItem = {
  entraNoEstoque: true, contaComoCompra: true, custoZero: false, rotulo: 'compra',
}

const TABELA: Record<string, EfeitoItem> = {}

function registrar(cfops: string[], efeito: EfeitoItem) {
  for (const c of cfops) TABELA[c] = efeito
}

// Faturamento para entrega futura: é a VENDA. Dinheiro sim, mercadoria não.
registrar(['5922', '6922'], {
  entraNoEstoque: false, contaComoCompra: true, custoZero: false,
  rotulo: 'faturamento de entrega futura',
})

// Remessa de entrega futura: é a ENTREGA. Mercadoria sim, dinheiro não
// (o custo já entrou com a nota de faturamento).
registrar(['5116', '6116', '5117', '6117'], {
  entraNoEstoque: true, contaComoCompra: false, custoZero: false,
  rotulo: 'entrega de pedido já faturado',
})

// Bonificação e amostra: o produto existe e vai ser aplicado, mas nenhum dinheiro
// saiu. Lançar como compra estragaria o preço médio do insumo (STJ, Súmula 457).
registrar(['5910', '6910'], {
  entraNoEstoque: true, contaComoCompra: false, custoZero: true,
  rotulo: 'bonificação (produto de graça)',
})
registrar(['5911', '6911'], {
  entraNoEstoque: true, contaComoCompra: false, custoZero: true,
  rotulo: 'amostra grátis',
})

// Mercadoria que passa pela fazenda mas não é compra nem consumo.
registrar(
  ['5912', '6912', '5913', '6913', '5915', '6915', '5916', '6916',
   '5920', '6920', '5921', '6921', '5905', '6905', '5934', '6934',
   '5924', '6924', '5925', '6925'],
  { entraNoEstoque: false, contaComoCompra: false, custoZero: false,
    rotulo: 'remessa sem compra' },
)

// Consignação: o produto fica na fazenda, mas só vira compra quando é usado
// (a devolução simbólica é que fecha a venda).
registrar(['5917', '6917'], {
  entraNoEstoque: true, contaComoCompra: false, custoZero: false,
  rotulo: 'consignação (ainda não é compra)',
})
registrar(['5919', '6919'], {
  entraNoEstoque: false, contaComoCompra: true, custoZero: false,
  rotulo: 'consignação usada (virou compra)',
})

// Na dúvida — código desconhecido, ausente, ou venda normal — faz o que sempre fez.
// Deixar de registrar por não reconhecer um código seria pior que registrar demais.
export function efeitoDoCfop(cfop: string): EfeitoItem {
  return TABELA[cfop] ?? COMPRA_NORMAL
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — todos verdes

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/cfop.ts api/src/services/contas/cfop.test.ts
git commit -m "feat: regra do que cada CFOP faz com estoque e custo (puro, sem banco)"
```

---

### Task 3: Guardar o CFOP no banco

Entrega: o CFOP lido fica gravado, para dar pra auditar depois por que o sistema decidiu o que decidiu.

**Files:**
- Create: `supabase/migrations/007_cfop_em_itens_nfe.sql`

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/007_cfop_em_itens_nfe.sql`:

```sql
-- ============================================================
-- AgroMouro — guardar o CFOP de cada item da NF-e
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Plano: docs/superpowers/plans/2026-08-03-nfe-cfop-entrega-futura.md
-- ============================================================
--
-- POR QUE: até 03/08/2026 o sistema lia o código de operação e jogava fora.
-- Sem ele gravado, não há como descobrir DEPOIS por que uma nota somou (ou não
-- somou) estoque. Mesma lição da coluna forma_pagamento.
--
ALTER TABLE itens_nfe ADD COLUMN IF NOT EXISTS cfop TEXT;

-- VERIFICAÇÃO — precisa devolver 1 linha.
SELECT 'coluna cfop criada' AS conferencia, column_name
  FROM information_schema.columns
 WHERE table_name = 'itens_nfe' AND column_name = 'cfop';
```

- [ ] **Step 2: Rodar no Supabase e conferir**

Colar no SQL Editor e rodar. Expected: 1 linha.

**Esta migração é segura com o código velho no ar** — só acrescenta coluna que aceita vazio.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_cfop_em_itens_nfe.sql
git commit -m "feat: coluna cfop em itens_nfe para auditoria"
```

---

### Task 4: Aplicar a regra no estoque e no custo

Entrega: o processamento de NF-e para de somar estoque e gasto em nota que não é compra. **É a tarefa que conserta o defeito.**

**Files:**
- Modify: `api/src/services/nfeProcessor.ts`
- Test: `api/src/services/nfeProcessor.test.ts`

**Interfaces:**
- Consumes: `efeitoDoCfop` de `./contas/cfop`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `api/src/services/nfeProcessor.test.ts`, no mesmo padrão do teste de isolamento que já existe (mock do supabase e do zapi, array `chamadas` registrando as operações):

```ts
describe('processarNFe — CFOP manda no estoque e no custo', () => {
  it('nota de REMESSA de entrega futura soma estoque e NAO cria lancamento', async () => {
    // nota com CFOP 5117 — igual à SYAGRI real de 03/08/2026
    // ... montar NFeData com items[0].cfop = '5117'
    // Afirmar:
    //   chamadas tem movimentacoes_estoque insert  → SIM
    //   chamadas tem rpc incrementar_estoque       → SIM
    //   chamadas tem lancamentos_financeiros insert → NÃO
  })

  it('nota de FATURAMENTO de entrega futura cria lancamento e NAO soma estoque', async () => {
    // CFOP 5922
    // Afirmar o inverso: lançamento SIM, movimentação e rpc NÃO
  })

  it('bonificacao soma estoque e NAO grava preco medio', async () => {
    // CFOP 5910 — afirmar que estoque.update de preco_medio_unitario NÃO acontece
  })

  it('venda normal continua fazendo tudo como antes', async () => {
    // CFOP 5102 — estoque SIM, lançamento SIM (protege contra regressão)
  })

  it('o item continua sendo gravado em itens_nfe em TODOS os casos, com o cfop', async () => {
    // mesmo quando não entra no estoque, a nota e o item existem no histórico
  })
})
```

> **Escreva os corpos completos** seguindo o `describe` de isolamento já existente no arquivo — ele mostra como o mock do supabase registra as chamadas. Não deixe teste sem asserção.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd api && npm test`
Expected: FAIL — hoje o sistema faz tudo em todos os casos

- [ ] **Step 3: Implementar**

Em `api/src/services/nfeProcessor.ts`:

1. Acrescentar o import:

```ts
import { efeitoDoCfop } from './contas/cfop'
```

2. No laço de itens, logo depois de calcular `vereditoNCM` e `tipo`, consultar a regra:

```ts
      // O CFOP manda: ele diz se houve circulação física de mercadoria e se a
      // nota é a compra ou só a entrega de algo já faturado. Ver contas/cfop.ts.
      const efeito = efeitoDoCfop(item.cfop)
```

3. Gravar o `cfop` no insert de `itens_nfe` (nos DOIS inserts — o do item estocável e o do não-estocável):

```ts
          cfop: item.cfop || null,
```

4. Trocar a condição que decide o estoque. Onde hoje está `if (!estocavel) { ...; continue }`, passa a valer também o efeito:

```ts
      // Não entra no estoque quando o NCM/tipo diz que não é estocável OU quando o
      // CFOP diz que não houve compra de mercadoria para o galpão.
      if (!estocavel || !efeito.entraNoEstoque) {
```

5. **Preço médio só quando não é custo zero:**

```ts
      if (precoUnitario > 0 && !efeito.custoZero) {
        await supabase.from('estoque').update({ ... })
      }
```

6. **O lançamento financeiro passa a depender da regra.** Substituir o bloco `// 3. Lançamento financeiro` por:

```ts
    // 3. Lançamento financeiro — só o que é compra de verdade.
    //
    // Soma apenas os itens cujo CFOP diz "compra". Nota de entrega de pedido já
    // faturado não repete o custo; bonificação não vira custo nenhum.
    //
    // A EXCEÇÃO que salva boleto: se a nota traz cobrança de verdade (bloco de
    // duplicatas, ou forma de pagamento com valor), então ela É uma cobrança
    // mesmo que o CFOP diga o contrário — existe revenda que pula o passo do
    // faturamento. Nesse caso conta o valor total, senão o custo sumiria.
    const temCobrancaReal = duplicatas.length > 0 || (formaPagamento !== null && formaPagamento !== '90')

    const valorCompra = temCobrancaReal
      ? valorTotal
      : itensSeguros
          .filter(i => efeitoDoCfop(i.cfop).contaComoCompra)
          .reduce((soma, i) => soma + (i.totalValue || 0), 0)

    if (valorCompra > 0) {
      await supabase.from('lancamentos_financeiros').insert({
        data:           dataFormatada,
        descricao:      `NF-e ${numero} — ${emitenteNome}`,
        valor:          valorCompra,
        tipo:           'despesa',
        categoria:      'insumos',
        nota_fiscal_id: nfeId,
        fazenda_id,
      })
    } else {
      console.log(`[NFeProcessor] NF-e ${numero}: sem valor de compra (${efeitoDoCfop(itensSeguros[0]?.cfop ?? '').rotulo}) — nenhum lançamento criado.`)
    }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd api && npx tsc --noEmit && npm test`
Expected: sem erro de tipo; todos verdes, inclusive o teste de isolamento e o de ordem das operações

- [ ] **Step 5: Commit**

```bash
git add api/src/services/nfeProcessor.ts api/src/services/nfeProcessor.test.ts
git commit -m "fix: CFOP decide estoque e custo — para de dobrar nota de entrega futura"
```

---

### Task 5: `tPag = 90` significa "sem boleto"

Entrega: nota que declara "sem pagamento" para de virar cobrança na agenda.

**Files:**
- Modify: `api/src/services/contas/deNotaFiscal.ts`
- Test: `api/src/services/contas/deNotaFiscal.test.ts`

**Contexto:** o desenho da Fase 2 pôs `90` na lista de "cria conta mesmo assim", com a justificativa *"na dúvida, cria"*. A nota real da SYAGRI provou que `90` não é dúvida — é a nota afirmando que não há pagamento, com `vPag = 0.00`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `api/src/services/contas/deNotaFiscal.test.ts`:

```ts
describe('motivoSemBoleto — codigo 90', () => {
  it('90 (sem pagamento) NAO gera boleto', () => {
    expect(motivoSemBoleto('90')).toBe('a nota diz que não há pagamento')
  })
})

describe('contasDaNota — nota de entrega futura', () => {
  it('nota com tPag 90 e sem duplicata nao gera conta nenhuma', () => {
    const r = contasDaNota({ ...base, formaPagamento: '90', duplicatas: [] })
    expect(r).toEqual([])
  })

  it('MAS se vier duplicata junto, o boleto e real e a conta nasce', () => {
    // Protege o caso da revenda que pula o faturamento e cobra na remessa.
    const r = contasDaNota({
      ...base, formaPagamento: '90',
      duplicatas: [{ numero: '001', vencimento: '2026-09-15', valor: 5000 }],
    })
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBe('2026-09-15')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd api && npm test`

- [ ] **Step 3: Implementar**

Em `api/src/services/contas/deNotaFiscal.ts`, acrescentar ao mapa `MOTIVO_SEM_BOLETO`:

```ts
  '90': 'a nota diz que não há pagamento',
```

E em `contasDaNota`, garantir que a recusa só vale quando **não há duplicata**, invertendo a ordem da checagem:

```ts
export function contasDaNota(nfe: DadosParaConta): ContaDeNota[] {
  // Duplicata preenchida é prova de cobrança real e vence qualquer código de
  // forma de pagamento: existe revenda que embute a cobrança na nota de remessa.
  if (nfe.duplicatas.length === 0 && motivoSemBoleto(nfe.formaPagamento)) return []
  ...
}
```

> ⚠️ Confira que os testes existentes de cartão (`'05'` não gera conta) continuam verdes — aquelas fixtures têm duplicata. Se quebrarem, **pare e reavalie**: pode ser que cartão precise recusar mesmo com duplicata, e `90` não.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd api && npx tsc --noEmit && npm test`

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/deNotaFiscal.ts api/src/services/contas/deNotaFiscal.test.ts
git commit -m "fix: tPag 90 (sem pagamento) nao gera boleto, salvo se houver duplicata"
```

---

### Task 6: Subir

- [ ] **Step 1: Bateria completa**

Run: `cd api && npx tsc --noEmit && npm test`
Run: `cd web && npx tsc --noEmit`

- [ ] **Step 2: Conferir contra os arquivos reais, de ponta a ponta**

Run:
```bash
cd api && npx tsx -e "
import { readFileSync, readdirSync } from 'fs'
import { parseXmlNFe } from './src/services/nfeProcessor'
import { efeitoDoCfop } from './src/services/contas/cfop'
const dir = '../.tmp/notas-exemplo'
for (const f of readdirSync(dir).filter(n => n.endsWith('.xml'))) {
  const r = parseXmlNFe(readFileSync(\`\${dir}/\${f}\`, 'utf-8'))!
  for (const i of r.items) {
    const e = efeitoDoCfop(i.cfop)
    console.log(r.emitenteNome.slice(0,22).padEnd(22), i.cfop.padEnd(5), e.rotulo.padEnd(32),
                'estoque:', e.entraNoEstoque ? 'SIM' : 'nao ', '| compra:', e.contaComoCompra ? 'SIM' : 'nao')
  }
}"
```
Expected: a nota da SYAGRI mostra `5117 · entrega de pedido já faturado · estoque: SIM · compra: nao`.

- [ ] **Step 3: Rodar a migração 007 no Supabase** (se ainda não rodou na Task 3)

- [ ] **Step 4: PR e merge**

```bash
git push -u origin feat/nfe-cfop
gh pr create --title "fix(nfe): ler o CFOP e parar de dobrar estoque e gasto" --body "..."
```

**Ordem:** a migração 007 é segura antes do merge (só acrescenta coluna opcional). Rodar antes, como na Fase 2.

- [ ] **Step 5: Conferir com nota real**

Esperar a próxima nota de entrega da SYAGRI (chegam quase todo dia). A mensagem do WhatsApp deve mostrar o estoque atualizado e **nenhuma linha de boleto**; e nenhum lançamento novo deve aparecer no Financeiro.

---

### Task 7: Corrigir o histórico da SYAGRI (COM O MATHEUS, não sozinho)

⚠️ **Só depois de a Task 6 estar no ar.** Consertar o dado antes do código faria cada caminhão novo estragar de novo.

**Isto NÃO é tarefa de subagente.** É sessão com o dono, no mesmo formato da limpeza da TEBURAZ em 31/07: olhar antes, mostrar o que será mexido, ele aprovar, e só então rodar — tudo numa transação.

**O que precisa ser desfeito:**

| Nota | O que fazer |
|---|---|
| **61968** (faturamento, R$ 1.060.000) | **Tirar as 400 t do estoque.** O lançamento de R$ 1,06 milhão **fica** — é o dinheiro real que saiu |
| **As 12 notas de entrega** (455 t) | **Apagar os lançamentos financeiros** (R$ 1.205.750 no total). O estoque delas **fica** — é o adubo que chegou de verdade |

**Cuidados, aprendidos na limpeza da TEBURAZ:**
- Apagar a linha de `movimentacoes_estoque` **não devolve** o saldo — tem que descontar de `estoque.quantidade_atual` explicitamente.
- `lancamentos_financeiros.nota_fiscal_id` é `ON DELETE SET NULL` — apagar a nota deixaria o lançamento órfão. Aqui a nota **não** será apagada, só o lançamento.
- Medir antes e depois. Nenhum número pode mudar além do previsto.

**Resultado esperado ao fim:** estoque do KCl **455 t** (o que chegou), gasto da SYAGRI **R$ 1.060.000** (o que saiu do banco).

**Pendência que precisa de resposta antes:** as entregas somam **455 t** e o faturamento foi de **400 t** — diferença de 55 t (R$ 145.750). É pergunta para a SYAGRI: *"falta uma nota de faturamento complementar?"*. Se aparecer essa nota, o lançamento dela entra e o número final muda.

---

## Riscos

| # | Risco | Gravidade | O que reduz |
|---|---|---|---|
| 1 | **A tabela de CFOP estar errada ou incompleta** | Alta | Validada pela especialista com fonte legal, mas **conferir a tabela oficial vigente ao implementar**. CFOP desconhecido cai em "compra normal", que é o comportamento de hoje |
| 2 | **Perder um boleto real** numa nota de remessa que traz cobrança embutida | **Alta — é o erro mais caro** | A decisão de boleto **nunca** olha o CFOP, só os campos de pagamento. Coberto por teste na Task 5 |
| 3 | Nota com itens de CFOP misturado (compra + bonificação) | Média | A regra é por item. O valor do lançamento soma só os itens de compra |
| 4 | Mexer de novo no `nfeProcessor`, que alimenta estoque, financeiro e WhatsApp | Média | Os testes de isolamento e de ordem da Fase 2 continuam valendo e **não podem ser tocados** |
| 5 | Corrigir o histórico e errar a mão | Alta | Task 7 é sessão com o dono, nunca automática. Medir antes e depois |

## Premissas

1. **A tabela de CFOP validada em 03/08/2026 continua vigente.** Conferir ao implementar.
2. **A SYAGRI segue o padrão de duas notas.** Se um dia mandar tudo numa nota só, o CFOP será de venda normal e o sistema faz o que sempre fez.
3. **Só a fazenda MG recebe NF-e hoje** — confirmado pelo dono em 31/07.
