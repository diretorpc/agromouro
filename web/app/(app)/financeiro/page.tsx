'use client'

import { useEffect, useState } from 'react'

function setUrlParam(key: string, value: string, dflt = 'todos') {
  const p = new URLSearchParams(window.location.search)
  if (!value || value === dflt) p.delete(key)
  else p.set(key, value)
  window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname)
}
import { DollarSign, TrendingDown, Package, Filter, Plus, Pencil, Trash2, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react'
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
import { useFazenda } from '@/context/fazenda-context'

type ItemFinanceiro = {
  id: string
  source_table: 'itens_nfe' | 'lancamentos_financeiros'
  descricao: string
  quantidade: number
  unidade: string
  valor_unitario: number
  valor_total: number
  centro_custo: string
  insumo_id: string | null
  nota_numero: string | null
  emitente_nome: string
  data_emissao: string
  is_manual: boolean
  // 'conta' = gasto que veio de uma conta a pagar marcada como paga.
  origem: 'nfe' | 'cartao' | 'manual' | 'conta' | null
  cartao_apelido: string | null
  // Gravado pelo processador da NF-e (migration 008), a partir de 04/08/2026.
  // NULO = item de antes da coluna existir, ou lançamento manual/cartão — conta
  // como gasto igual sempre contou. Só `false` explícito tira o item da soma.
  conta_como_compra: boolean | null
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
  { value: 'rh',          label: 'Mão de Obra (RH)' },
  { value: 'outro',       label: 'Outro' },
  { value: 'manutencao',  label: 'Manutenção' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'outros',      label: 'Outros (cartão)' },
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
  // ── Insumos agrícolas ─────────────────────────────────────
  herbicida:          '#C2410C',  // laranja-terra (orange-700)
  fungicida:          '#7C3AED',  // violeta (violet-600)
  inseticida:         '#DC2626',  // vermelho (red-600)
  adjuvante:          '#0891B2',  // ciano (cyan-600)
  biologico:          '#059669',  // esmeralda (emerald-600)
  fertilizante_n:     '#15803D',  // verde (green-700)
  fertilizante_p:     '#4D7C0F',  // lima escuro (lime-700)
  fertilizante_k:     '#B45309',  // âmbar (amber-700)
  fertilizante_outro: '#713F12',  // marrom (amber-900)
  calcario:           '#57534E',  // pedra (stone-600)
  semente:            '#CA8A04',  // mostarda (yellow-600)
  // ── Operacional ───────────────────────────────────────────
  combustivel:        '#2563EB',  // azul (blue-600)
  lubrificante:       '#0F766E',  // verde-petróleo (teal-700)
  peca_maquina:       '#4338CA',  // índigo (indigo-700)
  servico:            '#C026D3',  // fúcsia (fuchsia-600)
  frete:              '#0284C7',  // azul-céu (sky-600)
  operacional:        '#D97706',  // laranja-queimado (amber-600)
  rh:                 '#E11D48',  // rosa-carmim (rose-600)
  outro:              '#94A3B8',  // slate suave
  // ── Categorias de cartão ──────────────────────────────────
  manutencao:         '#DB2777',  // pink (pink-600)
  alimentacao:        '#EA580C',  // laranja (orange-600)
  mercado:            '#16A34A',  // verde (green-600)
  veterinario:        '#0D9488',  // teal (teal-600)
  farmacia:           '#EF4444',  // vermelho (red-500)
  predial:            '#EAB308',  // amarelo (yellow-500)
  ferragens:          '#6366F1',  // índigo-claro (indigo-500)
  tejuco_gado:        '#84CC16',  // lima (lime-500)
  pedagio:            '#06B6D4',  // ciano (cyan-500)
  outros:             '#94A3B8',  // slate suave
}

function fmtBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtBRLKpi(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function fmtDate(dateStr: string) {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR')
}

function tipoLabel(value: string) {
  return TIPOS.find(t => t.value === value)?.label ?? value
}

// Decide se um item entra nas somas de dinheiro da tela (Total de Despesas,
// gráfico por categoria, etc). Gravado pelo processador da NF-e a partir de
// 04/08/2026 (migration 008) — o CFOP de cada item já decidiu isso lá, esta
// tela só lê a resposta.
//
// NULO/ausente PRECISA continuar contando: é como toda nota gravada antes
// desta coluna existir aparece, e é o histórico inteiro de gasto do dono.
// Só um `false` explícito — item já cobrado em outra nota, recebido sem
// custo (bonificação/amostra), ou mercadoria de passagem que nunca virou
// compra — tira o item da soma.
function contaComoGasto(item: Pick<ItemFinanceiro, 'conta_como_compra'>): boolean {
  return item.conta_como_compra !== false
}

function FormFields({ form, setForm }: { form: FormData; setForm: React.Dispatch<React.SetStateAction<FormData>> }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Descrição</Label>
        <Input
          placeholder="Ex: Roundup 20L, Frete colheita, Peça bomba…"
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
            placeholder="L, KG, UN, SC…"
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

export default function FinanceiroPage() {
  const [itens, setItens] = useState<ItemFinanceiro[]>([])
  const [loading, setLoading] = useState(true)
  // Achado da revisão: uma falha de carregamento (ex.: migration 008 não
  // rodou ainda no banco, e o select de conta_como_compra quebra a query
  // inteira) deixava `itens` em [] e a tela renderizava "R$ 0,00" e "Nenhum
  // lançamento encontrado" — silêncio indistinguível de "não há gasto". Este
  // estado garante que uma falha de banco SEMPRE aparece como falha, nunca
  // como tela vazia.
  const [erroCarregamento, setErroCarregamento] = useState(false)
  const [filtroCentro, setFiltroCentro] = useState('todos')
  const [filtroMes, setFiltroMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [filtroOrigem, setFiltroOrigem] = useState<'todos' | 'nfe' | 'cartao' | 'manual' | 'conta'>('todos')
  const [sortData, setSortData] = useState<'desc' | 'asc'>('desc')
  const { fazendaAtiva } = useFazenda()

  const [addDialog, setAddDialog] = useState(false)
  const [addErro, setAddErro] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<ItemFinanceiro | null>(null)
  const [editErro, setEditErro] = useState<string | null>(null)
  const [deleteItem, setDeleteItem] = useState<ItemFinanceiro | null>(null)
  const [deleteErro, setDeleteErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState<FormData>(FORM_VAZIO)

  async function load() {
    setLoading(true)
    setErroCarregamento(false)
    const [nfeResult, lancResult] = await Promise.all([
      supabase
        .from('itens_nfe')
        .select('id, descricao, quantidade, unidade, valor_unitario, valor_total, centro_custo, insumo_id, conta_como_compra, data_manual, insumos(tipo), notas_fiscais(numero, emitente_nome, data_emissao)')
        .order('id', { ascending: false }),
      supabase
        .from('lancamentos_financeiros')
        .select('id, data, descricao, valor, categoria, origem, cartao_id, cartoes(apelido)')
        // 'conta' = pagamento de conta a pagar. O IN do SQL nunca casa com nulo,
        // então toda origem nova PRECISA entrar aqui — senão o gasto some desta
        // tela e continua contando no Dashboard, que lê a tabela inteira.
        .in('origem', ['cartao', 'manual', 'conta'])
        .order('data', { ascending: false }),
    ])

    if (nfeResult.error || lancResult.error) {
      console.error('[Financeiro] Erro ao carregar:', nfeResult.error ?? lancResult.error)
      setErroCarregamento(true)
      setLoading(false)
      return
    }

    const nfeItems: ItemFinanceiro[] = (nfeResult.data ?? []).map((row: any) => ({
      id: row.id,
      source_table: 'itens_nfe' as const,
      descricao: row.descricao,
      quantidade: row.quantidade,
      unidade: row.unidade,
      valor_unitario: row.valor_unitario,
      valor_total: row.valor_total,
      centro_custo: row.centro_custo ?? row.insumos?.tipo ?? 'outro',
      insumo_id: row.insumo_id,
      nota_numero: row.notas_fiscais?.numero ?? null,
      emitente_nome: row.notas_fiscais?.emitente_nome ?? '',
      // Prioridade para a data da NF-e quando existir; lançamento manual
      // (sem nota vinculada) usa data_manual — a data escolhida pelo usuário
      // no formulário (migration 015). Sem este fallback o lançamento manual
      // fica com data vazia: some do filtro de mês e do Total de Despesas.
      data_emissao: row.notas_fiscais?.data_emissao ?? row.data_manual ?? '',
      is_manual: !row.notas_fiscais,
      origem: 'nfe' as const,
      cartao_apelido: null,
      conta_como_compra: row.conta_como_compra ?? null,
    }))

    const lancItems: ItemFinanceiro[] = (lancResult.data ?? []).map((row: any) => ({
      id: row.id,
      source_table: 'lancamentos_financeiros' as const,
      descricao: row.descricao,
      quantidade: 1,
      unidade: '',
      valor_unitario: row.valor,
      valor_total: row.valor,
      centro_custo: row.categoria ?? 'outros',
      insumo_id: null,
      nota_numero: null,
      emitente_nome: '',
      data_emissao: row.data ?? '',
      is_manual: row.origem === 'manual',
      origem: row.origem as 'cartao' | 'manual' | 'conta',
      cartao_apelido: row.cartoes?.apelido ?? null,
      // lancamentos_financeiros não tem CFOP — não existe razão para excluir
      // um lançamento de cartão/manual/conta do total. Conta como sempre contou.
      conta_como_compra: null,
    }))

    setItens([...nfeItems, ...lancItems])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mes = params.get('mes')
    const centro = params.get('centro')
    const origem = params.get('origem') as 'todos' | 'nfe' | 'cartao' | 'manual' | 'conta' | null
    if (mes !== null && /^\d{4}-\d{2}$/.test(mes)) setFiltroMes(mes)
    if (centro !== null) setFiltroCentro(centro)
    if (origem && ['todos', 'nfe', 'cartao', 'manual', 'conta'].includes(origem)) setFiltroOrigem(origem)
  }, [])

  async function handleAdd() {
    // Sem fazenda ativa não há como preencher fazenda_id (NOT NULL + RLS
    // nas duas tabelas abaixo) — o insert seria recusado pelo banco e o
    // usuário não veria nada. Barra antes de tentar.
    if (!fazendaAtiva) {
      setAddErro('Nenhuma fazenda ativa selecionada. Recarregue a página e tente de novo.')
      return
    }

    setSalvando(true)
    setAddErro(null)
    const qtd = parseFloat(form.quantidade) || 1
    const vUnit = parseFloat(form.valor_unitario) || 0

    try {
      let insumoId: string | null = null
      const { data: existente } = await supabase
        .from('insumos')
        .select('id')
        .ilike('nome', form.descricao.trim())
        .maybeSingle()

      if (existente) {
        insumoId = existente.id
      } else {
        const { data: novo, error: errInsumo } = await supabase
          .from('insumos')
          .insert({ nome: form.descricao.trim(), tipo: form.centro_custo, unidade: form.unidade, fazenda_id: fazendaAtiva.id })
          .select('id')
          .single()
        if (errInsumo) throw errInsumo
        insumoId = novo?.id ?? null
      }

      const { error: errItem } = await supabase.from('itens_nfe').insert({
        nota_fiscal_id: null,
        descricao: form.descricao.trim(),
        quantidade: qtd,
        unidade: form.unidade,
        valor_unitario: vUnit,
        valor_total: qtd * vUnit,
        insumo_id: insumoId,
        data_manual: form.data,
        fazenda_id: fazendaAtiva.id,
        centro_custo: form.centro_custo,
      })
      if (errItem) throw errItem

      setAddDialog(false)
      setForm(FORM_VAZIO)
      load()
    } catch (err) {
      console.error('[Financeiro] Erro ao adicionar lançamento:', err)
      const msg = (err as { message?: string })?.message ?? 'Erro desconhecido ao salvar'
      setAddErro(`Erro ao salvar: ${msg}`)
    } finally {
      setSalvando(false)
    }
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
    setEditErro(null)
    setEditItem(item)
  }

  async function handleEdit() {
    if (!editItem || editItem.source_table !== 'itens_nfe') return
    setSalvando(true)
    const qtd = parseFloat(form.quantidade) || 1
    const vUnit = parseFloat(form.valor_unitario) || 0

    // Centro de custo é gravado por lançamento na própria itens_nfe (independente
    // do insumo/estoque) — itens não-estocáveis (peça, frete) não têm insumo_id.
    const { data: updated, error } = await supabase.from('itens_nfe').update({
      descricao: form.descricao.trim(),
      quantidade: qtd,
      unidade: form.unidade,
      valor_unitario: vUnit,
      valor_total: qtd * vUnit,
      centro_custo: form.centro_custo,
    }).eq('id', editItem.id).select('id')

    setSalvando(false)

    if (error) {
      console.error('[Financeiro] Erro ao editar lançamento:', error)
      setEditErro(`Erro ao salvar: ${error.message}`)
      return
    }
    if (!updated || updated.length === 0) {
      console.error('[Financeiro] Update não afetou nenhuma linha — possível política RLS')
      setEditErro('Sem permissão para editar este item. Verifique as políticas do banco.')
      return
    }

    setEditItem(null)
    setForm(FORM_VAZIO)
    load()
  }

  async function handleDelete() {
    if (!deleteItem) return
    setSalvando(true)
    setDeleteErro(null)

    const { data: deleted, error } = await supabase
      .from(deleteItem.source_table)
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

  const mesAtual = new Date().toISOString().slice(0, 7) // 'YYYY-MM'
  const meses = Array.from(
    new Set([
      mesAtual, // garante que o mês corrente aparece sempre, mesmo sem dados
      ...itens.filter(i => i.data_emissao).map(i => i.data_emissao.slice(0, 7)),
    ])
  ).sort((a, b) => b.localeCompare(a))

  const itensFiltrados = itens
    .filter(i => {
      const okCentro = filtroCentro === 'todos' || i.centro_custo === filtroCentro
      const okMes    = filtroMes === 'todos' || i.data_emissao.startsWith(filtroMes)
      const okOrigem = filtroOrigem === 'todos' || i.origem === filtroOrigem || (filtroOrigem === 'nfe' && (i.origem === 'nfe' || i.origem === null))
      return okCentro && okMes && okOrigem
    })
    .sort((a, b) => {
      const da = a.data_emissao ?? ''
      const db = b.data_emissao ?? ''
      return sortData === 'desc' ? db.localeCompare(da) : da.localeCompare(db)
    })

  // Só os itens que CONTAM como gasto entram nas somas de dinheiro — um item
  // com conta_como_compra === false (já cobrado em outra nota, bonificação,
  // etc.) continua na lista abaixo, com o crachá explicando por quê, mas não
  // soma no Total de Despesas nem no gráfico por categoria.
  const itensQueContam = itensFiltrados.filter(contaComoGasto)

  const totalGeral = itensQueContam.reduce((s, i) => s + i.valor_total, 0)
  const porCategoria = itensQueContam.reduce<Record<string, number>>((acc, i) => {
    acc[i.centro_custo] = (acc[i.centro_custo] ?? 0) + i.valor_total
    return acc
  }, {})
  const maiorCategoria = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0]

  const chartData = Object.entries(porCategoria)
    .map(([key, value]) => ({ key, label: tipoLabel(key), value }))
    .sort((a, b) => b.value - a.value)

  if (loading) return <PageSkeleton />
  // Precisa vir ANTES de qualquer render de conteúdo — inclusive antes do
  // "Nenhum lançamento encontrado" que o array vazio geraria mais abaixo.
  // Uma falha de carregamento nunca pode se parecer com "não há gasto".
  if (erroCarregamento) return <ErroCarregamento onRetry={load} />

  const filtroAtivo = filtroMes !== 'todos' || filtroCentro !== 'todos' || filtroOrigem !== 'todos'
  const filtroMesLabel = filtroMes === 'todos'
    ? 'Todos os meses'
    : (() => { const [y, mo] = filtroMes.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })()
  const filtroCentroLabel = filtroCentro === 'todos' ? 'Todos os tipos' : tipoLabel(filtroCentro)

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">Despesas e lançamentos da fazenda</p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => { setForm(FORM_VAZIO); setAddErro(null); setAddDialog(true) }}>
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
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
            <p className="text-2xl font-bold">{fmtBRLKpi(totalGeral)}</p>
            {/* itensQueContam, não itensFiltrados: esta contagem descreve o
                que está somado no valor acima — contar item que não entrou
                na soma contradiria o próprio número ao lado. */}
            <p className="text-xs text-muted-foreground mt-1">{itensQueContam.length} item(ns) no período</p>
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
                <p className="text-2xl font-bold">{fmtBRLKpi(maiorCategoria[1])}</p>
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
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Gastos por Categoria</CardTitle>
              <span className="text-sm text-muted-foreground tabular-nums">{fmtBRL(totalGeral)}</span>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto pt-2">
            <div style={{ minWidth: 360 }}>
              <ResponsiveContainer width="100%" height={chartData.length * 52 + 16}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 180, bottom: 0, left: 8 }}
                  barSize={22}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={150}
                    tick={{ fontSize: 15, fill: '#374151' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <RechartsTooltip
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const { label, value } = payload[0].payload as { label: string; value: number }
                      const pct = totalGeral > 0 ? (value / totalGeral * 100).toFixed(1) : '0.0'
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-sm">
                          <p className="font-medium text-foreground mb-1">{label}</p>
                          <p className="tabular-nums text-foreground">{fmtBRL(value)}</p>
                          <p className="text-muted-foreground">{pct}% do total</p>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 5, 5, 0]}>
                    {chartData.map(entry => (
                      <Cell key={entry.key} fill={CENTRO_CUSTO_COLOR[entry.key] ?? '#94a3b8'} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      content={(props) => {
                        const { x, y, width, height, value } = props as { x: number; y: number; width: number; height: number; value: unknown }
                        const val = Number(value ?? 0)
                        const pct = totalGeral > 0 ? (val / totalGeral * 100).toFixed(1) : '0.0'
                        const cx = x + width + 8
                        const cy = y + height / 2 + 5
                        return (
                          <text x={cx} y={cy} fill="#6b7280" fontSize={14}>
                            <tspan>{fmtBRL(val)}</tspan>
                            <tspan dx={32}>{pct}%</tspan>
                          </text>
                        )
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filtroMes} onValueChange={v => { const val = v ?? 'todos'; setFiltroMes(val); setUrlParam('mes', val) }}>
              <SelectTrigger className="w-44 h-9 text-sm"><SelectValue>{filtroMesLabel}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os meses</SelectItem>
                {meses.map(m => (
                  <SelectItem key={m} value={m}>
                    {(() => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroCentro} onValueChange={v => { const val = v ?? 'todos'; setFiltroCentro(val); setUrlParam('centro', val) }}>
              <SelectTrigger className="w-44 h-9 text-sm"><SelectValue>{filtroCentroLabel}</SelectValue></SelectTrigger>
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
                onClick={() => { setFiltroMes('todos'); setFiltroCentro('todos'); setFiltroOrigem('todos'); window.history.replaceState(null, '', window.location.pathname) }}
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
                <TableHead className="w-[90px]">
                  <button
                    onClick={() => setSortData(s => s === 'desc' ? 'asc' : 'desc')}
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={sortData === 'desc' ? 'Ordenado: mais recente primeiro. Clique para inverter' : 'Ordenado: mais antigo primeiro. Clique para inverter'}
                  >
                    Data
                    {sortData === 'desc'
                      ? <ArrowDown className="h-3 w-3" aria-hidden="true" />
                      : <ArrowUp className="h-3 w-3" aria-hidden="true" />}
                  </button>
                </TableHead>
                <TableHead className="w-[72px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
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
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-sm max-w-[200px] truncate" title={item.descricao}>
                    {item.descricao}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {item.quantidade} {item.unidade}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{fmtBRL(item.valor_unitario)}</TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">{fmtBRL(item.valor_total)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant="outline"
                        className={`capitalize text-xs ${CENTRO_CUSTO_STYLE[item.centro_custo] ?? CENTRO_CUSTO_STYLE.outro}`}
                      >
                        {tipoLabel(item.centro_custo)}
                      </Badge>
                      {/* conta_como_compra === false: o item fica na lista (o
                          dono precisa continuar vendo que ele existe), mas não
                          soma no Total de Despesas nem no gráfico — este crachá
                          explica por quê, em português simples, sem código fiscal. */}
                      {item.conta_como_compra === false && (
                        <Tooltip>
                          <TooltipTrigger className="cursor-default bg-transparent border-0 p-0">
                            <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 border-slate-200">
                              Não conta como gasto
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Este item não entra no total porque o valor já foi cobrado em
                            outra nota, foi recebido sem custo (bonificação/amostra), ou é
                            mercadoria que só passou pela fazenda sem virar compra.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm w-[160px]">
                    {item.origem === 'cartao' ? (
                      <Badge variant="secondary" className="text-xs">
                        {item.cartao_apelido ?? 'Cartão'}
                      </Badge>
                    ) : item.origem === 'conta' ? (
                      <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                        Conta paga
                      </Badge>
                    ) : item.origem === 'manual' ? (
                      <span className="text-xs text-muted-foreground italic">Manual</span>
                    ) : item.is_manual ? (
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
                      {item.source_table === 'itens_nfe' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Editar lançamento"
                          className="hover:bg-blue-50 hover:text-blue-600"
                          onClick={() => abrirEdicao(item)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Excluir lançamento"
                        className="hover:bg-red-50 hover:text-red-600 text-red-400"
                        onClick={() => setDeleteItem(item)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {itensFiltrados.length > 0 && (
              <TableFooter>
                <TableRow>
                  {/* itensQueContam, mesma razão do KPI lá em cima: o total em
                      dinheiro é a soma só dos itens que contam como gasto —
                      contar a lista inteira aqui diria um número que o valor
                      ao lado não sustenta. */}
                  <TableCell colSpan={3} className="text-right text-sm font-semibold text-muted-foreground py-3">
                    Total ({itensQueContam.length} {itensQueContam.length === 1 ? 'item' : 'itens'})
                  </TableCell>
                  <TableCell className="text-right text-sm font-bold py-3 tabular-nums">
                    {fmtBRL(totalGeral)}
                  </TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Dialog open={addDialog} onOpenChange={open => { if (!open) { setAddDialog(false); setAddErro(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar Lançamento</DialogTitle></DialogHeader>
          <FormFields form={form} setForm={setForm} />
          {addErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {addErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialog(false); setAddErro(null) }}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={salvando || !form.descricao || !form.valor_unitario}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={open => { if (!open) { setEditItem(null); setEditErro(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Lançamento</DialogTitle></DialogHeader>
          <FormFields form={form} setForm={setForm} />
          {editErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {editErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={salvando || !form.descricao || !form.valor_unitario}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteItem} onOpenChange={open => { if (!open) { setDeleteItem(null); setDeleteErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir lançamento?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deleteItem?.descricao}</span> será removido permanentemente.
            {/* Só item de nota fiscal mesmo. A condição antiga era só
                `!is_manual`, e caía também em lançamento de cartão — e agora
                cairia em conta paga — avisando de uma NF-e que não existe. */}
            {deleteItem?.source_table === 'itens_nfe' && !deleteItem?.is_manual && (
              <span className="block mt-1 text-yellow-600">
                Este item veio de uma NF-e. A nota em si não será excluída.
              </span>
            )}
            {deleteItem?.origem === 'conta' && (
              <span className="block mt-1 text-yellow-600">
                Este gasto veio de uma conta marcada como paga em Contas a Pagar.
                A conta continuará aparecendo como paga por lá — para desfazer de
                verdade, use &quot;Desfazer pagamento&quot; na tela de contas.
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
              {salvando ? 'Excluindo…' : 'Excluir'}
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
      </div>
      <div className="h-72 bg-muted rounded-xl" />
    </div>
  )
}

// Renderizado no lugar da tela inteira quando o carregamento falha — nunca
// junto dos cartões de KPI, para não deixar "R$ 0,00" aparecer ao lado do
// aviso. Um dado incerto sobre dinheiro é pior que nenhum dado.
function ErroCarregamento({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="p-6">
      <Card className="border-amber-200">
        <CardContent className="flex flex-col items-center text-center gap-3 py-12">
          <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Não foi possível carregar o Financeiro</p>
            <p className="text-sm text-muted-foreground max-w-md">
              Os lançamentos não carregaram agora. Nenhum valor desta tela pode ser
              considerado correto até carregar de novo — não é que não há gastos.
            </p>
          </div>
          <Button size="sm" onClick={onRetry}>Tentar novamente</Button>
        </CardContent>
      </Card>
    </div>
  )
}
