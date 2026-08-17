# Design: tela `/controle` — Epic 2.4 da feature Controle

**Data:** 2026-08-17
**Status:** Aprovado pelo Matheus (brainstorming com companheiro visual), pronto para
virar plano de execução

---

## Objetivo

Construir a interface da aba Controle: upload de PDF (extrato de fornecedor ou
contrato de compra), lista dos documentos já importados, e visualização do PDF
original. É a primeira vez que alguém consegue *usar* a feature — hoje
(`gravarDocumentoDoPdf` + rotas da API, Epics 2.2/2.3) só existe por baixo, sem tela.

**O que este design NÃO faz:** não constrói o cruzamento visual "isto já tem NF-e /
isto só tem PDF" — decisão consciente de ir com a versão mínima primeiro (upload +
lista + ver PDF) e ver o que falta de verdade depois de usar um pouco. Ver seção "Fora
de escopo".

---

## Decisões fechadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Página nova no menu, ou aba dentro de tela existente? | **Página nova** (`/controle`), mesmo padrão de `/nfe`. Propósito próprio, não disputa espaço com outra tela. |
| 2 | Escopo desta primeira versão? | **Só upload + lista + ver PDF original.** Cruzamento com NF-e fica pra depois — decisão explícita de não inflar o escopo antes de usar. |
| 3 | Como sobe o PDF? | **Botão abre diálogo** (mesmo padrão de "Adicionar NF" em `/nfe`) — escolhe o arquivo, mostra "Lendo documento..." (a leitura por IA pode levar alguns segundos), fecha e a lista atualiza sozinha. |
| 4 | Documento com `status='erro'` aparece na lista? | **Sim, com selo vermelho visível.** Escondê-lo deixaria o Matheus sem saber que teve problema e sem chance de agir (ver decisão de design #4 da migration 018 — o documento fica preservado, com PDF intacto, justamente pra permitir reenvio). |
| 5 | Layout da lista, quando um documento tem vários itens? | **Célula mesclada, estilo Excel/planilha** (fornecedor/data/status "abraçam" as linhas dos itens do documento) — não o padrão de linha expansível que o Financeiro já usa. Decisão visual, comparada lado a lado no companheiro de brainstorming. |
| 6 | Como abre o PDF original de um documento? | **Ícone/botão na linha**, ao lado do status. Claro, sem adivinhação. |
| 7 | Paginação da lista? | **Páginas numeradas** (1, 2, 3...) — diferente do "Carregar mais" que Contas a Pagar usa. Escolha explícita do Matheus. |
| 8 | Filtro da lista? | **Por coluna, estilo Excel**: cada cabeçalho (Fornecedor, Status, Data, Valor) abre um menu com busca + lista de valores únicos (checkbox), permitindo filtro combinado (ex.: Fornecedor = SOLOS **e** Status = erro ao mesmo tempo). Motivo do Matheus: vai precisar conferir loja por loja/empresa por empresa, quer o controle fino. Escolhido explicitamente sobre a alternativa mais simples (barra de filtro única no topo). |

---

## Design técnico

### 1. API — `GET /controle/documentos` ganha filtro e paginação

A rota já existe (Epic 2.3) mas devolve a lista inteira, sem filtro nem
`.limit()` — pendência já registrada pelo Apolo (achado médio: 4+ documentos cheios de
itens podem estourar o teto de linhas do PostgREST em silêncio). A decisão #7/#8 deste
design resolve essa pendência como efeito colateral, não é trabalho extra.

**Query params novos:**
```
GET /controle/documentos?pagina=1&porPagina=20
  &fornecedor=SOLOS+SOLUÇÕES&fornecedor=SYAGRI   (repetível — múltipla seleção)
  &status=processado&status=erro                  (repetível)
  &dataInicio=2026-01-01&dataFim=2026-08-31
```

**Resposta muda de array para objeto paginado:**
```typescript
{
  documentos: DocumentoComItens[],
  paginaAtual: number,
  totalPaginas: number,
  totalDocumentos: number,
}
```

⚠️ **Mudança que quebra contrato** — o formato de resposta de `GET /controle/documentos`
muda de array para objeto. Como esta rota **não tem chamador nenhum ainda** (Epic 2.4 é
o primeiro consumidor real), não há regressão — é o momento certo pra essa mudança,
antes de qualquer código do front depender do formato antigo.

Filtro e paginação acontecem no banco (`supabase.from(...).range()` +
`.in('fornecedor_normalizado', [...])` + `.in('status', [...])` + `.gte/.lte` de data),
não em memória — a lista pode crescer bastante ao longo dos anos (5 fornecedores × 1
extrato/mês já são 60/ano, e o objetivo da tela é justamente acumular histórico).

### 2. API — rota nova `GET /controle/documentos/filtros`

Pra popular os menus de filtro por coluna com os valores que **realmente existem**
(não só os da página atual — um filtro por fornecedor que só mostra os fornecedores da
página 1 seria enganoso). Devolve:

```typescript
{
  fornecedores: string[],  // distinct fornecedor, ordenado
  status: ['importado', 'processando', 'processado', 'erro'],  // fixo, do check da migration 017
}
```

`fornecedores` vem de `select('fornecedor').eq('fazenda_id', ...)` com distinct feito
em código (Supabase/PostgREST não tem `DISTINCT` nativo na API REST) — lista pequena
(dezenas de fornecedores, não milhares), custo desprezível.

### 3. Frontend — estrutura de arquivos

Seguindo o padrão já usado em `/estoque` (hooks separados de componentes de UI):

- `web/app/(app)/controle/page.tsx` — página, monta os componentes
- `web/app/(app)/controle/hooks/use-controle-data.ts` — busca documentos (com filtro/
  paginação), busca valores de filtro, expõe `importarDocumento()` e `abrirPdf()`
- `web/app/(app)/controle/components/tabela-documentos.tsx` — a tabela com células
  mescladas, cabeçalhos com filtro embutido, paginação numerada no rodapé
- `web/app/(app)/controle/components/filtro-coluna.tsx` — o menu de filtro reutilizável
  (busca + checkbox de valores), um componente só, usado pelos 4 cabeçalhos
- `web/app/(app)/controle/components/dialogo-importar.tsx` — o diálogo de upload
- `web/components/sidebar.tsx` — item novo `{ href: '/controle', label: 'Controle', icon: FileStack }` (ou ícone equivalente disponível em lucide-react)

### 4. Diálogo de upload — estados

O diálogo cobre os 8 status que a API já devolve (Epic 2.3, já testado):

| Status da API | O que a tela mostra |
|---|---|
| `201 gravado` | Fecha o diálogo, lista recarrega, toast de sucesso com fornecedor + valor |
| `200 duplicada-hash` / `duplicada-conteudo` | Mensagem no diálogo: "Este documento já foi importado antes." — não é erro, não fecha sozinho, deixa o Matheus decidir (fechar ou tentar outro arquivo) |
| `422` (3 motivos) | Mensagem vermelha no diálogo com o texto exato de `error` que a API já manda em português — diálogo continua aberto pra tentar outro arquivo |
| `503 falha` | Mensagem "Tente de novo em alguns minutos." — mesmo padrão dos 422, diálogo aberto |
| `500 erro` | Mensagem genérica de erro + `detalhe` técnico num texto menor, pra caso precise reportar |

### 5. Tabela — comportamento das células mescladas

- Uma linha de "cabeça" por item de cada documento (célula de fornecedor/data/status
  com `rowSpan` = número de itens daquele documento).
- Documento sem nenhum item (`itens: []` — caso de reimportação onde tudo já existia,
  achado conhecido do Apolo) ainda aparece, com uma linha só, coluna de item vazia com
  texto "(nenhum item novo — documento já importado antes)" em vez de ficar em branco
  sem explicação. Resolve de brinde outra pendência que o Apolo tinha apontado
  (documento fantasma sem explicação na tela).
- Colunas: Fornecedor · Data · Item · Valor · Status · Ação (ícone abrir PDF, ancorado
  na primeira linha do grupo, já que é uma ação por documento, não por item).

---

## Fora de escopo

- **Cruzamento com NF-e** ("isto já tem nota / isto só tem PDF") — decisão #2. Fica
  pra uma iteração futura, com brainstorming próprio.
- **Editar ou reprocessar documento pela tela** — não foi pedido. Documento com erro
  fica visível (decisão #4) mas a única forma de "resolver" por enquanto é reenviar o
  arquivo (o hash muda de vida quando o documento é marcado erro — ver migration 018).
- **Excluir documento pela tela** — a FK `ON DELETE RESTRICT` da migration 017 já torna
  isso não-trivial (documento com item vinculado não pode ser apagado direto); fora de
  escopo por ora.

---

## Arquivos afetados

- `api/src/routes/controle.ts` — `GET /` ganha filtro/paginação (muda o shape da
  resposta); rota nova `GET /filtros`
- `api/src/routes/controle.test.ts` — testes dos novos parâmetros e da rota de filtros
- `web/app/(app)/controle/page.tsx` — novo
- `web/app/(app)/controle/hooks/use-controle-data.ts` — novo
- `web/app/(app)/controle/components/tabela-documentos.tsx` — novo
- `web/app/(app)/controle/components/filtro-coluna.tsx` — novo
- `web/app/(app)/controle/components/dialogo-importar.tsx` — novo
- `web/components/sidebar.tsx` — item de navegação novo
- `web/lib/types.ts` — tipos novos (`DocumentoControle`, `ItemDocumentoControle`,
  resposta paginada)
