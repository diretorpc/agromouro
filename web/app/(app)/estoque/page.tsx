'use client'

import { useEffect, useState } from 'react'
import { Package, AlertTriangle, Plus } from 'lucide-react'
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
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { Estoque, MovimentacaoEstoque } from '@/lib/types'

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

const UNIDADES = ['L', 'kg', 't', 'sc', 'un', 'cx', 'bag']

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

export default function EstoquePage() {
  const [estoque, setEstoque] = useState<Estoque[]>([])
  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoEstoque[]>([])
  const [loading, setLoading] = useState(true)

  // ajuste
  const [selectedItem, setSelectedItem] = useState<Estoque | null>(null)
  const [ajuste, setAjuste] = useState('')
  const [salvando, setSalvando] = useState(false)

  // novo insumo
  const [novoDialog, setNovoDialog] = useState(false)
  const [novoForm, setNovoForm] = useState({
    nome: '', tipo: 'herbicida', unidade: 'L',
    quantidade: '0', minimo: '0', preco: '',
  })
  const [salvandoNovo, setSalvandoNovo] = useState(false)

  async function loadData() {
    const [e, m] = await Promise.all([
      api.get<Estoque[]>('/estoque').catch(() => [] as Estoque[]),
      supabase
        .from('movimentacoes_estoque')
        .select('*, insumos(nome, unidade)')
        .order('data', { ascending: false })
        .limit(50)
        .then(({ data }) => (data ?? []) as MovimentacaoEstoque[]),
    ])
    setEstoque(e)
    setMovimentacoes(m)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handleAjuste(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedItem) return
    const novaQtd = parseFloat(ajuste)
    if (isNaN(novaQtd) || novaQtd < 0) return
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
    await supabase.from('estoque').update({ quantidade_atual: novaQtd }).eq('id', selectedItem.id)
    setSalvando(false)
    setSelectedItem(null)
    setAjuste('')
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
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead className="text-right">Preço Médio</TableHead>
                <TableHead className="text-right">Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {estoque.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhum insumo cadastrado.
                  </TableCell>
                </TableRow>
              ) : estoque.map(item => {
                const critico = item.quantidade_atual <= item.quantidade_minima_alerta
                return (
                  <TableRow key={item.id} className={critico ? 'bg-red-50/50' : ''}>
                    <TableCell className="font-medium">{item.insumos.nome}</TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground capitalize">{item.insumos.tipo}</span>
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${critico ? 'text-red-600' : ''}`}>
                      {item.quantidade_atual} {item.insumos.unidade}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {item.quantidade_minima_alerta} {item.insumos.unidade}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {item.preco_medio_unitario > 0
                        ? `R$ ${item.preco_medio_unitario.toFixed(2)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {critico ? (
                        <Badge variant="destructive">Crítico</Badge>
                      ) : (
                        <Badge variant="outline" className="text-green-700 border-green-200">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setSelectedItem(item); setAjuste(String(item.quantidade_atual)) }}
                      >
                        Ajustar
                      </Button>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {movimentacoes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Nenhuma movimentação registrada.
                  </TableCell>
                </TableRow>
              ) : movimentacoes.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(m.data).toLocaleDateString('pt-BR')}
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
                    <OrigemLabel origem={m.origem} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog: Ajustar Estoque */}
      <Dialog open={!!selectedItem} onOpenChange={open => { if (!open) setSelectedItem(null) }}>
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
                  min="0"
                  value={ajuste}
                  onChange={e => setAjuste(e.target.value)}
                  required
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSelectedItem(null)}>
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

function OrigemLabel({ origem }: { origem: string }) {
  const map: Record<string, string> = { nfe: '📄 NF-e', whatsapp: '💬 WhatsApp', manual: '✏️ Manual' }
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
