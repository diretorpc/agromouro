# Contas a Pagar — Fase 2: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando uma NF-e chega por e-mail, os boletos dela entram sozinhos na agenda de contas — com vencimento e valor. Quando a nota não traz a data, o sistema cria a conta etiquetada, avisa todo dia e sobe de tom depois de 5 dias.

**Architecture:** Antes de tudo, conserta a trava anti-duplicata de NF-e que hoje descarta compra em silêncio. Depois, `parseXmlNFe` passa a ler os blocos `cobr` e `pag`; uma função **pura** decide quais boletos nascem; uma camada fina grava; e `processarNFe` ganha **uma** chamada isolada em `try/catch` no fim — se ela falhar, a nota continua atualizando estoque, financeiro e WhatsApp.

**Tech Stack:** Node + Express + TypeScript (API, Railway), Next.js + React + Tailwind + shadcn/ui (site, Vercel), Supabase (PostgreSQL + RLS), Vitest, Zod, fast-xml-parser.

**Spec:** `docs/superpowers/specs/2026-07-31-contas-a-pagar-fase2-design.md` — leia antes de começar.

## Global Constraints

- **TypeScript sempre**, nunca JavaScript puro.
- Nomes de função e variável em **inglês camelCase**; colunas e rotas em **português**; mensagens ao usuário final em **português brasileiro**.
- Validação de entrada com **Zod** em toda rota POST/PATCH.
- Variáveis de ambiente via `process.env` — nunca cravadas no código.
- **Datas nunca passam por `new Date('2026-07-01')`** — esse formato é lido como UTC e já causou defeito neste projeto (datas do Financeiro com 1 dia a menos). Data é **texto `YYYY-MM-DD`**; toda conta de calendário usa `Date.UTC` nos dois lados ou números de ano/mês/dia.
- **Índice único nunca leva cláusula `WHERE`** — índice único parcial não serve de árbitro para `ON CONFLICT`, o banco recusa com erro 42P10 e nada é gravado, em silêncio. Já aconteceu neste projeto nas cotações.
- **A criação de contas nunca pode derrubar o processamento da NF-e.** Toda a Fase 2 fica dentro de `try/catch` no fim de `processarNFe`.
- `parseXmlNFe` **só acrescenta** campos. Nenhum campo existente muda de nome, tipo ou significado.
- Ramo de trabalho: `feat/contas-a-pagar-fase2`, criado a partir de `docs/contas-a-pagar-fase2-spec`.
- Commits em português, prefixo `feat:` / `fix:` / `test:` / `chore:`.

---

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/005_nfe_duplicidade.sql` | Trava anti-duplicata de NF-e (pré-requisito) |
| `supabase/migrations/006_contas_de_nfe.sql` | Ajustes das tabelas de contas |
| `api/src/services/nfeProcessor.test.ts` | Testes de leitura do XML |
| `api/src/services/contas/deNotaFiscal.ts` | Regra pura: quais boletos nascem de uma nota |
| `api/src/services/contas/deNotaFiscal.test.ts` | Testes da regra |
| `api/src/services/contas/gravarDeNota.ts` | Única peça que grava os boletos no banco |
| `api/src/services/contas/avisoBoleto.ts` | Texto da linha de boleto na mensagem da NF-e. Puro |
| `api/src/services/contas/avisoBoleto.test.ts` | Testes do texto |
| `web/app/(app)/contas/lista-contas.tsx` | Tabela de contas, extraída de `page.tsx` |
| `web/app/(app)/contas/dialogo-vencimento.tsx` | Diálogo "Informar data" |

**Modificar:**

| Arquivo | O quê |
|---|---|
| `api/src/services/nfeProcessor.ts` | `nfeJaProcessada` ganha CNPJ; `parseXmlNFe` lê `cobr`/`pag`; `processarNFe` ganha a chamada isolada |
| `api/src/jobs/nfeEmail.ts:89` | Passa o CNPJ do emitente |
| `api/src/webhooks/nfeEmailWebhook.ts:42` | Passa o CNPJ do emitente |
| `api/src/services/contas/resumo.ts` | Vencimento pode ser vazio; grupo novo; escalonamento |
| `api/src/services/contas/resumo.test.ts` | Testes do grupo novo |
| `api/src/jobs/contas.ts` | Busca `created_at` e `nota_fiscal_id`; passa o link |
| `web/app/(app)/contas/page.tsx` | Dois filtros novos; usa os componentes extraídos |

---

### Task 1: Consertar a trava anti-duplicata de NF-e

**Por que primeiro:** `nfeJaProcessada` deduplica por número + fazenda e **ignora o emitente**. Número de NF-e é sequencial **por fornecedor**: quando dois fornecedores baterem o mesmo número, o sistema descarta a compra em silêncio — e, com a Fase 2, o boleto nunca nasce. Construir boleto automático em cima disso é construir sobre areia.

**Files:**
- Create: `supabase/migrations/005_nfe_duplicidade.sql`
- Modify: `api/src/services/nfeProcessor.ts:105-114`
- Modify: `api/src/jobs/nfeEmail.ts:89`
- Modify: `api/src/webhooks/nfeEmailWebhook.ts:42`

**Interfaces:**
- Consumes: nada
- Produces: `nfeJaProcessada(numero: string, emitenteCnpj: string, fazendaId: string): Promise<boolean>`

- [ ] **Step 1: Criar o ramo de trabalho**

```bash
git checkout docs/contas-a-pagar-fase2-spec
git checkout -b feat/contas-a-pagar-fase2
```

- [ ] **Step 2: Escrever a migração**

Criar `supabase/migrations/005_nfe_duplicidade.sql`:

```sql
-- ============================================================
-- AgroMouro — trava anti-duplicata de NF-e (pré-requisito da Fase 2)
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Spec: docs/superpowers/specs/2026-07-31-contas-a-pagar-fase2-design.md
-- ============================================================

-- PASSO 1 — CONFERIR ANTES DE CRIAR O ÍNDICE.
-- Se esta consulta devolver QUALQUER linha, PARE: já existe nota duplicada
-- em produção e o índice abaixo vai falhar. Levar o resultado ao Matheus
-- para ele decidir qual linha fica.
SELECT numero, emitente_cnpj, fazenda_id, count(*) AS repetidas
FROM notas_fiscais
GROUP BY numero, emitente_cnpj, fazenda_id
HAVING count(*) > 1;

-- PASSO 2 — a tranca de verdade.
-- Sem cláusula WHERE, de propósito (ver Global Constraints).
-- O número da NF-e é sequencial POR EMITENTE: sem o CNPJ na chave, a nota
-- 4516 da Triângulo Diesel bloqueia a nota 4516 de qualquer outro fornecedor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfe_numero_emitente_fazenda
  ON notas_fiscais (numero, emitente_cnpj, fazenda_id);

-- PASSO 3 — conferência. Precisa devolver 1 linha.
SELECT indexname FROM pg_indexes
WHERE indexname = 'idx_nfe_numero_emitente_fazenda';
```

- [ ] **Step 3: Trocar a chave no código**

Em `api/src/services/nfeProcessor.ts`, substituir a função inteira das linhas 105-114:

```ts
// ─── Verificar duplicata ──────────────────────────────────────────────────────
// A chave inclui o CNPJ do emitente porque o número da NF-e é sequencial POR
// FORNECEDOR — não é único no mundo. Sem o CNPJ, a nota 4516 de um fornecedor
// faz o sistema descartar em silêncio a nota 4516 de outro: some a compra,
// some o gasto e, na Fase 2, some o boleto.
export async function nfeJaProcessada(
  numero: string,
  emitenteCnpj: string,
  fazenda_id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('notas_fiscais')
    .select('id')
    .eq('numero', numero)
    .eq('emitente_cnpj', emitenteCnpj)
    .eq('fazenda_id', fazenda_id)
    .limit(1)
    .maybeSingle()
  return !!data
}
```

- [ ] **Step 4: Atualizar os dois chamadores**

Em `api/src/jobs/nfeEmail.ts`, linha 89, trocar:

```ts
            const jaExiste = await nfeJaProcessada(nfe.numero, nfe.emitenteCnpj, fazenda.id)
```

Em `api/src/webhooks/nfeEmailWebhook.ts`, linha 42, trocar:

```ts
    if (await nfeJaProcessada(nfe.numero, nfe.emitenteCnpj, fazenda.id)) {
```

- [ ] **Step 5: Conferir que compila e que nada mais chama a função com 2 argumentos**

Run: `cd api && npx tsc --noEmit`
Expected: sem erro. Se sobrar chamador com 2 argumentos, o TypeScript aponta a linha.

Run: `grep -rn "nfeJaProcessada" api/src/`
Expected: 3 ocorrências — a definição e os dois chamadores, todos com 3 argumentos.

- [ ] **Step 6: Rodar a bateria de testes existente**

Run: `cd api && npm test`
Expected: PASS — os testes da Fase 1 continuam verdes (esta tarefa não os toca)

- [ ] **Step 7: Provar o conserto no banco de desenvolvimento**

O defeito é de integração — só aparece contra banco de verdade. Rodar no SQL Editor:

```sql
-- Duas notas com o MESMO número, de fornecedores DIFERENTES.
-- Antes do conserto, a segunda era descartada em silêncio.
INSERT INTO notas_fiscais (numero, emitente_nome, emitente_cnpj, data_emissao, valor_total, status, fazenda_id)
VALUES ('999999', 'FORNECEDOR A (teste)', '11111111000111', '2026-07-31', 100.00, 'processada',
        (SELECT id FROM fazendas WHERE codigo = 'mg')),
       ('999999', 'FORNECEDOR B (teste)', '22222222000122', '2026-07-31', 200.00, 'processada',
        (SELECT id FROM fazendas WHERE codigo = 'mg'));

-- Precisa devolver 2 linhas: as duas entraram.
SELECT numero, emitente_nome FROM notas_fiscais WHERE numero = '999999';

-- Agora a MESMA nota do MESMO fornecedor: precisa FALHAR com erro de chave duplicada.
INSERT INTO notas_fiscais (numero, emitente_nome, emitente_cnpj, data_emissao, valor_total, status, fazenda_id)
VALUES ('999999', 'FORNECEDOR A (teste)', '11111111000111', '2026-07-31', 100.00, 'processada',
        (SELECT id FROM fazendas WHERE codigo = 'mg'));

-- Limpar.
DELETE FROM notas_fiscais WHERE numero = '999999';
```

Expected: as duas primeiras entram; a terceira **falha** com
`duplicate key value violates unique constraint "idx_nfe_numero_emitente_fazenda"`.
Se a terceira entrar, **pare** — o índice não está no lugar.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/005_nfe_duplicidade.sql api/src/services/nfeProcessor.ts api/src/jobs/nfeEmail.ts api/src/webhooks/nfeEmailWebhook.ts
git commit -m "fix: deduplicar NF-e por numero + CNPJ do emitente, com indice unico"
```

---

### Task 2: Ler o quadro de cobrança e a forma de pagamento

Entrega: `parseXmlNFe` devolve as parcelas e a forma de pagamento, sem mudar nada do que já devolvia. Cobre a armadilha objeto-vs-lista, que é o defeito mais provável desta fase.

**Files:**
- Modify: `api/src/services/nfeProcessor.ts:32-102`
- Test: `api/src/services/nfeProcessor.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `type NFeDuplicata = { numero: string; vencimento: string | null; valor: number | null }`
  - `NFeData` ganha `duplicatas: NFeDuplicata[]` e `formaPagamento: string | null`

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/nfeProcessor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseXmlNFe } from './nfeProcessor'

// Monta uma NF-e mínima. `extra` entra dentro de <infNFe>, depois dos itens.
function nfeXml(extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe>
  <ide><nNF>4516</nNF><dhEmi>2026-07-14T18:15:00-03:00</dhEmi></ide>
  <emit><xNome>TRIANGULO DIESEL TRR LTDA</xNome><CNPJ>12345678000199</CNPJ></emit>
  <det><prod><xProd>OLEO DIESEL S10</xProd><qCom>3000</qCom><uCom>L</uCom>
    <vUnCom>6.12</vUnCom><vProd>18360.00</vProd><NCM>27101259</NCM></prod></det>
  <total><ICMSTot><vNF>30600.00</vNF></ICMSTot></total>
  ${extra}
</infNFe></NFe></nfeProc>`
}

const UMA_DUPLICATA = `
  <cobr>
    <fat><nFat>00004516</nFat><vOrig>30600.00</vOrig><vLiq>30600.00</vLiq></fat>
    <dup><nDup>001</nDup><dVenc>2026-07-21</dVenc><vDup>30600.00</vDup></dup>
  </cobr>
  <pag><detPag><tPag>15</tPag><vPag>30600.00</vPag></detPag></pag>`

const TRES_DUPLICATAS = `
  <cobr>
    <fat><nFat>00004516</nFat><vOrig>30600.00</vOrig><vLiq>30600.00</vLiq></fat>
    <dup><nDup>001</nDup><dVenc>2026-08-15</dVenc><vDup>10200.00</vDup></dup>
    <dup><nDup>002</nDup><dVenc>2026-09-15</dVenc><vDup>10200.00</vDup></dup>
    <dup><nDup>003</nDup><dVenc>2026-10-15</dVenc><vDup>10200.00</vDup></dup>
  </cobr>
  <pag><detPag><indPag>1</indPag><tPag>15</tPag><vPag>30600.00</vPag></detPag></pag>`

// Caso ERCAL, medido em 31/07/2026: boleto marcado, e nenhuma data em lugar nenhum.
const SEM_COBRANCA = `
  <pag><detPag><indPag>0</indPag><tPag>15</tPag><vPag>30600.00</vPag></detPag></pag>`

const CARTAO = `
  <cobr>
    <fat><nFat>0051843</nFat><vOrig>355.00</vOrig><vLiq>355.00</vLiq></fat>
    <dup><nDup>001</nDup><dVenc>2026-08-01</dVenc><vDup>355.00</vDup></dup>
  </cobr>
  <pag><detPag><indPag>1</indPag><tPag>05</tPag><vPag>355.00</vPag></detPag></pag>`

describe('parseXmlNFe — o que já era lido continua igual', () => {
  it('nota sem os blocos novos continua sendo lida por inteiro', () => {
    const r = parseXmlNFe(nfeXml())!
    expect(r).not.toBeNull()
    expect(r.numero).toBe('4516')
    expect(r.emitenteNome).toBe('TRIANGULO DIESEL TRR LTDA')
    expect(r.emitenteCnpj).toBe('12345678000199')
    expect(r.valorTotal).toBe(30600)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].description).toBe('OLEO DIESEL S10')
  })

  it('nota sem os blocos novos devolve listas vazias, nao estoura', () => {
    const r = parseXmlNFe(nfeXml())!
    expect(r.duplicatas).toEqual([])
    expect(r.formaPagamento).toBeNull()
  })
})

describe('parseXmlNFe — quadro de cobranca', () => {
  it('uma duplicata devolve uma parcela (o leitor entrega OBJETO, nao lista)', () => {
    const r = parseXmlNFe(nfeXml(UMA_DUPLICATA))!
    expect(r.duplicatas).toHaveLength(1)
    expect(r.duplicatas[0].vencimento).toBe('2026-07-21')
    expect(r.duplicatas[0].valor).toBe(30600)
  })

  it('tres duplicatas devolvem tres parcelas, na ordem', () => {
    const r = parseXmlNFe(nfeXml(TRES_DUPLICATAS))!
    expect(r.duplicatas).toHaveLength(3)
    expect(r.duplicatas.map(d => d.vencimento)).toEqual(['2026-08-15', '2026-09-15', '2026-10-15'])
    expect(r.duplicatas.map(d => d.valor)).toEqual([10200, 10200, 10200])
  })

  it('nota sem quadro de cobranca devolve lista vazia', () => {
    const r = parseXmlNFe(nfeXml(SEM_COBRANCA))!
    expect(r.duplicatas).toEqual([])
  })

  it('duplicata sem data de vencimento vira vencimento vazio, nao data invalida', () => {
    const semData = `<cobr><dup><nDup>001</nDup><vDup>500.00</vDup></dup></cobr>`
    const r = parseXmlNFe(nfeXml(semData))!
    expect(r.duplicatas).toHaveLength(1)
    expect(r.duplicatas[0].vencimento).toBeNull()
    expect(r.duplicatas[0].valor).toBe(500)
  })

  it('quadro de cobranca so com fatura, sem duplicata, devolve lista vazia', () => {
    const soFatura = `<cobr><fat><nFat>001</nFat><vLiq>500.00</vLiq></fat></cobr>`
    expect(parseXmlNFe(nfeXml(soFatura))!.duplicatas).toEqual([])
  })

  it('corta o horario quando o fornecedor manda data com hora', () => {
    const comHora = `<cobr><dup><dVenc>2026-07-21T00:00:00-03:00</dVenc><vDup>10.00</vDup></dup></cobr>`
    expect(parseXmlNFe(nfeXml(comHora))!.duplicatas[0].vencimento).toBe('2026-07-21')
  })
})

describe('parseXmlNFe — forma de pagamento', () => {
  it('boleto vem como 15', () => {
    expect(parseXmlNFe(nfeXml(UMA_DUPLICATA))!.formaPagamento).toBe('15')
  })

  it('codigo de um digito ganha zero a esquerda (5 vira 05)', () => {
    expect(parseXmlNFe(nfeXml(CARTAO))!.formaPagamento).toBe('05')
  })

  it('nota sem bloco de pagamento devolve vazio', () => {
    const soCobr = `<cobr><dup><dVenc>2026-08-01</dVenc><vDup>10.00</vDup></dup></cobr>`
    expect(parseXmlNFe(nfeXml(soCobr))!.formaPagamento).toBeNull()
  })

  it('varios pagamentos: usa o primeiro', () => {
    const dois = `<pag>
      <detPag><tPag>15</tPag><vPag>100.00</vPag></detPag>
      <detPag><tPag>01</tPag><vPag>50.00</vPag></detPag>
    </pag>`
    expect(parseXmlNFe(nfeXml(dois))!.formaPagamento).toBe('15')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — as asserções de `duplicatas` e `formaPagamento` quebram (a propriedade não existe)

- [ ] **Step 3: Acrescentar os tipos**

Em `api/src/services/nfeProcessor.ts`, depois da interface `NFeItem` (linha 41), inserir:

```ts
// Uma parcela do quadro de cobrança da NF-e (bloco <cobr><dup>).
// vencimento é null quando o fornecedor não preencheu — caso ERCAL, medido em 31/07/2026.
export interface NFeDuplicata {
  numero:     string
  vencimento: string | null   // 'YYYY-MM-DD'
  valor:      number | null
}
```

E na interface `NFeData`, acrescentar as duas linhas ao final (antes do `}`):

```ts
  duplicatas:     NFeDuplicata[]
  formaPagamento: string | null   // tPag: '15' boleto, '03' cartão crédito, '05' crédito loja...
```

- [ ] **Step 4: Ler os dois blocos**

Em `api/src/services/nfeProcessor.ts`, dentro de `parseXmlNFe`, logo **antes** da linha `if (!numero || !emitenteNome || items.length === 0) return null`, inserir:

```ts
    // ─── Quadro de cobrança (os boletos) ─────────────────────────────────────
    // ARMADILHA: o leitor devolve OBJETO quando existe uma única <dup> e LISTA
    // quando existem várias — exatamente como já acontece com <det> acima.
    // As três amostras reais de 31/07/2026 têm uma parcela só, então o caminho
    // de várias parcelas não tem prova em produção. Tratar os dois casos.
    const dupRaw = inf.cobr?.dup ?? []
    const dups   = Array.isArray(dupRaw) ? dupRaw : [dupRaw]

    const duplicatas: NFeDuplicata[] = dups
      .filter((d: any) => d && typeof d === 'object')
      .map((d: any, i: number) => ({
        numero:     String(d.nDup ?? i + 1),
        // slice(0,10) porque há fornecedor que manda data com horário junto.
        vencimento: d.dVenc ? String(d.dVenc).slice(0, 10) : null,
        valor:      d.vDup != null ? parseFloat(String(d.vDup)) : null,
      }))

    // ─── Forma de pagamento ──────────────────────────────────────────────────
    // Só tPag. indPag ("à vista"/"a prazo") NÃO é confiável: nas amostras reais
    // a ERCAL marcou "à vista" e boleto ao mesmo tempo, e a Triângulo Diesel nem
    // preencheu. padStart porque o leitor transforma "05" no número 5.
    const detPagRaw = inf.pag?.detPag ?? []
    const detPags   = Array.isArray(detPagRaw) ? detPagRaw : [detPagRaw]
    const primeiroPag = detPags.find((p: any) => p && typeof p === 'object' && p.tPag != null)
    const formaPagamento = primeiroPag ? String(primeiroPag.tPag).padStart(2, '0') : null
```

E trocar a linha do `return` final da função por:

```ts
    return { numero, dataEmissao, emitenteNome, emitenteCnpj, valorTotal, items, duplicatas, formaPagamento }
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — os novos verdes e os da Fase 1 continuam verdes

- [ ] **Step 6: Conferir contra os arquivos reais**

Run:
```bash
cd api && npx tsx -e "
import { readFileSync, readdirSync } from 'fs'
import { parseXmlNFe } from './src/services/nfeProcessor'
const dir = '../.tmp/notas-exemplo'
for (const f of readdirSync(dir).filter(n => n.endsWith('.xml'))) {
  const r = parseXmlNFe(readFileSync(\`\${dir}/\${f}\`, 'utf-8'))
  console.log(r?.emitenteNome, '| forma:', r?.formaPagamento, '| parcelas:', JSON.stringify(r?.duplicatas))
}"
```
Expected, exatamente:
- `TRIANGULO DIESEL TRR LTDA | forma: 15 | parcelas: [{"numero":"1","vencimento":"2026-07-21","valor":30600}]`
- `ERCAL ... | forma: 15 | parcelas: []`
- `METAL AGRICOLA ... | forma: 05 | parcelas: [{"numero":"1","vencimento":"2026-08-01","valor":355}]`

Se algum sair diferente, **pare** — a leitura não está batendo com a realidade.

- [ ] **Step 7: Commit**

```bash
git add api/src/services/nfeProcessor.ts api/src/services/nfeProcessor.test.ts
git commit -m "feat: ler quadro de cobranca e forma de pagamento da NF-e"
```

---

### Task 3: A regra — quais boletos nascem de uma nota

Entrega: dada uma nota lida, a lista exata de contas que devem nascer — e, quando nenhuma nasce, o motivo em português. Puro, sem banco.

**Files:**
- Create: `api/src/services/contas/deNotaFiscal.ts`
- Test: `api/src/services/contas/deNotaFiscal.test.ts`

**Interfaces:**
- Consumes: de `./datas` — `competenciaDoMes`; de `../nfeProcessor` — `NFeDuplicata`
- Produces:
  - `type ContaDeNota = { descricao: string; fornecedor: string; vencimento: string | null; competencia: string; valor: number | null; numero_parcela: number; total_parcelas: number }`
  - `motivoSemBoleto(formaPagamento: string | null): string | null`
  - `contasDaNota(nfe: DadosParaConta): ContaDeNota[]`

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/contas/deNotaFiscal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { contasDaNota, motivoSemBoleto, type DadosParaConta } from './deNotaFiscal'

const base: DadosParaConta = {
  numero:         '4516',
  emitenteNome:   'TRIANGULO DIESEL TRR LTDA',
  dataEmissao:    '2026-07-14T18:15:00-03:00',
  valorTotal:     30600,
  formaPagamento: '15',
  duplicatas:     [{ numero: '001', vencimento: '2026-07-21', valor: 30600 }],
}

describe('motivoSemBoleto', () => {
  it('cartao de credito nao gera boleto', () => {
    expect(motivoSemBoleto('03')).toBe('a nota diz cartão de crédito')
  })
  it('credito loja nao gera boleto', () => {
    expect(motivoSemBoleto('05')).toBe('a nota diz crédito da loja')
  })
  it('dinheiro nao gera boleto', () => {
    expect(motivoSemBoleto('01')).toBe('a nota diz pagamento em dinheiro')
  })
  it('boleto gera', () => {
    expect(motivoSemBoleto('15')).toBeNull()
  })
  it('forma desconhecida gera — na duvida, cria a conta', () => {
    expect(motivoSemBoleto('99')).toBeNull()
  })
  it('sem forma informada gera — ausencia nao e recusa', () => {
    expect(motivoSemBoleto(null)).toBeNull()
  })
})

describe('contasDaNota', () => {
  it('uma duplicata vira uma conta 1 de 1', () => {
    const r = contasDaNota(base)
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBe('2026-07-21')
    expect(r[0].valor).toBe(30600)
    expect(r[0].numero_parcela).toBe(1)
    expect(r[0].total_parcelas).toBe(1)
    expect(r[0].fornecedor).toBe('TRIANGULO DIESEL TRR LTDA')
  })

  it('descricao de parcela unica nao mostra numero de parcela', () => {
    expect(contasDaNota(base)[0].descricao).toBe('TRIANGULO DIESEL TRR LTDA — NF 4516')
  })

  it('tres duplicatas viram tres contas numeradas, cada uma com seu valor', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 10200 },
      { numero: '002', vencimento: '2026-09-15', valor: 10200 },
      { numero: '003', vencimento: '2026-10-15', valor: 10200 },
    ]})
    expect(r).toHaveLength(3)
    expect(r.map(c => c.numero_parcela)).toEqual([1, 2, 3])
    expect(r.every(c => c.total_parcelas === 3)).toBe(true)
    expect(r[1].descricao).toBe('TRIANGULO DIESEL TRR LTDA — NF 4516 (2/3)')
    expect(r.map(c => c.vencimento)).toEqual(['2026-08-15', '2026-09-15', '2026-10-15'])
  })

  it('competencia e o mes do VENCIMENTO, nao o da emissao', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-09-15', valor: 100 },
    ]})
    expect(r[0].competencia).toBe('2026-09-01')
  })

  it('sem duplicata: uma conta sem data, com o valor TOTAL da nota (caso ERCAL)', () => {
    const r = contasDaNota({ ...base, duplicatas: [] })
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBeNull()
    expect(r[0].valor).toBe(30600)
    expect(r[0].numero_parcela).toBe(1)
    expect(r[0].total_parcelas).toBe(1)
  })

  it('sem duplicata: competencia cai no mes da EMISSAO', () => {
    expect(contasDaNota({ ...base, duplicatas: [] })[0].competencia).toBe('2026-07-01')
  })

  it('duplicata sem data tambem vira conta sem data, nao e descartada', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: null, valor: 500 },
    ]})
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBeNull()
    expect(r[0].valor).toBe(500)
    expect(r[0].competencia).toBe('2026-07-01')
  })

  it('parcela com data e sem valor vira conta com data e sem valor', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: null },
    ]})
    expect(r[0].vencimento).toBe('2026-08-15')
    expect(r[0].valor).toBeNull()
  })

  it('cartao de credito nao gera conta nenhuma', () => {
    expect(contasDaNota({ ...base, formaPagamento: '05' })).toEqual([])
  })

  it('soma das parcelas diferente do total da nota gera assim mesmo', () => {
    const r = contasDaNota({ ...base, valorTotal: 30600, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 10000 },
      { numero: '002', vencimento: '2026-09-15', valor: 10000 },
    ]})
    expect(r).toHaveLength(2)
    expect(r.map(c => c.valor)).toEqual([10000, 10000])
  })

  it('data de emissao ja em formato curto tambem funciona', () => {
    const r = contasDaNota({ ...base, dataEmissao: '2026-07-14', duplicatas: [] })
    expect(r[0].competencia).toBe('2026-07-01')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — `Failed to resolve import "./deNotaFiscal"`

- [ ] **Step 3: Escrever a implementação mínima**

Criar `api/src/services/contas/deNotaFiscal.ts`:

```ts
import { competenciaDoMes } from './datas'
import type { NFeDuplicata } from '../nfeProcessor'

// O que esta regra precisa saber de uma NF-e. Só isto — não recebe a nota inteira,
// para que o teste não precise montar item, NCM e imposto que não influenciam nada.
export type DadosParaConta = {
  numero:         string
  emitenteNome:   string
  dataEmissao:    string          // 'YYYY-MM-DD' ou ISO completo
  valorTotal:     number
  formaPagamento: string | null
  duplicatas:     NFeDuplicata[]
}

export type ContaDeNota = {
  descricao:      string
  fornecedor:     string
  vencimento:     string | null   // 'YYYY-MM-DD' — vazio quando o fornecedor não informou
  competencia:    string          // 'YYYY-MM-01'
  valor:          number | null
  numero_parcela: number
  total_parcelas: number
}

// Formas de pagamento que NÃO geram boleto para o Matheus pagar.
// A cobrança vem pela fatura do cartão, ou o dinheiro já saiu.
// ⚠️ Decidido com uma amostra só (31/07/2026): a METAL AGRICOLA usou '05'
// ("crédito loja") para o que o texto livre chama de cartão de crédito.
// Confirmar contra o manual vigente da NF-e antes de acrescentar código novo.
const MOTIVO_SEM_BOLETO: Record<string, string> = {
  '01': 'a nota diz pagamento em dinheiro',
  '03': 'a nota diz cartão de crédito',
  '04': 'a nota diz cartão de débito',
  '05': 'a nota diz crédito da loja',
}

// Devolve o motivo em português quando a nota NÃO deve gerar boleto, ou null quando deve.
// Na dúvida (código desconhecido ou ausente), GERA: um boleto a mais é dispensado
// num toque; um boleto a menos vence sem ninguém avisar.
export function motivoSemBoleto(formaPagamento: string | null): string | null {
  if (!formaPagamento) return null
  return MOTIVO_SEM_BOLETO[formaPagamento] ?? null
}

// Mês de uma data 'YYYY-MM-DD' (ou ISO completo) como primeiro dia do mês.
function mesDe(dataISO: string): string {
  const [ano, mes] = dataISO.slice(0, 10).split('-').map(Number)
  return competenciaDoMes(ano, mes)
}

export function contasDaNota(nfe: DadosParaConta): ContaDeNota[] {
  if (motivoSemBoleto(nfe.formaPagamento)) return []

  const fornecedor = nfe.emitenteNome
  const mesEmissao = mesDe(nfe.dataEmissao)

  // Sem quadro de cobrança: uma conta sem data, com o valor total da nota.
  // Não descartar — é o caso ERCAL, e descartar seria perder R$ 8 mil em silêncio.
  if (nfe.duplicatas.length === 0) {
    return [{
      descricao:      `${fornecedor} — NF ${nfe.numero}`,
      fornecedor,
      vencimento:     null,
      competencia:    mesEmissao,
      valor:          nfe.valorTotal,
      numero_parcela: 1,
      total_parcelas: 1,
    }]
  }

  const total = nfe.duplicatas.length

  return nfe.duplicatas.map((d, i) => ({
    descricao:      total > 1
                      ? `${fornecedor} — NF ${nfe.numero} (${i + 1}/${total})`
                      : `${fornecedor} — NF ${nfe.numero}`,
    fornecedor,
    vencimento:     d.vencimento,
    // Parcela sem data não tem mês de vencimento: cai no mês da emissão.
    competencia:    d.vencimento ? mesDe(d.vencimento) : mesEmissao,
    valor:          d.valor,
    numero_parcela: i + 1,
    total_parcelas: total,
  }))
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — todos verdes

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/deNotaFiscal.ts api/src/services/contas/deNotaFiscal.test.ts
git commit -m "feat: regra de quais boletos nascem de uma NF-e (puro, sem banco)"
```

---

### Task 4: Os ajustes no banco

Entrega: o arquivo de migração pronto para colar no Supabase, com as conferências.

**Files:**
- Create: `supabase/migrations/006_contas_de_nfe.sql`

**Interfaces:**
- Consumes: tabelas `contas_a_pagar` e `notas_fiscais` (Fase 1 + schema existente)
- Produces: `contas_a_pagar.vencimento` opcional; colunas `numero_parcela`, `total_parcelas`; índice `idx_conta_nota_parcela`; `notas_fiscais.forma_pagamento`

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/006_contas_de_nfe.sql`:

```sql
-- ============================================================
-- AgroMouro — Contas a Pagar, Fase 2 (boletos vindos da NF-e)
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Rodar DEPOIS de 005_nfe_duplicidade.sql.
-- Spec: docs/superpowers/specs/2026-07-31-contas-a-pagar-fase2-design.md
-- ============================================================

-- 1. Conta pode nascer sem data de vencimento (caso ERCAL: fornecedor não informou).
--    "Falta vencimento" NÃO vira status: é derivado da coluna vazia, do mesmo jeito
--    que "atrasada" já é derivada. Guardar como estado criaria uma segunda verdade
--    que precisaria ser mantida em dia.
ALTER TABLE contas_a_pagar ALTER COLUMN vencimento DROP NOT NULL;

-- 2. Qual parcela desta nota é esta conta ("2 de 3").
ALTER TABLE contas_a_pagar
  ADD COLUMN IF NOT EXISTS numero_parcela SMALLINT,
  ADD COLUMN IF NOT EXISTS total_parcelas SMALLINT;

-- 3. Trava de duplicidade: uma conta por nota por parcela.
--    SEM cláusula WHERE, de propósito — índice único PARCIAL não serve de árbitro
--    para o ON CONFLICT do upsert: o banco recusa com 42P10 e nada é gravado, em
--    silêncio. Já aconteceu neste projeto nas cotações (ver o cabeçalho de
--    api/src/database/migrations/011_cotacoes_commodities.sql).
--    NULL é distinto de NULL num índice único, então conta fixa (nota_fiscal_id
--    vazio) continua sem colidir com outra conta fixa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conta_nota_parcela
  ON contas_a_pagar (nota_fiscal_id, numero_parcela);

-- 4. Qual forma de pagamento o sistema LEU na nota. Serve para descobrir por que
--    uma nota não gerou boleto, em vez de adivinhar.
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
```

- [ ] **Step 2: Rodar a migração no Supabase**

Abrir o painel do Supabase → **SQL Editor** → colar o arquivo inteiro → **Run**.

- [ ] **Step 3: Conferir que subiu do jeito certo**

Rodar no mesmo editor. **As quatro consultas precisam devolver o esperado:**

```sql
-- (a) vencimento passou a aceitar vazio → is_nullable = 'YES'
SELECT is_nullable FROM information_schema.columns
WHERE table_name = 'contas_a_pagar' AND column_name = 'vencimento';

-- (b) as duas colunas novas existem → 2 linhas
SELECT column_name FROM information_schema.columns
WHERE table_name = 'contas_a_pagar' AND column_name IN ('numero_parcela','total_parcelas');

-- (c) o índice da idempotência existe → 1 linha
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_conta_nota_parcela';

-- (d) a coluna de auditoria existe → 1 linha
SELECT column_name FROM information_schema.columns
WHERE table_name = 'notas_fiscais' AND column_name = 'forma_pagamento';

-- (e) NADA se perdeu: guardar este número e comparar depois do deploy
SELECT count(*) AS contas_antes FROM contas_a_pagar;
```

Expected: (a) `YES` · (b) 2 linhas · (c) 1 linha · (d) 1 linha · (e) anotar o número.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_contas_de_nfe.sql
git commit -m "feat: vencimento opcional, parcelas e forma de pagamento no banco"
```

---

### Task 5: Gravar os boletos e ligar no processador de NF-e

Entrega: os boletos nascem no banco quando a nota é processada — e, se essa parte falhar, a nota **continua** atualizando estoque, financeiro e WhatsApp.

**Files:**
- Create: `api/src/services/contas/gravarDeNota.ts`
- Modify: `api/src/services/nfeProcessor.ts:190-200` e `:285-296`

**Interfaces:**
- Consumes: de `./deNotaFiscal` — `contasDaNota`, `motivoSemBoleto`, `ContaDeNota`, `DadosParaConta`; de `../supabase` — `supabase`
- Produces: `gravarContasDaNota(nfe: DadosParaConta, notaFiscalId: string, fazendaId: string): Promise<ContaDeNota[]>` (devolve as contas efetivamente criadas; lista vazia quando não há o que criar)

- [ ] **Step 1: Escrever a camada que grava**

Criar `api/src/services/contas/gravarDeNota.ts`:

```ts
import { supabase } from '../supabase'
import { contasDaNota, type ContaDeNota, type DadosParaConta } from './deNotaFiscal'

// Grava no banco os boletos de uma NF-e. Devolve o que foi criado.
//
// Idempotente: rodar duas vezes para a mesma nota não duplica, porque o índice
// único (nota_fiscal_id, numero_parcela) arbitra o conflito.
export async function gravarContasDaNota(
  nfe: DadosParaConta,
  notaFiscalId: string,
  fazendaId: string,
): Promise<ContaDeNota[]> {
  const contas = contasDaNota(nfe)
  if (contas.length === 0) return []

  const linhas = contas.map(c => ({
    descricao:      c.descricao,
    fornecedor:     c.fornecedor,
    categoria:      'insumos',
    competencia:    c.competencia,
    vencimento:     c.vencimento,
    valor:          c.valor,
    // false: é o valor real do boleto, não estimativa de conta fixa.
    valor_estimado: false,
    // 'aberta' e nunca 'aguardando': a nota CHEGOU e o valor é real.
    // 'aguardando' significa "a conta ainda não chegou" — outra coisa.
    status:         'aberta',
    nota_fiscal_id: notaFiscalId,
    numero_parcela: c.numero_parcela,
    total_parcelas: c.total_parcelas,
    fazenda_id:     fazendaId,
  }))

  const { data, error } = await supabase
    .from('contas_a_pagar')
    .upsert(linhas, { onConflict: 'nota_fiscal_id,numero_parcela', ignoreDuplicates: true })
    .select('id')

  if (error) throw error

  // Quando o upsert ignora duplicata, `data` volta menor que `linhas`.
  // Devolvemos o que a REGRA decidiu, não o que o banco aceitou: quem chama
  // usa isto para escrever a mensagem, e a mensagem deve descrever a nota.
  console.log(`[Contas] NF ${nfe.numero}: ${contas.length} boleto(s) previsto(s), ${data?.length ?? 0} gravado(s).`)
  return contas
}
```

- [ ] **Step 2: Guardar a forma de pagamento na nota**

Em `api/src/services/nfeProcessor.ts`, no insert de `notas_fiscais` (linhas 190-200), acrescentar uma linha antes de `fazenda_id`:

```ts
        forma_pagamento: nfe.formaPagamento,
```

E, no início de `processarNFe` (linha 179), acrescentar `formaPagamento` e `duplicatas` à desestruturação:

```ts
  const { numero, dataEmissao, emitenteNome, emitenteCnpj, valorTotal, items, duplicatas, formaPagamento } = nfe
```

- [ ] **Step 3: Ligar a criação de boletos, isolada**

Em `api/src/services/nfeProcessor.ts`, logo **depois** do bloco `// 3. Lançamento financeiro` e **antes** de `await supabase.from('notas_fiscais').update({ status: 'processada' })`, inserir:

```ts
    // 4. Boletos da nota (Fase 2) — PARAFUSADO POR FORA, NUNCA PRÉ-REQUISITO.
    //
    // Este try/catch é a rede de proteção inteira da Fase 2. O processamento de
    // NF-e alimenta estoque, financeiro e WhatsApp sem ninguém tocar; se a criação
    // de boletos estourar (arquivo estranho, banco fora do ar, parcela em formato
    // novo), a nota TEM que continuar entrando. Um boleto perdido custa um aviso;
    // uma nota perdida custa estoque e financeiro errados por semanas.
    let contasCriadas: ContaDeNota[] = []
    let erroContas = false
    try {
      contasCriadas = await gravarContasDaNota(
        { numero, emitenteNome, dataEmissao, valorTotal, formaPagamento, duplicatas },
        nfeId,
        fazenda_id,
      )
    } catch (err) {
      erroContas = true
      console.error(
        `[NFeProcessor] NF-e ${numero}: falha ao criar boletos (a nota foi processada assim mesmo):`,
        err instanceof Error ? err.message : err,
      )
    }
```

E acrescentar os imports no topo do arquivo, junto dos outros:

```ts
import { gravarContasDaNota } from './contas/gravarDeNota'
import { motivoSemBoleto, type ContaDeNota } from './contas/deNotaFiscal'
```

- [ ] **Step 4: Conferir que compila e que os testes seguem verdes**

Run: `cd api && npx tsc --noEmit && npm test`
Expected: sem erro de tipo; todos os testes verdes

- [ ] **Step 5: Provar o isolamento na marra**

Este é o teste que mais importa desta fase, e ele é manual porque prova comportamento de integração.

Editar temporariamente `gravarDeNota.ts` para estourar na primeira linha da função:

```ts
  throw new Error('EXPLOSAO DE TESTE')
```

Run:
```bash
cd api && npx tsx -e "
import { readFileSync } from 'fs'
import { parseXmlNFe } from './src/services/nfeProcessor'
const r = parseXmlNFe(readFileSync('../.tmp/notas-exemplo/0100004516_131267724651671_v4.00-procnfe.xml','utf-8'))
console.log('leitura ok:', r?.numero, r?.duplicatas.length)"
```

Depois, com o servidor local rodando (`npm run dev`), reenviar a nota pelo webhook e conferir nos logs que aparece **`falha ao criar boletos (a nota foi processada assim mesmo)`** e que a nota chegou a `status = 'processada'`.

**Desfazer a explosão antes de seguir.**

Expected: a nota processa por inteiro mesmo com a criação de boletos quebrada. Se a nota ficar com `status = 'erro'`, **pare** — o isolamento não está funcionando e todo o resto da fase fica perigoso.

- [ ] **Step 6: Commit**

```bash
git add api/src/services/contas/gravarDeNota.ts api/src/services/nfeProcessor.ts
git commit -m "feat: criar boletos da NF-e, isolados do processamento da nota"
```

---

### Task 6: A linha do boleto na mensagem da nota

Entrega: a mensagem de "NF-e processada" que o Matheus já recebe passa a dizer o que o sistema concluiu sobre o boleto — inclusive quando decidiu **não** criar nenhum.

**Files:**
- Create: `api/src/services/contas/avisoBoleto.ts`
- Test: `api/src/services/contas/avisoBoleto.test.ts`
- Modify: `api/src/services/nfeProcessor.ts:298-312`

**Interfaces:**
- Consumes: de `./deNotaFiscal` — `ContaDeNota`; de `./datas` — `diasEntre`
- Produces: `linhaBoleto(contas: ContaDeNota[], motivo: string | null, hojeISO: string, houveErro: boolean): string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/contas/avisoBoleto.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { linhaBoleto } from './avisoBoleto'
import type { ContaDeNota } from './deNotaFiscal'

const HOJE = '2026-07-14'

function conta(over: Partial<ContaDeNota> = {}): ContaDeNota {
  return {
    descricao: 'X — NF 1', fornecedor: 'X', vencimento: '2026-07-21',
    competencia: '2026-07-01', valor: 30600, numero_parcela: 1, total_parcelas: 1, ...over,
  }
}

describe('linhaBoleto', () => {
  it('um boleto mostra valor, data e quantos dias faltam', () => {
    const t = linhaBoleto([conta()], null, HOJE, false)
    expect(t).toContain('R$ 30.600,00')
    expect(t).toContain('21/07')
    expect(t).toContain('em 7 dias')
  })

  it('boleto que vence hoje nao diz "em 0 dias"', () => {
    const t = linhaBoleto([conta({ vencimento: HOJE })], null, HOJE, false)
    expect(t).toContain('hoje')
    expect(t).not.toContain('0 dias')
  })

  it('boleto que vence amanha fala no singular', () => {
    const t = linhaBoleto([conta({ vencimento: '2026-07-15' })], null, HOJE, false)
    expect(t).toContain('em 1 dia')
    expect(t).not.toContain('1 dias')
  })

  it('tres boletos mostram as tres datas', () => {
    const t = linhaBoleto([
      conta({ vencimento: '2026-08-15', valor: 10200, numero_parcela: 1, total_parcelas: 3 }),
      conta({ vencimento: '2026-09-15', valor: 10200, numero_parcela: 2, total_parcelas: 3 }),
      conta({ vencimento: '2026-10-15', valor: 10200, numero_parcela: 3, total_parcelas: 3 }),
    ], null, HOJE, false)
    expect(t).toContain('3 boletos')
    expect(t).toContain('15/08')
    expect(t).toContain('15/09')
    expect(t).toContain('15/10')
  })

  it('boleto sem data pede a data e manda o link', () => {
    const t = linhaBoleto([conta({ vencimento: null })], null, HOJE, false)
    expect(t).toContain('sem data')
    expect(t).toContain('/contas')
  })

  it('quando nao cria, DIZ o motivo — recusa nunca e silenciosa', () => {
    const t = linhaBoleto([], 'a nota diz cartão de crédito', HOJE, false)
    expect(t).toContain('Sem boleto')
    expect(t).toContain('cartão de crédito')
  })

  it('quando a criacao falhou, avisa que falhou — nao finge que nao tinha boleto', () => {
    const t = linhaBoleto([], null, HOJE, true)
    expect(t).toContain('não consegui')
    expect(t).toContain('/contas')
  })

  it('nada a dizer devolve string vazia', () => {
    expect(linhaBoleto([], null, HOJE, false)).toBe('')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — `Failed to resolve import "./avisoBoleto"`

- [ ] **Step 3: Escrever a implementação mínima**

Criar `api/src/services/contas/avisoBoleto.ts`:

```ts
import { diasEntre } from './datas'
import type { ContaDeNota } from './deNotaFiscal'

// Endereço do site. Variável de ambiente porque quem manda no domínio não sou
// eu: mudou o endereço, muda a variável — não o código.
const APP_URL = process.env.APP_URL ?? 'https://agromouro.com.br'

function reais(v: number | null): string {
  if (v == null) return 'valor a definir'
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function quando(vencimentoISO: string, hojeISO: string): string {
  const dias = diasEntre(hojeISO, vencimentoISO)
  if (dias < 0)  return `venceu há ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? 's' : ''}`
  if (dias === 0) return 'vence hoje'
  return `em ${dias} dia${dias > 1 ? 's' : ''}`
}

// A linha de boleto da mensagem de "NF-e processada".
// O sistema SEMPRE diz o que concluiu: criou, não criou e por quê, ou falhou.
// Recusa silenciosa faria um boleto sumir sem ninguém perceber.
export function linhaBoleto(
  contas: ContaDeNota[],
  motivo: string | null,
  hojeISO: string,
  houveErro: boolean,
): string {
  if (houveErro) {
    return `\n\n⚠️ *Boleto:* não consegui registrar o boleto desta nota. Confira em ${APP_URL}/contas`
  }

  if (motivo) return `\n\n💳 *Sem boleto* — ${motivo}`

  if (contas.length === 0) return ''

  const semData = contas.filter(c => !c.vencimento)
  if (semData.length === contas.length) {
    return `\n\n💳 *Boleto sem data de vencimento* — informe em ${APP_URL}/contas?filtro=sem-vencimento`
  }

  if (contas.length === 1) {
    const c = contas[0]
    return `\n\n💳 *Boleto:* ${reais(c.valor)} vence ${ddmm(c.vencimento!)} (${quando(c.vencimento!, hojeISO)})`
  }

  const datas = contas.map(c => (c.vencimento ? ddmm(c.vencimento) : 'sem data')).join(', ')
  const total = contas.reduce((s, c) => s + (c.valor ?? 0), 0)
  return `\n\n💳 *${contas.length} boletos:* ${datas} — ${reais(total)} no total`
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — todos verdes

- [ ] **Step 5: Ligar na mensagem da nota**

Em `api/src/services/nfeProcessor.ts`, logo **antes** de `await enviarMensagem(phone, mensagem)` (linha 312), inserir:

```ts
    mensagem += linhaBoleto(
      contasCriadas,
      motivoSemBoleto(formaPagamento),
      dataFormatada,
      erroContas,
    )
```

E acrescentar ao import do topo:

```ts
import { linhaBoleto } from './contas/avisoBoleto'
```

- [ ] **Step 6: Conferir que compila e que os testes seguem verdes**

Run: `cd api && npx tsc --noEmit && npm test`
Expected: sem erro; todos verdes

- [ ] **Step 7: Commit**

```bash
git add api/src/services/contas/avisoBoleto.ts api/src/services/contas/avisoBoleto.test.ts api/src/services/nfeProcessor.ts
git commit -m "feat: linha de boleto na mensagem de NF-e processada"
```

---

### Task 7: O aviso diário — grupo novo, escalonamento e link

Entrega: conta sem vencimento aparece todo dia num grupo próprio e, depois de 5 dias sem resposta, sobe para o grupo crítico junto das atrasadas.

**Files:**
- Modify: `api/src/services/contas/resumo.ts`
- Modify: `api/src/services/contas/resumo.test.ts`
- Modify: `api/src/jobs/contas.ts:25-45`

**Interfaces:**
- Consumes: de `./datas` — `diasEntre`
- Produces:
  - `ContaResumo` ganha `vencimento: string | null` e `criada_em: string`
  - `Resumo` ganha `semVencimento: ContaResumo[]` e `semVencimentoAntigas: ContaResumo[]`

- [ ] **Step 1: Acrescentar os testes que falham**

Em `api/src/services/contas/resumo.test.ts`, trocar a função `conta` do topo por esta versão (ela ganha dois campos) e acrescentar o bloco `describe` novo ao final do arquivo:

```ts
function conta(over: Partial<ContaResumo> = {}): ContaResumo {
  return {
    descricao: 'Energia', fornecedor: 'Cemig', vencimento: '2026-08-10',
    valor: 890, status: 'aberta', avisar_dias_antes: 3,
    criada_em: '2026-07-29', ...over,
  }
}
```

```ts
describe('conta sem vencimento', () => {
  it('entra no grupo proprio, e em nenhum outro', () => {
    const r = montarResumo([conta({ vencimento: null })], HOJE)
    expect(r.semVencimento).toHaveLength(1)
    expect(r.atrasadas).toHaveLength(0)
    expect(r.vencendo).toHaveLength(0)
    expect(r.naoChegaram).toHaveLength(0)
  })

  it('nao e atrasada — nao existe data para dizer que passou', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-01-01' })], HOJE)
    expect(r.atrasadas).toHaveLength(0)
  })

  it('com 5 dias ainda NAO subiu de tom', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-07-24' })], HOJE)
    expect(r.semVencimento).toHaveLength(1)
    expect(r.semVencimentoAntigas).toHaveLength(0)
  })

  it('com 6 dias sobe para o grupo critico', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-07-23' })], HOJE)
    expect(r.semVencimentoAntigas).toHaveLength(1)
    expect(r.semVencimento).toHaveLength(0)
  })

  it('paga ou dispensada sem vencimento nao entra em aviso nenhum', () => {
    const r = montarResumo([
      conta({ vencimento: null, status: 'paga' }),
      conta({ vencimento: null, status: 'dispensada' }),
    ], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('resumo so com conta sem vencimento NAO e vazio', () => {
    expect(resumoVazio(montarResumo([conta({ vencimento: null })], HOJE))).toBe(false)
  })

  it('o texto descreve o grupo e leva o link', () => {
    const txt = textoResumo(montarResumo([conta({ vencimento: null })], HOJE), HOJE)
    expect(txt).toContain('sem vencimento')
    expect(txt).toContain('/contas?filtro=sem-vencimento')
  })

  it('o texto da conta antiga diz ha quantos dias esta esperando', () => {
    const txt = textoResumo(montarResumo([conta({ vencimento: null, criada_em: '2026-07-20' })], HOJE), HOJE)
    expect(txt).toContain('9 dias')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que ele falha**

Run: `cd api && npm test`
Expected: FAIL — `semVencimento` não existe no tipo `Resumo`

- [ ] **Step 3: Escrever a implementação**

Em `api/src/services/contas/resumo.ts`, substituir do topo até o fim de `resumoVazio` por:

```ts
import { diasEntre } from './datas'

// Endereço do site — mesma variável usada em avisoBoleto.ts.
const APP_URL = process.env.APP_URL ?? 'https://agromouro.com.br'

// Dias sem resposta a partir dos quais a conta sem data sobe de tom.
// Motivo do escalonamento: conta sem vencimento NUNCA pode ficar "atrasada",
// porque não há data para comparar — o boleto vence no mundo real e o sistema
// não tem como saber. É o único ponto cego, então ele grita em vez de calar.
const DIAS_PARA_ESCALAR = 5

export type ContaResumo = {
  descricao:         string
  fornecedor:        string | null
  vencimento:        string | null   // vazio = o fornecedor não informou
  valor:             number | null
  status:            string
  avisar_dias_antes: number
  criada_em:         string          // 'YYYY-MM-DD' — base do escalonamento
}

export type Resumo = {
  atrasadas:            ContaResumo[]
  vencendo:             ContaResumo[]
  naoChegaram:          ContaResumo[]
  semVencimento:        ContaResumo[]
  semVencimentoAntigas: ContaResumo[]
}

const ENCERRADAS = new Set(['paga', 'dispensada'])

export function montarResumo(contas: ContaResumo[], hojeISO: string): Resumo {
  const r: Resumo = {
    atrasadas: [], vencendo: [], naoChegaram: [],
    semVencimento: [], semVencimentoAntigas: [],
  }

  for (const c of contas) {
    if (ENCERRADAS.has(c.status)) continue

    // Sem data não dá para calcular atraso. Vai para o grupo próprio, e sobe
    // de tom conforme envelhece sem resposta.
    if (!c.vencimento) {
      const esperando = diasEntre(c.criada_em, hojeISO)
      if (esperando > DIAS_PARA_ESCALAR) r.semVencimentoAntigas.push(c)
      else                                r.semVencimento.push(c)
      continue
    }

    const dias = diasEntre(hojeISO, c.vencimento)

    // Uma conta aguardando (não chegou) que venceu já deve ser alertada como atrasada,
    // pois "atrasada" é a situação mais urgente — o fornecedor não apenas esqueceu,
    // mas agora deveria ter chegado.
    if (dias < 0) { r.atrasadas.push(c); continue }
    if (dias > c.avisar_dias_antes) continue

    if (c.status === 'aguardando') r.naoChegaram.push(c)
    else                           r.vencendo.push(c)
  }
  return r
}

export function resumoVazio(r: Resumo): boolean {
  return r.atrasadas.length === 0 && r.vencendo.length === 0 &&
         r.naoChegaram.length === 0 && r.semVencimento.length === 0 &&
         r.semVencimentoAntigas.length === 0
}
```

E, em `textoResumo`, trocar a linha do grupo de atrasadas e acrescentar os dois grupos novos. Substituir a função inteira por:

```ts
export function textoResumo(r: Resumo, hojeISO: string): string {
  const linhas: string[] = [`📋 *Contas — ${ddmm(hojeISO)}*`]

  const criticas = r.atrasadas.length + r.semVencimentoAntigas.length
  if (criticas > 0) {
    linhas.push(`\n🔴 ${criticas} urgente${criticas > 1 ? 's' : ''}:`)
    for (const c of r.atrasadas) {
      linhas.push(`• ${c.descricao} — venceu ${ddmm(c.vencimento!)}, ${reais(c.valor)}`)
    }
    for (const c of r.semVencimentoAntigas) {
      const dias = diasEntre(c.criada_em, hojeISO)
      linhas.push(`• ${c.descricao} — ${reais(c.valor)}, há ${dias} dias sem vencimento informado`)
    }
  }
  if (r.vencendo.length) {
    linhas.push(`\n🟡 ${r.vencendo.length} vencendo:`)
    for (const c of r.vencendo) linhas.push(`• ${c.descricao} — dia ${ddmm(c.vencimento!)}, ${reais(c.valor)}`)
  }
  if (r.naoChegaram.length) {
    const n = r.naoChegaram.length
    linhas.push(`\n⏳ ${n} ainda ${n > 1 ? 'não chegaram' : 'não chegou'}:`)
    for (const c of r.naoChegaram) linhas.push(`• ${c.descricao} — esperada dia ${ddmm(c.vencimento!)}`)
  }
  if (r.semVencimento.length) {
    linhas.push(`\n❓ ${r.semVencimento.length} sem vencimento:`)
    for (const c of r.semVencimento) linhas.push(`• ${c.descricao} — ${reais(c.valor)}`)
  }
  if (r.semVencimento.length || r.semVencimentoAntigas.length) {
    linhas.push(`👉 ${APP_URL}/contas?filtro=sem-vencimento`)
  }
  return linhas.join('\n')
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd api && npm test`
Expected: PASS — os novos verdes e os oito testes originais de `resumo.test.ts` continuam verdes

- [ ] **Step 5: Alimentar os campos novos na tarefa diária**

Em `api/src/jobs/contas.ts`, trocar a consulta (linha 27) por:

```ts
        .select('descricao, fornecedor, vencimento, valor, status, created_at, contas_recorrentes(avisar_dias_antes)')
```

E o mapeamento (linhas 36-43) por:

```ts
      const paraResumo: ContaResumo[] = (contas ?? []).map((c: any) => ({
        descricao:         c.descricao,
        fornecedor:        c.fornecedor,
        vencimento:        c.vencimento,
        valor:             c.valor,
        status:            c.status,
        avisar_dias_antes: c.contas_recorrentes?.avisar_dias_antes ?? 3,
        // created_at vem como timestamp completo; o escalonamento só quer o dia.
        criada_em:         String(c.created_at ?? '').slice(0, 10),
      }))
```

E, no cálculo do nível do alerta, incluir as contas antigas sem vencimento:

```ts
      const nivel = (resumo.atrasadas.length > 0 || resumo.semVencimentoAntigas.length > 0)
        ? 'critico'
        : 'aviso'
```

- [ ] **Step 6: Conferir que compila e que os testes seguem verdes**

Run: `cd api && npx tsc --noEmit && npm test`
Expected: sem erro; todos verdes

- [ ] **Step 7: Commit**

```bash
git add api/src/services/contas/resumo.ts api/src/services/contas/resumo.test.ts api/src/jobs/contas.ts
git commit -m "feat: grupo sem vencimento no aviso diario, com escalonamento e link"
```

---

### Task 8: A tela — extrair a lista e acrescentar os dois filtros

Entrega: a página separa conta fixa de boleto de nota, tem o filtro "falta vencimento" com contador, e a tabela sai de `page.tsx` para um componente próprio.

**Files:**
- Create: `web/app/(app)/contas/tipos.ts`
- Create: `web/app/(app)/contas/lista-contas.tsx`
- Modify: `web/app/(app)/contas/page.tsx:27-36`, `:80-85`, `:55-73`, `:87-95`, `:168-171`, `:388+`

**Interfaces:**
- Consumes: nada
- Produces:
  - `tipos.ts` exporta `Conta` e `ContaAPI`
  - componente `<ListaContas contas={...} hoje={...} onPagar={...} onDispensar={...} onDesfazer={...} onEditarValor={...} onInformarData={...} />`

**Nota:** `page.tsx` já tem 633 linhas e esta fase acrescenta mais. Extrair a tabela não é refatoração à toa — é a peça que estamos mexendo ficando grande demais para ser mexida com segurança.

- [ ] **Step 1: Tirar os tipos de dentro da página**

Os tipos precisam sair de `page.tsx` para um arquivo próprio. Se ficarem lá, os
componentes novos importam da página e a página importa deles — **importação
circular**, que quebra de um jeito confuso de diagnosticar.

Criar `web/app/(app)/contas/tipos.ts`:

```ts
export type Conta = {
  id: string
  descricao: string
  fornecedor: string | null
  categoria: string | null
  vencimento: string | null   // 'YYYY-MM-DD' — vazio quando a NF-e não informou
  valor: number | null
  valor_estimado: boolean
  status: 'aguardando' | 'aberta' | 'paga' | 'dispensada'
}

export type ContaAPI = Conta & {
  data_pagamento: string | null
  valor_pago: number | null
  observacao: string | null
  nota_fiscal_id: string | null
  numero_parcela: number | null
  total_parcelas: number | null
  created_at: string
  contas_recorrentes: { avisar_dias_antes: number; periodicidade: string } | null
}
```

Em `web/app/(app)/contas/page.tsx`, **apagar** os blocos `type Conta = {...}`
(linhas 27-36) e `type ContaAPI = Conta & {...}` (linhas 80-85), e acrescentar
ao topo, junto dos outros imports:

```ts
import type { Conta, ContaAPI } from './tipos'
```

- [ ] **Step 2: Proteger os cálculos contra vencimento vazio**

Em `web/app/(app)/contas/page.tsx`, no laço de `calcularTotais` (por volta da linha 55-73), inserir como **primeira** linha do corpo do laço:

```ts
    // Conta sem vencimento não entra em nenhum dos três números: não há data
    // para dizer se está atrasada nem se vence esta semana. Ela é cobrada pelo
    // filtro próprio e pelo aviso diário, não por um total que mentiria.
    if (!c.vencimento) continue
```

E, no filtro da lista (linha 170), trocar por:

```ts
    if (filtro === 'atrasada') return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
```

- [ ] **Step 3: Acrescentar os dois filtros novos**

Em `web/app/(app)/contas/page.tsx`, trocar o bloco de tipos e constantes de filtro (linhas 87-95) por:

```ts
type FiltroStatus = 'todas' | 'sem-vencimento' | 'aguardando' | 'aberta' | 'atrasada' | 'paga'
type FiltroTipo   = 'todos' | 'fixas' | 'nota'

const FILTROS: { value: FiltroStatus; label: string }[] = [
  { value: 'todas',          label: 'Todas' },
  { value: 'sem-vencimento', label: 'Falta vencimento' },
  { value: 'aguardando',     label: 'Aguardando' },
  { value: 'aberta',         label: 'Abertas' },
  { value: 'atrasada',       label: 'Atrasadas' },
  { value: 'paga',           label: 'Pagas' },
]

// Conta fixa veio de uma regra recorrente; boleto veio de uma nota fiscal.
// Nenhuma coluna nova no banco: a informação já existe nas duas chaves.
const FILTROS_TIPO: { value: FiltroTipo; label: string }[] = [
  { value: 'todos', label: 'Todas' },
  { value: 'fixas', label: 'Contas fixas' },
  { value: 'nota',  label: 'Boletos de nota' },
]
```

- [ ] **Step 4: Aplicar os filtros e ler o endereço**

Em `web/app/(app)/contas/page.tsx`, junto dos outros `useState` (linha 130), acrescentar:

```ts
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos')
```

Acrescentar, junto dos outros `useEffect`:

```ts
  // O aviso do WhatsApp manda /contas?filtro=sem-vencimento — a tela já abre filtrada.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filtro')
    if (f && FILTROS.some(o => o.value === f)) setFiltro(f as FiltroStatus)
  }, [])
```

E no filtro da lista, envolver a regra existente com a do tipo:

```ts
  const contasFiltradas = contas
    .filter(c => {
      const okTipo =
        filtroTipo === 'todos' ? true :
        filtroTipo === 'fixas' ? c.nota_fiscal_id === null :
                                 c.nota_fiscal_id !== null

      if (!okTipo) return false

      if (filtro === 'todas')          return true
      if (filtro === 'sem-vencimento') return !ENCERRADAS.has(c.status) && !c.vencimento
      if (filtro === 'atrasada')       return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
      return c.status === filtro
    })
    // Conta sem data sobe para o topo: é a única que exige ação do Matheus
    // para o sistema voltar a funcionar sozinho. Enterrada no meio da lista,
    // ela some — e é justamente a que o sistema não consegue vigiar.
    .sort((a, b) => {
      const aSemData = !a.vencimento && !ENCERRADAS.has(a.status)
      const bSemData = !b.vencimento && !ENCERRADAS.has(b.status)
      if (aSemData !== bSemData) return aSemData ? -1 : 1
      return (a.vencimento ?? '').localeCompare(b.vencimento ?? '')
    })
```

- [ ] **Step 5: Desenhar as duas fileiras de filtro**

Substituir o bloco que hoje desenha as pastilhas de filtro por:

```tsx
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {FILTROS_TIPO.map(o => (
              <Button
                key={o.value}
                size="sm"
                variant={filtroTipo === o.value ? 'default' : 'outline'}
                onClick={() => setFiltroTipo(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTROS.map(o => {
              const n = o.value === 'sem-vencimento'
                ? contas.filter(c => !ENCERRADAS.has(c.status) && !c.vencimento).length
                : 0
              return (
                <Button
                  key={o.value}
                  size="sm"
                  variant={filtro === o.value ? 'default' : 'outline'}
                  onClick={() => setFiltro(o.value)}
                >
                  {o.label}{n > 0 ? ` (${n})` : ''}
                </Button>
              )
            })}
          </div>
        </div>
```

- [ ] **Step 6: Extrair a tabela para o componente novo**

Criar `web/app/(app)/contas/lista-contas.tsx` movendo, **sem alterar o conteúdo**, o
bloco `<Table> … </Table>` que hoje começa na linha 388 de `page.tsx`, junto das funções
auxiliares que só ele usa (`fmtBRL`, `fmtDate`, `STATUS_LABEL`, `STATUS_STYLE`). O que
hoje é chamada direta de `handleMarcarPaga`/`handleDispensar`/`handleDesfazerPagamento`/
`setValorDialog` vira chamada das funções recebidas por `props`. O componente recebe:

```tsx
'use client'

import type { ContaAPI } from './tipos'

type Props = {
  contas:          ContaAPI[]
  hoje:            string
  onPagar:         (c: ContaAPI) => void
  onDispensar:     (c: ContaAPI) => void
  onDesfazer:      (c: ContaAPI) => void
  onEditarValor:   (c: ContaAPI) => void
  onInformarData:  (c: ContaAPI) => void
}

export function ListaContas({ contas, hoje, onPagar, onDispensar, onDesfazer, onEditarValor, onInformarData }: Props) {
  // ... JSX da tabela, movido de page.tsx sem alteração de conteúdo ...
}
```

Na célula de vencimento, tratar o caso vazio:

```tsx
{c.vencimento
  ? fmtDate(c.vencimento)
  : <span className="text-amber-600 font-medium">vencimento não informado</span>}
```

E, quando `c.vencimento` for vazio e o status não estiver encerrado, mostrar os três botões:

```tsx
{!c.vencimento && !['paga','dispensada'].includes(c.status) && (
  <div className="flex flex-wrap gap-1">
    <Button size="sm" onClick={() => onInformarData(c)}>Informar data</Button>
    <Button size="sm" variant="outline" onClick={() => onPagar(c)}>Já foi paga</Button>
    <Button size="sm" variant="outline" onClick={() => onDispensar(c)}>Sem boleto</Button>
  </div>
)}
```

- [ ] **Step 7: Conferir que compila e que a tela sobe**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro

Run: `cd web && npm run dev` e abrir `http://localhost:3000/contas`
Expected: as duas fileiras de filtro aparecem; a lista continua mostrando o que mostrava antes.

- [ ] **Step 8: Commit**

```bash
git add "web/app/(app)/contas/lista-contas.tsx" "web/app/(app)/contas/page.tsx"
git commit -m "feat: filtros de tipo e de falta-vencimento na tela de contas"
```

---

### Task 9: O diálogo "Informar data"

Entrega: o Matheus informa a data em dois toques, com aviso (nunca bloqueio) quando a data parece errada.

**Files:**
- Create: `web/app/(app)/contas/dialogo-vencimento.tsx`
- Modify: `web/app/(app)/contas/page.tsx`

**Interfaces:**
- Consumes: `ContaAPI` de `./tipos` (Task 8); `api` de `@/lib/api`
- Produces: componente `<DialogoVencimento conta={...} onFechar={...} onSalvo={...} />`

- [ ] **Step 1: Escrever o componente**

Criar `web/app/(app)/contas/dialogo-vencimento.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { ContaAPI } from './tipos'

// Hoje no fuso de São Paulo. NÃO usar toISOString(): devolve UTC e vira o dia
// seguinte depois das 21h — defeito que este projeto já teve no Financeiro.
function hojeISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function diasEntre(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number)
  const [by, bm, bd] = bISO.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

// Aviso, NUNCA bloqueio. Errar o ano ao digitar é comum, e travar o usuário
// fora do próprio sistema é pior que o erro que se quer evitar.
function avisoData(dataISO: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) return null
  const dias = diasEntre(hojeISO(), dataISO)
  if (dias < 0)   return 'Essa data já passou. Se estiver certo, pode salvar assim mesmo.'
  if (dias > 180) return 'Essa data está a mais de 6 meses. Confira o ano antes de salvar.'
  return null
}

type Props = {
  conta:    ContaAPI | null
  onFechar: () => void
  onSalvo:  () => void
}

export function DialogoVencimento({ conta, onFechar, onSalvo }: Props) {
  const [data, setData]         = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState<string | null>(null)

  const aviso = avisoData(data)

  async function salvar() {
    if (!conta || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      setErro('Informe uma data válida.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      await api.patch(`/contas/${conta.id}`, { vencimento: data })
      setData('')
      onSalvo()
    } catch (e) {
      // Erro visível: escrita que falha calada faz o usuário achar que salvou.
      setErro(e instanceof Error ? e.message : 'Não consegui salvar. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={!!conta} onOpenChange={o => { if (!o) { setData(''); setErro(null); onFechar() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quando vence esta conta?</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{conta?.descricao}</p>

        <div className="space-y-2">
          <Label htmlFor="vencimento">Data de vencimento</Label>
          <Input id="vencimento" type="date" value={data} onChange={e => setData(e.target.value)} />
          {aviso && <p className="text-sm text-amber-600">{aviso}</p>}
          {erro  && <p className="text-sm text-red-600">{erro}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !data}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Ligar na página**

Em `web/app/(app)/contas/page.tsx`, acrescentar o estado junto dos outros:

```ts
  const [dataDialog, setDataDialog] = useState<ContaAPI | null>(null)
```

Acrescentar o import:

```ts
import { DialogoVencimento } from './dialogo-vencimento'
```

Passar `onInformarData={setDataDialog}` para `<ListaContas ... />` e desenhar o diálogo junto dos outros:

```tsx
      <DialogoVencimento
        conta={dataDialog}
        onFechar={() => setDataDialog(null)}
        onSalvo={() => { setDataDialog(null); load() }}
      />
```

`load()` é a função que já recarrega a lista em `page.tsx:150`.

- [ ] **Step 3: Conferir que compila**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro

- [ ] **Step 4: Conferir na tela, de ponta a ponta**

Com `npm run dev` rodando, no banco de desenvolvimento:

```sql
INSERT INTO contas_a_pagar (descricao, fornecedor, categoria, competencia, vencimento, valor, valor_estimado, status, numero_parcela, total_parcelas, fazenda_id)
VALUES ('ERCAL — NF 82398 (teste)', 'ERCAL', 'insumos', '2026-07-01', NULL, 8258.40, false, 'aberta', 1, 1, (SELECT id FROM fazendas WHERE codigo = 'mg'));
```

Conferir, um por um:
1. A conta aparece com **"vencimento não informado"** em âmbar
2. O filtro **"Falta vencimento (1)"** mostra o contador
3. `http://localhost:3000/contas?filtro=sem-vencimento` **já abre filtrado**
4. **Informar data** → digitar `2026-08-15` → salvar → a conta sai do filtro e mostra 15/08
5. Digitar uma data do ano passado → aparece o **aviso em âmbar** e o botão **continua clicável**

Apagar a linha de teste depois.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/contas/dialogo-vencimento.tsx" "web/app/(app)/contas/page.tsx"
git commit -m "feat: dialogo de informar vencimento, com aviso de data suspeita"
```

---

### Task 10: Subir

Entrega: no ar, conferido, com um número medido antes e depois.

**Files:** nenhum — é operação.

- [ ] **Step 1: Rodar a bateria inteira e o compilador**

Run: `cd api && npx tsc --noEmit && npm test`
Expected: sem erro; **todos** os testes verdes (Fase 1 + Fase 2)

Run: `cd web && npx tsc --noEmit`
Expected: sem erro

- [ ] **Step 2: Configurar o endereço do site no Railway**

No painel do Railway, no serviço da API, criar a variável:

```
APP_URL = https://agromouro.com.br
```

Sem ela, o link das mensagens cai no valor padrão do código. Não quebra — mas o endereço passa a ser decidido pelo código em vez da configuração, que é o contrário do que queremos.

- [ ] **Step 3: Medir ANTES**

No SQL Editor do Supabase, anotar os três números:

```sql
SELECT count(*) AS notas          FROM notas_fiscais;
SELECT count(*) AS contas         FROM contas_a_pagar;
SELECT count(*) AS lancamentos    FROM lancamentos_financeiros;
```

- [ ] **Step 4: Abrir o pull request**

```bash
git push -u origin feat/contas-a-pagar-fase2
gh pr create --title "feat(contas): boletos nascendo das NF-e — Fase 2" --body "$(cat <<'EOF'
## O que muda

Quando uma NF-e chega, os boletos dela entram sozinhos na agenda de contas.
Nota sem data de vencimento vira conta etiquetada, avisada todo dia, subindo
de tom depois de 5 dias.

**Pré-requisito consertado junto (defeitos que já estavam no ar):**
- `nfeJaProcessada` deduplicava por número + fazenda, ignorando o emitente.
  Número de NF-e é sequencial POR fornecedor: dois fornecedores com o mesmo
  número faziam o sistema descartar uma compra inteira em silêncio.
- `notas_fiscais` não tinha índice único nenhum, e existem duas portas de
  entrada (Make + job de 30 min) que conferem e gravam em dois passos.

## Rede de proteção

A criação de boletos fica isolada em `try/catch` no fim de `processarNFe`.
Se ela estourar, a nota continua atualizando estoque, financeiro e WhatsApp.
Provado à mão na Task 5, Step 5.

## Migrations a rodar (nesta ordem)

1. `supabase/migrations/005_nfe_duplicidade.sql` — **rodar o SELECT de conferência ANTES**: se devolver linha, há nota duplicada em produção e o índice falha.
2. `supabase/migrations/006_contas_de_nfe.sql`

## Não coberto por teste automático

- O caminho de VÁRIAS parcelas não tem arquivo real: as 3 amostras de 31/07
  têm uma parcela cada. Coberto por XML montado à mão.
- A nota de adubo de valor alto ainda não foi conferida.

Spec: `docs/superpowers/specs/2026-07-31-contas-a-pagar-fase2-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Rodar as duas migrações em produção**

Na ordem, no SQL Editor do Supabase: `005` (com a conferência do passo 1 **antes**), depois `006`.

- [ ] **Step 6: Juntar e conferir os deploys**

Juntar o PR (squash). Conferir no Railway que o serviço subiu e que o log mostra
`[Jobs] Jobs agendados:`; conferir na Vercel que o deploy ficou READY.

- [ ] **Step 7: Medir DEPOIS**

Rodar as mesmas três contagens do Step 3.

Expected: **nenhum número menor que antes.** Notas e lançamentos iguais (esta fase não apaga nada); contas iguais ou maiores. Se algum diminuiu, **pare e investigue**.

- [ ] **Step 8: Conferir com nota de verdade**

Reenviar ao webhook um dos três arquivos de `.tmp/notas-exemplo/` (ou esperar a próxima nota real chegar) e conferir:

1. A mensagem do WhatsApp traz a linha `💳`
2. A conta aparece em `/contas` no filtro **Boletos de nota**
3. O arquivo da ERCAL cria conta **sem data**, e ela aparece em **Falta vencimento**
4. O arquivo da METAL AGRICOLA **não** cria conta, e a mensagem diz `Sem boleto — a nota diz crédito da loja`

- [ ] **Step 9: Marcar o que medir daqui a 3–4 semanas**

Anotar no `ESTADO.md` do projeto a consulta que responde o risco nº 1 do spec —
quantas notas trazem vencimento e quantas não trazem:

```sql
SELECT
  count(*) FILTER (WHERE vencimento IS NOT NULL) AS com_data,
  count(*) FILTER (WHERE vencimento IS NULL)     AS sem_data
FROM contas_a_pagar
WHERE nota_fiscal_id IS NOT NULL;
```

Este número decide se o desenho continua como está ou se a Fase 3 (aprender o
prazo do fornecedor) vira prioridade.
