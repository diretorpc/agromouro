# Cartões — Filtros, Gastos por Categoria e Editar/Excluir Lançamentos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar à página de cartões: filtros de mês e cartão (KPIs refletem o filtro), tabela de gastos por categoria e ações de editar/excluir por lançamento.

**Architecture:** Tudo em `web/app/(app)/cartoes/page.tsx` (single-file, 937 linhas). Estado de filtro (`filtroMes`, `filtroCartao`) derivado em `lancFiltrados`, que alimenta KPIs, tabela de categoria e tabela de lançamentos. Dois novos dialogs para editar/excluir lançamento. API já tem PUT + DELETE `/cartoes/lancamento/:id` (implementados na sessão anterior).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui, `api.put`, `api.del` (web/lib/api.ts)

---

## Arquivos

| Ação | Arquivo |
|------|---------|
| ✅ Já feito | `api/src/routes/cartoes.ts` — PUT + DELETE `/cartoes/lancamento/:id` |
| Modificar | `web/app/(app)/cartoes/page.tsx` — todos os itens abaixo |

---

### Task 1: Fix timezone bug em `mesLabel`

**Arquivo:** `web/app/(app)/cartoes/page.tsx:112-114`

O problema: `new Date("2026-06-01")` parseia como UTC. Em UTC-3, UTC midnight = 21:00 do dia anterior → `toLocaleDateString` retorna o mês errado.

- [ ] **Substituir `mesLabel`** (linha 112-114) pelo código abaixo:

```ts
function mesLabel(iso: string) {
  const [y, mo] = iso.split('-')
  return new Date(+y, +mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "fix(cartoes): timezone bug em mesLabel (UTC offset causa mês errado no Brasil)"
```

---

### Task 2: Adicionar estado de filtros

**Arquivo:** `web/app/(app)/cartoes/page.tsx`

- [ ] **Importar `Filter`** de lucide-react (linha 4, junto com os outros ícones):

```ts
import { CreditCard, Upload, Plus, Pencil, Trash2, Filter } from 'lucide-react'
```

- [ ] **Adicionar estados de filtro** após a linha do `useState` de `manualDialog` (~linha 137):

```ts
const [filtroMes, setFiltroMes]       = useState('todos')
const [filtroCartao, setFiltroCartao] = useState('todos')
```

- [ ] **Adicionar estados de editar/excluir lançamento** logo abaixo:

```ts
const [editLanc, setEditLanc]         = useState<LancamentoCartao | null>(null)
const [editLancForm, setEditLancForm] = useState<ManualForm>({
  data: '', descricao: '', valor: '', categoria: 'outros', cartao_id: '',
})
const [deleteLanc, setDeleteLanc]     = useState<LancamentoCartao | null>(null)
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "feat(cartoes): adicionar estado filtroMes, filtroCartao, editLanc, deleteLanc"
```

---

### Task 3: Adicionar handlers para editar/excluir lançamento

**Arquivo:** `web/app/(app)/cartoes/page.tsx` — seção `// ─── Lançamento manual`

- [ ] **Adicionar `abrirEditLanc`** após `handleManual` (~linha 368):

```ts
function abrirEditLanc(l: LancamentoCartao) {
  setEditLancForm({
    data:      l.data,
    descricao: l.descricao,
    valor:     String(l.valor),
    categoria: l.categoria ?? 'outros',
    cartao_id: l.cartao_id ?? '',
  })
  setEditLanc(l)
}

async function handleEditLanc() {
  if (!editLanc) return
  const valorNum = parseFloat(editLancForm.valor)
  if (!editLancForm.descricao.trim() || isNaN(valorNum) || valorNum <= 0) return
  setSalvando(true)
  try {
    await api.put(`/cartoes/lancamento/${editLanc.id}`, {
      data:      editLancForm.data,
      descricao: editLancForm.descricao.trim(),
      valor:     valorNum,
      categoria: editLancForm.categoria,
      cartao_id: editLancForm.cartao_id || undefined,
    })
    setEditLanc(null)
    load()
  } catch {
    setErroGeral('Erro ao atualizar lançamento. Tente novamente.')
  } finally {
    setSalvando(false)
  }
}

async function handleDeleteLanc() {
  if (!deleteLanc) return
  setSalvando(true)
  try {
    await api.del(`/cartoes/lancamento/${deleteLanc.id}`)
    setDeleteLanc(null)
    load()
  } catch {
    setErroGeral('Erro ao excluir lançamento. Tente novamente.')
  } finally {
    setSalvando(false)
  }
}
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "feat(cartoes): handlers handleEditLanc e handleDeleteLanc"
```

---

### Task 4: Atualizar valores derivados

**Arquivo:** `web/app/(app)/cartoes/page.tsx` — seção `// ─── Derived values` (~linha 370)

- [ ] **Substituir o bloco inteiro de derived values** (linhas 370-379) por:

```ts
const mesAtual = new Date().toISOString().slice(0, 7)

const meses = Array.from(
  new Set([
    mesAtual,
    ...lancamentos.filter(l => l.data).map(l => l.data.slice(0, 7)),
  ])
).sort((a, b) => b.localeCompare(a))

const lancFiltrados = lancamentos.filter(l => {
  const okMes    = filtroMes === 'todos' || l.data?.startsWith(filtroMes)
  const okCartao = filtroCartao === 'todos' || l.cartao_id === filtroCartao
  return okMes && okCartao
})

const gastoFiltrado = lancFiltrados.reduce((s, l) => s + l.valor, 0)

const kpiMesLabel = filtroMes === 'todos'
  ? `Gasto em ${mesLabel(mesAtual)}`
  : `Gasto em ${mesLabel(filtroMes)}`

const porCategoria = lancFiltrados.reduce<Record<string, number>>((acc, l) => {
  const cat = l.categoria ?? 'outros'
  acc[cat] = (acc[cat] ?? 0) + l.valor
  return acc
}, {})

const allTransacoes    = Object.values(previewGrupos).flatMap(g => g.transacoes)
const selecionadas     = allTransacoes.filter(t => t.incluir && !t.ja_importado)
const totalSelecionado = selecionadas.reduce((s, t) => s + t.valor, 0)
const podeConfirmar    = selecionadas.length > 0 && selecionadas.every(t => t.cartao_id !== null)
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "feat(cartoes): valores derivados — meses, lancFiltrados, porCategoria"
```

---

### Task 5: Atualizar KPIs para refletir filtro

**Arquivo:** `web/app/(app)/cartoes/page.tsx` — bloco KPIs (~linha 430)

- [ ] **Substituir o segundo e terceiro KpiCard** (os dois depois de "Cartões Ativos"):

Antes:
```tsx
<KpiCard
  label={`Gasto em ${mesLabel(mesAtual)}`}
  value={fmtBRL(gastoMes)}
  sub={`${lancamentos.filter(l => l.data?.startsWith(mesAtual)).length} transações no mês`}
  icon={<CreditCard className="h-5 w-5" />}
  iconBg="rgba(239,68,68,0.1)"
  iconColor="#ef4444"
/>
<KpiCard
  label="Total de Transações"
  value={String(lancamentos.length)}
  sub="Importadas + manuais"
  icon={<CreditCard className="h-5 w-5" />}
  iconBg="rgba(34,197,94,0.1)"
  iconColor="#16a34a"
/>
```

Depois:
```tsx
<KpiCard
  label={kpiMesLabel}
  value={fmtBRL(gastoFiltrado)}
  sub={`${lancFiltrados.length} transações no período`}
  icon={<CreditCard className="h-5 w-5" />}
  iconBg="rgba(239,68,68,0.1)"
  iconColor="#ef4444"
/>
<KpiCard
  label={filtroMes === 'todos' && filtroCartao === 'todos' ? 'Total de Transações' : 'Transações Filtradas'}
  value={String(lancFiltrados.length)}
  sub={filtroMes === 'todos' && filtroCartao === 'todos' ? 'Importadas + manuais' : `de ${lancamentos.length} no total`}
  icon={<CreditCard className="h-5 w-5" />}
  iconBg="rgba(34,197,94,0.1)"
  iconColor="#16a34a"
/>
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "feat(cartoes): KPIs refletem filtro ativo (opção A aprovada)"
```

---

### Task 6: Adicionar barra de filtros + tabela de Gastos por Categoria

**Arquivo:** `web/app/(app)/cartoes/page.tsx` — entre o cartões grid e o Card de lançamentos

- [ ] **Adicionar, logo antes de `{/* ── Lançamentos recentes ── */}`**, o seguinte JSX:

```tsx
{/* ── Filtros ── */}
<div className="flex flex-wrap items-center gap-2">
  <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  <Select value={filtroMes} onValueChange={v => setFiltroMes(v ?? 'todos')}>
    <SelectTrigger className="w-44 h-9 text-sm">
      <SelectValue>
        {filtroMes === 'todos' ? 'Todos os meses' : mesLabel(filtroMes)}
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="todos">Todos os meses</SelectItem>
      {meses.map(m => (
        <SelectItem key={m} value={m}>{mesLabel(m)}</SelectItem>
      ))}
    </SelectContent>
  </Select>
  <Select value={filtroCartao} onValueChange={v => setFiltroCartao(v ?? 'todos')}>
    <SelectTrigger className="w-44 h-9 text-sm">
      <SelectValue>
        {filtroCartao === 'todos'
          ? 'Todos os cartões'
          : (cartoes.find(c => c.id === filtroCartao)?.apelido ?? 'Todos os cartões')}
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="todos">Todos os cartões</SelectItem>
      {cartoes.map(c => (
        <SelectItem key={c.id} value={c.id}>{c.apelido}</SelectItem>
      ))}
    </SelectContent>
  </Select>
  {(filtroMes !== 'todos' || filtroCartao !== 'todos') && (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 text-muted-foreground"
      onClick={() => { setFiltroMes('todos'); setFiltroCartao('todos') }}
    >
      Limpar
    </Button>
  )}
</div>

{/* ── Gastos por Categoria ── */}
{lancFiltrados.length > 0 && (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-base">Gastos por Categoria</CardTitle>
    </CardHeader>
    <CardContent className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right w-[130px]">Total</TableHead>
            <TableHead className="text-right w-[70px]">%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(porCategoria)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, total]) => {
              const pct = gastoFiltrado > 0 ? (total / gastoFiltrado * 100).toFixed(1) : '0.0'
              return (
                <TableRow key={cat}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${CAT_STYLE[cat] ?? CAT_STYLE.outros}`}
                    >
                      {CAT_LABEL[cat] ?? cat}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-sm">
                    {fmtBRL(total)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {pct}%
                  </TableCell>
                </TableRow>
              )
            })}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
)}
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "feat(cartoes): barra de filtros mês+cartão e tabela gastos por categoria"
```

---

### Task 7: Coluna de ações na tabela de lançamentos + usar `lancFiltrados`

**Arquivo:** `web/app/(app)/cartoes/page.tsx` — Card "Lançamentos Recentes"

- [ ] **Atualizar `<CardTitle>`** para refletir filtro:

```tsx
<CardTitle className="text-base">
  {filtroMes === 'todos' && filtroCartao === 'todos'
    ? 'Lançamentos Recentes'
    : 'Lançamentos Filtrados'}
</CardTitle>
```

- [ ] **Adicionar coluna de ações no `<TableHeader>`** (após a coluna Valor):

```tsx
<TableHead className="w-[80px]" />
```

- [ ] **Substituir `lancamentos.map(l => (` por `lancFiltrados.map(l => (`** no TableBody.

- [ ] **Substituir a mensagem de vazio** (`lancamentos.length === 0`) por `lancFiltrados.length === 0`.

- [ ] **Adicionar `<TableCell>` de ações** em cada linha, após a célula do Valor:

```tsx
<TableCell>
  <div className="flex items-center justify-end gap-1">
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => abrirEditLanc(l)}
      aria-label="Editar lançamento"
    >
      <Pencil className="h-3.5 w-3.5" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-destructive hover:text-destructive"
      onClick={() => setDeleteLanc(l)}
      aria-label="Excluir lançamento"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  </div>
</TableCell>
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "feat(cartoes): coluna de ações (editar/excluir) na tabela de lançamentos"
```

---

### Task 8: Dialog de editar lançamento

**Arquivo:** `web/app/(app)/cartoes/page.tsx` — após o Dialog de lançamento manual (~linha 745)

- [ ] **Adicionar o dialog** logo após o fechamento do `{/* ── Dialog: Lançamento manual ── */}`:

```tsx
{/* ── Dialog: Editar lançamento ── */}
<Dialog open={!!editLanc} onOpenChange={open => { if (!open) setEditLanc(null) }}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Editar Lançamento</DialogTitle>
    </DialogHeader>
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Data</Label>
          <Input
            type="date"
            value={editLancForm.data}
            onChange={e => setEditLancForm(f => ({ ...f, data: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Valor (R$)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={editLancForm.valor}
            onChange={e => setEditLancForm(f => ({ ...f, valor: e.target.value }))}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Estabelecimento</Label>
        <Input
          value={editLancForm.descricao}
          onChange={e => setEditLancForm(f => ({ ...f, descricao: e.target.value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Categoria</Label>
          <Select
            value={editLancForm.categoria}
            onValueChange={v => setEditLancForm(f => ({ ...f, categoria: v ?? 'outros' }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIAS.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Cartão</Label>
          <Select
            value={editLancForm.cartao_id}
            onValueChange={v => setEditLancForm(f => ({ ...f, cartao_id: v ?? '' }))}
          >
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {cartoes.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.apelido}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setEditLanc(null)}>Cancelar</Button>
      <Button
        onClick={handleEditLanc}
        disabled={
          salvando ||
          !editLancForm.descricao.trim() ||
          !editLancForm.valor ||
          parseFloat(editLancForm.valor) <= 0
        }
      >
        {salvando ? 'Salvando…' : 'Salvar'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "feat(cartoes): dialog de editar lançamento"
```

---

### Task 9: Dialog de excluir lançamento

**Arquivo:** `web/app/(app)/cartoes/page.tsx` — após o dialog de editar lançamento

- [ ] **Adicionar o dialog** logo após o dialog de editar:

```tsx
{/* ── Dialog: Excluir lançamento ── */}
<Dialog open={!!deleteLanc} onOpenChange={open => { if (!open) setDeleteLanc(null) }}>
  <DialogContent className="max-w-sm">
    <DialogHeader>
      <DialogTitle>Excluir lançamento?</DialogTitle>
    </DialogHeader>
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{deleteLanc?.descricao}</span>{' '}
      de <span className="font-medium text-foreground">
        {deleteLanc ? fmtBRL(deleteLanc.valor) : ''}
      </span> será excluído permanentemente. Esta ação não pode ser desfeita.
    </p>
    <DialogFooter>
      <Button variant="outline" onClick={() => setDeleteLanc(null)}>Cancelar</Button>
      <Button variant="destructive" onClick={handleDeleteLanc} disabled={salvando}>
        {salvando ? 'Excluindo…' : 'Excluir'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Commit**

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "feat(cartoes): dialog de excluir lançamento com confirmação"
```

---

### Task 10: Verificação final

- [ ] **Type-check**: `cd web && npx tsc --noEmit`  
  Esperado: sem erros.

- [ ] **Abrir localhost:3000/cartoes** e verificar:
  - [ ] Filtro de mês muda os KPIs e a tabela
  - [ ] Filtro de cartão isola transações daquele cartão
  - [ ] "Limpar" reseta os dois filtros
  - [ ] Tabela "Gastos por Categoria" aparece com dados e some quando sem resultados
  - [ ] Botão de lápis abre dialog com dados pré-preenchidos; salvar recarrega lista
  - [ ] Botão de lixeira abre confirmação; excluir remove da lista
  - [ ] `mesLabel` exibe "junho de 2026" corretamente (não maio)

- [ ] **Commit final** (se ajustes visuais foram necessários):

```bash
git add web/app/\(app\)/cartoes/page.tsx
git commit -m "fix(cartoes): ajustes pós-verificação visual"
```
