# Design: Colunas redimensionáveis (arrastar a borda)

**Data:** 2026-08-17
**Status:** Aprovado pelo Matheus
**Escopo Fase 1 (este documento/plano):** só a tabela do Financeiro.
**Fase 2 (backlog, fora deste plano):** replicar pras outras 8 tabelas do sistema.

---

## Contexto

Pedido do Matheus: poder "deslizar as colunas". Esclarecido em conversa — ele quer
**redimensionar** (arrastar a borda entre duas colunas pra deixar uma mais larga e
outra mais estreita), não reordenar. Vale pra **todas as tabelas que têm tabelas**
(citação dele) — mas construído e validado primeiro numa tela só, antes de replicar.

Tabelas existentes no sistema hoje (achado por busca de
`from '@/components/ui/table'`):

1. `financeiro/page.tsx` — **esta fase**
2. `contas/lista-contas.tsx`
3. `operacoes/page.tsx`
4. `estoque/components/tabela-produtos.tsx`
5. `estoque/components/tabela-historico.tsx`
6. `nfe/page.tsx`
7. `talhoes/page.tsx`
8. `cartoes/page.tsx`
9. `custos/page.tsx`

## Decisões (resolvidas em conversa antes deste documento)

1. **Redimensionar, não reordenar.** Confirmado explicitamente — descartada a opção de
   arrastar cabeçalho pra outra posição.
2. **Largura fica salva** no navegador (`localStorage`), por tabela — não no banco.
   Reabrir a mesma tela mantém a largura que o Matheus deixou; outra tabela não herda
   a largura de outra (chave própria por tela).
3. **Todas as tabelas, em duas fases.** Fase 1 constrói o mecanismo reaproveitável e
   aplica só no Financeiro (tela que acabamos de mexer, mais fácil de validar ao vivo).
   Fase 2 (tarefa separada, não deste plano) aplica o mesmo componente nas outras 8.
4. **Abordagem: handle de arrastar feito à mão**, sem trocar a biblioteca de tabela.
   Descartado adotar TanStack Table (exigiria reescrever as 9 telas pro modelo da
   biblioteca — desproporcional) e descartado `resize` nativo de CSS (inconsistente
   entre navegadores, sem persistência).

## Desenho

### Componente novo: `web/components/ui/resizable-table-head.tsx`

Encapsula o `TableHead` existente (não substitui — as tabelas continuam usando
`Table`/`TableRow`/`TableCell` normalmente) e acrescenta:
- Uma faixa fina (`~6px`) na borda direita da célula, `cursor: col-resize`.
- `onPointerDown` na faixa inicia o arrasto; `onPointerMove` (no `document`, enquanto
  arrasta) atualiza a largura em tempo real; `onPointerUp` finaliza e persiste.
- Largura mínima de **60px** — arrastar além disso trava no mínimo, não deixa a coluna
  sumir nem invadir a coluna vizinha.
- Compatível com o `SortableTableHead` existente: quem usa cabeçalho ordenável
  (Data, Vencimento) recebe o `ResizableTableHead` por fora, com o `SortableTableHead`
  dentro — a faixa de arrastar não compete com o clique de ordenar (áreas diferentes
  da célula).

### Hook novo: `web/lib/use-column-widths.ts`

`useColumnWidths(tableId: string, colunas: {id: string, padrao: number}[])`:
- Carrega do `localStorage` (`agromouro:larguras:<tableId>`) na primeira renderização;
  colunas sem valor salvo usam `padrao`.
- Devolve `{largura(id), iniciarArrasto(id, evento)}`.
- Grava no `localStorage` só no `pointerup` (fim do arrasto) — não a cada pixel, pra
  não martelar o navegador durante o arrasto.
- Coluna nova no código (id que não existe no `localStorage` salvo) simplesmente usa o
  `padrao` — não quebra se o Matheus tiver uma largura salva de uma versão anterior da
  tela com menos colunas.

### Mudança na tabela do Financeiro

- `<Table>` ganha `style={{ tableLayout: 'fixed' }}` — necessário pra o navegador
  respeitar a largura que a gente define, em vez de recalcular pelo conteúdo. **Efeito
  colateral a conferir na implementação:** com `fixed`, o texto que hoje quebra linha
  (`whitespace-normal break-words` nas células de descrição/emitente) deve continuar
  quebrando do mesmo jeito — só a largura da coluna passa a ser controlada por nós, o
  comportamento de quebra de texto dentro dela não muda.
- Cada `TableHead`/`SortableTableHead` do cabeçalho vira `ResizableTableHead`, com uma
  largura padrão igual à que a coluna já ocupa hoje na prática (medida durante a
  implementação, não chutada).
- Coluna de checkbox (seleção em massa) e coluna de ações (editar/excluir) **não
  ganham** faixa de arrastar — são sempre estreitas, redimensionar não faz sentido ali.

### Dado / persistência

Nada no banco. Só `localStorage`, no navegador do Matheus. Se ele trocar de
computador ou limpar o navegador, as larguras voltam ao padrão — comportamento aceito
(mesma categoria de coisa que preferência de tema/zoom, não é dado de negócio).

### Erros e casos de borda

- `localStorage` indisponível ou corrompido (JSON inválido): cai pro padrão, sem
  quebrar a tela — nunca deixar um erro de leitura de preferência travar a tabela.
- Arrastar rápido demais / sair da janela do navegador durante o arrasto: o
  `pointerup`/`pointercancel` no `document` (não só na faixa) garante que o arrasto
  sempre termina, mesmo que o cursor saia da célula.
- Tabela com grupo de nota expansível (linhas de item dentro de uma nota, como a cor
  que acabamos de ajustar): como a largura é definida pela LINHA DO CABEÇALHO em
  `table-layout: fixed`, as linhas de dentro do grupo seguem a mesma largura
  automaticamente — não precisa de código extra pra elas.

## Testes

- Teste manual no navegador (Browser pane): arrastar uma coluna, confirmar que ela
  muda de tamanho, recarregar a página e confirmar que o tamanho persiste.
- Conferir que uma coluna não pode ser arrastada abaixo do mínimo (60px).
- Conferir que o clique de ordenar (Data) continua funcionando depois da mudança —
  a faixa de arrastar não pode "roubar" o clique do botão de ordenar.
- `tsc --noEmit` limpo.

## Fora de escopo (fica pra Fase 2, tarefa separada)

- Aplicar `ResizableTableHead` nas outras 8 tabelas (`contas`, `operacoes`, `estoque`
  produtos e histórico, `nfe`, `talhoes`, `cartoes`, `custos`) — mesmo componente,
  trabalho repetitivo de aplicação, não desenho novo.
- Reordenar colunas (arrastar pra trocar de posição) — não foi pedido, descartado
  explicitamente na conversa de hoje.
- Resetar largura pro padrão (botão "restaurar") — não pedido; se vier a fazer falta,
  é acréscimo pequeno depois.
