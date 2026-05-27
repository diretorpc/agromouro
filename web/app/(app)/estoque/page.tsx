'use client'

import { useEffect, useState } from 'react'
import { Package, AlertTriangle, Plus, Pencil, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { Estoque, MovimentacaoEstoque } from '@/lib/types'

type MovimentacaoComFornecedor = MovimentacaoEstoque & { fornecedor_nome?: string; talhao_nome?: string }

const TIPOS: [string, string][] = [
  ['herbicida', 'Herbicida'],
  ['fungicida', 'Fungicida'],
  ['inseticida', 'Inseticida'],
  ['fertilizante_n', 'Fertilizante N'],
  ['fertilizante_p', 'Fertilizante P'],
  ['fertilizante_k', 'Fertilizante K'],
  ['semente', 'Semente'],
  ['combustivel', 'Combustível'],
  ['outro', 'Outro'],
]

const UNIDADES      = ['L', 'KG', 'ml', 't', 'sc', 'un']
const UNIDADES_BASE = new Set(['L', 'KG', 'kg', 'ml', 'ML', 'g', 't', 'sc', 'un', 'UN', 'ha'])

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

export default function EstoquePage() {
  const [estoque, setEstoque] = useState<Estoque[]>([])
  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoComFornecedor[]>([])
  const [loading, setLoading] = useState(true)

  // ajuste
  const [selectedItem, setSelectedItem] = useState<Estoque | null>(null)
  const [ajuste, setAjuste] = useState('')
  const [ajustePreco, setAjustePreco] = useState('')
  const [salvando, setSalvando] = useState(false)

  // editar movimentação
  const [editMov, setEditMov] = useState<MovimentacaoComFornecedor | null>(null)
  const [editMovForm, setEditMovForm] = useState({ tipo: 'entrada' as 'entrada' | 'saida', quantidade: '', data: '' })
  const [salvandoEditMov, setSalvandoEditMov] = useState(false)

  // excluir movimentação
  const [deleteMov, setDeleteMov] = useState<MovimentacaoComFornecedor | null>(null)
  const [deleteMovErro, setDeleteMovErro] = useState<string | null>(null)
  const [deletandoMov, setDeletandoMov] = useState(false)

  // excluir insumo
  const [deleteInsumo, setDeleteInsumo] = useState<Estoque | null>(null)
  const [deleteInsumoErro, setDeleteInsumoErro] = useState<string | null>(null)
  const [deletandoInsumo, setDeletandoInsumo] = useState(false)

  // converter unidade
  const [corrigirItem, setCorrigirItem] = useState<Estoque | null>(null)
  const [corrigirForm, setCorrigirForm] = useState({ novaUnidade: 'L', fator: '' })
  const [salvandoCorrecao, setSalvandoCorrecao] = useState(false)

  // novo insumo
  const [novoDialog, setNovoDialog] = useState(false)
  const [novoForm, setNovoForm] = useState({
    nome: '', tipo: 'herbicida', unidade: 'L',
    quantidade: '0', minimo: '0', preco: '',
  })
  const [salvandoNovo, setSalvandoNovo] = useState(false)

  async function loadData() {
    const [e, movs] = await Promise.all([
      api.get<Estoque[]>('/estoque').catch(() => [] as Estoque[]),
      supabase
        .from('movimentacoes_estoque')
        .select('*, insumos(nome, unidade), operacoes(talhoes(nome))')
        .order('created_at', { ascending: false })
        .limit(100)
        .then(({ data }) => (data ?? []) as MovimentacaoEstoque[]),
    ])

    // busca nomes dos fornecedores para movimentações de NF-e
    const nfeIds = [...new Set(movs.filter(m => m.nota_fiscal_id).map(m => m.nota_fiscal_id!))]
    let fornecedorMap: Record<string, string> = {}
    if (nfeIds.length > 0) {
      const { data: notas } = await supabase
        .from('notas_fiscais').select('id, emitente_nome').in('id', nfeIds)
      fornecedorMap = Object.fromEntries((notas ?? []).map(n => [n.id, n.emitente_nome]))
    }

    setEstoque(e)
    setMovimentacoes(movs.map(m => ({
      ...m,
      fornecedor_nome: m.nota_fiscal_id ? fornecedorMap[m.nota_fiscal_id] : undefined,
      talhao_nome: m.operacoes?.talhoes?.nome ?? undefined,
    })))
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handleAjuste(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedItem) return
    const novaQtd = parseFloat(ajuste)
    if (isNaN(novaQtd)) return
    setSalvando(true)
    const diff = novaQtd - selectedItem.quantidade_atual
    const tipo = diff >= 0 ? 'entrada' : 'saida'
    await supabase.from('movimentacoes_estoque').insert({
      insumo_id: selectedItem.insumo_id,
      tipo,
      quantidade: Math.abs(diff),
      data: new Date().toISOString(),
      origem: 'manual',
    })
    const updatePayload: Record<string, unknown> = { quantidade_atual: novaQtd }
    const novoPreco = parseFloat(ajustePreco)
    if (!isNaN(novoPreco) && novoPreco >= 0) updatePayload.preco_medio_unitario = novoPreco
    await supabase.from('estoque').update(updatePayload).eq('id', selectedItem.id)
    setSalvando(false)
    setSelectedItem(null)
    setAjuste('')
    setAjustePreco('')
    loadData()
  }

  function abrirEditMov(m: MovimentacaoEstoque) {
    setEditMovForm({ tipo: m.tipo, quantidade: String(m.quantidade), data: m.data.slice(0, 10) })
    setEditMov(m)
  }

  async function handleEditMov() {
    if (!editMov) return
    setSalvandoEditMov(true)

    const novaQtd = parseFloat(editMovForm.quantidade) || 0
    const novoTipo = editMovForm.tipo

    // calcula delta no estoque: reverte o efeito antigo, aplica o novo
    let delta = editMov.tipo === 'entrada' ? -editMov.quantidade : editMov.quantidade
    delta += novoTipo === 'entrada' ? novaQtd : -novaQtd

    await supabase.from('movimentacoes_estoque').update({
      tipo: novoTipo,
      quantidade: novaQtd,
      data: editMovForm.data,
    }).eq('id', editMov.id)

    if (delta !== 0) {
      const { data: row } = await supabase
        .from('estoque').select('id, quantidade_atual').eq('insumo_id', editMov.insumo_id).single()
      if (row) {
        await supabase.from('estoque')
          .update({ quantidade_atual: Math.max(0, row.quantidade_atual + delta) })
          .eq('id', row.id)
      }
    }

    setSalvandoEditMov(false)
    setEditMov(null)
    loadData()
  }

  async function handleDeleteMov() {
    if (!deleteMov) return
    setDeletandoMov(true)
    setDeleteMovErro(null)

    const { data: deleted, error } = await supabase
      .from('movimentacoes_estoque').delete().eq('id', deleteMov.id).select('id')

    setDeletandoMov(false)

    if (error) { setDeleteMovErro(`Erro: ${error.message}`); return }
    if (!deleted || deleted.length === 0) {
      setDeleteMovErro('Sem permissão para excluir. Verifique as políticas do banco.')
      return
    }

    // reverte efeito no estoque
    const delta = deleteMov.tipo === 'entrada' ? -deleteMov.quantidade : deleteMov.quantidade
    const { data: row } = await supabase
      .from('estoque').select('id, quantidade_atual').eq('insumo_id', deleteMov.insumo_id).single()
    if (row) {
      await supabase.from('estoque')
        .update({ quantidade_atual: Math.max(0, row.quantidade_atual + delta) })
        .eq('id', row.id)
    }

    setDeleteMov(null)
    loadData()
  }

  async function handleNovoInsumo(e: React.FormEvent) {
    e.preventDefault()
    setSalvandoNovo(true)
    const { data: insumo, error } = await supabase
      .from('insumos')
      .insert({ nome: novoForm.nome.trim(), tipo: novoForm.tipo, unidade: novoForm.unidade })
      .select()
      .single()
    if (insumo && !error) {
      const qtd = parseFloat(novoForm.quantidade) || 0
      await supabase.from('estoque').insert({
        insumo_id: insumo.id,
        quantidade_atual: qtd,
        quantidade_minima_alerta: parseFloat(novoForm.minimo) || 0,
        preco_medio_unitario: parseFloat(novoForm.preco) || 0,
      })
      if (qtd > 0) {
        await supabase.from('movimentacoes_estoque').insert({
          insumo_id: insumo.id,
          tipo: 'entrada',
          quantidade: qtd,
          data: new Date().toISOString(),
          origem: 'manual',
        })
      }
    }
    setSalvandoNovo(false)
    setNovoDialog(false)
    setNovoForm({ nome: '', tipo: 'herbicida', unidade: 'L', quantidade: '0', minimo: '0', preco: '' })
    loadData()
  }

  async function handleDeleteInsumo() {
    if (!deleteInsumo) return
    setDeletandoInsumo(true)
    setDeleteInsumoErro(null)
    const { error } = await supabase.from('insumos').delete().eq('id', deleteInsumo.insumo_id)
    setDeletandoInsumo(false)
    if (error) { setDeleteInsumoErro(`Erro: ${error.message}`); return }
    setDeleteInsumo(null)
    loadData()
  }

  async function handleCorrecaoUnidade(e: React.FormEvent) {
    e.preventDefault()
    if (!corrigirItem) return
    const fator = parseFloat(corrigirForm.fator.replace(',', '.'))
    if (isNaN(fator) || fator <= 0) return
    setSalvandoCorrecao(true)

    const novaQtd   = parseFloat((corrigirItem.quantidade_atual * fator).toFixed(3))
    const novoPreco = corrigirItem.preco_medio_unitario > 0
      ? parseFloat((corrigirItem.preco_medio_unitario / fator).toFixed(4))
      : 0

    await supabase.from('insumos').update({ unidade: corrigirForm.novaUnidade }).eq('id', corrigirItem.insumo_id)
    await supabase.from('estoque').update({
      quantidade_atual: novaQtd,
      ...(novoPreco > 0 ? { preco_medio_unitario: novoPreco } : {}),
    }).eq('id', corrigirItem.id)
    await supabase.from('movimentacoes_estoque').insert({
      insumo_id: corrigirItem.insumo_id,
      tipo:      'entrada',
      quantidade: novaQtd,
      data:      new Date().toISOString().split('T')[0],
      origem:    'correcao_unidade',
    })

    setSalvandoCorrecao(false)
    setCorrigirItem(null)
    setCorrigirForm({ novaUnidade: 'L', fator: '' })
    loadData()
  }

  const criticos = estoque.filter(e => e.quantidade_atual <= e.quantidade_minima_alerta)

  if (loading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Estoque</h1>
        <div className="flex items-center gap-3">
          {criticos.length > 0 && (
            <div className="flex items-center gap-1.5 text-red-600 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              {criticos.length} insumo{criticos.length > 1 ? 's' : ''} crítico{criticos.length > 1 ? 's' : ''}
            </div>
          )}
          <Button size="sm" onClick={() => setNovoDialog(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Novo Insumo
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Insumos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Qtd. Atual</TableHead>
                <TableHead className="text-right">Preço Médio</TableHead>
                <TableHead className="text-right">Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {estoque.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhum insumo cadastrado.
                  </TableCell>
                </TableRow>
              ) : estoque.map(item => {
                const negativo = item.quantidade_atual < 0
                const critico  = !negativo && item.quantidade_atual <= item.quantidade_minima_alerta
                const linhaBg  = negativo ? 'bg-red-100' : critico ? 'bg-red-50/50' : ''
                const qtdClass = negativo
                  ? 'text-right font-bold text-red-700'
                  : critico
                    ? 'text-right font-semibold text-red-600'
                    : 'text-right font-semibold'
                return (
                  <TableRow key={item.id} className={linhaBg}>
                    <TableCell className={`font-medium ${negativo ? 'font-bold' : ''}`}>
                      {item.insumos.nome}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground capitalize">{item.insumos.tipo}</span>
                    </TableCell>
                    <TableCell className={qtdClass}>
                      {item.quantidade_atual} {item.insumos.unidade}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {item.preco_medio_unitario > 0
                        ? `R$ ${item.preco_medio_unitario.toFixed(2)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {negativo ? (
                        <Badge variant="destructive" className="font-bold">Negativo</Badge>
                      ) : critico ? (
                        <Badge variant="destructive">Crítico</Badge>
                      ) : (
                        <Badge variant="outline" className="text-green-700 border-green-200">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!UNIDADES_BASE.has(item.insumos.unidade) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-amber-600 border-amber-300 hover:bg-amber-50 text-xs"
                            onClick={() => {
                              setCorrigirItem(item)
                              setCorrigirForm({ novaUnidade: 'L', fator: '' })
                            }}
                          >
                            Converter
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedItem(item)
                            setAjuste(String(item.quantidade_atual))
                            setAjustePreco(item.preco_medio_unitario > 0 ? String(item.preco_medio_unitario) : '')
                          }}
                        >
                          Ajustar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Excluir insumo"
                          onClick={() => setDeleteInsumo(item)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de Movimentações</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Insumo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {movimentacoes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhuma movimentação registrada.
                  </TableCell>
                </TableRow>
              ) : movimentacoes.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.data.slice(0, 10).split('-').reverse().join('/')}
                  </TableCell>
                  <TableCell className="font-medium">{m.insumos.nome}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={m.tipo === 'entrada' ? 'text-green-700 border-green-200' : 'text-red-600 border-red-200'}
                    >
                      {m.tipo === 'entrada' ? '+ entrada' : '− saída'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {m.quantidade} {m.insumos.unidade}
                  </TableCell>
                  <TableCell>
                    <OrigemLabel origem={m.origem} fornecedor={m.fornecedor_nome} talhao={m.talhao_nome} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button size="sm" variant="ghost" title="Editar" onClick={() => abrirEditMov(m)}>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Excluir" onClick={() => { setDeleteMov(m); setDeleteMovErro(null) }}>
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog: Converter Unidade */}
      <Dialog open={!!corrigirItem} onOpenChange={open => { if (!open) setCorrigirItem(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Converter Unidade</DialogTitle>
          </DialogHeader>
          {corrigirItem && (
            <form onSubmit={handleCorrecaoUnidade} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Produto: <span className="font-medium text-foreground">{corrigirItem.insumos.nome}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Situação atual:{' '}
                <span className="font-semibold text-amber-600">
                  {corrigirItem.quantidade_atual} {corrigirItem.insumos.unidade}
                </span>
              </p>
              <div className="space-y-1.5">
                <Label>Nova unidade</Label>
                <select
                  className={SELECT_CLASS}
                  value={corrigirForm.novaUnidade}
                  onChange={e => setCorrigirForm(f => ({ ...f, novaUnidade: e.target.value }))}
                >
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fator">
                  Quantos <span className="font-semibold">{corrigirForm.novaUnidade}</span> tem em 1{' '}
                  <span className="font-semibold">{corrigirItem.insumos.unidade}</span>?
                </Label>
                <Input
                  id="fator"
                  type="number"
                  step="0.001"
                  min="0.001"
                  placeholder="Ex: 20"
                  value={corrigirForm.fator}
                  onChange={e => setCorrigirForm(f => ({ ...f, fator: e.target.value }))}
                  required
                />
              </div>
              {corrigirForm.fator && !isNaN(parseFloat(corrigirForm.fator)) && (
                <p className="text-sm bg-muted rounded px-3 py-2">
                  Resultado:{' '}
                  <span className="font-semibold">
                    {(corrigirItem.quantidade_atual * parseFloat(corrigirForm.fator)).toFixed(2)} {corrigirForm.novaUnidade}
                  </span>
                  {corrigirItem.preco_medio_unitario > 0 && (
                    <> · preço{' '}
                      <span className="font-semibold">
                        R$ {(corrigirItem.preco_medio_unitario / parseFloat(corrigirForm.fator)).toFixed(2)}/{corrigirForm.novaUnidade}
                      </span>
                    </>
                  )}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCorrigirItem(null)}>Cancelar</Button>
                <Button type="submit" disabled={salvandoCorrecao || !corrigirForm.fator}>
                  {salvandoCorrecao ? 'Salvando...' : 'Converter'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Ajustar Estoque */}
      <Dialog open={!!selectedItem} onOpenChange={open => { if (!open) { setSelectedItem(null); setAjustePreco('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar Estoque</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <form onSubmit={handleAjuste} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Produto: <span className="font-medium text-foreground">{selectedItem.insumos.nome}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Quantidade atual:{' '}
                <span className="font-medium text-foreground">
                  {selectedItem.quantidade_atual} {selectedItem.insumos.unidade}
                </span>
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="ajuste">Nova quantidade ({selectedItem.insumos.unidade})</Label>
                <Input
                  id="ajuste"
                  type="number"
                  step="0.01"
                  value={ajuste}
                  onChange={e => setAjuste(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Valores negativos são permitidos (estoque vai aparecer em vermelho).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ajuste-preco">
                  Preço unitário (R$){' '}
                  <span className="text-muted-foreground text-xs">opcional</span>
                </Label>
                <Input
                  id="ajuste-preco"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  value={ajustePreco}
                  onChange={e => setAjustePreco(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setSelectedItem(null); setAjustePreco('') }}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={salvando}>
                  {salvando ? 'Salvando...' : 'Salvar'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar Movimentação */}
      <Dialog open={!!editMov} onOpenChange={open => { if (!open) setEditMov(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Editar Movimentação</DialogTitle></DialogHeader>
          {editMov && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Insumo: <span className="font-medium text-foreground">{editMov.insumos.nome}</span>
              </p>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select
                  className={SELECT_CLASS}
                  value={editMovForm.tipo}
                  onChange={e => setEditMovForm(f => ({ ...f, tipo: e.target.value as 'entrada' | 'saida' }))}
                >
                  <option value="entrada">+ Entrada</option>
                  <option value="saida">− Saída</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Quantidade ({editMov.insumos.unidade})</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={editMovForm.quantidade}
                  onChange={e => setEditMovForm(f => ({ ...f, quantidade: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={editMovForm.data}
                  onChange={e => setEditMovForm(f => ({ ...f, data: e.target.value }))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMov(null)}>Cancelar</Button>
            <Button onClick={handleEditMov} disabled={salvandoEditMov || !editMovForm.quantidade}>
              {salvandoEditMov ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Excluir Movimentação */}
      <Dialog open={!!deleteMov} onOpenChange={open => { if (!open) { setDeleteMov(null); setDeleteMovErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir movimentação?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Será removida a {deleteMov?.tipo === 'entrada' ? 'entrada' : 'saída'} de{' '}
            <span className="font-medium text-foreground">
              {deleteMov?.quantidade} {deleteMov?.insumos.unidade}
            </span>{' '}
            de <span className="font-medium text-foreground">{deleteMov?.insumos.nome}</span>.
            O saldo do estoque será ajustado automaticamente.
          </p>
          {deleteMovErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {deleteMovErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteMov(null); setDeleteMovErro(null) }}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteMov} disabled={deletandoMov}>
              {deletandoMov ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Excluir Insumo */}
      <Dialog open={!!deleteInsumo} onOpenChange={open => { if (!open) { setDeleteInsumo(null); setDeleteInsumoErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir insumo?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso vai remover permanentemente{' '}
            <span className="font-medium text-foreground">{deleteInsumo?.insumos.nome}</span>{' '}
            e todo o seu histórico de movimentações. Esta ação não pode ser desfeita.
          </p>
          {deleteInsumoErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {deleteInsumoErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteInsumo(null); setDeleteInsumoErro(null) }}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteInsumo} disabled={deletandoInsumo}>
              {deletandoInsumo ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Novo Insumo */}
      <Dialog open={novoDialog} onOpenChange={open => { if (!open) setNovoDialog(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Insumo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleNovoInsumo} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome do produto</Label>
              <Input
                id="nome"
                placeholder="Ex: Roundup Original"
                value={novoForm.nome}
                onChange={e => setNovoForm(f => ({ ...f, nome: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tipo">Tipo</Label>
                <select
                  id="tipo"
                  className={SELECT_CLASS}
                  value={novoForm.tipo}
                  onChange={e => setNovoForm(f => ({ ...f, tipo: e.target.value }))}
                >
                  {TIPOS.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unidade">Unidade</Label>
                <select
                  id="unidade"
                  className={SELECT_CLASS}
                  value={novoForm.unidade}
                  onChange={e => setNovoForm(f => ({ ...f, unidade: e.target.value }))}
                >
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quantidade">Qtd. inicial</Label>
                <Input
                  id="quantidade"
                  type="number"
                  step="0.01"
                  min="0"
                  value={novoForm.quantidade}
                  onChange={e => setNovoForm(f => ({ ...f, quantidade: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minimo">Qtd. mínima (alerta)</Label>
                <Input
                  id="minimo"
                  type="number"
                  step="0.01"
                  min="0"
                  value={novoForm.minimo}
                  onChange={e => setNovoForm(f => ({ ...f, minimo: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="preco">Preço médio unitário (R$) <span className="text-muted-foreground text-xs">opcional</span></Label>
              <Input
                id="preco"
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={novoForm.preco}
                onChange={e => setNovoForm(f => ({ ...f, preco: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovoDialog(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvandoNovo}>
                {salvandoNovo ? 'Salvando...' : 'Adicionar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function OrigemLabel({ origem, fornecedor, talhao }: { origem: string; fornecedor?: string; talhao?: string }) {
  if (origem === 'nfe') {
    return (
      <div>
        <p className="text-xs text-muted-foreground">📄 NF-e</p>
        {fornecedor && (
          <Tooltip>
            <TooltipTrigger className="text-xs font-medium text-foreground truncate max-w-[160px] cursor-default block w-full text-left bg-transparent border-0 p-0">
              {fornecedor}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {fornecedor}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }
  if (origem === 'operacao') {
    return (
      <div>
        <p className="text-xs text-muted-foreground">🌾 Operação</p>
        {talhao && (
          <p className="text-xs font-medium text-foreground">{talhao}</p>
        )}
      </div>
    )
  }
  const map: Record<string, string> = {
    whatsapp:         '💬 WhatsApp',
    manual:           '✏️ Manual',
    correcao_unidade: '🔄 Correção',
  }
  return <span className="text-sm text-muted-foreground">{map[origem] ?? origem}</span>
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-28 bg-muted rounded" />
      <div className="h-64 bg-muted rounded-xl" />
      <div className="h-48 bg-muted rounded-xl" />
    </div>
  )
}
