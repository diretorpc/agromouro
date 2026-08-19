# Design: gráficos na aba Controle — 19/08/2026

> **Status: desenho aprovado, NADA construído.** Este documento é o que a próxima
> sessão executa. Escrito depois de o Matheus pedir "um gráfico de todo jeito
> possível — fornecedor, produto, preço, tudo, liberdade total".

---

## Contexto: por que isto existe (e uma lição de processo)

A aba `/controle` importa PDF de extrato/contrato de fornecedor e hoje mostra os itens
numa grade editável estilo Excel (PR #62, 18/08). Ela responde *"o que eu comprei"*,
mas não responde nenhuma pergunta de **padrão**: com quem gasto mais, qual insumo come
o orçamento, se o preço subiu.

⚠️ **O Matheus lembrava de ter pedido gráficos e não havia registro nenhum.** Procurei
nos 3 desenhos anteriores do Controle, nos 2 planos, no `ESTADO.md`, no histórico
completo de sessões e nos mockups do brainstorming de 17/08 — nada. Mas os mesmos
documentos mostram escopo sendo cortado três vezes ("fora de escopo: cruzamento com
NF-e · editar documento pela tela · excluir documento pela tela"), e **duas dessas ele
mandou construir depois, irritado, porque tinham sido cortadas sem perguntar**. A
tabela editável foi a terceira. Ou seja: o registro deste projeto já perdeu pedido dele
antes. Trate a ausência de rastro como falha do registro, não como prova.

---

## Objetivo

Cinco gráficos na aba Controle, todos obedecendo os filtros já existentes da tela
(fornecedor, status, período). Os três primeiros mostram **para onde o dinheiro foi**;
os dois últimos mostram se ele está **pagando caro** — que é a conversa que ele tem com
o vendedor.

| # | Gráfico | Pergunta que responde | Forma |
|---|---|---|---|
| 1 | Gasto por fornecedor | Quanto deixei em cada loja | Barra horizontal |
| 2 | Gasto por produto | Qual insumo come meu dinheiro | Barra horizontal |
| 3 | Gasto por mês | Quando o dinheiro sai | Barra vertical |
| 4 | Preço unitário no tempo | O fornecedor está aumentando meu preço? | Linha |
| 5 | Preço do mesmo produto por fornecedor | Qual loja me cobra mais caro? | Barra horizontal |

---

## Decisões fechadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Quais gráficos? | **Os 5 acima.** "Liberdade total" do Matheus, 19/08. |
| 2 | Os gráficos respeitam os filtros da tabela? | **Sim.** Filtrou fornecedor ou período, o gráfico acompanha. Sem isso vira uma segunda tela desconectada. |
| 3 | Somar onde? | **No banco, via RPC.** Ver "Por que RPC e não agregar em Node" abaixo — é o ponto técnico que decide se o gráfico mente ou não. |
| 4 | Muitas barras viram sopa | **Top 10 + "outros" agrupado**, com botão "ver todos". |
| 5 | Onde ficam na tela? | **Acima da grade, recolhíveis** — a grade continua sendo o centro da tela; gráfico é apoio, não protagonista. Estado de aberto/fechado guardado em `localStorage`. |
| 6 | Biblioteca | **Recharts**, já em uso em `/financeiro`, `/dashboard`, `/cartoes`, `/custos` (`web/package.json`: `recharts ^3.8.1`). Seguir o padrão de `financeiro/page.tsx:936` (`ResponsiveContainer` + `BarChart` + `Cell` + `LabelList`). |

---

## O ponto técnico que decide tudo: por que RPC e não agregar em Node

A grade carrega **500 itens por vez**. Um gráfico montado em cima do que está carregado
**mente em silêncio**: mostra a soma de um pedaço e parece a soma do todo. É exatamente
a categoria de erro que já mordeu esta feature 4 vezes (rota no lugar errado, dinheiro
em pt-BR, Ctrl+A apagando tudo) — tudo verde, tudo errado.

Agregar em Node também não resolve: o PostgREST corta em **1000 linhas por padrão**, e
o próprio Apolo já registrou que a varredura de duplicatas fica arbitrária acima disso
(pendência aberta no `ESTADO.md`).

**Decisão: função no Postgres (RPC), com `GROUP BY` de verdade.** Migration nova (020),
aplicada à mão no SQL Editor do Supabase — mesmo caminho da 017/018/019.

⚠️ **A migration precisa ser colada no chat em bloco de código quando for construída,
não só citada por caminho de arquivo** — regra registrada do Matheus.

---

## Design técnico

### 1. Migration 020 — funções de agregação

Cinco funções (ou uma com parâmetro de "modo"), todas recebendo os mesmos filtros que
`GET /controle/itens` já usa, e **todas obrigadas a filtrar `fazenda_id`**.

⚠️ **Isolamento multi-fazenda:** a API usa `SUPABASE_SERVICE_KEY`, então **a RLS não
protege nada nessa porta** — o filtro por `fazenda_id` tem que estar dentro da função,
e precisa de teste que falhe se alguém tirar (o padrão de teste com `FAZENDA_A`/
`FAZENDA_B` já existe em `listarItensControle.test.ts` e `controleItens.test.ts`).

Filtro comum a todas (espelhar `listarItensControle.ts:83-112`):
- `fazenda_id` (obrigatório, nunca vindo do corpo da requisição — sempre de `fazendaDe(req)`)
- `fornecedor[]`, `dataInicio`, `dataFim`
- `status[]` — ⚠️ pertence ao **documento**, não ao item, e o filtro atual usa um OR que
  **preserva item avulso sempre visível**. Replicar essa regra, não reinventar.
- Sempre `nota_fiscal_id is null` (só item de Controle, nunca de NF-e)

### 2. Rota — `GET /controle/graficos`

Router próprio ou dentro de `controleItens.ts`. **Item não é sub-recurso de documento** —
essa lição já custou uma sessão inteira (as rotas de item nasceram montadas em
`/controle/documentos` e davam 404 em tudo, com 479 testes verdes).

⚠️ **Escreva o teste de caminho HTTP real** — `routeMounts.test.ts` já existe e cruza o
`index.ts` lido como texto com os caminhos literais do hook do frontend. Estenda-o para
a rota nova; teste de handler direto NÃO pega rota montada no lugar errado.

Resposta sugerida (uma chamada só, não cinco):
```ts
{
  porFornecedor: { rotulo: string, total: number }[],
  porProduto:    { rotulo: string, total: number }[],
  porMes:        { mes: string, total: number }[],       // 'YYYY-MM'
  precoNoTempo:  { produto: string, pontos: { data: string, precoMedio: number }[] }[],
  precoPorFornecedor: { produto: string, barras: { fornecedor: string, precoMedio: number, precoMin: number, precoMax: number }[] }[],
}
```

### 3. Frontend

- `web/app/(app)/controle/components/graficos-controle.tsx` — os 5 gráficos
- `web/app/(app)/controle/hooks/use-controle-graficos.ts` — busca, com os mesmos
  filtros do `use-controle-itens.ts`

⚠️ **Reaproveite o objeto de filtros que já existe**, não crie um paralelo — senão a
grade e o gráfico divergem e ninguém percebe.

⚠️ **Debounce:** `use-controle-itens.ts` já aplica 300ms **só quando o filtro muda**
(montagem/paginação disparam na hora). O gráfico deve pegar carona no mesmo momento,
não fazer a própria rajada de chamadas — foi bug real desta tela.

⚠️ **Formatação de dinheiro em pt-BR:** use `web/app/(app)/controle/components/colunas-br.ts`
(`parseNumeroBR`/formatação), que já existe e tem teste provado por mutação. **Não use
`Intl.NumberFormat()` sem locale** — foi exatamente assim que R$ 1.234,56 virou R$ 1,23
nesta mesma tela.

### 4. Testes

`web/` **tem test runner desde ontem** (vitest, 38 testes). Cobrir com teste puro:
- a normalização de produto (seção abaixo)
- o agrupamento "top 10 + outros"
- a formatação de valores

Backend: teste de rota (400 sem fazenda, 200 com dados, isolamento entre fazendas) e
teste da agregação.

---

## ⚠️ O limite honesto: comparar preço entre fornecedores não funciona direito

**Medido, não suposto:**
- `gravarDocumentoPdf.ts:412` grava `insumo_id: null` — **item de Controle NUNCA é
  vinculado ao catálogo de insumos.** Não existe id compartilhado para agrupar.
- A descrição vem do PDF com o **código do fornecedor grudado na frente**:
  `0003586-ENGEO PLENO S - 20 LT`. Esse `0003586` é o código **da SYAGRI**. Outro
  fornecedor usa outro código para o mesmo produto.

Consequência: agrupar por descrição crua compara **produto do mesmo fornecedor** (funciona
sempre — o código é estável) mas **falha entre fornecedores**, que é justamente a graça
do gráfico 5.

**Solução barata para começar:** normalizar a descrição — remover o código numérico
inicial, maiúsculas, colapsar espaços, remover acento:
```
"0003586-ENGEO PLENO S - 20 LT"  →  "ENGEO PLENO S 20 LT"
"12345-Engeo Pleno S  20L"       →  "ENGEO PLENO S 20L"    ← ainda não bate
```
Melhora muito, **não resolve tudo**. Embalagem escrita diferente (`20 LT` vs `20L`) segue
separada.

**Não invente casamento aproximado (fuzzy) sem pedir.** Casar errado dois produtos
diferentes num gráfico de preço é pior que não casar: ele negocia com o fornecedor em
cima de um número falso. Se o gráfico 5 vier pobre, **mostre isso ao Matheus e deixe ele
decidir** entre: (a) aceitar como está, (b) uma tela de "esses dois são o mesmo produto?"
para ele confirmar à mão, (c) vincular item de Controle ao catálogo de insumos (trabalho
grande, mexe na gravação).

---

## Fora de escopo

- **Cruzamento com NF-e** ("isto já tem nota / isto só tem PDF") — continua sendo a maior
  lacuna da aba, cortada em todos os desenhos anteriores. **Não empurre para dentro
  deste trabalho**; merece desenho próprio.
- **Exportar gráfico** (PNG/PDF) — não foi pedido.
- **Gráfico de quantidade** (kg/L por produto) — o valor em dinheiro cobre a pergunta
  principal; unidade mistura kg com litro e não soma.

---

## Riscos e perguntas em aberto

1. **Volume hoje é minúsculo** (~28 itens): com tão pouco dado, os 5 gráficos podem
   parecer vazios ou ridículos. Vale mostrar ao Matheus cedo, com dado real, antes de
   polir. Se ficar pobre demais, talvez valham 3 gráficos e não 5.
2. **Preço médio esconde variação.** Uma compra de 1 unidade e outra de 500 pesam igual
   numa média simples. Considerar média **ponderada pela quantidade** — e dizer qual foi
   usada na legenda, senão o número engana.
3. **Item avulso (digitado à mão) pode não ter fornecedor** — cai em "sem fornecedor" no
   gráfico 1. Confirmar que aparece, não que some.
4. **Migration 020 precisa ser aplicada em produção à mão** antes de o código subir,
   senão a rota devolve 500 (foi exatamente o que aconteceu com a 019 ontem).

---

## Arquivos afetados (previsão)

- `api/src/database/migrations/020_controle_agregacoes.sql` — novo
- `api/src/routes/controleGraficos.ts` (ou dentro de `controleItens.ts`) + teste
- `api/src/services/controle/agregarControle.ts` + teste
- `api/src/index.ts` — montar a rota
- `api/src/routes/routeMounts.test.ts` — estender para a rota nova
- `web/app/(app)/controle/components/graficos-controle.tsx` + teste — novo
- `web/app/(app)/controle/hooks/use-controle-graficos.ts` — novo
- `web/app/(app)/controle/page.tsx` — encaixar acima da grade
- `web/lib/types.ts` — tipos da resposta
