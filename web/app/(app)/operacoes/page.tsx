'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
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
import type { Operacao, Talhao } from '@/lib/types'

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
  const [operacoes, setOperacoes] = useState<Operacao[]>([])
  const [talhoes, setTalhoes] = useState<Talhao[]>([])
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

  async function loadData() {
    const [resOps, resTalhoes] = await Promise.all([
      supabase.from('operacoes').select('*, talhoes(nome)').order('data', { ascending: false }).limit(50),
      supabase.from('talhoes').select('*').order('nome'),
    ])
    if (resOps.error) console.error('[Operações] Erro ao carregar operações:', resOps.error)
    if (resTalhoes.error) console.error('[Operações] Erro ao carregar talhões:', resTalhoes.error)
    console.log('[Operações] Talhões carregados:', resTalhoes.data)
    setOperacoes((resOps.data ?? []) as Operacao[])
    setTalhoes((resTalhoes.data ?? []) as Talhao[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.talhao_id || !form.tipo) return
    setSalvando(true)
    setErroSalvar(null)

    const { error } = await supabase.from('operacoes').insert({
      talhao_id: form.talhao_id,
      tipo: form.tipo,
      data: form.data,
      descricao: form.descricao || '',
      fonte: 'manual',
    })

    setSalvando(false)

    if (error) {
      console.error('[Operações] Erro ao criar:', error)
      setErroSalvar(error.message)
      return
    }

    setModalOpen(false)
    setErroSalvar(null)
    setForm({ talhao_id: '', tipo: '', data: new Date().toISOString().split('T')[0], descricao: '' })
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
        <Button size="sm" onClick={() => setModalOpen(true)}>
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
                <TableHead>Descrição</TableHead>
                <TableHead>Fonte</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operacoesFiltradas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
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
        <DialogContent>
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
                    <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
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

            <div className="space-y-1.5">
              <Label htmlFor="descricao">Descrição (opcional)</Label>
              <Textarea
                id="descricao"
                placeholder="Detalhes da operação..."
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                rows={3}
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
