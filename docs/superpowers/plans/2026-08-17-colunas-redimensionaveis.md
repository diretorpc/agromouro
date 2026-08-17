# Colunas redimensionáveis (Financeiro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o Matheus arrastar a borda entre duas colunas da tabela do Financeiro pra mudar a largura, com a largura salva no navegador.

**Architecture:** Um hook (`useColumnWidths`) guarda a largura de cada coluna em estado do React e no `localStorage`; um componente pequeno (`ColumnResizeHandle`) fica na borda direita de cada cabeçalho de coluna e, ao ser arrastado, chama o hook. `SortableTableHead` (já compartilhado por Financeiro e Contas a Pagar) ganha dois props novos e opcionais pra aceitar isso sem quebrar quem já usa o componente sem largura dinâmica.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Tailwind CSS. Sem biblioteca nova.

## Global Constraints

- `web/` **não tem test runner** (sem vitest/jest configurado) — verificação é `npx tsc --noEmit` + teste manual no navegador (Browser pane), mesmo padrão já usado nas mudanças anteriores desta sessão neste mesmo arquivo.
- Largura mínima de qualquer coluna: **60px** (`LARGURA_MINIMA` no hook) — nenhuma tarefa deve permitir menos que isso.
- Nomes de variável/função em português, seguindo o resto de `financeiro/page.tsx` (`largura`, `iniciarArrasto`, não `width`/`startDrag`).
- Nenhuma mudança nesta fase toca `contas/lista-contas.tsx` nem qualquer outra tabela — só Financeiro. Design completo: `docs/superpowers/specs/2026-08-17-colunas-redimensionaveis-design.md`.

---

### Task 1: Hook `useColumnWidths`

**Files:**
- Create: `web/lib/use-column-widths.ts`

**Interfaces:**
- Produces: `useColumnWidths(tableId: string, colunas: {id: string, padrao: number}[]): { largura(id: string): number, iniciarArrasto(id: string, larguraAtual: number): (e: React.PointerEvent) => void }`
- Consumes: nada (só `window.localStorage`, `window.addEventListener`).

- [ ] **Step 1: Criar o arquivo com a implementação completa**

```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ColunaLargura = { id: string; padrao: number }

const LARGURA_MINIMA = 60

function chaveStorage(tableId: string) {
  return `agromouro:larguras:${tableId}`
}

function lerSalvo(tableId: string): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const bruto = window.localStorage.getItem(chaveStorage(tableId))
    if (!bruto) return {}
    const json: unknown = JSON.parse(bruto)
    if (json && typeof json === 'object') return json as Record<string, number>
    return {}
  } catch {
    return {}
  }
}

// Largura de cada coluna de uma tabela, arrastável pela borda e salva no
// navegador (localStorage, não banco — ver design 2026-08-17). `tableId`
// isola a largura salva de uma tela pra não vazar pra outra tabela.
export function useColumnWidths(tableId: string, colunas: ColunaLargura[]) {
  const padraoPorId = useRef(new Map(colunas.map(c => [c.id, c.padrao])))

  const [larguras, setLarguras] = useState<Record<string, number>>(() => {
    const salvo = lerSalvo(tableId)
    const inicial: Record<string, number> = {}
    for (const c of colunas) inicial[c.id] = salvo[c.id] ?? c.padrao
    return inicial
  })

  const arrastoRef = useRef<{ id: string; xInicial: number; larguraInicial: number } | null>(null)

  useEffect(() => {
    function mover(e: PointerEvent) {
      const a = arrastoRef.current
      if (!a) return
      const delta = e.clientX - a.xInicial
      const nova = Math.max(LARGURA_MINIMA, a.larguraInicial + delta)
      setLarguras(prev => (prev[a.id] === nova ? prev : { ...prev, [a.id]: nova }))
    }
    function soltar() {
      if (!arrastoRef.current) return
      arrastoRef.current = null
      setLarguras(prev => {
        try {
          window.localStorage.setItem(chaveStorage(tableId), JSON.stringify(prev))
        } catch {
          // localStorage indisponível (modo privado, cota cheia) — a largura só
          // não persiste; a tabela continua funcionando normalmente na sessão.
        }
        return prev
      })
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
    }
  }, [tableId])

  const iniciarArrasto = useCallback((id: string, larguraAtual: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    arrastoRef.current = { id, xInicial: e.clientX, larguraInicial: larguraAtual }
  }, [])

  const largura = useCallback(
    (id: string) => larguras[id] ?? padraoPorId.current.get(id) ?? LARGURA_MINIMA,
    [larguras]
  )

  return { largura, iniciarArrasto }
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro relacionado a `use-column-widths.ts` (o projeto pode já ter outros avisos pré-existentes — só confirme que nenhum novo aparece deste arquivo).

- [ ] **Step 3: Commit**

```bash
git add web/lib/use-column-widths.ts
git commit -m "feat(financeiro): hook de largura de coluna arrastável, salva no navegador"
```

---

### Task 2: Componente `ColumnResizeHandle`

**Files:**
- Create: `web/components/ui/column-resize-handle.tsx`

**Interfaces:**
- Consumes: nada do Task 1 diretamente — recebe `onPointerDown` já pronto de quem o usa.
- Produces: `<ColumnResizeHandle onPointerDown={(e: React.PointerEvent) => void} />`

- [ ] **Step 1: Criar o componente**

```tsx
'use client'

type Props = {
  onPointerDown: (e: React.PointerEvent) => void
}

// Faixa fina na borda direita de um cabeçalho de coluna — arrastar muda a
// largura (ver web/lib/use-column-widths.ts). Fica sobreposta por cima do
// canto da célula (position: absolute), não disputa clique com o texto nem
// com o botão de ordenar do SortableTableHead porque ocupa só os últimos
// 6px da borda direita.
export function ColumnResizeHandle({ onPointerDown }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Arrastar para redimensionar a coluna"
      onPointerDown={onPointerDown}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40 active:bg-primary/60"
    />
  )
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro novo relacionado a `column-resize-handle.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/components/ui/column-resize-handle.tsx
git commit -m "feat(financeiro): componente da faixa de arrastar coluna"
```

---

### Task 3: `SortableTableHead` aceita largura dinâmica e a faixa de arrastar

**Files:**
- Modify: `web/components/ui/sortable-table-head.tsx` (arquivo inteiro tem 39 linhas — reescrever)

**Interfaces:**
- Consumes: `ColumnResizeHandle` do Task 2 (só como `React.ReactNode` recebido via prop — este arquivo não importa `ColumnResizeHandle` diretamente, quem usa `SortableTableHead` que decide passar ou não).
- Produces: `<SortableTableHead ativo style resizeHandle .../>` — `style` e `resizeHandle` são **opcionais**, então os 12 usos existentes (Financeiro colunas não tocadas nesta fase + Contas a Pagar) continuam compilando sem mudança nenhuma.

- [ ] **Step 1: Reescrever o arquivo**

```tsx
'use client'

import { ArrowUp, ArrowDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type Props = {
  ativo: boolean
  direcao: 'asc' | 'desc'
  onClick: () => void
  className?: string
  style?: React.CSSProperties
  numeric?: boolean
  children: React.ReactNode
  resizeHandle?: React.ReactNode
}

// Cabeçalho de tabela clicável, com seta indicando a coluna ativa e a direção
// da ordenação. Usado em Financeiro e Contas a Pagar — mesmo padrão visual
// que a coluna "Data" do Financeiro já tinha antes desta mudança existir em
// mais de um lugar (12 usos ao todo, por isso virou componente compartilhado
// em vez de repetir o botão em cada arquivo).
//
// `resizeHandle` é opcional e renderiza FORA do <button> (irmão dele, dentro
// do <th>) — nunca dentro, porque um <div> arrastável dentro de um <button>
// disputaria o clique de ordenar com o gesto de arrastar. `relative` no <th>
// é o que permite o handle (que usa `absolute`) se posicionar na borda.
export function SortableTableHead({ ativo, direcao, onClick, className, style, numeric, children, resizeHandle }: Props) {
  return (
    <TableHead className={cn('relative', className)} style={style}>
      <button
        onClick={onClick}
        className={`flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors${numeric ? ' justify-end w-full' : ''}`}
        aria-label={
          ativo
            ? `Ordenado por esta coluna, ${direcao === 'asc' ? 'crescente' : 'decrescente'}. Clique para inverter`
            : 'Clique para ordenar por esta coluna'
        }
      >
        {children}
        {ativo && (direcao === 'asc'
          ? <ArrowUp className="h-3 w-3" aria-hidden="true" />
          : <ArrowDown className="h-3 w-3" aria-hidden="true" />)}
      </button>
      {resizeHandle}
    </TableHead>
  )
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro novo — os usos existentes em `financeiro/page.tsx` e `contas/lista-contas.tsx` não passam `style`/`resizeHandle`, e como os dois props são opcionais isso continua válido.

- [ ] **Step 3: Commit**

```bash
git add web/components/ui/sortable-table-head.tsx
git commit -m "feat(financeiro): SortableTableHead aceita largura dinâmica e faixa de arrastar"
```

---

### Task 4: Ligar tudo na tabela do Financeiro

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx:17-30` (imports), `:262` (constantes de módulo, perto de `MES_PADRAO`), `:282` (dentro do componente, perto de `useFazenda()`), `:948-958` (linha do cabeçalho)

**Interfaces:**
- Consumes: `useColumnWidths` (Task 1), `ColumnResizeHandle` (Task 2), `SortableTableHead` com `style`/`resizeHandle` (Task 3).
- Produces: nada — é o ponto final de uso.

- [ ] **Step 1: Importar o hook e o componente novo**

Em `web/app/(app)/financeiro/page.tsx`, no bloco de imports (perto da linha 30, junto do import de `SortableTableHead`):

```tsx
import { useColumnWidths } from '@/lib/use-column-widths'
import { ColumnResizeHandle } from '@/components/ui/column-resize-handle'
```

- [ ] **Step 2: Declarar as colunas redimensionáveis como constante de módulo**

Perto da linha 262, onde já existe `const MES_PADRAO = ...` (fora do componente `FinanceiroPage`, no nível do módulo):

```ts
// Larguras de partida das colunas redimensionáveis — os mesmos valores que já
// existiam fixos em `w-[Npx]` antes desta mudança (Task 4 do plano de
// 2026-08-17). Coluna de ações e de checkbox não entram aqui: não são
// redimensionáveis (ver design).
const COLUNAS_FINANCEIRO = [
  { id: 'origem', padrao: 180 },
  { id: 'descricao', padrao: 220 },
  { id: 'quantidade', padrao: 70 },
  { id: 'valor_unitario', padrao: 110 },
  { id: 'valor_total', padrao: 120 },
  { id: 'centro_custo', padrao: 140 },
  { id: 'data_emissao', padrao: 90 },
]
```

- [ ] **Step 3: Chamar o hook dentro do componente**

Dentro de `FinanceiroPage`, logo abaixo de `const { fazendaAtiva } = useFazenda()` (perto da linha 282):

```ts
const { largura, iniciarArrasto } = useColumnWidths('financeiro', COLUNAS_FINANCEIRO)
```

- [ ] **Step 4: Trocar a linha do cabeçalho da tabela**

Substituir o bloco de `<Table className="border-collapse ...">` até o fim do `<TableHeader>` (linhas 948-977 antes desta mudança) por:

```tsx
          <Table className="border-collapse w-auto [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border" style={{ tableLayout: 'fixed' }}>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  style={{ width: largura('origem') }}
                  ativo={sortColuna === 'origem'} direcao={sortDirecao} onClick={() => handleSort('origem')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('origem', largura('origem'))} />}
                >Origem</SortableTableHead>
                <SortableTableHead
                  style={{ width: largura('descricao') }}
                  ativo={sortColuna === 'descricao'} direcao={sortDirecao} onClick={() => handleSort('descricao')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('descricao', largura('descricao'))} />}
                >Produto / Serviço</SortableTableHead>
                <SortableTableHead
                  className="text-right" style={{ width: largura('quantidade') }} numeric
                  ativo={sortColuna === 'quantidade'} direcao={sortDirecao} onClick={() => handleSort('quantidade')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('quantidade', largura('quantidade'))} />}
                >Qtd.</SortableTableHead>
                <SortableTableHead
                  className="text-right" style={{ width: largura('valor_unitario') }} numeric
                  ativo={sortColuna === 'valor_unitario'} direcao={sortDirecao} onClick={() => handleSort('valor_unitario')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('valor_unitario', largura('valor_unitario'))} />}
                >Valor Unit.</SortableTableHead>
                <SortableTableHead
                  className="text-right" style={{ width: largura('valor_total') }} numeric
                  ativo={sortColuna === 'valor_total'} direcao={sortDirecao} onClick={() => handleSort('valor_total')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('valor_total', largura('valor_total'))} />}
                >Valor Total</SortableTableHead>
                <SortableTableHead
                  style={{ width: largura('centro_custo') }}
                  ativo={sortColuna === 'centro_custo'} direcao={sortDirecao} onClick={() => handleSort('centro_custo')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('centro_custo', largura('centro_custo'))} />}
                >Centro de Custo</SortableTableHead>
                <SortableTableHead
                  style={{ width: largura('data_emissao') }}
                  ativo={sortColuna === 'data_emissao'} direcao={sortDirecao} onClick={() => handleSort('data_emissao')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('data_emissao', largura('data_emissao'))} />}
                >Data</SortableTableHead>
                <TableHead className="w-[72px]" />
                <TableHead className="w-[36px]">
                  <input
                    type="checkbox"
                    aria-label={todosVisiveisSelecionados ? 'Desmarcar todos os itens visíveis' : 'Marcar todos os itens visíveis'}
                    className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    checked={todosVisiveisSelecionados}
                    disabled={idsSelecionaveisVisiveis.length === 0}
                    onChange={() => setSelecionados(prev => {
                      if (todosVisiveisSelecionados) {
                        const novo = new Set(prev)
                        idsSelecionaveisVisiveis.forEach(id => novo.delete(id))
                        return novo
                      }
                      return new Set([...prev, ...idsSelecionaveisVisiveis])
                    })}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
```

Note técnica sobre `w-auto` na classe do `<Table>`: o componente base (`web/components/ui/table.tsx`) já aplica `w-full` por padrão. Sem cancelar isso, `table-layout: fixed` + `width: 100%` faz o navegador **esticar** as colunas proporcionalmente pra preencher o espaço todo, e a largura arrastada deixaria de valer exatamente o que foi arrastado. `w-auto` (via `cn`/tailwind-merge, que já é usado no componente base) cancela o `w-full`, deixando a tabela com a largura exata da soma das colunas — o `overflow-x-auto` que já existe no `Table` (contêiner por fora) cuida de rolar horizontalmente se a soma ficar maior que o cartão.

- [ ] **Step 5: Checar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 6: Testar no navegador (manual, Browser pane)**

Com o servidor dev já rodando (`npm run dev` em `web/`, porta 3000):
1. Abrir `http://localhost:3000/financeiro`.
2. Passar o mouse na borda direita do cabeçalho "Origem" — o cursor deve virar `col-resize` e aparecer uma faixa azul fina ao passar por cima.
3. Arrastar essa borda pra direita — a coluna "Origem" deve alargar em tempo real, sem esticar as outras colunas de forma estranha.
4. Arrastar bem pra esquerda, além do razoável — a coluna não deve encolher além de 60px nem sumir.
5. Clicar no texto "Data" (fora da faixa de 6px da borda) — deve continuar ordenando a coluna normalmente (confirma que o handle não roubou o clique do botão de ordenar).
6. Recarregar a página (F5) — a largura que você arrastou no passo 3 deve continuar a mesma (confirma que salvou no `localStorage`).
7. Abrir uma nota agrupada (linha "N itens desta nota") e conferir que as linhas de item por dentro têm a mesma largura de coluna que o resto da tabela (confirma que `table-layout: fixed` aplicou uniformemente).

- [ ] **Step 7: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): liga colunas redimensionáveis na tabela de lançamentos"
```

---

## Self-Review (preenchido ao escrever o plano)

- **Cobertura do spec:** hook (Task 1), componente visual (Task 2), integração com `SortableTableHead` sem quebrar Contas a Pagar (Task 3), aplicação no Financeiro + verificação manual (Task 4) — as 4 seções do desenho (componente, hook, mudança na tabela, testes) têm tarefa correspondente.
- **Placeholder scan:** nenhum "TBD"/"implementar depois" — todo passo tem código completo.
- **Consistência de tipos:** `largura(id: string): number` e `iniciarArrasto(id: string, larguraAtual: number)` usados do mesmo jeito nas Tasks 1 e 4; `resizeHandle?: React.ReactNode` e `style?: React.CSSProperties` definidos na Task 3 e consumidos exatamente assim na Task 4.
- **Risco identificado durante o planejamento** (não estava no design original): `table-layout: fixed` + `w-full` do componente base faria a tabela esticar as colunas além do que foi arrastado — resolvido com `w-auto` na Task 4, documentado inline no passo.
