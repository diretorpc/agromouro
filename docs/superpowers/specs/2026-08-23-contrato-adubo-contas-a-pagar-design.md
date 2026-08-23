# Design: contrato de adubo vira conta a pagar + gasto no Financeiro — 23/08/2026

> **Status: desenho aprovado pelo Matheus, NADA construído.** Este documento é o que a
> próxima sessão executa. Escrito depois de ele anexar um contrato real da Mosaic e
> pedir: *"quero essa função de ler o contrato e cadastrar a data de pagamento na ABA
> do contas a pagar! Cada um no seu quadrado. Também quero que joga o valor, produto,
> quantidade e fornecedor na aba financeiro"*.

---

## Contexto: o que foi MEDIDO antes de desenhar

Nada aqui é lembrança. Cada linha desta seção foi conferida no sistema em 23/08/2026.

**1. O leitor atual JÁ lê o contrato da Mosaic, sem erro.** Rodei `lerDocumentoPdf()`
contra o PDF real (contrato 280451, 12 páginas, Docusign) com a chave de produção:

| Campo | Lido |
|---|---|
| fornecedor | `Mosaic Fertilizantes do Brasil Ltda.` |
| dataDocumento | `2026-07-03` (Data de Início do Quadro Resumo) |
| codigoCliente | `280451` |
| descrição / qtde / unidade | `MS15F 09 23 18 S15` / `165` / `MTN` |
| valorUnitario / valorTotal | `3927.19` / `647986.35` |
| divergenciaTotal | `0` |

165 × 3.927,19 = 647.986,35 — fecha no centavo. Ignorou as 11 páginas de cláusula e o
certificado Docusign. **Leitura não é o problema deste projeto.** O problema é o que se
faz com o que foi lido.

**2. O que o leitor JOGA FORA hoje:** a linha `Data de pagamento: 28/08/2026` do Quadro
Resumo. O schema não tem campo pra ela. Consequência medida: R$ 647.986,35 vencendo em
5 dias e o Contas a Pagar não sabe que existe.

**3. A Mosaic nunca mandou NF-e.** Conferido no banco:

```sql
select count(*) from notas_fiscais where emitente_nome ilike '%mosaic%';                         -- 0
select count(*) from notas_fiscais
 where emitente_nome ilike any (array['%fertiliz%','%mosaic%','%cibra%','%yara%']);              -- 0
```

Zero NF-e de **qualquer** fornecedor de adubo. Isto derruba a premissa que sustentava a
decisão de 17/08 (`conta_como_compra: false` sempre) — aquela decisão nasceu pensando em
extrato de revenda, onde a NF-e chega mesmo. Para contrato de fabricante, ela transforma
a única fonte de verdade em número invisível.

**4. Os três PDFs já importados são todos extrato, e somam R$ 2,77 milhões:**

| Fornecedor | Documento | Valor |
|---|---|---|
| SYAGRI AGRONEGOCIOS | `000091-2026-07-29` | R$ 1.406.915,25 |
| SOLOS SOLUCOES AGRICOLAS | `000786-2026-07-29` | R$ 676.773,19 |
| Protec Produtos Agricolas | `00362-2026-07-15` | R$ 685.054,96 |

Esses R$ 2,77 mi **não contam** como gasto hoje, e **precisam continuar não contando** —
as NF-e dessas revendas chegam pelo Make. Qualquer mudança que ligue "PDF conta como
gasto" de forma global dobra esse dinheiro. É a trava de regressão nº 1 deste projeto.

---

## O eixo do desenho: o TIPO do documento decide, não a aba

| Documento | NF-e chega depois? | Conta como gasto? |
|---|---|---|
| **Extrato de contas a receber** (Syagri, Solos, Protec) | Sim, o Make derruba | **Não** (`false`) |
| **Contrato de compra e venda** (Mosaic) | Nunca chega | **Sim** (`true`) |

O leitor já distingue os dois formatos na prática — o prompt do `INSTRUCAO` descreve os
dois e trata cada um de um jeito. Ele só nunca foi **perguntado** qual dos dois estava
lendo.

---

## Decisões fechadas com o Matheus (23/08/2026)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Contrato soma como gasto no Financeiro, se a NF-e vier depois? | **A Mosaic não manda NF-e** — o contrato é a única fonte. Conta como gasto. Extrato continua não contando. |
| 2 | Em que data o gasto entra? | **Financeiro: data do contrato** (03/07). **Contas a Pagar: data de vencimento** (28/08). Cada tela responde a sua pergunta. |
| 3 | O contrato aparece também na grade do Controle? | **Sim, nos três lugares.** Sai de graça (a grade lê a mesma tabela) e ele ganha a edição manual estilo Excel que o Controle já tem. |
| 4 | Um leitor só ou leitor próprio em `contas/`? | **Um leitor só, dois destinos.** Leitor separado duplicaria ~600 linhas de validação, e o item teria de ir para `itens_nfe` de qualquer jeito — a separação seria ilusória. |
| 5 | Onde fica o botão? | **Aba Contas a Pagar.** O do Controle continua existindo e aceitando os dois tipos. |

---

## Arquitetura

```
PDF do contrato
      │
      ▼
documentoPdf.ts  ──► lê (JÁ FUNCIONA) + devolve tipoDocumento e pagamentos  ◄── MUDA
      │
      ▼
gravarDocumentoPdf.ts ──► documentos_controle (tipo)                        ◄── MUDA
      │                └► itens_nfe (conta_como_compra = tipo==='contrato')
      │
      ▼
deContrato.ts (NOVO) ──► contas_a_pagar (vencimento, documento_controle_id)
      │
      ├──► aba Contas a Pagar   — vence 28/08
      ├──► aba Financeiro       — gasto de 03/07, com fornecedor        ◄── MUDA
      └──► aba Controle         — linha editável (de graça, sem código)
```

---

## Componentes, um a um

### 1. `api/src/services/controle/documentoPdf.ts` — dois campos novos

Adicionar ao `SCHEMA`:

- **`tipoDocumento`**: `'extrato' | 'contrato' | null`.
  Descrição para a IA: extrato = relatório de contas a receber que a revenda emite,
  listando duplicatas em aberto; contrato = contrato de compra e venda com Quadro
  Resumo, Vendedora e mercadoria.
- **`pagamentos`**: array de `{ data: 'AAAA-MM-DD', valor: number | null }`.
  No contrato, a "Data de pagamento" do Quadro Resumo (uma por parcela, quando houver
  mais de uma). No extrato, **sempre vazio** — as duplicatas já viram itens, e criar
  conta a pagar para cada uma duplicaria o que o boleto por e-mail já faz.

Adicionar ao `INSTRUCAO`: uma frase explicando que a Data de Pagamento do Quadro Resumo
é o compromisso financeiro, distinta da Data de Início (que continua sendo
`dataDocumento`).

**Validação, em `validarDocumentoLido`:**

- `tipoDocumento` ausente, nulo ou fora do par → **`'extrato'`**. Sempre.
  *Motivo:* errar para "extrato" custa um valor que não soma e o dono corrige na tela;
  errar para "contrato" custa dinheiro contado duas vezes, calado. O default fica do
  lado barato — mesma lógica do `NULO SIGNIFICA "CONTA"` da migration 008, invertida
  porque aqui o risco está do outro lado.
- Cada `pagamento` passa pela `dataSanitizada` já existente (janela de 5 anos passado /
  3 futuro). Data fora da janela → o pagamento é **descartado**, não corrigido.
- `valor` do pagamento: mesmos tetos de `VALOR_MAX_DOCUMENTO`. Nulo é aceito → a conta
  nasce com o `valorTotalDocumento`.
- Contrato **sem nenhum pagamento válido** entra normalmente (itens e gasto), **sem**
  conta a pagar, e devolve isso no resultado para a tela avisar. Nunca inventa data.

`DocumentoLido` ganha `tipoDocumento: 'extrato' | 'contrato'` e
`pagamentos: PagamentoLido[]`.

### 2. `api/src/services/controle/gravarDocumentoPdf.ts` — uma regra muda

```ts
conta_como_compra: documento.tipoDocumento === 'contrato'
```

Substitui o `false` cravado. Todo o resto da função fica igual — inclusive
`data_manual`, que já grava a data do documento (03/07) e é exatamente o que o
Financeiro usa para datar o gasto.

Grava também `tipo` em `documentos_controle`.

Depois de gravar documento e itens, chama `criarContasDoContrato()` — só quando
`tipoDocumento === 'contrato'`.

### 3. `api/src/services/contas/deContrato.ts` — NOVO

Espelha `deNotaFiscal.ts`. Uma função pura de montagem + uma de gravação, para a
montagem ser testável sem banco.

Uma conta por pagamento lido:

| Coluna | Valor |
|---|---|
| `descricao` | `Contrato {codigoCliente} — {descrição do 1º item}` |
| `fornecedor` | `documento.fornecedor` |
| `categoria` | `'fertilizante_outro'` (editável na tela; o dono ajusta N/P/K) |
| `vencimento` | data do pagamento |
| `valor` | valor do pagamento (ver regra do valor ausente, abaixo) |
| `valor_estimado` | `false`, exceto no rateio descrito abaixo |
| `status` | `'aberta'` |
| `competencia` | `{ano-mês do vencimento}-01` (mesma regra da conta avulsa) |
| `documento_controle_id` | id do documento gravado |

**Regra do valor ausente — o buraco que quase passou.** O contrato pode trazer a data
sem repetir o valor ao lado. A regra ingênua ("valor nulo herda o total do documento")
funciona com uma parcela e **dobra a dívida com duas**: dois vencimentos herdando
R$ 647.986,35 cada viram R$ 1,29 mi devidos. Regra correta:

| Situação | O que faz |
|---|---|
| 1 pagamento, valor nulo | `valor = valorTotalDocumento`, `valor_estimado: false` |
| N pagamentos, todos com valor | usa o valor de cada um |
| N pagamentos, algum valor nulo | rateia `valorTotalDocumento` em partes iguais e marca **`valor_estimado: true`** nas N contas |
| Valor nulo e `valorTotalDocumento` nulo | cria a conta **sem valor**, `valor_estimado: true` — a tela já sabe pedir o valor real |

A coluna `valor_estimado` existe exatamente para isso, e o `montarParcelas()` de
`parcelamento.ts` já sabe ratear valor entre parcelas — **reusar, não reescrever**.

**Falha ao criar a conta NÃO derruba o documento já gravado** — loga, devolve o aviso e
segue. Perder o documento inteiro por causa da conta seria trocar um problema pequeno
(digitar o vencimento à mão) por um grande (reimportar tudo).

### 4. Migration `supabase/migrations/012_contrato_em_contas_a_pagar.sql`

```sql
alter table contas_a_pagar
  add column if not exists documento_controle_id uuid
  references documentos_controle(id) on delete set null;

alter table documentos_controle
  add column if not exists tipo text
  check (tipo in ('extrato','contrato'));   -- nulo = extrato (os 3 já importados)

create unique index if not exists contas_a_pagar_contrato_unico
  on contas_a_pagar (fazenda_id, documento_controle_id, vencimento)
  where documento_controle_id is not null;
```

Aditiva. Nenhuma linha existente muda. `on delete set null` de propósito: apagar o
documento pela tela do Controle **não pode** apagar uma conta que talvez já esteja paga.

### 5. `api/src/services/contas/pagamento.ts` — a trava do lançamento duplo

```ts
export function precisaCriarLancamento(
  conta: { nota_fiscal_id: string | null; documento_controle_id: string | null },
): boolean {
  return conta.nota_fiscal_id === null && conta.documento_controle_id === null
}
```

**Por quê:** o gasto do contrato já entrou no Financeiro na data 03/07, via `itens_nfe`.
Marcar a conta como paga em 28/08 só carimba data e valor. Sem esta linha o sistema
dobraria os R$ 647.986,35 sozinho, sem NF-e nenhuma envolvida.

A rota `/contas/:id/pagar` faz `select('*')`, então a coluna nova chega ao `conta` sem
mudança de query.

### 6. `web/app/(app)/financeiro/page.tsx` — o pedido nº 2

Produto, quantidade e valor **já aparecem** — a tela lê `itens_nfe` inteira, sem filtro.
Faltam duas coisas:

- Somar `fornecedor` ao `select` de `itens_nfe`.
- Coluna Origem: `notas_fiscais.emitente_nome ?? fornecedor ?? ''`. Hoje item de PDF sai
  com origem vazia, porque não tem nota vinculada.

Com `conta_como_compra: true`, `contaComoGasto()` passa a incluir os R$ 647.986,35 no
Total de Despesas de **julho/2026**.

### 7. `web/app/(app)/contas/page.tsx` — botão de importar

Reaproveita `DialogoImportar` do Controle (teto de 10 MB e checagem de `.pdf` prontos),
apontando para o **mesmo endpoint `POST /controle/documentos`** — endpoint novo seria
uma segunda porta para a mesma gravação, e é assim que uma trava de dedupe passa a valer
só de um lado. O componente ganha uma prop `aceita: 'contrato' | 'extrato' | 'ambos'`
para a recusa da mensagem abaixo; a decisão continua sendo tomada no servidor, pelo tipo
lido, nunca pela aba de origem.

- Sucesso: *"Contrato 280451 — Mosaic Fertilizantes. R$ 647.986,35. Conta criada com
  vencimento em 28/08/2026."*
- Contrato sem data de pagamento legível: *"Contrato importado, mas não achei a data de
  pagamento — cadastre a conta à mão."*
- Extrato solto ali: recusa com *"Isto é um extrato de revenda, não um contrato —
  importe pela aba Controle."*

O botão do Controle continua aceitando os dois tipos.

---

## Testes — TDD, escritos antes do código

| Arquivo | Trava |
|---|---|
| `documentoPdf.test.ts` | contrato devolve `tipoDocumento: 'contrato'` + pagamentos |
| `documentoPdf.test.ts` | **tipo ausente/desconhecido cai em `'extrato'`** |
| `documentoPdf.test.ts` | data de pagamento fora da janela é descartada, documento entra |
| `documentoPdf.test.ts` | extrato nunca devolve pagamentos |
| `deContrato.test.ts` | uma conta por data de pagamento |
| `deContrato.test.ts` | 1 pagamento sem valor herda `valorTotalDocumento` |
| `deContrato.test.ts` | **2 pagamentos sem valor rateiam o total, não herdam cada um** |
| `deContrato.test.ts` | contrato sem pagamento não cria conta e devolve aviso |
| `gravarDocumentoPdf.test.ts` | contrato grava `conta_como_compra: true` |
| `gravarDocumentoPdf.test.ts` | **extrato continua `false`** — protege os R$ 2,77 mi |
| `gravarDocumentoPdf.test.ts` | falha ao criar conta não derruba o documento |
| `pagamento.test.ts` | conta com `documento_controle_id` **não** cria lançamento |
| `pagamento.test.ts` | conta avulsa (dois campos nulos) **continua** criando lançamento |

---

## Fora de escopo — dito em voz alta, não cortado em silêncio

1. **Cruzamento PDF ↔ NF-e.** Se a Mosaic um dia mandar NF-e, os R$ 647.986,35 contam
   duas vezes. Medição de hoje: zero NF-e de adubo no banco. Risco registrado, não
   resolvido. É a quarta vez que esta peça é adiada — se ela for cortada de novo, que
   seja com o dono sabendo.
2. **Estoque.** As 165 t não entram no estoque; nenhum item de PDF entra hoje. Ele não
   pediu.
3. **Contrato cancelado ou renegociado.** Não há fluxo de "desfazer contrato". A saída
   existente é apagar o documento pelo Controle — e, por causa do `on delete set null`,
   a conta a pagar **sobrevive** e precisa ser dispensada à mão.
4. **Reimportar depois de editar a linha à mão** pode furar a trava de dedupe de item
   (limitação que já existe hoje — migrations 018/019).

---

## Ordem de construção

1. Migration 012 (aplicar no Supabase antes de tudo)
2. Testes + `documentoPdf.ts` (tipo e pagamentos)
3. Testes + `deContrato.ts`
4. Testes + `gravarDocumentoPdf.ts` (ramificação)
5. Testes + `pagamento.ts` (trava do lançamento duplo)
6. Financeiro (fornecedor na coluna Origem)
7. Botão em Contas a Pagar
8. Conferir no ar com o contrato 280451 real
