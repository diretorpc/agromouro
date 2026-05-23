'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
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
  unidade_manual: string
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
  const [modalOpen, setModalOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

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
        .select('*, talhoes(nome), itens_operacao(id, quantidade, dose_por_ha, unidade, insumos(nome, unidade))')
        .order('data', { ascending: false })
        .limit(50),
      supabase.from('talhoes').select('*').order('nome'),
      supabase.from('estoque').select('insumo_id, quantidade_atual, insumos(id, nome, unidade)').order('insumos(nome)'),
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

  function addProduto() {
    setProdutos(p => [...p, { modo: 'estoque', insumo_id: '', nome_manual: '', unidade_manual: '', dose_por_ha: '' }])
  }

  function removeProduto(idx: number) {
    setProdutos(p => p.filter((_, i) => i !== idx))
  }

  function updateProduto(idx: number, field: keyof ProdutoForm, value: string) {
    setProdutos(p => p.map((prod, i) => i === idx ? { ...prod, [field]: value } : prod))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.talhao_id || !form.tipo) return
    setSalvando(true)
    setErroSalvar(null)

    const { data: op, error: opError } = await supabase
      .from('operacoes')
      .insert({
        talhao_id: form.talhao_id,
        tipo: form.tipo,
        data: form.data,
        descricao: form.descricao || '',
        fonte: 'manual',
      })
      .select()
      .single()

    if (opError || !op) {
      setSalvando(false)
      setErroSalvar(opError?.message ?? 'Erro ao criar operação')
      return
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
        const estoqueItem = insumos.find(i => i.insumo_id === prod.insumo_id)
        const unidade = estoqueItem?.insumos.unidade ?? ''

        await supabase.from('itens_operacao').insert({
          operacao_id: op.id,
          insumo_id: prod.insumo_id,
          descricao: null,
          quantidade,
          dose_por_ha: doseHa,
          unidade,
        })

        await supabase.from('movimentacoes_estoque').insert({
          insumo_id: prod.insumo_id,
          tipo: 'saida',
          quantidade,
          data: form.data,
          origem: 'manual',
        })

        if (estoqueItem) {
          await supabase.from('estoque')
            .update({ quantidade_atual: Math.max(0, estoqueItem.quantidade_atual - quantidade) })
            .eq('insumo_id', prod.insumo_id)
        }
      } else {
        // produto manual — só registra, sem mexer no estoque
        await supabase.from('itens_operacao').insert({
          operacao_id: op.id,
          insumo_id: null,
          descricao: prod.nome_manual.trim(),
          quantidade,
          dose_por_ha: doseHa,
          unidade: prod.unidade_manual.trim() || null,
        })
      }
    }

    setSalvando(false)
    setModalOpen(false)
    setErroSalvar(null)
    setForm({ talhao_id: '', tipo: '', data: new Date().toISOString().split('T')[0], descricao: '' })
    setProdutos([])
    loadData()
  }

  const operacoesFiltradas = filtroTalhao === 'todos'
    ? operacoes
    : operacoes.filter(o => o.talhao_id === filtroTalhao)

  if (loading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Operações</h1>
        <Button size="sm" onClick={() => { setForm({ talhao_id: '', tipo: '', data: new Date().toISOString().split('T')[0], descricao: '' }); setProdutos([]); setModalOpen(true) }}>
          <Plus className="h-4 w-4 mr-1.5" />
          Nova Operação
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-sm shrink-0">Filtrar por talhão:</Label>
        <Select value={filtroTalhao} onValueChange={v => setFiltroTalhao(v ?? 'todos')}>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {operacoesFiltradas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nenhuma operação encontrada.
                  </TableCell>
                </TableRow>
              ) : operacoesFiltradas.map(op => (
                <TableRow key={op.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(op.data).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="font-medium">{tipoLabel(op.tipo)}</TableCell>
                  <TableCell>{op.talhoes?.nome ?? '—'}</TableCell>
                  <TableCell>
                    {op.itens_operacao && op.itens_operacao.length > 0 ? (
                      <div className="space-y-0.5">
                        {op.itens_operacao.map(item => {
                          const nome = item.insumos?.nome ?? item.descricao ?? '—'
                          const unid = item.unidade ?? item.insumos?.unidade ?? ''
                          return (
                            <div key={item.id} className="text-xs">
                              <span className="font-medium">{nome}</span>
                              <span className="text-muted-foreground ml-1.5">
                                {item.dose_por_ha != null
                                  ? `${item.dose_por_ha} ${unid}/ha`
                                  : `${item.quantidade} ${unid}`}
                              </span>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={open => { setModalOpen(open); if (!open) setErroSalvar(null) }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Operação</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">

            <div className="space-y-1.5">
              <Label>Talhão</Label>
              <Select value={form.talhao_id} onValueChange={v => setForm(f => ({ ...f, talhao_id: v ?? '' }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar talhão..." />
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
                  <SelectValue placeholder="Selecionar tipo..." />
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
                const estoqueItem = insumos.find(i => i.insumo_id === prod.insumo_id)
                const talhao = talhoes.find(t => t.id === form.talhao_id)
                const areaHa = talhao?.area_ha ?? 0
                const unidade = prod.modo === 'estoque'
                  ? (estoqueItem?.insumos.unidade ?? '—')
                  : (prod.unidade_manual || '—')
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
                          onClick={() => setProdutos(p => p.map((x, i) => i === idx ? { ...x, modo: 'estoque', insumo_id: '', nome_manual: '', unidade_manual: '' } : x))}
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
                          <SelectValue placeholder="Selecionar insumo do estoque..." />
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
                      <div className="flex gap-2">
                        <Input
                          className="h-8 text-sm flex-1"
                          placeholder="Nome do produto..."
                          value={prod.nome_manual}
                          onChange={e => setProdutos(p => p.map((x, i) => i === idx ? { ...x, nome_manual: e.target.value } : x))}
                        />
                        <Input
                          className="h-8 text-sm w-20"
                          placeholder="Unid."
                          value={prod.unidade_manual}
                          onChange={e => setProdutos(p => p.map((x, i) => i === idx ? { ...x, unidade_manual: e.target.value } : x))}
                        />
                      </div>
                    )}

                    {/* Dose por ha + total */}
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Dose por ha ({unidade}/ha)</Label>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          className="h-8 text-sm"
                          placeholder="0"
                          value={prod.dose_por_ha}
                          onChange={e => updateProduto(idx, 'dose_por_ha', e.target.value)}
                        />
                      </div>
                      {qtdTotal && (
                        <p className="text-xs text-muted-foreground pb-2">
                          = <span className="font-semibold text-foreground">
                            {qtdTotal} {unidade}
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
                placeholder="Detalhes da operação..."
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
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando || !form.talhao_id || !form.tipo}>
                {salvando ? 'Salvando...' : 'Salvar'}
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
