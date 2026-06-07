'use client'

import { useEffect, useState } from 'react'

function setUrlParam(key: string, value: string, dflt = 'todos') {
  const p = new URLSearchParams(window.location.search)
  if (!value || value === dflt) p.delete(key)
  else p.set(key, value)
  window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname)
}
import { Pencil, Plus, Trash2, Tractor, Calendar, Layers, BarChart2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { KpiCard } from '@/components/ui/kpi-card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { useFazenda } from '@/context/fazenda-context'
import type { Talhao } from '@/lib/types'

type ItemOperacao = {
  id: string
  insumo_id: string | null
  descricao: string | null
  quantidade: number
  dose_por_ha: number | null
  unidade: string | null
  insumos?: { nome: string; unidade: string }
}

type OperacaoCompleta = {
  id: string
  talhao_id: string
  tipo: string
  data: string
  descricao: string
  fonte: string
  talhoes?: { nome: string }
  itens_operacao?: ItemOperacao[]
}

type InsumoEstoque = {
  insumo_id: string
  quantidade_atual: number
  insumos: { id: string; nome: string; unidade: string }
}

type ProdutoForm = {
  modo: 'estoque' | 'manual'
  insumo_id: string
  nome_manual: string
  unidade_dose: 'L' | 'KG' | 'ML'
  dose_por_ha: string
}

const TIPOS_OPERACAO = [
  { value: 'pulverizacao', label: 'Pulverização' },
  { value: 'adubacao',     label: 'Adubação' },
  { value: 'plantio',      label: 'Plantio' },
  { value: 'colheita',     label: 'Colheita' },
  { value: 'calagem',      label: 'Calagem' },
  { value: 'irrigacao',    label: 'Irrigação' },
  { value: 'outro',        label: 'Outro' },
]

function tipoLabel(value: string) {
  return TIPOS_OPERACAO.find(t => t.value === value)?.label ?? value
}

export default function OperacoesPage() {
  const [operacoes, setOperacoes] = useState<OperacaoCompleta[]>([])
  const [talhoes, setTalhoes] = useState<Talhao[]>([])
  const [insumos, setInsumos] = useState<InsumoEstoque[]>([])
  const [loading, setLoading] = useState(true)
  const { fazendaAtiva } = useFazenda()
  const [modalOpen, setModalOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const [editingOp, setEditingOp] = useState<OperacaoCompleta | null>(null)
  const [deletando, setDeletando] = useState<string | null>(null)
  const [deleteConfirmOp, setDeleteConfirmOp] = useState<OperacaoCompleta | null>(null)

  const [filtroTalhao, setFiltroTalhao] = useState('todos')
  const [form, setForm] = useState({
    talhao_id: '',
    tipo: '',
    data: new Date().toISOString().split('T')[0],
    descricao: '',
  })
  const [produtos, setProdutos] = useState<ProdutoForm[]>([])

  async function loadData() {
    const [resOps, resTalhoes, resInsumos] = await Promise.all([
      supabase
        .from('operacoes')
        .select('*, talhoes(nome), itens_operacao(id, insumo_id, descricao, quantidade, dose_por_ha, unidade, insumos(nome, unidade))')
        .order('data', { ascending: false })
        .limit(50),
      supabase.from('talhoes').select('*').order('nome'),
      supabase.from('estoque').select('insumo_id, quantidade_atual, insumos(id, nome, unidade)'),
    ])

    if (resOps.error) console.error('[Operações] ops:', resOps.error)
    if (resTalhoes.error) console.error('[Operações] talhoes:', resTalhoes.error)
    if (resInsumos.error) console.error('[Operações] insumos:', resInsumos.error)

    setOperacoes((resOps.data ?? []) as unknown as OperacaoCompleta[])
    setTalhoes((resTalhoes.data ?? []) as Talhao[])
    setInsumos((resInsumos.data ?? []) as unknown as InsumoEstoque[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const talhao = params.get('talhao')
    if (talhao !== null) setFiltroTalhao(talhao)
  }, [])

  function addProduto() {
    setProdutos(p => [...p, { modo: 'estoque', insumo_id: '', nome_manual: '', unidade_dose: 'L', dose_por_ha: '' }])
  }

  function removeProduto(idx: number) {
    setProdutos(p => p.filter((_, i) => i !== idx))
  }

  function updateProduto(idx: number, field: keyof ProdutoForm, value: string) {
    setProdutos(p => p.map((prod, i) => i === idx ? { ...prod, [field]: value } : prod))
  }

  function handleDelete(op: OperacaoCompleta) {
    setDeleteConfirmOp(op)
  }

  async function confirmarDeleteOp() {
    if (!deleteConfirmOp) return
    const op = deleteConfirmOp
    setDeleteConfirmOp(null)
    setDeletando(op.id)

    for (const item of op.itens_operacao ?? []) {
      if (item.insumo_id && item.quantidade) {
        await supabase.from('movimentacoes_estoque').insert({
          insumo_id: item.insumo_id,
          tipo: 'entrada',
          quantidade: item.quantidade,
          data: new Date().toISOString().split('T')[0],
          origem: 'manual',
          ...(fazendaAtiva ? { fazenda_id: fazendaAtiva.id } : {}),
        })
        // busca saldo fresco do banco para evitar usar state desatualizado
        const { data: estRow } = await supabase
          .from('estoque')
          .select('quantidade_atual')
          .eq('insumo_id', item.insumo_id)
          .single()
        if (estRow) {
          await supabase.from('estoque')
            .update({ quantidade_atual: estRow.quantidade_atual + item.quantidade })
            .eq('insumo_id', item.insumo_id)
        }
      }
    }

    await supabase.from('operacoes').delete().eq('id', op.id)
    setDeletando(null)
    loadData()
  }

  function handleFiltroTalhao(v: string | null) {
    const val = v ?? 'todos'
    setFiltroTalhao(val)
    setUrlParam('talhao', val)
  }

  function openEdit(op: OperacaoCompleta) {
    setEditingOp(op)
    setErroSalvar(null)
    setForm({
      talhao_id: op.talhao_id,
      tipo: op.tipo,
      data: op.data,
      descricao: op.descricao ?? '',
    })
    setProdutos(
      (op.itens_operacao ?? []).map(item => ({
        modo: (item.insumo_id ? 'estoque' : 'manual') as 'estoque' | 'manual',
        insumo_id: item.insumo_id ?? '',
        nome_manual: item.descricao ?? '',
        unidade_dose: (['L', 'KG', 'ML'].includes(item.unidade ?? '') ? item.unidade : 'L') as 'L' | 'KG' | 'ML',
        dose_por_ha: item.dose_por_ha?.toString() ?? '',
      }))
    )
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.talhao_id || !form.tipo) return
    if (!fazendaAtiva) { setErroSalvar('Nenhuma fazenda ativa selecionada'); return }
    setSalvando(true)
    setErroSalvar(null)

    let opId: string
    let estoqueAtual = insumos

    if (editingOp) {
      const { error: updateError } = await supabase
        .from('operacoes')
        .update({ talhao_id: form.talhao_id, tipo: form.tipo, data: form.data, descricao: form.descricao || '' })
        .eq('id', editingOp.id)

      if (updateError) {
        setSalvando(false)
        setErroSalvar(updateError.message)
        return
      }

      // Devolver ao estoque os produtos da operação original (lê saldo fresco do banco)
      for (const item of editingOp.itens_operacao ?? []) {
        if (item.insumo_id && item.quantidade) {
          const { data: estRow } = await supabase
            .from('estoque')
            .select('quantidade_atual')
            .eq('insumo_id', item.insumo_id)
            .single()
          if (estRow) {
            await supabase.from('estoque')
              .update({ quantidade_atual: estRow.quantidade_atual + item.quantidade })
              .eq('insumo_id', item.insumo_id)
          }
        }
      }

      await supabase.from('itens_operacao').delete().eq('operacao_id', editingOp.id)

      // Buscar saldo atualizado antes de deduzir os novos produtos
      const { data: freshEstoque } = await supabase
        .from('estoque')
        .select('insumo_id, quantidade_atual, insumos(id, nome, unidade)')
      estoqueAtual = (freshEstoque ?? []) as unknown as InsumoEstoque[]

      opId = editingOp.id
    } else {
      const { data: op, error: opError } = await supabase
        .from('operacoes')
        .insert({ talhao_id: form.talhao_id, tipo: form.tipo, data: form.data, descricao: form.descricao || '', fonte: 'manual', fazenda_id: fazendaAtiva.id })
        .select()
        .single()

      if (opError || !op) {
        setSalvando(false)
        setErroSalvar(opError?.message ?? 'Erro ao criar operação')
        return
      }

      opId = op.id
    }

    const talhao = talhoes.find(t => t.id === form.talhao_id)
    const areaHa = talhao?.area_ha ?? 1
    const produtosValidos = produtos.filter(p =>
      p.dose_por_ha && (p.modo === 'estoque' ? p.insumo_id : p.nome_manual.trim())
    )

    for (const prod of produtosValidos) {
      const doseHa = parseFloat(prod.dose_por_ha)
      const quantidade = parseFloat((doseHa * areaHa).toFixed(4))

      if (prod.modo === 'estoque') {
        const estoqueItem = estoqueAtual.find(i => i.insumo_id === prod.insumo_id)

        await supabase.from('itens_operacao').insert({
          operacao_id: opId, insumo_id: prod.insumo_id, descricao: null,
          quantidade, dose_por_ha: doseHa, unidade: prod.unidade_dose,
        })

        await supabase.from('movimentacoes_estoque').insert({
          insumo_id: prod.insumo_id, tipo: 'saida', quantidade, data: form.data, origem: 'operacao', operacao_id: opId, fazenda_id: fazendaAtiva.id,
        })

        if (estoqueItem) {
          await supabase.from('estoque')
            .update({ quantidade_atual: Math.max(0, estoqueItem.quantidade_atual - quantidade) })
            .eq('insumo_id', prod.insumo_id)
        }
      } else {
        await supabase.from('itens_operacao').insert({
          operacao_id: opId, insumo_id: null, descricao: prod.nome_manual.trim(),
          quantidade, dose_por_ha: doseHa, unidade: prod.unidade_dose,
        })
      }
    }

    setSalvando(false)
    setModalOpen(false)
    setErroSalvar(null)
    setEditingOp(null)
    setForm({ talhao_id: '', tipo: '', data: new Date().toISOString().split('T')[0], descricao: '' })
    setProdutos([])
    loadData()
  }

  const operacoesFiltradas = filtroTalhao === 'todos'
    ? operacoes
    : operacoes.filter(o => o.talhao_id === filtroTalhao)

  const areaTotal = operacoesFiltradas.reduce((sum, op) => {
    const t = talhoes.find(t => t.id === op.talhao_id)
    return sum + (t?.area_ha ?? 0)
  }, 0)
  const ultimaOpData = operacoesFiltradas[0]?.data
    ? operacoesFiltradas[0].data.slice(0, 10).split('-').reverse().join('/')
    : '—'
  const tiposDistintos = new Set(operacoesFiltradas.map(o => o.tipo)).size

  function abrirNovaOperacao() {
    setEditingOp(null)
    setErroSalvar(null)
    setForm({ talhao_id: '', tipo: '', data: new Date().toISOString().split('T')[0], descricao: '' })
    setProdutos([])
    setModalOpen(true)
  }

  if (loading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operações</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">Histórico de operações no campo</p>
        </div>
        <Button size="sm" className="shrink-0" onClick={abrirNovaOperacao}>
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Nova Operação
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-sm shrink-0">Filtrar por talhão:</Label>
        <Select value={filtroTalhao} onValueChange={handleFiltroTalhao}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {talhoes.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {operacoesFiltradas.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard
            label="Total de Operações"
            value={operacoesFiltradas.length}
            sub={filtroTalhao !== 'todos' ? talhoes.find(t => t.id === filtroTalhao)?.nome : 'todos os talhões'}
            icon={<Tractor className="h-5 w-5" />}
            iconBg="#F0FDF4"
            iconColor="#16A34A"
          />
          <KpiCard
            label="Área Operada"
            value={`${areaTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha`}
            sub="soma das operações filtradas"
            icon={<Layers className="h-5 w-5" />}
            iconBg="#EFF6FF"
            iconColor="#2563EB"
          />
          <KpiCard
            label="Última Operação"
            value={ultimaOpData}
            sub={operacoesFiltradas[0] ? tipoLabel(operacoesFiltradas[0].tipo) : undefined}
            icon={<Calendar className="h-5 w-5" />}
            iconBg="#FFF7ED"
            iconColor="#EA580C"
          />
          <KpiCard
            label="Tipos Distintos"
            value={tiposDistintos}
            sub={tiposDistintos === 1 ? 'tipo de operação' : 'tipos de operação'}
            icon={<BarChart2 className="h-5 w-5" />}
            iconBg="#FAF5FF"
            iconColor="#9333EA"
          />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Talhão</TableHead>
                <TableHead>Produtos Utilizados</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operacoesFiltradas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <Tractor className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">
                          {operacoes.length === 0 ? 'Nenhuma operação registrada' : 'Nenhuma operação nesse talhão'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                          {operacoes.length === 0
                            ? 'Operações chegam via WhatsApp ou você pode registrar manualmente aqui.'
                            : 'Mude o filtro de talhão ou registre uma nova operação.'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {operacoes.length > 0 && filtroTalhao !== 'todos' && (
                          <Button variant="ghost" size="sm" onClick={() => setFiltroTalhao('todos')}>
                            Ver todos os talhões
                          </Button>
                        )}
                        <Button size="sm" onClick={abrirNovaOperacao}>
                          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                          Nova Operação
                        </Button>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : operacoesFiltradas.map(op => (
                <TableRow key={op.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {op.data.slice(0, 10).split('-').reverse().join('/')}
                  </TableCell>
                  <TableCell className="font-medium">{tipoLabel(op.tipo)}</TableCell>
                  <TableCell>{op.talhoes?.nome ?? '—'}</TableCell>
                  <TableCell>
                    {op.itens_operacao && op.itens_operacao.length > 0 ? (
                      <div className="space-y-1">
                        {op.itens_operacao.map(item => {
                          const nome = item.insumos?.nome ?? item.descricao ?? '—'
                          const unid = item.unidade ?? item.insumos?.unidade ?? ''
                          const areaHa = talhoes.find(t => t.id === op.talhao_id)?.area_ha ?? 0
                          const totalQtd = item.dose_por_ha != null && areaHa > 0
                            ? (item.dose_por_ha * areaHa).toFixed(1)
                            : null
                          return (
                            <div key={item.id} className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-xs font-medium">{nome}</span>
                              {item.dose_por_ha != null ? (
                                <>
                                  <span className="text-sm text-foreground">
                                    {item.dose_por_ha} {unid}/ha
                                  </span>
                                  {totalQtd && (
                                    <span className="text-xs font-medium">
                                      total {totalQtd} {unid}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  {item.quantidade} {unid}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {op.descricao || '—'}
                  </TableCell>
                  <TableCell>
                    <FonteLabel fonte={op.fonte} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        aria-label="Editar operação"
                        onClick={() => openEdit(op)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                        aria-label="Excluir operação"
                        onClick={() => handleDelete(op)}
                        disabled={deletando === op.id}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!deleteConfirmOp} onOpenChange={open => { if (!open) setDeleteConfirmOp(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir operação?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Excluir operação de{' '}
            <span className="font-medium text-foreground">{deleteConfirmOp && tipoLabel(deleteConfirmOp.tipo)}</span>{' '}
            em{' '}
            <span className="font-medium text-foreground">{deleteConfirmOp?.talhoes?.nome ?? 'talhão'}</span>?
            {' '}Os produtos utilizados voltarão ao estoque.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOp(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarDeleteOp} disabled={deletando !== null}>
              {deletando !== null ? 'Excluindo…' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modalOpen} onOpenChange={open => { setModalOpen(open); if (!open) { setErroSalvar(null); setEditingOp(null) } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingOp ? 'Editar Operação' : 'Nova Operação'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">

            <div className="space-y-1.5">
              <Label>Talhão</Label>
              <Select value={form.talhao_id} onValueChange={v => setForm(f => ({ ...f, talhao_id: v ?? '' }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar talhão...">
                    {talhoes.find(t => t.id === form.talhao_id)
                      ? `${talhoes.find(t => t.id === form.talhao_id)!.nome} — ${talhoes.find(t => t.id === form.talhao_id)!.area_ha} ha`
                      : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {talhoes.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome} — {t.area_ha} ha
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Tipo de Operação</Label>
              <Select value={form.tipo} onValueChange={v => setForm(f => ({ ...f, tipo: v ?? '' }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar tipo...">
                    {TIPOS_OPERACAO.find(t => t.value === form.tipo)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_OPERACAO.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="data">Data</Label>
              <Input
                id="data"
                type="date"
                value={form.data}
                onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                required
              />
            </div>

            {/* Produtos utilizados */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Produtos Utilizados</Label>
                <Button type="button" size="sm" variant="outline" onClick={addProduto}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Adicionar produto
                </Button>
              </div>

              {produtos.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Nenhum produto adicionado (opcional)</p>
              )}

              {produtos.map((prod, idx) => {
                const talhao = talhoes.find(t => t.id === form.talhao_id)
                const areaHa = talhao?.area_ha ?? 0
                const qtdTotal = prod.dose_por_ha && areaHa
                  ? (parseFloat(prod.dose_por_ha) * areaHa).toFixed(2)
                  : null

                return (
                  <div key={idx} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    {/* Toggle modo + botão remover */}
                    <div className="flex items-center gap-2">
                      <div className="flex rounded-md border overflow-hidden text-xs">
                        <button
                          type="button"
                          onClick={() => setProdutos(p => p.map((x, i) => i === idx ? { ...x, modo: 'estoque', insumo_id: '', nome_manual: '' } : x))}
                          className={`px-2.5 py-1 transition-colors ${prod.modo === 'estoque' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                        >
                          Do estoque
                        </button>
                        <button
                          type="button"
                          onClick={() => setProdutos(p => p.map((x, i) => i === idx ? { ...x, modo: 'manual', insumo_id: '' } : x))}
                          className={`px-2.5 py-1 transition-colors ${prod.modo === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                        >
                          Manual
                        </button>
                      </div>
                      <div className="flex-1" />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeProduto(idx)}
                        className="h-7 w-7 p-0 text-red-400 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Campo de seleção conforme o modo */}
                    {prod.modo === 'estoque' ? (
                      <Select
                        value={prod.insumo_id}
                        onValueChange={v => updateProduto(idx, 'insumo_id', v ?? '')}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Selecionar insumo do estoque...">
                            {insumos.find(i => i.insumo_id === prod.insumo_id)?.insumos.nome}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {insumos.map(i => (
                            <SelectItem key={i.insumo_id} value={i.insumo_id}>
                              {i.insumos.nome}
                              <span className="text-muted-foreground ml-1 text-xs">
                                ({i.quantidade_atual} {i.insumos.unidade})
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="h-8 text-sm"
                        placeholder="Nome do produto…"
                        value={prod.nome_manual}
                        onChange={e => setProdutos(p => p.map((x, i) => i === idx ? { ...x, nome_manual: e.target.value } : x))}
                      />
                    )}

                    {/* Dose por ha + seletor de unidade */}
                    <div className="space-y-1">
                      <Label className="text-xs">Dose por ha</Label>
                      <div className="flex gap-1">
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          className="h-8 text-sm flex-1"
                          placeholder="0"
                          value={prod.dose_por_ha}
                          onChange={e => updateProduto(idx, 'dose_por_ha', e.target.value)}
                        />
                        <div className="flex rounded-md border overflow-hidden text-xs shrink-0">
                          {(['L', 'KG', 'ML'] as const).map(u => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => updateProduto(idx, 'unidade_dose', u)}
                              className={`px-2 py-1 transition-colors ${prod.unidade_dose === u ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                            >
                              {u}/ha
                            </button>
                          ))}
                        </div>
                      </div>
                      {qtdTotal && (
                        <p className="text-xs text-muted-foreground">
                          = <span className="font-semibold text-foreground">
                            {qtdTotal} {prod.unidade_dose}
                          </span> total
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="descricao">Observações (opcional)</Label>
              <Textarea
                id="descricao"
                placeholder="Detalhes da operação…"
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                rows={2}
              />
            </div>

            {erroSalvar && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                Erro ao salvar: {erroSalvar}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setModalOpen(false); setEditingOp(null) }}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando || !form.talhao_id || !form.tipo}>
                {salvando ? 'Salvando…' : editingOp ? 'Salvar alterações' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FonteLabel({ fonte }: { fonte: string }) {
  const map: Record<string, string> = {
    whatsapp: '💬 WhatsApp',
    manual: '✏️ Manual',
    jd: '🚜 John Deere',
    nfe: '📄 NF-e',
  }
  return <span className="text-sm text-muted-foreground">{map[fonte] ?? fonte}</span>
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-32 bg-muted rounded" />
      <div className="h-10 w-48 bg-muted rounded" />
      <div className="h-72 bg-muted rounded-xl" />
    </div>
  )
}
