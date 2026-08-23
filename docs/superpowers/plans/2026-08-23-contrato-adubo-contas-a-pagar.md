# Contrato de adubo → conta a pagar + gasto no Financeiro — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um contrato de compra e venda de adubo em PDF (Mosaic) passa a criar conta a pagar com o vencimento do Quadro Resumo, contar como gasto no Financeiro na data do contrato, e aparecer na grade do Controle — sem que o extrato de revenda mude de comportamento.

**Architecture:** O leitor de PDF que já existe (`documentoPdf.ts`) passa a devolver duas informações novas — o **tipo** do documento e as **datas de pagamento**. Quem grava (`gravarDocumentoPdf.ts`) ramifica a partir do tipo: contrato grava `conta_como_compra: true` e chama um módulo novo (`deContrato.ts`) que cria as contas a pagar; extrato continua exatamente como hoje. Uma trava em `pagamento.ts` impede que marcar a conta como paga lance o mesmo dinheiro uma segunda vez.

**Tech Stack:** Node.js + Express + TypeScript, Vitest, Supabase (PostgreSQL), Anthropic SDK (`output_config.format.json_schema`), Next.js 14 App Router + Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-23-contrato-adubo-contas-a-pagar-design.md`

## Global Constraints

- **TypeScript sempre** — nunca JavaScript puro.
- **Funções e variáveis em inglês (camelCase); mensagens ao usuário final em português brasileiro.**
- **Rodar os testes de dentro de `api/`**: `cd api && npm test`. O runner é Vitest (`npm test` = `vitest run`).
- **Nenhum número de medição em documento** — quando precisar de contagem, escreva o comando que mede.
- **A regra de ouro deste plano:** `tipoDocumento` ausente, nulo ou desconhecido → **`'extrato'`**. Errar para "extrato" custa um valor que não soma e o dono corrige na tela; errar para "contrato" dobra dinheiro em silêncio.
- **Trava de regressão nº 1:** os 3 extratos já importados (Syagri, Solos, Protec) **precisam continuar com `conta_como_compra: false`**. Qualquer tarefa que faça um extrato virar `true` está errada, mesmo que os testes dela passem.
- **Valores em centavos:** todo arredondamento usa `Math.round(x * 100) / 100`, o mesmo padrão já usado em `documentoPdf.ts`.
- **Migration nova NÃO roda sozinha** — o Matheus cola no SQL Editor do Supabase. A tarefa entrega o arquivo e o bloco pronto para colar **no chat**.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `supabase/migrations/012_contrato_em_contas_a_pagar.sql` | Coluna de vínculo, coluna de tipo, índice único | Criar |
| `api/src/services/controle/documentoPdf.ts` | Ler o PDF e devolver tipo + pagamentos | Modificar |
| `api/src/services/contas/deContrato.ts` | Montar as contas a pagar de um contrato (função **pura**) | Criar |
| `api/src/services/contas/gravarContasDoContrato.ts` | Gravar essas contas no banco | Criar |
| `api/src/services/controle/gravarDocumentoPdf.ts` | Ramificar por tipo e chamar a gravação das contas | Modificar |
| `api/src/services/contas/pagamento.ts` | Trava contra lançamento duplo | Modificar |
| `web/app/(app)/financeiro/page.tsx` | Fornecedor na coluna Origem | Modificar |
| `web/app/(app)/contas/page.tsx` | Botão "Importar contrato (PDF)" | Modificar |
| `web/app/(app)/controle/components/dialogo-importar.tsx` | Prop `aceita` + mensagens | Modificar |

**Por que `deContrato.ts` e `gravarContasDoContrato.ts` são dois arquivos:** a montagem é pura (entra documento lido, sai lista de linhas) e dá para provar sem banco nenhum; a gravação toca Supabase e precisa de mock. Misturar os dois obrigaria todo teste de regra de negócio a montar um mock de banco. É o mesmo par que `deNotaFiscal.ts` (puro) e `gravarDeNota.ts` (banco) já formam neste projeto.

---

## Task 1: Migration — vínculo, tipo e índice

**Files:**
- Create: `supabase/migrations/012_contrato_em_contas_a_pagar.sql`

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces: coluna `contas_a_pagar.documento_controle_id UUID NULL`, coluna `documentos_controle.tipo TEXT NULL` (aceita `'extrato'` | `'contrato'`), índice único parcial `contas_a_pagar_contrato_unico`

- [ ] **Step 1: Criar o arquivo da migration**

```sql
-- ============================================================
-- AgroMouro — contrato de adubo vira conta a pagar
-- Executar no Supabase SQL Editor: colar o arquivo INTEIRO e clicar em Run.
-- Spec: docs/superpowers/specs/2026-08-23-contrato-adubo-contas-a-pagar-design.md
--
-- O QUE ESTE ARQUIVO TOCA: só CRIA coisa nova (duas colunas nulas e um
-- índice). Não altera nem apaga nenhuma linha existente. É seguro colar
-- quantas vezes for preciso — todo comando tem IF NOT EXISTS.
--
-- POR QUE `tipo` PODE SER NULO: os 3 documentos já importados (Syagri,
-- Solos, Protec) foram gravados antes desta coluna existir. NULO significa
-- 'extrato' para todo efeito de código — ver `tipoDeDocumento()` em
-- documentoPdf.ts. Preencher esses 3 à mão seria adivinhar; o default de
-- código já os trata do jeito certo (não contam como gasto).
--
-- POR QUE `on delete set null`: apagar o documento pela tela do Controle NÃO
-- pode apagar uma conta a pagar que talvez já esteja paga. A conta sobrevive
-- órfã e o dono a dispensa à mão (decisão do Matheus, 23/08/2026).
-- ============================================================

ALTER TABLE contas_a_pagar
  ADD COLUMN IF NOT EXISTS documento_controle_id UUID
  REFERENCES documentos_controle(id) ON DELETE SET NULL;

ALTER TABLE documentos_controle
  ADD COLUMN IF NOT EXISTS tipo TEXT;

-- CHECK separado do ADD COLUMN: se a coluna já existir de uma execução
-- anterior, o ADD COLUMN vira no-op e o CHECK precisa ser garantido mesmo
-- assim. NULL passa em CHECK por definição no Postgres — é o que queremos.
ALTER TABLE documentos_controle
  DROP CONSTRAINT IF EXISTS documentos_controle_tipo_check;

ALTER TABLE documentos_controle
  ADD CONSTRAINT documentos_controle_tipo_check
  CHECK (tipo IN ('extrato','contrato'));

-- Reimportar o mesmo contrato não pode criar a mesma conta duas vezes.
-- Parcial (WHERE ... IS NOT NULL) para não atrapalhar conta avulsa/de nota,
-- que têm documento_controle_id nulo e podem repetir vencimento à vontade.
CREATE UNIQUE INDEX IF NOT EXISTS contas_a_pagar_contrato_unico
  ON contas_a_pagar (fazenda_id, documento_controle_id, vencimento)
  WHERE documento_controle_id IS NOT NULL;

-- VERIFICAÇÃO — precisa devolver 3 linhas.
SELECT 'coluna documento_controle_id' AS conferencia, column_name
  FROM information_schema.columns
 WHERE table_name = 'contas_a_pagar' AND column_name = 'documento_controle_id'
UNION ALL
SELECT 'coluna tipo', column_name
  FROM information_schema.columns
 WHERE table_name = 'documentos_controle' AND column_name = 'tipo'
UNION ALL
SELECT 'indice unico', indexname
  FROM pg_indexes
 WHERE indexname = 'contas_a_pagar_contrato_unico';
```

- [ ] **Step 2: Colar o SQL no chat para o Matheus**

Ele aplica no SQL Editor do Supabase. **Não seguir para a Task 2 antes de ele confirmar que a verificação devolveu 3 linhas** — todo o resto do plano grava nessas colunas.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/012_contrato_em_contas_a_pagar.sql
git commit -m "feat(db): vinculo de contrato em contas_a_pagar e tipo em documentos_controle"
```

---

## Task 2: Leitor devolve o TIPO do documento

**Files:**
- Modify: `api/src/services/controle/documentoPdf.ts`
- Test: `api/src/services/controle/documentoPdf.test.ts`

**Interfaces:**
- Consumes: `validarDocumentoLido(bruto, hojeISO)` já exportada
- Produces: `DocumentoLido.tipoDocumento: 'extrato' | 'contrato'` (nunca nulo depois da validação); função `tipoDeDocumento(v: unknown): 'extrato' | 'contrato'` exportada só para teste

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `api/src/services/controle/documentoPdf.test.ts`:

```ts
describe('validarDocumentoLido — tipo do documento', () => {
  it('contrato explícito vira tipoDocumento "contrato"', () => {
    const r = validarDocumentoLido(
      { ...brutoValido(), tipoDocumento: 'contrato' },
      '2026-08-23',
    )
    expect(r.status).toBe('documento')
    if (r.status !== 'documento') return
    expect(r.documento.tipoDocumento).toBe('contrato')
  })

  it('extrato explícito vira tipoDocumento "extrato"', () => {
    const r = validarDocumentoLido(
      { ...brutoValido(), tipoDocumento: 'extrato' },
      '2026-08-23',
    )
    expect(r.status).toBe('documento')
    if (r.status !== 'documento') return
    expect(r.documento.tipoDocumento).toBe('extrato')
  })

  // A TRAVA MAIS IMPORTANTE DESTE ARQUIVO. Errar para "contrato" dobra
  // dinheiro em silêncio; errar para "extrato" só deixa um valor sem somar,
  // e o dono corrige na tela. Todo valor que não seja exatamente 'contrato'
  // cai no lado barato.
  it.each([
    ['ausente',    undefined],
    ['nulo',       null],
    ['vazio',      ''],
    ['desconhecido', 'nota'],
    ['número',     42],
    ['maiúsculo com espaço', ' CONTRATO '],
  ])('tipoDocumento %s cai em "extrato"', (_nome, valor) => {
    const r = validarDocumentoLido(
      { ...brutoValido(), tipoDocumento: valor },
      '2026-08-23',
    )
    expect(r.status).toBe('documento')
    if (r.status !== 'documento') return
    expect(r.documento.tipoDocumento).toBe('extrato')
  })
})
```

**`brutoValido()` NÃO existe no arquivo — o helper que existe chama `bruto(over)`** (linha 23 de `documentoPdf.test.ts`, junto de `item(over)` na 10 e `documento(bruto, hoje)` na 37). Use os que já estão lá:

```ts
// Em vez de brutoValido(), use o helper existente:
const r = validarDocumentoLido(bruto({ tipoDocumento: 'contrato' }), '2026-08-23')
```

Trocar `brutoValido()` por `bruto(...)` em **todos** os testes das Tasks 2 e 3. Se o `HOJE` do arquivo não for `'2026-08-23'`, use a constante `HOJE` do próprio arquivo em vez da data literal — as janelas de sanidade são relativas a ela, e datas cravadas quebram o arquivo daqui a um ano.

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
cd api && npx vitest run src/services/controle/documentoPdf.test.ts -t "tipo do documento"
```

Esperado: FALHA — `tipoDocumento` não existe em `DocumentoLido` (erro de tipo do TS e `undefined` no assert).

- [ ] **Step 3: Adicionar o campo ao SCHEMA da IA**

Em `documentoPdf.ts`, dentro de `SCHEMA.properties`, logo depois de `ehDocumentoValido`:

```ts
    tipoDocumento: {
      type: ['string', 'null'],
      enum: ['extrato', 'contrato', null],
      description:
        'Qual dos dois formatos é este documento. "extrato" = relatório de "Contas a Receber" que uma ' +
        'revenda agrícola emite listando duplicatas/notas em aberto do cliente. "contrato" = contrato de ' +
        'compra e venda de mercadoria, com Quadro Resumo, VENDEDORA/COMPRADOR e número de contrato ' +
        '(ex: Mosaic). null se não der para decidir com segurança — não chute.',
    },
```

E acrescentar `'tipoDocumento'` ao array `required` do SCHEMA.

- [ ] **Step 4: Escrever a função de default seguro**

Em `documentoPdf.ts`, junto das outras funções auxiliares (perto de `texto`/`numero`):

```ts
// O default MAIS BARATO, não o mais provável — e a assimetria é de propósito.
// Um contrato lido como "extrato" só deixa de somar um valor, e o dono
// conserta na tela quando estranhar o total. Um extrato lido como "contrato"
// grava conta_como_compra=true numa compra cuja NF-e o Make ainda vai
// derrubar, e o Financeiro passa a somar o mesmo dinheiro duas vezes SEM
// avisar ninguém. Por isso: só a string exata 'contrato' vira contrato.
// Nada de trim/lowercase — se a IA devolveu ' CONTRATO ', a resposta não
// obedeceu ao enum do schema, e resposta fora do contrato não merece
// interpretação generosa.
export function tipoDeDocumento(v: unknown): 'extrato' | 'contrato' {
  return v === 'contrato' ? 'contrato' : 'extrato'
}
```

- [ ] **Step 5: Ligar no tipo e na validação**

Em `DocumentoLido`, acrescentar o campo (com o comentário, que é o que impede alguém "simplificar" o default depois):

```ts
  // 'extrato' | 'contrato' — decide se os itens deste documento contam como
  // gasto no Financeiro (ver gravarDocumentoPdf.ts). NUNCA é nulo aqui:
  // `tipoDeDocumento` já resolveu a indefinição para o lado seguro.
  tipoDocumento: 'extrato' | 'contrato'
```

Em `validarDocumentoLido`, junto das outras extrações:

```ts
  const tipoDocumento = tipoDeDocumento(bruto.tipoDocumento)
```

E incluir `tipoDocumento,` no objeto `documento` devolvido no `return` final.

- [ ] **Step 6: Rodar os testes e ver passar**

```bash
cd api && npx vitest run src/services/controle/documentoPdf.test.ts
```

Esperado: PASSA — inclusive os testes antigos do arquivo, que não conhecem `tipoDocumento` e por isso exercitam o default.

- [ ] **Step 7: Commit**

```bash
git add api/src/services/controle/documentoPdf.ts api/src/services/controle/documentoPdf.test.ts
git commit -m "feat(controle): leitor devolve o tipo do documento (extrato ou contrato)"
```

---

## Task 3: Leitor devolve as DATAS DE PAGAMENTO

**Files:**
- Modify: `api/src/services/controle/documentoPdf.ts`
- Test: `api/src/services/controle/documentoPdf.test.ts`

**Interfaces:**
- Consumes: `dataSanitizada(v, hojeISO)`, `numero(v)`, `VALOR_MAX_DOCUMENTO` — todos já existem no arquivo
- Produces: `type PagamentoLido = { data: string; valor: number | null }` (exportado) e `DocumentoLido.pagamentos: PagamentoLido[]`

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe('validarDocumentoLido — pagamentos do contrato', () => {
  const contrato = (pagamentos: unknown) => ({
    ...brutoValido(),
    tipoDocumento: 'contrato',
    pagamentos,
  })

  it('lê data e valor do Quadro Resumo', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2026-08-28', valor: 647986.35 }]),
      '2026-08-23',
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-08-28', valor: 647986.35 }])
  })

  it('pagamento sem valor entra com valor null (quem monta a conta resolve)', () => {
    const r = validarDocumentoLido(contrato([{ data: '2026-08-28' }]), '2026-08-23')
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-08-28', valor: null }])
  })

  // Nunca corrige data — descarta. Um '2126-08-28' é dígito mal lido, e
  // adivinhar o século criaria uma dívida numa data inventada.
  it('data fora da janela de sanidade é descartada, documento sobrevive', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2126-08-28', valor: 100 }, { data: '2026-09-10', valor: 200 }]),
      '2026-08-23',
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-09-10', valor: 200 }])
    expect(r.documento.itens).toHaveLength(1)   // o documento NÃO foi derrubado
  })

  it('valor de pagamento acima do teto do documento vira null, mantém a data', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2026-08-28', valor: 99_000_000 }]),
      '2026-08-23',
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-08-28', valor: null }])
  })

  it.each([
    ['ausente',   undefined],
    ['nulo',      null],
    ['não-array', { data: '2026-08-28' }],
    ['vazio',     []],
  ])('pagamentos %s vira lista vazia', (_nome, valor) => {
    const r = validarDocumentoLido(contrato(valor), '2026-08-23')
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([])
  })

  // Extrato tem DUPLICATA, não contrato de pagamento. Cada duplicata já vira
  // ITEM, e o boleto dela chega por e-mail pelo Make. Criar conta a pagar
  // aqui duplicaria o que o boleto já faz.
  it('extrato ignora pagamentos mesmo se a IA devolver', () => {
    const r = validarDocumentoLido(
      { ...brutoValido(), tipoDocumento: 'extrato', pagamentos: [{ data: '2026-08-28', valor: 500 }] },
      '2026-08-23',
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
cd api && npx vitest run src/services/controle/documentoPdf.test.ts -t "pagamentos do contrato"
```

Esperado: FALHA — `pagamentos` não existe em `DocumentoLido`.

- [ ] **Step 3: Adicionar `pagamentos` ao SCHEMA e à INSTRUCAO**

Em `SCHEMA.properties`, depois de `valorTotalDocumento`:

```ts
    pagamentos: {
      type: 'array',
      description:
        'SOMENTE para contrato: as datas de pagamento do Quadro Resumo (campo "Data de pagamento"). ' +
        'Uma entrada por parcela — a maioria dos contratos tem uma só. NÃO confunda com a "Data de ' +
        'Início"/"Data Fim" (prazo de retirada da mercadoria, que é o dataDocumento). Lista VAZIA para ' +
        'extrato: as duplicatas de um extrato já viram itens, não pagamentos.',
      items: {
        type: 'object',
        properties: {
          data:  { type: 'string', description: 'Data de pagamento, formato AAAA-MM-DD.' },
          valor: {
            type: ['number', 'null'],
            description: 'Valor desta parcela, se impresso ao lado da data. Use ponto decimal. null se não houver.',
          },
        },
        required: ['data', 'valor'],
        additionalProperties: false,
      },
    },
```

Acrescentar `'pagamentos'` ao `required` do SCHEMA.

No fim da constante `INSTRUCAO`, acrescentar:

```ts
  'No CONTRATO, além dos produtos, leia a DATA DE PAGAMENTO do Quadro Resumo (campo "Data de pagamento", ' +
  'às vezes junto de "Forma de pagamento") e devolva em `pagamentos` — é o compromisso financeiro, e é ' +
  'DIFERENTE da "Data de Início" (que é o prazo de retirada da mercadoria e vai em dataDocumento). ' +
  'Havendo mais de uma parcela, uma entrada por parcela. No EXTRATO, `pagamentos` é sempre lista vazia.'
```

- [ ] **Step 4: Escrever a validação**

Em `documentoPdf.ts`, perto das constantes do topo:

```ts
// Um contrato de insumo não tem cem parcelas. Acima disto é leitura repetindo
// linha — corta e loga, em vez de criar dezenas de contas a pagar fantasma.
const MAX_PAGAMENTOS = 24
```

O tipo, junto de `ItemDocumentoLido`:

```ts
// Uma data de pagamento do Quadro Resumo do contrato. `data` NUNCA é nula
// aqui (pagamento sem data válida é descartado inteiro — uma dívida sem
// vencimento não é conta a pagar, é palpite). `valor` pode ser nulo: muito
// contrato imprime a data sem repetir o valor ao lado, e quem monta a conta
// sabe resolver (ver deContrato.ts).
export type PagamentoLido = {
  data:  string
  valor: number | null
}
```

A função de validação, junto de `validarDocumentoLido`:

```ts
// Exportada só para teste, mesmo motivo de `validarDocumentoLido`.
export function validarPagamentos(
  bruto: unknown,
  tipoDocumento: 'extrato' | 'contrato',
  hojeISO: string,
): PagamentoLido[] {
  // Extrato nunca tem pagamento: cada duplicata dele já vira ITEM, e o boleto
  // correspondente chega por e-mail pelo Make (nfeEmail.ts → gravarBoletoDoPdf).
  // Criar conta a pagar aqui duplicaria a mesma cobrança em dois lugares.
  if (tipoDocumento !== 'contrato') return []
  if (!Array.isArray(bruto)) return []

  const pagamentos: PagamentoLido[] = []

  for (const cru of bruto) {
    if (pagamentos.length >= MAX_PAGAMENTOS) {
      console.warn(`[DocumentoPDF] pagamentos acima de ${MAX_PAGAMENTOS} — resto ignorado.`)
      break
    }

    const p = cru as Record<string, unknown>
    const data = dataSanitizada(p?.data, hojeISO)
    // Sem data válida não há conta a pagar possível. Descarta o pagamento
    // (não o documento) e loga — o documento e o gasto continuam valendo.
    if (!data) {
      console.warn(`[DocumentoPDF] pagamento sem data utilizável, descartado: ${JSON.stringify(p?.data)}`)
      continue
    }

    // Mesma ordem do resto do arquivo: arredonda ANTES de comparar com o
    // teto, senão sobra de ponto flutuante decide a recusa.
    const bruto2 = numero(p?.valor)
    const arredondado = bruto2 !== null ? Math.round(bruto2 * 100) / 100 : null
    // Fora da faixa vira null (não descarta o pagamento): a data continua
    // valendo e quem monta a conta preenche o valor a partir do total.
    const valor = arredondado !== null && arredondado > 0 && arredondado <= VALOR_MAX_DOCUMENTO
      ? arredondado
      : null

    pagamentos.push({ data, valor })
  }

  return pagamentos
}
```

- [ ] **Step 5: Ligar em `DocumentoLido` e em `validarDocumentoLido`**

No tipo `DocumentoLido`:

```ts
  // Datas de pagamento do contrato (vazio para extrato) — viram conta a pagar
  // em gravarContasDoContrato.ts.
  pagamentos: PagamentoLido[]
```

Em `validarDocumentoLido`, depois da linha do `tipoDocumento`:

```ts
  const pagamentos = validarPagamentos(bruto.pagamentos, tipoDocumento, hojeISO)
```

E incluir `pagamentos,` no objeto devolvido.

- [ ] **Step 6: Rodar os testes e ver passar**

```bash
cd api && npx vitest run src/services/controle/documentoPdf.test.ts
```

Esperado: PASSA, arquivo inteiro.

- [ ] **Step 7: Commit**

```bash
git add api/src/services/controle/documentoPdf.ts api/src/services/controle/documentoPdf.test.ts
git commit -m "feat(controle): leitor devolve as datas de pagamento do contrato"
```

---

## Task 4: Montar as contas a pagar do contrato (função pura)

**Files:**
- Create: `api/src/services/contas/deContrato.ts`
- Test: `api/src/services/contas/deContrato.test.ts`

**Interfaces:**
- Consumes: `competenciaDoMes(ano, mes)` de `./datas`; `DocumentoLido` e `PagamentoLido` de `../controle/documentoPdf`
- Produces: `type ContaDeContrato` e `function contasDoContrato(documento: DocumentoLido, documentoId: string): ContaDeContrato[]`

- [ ] **Step 1: Escrever os testes que falham**

Criar `api/src/services/contas/deContrato.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { contasDoContrato } from './deContrato'
import type { DocumentoLido } from '../controle/documentoPdf'

// Contrato Mosaic real (280451) — o mesmo que originou esta feature.
function contrato(over: Partial<DocumentoLido> = {}): DocumentoLido {
  return {
    fornecedor: 'Mosaic Fertilizantes do Brasil Ltda.',
    dataDocumento: '2026-07-03',
    numeroDocumento: '280451-2026-07-03',
    codigoCliente: '280451',
    valorTotalDocumento: 647986.35,
    divergenciaTotal: 0,
    tipoDocumento: 'contrato',
    pagamentos: [{ data: '2026-08-28', valor: 647986.35 }],
    itens: [{
      descricao: 'MS15F 09 23 18 S15',
      quantidade: 165,
      unidade: 'MTN',
      valorUnitario: 3927.19,
      valorTotal: 647986.35,
      numeroDocumento: '280451',
      data: '2026-07-03',
    }],
    itensDescartados: 0,
    ...over,
  }
}

describe('contasDoContrato', () => {
  it('uma conta por pagamento, com vencimento e valor do Quadro Resumo', () => {
    const contas = contasDoContrato(contrato(), 'doc-1')
    expect(contas).toHaveLength(1)
    expect(contas[0]).toEqual({
      descricao: 'Contrato 280451 — MS15F 09 23 18 S15',
      fornecedor: 'Mosaic Fertilizantes do Brasil Ltda.',
      categoria: 'fertilizante_outro',
      vencimento: '2026-08-28',
      valor: 647986.35,
      valor_estimado: false,
      status: 'aberta',
      competencia: '2026-08-01',
      documento_controle_id: 'doc-1',
    })
  })

  it('extrato não gera conta nenhuma', () => {
    const contas = contasDoContrato(contrato({ tipoDocumento: 'extrato', pagamentos: [] }), 'doc-1')
    expect(contas).toEqual([])
  })

  it('contrato sem pagamento não gera conta', () => {
    expect(contasDoContrato(contrato({ pagamentos: [] }), 'doc-1')).toEqual([])
  })

  it('1 pagamento sem valor herda o total do documento', () => {
    const contas = contasDoContrato(contrato({ pagamentos: [{ data: '2026-08-28', valor: null }] }), 'doc-1')
    expect(contas[0].valor).toBe(647986.35)
    expect(contas[0].valor_estimado).toBe(false)
  })

  it('N pagamentos com valor próprio usam cada um o seu', () => {
    const contas = contasDoContrato(contrato({
      pagamentos: [
        { data: '2026-08-28', valor: 300000 },
        { data: '2026-09-28', valor: 347986.35 },
      ],
    }), 'doc-1')
    expect(contas.map(c => c.valor)).toEqual([300000, 347986.35])
    expect(contas.every(c => c.valor_estimado === false)).toBe(true)
  })

  // O BUG QUE ESTE TESTE EXISTE PRA IMPEDIR: herdar o total em cada parcela
  // transformaria um contrato de R$ 647.986,35 numa dívida de R$ 1,29 mi.
  it('2 pagamentos sem valor RATEIAM o total — não herdam cada um', () => {
    const contas = contasDoContrato(contrato({
      pagamentos: [
        { data: '2026-08-28', valor: null },
        { data: '2026-09-28', valor: null },
      ],
    }), 'doc-1')
    expect(contas.map(c => c.valor)).toEqual([323993.17, 323993.18])
    expect(contas.reduce((s, c) => s + (c.valor ?? 0), 0)).toBe(647986.35)
    expect(contas.every(c => c.valor_estimado === true)).toBe(true)
  })

  it('rateio com sobra de centavo joga a diferença na ÚLTIMA parcela', () => {
    const contas = contasDoContrato(contrato({
      valorTotalDocumento: 100,
      pagamentos: [
        { data: '2026-08-28', valor: null },
        { data: '2026-09-28', valor: null },
        { data: '2026-10-28', valor: null },
      ],
    }), 'doc-1')
    expect(contas.map(c => c.valor)).toEqual([33.33, 33.33, 33.34])
    expect(contas.reduce((s, c) => s + (c.valor ?? 0), 0)).toBe(100)
  })

  it('sem valor e sem total: conta nasce sem valor, marcada como estimada', () => {
    const contas = contasDoContrato(contrato({
      valorTotalDocumento: null,
      pagamentos: [{ data: '2026-08-28', valor: null }],
    }), 'doc-1')
    expect(contas[0].valor).toBeNull()
    expect(contas[0].valor_estimado).toBe(true)
  })

  it('descrição cai no número do documento quando não há item legível', () => {
    const contas = contasDoContrato(contrato({ itens: [] }), 'doc-1')
    expect(contas[0].descricao).toBe('Contrato 280451')
  })

  it('sem codigoCliente, a descrição usa o fornecedor', () => {
    const contas = contasDoContrato(contrato({ codigoCliente: null }), 'doc-1')
    expect(contas[0].descricao).toBe('Contrato Mosaic Fertilizantes do Brasil Ltda. — MS15F 09 23 18 S15')
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
cd api && npx vitest run src/services/contas/deContrato.test.ts
```

Esperado: FALHA — `Cannot find module './deContrato'`.

- [ ] **Step 3: Escrever a implementação**

Criar `api/src/services/contas/deContrato.ts`:

> ⚠️ **Corrigido no pre-flight de 23/08:** a versão anterior deste plano esperava
> `[323993.18, 323993.17]` e `[33.34, 33.34, 33.32]` — expectativas de um algoritmo que
> arredonda para cima e joga a sobra na PRIMEIRA parcela. A implementação abaixo joga na
> ÚLTIMA (`base = floor`, última recebe o resto), como o comentário dela diz. Os dois
> valores certos são `[323993.17, 323993.18]` e `[33.33, 33.33, 33.34]`. Teste e código
> tinham de concordar antes de alguém executar.

```ts
import { competenciaDoMes } from './datas'
import type { DocumentoLido } from '../controle/documentoPdf'

// Transforma um CONTRATO já lido (Mosaic e afins) nas contas a pagar dele.
// Função PURA de propósito — nenhum acesso a banco, para que toda regra de
// dinheiro daqui possa ser provada sem mock. Espelha o par que
// deNotaFiscal.ts (puro) e gravarDeNota.ts (banco) já formam neste projeto;
// a gravação mora em gravarContasDoContrato.ts.
//
// Por que só contrato: o extrato de revenda já tem boleto próprio chegando
// por e-mail (nfeEmail.ts → gravarBoletoDoPdf). Criar conta a pagar a partir
// das duplicatas de um extrato cobraria o dono duas vezes pela mesma dívida.

// Categoria inicial. NÃO é adivinhação de fórmula (o MS15F 09 23 18 tem N, P
// e K juntos e não cabe em fertilizante_n/p/k) — é o balde honesto, e a tela
// deixa trocar em massa. Ver CATEGORIAS_CONTAS_A_PAGAR em web/lib/centro-custo.ts.
const CATEGORIA_PADRAO = 'fertilizante_outro'

export type ContaDeContrato = {
  descricao:             string
  fornecedor:            string | null
  categoria:             string
  vencimento:            string          // 'YYYY-MM-DD'
  valor:                 number | null   // nulo = contrato não disse quanto; a tela pede
  valor_estimado:        boolean
  status:                'aberta'
  competencia:           string          // 'YYYY-MM-01'
  documento_controle_id: string
}

// "Contrato 280451 — MS15F 09 23 18 S15". O código do contrato vem primeiro
// porque é o que o Matheus procura quando fala com o vendedor.
function descricaoDaConta(documento: DocumentoLido): string {
  const identidade = documento.codigoCliente ?? documento.fornecedor ?? 'sem número'
  const primeiroItem = documento.itens[0]?.descricao
  return primeiroItem ? `Contrato ${identidade} — ${primeiroItem}` : `Contrato ${identidade}`
}

// Divide `total` em `partes` iguais, em centavos, com a sobra na ÚLTIMA.
// Trabalha em centavos inteiros de propósito: dividir reais em ponto
// flutuante e arredondar cada parte independentemente deixa a soma das
// parcelas diferente do total (100 ÷ 3 daria 33,33 × 3 = 99,99 — um centavo
// somem do contrato).
function ratear(total: number, partes: number): number[] {
  const centavosTotal = Math.round(total * 100)
  const base = Math.floor(centavosTotal / partes)
  const valores = Array.from({ length: partes }, () => base)
  valores[partes - 1] = centavosTotal - base * (partes - 1)
  return valores.map(c => c / 100)
}

export function contasDoContrato(documento: DocumentoLido, documentoId: string): ContaDeContrato[] {
  if (documento.tipoDocumento !== 'contrato') return []
  if (documento.pagamentos.length === 0) return []

  const pagamentos = documento.pagamentos
  const total      = documento.valorTotalDocumento

  // Três regras de valor, nesta ordem — e a do meio é a que impede o bug caro:
  //   1. pagamento com valor próprio → usa o dele, valor_estimado = false
  //   2. ALGUM pagamento sem valor, com mais de um pagamento → RATEIA o total
  //      entre TODOS e marca todos como estimado. Herdar o total em cada
  //      parcela transformaria um contrato de R$ 647.986,35 numa dívida de
  //      R$ 1,29 mi. (montarParcelas() de parcelamento.ts NÃO serve aqui: ele
  //      repete o valor cheio em toda parcela DE PROPÓSITO — decisão do
  //      Matheus para conta avulsa parcelada. Reusar dá exatamente o bug.)
  //   3. sem valor e sem total → conta sem valor, estimada; a tela pede o real.
  const faltaAlgumValor = pagamentos.some(p => p.valor === null)
  const rateado = faltaAlgumValor && pagamentos.length > 1 && total !== null
    ? ratear(total, pagamentos.length)
    : null

  return pagamentos.map((pagamento, i) => {
    const [ano, mes] = pagamento.data.split('-').map(Number)

    const valor = pagamento.valor
      ?? rateado?.[i]
      ?? (pagamentos.length === 1 ? total : null)
      ?? null

    return {
      descricao:             descricaoDaConta(documento),
      fornecedor:            documento.fornecedor,
      categoria:             CATEGORIA_PADRAO,
      vencimento:            pagamento.data,
      valor,
      // Estimado = "este número não estava escrito ao lado desta data".
      // A tela de Contas a Pagar já sabe pedir o valor real de conta estimada.
      valor_estimado:        pagamento.valor === null,
      status:                'aberta',
      competencia:           competenciaDoMes(ano, mes),
      documento_controle_id: documentoId,
    }
  })
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

```bash
cd api && npx vitest run src/services/contas/deContrato.test.ts
```

Esperado: PASSA, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/deContrato.ts api/src/services/contas/deContrato.test.ts
git commit -m "feat(contas): monta as contas a pagar de um contrato de adubo"
```

---

## Task 5: Gravar as contas do contrato no banco

**Files:**
- Create: `api/src/services/contas/gravarContasDoContrato.ts`
- Test: `api/src/services/contas/gravarContasDoContrato.test.ts`

**Interfaces:**
- Consumes: `contasDoContrato(documento, documentoId)` da Task 4; `supabase` de `../supabase`
- Produces: `function gravarContasDoContrato(documento: DocumentoLido, documentoId: string, fazendaId: string): Promise<ResultadoContasContrato>` com `type ResultadoContasContrato = { criadas: number; duplicadas: number; erro: string | null }`

- [ ] **Step 1: Escrever os testes que falham**

Criar `api/src/services/contas/gravarContasDoContrato.test.ts`. Copiar o padrão de mock de `gravarDocumentoPdf.test.ts` (mesmo projeto, mesmo Supabase mockado):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn()
vi.mock('../supabase', () => ({
  supabase: { from: () => ({ insert: insertMock }) },
}))

import { gravarContasDoContrato } from './gravarContasDoContrato'
import type { DocumentoLido } from '../controle/documentoPdf'

function contrato(over: Partial<DocumentoLido> = {}): DocumentoLido {
  return {
    fornecedor: 'Mosaic Fertilizantes do Brasil Ltda.',
    dataDocumento: '2026-07-03',
    numeroDocumento: '280451-2026-07-03',
    codigoCliente: '280451',
    valorTotalDocumento: 647986.35,
    divergenciaTotal: 0,
    tipoDocumento: 'contrato',
    pagamentos: [{ data: '2026-08-28', valor: 647986.35 }],
    itens: [{
      descricao: 'MS15F 09 23 18 S15', quantidade: 165, unidade: 'MTN',
      valorUnitario: 3927.19, valorTotal: 647986.35,
      numeroDocumento: '280451', data: '2026-07-03',
    }],
    itensDescartados: 0,
    ...over,
  }
}

beforeEach(() => { insertMock.mockReset() })

describe('gravarContasDoContrato', () => {
  it('grava a conta com fazenda_id e devolve criadas: 1', async () => {
    insertMock.mockResolvedValue({ error: null })
    const r = await gravarContasDoContrato(contrato(), 'doc-1', 'fazenda-1')
    expect(r).toEqual({ criadas: 1, duplicadas: 0, erro: null })
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      vencimento: '2026-08-28',
      valor: 647986.35,
      documento_controle_id: 'doc-1',
      fazenda_id: 'fazenda-1',
    }))
  })

  it('extrato não chama o banco', async () => {
    const r = await gravarContasDoContrato(contrato({ tipoDocumento: 'extrato', pagamentos: [] }), 'doc-1', 'f1')
    expect(r).toEqual({ criadas: 0, duplicadas: 0, erro: null })
    expect(insertMock).not.toHaveBeenCalled()
  })

  // Reimportar o mesmo contrato: o índice único da migration 012 devolve
  // 23505. Não é erro — é a trava funcionando.
  it('23505 conta como duplicada, não como erro', async () => {
    insertMock.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    const r = await gravarContasDoContrato(contrato(), 'doc-1', 'f1')
    expect(r).toEqual({ criadas: 0, duplicadas: 1, erro: null })
  })

  // Uma parcela que falha não pode derrubar a outra que deu certo.
  it('erro numa parcela não impede as demais, e é reportado', async () => {
    insertMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: '42501', message: 'RLS' } })
    const r = await gravarContasDoContrato(contrato({
      pagamentos: [{ data: '2026-08-28', valor: 300000 }, { data: '2026-09-28', valor: 347986.35 }],
    }), 'doc-1', 'f1')
    expect(r.criadas).toBe(1)
    expect(r.erro).toContain('RLS')
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
cd api && npx vitest run src/services/contas/gravarContasDoContrato.test.ts
```

Esperado: FALHA — módulo não existe.

- [ ] **Step 3: Escrever a implementação**

```ts
import { supabase } from '../supabase'
import { contasDoContrato } from './deContrato'
import type { DocumentoLido } from '../controle/documentoPdf'

// Grava no banco as contas montadas por deContrato.ts.
//
// NUNCA estoura: quem chama (gravarDocumentoPdf.ts) já gravou o documento e
// os itens quando chega aqui, e perder tudo isso por causa de uma conta a
// pagar seria trocar um problema pequeno (o dono digita o vencimento à mão)
// por um grande (reimportar o PDF inteiro). Todo erro vira texto no
// resultado, para a tela avisar.

export type ResultadoContasContrato = {
  criadas:    number
  duplicadas: number
  erro:       string | null
}

export async function gravarContasDoContrato(
  documento: DocumentoLido,
  documentoId: string,
  fazendaId: string,
): Promise<ResultadoContasContrato> {
  const contas = contasDoContrato(documento, documentoId)
  if (contas.length === 0) return { criadas: 0, duplicadas: 0, erro: null }

  let criadas = 0
  let duplicadas = 0
  let erro: string | null = null

  // Uma por vez, não em lote: um INSERT em lote é UMA instrução SQL, e um
  // único 23505 (parcela já gravada numa importação anterior) derrubaria as
  // outras parcelas junto — mesma lição já aprendida em
  // gravarDocumentoPdf.ts/inserirItensUmAUm.
  for (const conta of contas) {
    const { error } = await supabase
      .from('contas_a_pagar')
      .insert({ ...conta, fazenda_id: fazendaId })

    if (!error) { criadas++; continue }

    if (error.code === '23505') {
      // Índice contas_a_pagar_contrato_unico (migration 012): esta parcela
      // deste documento, neste vencimento, já existe. Reimportação normal.
      duplicadas++
      continue
    }

    // Erro de verdade (RLS, conexão): registra o PRIMEIRO e continua tentando
    // as demais parcelas — uma pode falhar por motivo pontual enquanto as
    // outras passam, e o dono prefere 2 contas de 3 a nenhuma.
    console.error(`[ContasDoContrato] Erro ao gravar conta ${conta.vencimento}:`, error.message)
    erro ??= error.message
  }

  console.log(
    `[ContasDoContrato] documento ${documentoId}: ${criadas} conta(s) criada(s), ` +
    `${duplicadas} já existente(s)${erro ? `, com erro: ${erro}` : ''}.`,
  )

  return { criadas, duplicadas, erro }
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

```bash
cd api && npx vitest run src/services/contas/gravarContasDoContrato.test.ts
```

Esperado: PASSA, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/gravarContasDoContrato.ts api/src/services/contas/gravarContasDoContrato.test.ts
git commit -m "feat(contas): grava as contas a pagar vindas do contrato"
```

---

## Task 6: Ramificar a gravação por tipo

**Files:**
- Modify: `api/src/services/controle/gravarDocumentoPdf.ts`
- Test: `api/src/services/controle/gravarDocumentoPdf.test.ts`

**Interfaces:**
- Consumes: `gravarContasDoContrato(documento, documentoId, fazendaId)` da Task 5
- Produces: `ResultadoGravarDocumento` variante `'gravado'` ganha `contasCriadas: number` e `avisoContas: string | null`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `api/src/services/controle/gravarDocumentoPdf.test.ts`:

```ts
describe('gravarDocumentoDoPdf — contrato x extrato', () => {
  // A TRAVA DOS R$ 2,77 MILHÕES. Syagri, Solos e Protec já estão no banco
  // como extrato. Se um dia esta asserção virar `true`, o Financeiro passa a
  // somar essas compras de novo quando as NF-e delas chegarem pelo Make.
  it('extrato grava conta_como_compra: false', async () => {
    await rodarComDocumento(documentoLido({ tipoDocumento: 'extrato' }))
    expect(itensGravados()[0].conta_como_compra).toBe(false)
  })

  it('contrato grava conta_como_compra: true', async () => {
    await rodarComDocumento(documentoLido({ tipoDocumento: 'contrato' }))
    expect(itensGravados()[0].conta_como_compra).toBe(true)
  })

  it('grava o tipo em documentos_controle', async () => {
    await rodarComDocumento(documentoLido({ tipoDocumento: 'contrato' }))
    expect(documentoGravado().tipo).toBe('contrato')
  })

  it('contrato devolve quantas contas foram criadas', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 1, duplicadas: 0, erro: null })
    const r = await rodarComDocumento(documentoLido({ tipoDocumento: 'contrato' }))
    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.contasCriadas).toBe(1)
    expect(r.avisoContas).toBeNull()
  })

  it('extrato não chama a criação de contas', async () => {
    await rodarComDocumento(documentoLido({ tipoDocumento: 'extrato' }))
    expect(gravarContasMock).not.toHaveBeenCalled()
  })

  // Falhar a conta NÃO pode derrubar um documento já gravado com itens: o
  // dono perderia o gasto inteiro por causa de um vencimento.
  it('erro ao criar conta não derruba o documento — vira aviso', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 0, duplicadas: 0, erro: 'RLS negou' })
    const r = await rodarComDocumento(documentoLido({ tipoDocumento: 'contrato' }))
    expect(r.status).toBe('gravado')
    if (r.status !== 'gravado') return
    expect(r.avisoContas).toContain('RLS negou')
  })

  it('contrato sem pagamento avisa que a conta precisa ser cadastrada à mão', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 0, duplicadas: 0, erro: null })
    const r = await rodarComDocumento(documentoLido({ tipoDocumento: 'contrato', pagamentos: [] }))
    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toContain('data de pagamento')
  })
})
```

**Atenção ao harness real deste arquivo** — ele NÃO tem `rodarComDocumento`/`itensGravados`/`documentoGravado`. O que existe (conferido em 23/08):

- `vi.hoisted()` devolve um objeto **`estado`** (linha 10) com, entre outros: `estado.lido` (o que `lerDocumentoPdf` mockado devolve), `estado.documentoInserido` e `estado.itensInseridos`.
- Helpers `item(over)` (linha 185) e `documento(over)` (linha 198), que montam `ItemDocumentoLido` / `DocumentoLido`.
- Constantes `PDF`, `ARQUIVO`, `HOJE`, `FAZENDA`, `anthropic`.

Então cada teste desta task segue o formato:

```ts
  it('contrato grava conta_como_compra: true', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }
    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    expect(estado.itensInseridos[0].conta_como_compra).toBe(true)
  })

  it('grava o tipo em documentos_controle', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }
    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    expect(estado.documentoInserido.tipo).toBe('contrato')
  })
```

O helper `documento(over)` precisa passar a aceitar `tipoDocumento` e `pagamentos` — a Task 2 e a Task 3 já os tornaram obrigatórios em `DocumentoLido`, então o TS vai cobrar. Acrescentar os dois no corpo do helper com padrão `tipoDocumento: 'extrato'` e `pagamentos: []` (o padrão precisa ser extrato: a maioria dos testes deste arquivo foi escrita para o extrato da Solos).

Acrescentar o mock novo junto dos outros `vi.mock` do topo:

```ts
const gravarContasMock = vi.fn().mockResolvedValue({ criadas: 0, duplicadas: 0, erro: null })
vi.mock('../contas/gravarContasDoContrato', () => ({
  gravarContasDoContrato: (...args: unknown[]) => gravarContasMock(...args),
}))
```

⚠️ `vi.mock` é içado para o topo do módulo — `gravarContasMock` precisa nascer dentro de `vi.hoisted()` (como `uploadMock` e `removeMock` já fazem) ou o `vi.mock` estoura com "Cannot access before initialization".

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
cd api && npx vitest run src/services/controle/gravarDocumentoPdf.test.ts -t "contrato x extrato"
```

Esperado: FALHA — `conta_como_compra` é sempre `false` e `contasCriadas` não existe.

- [ ] **Step 3: Ampliar o tipo do resultado**

Na variante `'gravado'` de `ResultadoGravarDocumento`:

```ts
      // Quantas contas a pagar nasceram deste documento. Sempre 0 para
      // extrato (o boleto dele chega por e-mail, ver deContrato.ts).
      contasCriadas: number
      // Texto pronto para mostrar na tela quando o documento entrou mas a
      // conta a pagar não — sem isto, um contrato importado "com sucesso"
      // deixaria um vencimento invisível. null quando não há o que avisar.
      avisoContas: string | null
```

- [ ] **Step 4: Trocar o `false` cravado e gravar o tipo**

No `.insert()` de `documentos_controle`, acrescentar:

```ts
      tipo:             documento.tipoDocumento,
```

No objeto de cada item, trocar `conta_como_compra: false,` por:

```ts
        // O TIPO decide, não a aba. Extrato de revenda (Syagri, Solos,
        // Protec) tem NF-e chegando pelo Make e some do total de propósito —
        // contar aqui dobraria o dinheiro. Contrato de fabricante (Mosaic)
        // nunca gera NF-e no sistema: é a única fonte daquele gasto, e se não
        // contar aqui não conta em lugar nenhum. Medido em 23/08/2026: zero
        // NF-e de fornecedor de adubo no banco.
        conta_como_compra:       documento.tipoDocumento === 'contrato',
```

- [ ] **Step 5: Chamar a criação das contas antes do return de sucesso**

Logo antes do `return { status: 'gravado', ... }`, depois do `console.log` que já existe:

```ts
    // Depois dos itens, nunca antes: uma conta a pagar apontando para um
    // documento que não conseguiu gravar item nenhum seria uma dívida sem
    // compra. Chega aqui só quando o documento e os itens já estão de pé.
    let contasCriadas = 0
    let avisoContas: string | null = null

    if (documento.tipoDocumento === 'contrato') {
      const contas = await gravarContasDoContrato(documento, documentoId, fazendaId)
      contasCriadas = contas.criadas

      if (contas.erro) {
        avisoContas = `O contrato foi importado, mas a conta a pagar não pôde ser criada (${contas.erro}). Cadastre o vencimento à mão em Contas a Pagar.`
      } else if (contas.criadas === 0 && contas.duplicadas === 0) {
        avisoContas = 'O contrato foi importado, mas não encontrei a data de pagamento nele. Cadastre a conta à mão em Contas a Pagar.'
      }
    }
```

E incluir `contasCriadas,` e `avisoContas,` no objeto do `return`.

Importar no topo do arquivo:

```ts
import { gravarContasDoContrato } from '../contas/gravarContasDoContrato'
```

- [ ] **Step 5b: Avisar quando o documento é extrato (movido da Task 9 no pre-flight)**

No mesmo bloco do Step 5, acrescentar o caso do extrato — quem importou pela aba de Contas a Pagar esperando um vencimento precisa saber por que ele não nasceu:

```ts
    if (documento.tipoDocumento !== 'contrato') {
      // Extrato não gera conta a pagar de propósito: o boleto dele chega por
      // e-mail pelo Make (nfeEmail.ts). Sem esta linha, quem subiu o arquivo
      // pela aba de Contas a Pagar ficaria esperando uma conta que nunca vem.
      avisoContas = 'Isto é um extrato de revenda, não um contrato — os itens entraram na aba Controle e nenhuma conta a pagar foi criada (o boleto do extrato chega por e-mail).'
    }
```

Teste correspondente:

```ts
  it('extrato avisa que não gerou conta a pagar', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'extrato' }) }
    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toContain('extrato de revenda')
    expect(r.contasCriadas).toBe(0)
  })
```

- [ ] **Step 6: Rodar a suíte inteira**

```bash
cd api && npm test
```

Esperado: PASSA. Se algum teste antigo de `gravarDocumentoPdf.test.ts` quebrar por causa dos dois campos novos no retorno, **atualizar o teste** — não remover o campo.

- [ ] **Step 7: Commit**

```bash
git add api/src/services/controle/gravarDocumentoPdf.ts api/src/services/controle/gravarDocumentoPdf.test.ts
git commit -m "feat(controle): contrato conta como gasto e vira conta a pagar; extrato nao muda"
```

---

## Task 7: Trava contra o lançamento duplo

**Files:**
- Modify: `api/src/services/contas/pagamento.ts:33`
- Test: `api/src/services/contas/pagamento.test.ts`

**Interfaces:**
- Consumes: nada de tarefas anteriores (só a coluna da Task 1)
- Produces: `precisaCriarLancamento(conta: { nota_fiscal_id: string | null; documento_controle_id: string | null }): boolean`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `api/src/services/contas/pagamento.test.ts`:

```ts
describe('precisaCriarLancamento — conta vinda de contrato', () => {
  // O gasto do contrato JÁ entrou no Financeiro na data do contrato, via
  // itens_nfe (conta_como_compra = true). Criar lançamento ao marcar a conta
  // como paga somaria os mesmos R$ 647.986,35 uma segunda vez.
  it('conta de contrato NÃO cria lançamento', () => {
    expect(precisaCriarLancamento({
      nota_fiscal_id: null,
      documento_controle_id: 'doc-1',
    })).toBe(false)
  })

  it('conta avulsa (os dois vínculos nulos) CONTINUA criando lançamento', () => {
    expect(precisaCriarLancamento({
      nota_fiscal_id: null,
      documento_controle_id: null,
    })).toBe(true)
  })

  it('conta de NF-e continua sem criar lançamento', () => {
    expect(precisaCriarLancamento({
      nota_fiscal_id: 'nota-1',
      documento_controle_id: null,
    })).toBe(false)
  })

  // Conta antiga, gravada antes da migration 012: o Supabase devolve
  // undefined para coluna ausente no select, e `undefined === null` é false
  // — sem o tratamento, TODA conta avulsa antiga pararia de lançar.
  it('coluna ausente (conta antiga) se comporta como nula', () => {
    expect(precisaCriarLancamento({
      nota_fiscal_id: null,
      documento_controle_id: undefined as unknown as null,
    })).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
cd api && npx vitest run src/services/contas/pagamento.test.ts -t "conta vinda de contrato"
```

Esperado: FALHA — a função ignora `documento_controle_id`.

- [ ] **Step 3: Implementar**

Substituir a função em `pagamento.ts` (mantendo o comentário-cabeçalho longo que já existe acima dela, e acrescentando este bloco logo antes da função):

```ts
// Segundo caso de "já tem lançamento, não crie outro" (23/08/2026): conta
// nascida de CONTRATO de adubo. O gasto dela já entrou no Financeiro na data
// do contrato, por itens_nfe com conta_como_compra = true (ver
// gravarDocumentoPdf.ts) — marcar a conta como paga só carimba data e valor.
// Sem esta condição, o sistema dobraria os R$ 647.986,35 do contrato Mosaic
// sozinho, sem NF-e nenhuma envolvida.
//
// `!= null` (frouxo) e não `=== null`: o Supabase devolve `undefined` para
// coluna ausente, e conta gravada antes da migration 012 não tem a coluna no
// objeto. Com comparação estrita, toda conta avulsa antiga pararia de lançar.
export function precisaCriarLancamento(
  conta: { nota_fiscal_id: string | null; documento_controle_id?: string | null },
): boolean {
  return conta.nota_fiscal_id == null && conta.documento_controle_id == null
}
```

- [ ] **Step 4: Rodar a suíte inteira**

```bash
cd api && npm test
```

Esperado: PASSA. `/contas/:id/pagar` faz `select('*')`, então a coluna nova chega sem mudança na rota.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/contas/pagamento.ts api/src/services/contas/pagamento.test.ts
git commit -m "fix(contas): pagar conta de contrato nao lanca o gasto uma segunda vez"
```

---

## Task 8: Fornecedor na coluna Origem do Financeiro

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx` (query do `load()`, ~linha 493; montagem de `nfeItems`, ~linha 513)

**Interfaces:**
- Consumes: coluna `itens_nfe.fornecedor` (já existe desde a migration 017)
- Produces: `ItemFinanceiro.emitente_nome` preenchido para item de PDF

- [ ] **Step 1: Acrescentar `fornecedor` ao select**

Na query de `itens_nfe`, incluir `fornecedor` na lista de colunas:

```ts
        .select('id, descricao, quantidade, unidade, valor_unitario, valor_total, centro_custo, insumo_id, conta_como_compra, data_manual, nota_fiscal_id, fornecedor, insumos(tipo), notas_fiscais(numero, emitente_nome, data_emissao)')
```

- [ ] **Step 2: Usar o fornecedor como fallback**

Na montagem de `nfeItems`, trocar a linha de `emitente_nome`:

```ts
      // Item de PDF (contrato/extrato) não tem nota vinculada, então
      // `notas_fiscais.emitente_nome` vem vazio e a coluna Origem saía em
      // branco — o dono via R$ 647.986,35 sem saber de quem era. A coluna
      // `fornecedor` de itens_nfe (migration 017) é quem guarda esse nome.
      emitente_nome: row.notas_fiscais?.emitente_nome ?? row.fornecedor ?? '',
```

- [ ] **Step 3: Conferir no navegador**

Subir a web (`preview_start`), abrir `/financeiro`, filtrar por julho/2026 e confirmar que as linhas de PDF (Syagri, Solos, Protec) agora mostram o nome do fornecedor na coluna Origem, em vez de vazio.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "fix(financeiro): item vindo de PDF mostra o fornecedor na coluna Origem"
```

---

## Task 9: Botão "Importar contrato (PDF)" em Contas a Pagar

**Files:**
- Modify: `web/app/(app)/controle/components/dialogo-importar.tsx`
- Modify: `web/app/(app)/contas/page.tsx`
- Modify: `web/lib/types.ts` (`ResultadoGravarDocumento`)

**Interfaces:**
- Consumes: `POST /controle/documentos` (mesmo endpoint do Controle), resultado com `contasCriadas` e `avisoContas` da Task 6
- Produces: `DialogoImportar` com prop nova `titulo?: string`

- [ ] **Step 1: Espelhar os campos novos no tipo do front**

Em `web/lib/types.ts`, na variante `'gravado'`:

```ts
  | { status: 'gravado'; documentoId: string; itensGravados: number; itensDescartados: number; itensDuplicados: number; contasCriadas: number; avisoContas: string | null }
```

- [ ] **Step 2: Mostrar o aviso e a conta criada no diálogo**

Em `dialogo-importar.tsx`, no estado de sucesso, acrescentar `contasCriadas` e `avisoContas`:

```tsx
  | { fase: 'sucesso'; itensGravados: number; itensDuplicados: number; itensDescartados: number; contasCriadas: number; avisoContas: string | null }
```

Na montagem do estado de sucesso, repassar os dois campos do resultado. E na tela de sucesso, abaixo do texto que já existe:

```tsx
        {estado.contasCriadas > 0 && (
          <p className="text-sm text-muted-foreground">
            {plural(estado.contasCriadas, 'conta criada', 'contas criadas')} em Contas a Pagar.
          </p>
        )}
        {estado.avisoContas && (
          <p className="text-sm text-amber-600">{estado.avisoContas}</p>
        )}
```

Acrescentar a prop de título, para o botão poder dizer "contrato" em Contas a Pagar e "documento" no Controle:

```tsx
type DialogoImportarProps = {
  onImportar: (pdf: File) => Promise<ResultadoGravarDocumento>
  // Rótulo do botão e do cabeçalho. O comportamento NÃO muda com ele: o
  // servidor decide o que fazer pelo TIPO lido do PDF, nunca pela aba de
  // origem — dois caminhos com regras diferentes para o mesmo arquivo seria
  // a porta dos fundos por onde uma trava de dedupe deixa de valer.
  titulo?: string
}
```

Usar `titulo ?? 'Importar documento'` onde o texto do botão é montado hoje.

- [ ] **Step 3: Ligar o botão na página de Contas a Pagar**

Em `web/app/(app)/contas/page.tsx`, importar o diálogo e a função de upload:

```tsx
import { DialogoImportar } from '../controle/components/dialogo-importar'
```

Copiar a função `importarDocumento` de `use-controle-data.ts` para um módulo compartilhado **ou** — mais simples e sem refatoração — chamar `api.post` direto num handler local:

```tsx
  async function importarContrato(pdf: File) {
    const arquivo = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      // readAsDataURL devolve "data:application/pdf;base64,XXXX" — a API
      // espera só o base64 puro.
      reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
      reader.readAsDataURL(pdf)
    })

    const resultado = await api.post<ResultadoGravarDocumento>('/controle/documentos', {
      arquivo,
      nomeArquivo: pdf.name,
    })

    // Recarrega a lista: a conta recém-criada precisa aparecer sem F5.
    // A função de recarga desta página chama-se `load()` (definida em
    // web/app/(app)/contas/page.tsx:231) — conferido em 23/08/2026.
    if (resultado.status === 'gravado') await load()

    return resultado
  }
```

Ao lado dos botões "Nova conta avulsa" / "Nova conta fixa" (~linha 479):

```tsx
          <DialogoImportar onImportar={importarContrato} titulo="Importar contrato (PDF)" />
```

- [ ] **Step 4: (MOVIDO PARA A TASK 6 no pre-flight de 23/08 — dois donos para o mesmo arquivo)**

O aviso de "extrato na aba errada" mora em `gravarDocumentoPdf.ts`, que é arquivo da Task 6. Deixá-lo aqui daria dois donos ao mesmo arquivo em duas tasks. **A Task 6 já entrega este comportamento** — aqui não há nada a fazer. Texto original preservado abaixo para referência:

<details><summary>Texto original do Step 4</summary>

A spec original dizia *"recusa com: Isto é um extrato de revenda"*. **Mudado de propósito** (23/08, ver a mesma correção na spec): quando o arquivo chega na aba de Contas a Pagar, a IA **já leu** o PDF — a chamada já foi paga e o documento já é válido. Recusar depois disso joga fora trabalho bom e obriga o dono a subir o mesmo arquivo de novo noutra aba. Pior: seria uma regra de negócio decidida pela ABA, e é exatamente assim que dois caminhos para o mesmo arquivo passam a divergir.

Comportamento correto: **importa normalmente e avisa onde o documento foi parar.** Em `gravarDocumentoPdf.ts` (Task 6), o `avisoContas` já cobre isto — basta acrescentar o caso do extrato ao bloco:

```ts
    if (documento.tipoDocumento !== 'contrato') {
      // Só para quem importou pela aba de Contas a Pagar esperando um
      // vencimento. Extrato não gera conta a pagar de propósito: o boleto
      // dele chega por e-mail pelo Make. Sem esta linha, o dono ficaria
      // esperando uma conta que nunca vai nascer.
      avisoContas = 'Isto é um extrato de revenda, não um contrato — os itens entraram na aba Controle e nenhuma conta a pagar foi criada (o boleto do extrato chega por e-mail).'
    }
```

Teste correspondente, no arquivo da Task 6:

```ts
  it('extrato avisa que não gerou conta a pagar', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'extrato' }) }
    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toContain('extrato de revenda')
    expect(r.contasCriadas).toBe(0)
  })
```

</details>

- [ ] **Step 5: Conferir no navegador**

Subir a web, abrir `/contas`, importar o contrato Mosaic real e confirmar: conta criada com vencimento 28/08/2026, valor R$ 647.986,35, fornecedor Mosaic. Depois abrir `/financeiro` (julho/2026) e confirmar que os R$ 647.986,35 entraram no Total de Despesas. Depois `/controle` e confirmar a linha na grade.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/contas/page.tsx" "web/app/(app)/controle/components/dialogo-importar.tsx" web/lib/types.ts api/src/services/controle/gravarDocumentoPdf.ts api/src/services/controle/gravarDocumentoPdf.test.ts
git commit -m "feat(contas): botao de importar contrato de adubo em PDF"
```

---

## Task 10: Revisão do Apolo e fechamento

**Files:** todos os tocados nas Tasks 1–9

- [ ] **Step 1: Rodar a suíte inteira**

```bash
cd api && npm test
```

Esperado: tudo verde. Nenhum teste antigo pode ter sido apagado para passar.

- [ ] **Step 2: Conferir o TypeScript**

```bash
cd api && npx tsc --noEmit
```

- [ ] **Step 3: Chamar o Apolo**

Ferramenta `Agent`, `subagent_type="apolo"`. **Obrigatório, não opcional** — o porteiro de qualidade já esgotou os bloqueios da sessão de 23/08 e não vai mais lembrar. Pedir atenção especial a:
- `pagamento.ts` — a trava do lançamento duplo é a linha mais cara deste plano
- `deContrato.ts` — o rateio, e a soma das parcelas fechando com o total
- `gravarDocumentoPdf.ts` — que extrato continue `false` em todos os caminhos

- [ ] **Step 4: Aplicar os achados e rodar os testes de novo**

- [ ] **Step 5: Conferir no ar com o contrato 280451 real**

O PDF está em `C:\Users\Dib\Downloads\`. Importar pela tela de Contas a Pagar e conferir os três lugares.

- [ ] **Step 6: Abrir o PR e atualizar o ESTADO.md**

```bash
git push -u origin feature/contrato-adubo-contas-a-pagar
```

No `ESTADO.md`, mover o bloco de 23/08 de "SPEC APROVADA, nada codado" para o estado real.
