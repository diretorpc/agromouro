# Reorganização Financeiro + Contas a Pagar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar as telas Financeiro e Contas a Pagar (separar resumo de detalhe, limitar o que aparece por padrão, reduzir número de filtros visíveis) sem tocar na automação por baixo (NF-e, WhatsApp, banco de dados).

**Architecture:** Mudanças isoladas de estado local (`useState`) e apresentação (JSX) em dois componentes client-side já existentes. Nenhum componente novo, nenhuma rota nova, nenhuma migration.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Tailwind, componentes shadcn/ui já existentes em `web/components/ui/` (`select`, `separator`, `button`, `card`, `table`).

Spec completo: `docs/superpowers/specs/2026-08-10-reorganizacao-financeiro-contas-design.md`

## Global Constraints

- **`web/` não tem nenhum teste automatizado** (confirmado pela revisão do Apolo em 10/08/2026 — zero arquivos `*.test.tsx`, nenhum test runner instalado). Este plano usa `npx tsc --noEmit` (dentro da pasta `web`) como rede automática de cada task, e um passo de verificação manual no navegador no lugar de teste automatizado. **Não é escopo deste projeto instalar um test runner novo.**
- Servidor local: `npm run dev --prefix web` (porta 3000) — ou usar o preview já configurado em `.claude/launch.json` (`name: "web"`).
- Branch de trabalho: `fix/telasfin` (já criada e ativa). Commitar ao final de cada task nessa branch — autorizado pelo Matheus em 10/08/2026.
- Não alterar nada em `api/`, banco de dados (Supabase), ou os webhooks de NF-e/WhatsApp.
- `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue` já existem em `@/components/ui/select` (padrão de uso: ver `financeiro/page.tsx` linhas 27, 713-730). `Separator` já existe em `@/components/ui/separator`. **Não criar componente novo** para nenhuma das duas correções de filtro em menu.
- Os números de linha citados em cada task refletem o arquivo **antes** daquela task. Tasks no mesmo arquivo são sequenciais — ao aplicar uma task depois da primeira do mesmo arquivo, localize o trecho pelo código citado, não confie cegamente no número.
- As tasks 1-5 (`financeiro/page.tsx`) e as tasks 6-10 (`contas/page.tsx` + `lista-contas.tsx`) são independentes entre si — podem ser feitas em qualquer ordem relativa, ou em paralelo por dois subagents diferentes, desde que a ordem *dentro* de cada grupo seja respeitada.

---

## Task 1: Financeiro abre no mês atual por padrão

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx:261` (estado inicial de `filtroMes`)
- Modify: `web/app/(app)/financeiro/page.tsx:769-774` (mensagem de lista vazia)

**Interfaces:**
- Consumes: nada de outra task
- Produces: nada que outra task consuma

- [ ] **Step 1: Trocar o valor inicial de `filtroMes`**

Em `web/app/(app)/financeiro/page.tsx`, localize:

```tsx
const [filtroMes, setFiltroMes] = useState('todos')
```

Troque para:

```tsx
const [filtroMes, setFiltroMes] = useState(() => new Date().toISOString().slice(0, 7))
```

- [ ] **Step 2: Checar tipos**

Run: `npx tsc --noEmit` (dentro de `web/`)
Expected: sem erro.

- [ ] **Step 3: Verificar no navegador**

Com o servidor local rodando, abra `/financeiro`. A tela deve abrir já mostrando só os lançamentos do mês corrente (o seletor de mês, no filtro da lista, mostra o mês atual selecionado, não "Todos os meses"). Escolha "Todos os meses" no seletor e confirme que volta a mostrar o histórico completo.

- [ ] **Step 4: Mensagem de lista vazia com atalho**

Localize:

```tsx
{itensFiltrados.length === 0 ? (
  <TableRow>
    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
      Nenhum lançamento encontrado.
    </TableCell>
  </TableRow>
) : itensFiltrados.map(item => (
```

Troque para:

```tsx
{itensFiltrados.length === 0 ? (
  <TableRow>
    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
      <p>Nenhum lançamento encontrado{filtroMes !== 'todos' ? ' neste mês' : ''}.</p>
      {filtroMes !== 'todos' && (
        <Button
          variant="link"
          size="sm"
          className="mt-1"
          onClick={() => { setFiltroMes('todos'); setUrlParam('mes', 'todos') }}
        >
          Ver todos os meses
        </Button>
      )}
    </TableCell>
  </TableRow>
) : itensFiltrados.map(item => (
```

- [ ] **Step 5: Verificar no navegador**

No seletor de mês, escolha um mês sem nenhum lançamento (ex: um mês futuro). A tabela deve mostrar "Nenhum lançamento encontrado neste mês." com um botão "Ver todos os meses" — clique nele e confirme que volta pra "Todos os meses" com a lista completa.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): abre no mes atual por padrao, com atalho para ver tudo"
```

---

## Task 2: Financeiro — gráfico limitado a 5 categorias

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx` (novo estado perto de `filtroOrigem`; `chartData`/`ResponsiveContainer`/`BarChart` dentro do Card do gráfico, linhas ~607-675)

**Interfaces:**
- Consumes: nada
- Produces: nada

- [ ] **Step 1: Novo estado**

Perto de `const [sortData, setSortData] = useState<'desc' | 'asc'>('desc')` (linha ~263), adicione:

```tsx
const [verTodasCategorias, setVerTodasCategorias] = useState(false)
```

- [ ] **Step 2: Fatiar `chartData` para exibição**

Logo depois de onde `chartData` é calculado (linha ~531-533):

```tsx
const chartData = Object.entries(porCategoria)
  .map(([key, value]) => ({ key, label: tipoLabel(key), value }))
  .sort((a, b) => b.value - a.value)
```

Adicione, na linha seguinte:

```tsx
const chartDataExibido = verTodasCategorias ? chartData : chartData.slice(0, 5)
```

- [ ] **Step 3: Usar `chartDataExibido` no gráfico**

Dentro do Card do gráfico, troque as duas referências a `chartData` que alimentam o desenho (mantendo as referências a `chartData.length`/`totalGeral` que servem pra cálculo de porcentagem e pro texto do botão):

```tsx
<ResponsiveContainer width="100%" height={chartData.length * 52 + 16}>
  <BarChart
    data={chartData}
```

Troque para:

```tsx
<ResponsiveContainer width="100%" height={chartDataExibido.length * 52 + 16}>
  <BarChart
    data={chartDataExibido}
```

E troque a linha `{chartData.map(entry => (` (dentro do `<Bar>`, usada para colorir cada barra) para `{chartDataExibido.map(entry => (`.

- [ ] **Step 4: Botão "ver todas" abaixo do gráfico**

Logo depois do `</ResponsiveContainer>` (ainda dentro da `<div style={{ minWidth: 360 }}>`), adicione:

```tsx
{chartData.length > 5 && (
  <div className="text-center mt-2">
    <Button
      variant="link"
      size="sm"
      onClick={() => setVerTodasCategorias(v => !v)}
    >
      {verTodasCategorias ? 'Ver só as 5 maiores' : `Ver todas as ${chartData.length} categorias`}
    </Button>
  </div>
)}
```

- [ ] **Step 5: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 6: Verificar no navegador**

Escolha "Todos os meses" (pra garantir mais de 5 categorias com gasto). O gráfico deve mostrar só 5 barras, com o botão "Ver todas as N categorias" abaixo. Clique — deve expandir pra todas e o botão virar "Ver só as 5 maiores". Clique de novo — deve voltar a 5.

- [ ] **Step 7: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): grafico de categorias mostra so as 5 maiores por padrao"
```

---

## Task 3: Financeiro — lista paginada (20 por vez)

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx` (novo estado + efeito; tabela de lançamentos, linhas ~743-889)

**Interfaces:**
- Consumes: `itensFiltrados` (já existe, linha ~505-516)
- Produces: nada

- [ ] **Step 1: Novo estado + reset ao trocar filtro**

Perto do estado adicionado na Task 2, adicione:

```tsx
const [visivelCount, setVisivelCount] = useState(20)
```

Depois do `useEffect` que lê `?mes=`/`?centro=`/`?origem=` da URL (linha ~350-358), adicione um novo `useEffect`:

```tsx
useEffect(() => { setVisivelCount(20) }, [filtroMes, filtroCentro, filtroOrigem])
```

- [ ] **Step 2: Fatiar para exibição**

Logo depois de `itensQueContam` (linha ~522), adicione:

```tsx
const itensExibidos = itensFiltrados.slice(0, visivelCount)
```

**Importante:** `itensQueContam`, `totalGeral`, `porCategoria` e o rodapé "Total (N itens)" continuam usando `itensFiltrados`/`itensQueContam` completos — não mude essas linhas. Só a renderização das linhas da tabela usa a fatia.

- [ ] **Step 3: Trocar o `.map` da tabela**

Localize `) : itensFiltrados.map(item => (` (dentro do `<TableBody>`) e troque por `) : itensExibidos.map(item => (`. O check `itensFiltrados.length === 0` na linha acima **não muda** (continua testando o total filtrado, não a fatia visível).

- [ ] **Step 4: Botão "Carregar mais"**

Depois de `</Table>` (ainda dentro do `<CardContent className="p-0">` do Card de Lançamentos), adicione:

```tsx
{itensFiltrados.length > visivelCount && (
  <div className="text-center py-3 border-t">
    <Button
      variant="outline"
      size="sm"
      onClick={() => setVisivelCount(c => c + 20)}
    >
      Carregar mais {Math.min(20, itensFiltrados.length - visivelCount)}
    </Button>
  </div>
)}
```

- [ ] **Step 5: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 6: Verificar no navegador**

Com "Todos os meses" selecionado (pra ter mais de 20 itens), confirme que só 20 linhas aparecem, com "Carregar mais N" no rodapé. Clique — mais linhas aparecem, o número de "Total" no rodapé da tabela **não muda**. Troque de mês (ou categoria) — a lista deve voltar a mostrar só 20.

- [ ] **Step 7: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): lista de lancamentos paginada, 20 por vez"
```

---

## Task 4: Financeiro — filtro de origem em menu único

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx:689-709` (bloco de 5 botões de origem)

**Interfaces:**
- Consumes: `filtroOrigem`, `setFiltroOrigem`, `setUrlParam` (já existem)
- Produces: nada

- [ ] **Step 1: Trocar os botões pelo Select**

Localize:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <div className="flex items-center rounded-md border border-input overflow-hidden text-xs">
    {(['todos', 'nfe', 'cartao', 'manual', 'conta'] as const).map((o, i) => (
      <button
        key={o}
        onClick={() => { setFiltroOrigem(o); setUrlParam('origem', o) }}
        className={[
          'px-3 py-1.5 font-medium transition-colors',
          i > 0 ? 'border-l border-input' : '',
          filtroOrigem === o
            ? 'bg-foreground text-background'
            : 'bg-background text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        {/* Rótulo curto de propósito: são 5 botões numa fila só, e
            "Conta paga" estouraria a largura do cartão no celular.
            O crachá da coluna Origem traz o nome completo. */}
        {{ todos: 'Todos', nfe: 'NF-e', cartao: 'Cartão', manual: 'Manual', conta: 'Conta' }[o]}
      </button>
    ))}
  </div>
</div>
```

Troque por:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <Select
    value={filtroOrigem}
    onValueChange={v => {
      const val = (v ?? 'todos') as typeof filtroOrigem
      setFiltroOrigem(val)
      setUrlParam('origem', val)
    }}
  >
    <SelectTrigger className="w-40 h-9 text-sm">
      <SelectValue>
        {{ todos: 'Todos', nfe: 'NF-e', cartao: 'Cartão', manual: 'Manual', conta: 'Conta paga' }[filtroOrigem]}
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="todos">Todos</SelectItem>
      <SelectItem value="nfe">NF-e</SelectItem>
      <SelectItem value="cartao">Cartão</SelectItem>
      <SelectItem value="manual">Manual</SelectItem>
      <SelectItem value="conta">Conta paga</SelectItem>
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 2: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Verificar no navegador**

O menu deve filtrar a lista de lançamentos exatamente como os 5 botões faziam antes (teste cada opção: Todos, NF-e, Cartão, Manual, Conta paga). O crachá de origem em cada linha da tabela não muda.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): filtro de origem vira menu unico, tira uma fileira de botao"
```

---

## Task 5: Financeiro — separar resumo de detalhe

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx` (import + estrutura do JSX principal, linhas ~1, ~560-677)

**Interfaces:**
- Consumes: nada
- Produces: nada

- [ ] **Step 1: Importar `Separator`**

No topo do arquivo, junto dos outros imports de `@/components/ui/*`:

```tsx
import { Separator } from '@/components/ui/separator'
```

- [ ] **Step 2: Envolver KPIs + gráfico num bloco "Resumo do mês"**

Localize o trecho (a partir de onde termina o cabeçalho da página e começa a grade de KPIs):

```tsx
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          ...Total de Despesas...
        </Card>
        <Card>
          ...Maior Gasto...
        </Card>
        <Card>
          ...Categorias com Gasto...
        </Card>
      </div>

      {chartData.length > 0 && (
        <Card>
          ...gráfico...
        </Card>
      )}

      <Card>
        ...Lançamentos por Item...
      </Card>
```

Troque por (só a estrutura de envolvimento muda — o conteúdo interno de cada `Card` continua idêntico):

```tsx
      <div className="space-y-4">
        <p className="text-sm font-semibold text-muted-foreground">Resumo do mês</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            ...Total de Despesas...
          </Card>
          <Card>
            ...Maior Gasto...
          </Card>
          <Card>
            ...Categorias com Gasto...
          </Card>
        </div>

        {chartData.length > 0 && (
          <Card>
            ...gráfico...
          </Card>
        )}
      </div>

      <Separator />

      <Card>
        ...Lançamentos por Item...
      </Card>
```

- [ ] **Step 3: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificar no navegador**

A tela deve mostrar um rótulo pequeno "Resumo do mês" acima dos 3 números e do gráfico, uma linha divisória, e só depois o bloco de Lançamentos. Nada de funcionalidade muda — é só o espaçamento e a divisória.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): separa visualmente resumo do mes da lista de lancamentos"
```

---

## Task 6: Contas a Pagar — separar resumo de detalhe

**Files:**
- Modify: `web/app/(app)/contas/page.tsx` (import + estrutura do JSX principal, linhas ~1, ~312-360)

**Interfaces:**
- Consumes: nada
- Produces: nada

- [ ] **Step 1: Importar `Separator`**

Junto dos outros imports de `@/components/ui/*` em `web/app/(app)/contas/page.tsx`:

```tsx
import { Separator } from '@/components/ui/separator'
```

- [ ] **Step 2: Envolver os 3 KPIs num bloco "Resumo"**

Localize:

```tsx
      {/* ── KPIs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          ...Vence esta semana...
        </Card>
        <Card>
          ...Atrasado...
        </Card>
        <Card>
          ...Aguardando...
        </Card>
      </div>

      {/* ── Lista ── */}
      <Card>
```

Troque por:

```tsx
      {/* ── KPIs ── */}
      <div className="space-y-4">
        <p className="text-sm font-semibold text-muted-foreground">Resumo</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            ...Vence esta semana...
          </Card>
          <Card>
            ...Atrasado...
          </Card>
          <Card>
            ...Aguardando...
          </Card>
        </div>
      </div>

      <Separator />

      {/* ── Lista ── */}
      <Card>
```

(Não esqueça de fechar a nova `</div>` extra que envolve os 3 `Card` — a `</div>` que já existia fechando o `grid` continua lá, só ganha uma `</div>` a mais por fora dela.)

- [ ] **Step 3: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificar no navegador**

Em `/contas`, deve aparecer um rótulo "Resumo" acima dos 3 números, com uma linha divisória antes do bloco de Contas.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/contas/page.tsx
git commit -m "feat(contas): separa visualmente resumo da lista de contas"
```

---

## Task 7: Contas a Pagar — filtro de tipo em menu único

**Files:**
- Modify: `web/app/(app)/contas/page.tsx:1-19` (imports), `:369-379` (bloco de botões de `FILTROS_TIPO`)

**Interfaces:**
- Consumes: `filtroTipo`, `setFiltroTipo`, `FILTROS_TIPO` (já existem)
- Produces: nada

- [ ] **Step 1: Importar `Select`**

Junto dos imports de UI já existentes:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
```

- [ ] **Step 2: Trocar os botões pelo Select**

Localize:

```tsx
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
```

Troque por:

```tsx
            <Select value={filtroTipo} onValueChange={v => setFiltroTipo((v ?? 'todos') as FiltroTipo)}>
              <SelectTrigger className="w-44 h-9 text-sm">
                <SelectValue>{FILTROS_TIPO.find(o => o.value === filtroTipo)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FILTROS_TIPO.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
```

- [ ] **Step 3: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificar no navegador**

O menu deve filtrar exatamente como os 3 botões antigos (Todas / Contas fixas / Boletos de nota).

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/contas/page.tsx
git commit -m "feat(contas): filtro de tipo vira menu unico"
```

---

## Task 8: Contas a Pagar — lista paginada (20 por vez)

**Files:**
- Modify: `web/app/(app)/contas/page.tsx` (novo estado + efeito; passagem de `contas` para `<ListaContas>`, linhas ~402-412)

**Interfaces:**
- Consumes: `contasFiltradas` (já existe)
- Produces: nada

- [ ] **Step 1: Novo estado + reset ao trocar filtro**

Perto de `const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos')`, adicione:

```tsx
const [visivelCount, setVisivelCount] = useState(20)
```

Depois do `useEffect` que lê `?filtro=` da URL (linha ~127-130), adicione:

```tsx
useEffect(() => { setVisivelCount(20) }, [filtro, filtroTipo])
```

- [ ] **Step 2: Fatiar para exibição**

Logo depois do cálculo de `contasFiltradas` (depois do `.sort(...)`, linha ~161), adicione:

```tsx
const contasExibidas = contasFiltradas.slice(0, visivelCount)
```

**Importante:** o contador `{contasFiltradas.length} de {contas.length}` no `CardTitle` (linha ~365) **não muda** — continua usando o array completo, não a fatia.

- [ ] **Step 3: Passar a fatia para `<ListaContas>` e adicionar "Carregar mais"**

Localize:

```tsx
        <CardContent className="p-0">
          <ListaContas
            contas={contasFiltradas}
            hoje={hoje}
            onPagar={abrirPagarDialog}
            onDispensar={abrirDispensarDialog}
            onDesfazer={abrirDesfazerDialog}
            onEditarValor={abrirValorDialog}
            onInformarData={setDataDialog}
          />
        </CardContent>
```

Troque por:

```tsx
        <CardContent className="p-0">
          <ListaContas
            contas={contasExibidas}
            hoje={hoje}
            onPagar={abrirPagarDialog}
            onDispensar={abrirDispensarDialog}
            onDesfazer={abrirDesfazerDialog}
            onEditarValor={abrirValorDialog}
            onInformarData={setDataDialog}
          />
          {contasFiltradas.length > visivelCount && (
            <div className="text-center py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisivelCount(c => c + 20)}
              >
                Carregar mais {Math.min(20, contasFiltradas.length - visivelCount)}
              </Button>
            </div>
          )}
        </CardContent>
```

- [ ] **Step 4: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 5: Verificar no navegador**

Com filtro "Todas" e mais de 20 contas cadastradas (se não houver, teste conceitualmente e confirme que quando existir vai funcionar — não é bloqueante para o commit se o ambiente de teste tiver poucas contas). Confirme que o contador "X de Y" no topo do card continua certo mesmo com poucas linhas visíveis.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/contas/page.tsx
git commit -m "feat(contas): lista de contas paginada, 20 por vez"
```

---

## Task 9: Contas a Pagar — todo filtro mostra quantidade (e corrige contador que ignorava o filtro de tipo)

**Files:**
- Modify: `web/app/(app)/contas/page.tsx:135-161` (bloco `contasFiltradas`), `:382-398` (bloco `FILTROS.map`)

**Interfaces:**
- Consumes: `FiltroStatus`, `FiltroTipo`, `ContaAPI`, `ENCERRADAS`, `diasEntre` (já existem)
- Produces: `contaBateTipo(c: ContaAPI, filtroTipo: FiltroTipo): boolean` e `contaBateFiltro(c: ContaAPI, filtro: FiltroStatus, hoje: string): boolean` — **Task 10 modifica o corpo de `contaBateFiltro` (branch `'todas'`) mantendo esta mesma assinatura.**

**Achado corrigido de graça:** a revisão do Apolo de 10/08/2026 (achado 5) apontou que o contador de "Falta vencimento" ignorava o filtro de tipo (fixas/nota) — com "Contas fixas" selecionado, o botão podia dizer um número que a lista não confirmava. Esta task extrai a lógica de filtro pra duas funções reutilizadas tanto pela lista quanto pelo contador de cada botão, o que resolve o achado como consequência direta (não como escopo extra).

- [ ] **Step 1: Extrair `contaBateTipo` e `contaBateFiltro`**

Logo acima de `export default function ContasPage() {` (depois da declaração de `FILTROS_TIPO`, antes de `type PagamentoForm`), adicione:

```tsx
function contaBateTipo(c: ContaAPI, filtroTipo: FiltroTipo): boolean {
  if (filtroTipo === 'todos') return true
  if (filtroTipo === 'fixas') return c.nota_fiscal_id === null
  return c.nota_fiscal_id !== null
}

// "Todas" esconde as dispensadas de propósito (pedido de 10/08/2026): elas são
// contas que o Matheus marcou como "não vai ter cobrança" e só poluíam a fila.
// Não é bug — continuam acessíveis pelo botão "Dispensadas".
function contaBateFiltro(c: ContaAPI, filtro: FiltroStatus, hoje: string): boolean {
  if (filtro === 'todas')          return c.status !== 'dispensada'
  if (filtro === 'sem-vencimento') return !ENCERRADAS.has(c.status) && !c.vencimento
  if (filtro === 'atrasada')       return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
  return c.status === filtro
}
```

- [ ] **Step 2: Usar as funções em `contasFiltradas`**

Localize:

```tsx
  const contasFiltradas = contas
    .filter(c => {
      const okTipo =
        filtroTipo === 'todos' ? true :
        filtroTipo === 'fixas' ? c.nota_fiscal_id === null :
                                 c.nota_fiscal_id !== null

      if (!okTipo) return false

      // "Todas" esconde as dispensadas de propósito (pedido de 10/08/2026): elas são
      // contas que o Matheus marcou como "não vai ter cobrança" e só poluíam a fila.
      // Só 'dispensada' é escondida. 'paga' CONTINUA aparecendo em "Todas": é
      // histórico de pagamento e ele quer conferir.
      if (filtro === 'todas')          return c.status !== 'dispensada'
      if (filtro === 'sem-vencimento') return !ENCERRADAS.has(c.status) && !c.vencimento
      if (filtro === 'atrasada')       return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
      return c.status === filtro
    })
```

Troque por:

```tsx
  const contasFiltradas = contas
    .filter(c => contaBateTipo(c, filtroTipo) && contaBateFiltro(c, filtro, hoje))
```

(O `.sort(...)` que vem logo depois não muda.)

- [ ] **Step 3: Contador em cada botão de filtro**

Localize:

```tsx
            <div className="flex flex-wrap gap-2">
              {FILTROS.map(o => {
                const n = o.value === 'sem-vencimento'
                  ? contas.filter(c => !ENCERRADAS.has(c.status) && !c.vencimento).length
                  : o.value === 'dispensada'
                  ? contas.filter(c => c.status === 'dispensada').length
                  : 0
                return (
```

Troque por:

```tsx
            <div className="flex flex-wrap gap-2">
              {FILTROS.map(o => {
                const n = contas.filter(c => contaBateTipo(c, filtroTipo) && contaBateFiltro(c, o.value, hoje)).length
                return (
```

(O resto do `return (...)` do botão, mais abaixo, não muda.)

- [ ] **Step 4: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 5: Verificar no navegador**

Confirme que todo botão de status (Todas, Falta vencimento, Aguardando, Abertas, Atrasadas, Pagas, Dispensadas) mostra um número entre parênteses quando > 0. Selecione "Contas fixas" no filtro de tipo e confirme que os números mudam pra refletir só as fixas (esse é o bug que estava sendo corrigido — antes disso, alguns contadores ignoravam esse filtro).

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/contas/page.tsx
git commit -m "fix(contas): todo filtro mostra quantidade e passa a respeitar o filtro de tipo"
```

---

## Task 10: Contas a Pagar — "Todas" esconde paga com mais de 30 dias

**Files:**
- Modify: `web/app/(app)/contas/page.tsx` (função `contaBateFiltro`, criada na Task 9)

**Interfaces:**
- Consumes: `contaBateFiltro(c, filtro, hoje)` (assinatura definida na Task 9, **não muda**)
- Produces: nada

- [ ] **Step 1: Ajustar o branch `'todas'`**

Localize (resultado da Task 9):

```tsx
// "Todas" esconde as dispensadas de propósito (pedido de 10/08/2026): elas são
// contas que o Matheus marcou como "não vai ter cobrança" e só poluíam a fila.
// Não é bug — continuam acessíveis pelo botão "Dispensadas".
function contaBateFiltro(c: ContaAPI, filtro: FiltroStatus, hoje: string): boolean {
  if (filtro === 'todas')          return c.status !== 'dispensada'
  if (filtro === 'sem-vencimento') return !ENCERRADAS.has(c.status) && !c.vencimento
  if (filtro === 'atrasada')       return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
  return c.status === filtro
}
```

Troque por:

```tsx
// "Todas" esconde dispensada sempre, e paga com mais de 30 dias (pedido de
// 10/08/2026): a aba deixa de ser um histórico infinito e vira "o que ainda
// pede atenção ou foi resolvido recentemente". Quem quiser o histórico
// completo de pagamento usa a aba "Pagas" — essa continua sem limite de data.
function contaBateFiltro(c: ContaAPI, filtro: FiltroStatus, hoje: string): boolean {
  if (filtro === 'todas') {
    if (c.status === 'dispensada') return false
    if (c.status === 'paga')       return diasEntre(c.data_pagamento ?? hoje, hoje) <= 30
    return true
  }
  if (filtro === 'sem-vencimento') return !ENCERRADAS.has(c.status) && !c.vencimento
  if (filtro === 'atrasada')       return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
  return c.status === filtro
}
```

- [ ] **Step 2: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Verificar no navegador**

Se houver alguma conta paga há mais de 30 dias no ambiente de teste, confirme que ela some do filtro "Todas" mas continua aparecendo no filtro "Pagas". Se não houver dado antigo o suficiente pra testar isso na prática agora, deixe registrado no relatório final da task que a lógica foi revisada por leitura de código e checagem de tipos, não observada rodando com dado real — não é bloqueante para o commit.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/contas/page.tsx
git commit -m "feat(contas): Todas para de acumular conta paga ha mais de 30 dias"
```

---

## Depois de todas as tasks

- [ ] Rodar `npx tsc --noEmit` uma última vez no arquivo inteiro do projeto `web` (não só nos dois arquivos tocados), pra garantir que nenhuma mudança quebrou outro lugar.
- [ ] Convocar o Apolo (revisor) pra revisar o conjunto final das duas telas — é código novo em `agromouro-base`, cai na regra de revisão obrigatória da casa.
- [ ] Atualizar `STATE.md` (painel global) e o `ESTADO.md` do projeto com o que foi feito.
- [ ] Perguntar ao Matheus se quer abrir PR (pull request — pedido formal de juntar a branch `fix/telasfin` na `main`) ou se prefere revisar direto na branch antes disso.
