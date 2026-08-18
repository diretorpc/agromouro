# Plano — Controle: tabela totalmente editável estilo Excel

> Desenho completo: `docs/superpowers/specs/2026-08-18-controle-tabela-editavel-design.md`.
> Decisões 1-5 já travadas com o Matheus, spec cobre COMO — este plano é
> tarefa-a-tarefa para executar.

## Tarefa 1 — Migration 019: colunas de duplicata confirmada

`api/src/database/migrations/019_itens_nfe_duplicata_confirmada.sql`:
`duplicata_confirmada_em timestamptz` + `duplicata_confirmada_vezes integer
not null default 0` em `itens_nfe`. `ADD COLUMN IF NOT EXISTS` (nunca DROP —
mesma disciplina das migrations 017/018). Verificação SQL no fim do arquivo.
**Não aplicada em produção nesta sessão** — só escrita; aplicar é passo
manual do Matheus no SQL Editor do Supabase, como sempre.

## Tarefa 2 — `gravarDocumentoPdf.ts`: persistir Caso 1 (reimportação pegou)

Em `inserirItensUmAUm`, ao capturar 23505 para um item: `SELECT id,
duplicata_confirmada_vezes FROM itens_nfe WHERE fazenda_id=... AND
fornecedor_normalizado=... AND numero_documento=... AND descricao=... AND
valor_total=... AND ocorrencia_no_documento=...` (as 6 colunas do índice
parcial, sem `documento_controle_id` — não faz parte da chave). `UPDATE`
nela: `duplicata_confirmada_em = now()`, `duplicata_confirmada_vezes =
vezes + 1`. Falha nesse UPDATE é logada, não propagada (mesmo padrão de
`marcarDocumentoComErro` — o item já foi corretamente tratado como
duplicata, o sinal extra é "nice to have", não pode derrubar a
importação). Teste em `gravarDocumentoPdf.test.ts`: reimportar exato mesmo
item duas vezes confirma que a segunda marca `duplicata_confirmada_em`
na linha original.

## Tarefa 3 — `GET /controle/itens` (rota nova, flat, com duplicatas)

Em `controle.ts`: novo handler. Query itens onde `fazenda_id = X AND
nota_fiscal_id IS NULL`, filtros de fornecedor/status (via JOIN/subquery
com `documentos_controle` quando precisar de status — item avulso não tem
documento, então filtro de status não pode excluir avulso por engano: só
filtra por status quando o item TEM `documento_controle_id`, avulso sempre
passa o filtro de status), período por `data_manual`. `pagina`/`porPagina`
(default 500, teto 1000). Consulta separada de agregação (Caso 2 do
desenho) roda sobre TODA a fazenda (sem paginação) e popula `duplicado`/
`duplicadoMotivo` nos itens da página atual, combinando com
`duplicata_confirmada_em is not null` (Caso 1) de cada linha. Teste:
isolamento por fazenda (padrão FAZENDA_A/FAZENDA_B já usado no arquivo),
item avulso aparece, item de NF-e nunca aparece, paginação, filtro,
duplicata pintada nos dois casos.

## Tarefa 4 — `PATCH /controle/itens/:id`

Service novo `api/src/services/controle/editarItemControle.ts` (padrão de
`excluirDocumentoControle.ts`: função pura, rota só mapeia status→HTTP).
Zod `.partial()`, pelo menos 1 campo. Busca por id+fazenda_id+`nota_fiscal_id
is null` — 404 fora disso. `conta_como_compra` fora do schema, update
sempre grava `false` cravado. 23505 vira 409. Teste: edição parcial (só
1 campo), 404 fora da fazenda, 404 em item de NF-e, 409 em conflito de
chave, **`conta_como_compra: true` no corpo é ignorado — grava `false`**.

## Tarefa 5 — `POST /controle/itens` (avulso) e `DELETE /controle/itens/:id`

`POST`: mesmo service ou vizinho (`criarItemControleAvulso`), `valor_total`
obrigatório, `documento_controle_id`/`nota_fiscal_id` sempre null,
`conta_como_compra` sempre false, `ocorrencia_no_documento: 0`. `DELETE`:
mesmo padrão de `excluirDocumentoControle.ts`, sem função atômica (não há o
que desfazer — Controle nunca mexe em estoque/lançamento). Comentário no
código sobre o risco de reimportação reviver a linha apagada (ver spec).
Testes: criação avulsa grava `conta_como_compra=false` mesmo se o corpo
mandar `true`; exclusão isola por fazenda; exclusão de item de NF-e
recusada (404).

## Tarefa 6 — Frontend: hook `use-controle-itens.ts`

Baseado em `use-controle-data.ts` (debounce só em filtro, guard
`cancelado`), adaptado para lista acumulada com "carregar mais" em vez de
paginação por clique. Expõe `itens`, `carregarMais`, `temMais`, `filtros`,
`aplicarFiltros`, `editarItem`, `criarItem`, `excluirItem` (as 3 últimas
chamam as rotas novas e atualizam o estado local otimisticamente,
revertendo a linha específica em caso de erro).

## Tarefa 7 — Frontend: `grade-itens.tsx` com `react-datasheet-grid`

`npm i react-datasheet-grid` em `web/`. Componente novo com as colunas
definidas no spec, `onChange` traduzindo operações UPDATE/CREATE/DELETE em
chamadas do hook (debounce de 400ms por linha em UPDATE), `rowClassName`
pintando duplicata. Filtro de fornecedor/status/período reaproveita
`FiltroColuna` já existente (import direto, sem duplicar).

## Tarefa 8 — Trocar a tela para o componente novo

`page.tsx` passa a usar `use-controle-itens` + `grade-itens.tsx` no lugar
de `use-controle-data` + `tabela-documentos.tsx`. Arquivos antigos ficam no
repo, sem uso (não apagar nesta tarefa — risco de remover algo que ainda
sirva de referência antes de confirmar que a tela nova está 100% ao vivo).

## Tarefa 9 — Revisão final + verificação

`cd api && npm test && npx tsc --noEmit` e `cd web && npm run build`.
Revisão do Apolo antes de considerar pronto para o Matheus testar ao vivo
(regra do projeto: código sem revisão é bloqueado pelo porteiro).
