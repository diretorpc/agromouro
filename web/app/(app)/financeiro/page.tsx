'use client'

import { useEffect, useState } from 'react'
import { DollarSign, TrendingDown, Package, Filter, Plus, Pencil, Trash2 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { supabase } from '@/lib/supabase'

type ItemFinanceiro = {
  id: string
  descricao: string
  quantidade: number
  unidade: string
  valor_unitario: number
  valor_total: number
  centro_custo: string
  insumo_id: string | null
  nota_numero: string
  emitente_nome: string
  data_emissao: string
  is_manual: boolean
}

type FormData = {
  descricao: string
  quantidade: string
  unidade: string
  valor_unitario: string
  centro_custo: string
  data: string
}

const FORM_VAZIO: FormData = {
  descricao: '', quantidade: '1', unidade: 'UN',
  valor_unitario: '', centro_custo: 'outro', data: new Date().toISOString().slice(0, 10),
}

const TIPOS = [
  { value: 'herbicida', label: 'Herbicida' },
  { value: 'fungicida', label: 'Fungicida' },
  { value: 'inseticida', label: 'Inseticida' },
  { value: 'adjuvante', label: 'Adjuvante' },
  { value: 'biologico', label: 'Biológico' },
  { value: 'fertilizante_n', label: 'Fertilizante N' },
  { value: 'fertilizante_p', label: 'Fertilizante P' },
  { value: 'fertilizante_k', label: 'Fertilizante K' },
  { value: 'fertilizante_outro', label: 'Fertilizante Outro' },
  { value: 'calcario', label: 'Calcário' },
  { value: 'semente', label: 'Semente' },
  { value: 'combustivel', label: 'Combustível' },
  { value: 'lubrificante', label: 'Lubrificante' },
  { value: 'peca_maquina', label: 'Peça de Máquina' },
  { value: 'servico', label: 'Serviço' },
  { value: 'frete', label: 'Frete' },
  { value: 'operacional', label: 'Operacional' },
  { value: 'rh', label: 'Mão de Obra (RH)' },
  { value: 'outro', label: 'Outro' },
]

const CENTRO_CUSTO_STYLE: Record<string, string> = {
  herbicida:          'bg-red-100 text-red-700 border-red-200',
  fungicida:          'bg-purple-100 text-purple-700 border-purple-200',
  inseticida:         'bg-orange-100 text-orange-700 border-orange-200',
  adjuvante:          'bg-cyan-100 text-cyan-700 border-cyan-200',
  biologico:          'bg-teal-100 text-teal-700 border-teal-200',
  fertilizante_n:     'bg-green-100 text-green-700 border-green-200',
  fertilizante_p:     'bg-green-100 text-green-700 border-green-200',
  fertilizante_k:     'bg-green-100 text-green-700 border-green-200',
  fertilizante_outro: 'bg-green-100 text-green-700 border-green-200',
  calcario:           'bg-stone-100 text-stone-700 border-stone-200',
  semente:            'bg-yellow-100 text-yellow-700 border-yellow-200',
  combustivel:        'bg-blue-100 text-blue-700 border-blue-200',
  lubrificante:       'bg-blue-100 text-blue-700 border-blue-200',
  peca_maquina:       'bg-indigo-100 text-indigo-700 border-indigo-200',
  servico:            'bg-pink-100 text-pink-700 border-pink-200',
  frete:              'bg-slate-100 text-slate-700 border-slate-200',
  operacional:        'bg-gray-100 text-gray-600 border-gray-200',
  rh:                 'bg-rose-100 text-rose-700 border-rose-200',
  outro:              'bg-gray-100 text-gray-700 border-gray-200',
}

const CENTRO_CUSTO_COLOR: Record<string, string> = {
  herbicida:          '#ef4444',
  fungicida:          '#a855f7',
  inseticida:         '#f97316',
  adjuvante:          '#06b6d4',
  biologico:          '#14b8a6',
  fertilizante_n:     '#22c55e',
  fertilizante_p:     '#16a34a',
  fertilizante_k:     '#15803d',
  fertilizante_outro: '#166534',
  calcario:           '#78716c',
  semente:            '#eab308',
  combustivel:        '#3b82f6',
  lubrificante:       '#2563eb',
  peca_maquina:       '#6366f1',
  servico:            '#ec4899',
  frete:              '#64748b',
  operacional:        '#6b7280',
  rh:                 '#f43f5e',
  outro:              '#9ca3af',
}

function fmtBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function tipoLabel(value: string) {
  return TIPOS.find(t => t.value === value)?.label ?? value
}

export default function FinanceiroPage() {
  const [itens, setItens] = useState<ItemFinanceiro[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroCentro, setFiltroCentro] = useState('todos')
  const [filtroMes, setFiltroMes] = useState('todos')

  const [addDialog, setAddDialog] = useState(false)
  const [editItem, setEditItem] = useState<ItemFinanceiro | null>(null)
  const [deleteItem, setDeleteItem] = useState<ItemFinanceiro | null>(null)
  const [deleteErro, setDeleteErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState<FormData>(FORM_VAZIO)

  async function load() {
    const { data } = await supabase
      .from('itens_nfe')
      .select(`
        id,
        descricao,
        quantidade,
        unidade,
        valor_unitario,
        valor_total,
        insumo_id,
        insumos(tipo),
        notas_fiscais(numero, emitente_nome, data_emissao)
      `)
      .order('id', { ascending: false })

    const mapped: ItemFinanceiro[] = (data ?? []).map((row: any) => ({
      id: row.id,
      descricao: row.descricao,
      quantidade: row.quantidade,
      unidade: row.unidade,
      valor_unitario: row.valor_unitario,
      valor_total: row.valor_total,
      centro_custo: row.insumos?.tipo ?? 'outro',
      insumo_id: row.insumo_id,
      nota_numero: row.notas_fiscais?.numero ?? null,
      emitente_nome: row.notas_fiscais?.emitente_nome ?? '',
      data_emissao: row.notas_fiscais?.data_emissao ?? '',
      is_manual: !row.notas_fiscais,
    }))

    setItens(mapped)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleAdd() {
    setSalvando(true)
    const qtd = parseFloat(form.quantidade) || 1
    const vUnit = parseFloat(form.valor_unitario) || 0

    let insumoId: string | null = null
    const { data: existente } = await supabase
      .from('insumos')
      .select('id')
      .ilike('nome', form.descricao.trim())
      .maybeSingle()

    if (existente) {
      insumoId = existente.id
    } else {
      const { data: novo } = await supabase
        .from('insumos')
        .insert({ nome: form.descricao.trim(), tipo: form.centro_custo, unidade: form.unidade })
        .select('id')
        .single()
      insumoId = novo?.id ?? null
    }

    await supabase.from('itens_nfe').insert({
      nota_fiscal_id: null,
      descricao: form.descricao.trim(),
      quantidade: qtd,
      unidade: form.unidade,
      valor_unitario: vUnit,
      valor_total: qtd * vUnit,
      insumo_id: insumoId,
      data_manual: form.data,
    })

    setSalvando(false)
    setAddDialog(false)
    setForm(FORM_VAZIO)
    load()
  }

  function abrirEdicao(item: ItemFinanceiro) {
    setForm({
      descricao: item.descricao,
      quantidade: String(item.quantidade),
      unidade: item.unidade,
      valor_unitario: String(item.valor_unitario),
      centro_custo: item.centro_custo,
      data: item.data_emissao ? item.data_emissao.slice(0, 10) : new Date().toISOString().slice(0, 10),
    })
    setEditItem(item)
  }

  async function handleEdit() {
    if (!editItem) return
    setSalvando(true)
    const qtd = parseFloat(form.quantidade) || 1
    const vUnit = parseFloat(form.valor_unitario) || 0

    if (editItem.insumo_id) {
      await supabase.from('insumos').update({ tipo: form.centro_custo }).eq('id', editItem.insumo_id)
    }

    await supabase.from('itens_nfe').update({
      descricao: form.descricao.trim(),
      quantidade: qtd,
      unidade: form.unidade,
      valor_unitario: vUnit,
      valor_total: qtd * vUnit,
    }).eq('id', editItem.id)

    setSalvando(false)
    setEditItem(null)
    setForm(FORM_VAZIO)
    load()
  }

  async function handleDelete() {
    if (!deleteItem) return
    setSalvando(true)
    setDeleteErro(null)

    const { data: deleted, error } = await supabase
      .from('itens_nfe')
      .delete()
      .eq('id', deleteItem.id)
      .select('id')

    setSalvando(false)

    if (error) {
      console.error('[Financeiro] Erro ao excluir item:', error)
      setDeleteErro(`Erro: ${error.message}`)
      return
    }

    if (!deleted || deleted.length === 0) {
      console.error('[Financeiro] Delete não afetou nenhuma linha — possível política RLS')
      setDeleteErro('Sem permissão para excluir este item. Verifique as políticas do banco.')
      return
    }

    setDeleteItem(null)
    load()
  }

  const meses = Array.from(
    new Set(itens.filter(i => i.data_emissao).map(i => i.data_emissao.slice(0, 7)))
  ).sort((a, b) => b.localeCompare(a))

  const itensFiltrados = itens.filter(i => {
    const okCentro = filtroCentro === 'todos' || i.centro_custo === filtroCentro
    const okMes = filtroMes === 'todos' || i.data_emissao.startsWith(filtroMes)
    return okCentro && okMes
  })

  const totalGeral = itensFiltrados.reduce((s, i) => s + i.valor_total, 0)
  const porCategoria = itensFiltrados.reduce<Record<string, number>>((acc, i) => {
    acc[i.centro_custo] = (acc[i.centro_custo] ?? 0) + i.valor_total
    return acc
  }, {})
  const maiorCategoria = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0]

  const chartData = Object.entries(porCategoria)
    .map(([key, value]) => ({ key, label: tipoLabel(key), value }))
    .sort((a, b) => b.value - a.value)

  if (loading) return <PageSkeleton />

  function FormFields() {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Descrição</Label>
          <Input
            placeholder="Ex: Roundup 20L, Frete colheita, Peça bomba..."
            value={form.descricao}
            onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Quantidade</Label>
            <Input
              type="number" min="0" step="any"
              value={form.quantidade}
              onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Unidade</Label>
            <Input
              placeholder="L, KG, UN, SC..."
              value={form.unidade}
              onChange={e => setForm(f => ({ ...f, unidade: e.target.value }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Valor Unitário (R$)</Label>
            <Input
              type="number" min="0" step="0.01"
              placeholder="0,00"
              value={form.valor_unitario}
              onChange={e => setForm(f => ({ ...f, valor_unitario: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input
              type="date"
              value={form.data}
              onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Centro de Custo</Label>
          <Select value={form.centro_custo} onValueChange={v => setForm(f => ({ ...f, centro_custo: v ?? 'outro' }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {form.quantidade && form.valor_unitario && (
          <p className="text-sm text-muted-foreground text-right">
            Total: <span className="font-semibold text-foreground">
              {fmtBRL((parseFloat(form.quantidade) || 0) * (parseFloat(form.valor_unitario) || 0))}
            </span>
          </p>
        )}
      </div>
    )
  }

  const filtroAtivo = filtroMes !== 'todos' || filtroCentro !== 'todos'

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">Despesas e lançamentos da fazenda</p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => { setForm(FORM_VAZIO); setAddDialog(true) }}>
          <Plus className="h-4 w-4 mr-1.5" />
          Adicionar
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />Total de Despesas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtBRL(totalGeral)}</p>
            <p className="text-xs text-muted-foreground mt-1">{itensFiltrados.length} item(ns) no período</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />Maior Gasto
            </CardTitle>
          </CardHeader>
          <CardContent>
            {maiorCategoria ? (
              <>
                <p className="text-2xl font-bold">{fmtBRL(maiorCategoria[1])}</p>
                <p className="text-xs text-muted-foreground mt-1">{tipoLabel(maiorCategoria[0])}</p>
              </>
            ) : <p className="text-muted-foreground text-sm">—</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />Categorias com Gasto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{Object.keys(porCategoria).length}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {Object.keys(porCategoria).map(tipoLabel).join(', ') || '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gastos por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={chartData.length * 48 + 16}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 0, right: 80, bottom: 0, left: 8 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={140}
                  tick={{ fontSize: 15 }}
                  tickLine={false}
                  axisLine={false}
                />
                <RechartsTooltip
                  formatter={(value: unknown) => [fmtBRL(Number(value ?? 0)), 'Total']}
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {chartData.map(entry => (
                    <Cell key={entry.key} fill={CENTRO_CUSTO_COLOR[entry.key] ?? '#9ca3af'} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(v: unknown) => fmtBRL(Number(v ?? 0))}
                    style={{ fontSize: 14, fill: '#6b7280' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">
              Lançamentos por Item
              {filtroAtivo && (
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  {itensFiltrados.length} de {itens.length}
                </span>
              )}
            </CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filtroMes} onValueChange={v => setFiltroMes(v ?? 'todos')}>
              <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="Mês" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os meses</SelectItem>
                {meses.map(m => (
                  <SelectItem key={m} value={m}>
                    {new Date(m + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroCentro} onValueChange={v => setFiltroCentro(v ?? 'todos')}>
              <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="Centro de custo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {filtroAtivo && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground"
                onClick={() => { setFiltroMes('todos'); setFiltroCentro('todos') }}
              >
                Limpar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Produto / Serviço</TableHead>
                <TableHead className="w-[90px] text-right">Qtd.</TableHead>
                <TableHead className="w-[110px] text-right">Valor Unit.</TableHead>
                <TableHead className="w-[120px] text-right">Valor Total</TableHead>
                <TableHead className="w-[140px]">Centro de Custo</TableHead>
                <TableHead className="w-[160px]">Origem</TableHead>
                <TableHead className="w-[90px]">Data</TableHead>
                <TableHead className="w-[72px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {itensFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    Nenhum lançamento encontrado.
                  </TableCell>
                </TableRow>
              ) : itensFiltrados.map(item => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-sm max-w-[200px] truncate" title={item.descricao}>
                    {item.descricao}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {item.quantidade} {item.unidade}
                  </TableCell>
                  <TableCell className="text-right text-sm">{fmtBRL(item.valor_unitario)}</TableCell>
                  <TableCell className="text-right text-sm font-semibold">{fmtBRL(item.valor_total)}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`capitalize text-xs ${CENTRO_CUSTO_STYLE[item.centro_custo] ?? CENTRO_CUSTO_STYLE.outro}`}
                    >
                      {tipoLabel(item.centro_custo)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm w-[160px]">
                    {item.is_manual ? (
                      <span className="text-xs text-muted-foreground italic">Manual</span>
                    ) : (
                      <div>
                        <p className="font-medium text-xs">NF {item.nota_numero}</p>
                        <Tooltip>
                          <TooltipTrigger className="text-xs text-muted-foreground truncate max-w-[150px] cursor-default block w-full text-left bg-transparent border-0 p-0 font-normal">
                            {item.emitente_nome}
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            {item.emitente_nome}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {item.data_emissao ? fmtDate(item.data_emissao) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Editar"
                        className="hover:bg-blue-50 hover:text-blue-600"
                        onClick={() => abrirEdicao(item)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Excluir"
                        className="hover:bg-red-50 hover:text-red-600 text-red-400"
                        onClick={() => setDeleteItem(item)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {itensFiltrados.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-sm font-semibold text-muted-foreground py-3">
                    Total ({itensFiltrados.length} {itensFiltrados.length === 1 ? 'item' : 'itens'})
                  </TableCell>
                  <TableCell className="text-right text-sm font-bold py-3">
                    {fmtBRL(totalGeral)}
                  </TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Dialog open={addDialog} onOpenChange={open => { if (!open) setAddDialog(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar Lançamento</DialogTitle></DialogHeader>
          <FormFields />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={salvando || !form.descricao || !form.valor_unitario}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={open => { if (!open) setEditItem(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Lançamento</DialogTitle></DialogHeader>
          <FormFields />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={salvando || !form.descricao || !form.valor_unitario}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteItem} onOpenChange={open => { if (!open) { setDeleteItem(null); setDeleteErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir lançamento?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deleteItem?.descricao}</span> será removido permanentemente.
            {!deleteItem?.is_manual && (
              <span className="block mt-1 text-yellow-600">
                Este item veio de uma NF-e. A nota em si não será excluída.
              </span>
            )}
          </p>
          {deleteErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {deleteErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteItem(null); setDeleteErro(null) }}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={salvando}>
              {salvando ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-40 bg-muted rounded" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
      </div>
      <div className="h-72 bg-muted rounded-xl" />
    </div>
  )
}
