# Reorganização da tela de Estoque — Design

## Contexto

`web/app/(app)/estoque/page.tsx` é um único componente client-side com ~1016
linhas que mistura, sem separação estrutural nem visual:

- 4 KPIs (Valor em Estoque, Insumos Cadastrados, Críticos, Negativos)
- Tabela "Insumos" (produtos atuais) com busca + filtro tipo + filtro situação,
  em versão desktop (tabela) e mobile (cards)
- Tabela "Histórico de Movimentações" (últimas 100, sem nenhum filtro)
- 6 dialogs de ação: Novo Insumo, Ajustar Estoque, Converter Unidade, Editar
  Movimentação, Excluir Movimentação, Excluir Insumo
- ~15 `useState` e todas as funções de CRUD inline no mesmo arquivo

O usuário (agricultor, leigo em tecnologia) reportou a tela como "muito
confusa" e pediu simplificação. Levantamento com o usuário identificou três
causas: informação demais na mesma tela, as duas tabelas se misturando sem
separação clara, e falta de uma ordenação por "o que entrou mais recentemente
no estoque".

Nenhuma outra tela do projeto importa algo de `estoque/page.tsx` — a
reorganização é isolada, sem risco de quebrar outras rotas.

## Objetivo

Reorganizar a tela para reduzir a carga cognitiva do usuário final, sem
remover nenhuma funcionalidade existente, e preparar o código para mudanças
futuras mais rápidas e seguras.

## Decisões validadas com o usuário

1. Separar as duas tabelas em **abas na mesma página** ("Produtos" e
   "Histórico"), não em páginas/rotas separadas.
2. A aba "Produtos" deve poder ordenar por "mais recente no estoque primeiro".
3. Reduzir a poluição visual, incluindo o filtro por origem adicional na aba
   Histórico e o menu "mais opções" escondendo ações raras/perigosas
   (aprovado no escopo recomendado, não apenas o pedido original).

## 1. Estrutura de abas

**Aba "Produtos"** (default, abre primeiro)
- Mantém os 4 KPIs no topo
- Mantém busca + filtro tipo + filtro situação
- Adiciona controle de ordenação: "Mais recentes" (default) vs "Nome (A-Z)"
- Mantém a dualidade tabela desktop / cards mobile já existente

**Aba "Histórico"**
- Sem os 4 KPIs (eles descrevem "quanto eu tenho agora", tema da aba
  Produtos, não "o que aconteceu")
- Adiciona busca por nome do produto + filtro por origem (NF-e / Operação /
  WhatsApp / Manual / Correção) — hoje essa tabela não tem nenhum filtro

O projeto ainda não tem um componente de abas em `web/components/ui/` (só
existem `action-menu`, `badge`, `button`, `card`, `dialog`, `empty-state`,
`input`, `kpi-card`, `label`, `select`, `separator`, `skeleton`, `table`,
`textarea`, `tooltip`). Será adicionado `web/components/ui/tabs.tsx` seguindo
o mesmo padrão dos componentes existentes (acessível via teclado, estilizado
com as classes Tailwind já usadas no projeto — não depende de instalar uma
lib nova). Estado da aba ativa sincroniza com a URL (`?tab=produtos|
historico`) do mesmo jeito que busca/tipo/status já sincronizam hoje, para
permitir voltar/compartilhar link direto para uma aba.

## 2. Ordenação por data de entrada no estoque

**Problema:** a tabela `estoque` não tem uma coluna que registre quando o
produto entrou pela primeira vez — só existe `updated_at`, que muda a cada
ajuste. A tabela `movimentacoes_estoque` tem `created_at`, mas cruzar as duas
tabelas a cada carregamento de página é caro e desnecessário, já que a linha
em `estoque` é criada uma única vez (na primeira entrada do produto) e nunca
recriada depois — confirmado no padrão de código de `nfeProcessor.ts` e do
cadastro manual em `page.tsx`.

**Solução:** nova migration (`supabase/migrations/`, próximo número
sequencial) adicionando `created_at timestamptz not null default now()` em
`estoque`, com backfill de uma vez só para as linhas já existentes:

```sql
update estoque e
set created_at = coalesce(
  (select min(m.created_at) from movimentacoes_estoque m
   where m.insumo_id = e.insumo_id and m.tipo = 'entrada'),
  e.created_at  -- produtos sem nenhuma entrada registrada: mantém o default (now())
)
```

Produtos sem nenhuma movimentação de entrada (raro — só existem por ajuste
manual direto na tabela) ficam com a data do backfill (hoje) e aparecem no
fim da lista ordenada por "mais recente primeiro", sem erro nem necessidade
de tratamento especial na UI.

Ordenação padrão da aba "Produtos" passa a ser `estoque.created_at desc`.

**RLS:** a política de `estoque` já é `FOR ALL` (cobre select/insert/update/
delete) — adicionar coluna não deve quebrar isso, mas será conferido depois
de aplicar a migration (ver [[rls-escrita-silenciosa]] na memória do
projeto — update sem erro visível, mas sem efeito, já aconteceu aqui antes).

## 3. Ações: um botão visível, resto atrás de "mais opções"

Hoje cada linha pode ter até 3 botões/ícones lado a lado, incluindo Excluir
(irreversível) colado nos demais.

**Proposta:**
- Cada linha mostra 1 botão de texto com a ação mais comum: "Ajustar" na aba
  Produtos, "Editar" na aba Histórico
- Ações menos frequentes e a exclusão ficam atrás de um botão "⋯" reutilizando
  o componente já existente `web/components/ui/action-menu.tsx`
  (`ActionMenu`, com suporte a item `destructive` para o Excluir): Converter
  Unidade e Excluir Insumo na aba Produtos; Excluir na aba Histórico
- Excluir passa a exigir 2 cliques (abrir o menu, depois clicar em Excluir)
  em vez de 1, reduzindo risco de clique acidental num dado que não tem
  volta

Nenhuma lógica de negócio muda — é só reposicionamento visual dos botões
existentes.

## 4. Decomposição de arquivos

```
web/app/(app)/estoque/
├── page.tsx                     → orquestra abas + monta os hooks
├── hooks/
│   ├── use-estoque-data.ts      → loadData + as 6 operações de CRUD, incluindo
│   │                               ajustarSaldoEstoque() centralizando o recálculo
│   │                               de saldo hoje duplicado em handleEditMov,
│   │                               handleDeleteMov e handleCorrecaoUnidade
│   └── use-filtros-produtos.ts  → busca/tipo/situação/ordenação + sync com URL
├── components/
│   ├── kpis-estoque.tsx
│   ├── tabela-produtos.tsx      → decide internamente tabela desktop vs cards
│   │                               mobile (mantém a duplicação visual atual —
│   │                               são duas renderizações por design responsivo,
│   │                               separar mais viraria complexidade desnecessária)
│   ├── tabela-historico.tsx
│   └── dialogs/
│       ├── novo-insumo-dialog.tsx
│       ├── ajustar-estoque-dialog.tsx
│       ├── converter-unidade-dialog.tsx
│       ├── editar-movimentacao-dialog.tsx
│       ├── excluir-movimentacao-dialog.tsx
│       └── excluir-insumo-dialog.tsx
```

Cada dialog recebe via props só o item selecionado + callback de
fechar/recarregar — evita passar objetos inteiros para componentes que usam
só 2-3 campos. `use-estoque-data` expõe um único `recarregar()` chamado por
qualquer dialog após salvar.

Nenhuma mudança visível ao usuário resulta desta seção — é puramente
organização interna para reduzir risco de regressão em edições futuras.

## Fluxo de dados

1. `page.tsx` monta `use-estoque-data()` (busca insumos + movimentações) e
   `use-filtros-produtos()` (estado de busca/tipo/situação/ordenação, com
   leitura/escrita na URL)
2. `tabela-produtos` e `tabela-historico` recebem dados já filtrados/
   ordenados via props — não fazem fetch próprio
3. Qualquer dialog, ao salvar, chama `recarregar()` do hook de dados — mesmo
   padrão de recarga total que já existe hoje (`loadData()`), sem introduzir
   cache ou estado otimista novo

## Erros

Mantém o padrão já existente: mensagens de erro inline nos dialogs
(`deleteMovErro`, `deleteInsumoErro`), sem mudança de comportamento.

## Testes

- Testar a query/migration de backfill de `created_at` em ambiente de
  desenvolvimento antes de aplicar em produção — conferir que produtos
  antigos ficam com data plausível (não todos "hoje")
- Conferir manualmente após a migration que INSERT/UPDATE em `estoque`
  continuam funcionando (checagem de RLS mencionada na seção 2)
- Teste ponta a ponta (Playwright ou manual) cobrindo: alternar entre abas,
  ordenar por mais recente, abrir menu "⋯" e excluir um item, filtro de
  origem na aba Histórico

## Fora de escopo

- Paginação do histórico de movimentações (continua limitado a 100 linhas)
- Qualquer mudança na lógica de negócio de cálculo de saldo, preço médio ou
  conversão de unidade — só reorganização de onde/como essas funções vivem
- Alterações no schema além da coluna `created_at` em `estoque`
