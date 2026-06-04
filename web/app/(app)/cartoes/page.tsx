'use client'

import { useEffect, useRef, useState } from 'react'
import { CreditCard, Upload, Plus, Pencil, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { KpiCard } from '@/components/ui/kpi-card'
import { ActionMenu } from '@/components/ui/action-menu'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { Cartao } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type LancamentoCartao = {
  id: string
  data: string
  descricao: string
  valor: number
  categoria: string | null
  origem: 'cartao' | 'manual'
  cartao_id: string | null
  cartoes: { apelido: string } | null
}

type TransacaoPreview = {
  dedupHash: string
  data: string
  descricao: string
  valor: number
  categoria: string
  incluir: boolean
  ja_importado: boolean
  cartao_id: string | null
}

type GrupoPreview = {
  cartao_id: string | null
  transacoes: TransacaoPreview[]
}

type PreviewData = {
  total: number
  ja_importados: number
  grupos: Record<string, {
    cartao_id: string | null
    transacoes: Omit<TransacaoPreview, 'cartao_id'>[]
  }>
}

type CartaoForm = { apelido: string; bandeira: string; responsavel: string }
type ManualForm = { data: string; descricao: string; valor: string; categoria: string; cartao_id: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIAS = [
  { value: 'peca_maquina', label: 'Peça de Máquina' },
  { value: 'manutencao',   label: 'Manutenção' },
  { value: 'alimentacao',  label: 'Alimentação' },
  { value: 'combustivel',  label: 'Combustível' },
  { value: 'servico',      label: 'Serviço' },
  { value: 'mercado',      label: 'Mercado' },
  { value: 'veterinario',  label: 'Veterinário' },
  { value: 'farmacia',     label: 'Farmácia' },
  { value: 'predial',      label: 'Predial' },
  { value: 'ferragens',    label: 'Ferragens' },
  { value: 'tejuco_gado',  label: 'Tejuco Gado' },
  { value: 'pedagio',      label: 'Pedágio' },
  { value: 'outros',       label: 'Outros' },
]

const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIAS.map(c => [c.value, c.label]))

const CAT_STYLE: Record<string, string> = {
  peca_maquina: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  manutencao:   'bg-pink-100 text-pink-700 border-pink-200',
  alimentacao:  'bg-orange-100 text-orange-700 border-orange-200',
  combustivel:  'bg-blue-100 text-blue-700 border-blue-200',
  servico:      'bg-purple-100 text-purple-700 border-purple-200',
  mercado:      'bg-green-100 text-green-700 border-green-200',
  veterinario:  'bg-teal-100 text-teal-700 border-teal-200',
  farmacia:     'bg-red-100 text-red-700 border-red-200',
  predial:      'bg-yellow-100 text-yellow-700 border-yellow-200',
  ferragens:    'bg-amber-100 text-amber-700 border-amber-200',
  tejuco_gado:  'bg-lime-100 text-lime-700 border-lime-200',
  pedagio:      'bg-cyan-100 text-cyan-700 border-cyan-200',
  outros:       'bg-gray-100 text-gray-700 border-gray-200',
}

const FORM_CARTAO_VAZIO: CartaoForm = { apelido: '', bandeira: '', responsavel: '' }

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00').toLocaleDateString('pt-BR')
}

function mesLabel(iso: string) {
  return new Date(iso + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CartoesPage() {
  const [cartoes, setCartoes]     = useState<Cartao[]>([])
  const [lancamentos, setLancamentos] = useState<LancamentoCartao[]>([])
  const [loading, setLoading]     = useState(true)
  const [uploadando, setUploadando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando]   = useState(false)
  const [erroGeral, setErroGeral] = useState<string | null>(null)

  // Preview state
  const [previewOpen, setPreviewOpen]   = useState(false)
  const [previewMeta, setPreviewMeta]   = useState<{ total: number; ja_importados: number } | null>(null)
  const [previewGrupos, setPreviewGrupos] = useState<Record<string, GrupoPreview>>({})

  // Dialog states
  const [addCartaoDialog, setAddCartaoDialog] = useState(false)
  const [editCartao, setEditCartao]           = useState<Cartao | null>(null)
  const [deleteCartao, setDeleteCartao]       = useState<Cartao | null>(null)
  const [deleteErro, setDeleteErro]           = useState<string | null>(null)
  const [manualDialog, setManualDialog]       = useState(false)

  // Form states
  const [cartaoForm, setCartaoForm] = useState<CartaoForm>(FORM_CARTAO_VAZIO)
  const [manualForm, setManualForm] = useState<ManualForm>({
    data: new Date().toISOString().slice(0, 10),
    descricao: '',
    valor: '',
    categoria: 'outros',
    cartao_id: '',
  })

  const fileRef = useRef<HTMLInputElement>(null)

  // ─── Data loading ───────────────────────────────────────────────────────────

  async function load() {
    try {
      const [cartoesData, lancResult] = await Promise.all([
        api.get<Cartao[]>('/cartoes'),
        supabase
          .from('lancamentos_financeiros')
          .select('id, data, descricao, valor, categoria, origem, cartao_id, cartoes(apelido)')
          .in('origem', ['cartao', 'manual'])
          .order('data', { ascending: false })
          .limit(200),
      ])
      if (lancResult.error) throw lancResult.error
      setCartoes(cartoesData)
      setLancamentos((lancResult.data ?? []) as unknown as LancamentoCartao[])
    } catch {
      setErroGeral('Erro ao carregar dados. Recarregue a página.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ─── File upload ────────────────────────────────────────────────────────────

  function handleFileSelect(file: File) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setErroGeral('Selecione um arquivo .xlsx válido.')
      return
    }
    setUploadando(true)
    setErroGeral(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const result = e.target?.result as string
        const commaIdx = result?.indexOf(',') ?? -1
        if (commaIdx === -1) {
          setErroGeral('Falha ao ler o arquivo. Tente novamente.')
          setUploadando(false)
          return
        }
        const base64 = result.slice(commaIdx + 1)
        const data = await api.post<PreviewData>('/cartoes/importar-preview', { arquivo: base64 })
        const grupos: Record<string, GrupoPreview> = {}
        for (const [titular, grupo] of Object.entries(data.grupos)) {
          grupos[titular] = {
            cartao_id: grupo.cartao_id,
            transacoes: grupo.transacoes.map(t => ({ ...t, cartao_id: grupo.cartao_id })),
          }
        }
        setPreviewGrupos(grupos)
        setPreviewMeta({ total: data.total, ja_importados: data.ja_importados })
        setPreviewOpen(true)
      } catch {
        setErroGeral('Erro ao processar o arquivo. Verifique se é o relatório correto do banco.')
      } finally {
        setUploadando(false)
      }
    }
    reader.readAsDataURL(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
    e.target.value = ''
  }

  // ─── Preview actions ────────────────────────────────────────────────────────

  function toggleTransacao(titular: string, hash: string, incluir: boolean) {
    setPreviewGrupos(prev => ({
      ...prev,
      [titular]: {
        ...prev[titular],
        transacoes: prev[titular].transacoes.map(t =>
          t.dedupHash === hash ? { ...t, incluir } : t
        ),
      },
    }))
  }

  function setCategoria(titular: string, hash: string, categoria: string) {
    setPreviewGrupos(prev => ({
      ...prev,
      [titular]: {
        ...prev[titular],
        transacoes: prev[titular].transacoes.map(t =>
          t.dedupHash === hash ? { ...t, categoria } : t
        ),
      },
    }))
  }

  async function handleConfirmar() {
    const payload = Object.values(previewGrupos)
      .flatMap(g => g.transacoes)
      .filter(t => t.incluir && !t.ja_importado && t.cartao_id !== null)
      .map(t => ({
        dedupHash:  t.dedupHash,
        cartao_id:  t.cartao_id!,
        data:       t.data,
        descricao:  t.descricao,
        valor:      t.valor,
        categoria:  t.categoria,
        incluir:    true,
      }))

    if (payload.length === 0) return
    setConfirmando(true)
    try {
      await api.post('/cartoes/confirmar-importacao', payload)
      setPreviewOpen(false)
      setPreviewGrupos({})
      setPreviewMeta(null)
      load()
    } catch {
      setErroGeral('Erro ao confirmar importação. Tente novamente.')
    } finally {
      setConfirmando(false)
    }
  }

  // ─── Cartão CRUD ────────────────────────────────────────────────────────────

  async function handleAddCartao() {
    setSalvando(true)
    try {
      await api.post('/cartoes', {
        apelido:         cartaoForm.apelido.trim(),
        bandeira: cartaoForm.bandeira || undefined,
        responsavel:     cartaoForm.responsavel.trim() || undefined,
      })
      setAddCartaoDialog(false)
      setCartaoForm(FORM_CARTAO_VAZIO)
      load()
    } catch {
      setErroGeral('Erro ao salvar cartão. Verifique os dados e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  function abrirEdit(c: Cartao) {
    setCartaoForm({ apelido: c.apelido, bandeira: c.bandeira ?? '', responsavel: c.responsavel ?? '' })
    setEditCartao(c)
  }

  async function handleEditCartao() {
    if (!editCartao) return
    setSalvando(true)
    try {
      await api.put(`/cartoes/${editCartao.id}`, {
        apelido:         cartaoForm.apelido.trim(),
        bandeira: cartaoForm.bandeira || undefined,
        responsavel:     cartaoForm.responsavel.trim() || undefined,
      })
      setEditCartao(null)
      load()
    } catch {
      setErroGeral('Erro ao atualizar cartão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function handleDeleteCartao() {
    if (!deleteCartao) return
    setSalvando(true)
    setDeleteErro(null)
    try {
      await api.del(`/cartoes/${deleteCartao.id}`)
      setDeleteCartao(null)
      load()
    } catch {
      setDeleteErro('Erro ao desativar o cartão.')
    } finally {
      setSalvando(false)
    }
  }

  // ─── Lançamento manual ──────────────────────────────────────────────────────

  function abrirManual(cartaoId = '') {
    setManualForm({
      data:      new Date().toISOString().slice(0, 10),
      descricao: '',
      valor:     '',
      categoria: 'outros',
      cartao_id: cartaoId,
    })
    setManualDialog(true)
  }

  async function handleManual() {
    const valorNum = parseFloat(manualForm.valor)
    if (!manualForm.descricao.trim() || isNaN(valorNum) || valorNum <= 0 || !manualForm.cartao_id) return
    setSalvando(true)
    try {
      await api.post('/cartoes/lancamento', {
        data:      manualForm.data,
        descricao: manualForm.descricao.trim(),
        valor:     valorNum,
        categoria: manualForm.categoria,
        cartao_id: manualForm.cartao_id,
      })
      setManualDialog(false)
      load()
    } catch {
      setErroGeral('Erro ao salvar lançamento. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  // ─── Derived values ─────────────────────────────────────────────────────────

  const mesAtual = new Date().toISOString().slice(0, 7)
  const gastoMes = lancamentos
    .filter(l => l.data?.startsWith(mesAtual))
    .reduce((s, l) => s + l.valor, 0)

  const allTransacoes = Object.values(previewGrupos).flatMap(g => g.transacoes)
  const selecionadas  = allTransacoes.filter(t => t.incluir && !t.ja_importado)
  const totalSelecionado = selecionadas.reduce((s, t) => s + t.valor, 0)
  const podeConfirmar = selecionadas.length > 0 && selecionadas.every(t => t.cartao_id !== null)

  if (loading) return <PageSkeleton />

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cartões de Crédito</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">
            Importação de extratos e lançamentos manuais
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="file"
            accept=".xlsx"
            ref={fileRef}
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploadando}
          >
            <Upload className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {uploadando ? 'Processando…' : 'Importar Extrato'}
          </Button>
          <Button
            size="sm"
            onClick={() => { setCartaoForm(FORM_CARTAO_VAZIO); setAddCartaoDialog(true) }}
          >
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Cadastrar Cartão
          </Button>
        </div>
      </div>

      {erroGeral && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {erroGeral}
        </p>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Cartões Ativos"
          value={String(cartoes.length)}
          sub={cartoes.length === 0 ? 'Nenhum cadastrado' : cartoes.map(c => c.apelido).join(', ')}
          icon={<CreditCard className="h-5 w-5" />}
          iconBg="rgba(99,102,241,0.12)"
          iconColor="#6366f1"
        />
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
      </div>

      {/* ── Cartões grid ── */}
      {cartoes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CreditCard className="h-10 w-10 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
            <p className="text-sm text-muted-foreground mb-1 font-medium">Nenhum cartão cadastrado</p>
            <p className="text-xs text-muted-foreground mb-4">
              Cadastre os cartões com o mesmo nome do titular no extrato do banco
              (ex: "CC Matheus") para que a importação faça o match automático.
            </p>
            <Button
              size="sm"
              onClick={() => { setCartaoForm(FORM_CARTAO_VAZIO); setAddCartaoDialog(true) }}
            >
              <Plus className="h-4 w-4 mr-1.5" />Cadastrar Cartão
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cartoes.map(cartao => {
            const gastoCartao = lancamentos
              .filter(l => l.cartao_id === cartao.id)
              .reduce((s, l) => s + l.valor, 0)
            const nTransacoes = lancamentos.filter(l => l.cartao_id === cartao.id).length
            return (
              <Card key={cartao.id}>
                <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-base truncate">{cartao.apelido}</p>
                    {cartao.bandeira && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {cartao.bandeira}
                      </p>
                    )}
                  </div>
                  <ActionMenu
                    label="Ações do cartão"
                    items={[
                      {
                        label: '+ Lançamento Manual',
                        icon: <Plus className="h-3.5 w-3.5" aria-hidden="true" />,
                        onClick: () => abrirManual(cartao.id),
                      },
                      {
                        label: 'Editar',
                        icon: <Pencil className="h-3.5 w-3.5" aria-hidden="true" />,
                        onClick: () => abrirEdit(cartao),
                      },
                      {
                        label: 'Desativar',
                        icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
                        onClick: () => { setDeleteErro(null); setDeleteCartao(cartao) },
                        destructive: true,
                      },
                    ]}
                  />
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xl font-bold tabular-nums">{fmtBRL(gastoCartao)}</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-muted-foreground">{nTransacoes} transações</p>
                    {cartao.responsavel && (
                      <p className="text-xs text-muted-foreground">{cartao.responsavel}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Lançamentos recentes ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lançamentos Recentes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Data</TableHead>
                <TableHead>Estabelecimento</TableHead>
                <TableHead className="w-[120px]">Categoria</TableHead>
                <TableHead className="w-[130px]">Cartão</TableHead>
                <TableHead className="w-[80px]">Tipo</TableHead>
                <TableHead className="w-[110px] text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lancamentos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground text-sm">
                    Nenhum lançamento ainda. Importe um extrato ou adicione um lançamento manual.
                  </TableCell>
                </TableRow>
              ) : lancamentos.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {l.data ? fmtDate(l.data) : '—'}
                  </TableCell>
                  <TableCell className="text-sm font-medium max-w-[220px] truncate" title={l.descricao}>
                    {l.descricao}
                  </TableCell>
                  <TableCell>
                    {l.categoria ? (
                      <Badge
                        variant="outline"
                        className={`text-xs capitalize ${CAT_STYLE[l.categoria] ?? CAT_STYLE.outros}`}
                      >
                        {CAT_LABEL[l.categoria] ?? l.categoria}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {l.cartoes?.apelido ? (
                      <Badge variant="secondary" className="text-xs">
                        {l.cartoes.apelido}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {l.origem === 'manual' ? (
                      <span className="text-xs text-muted-foreground italic">Manual</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Importado</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {fmtBRL(l.valor)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Dialog: Cadastrar cartão ── */}
      <Dialog open={addCartaoDialog} onOpenChange={open => { if (!open) setAddCartaoDialog(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cadastrar Cartão</DialogTitle>
          </DialogHeader>
          <CartaoFormFields form={cartaoForm} setForm={setCartaoForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCartaoDialog(false)}>Cancelar</Button>
            <Button
              onClick={handleAddCartao}
              disabled={salvando || !cartaoForm.apelido.trim()}
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Editar cartão ── */}
      <Dialog open={!!editCartao} onOpenChange={open => { if (!open) setEditCartao(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Cartão</DialogTitle>
          </DialogHeader>
          <CartaoFormFields form={cartaoForm} setForm={setCartaoForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCartao(null)}>Cancelar</Button>
            <Button
              onClick={handleEditCartao}
              disabled={salvando || !cartaoForm.apelido.trim()}
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Desativar cartão ── */}
      <Dialog open={!!deleteCartao} onOpenChange={open => { if (!open) { setDeleteCartao(null); setDeleteErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Desativar cartão?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deleteCartao?.apelido}</span> será
            desativado. Os lançamentos existentes não serão afetados.
          </p>
          {deleteErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {deleteErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteCartao(null); setDeleteErro(null) }}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteCartao} disabled={salvando}>
              {salvando ? 'Desativando…' : 'Desativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Lançamento manual ── */}
      <Dialog open={manualDialog} onOpenChange={open => { if (!open) setManualDialog(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançamento Manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={manualForm.data}
                  onChange={e => setManualForm(f => ({ ...f, data: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0,00"
                  value={manualForm.valor}
                  onChange={e => setManualForm(f => ({ ...f, valor: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Estabelecimento</Label>
              <Input
                placeholder="Ex: Ferragem Centro Uberaba"
                value={manualForm.descricao}
                onChange={e => setManualForm(f => ({ ...f, descricao: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select
                  value={manualForm.categoria}
                  onValueChange={v => setManualForm(f => ({ ...f, categoria: v ?? 'outros' }))}
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
                  value={manualForm.cartao_id}
                  onValueChange={v => setManualForm(f => ({ ...f, cartao_id: v ?? '' }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione…" />
                  </SelectTrigger>
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
            <Button variant="outline" onClick={() => setManualDialog(false)}>Cancelar</Button>
            <Button
              onClick={handleManual}
              disabled={
                salvando ||
                !manualForm.descricao.trim() ||
                !manualForm.valor ||
                parseFloat(manualForm.valor) <= 0 ||
                !manualForm.cartao_id
              }
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Preview de importação ── */}
      <Dialog open={previewOpen} onOpenChange={open => { if (!open && !confirmando) setPreviewOpen(false) }}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Prévia da Importação</DialogTitle>
            {previewMeta && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {previewMeta.total} transações encontradas
                {previewMeta.ja_importados > 0 && (
                  <> · <span className="text-yellow-600">{previewMeta.ja_importados} já importadas (desmarcadas)</span></>
                )}
              </p>
            )}
          </DialogHeader>

          <div className="overflow-y-auto space-y-6 py-2" style={{ maxHeight: '58vh' }}>
            {Object.entries(previewGrupos).map(([titular, grupo]) => (
              <div key={titular}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="font-semibold text-sm">{titular}</span>
                  <Badge variant="outline" className="text-xs">
                    {grupo.transacoes.length} transações
                  </Badge>
                  {grupo.cartao_id === null && (
                    <Badge variant="destructive" className="text-xs">
                      Cartão não cadastrado — cadastre antes de importar
                    </Badge>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8 px-2" />
                      <TableHead className="w-[72px]">Data</TableHead>
                      <TableHead>Estabelecimento</TableHead>
                      <TableHead className="w-[100px] text-right">Valor</TableHead>
                      <TableHead className="w-[148px]">Categoria</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grupo.transacoes.map(t => {
                      const desabilitado = t.ja_importado || grupo.cartao_id === null
                      return (
                        <TableRow
                          key={t.dedupHash}
                          className={desabilitado ? 'opacity-50' : undefined}
                        >
                          <TableCell className="px-2">
                            <input
                              type="checkbox"
                              checked={t.incluir}
                              onChange={e => toggleTransacao(titular, t.dedupHash, e.target.checked)}
                              disabled={desabilitado}
                              className="h-4 w-4 rounded border-gray-300 accent-green-600"
                              aria-label={`Incluir ${t.descricao}`}
                            />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {fmtDate(t.data)}
                          </TableCell>
                          <TableCell className="text-sm max-w-[240px]">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate">{t.descricao}</span>
                              {t.ja_importado && (
                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                  Já importado
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums font-medium">
                            {fmtBRL(t.valor)}
                          </TableCell>
                          <TableCell>
                            <select
                              value={t.categoria}
                              onChange={e => setCategoria(titular, t.dedupHash, e.target.value)}
                              disabled={desabilitado}
                              className="h-7 text-xs border border-input rounded px-1.5 bg-background w-full"
                            >
                              {CATEGORIAS.map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>

          <div className="border-t pt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{selecionadas.length}</span> selecionadas
              {' · '}
              <span className="font-semibold text-foreground">{fmtBRL(totalSelecionado)}</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPreviewOpen(false)}
                disabled={confirmando}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmar}
                disabled={!podeConfirmar || confirmando}
              >
                {confirmando ? 'Importando…' : 'Confirmar Importação'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function CartaoFormFields({
  form,
  setForm,
}: {
  form: CartaoForm
  setForm: React.Dispatch<React.SetStateAction<CartaoForm>>
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Apelido</Label>
        <Input
          placeholder="Ex: CC Matheus (igual ao nome no extrato)"
          value={form.apelido}
          onChange={e => setForm(f => ({ ...f, apelido: e.target.value }))}
        />
        <p className="text-xs text-muted-foreground">
          Use exatamente o mesmo texto que aparece na coluna "Titular" do arquivo XLSX.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Bandeira</Label>
          <Select value={form.bandeira} onValueChange={v => setForm(f => ({ ...f, bandeira: v ?? '' }))}>
            <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Visa">Visa</SelectItem>
              <SelectItem value="Mastercard">Mastercard</SelectItem>
              <SelectItem value="Elo">Elo</SelectItem>
              <SelectItem value="American Express">American Express</SelectItem>
              <SelectItem value="Hipercard">Hipercard</SelectItem>
              <SelectItem value="Outra">Outra</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Responsável</Label>
          <Input
            placeholder="Nome do titular"
            value={form.responsavel}
            onChange={e => setForm(f => ({ ...f, responsavel: e.target.value }))}
          />
        </div>
      </div>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-52 bg-muted rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 bg-muted rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-muted rounded-xl" />
    </div>
  )
}
