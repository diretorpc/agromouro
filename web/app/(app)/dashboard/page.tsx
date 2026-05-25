'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Bell, PackageX, Tractor, Sprout,
  TrendingDown, TrendingUp, Wheat, BarChart3, GripVertical,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  DndContext, DragEndEvent, PointerSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { Talhao, Operacao, Estoque, Alerta, LancamentoFinanceiro, Safra } from '@/lib/types'

// ─── helpers ───────────────────────────────────────────────
function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function formatTon(kg: number) {
  return kg >= 1000
    ? `${(kg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`
    : `${kg.toLocaleString('pt-BR')} kg`
}

// ─── SortableItem wrapper ───────────────────────────────────
function SortableItem({ id, children }: { id: string; children: (handleProps: React.HTMLAttributes<HTMLDivElement>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        position: 'relative',
        zIndex: isDragging ? 10 : undefined,
      }}
      {...attributes}
    >
      {children({ ref: setActivatorNodeRef as React.Ref<HTMLDivElement>, ...listeners } as React.HTMLAttributes<HTMLDivElement>)}
    </div>
  )
}

// ─── Card grande (fileira 1) ────────────────────────────────
interface BigCardProps {
  href?: string
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  accent: string
  valueColor?: string
  dragHandle: React.HTMLAttributes<HTMLDivElement>
}
function BigCard({ href, label, value, sub, icon, iconBg, iconColor, accent, valueColor, dragHandle }: BigCardProps) {
  const content = (
    <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow h-full group/card">
      <div className="h-1" style={{ backgroundColor: accent }} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className={`text-2xl font-extrabold mt-2 leading-none tracking-tight ${valueColor ?? 'text-foreground'}`}>
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-1.5 font-medium">{sub}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div
              {...dragHandle}
              className="opacity-0 group-hover/card:opacity-40 hover:!opacity-80 cursor-grab active:cursor-grabbing p-0.5 rounded transition-opacity"
              title="Arrastar"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
            <div
              className="h-11 w-11 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: iconBg }}
            >
              <span style={{ color: iconColor }}>{icon}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block">{content}</Link> : content
}

// ─── Card pequeno (fileira 2) ───────────────────────────────
interface SmallCardProps {
  href?: string
  label: string
  value: string | number
  sub?: string
  accent: string
  valueColor?: string
  dragHandle: React.HTMLAttributes<HTMLDivElement>
}
function SmallCard({ href, label, value, sub, accent, valueColor, dragHandle }: SmallCardProps) {
  const content = (
    <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow h-full group/card">
      <div className="h-0.5" style={{ backgroundColor: accent }} />
      <CardContent className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className={`text-xl font-extrabold mt-1 leading-none tracking-tight ${valueColor ?? 'text-foreground'}`}>
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-1 font-medium">{sub}</p>}
          </div>
          <div
            {...dragHandle}
            className="opacity-0 group-hover/card:opacity-40 hover:!opacity-80 cursor-grab active:cursor-grabbing p-0.5 rounded transition-opacity mt-0.5"
            title="Arrastar"
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block">{content}</Link> : content
}

// ─── Cores culturas ────────────────────────────────────────
const CULTURE_COLORS = ['#5B8C2A', '#7B3D1A', '#8FB840', '#A0522D', '#6BAF2A', '#4A7020']

// ─── IDs dos cards ─────────────────────────────────────────
const BIG_DEFAULT = ['contas-pagar', 'contas-receber', 'producao', 'produtividade'] as const
const SMALL_DEFAULT = ['alertas', 'estoque-critico', 'talhoes', 'ultima-op'] as const
type BigId = (typeof BIG_DEFAULT)[number]
type SmallId = (typeof SMALL_DEFAULT)[number]

function loadOrder<T extends string>(key: string, defaults: readonly T[]): T[] {
  if (typeof window === 'undefined') return [...defaults]
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '')
    if (Array.isArray(saved) && saved.length === defaults.length) return saved as T[]
  } catch { /* ignore */ }
  return [...defaults]
}

// ─── Página ────────────────────────────────────────────────
export default function DashboardPage() {
  const [talhoes, setTalhoes] = useState<Talhao[]>([])
  const [operacoes, setOperacoes] = useState<Operacao[]>([])
  const [estoque, setEstoque] = useState<Estoque[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([])
  const [safras, setSafras] = useState<Safra[]>([])
  const [loading, setLoading] = useState(true)

  const [bigOrder, setBigOrder] = useState<BigId[]>(() => loadOrder('dash-big', BIG_DEFAULT))
  const [smallOrder, setSmallOrder] = useState<SmallId[]>(() => loadOrder('dash-small', SMALL_DEFAULT))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  useEffect(() => {
    Promise.all([
      api.get<Talhao[]>('/talhoes').catch(() => [] as Talhao[]),
      api.get<Operacao[]>('/operacoes').catch(() => [] as Operacao[]),
      api.get<Estoque[]>('/estoque').catch(() => [] as Estoque[]),
      api.get<Alerta[]>('/alertas').catch(() => [] as Alerta[]),
      supabase.from('lancamentos_financeiros').select('*').then(r => (r.data ?? []) as LancamentoFinanceiro[]),
      supabase.from('safras').select('*, talhoes(area_ha)').then(r => (r.data ?? []) as Safra[]),
    ]).then(([t, o, e, a, l, s]) => {
      setTalhoes(t); setOperacoes(o); setEstoque(e)
      setAlertas(a); setLancamentos(l); setSafras(s)
      setLoading(false)
    })
  }, [])

  // ── Métricas ──
  const contasPagar = lancamentos.filter(l => l.tipo === 'despesa').reduce((s, l) => s + l.valor, 0)
  const contasReceber = lancamentos.filter(l => l.tipo === 'receita').reduce((s, l) => s + l.valor, 0)
  const producaoTotalKg = safras.reduce((s, sf) => s + (sf.producao_kg ?? 0), 0)
  const areaColhida = safras.filter(sf => (sf.producao_kg ?? 0) > 0).reduce((s, sf) => s + (sf.talhoes?.area_ha ?? 0), 0)
  const produtividade = areaColhida > 0 ? (producaoTotalKg / 1000) / areaColhida : 0
  const alertasAtivos = alertas.filter(a => !a.lido)
  const estoqueCritico = estoque.filter(e => e.quantidade_atual <= e.quantidade_minima_alerta)
  const talhoesAtivos = talhoes.filter(t => t.status === 'ativo')

  // ── Dados gráficos ──
  const opsPorTipo = Object.entries(
    operacoes.reduce<Record<string, number>>((acc, op) => { acc[op.tipo] = (acc[op.tipo] ?? 0) + 1; return acc }, {})
  ).map(([tipo, total]) => ({ tipo: tipo.length > 12 ? tipo.slice(0, 12) + '…' : tipo, total }))
    .sort((a, b) => b.total - a.total).slice(0, 7)

  const culturasPorArea = Object.entries(
    talhoes.reduce<Record<string, number>>((acc, t) => {
      const c = t.cultura_atual ?? 'Sem cultura'
      acc[c] = (acc[c] ?? 0) + t.area_ha; return acc
    }, {})
  ).map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }))

  // ── Drag handlers ──
  const handleBigDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setBigOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id as BigId), prev.indexOf(over.id as BigId))
      localStorage.setItem('dash-big', JSON.stringify(next))
      return next
    })
  }, [])

  const handleSmallDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSmallOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id as SmallId), prev.indexOf(over.id as SmallId))
      localStorage.setItem('dash-small', JSON.stringify(next))
      return next
    })
  }, [])

  // ── Render de cada card por ID ──
  function renderBig(id: BigId, dragHandle: React.HTMLAttributes<HTMLDivElement>) {
    switch (id) {
      case 'contas-pagar': return (
        <BigCard label="Contas a Pagar" value={formatBRL(contasPagar)} sub="total de despesas"
          icon={<TrendingDown className="h-5 w-5" />} iconBg="#FEF2F2" iconColor="#DC2626"
          accent="#EF4444" valueColor={contasPagar > 0 ? 'text-red-600' : undefined} dragHandle={dragHandle} />
      )
      case 'contas-receber': return (
        <BigCard label="Contas a Receber" value={formatBRL(contasReceber)} sub="total de receitas"
          icon={<TrendingUp className="h-5 w-5" />} iconBg="#EDFAF1" iconColor="#16A34A"
          accent="#22C55E" valueColor={contasReceber > 0 ? 'text-green-600' : undefined} dragHandle={dragHandle} />
      )
      case 'producao': return (
        <BigCard label="Produção Total" value={producaoTotalKg > 0 ? formatTon(producaoTotalKg) : '—'}
          sub={producaoTotalKg > 0 ? `${safras.filter(s => (s.producao_kg ?? 0) > 0).length} safras` : 'nenhuma colheita'}
          icon={<Wheat className="h-5 w-5" />} iconBg="#FFF9EB" iconColor="#D97706"
          accent="#F59E0B" dragHandle={dragHandle} />
      )
      case 'produtividade': return (
        <BigCard label="Produtividade"
          value={produtividade > 0 ? `${produtividade.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} t/ha` : '—'}
          sub={produtividade > 0 ? `${areaColhida.toLocaleString('pt-BR')} ha colhidos` : 'sem dados de colheita'}
          icon={<BarChart3 className="h-5 w-5" />} iconBg="#EEF5E5" iconColor="#5B8C2A"
          accent="#5B8C2A" dragHandle={dragHandle} />
      )
    }
  }

  function renderSmall(id: SmallId, dragHandle: React.HTMLAttributes<HTMLDivElement>) {
    switch (id) {
      case 'alertas': return (
        <SmallCard href="/alertas" label="Alertas Ativos" value={alertasAtivos.length} sub="não lidos"
          accent="#F59E0B" valueColor={alertasAtivos.length > 0 ? 'text-amber-600' : undefined} dragHandle={dragHandle} />
      )
      case 'estoque-critico': return (
        <SmallCard href="/estoque" label="Estoque Crítico" value={estoqueCritico.length} sub="abaixo do mínimo"
          accent="#EF4444" valueColor={estoqueCritico.length > 0 ? 'text-red-600' : undefined} dragHandle={dragHandle} />
      )
      case 'talhoes': return (
        <SmallCard label="Talhões Ativos" value={talhoesAtivos.length} sub={`de ${talhoes.length} total`}
          accent="#5B8C2A" dragHandle={dragHandle} />
      )
      case 'ultima-op': return (
        <SmallCard href="/operacoes" label="Última Operação"
          value={operacoes[0] ? operacoes[0].data.slice(5, 10).split('-').reverse().join('/') : '—'}
          sub={operacoes[0]?.tipo ?? 'nenhuma registrada'}
          accent="#6B7280" dragHandle={dragHandle} />
      )
    }
  }

  if (loading) return <DashboardSkeleton />

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1 font-medium">Visão geral das suas operações agrícolas</p>
      </div>

      {/* Fileira 1 — drag and drop */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleBigDragEnd}>
        <SortableContext items={bigOrder} strategy={horizontalListSortingStrategy}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {bigOrder.map(id => (
              <SortableItem key={id} id={id}>
                {(dragHandle) => renderBig(id, dragHandle)!}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Fileira 2 — drag and drop */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSmallDragEnd}>
        <SortableContext items={smallOrder} strategy={horizontalListSortingStrategy}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {smallOrder.map(id => (
              <SortableItem key={id} id={id}>
                {(dragHandle) => renderSmall(id, dragHandle)!}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Operações por Tipo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {opsPorTipo.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                Nenhuma operação registrada.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={opsPorTipo} barCategoryGap="30%">
                  <XAxis dataKey="tipo" tick={{ fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip contentStyle={{ border: 'none', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 12 }}
                    cursor={{ fill: 'rgba(91,140,42,0.06)' }} />
                  <Bar dataKey="total" fill="#5B8C2A" radius={[4, 4, 0, 0]} name="Operações" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Culturas por Área (ha)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {culturasPorArea.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                Nenhum talhão cadastrado.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={culturasPorArea} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {culturasPorArea.map((_, i) => <Cell key={i} fill={CULTURE_COLORS[i % CULTURE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v} ha`, '']}
                    contentStyle={{ border: 'none', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 12 }} />
                  <Legend iconType="circle" iconSize={8}
                    formatter={(v) => <span style={{ fontSize: 12, fontWeight: 600 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Talhões + Estoque crítico */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Talhões</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {talhoes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum talhão cadastrado.</p>
            ) : talhoes.map((t, i) => (
              <div key={t.id} className="flex items-center justify-between py-2.5 text-sm"
                style={i < talhoes.length - 1 ? { borderBottom: '1px solid var(--border)' } : undefined}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold truncate">{t.nome}</span>
                  <span className="text-muted-foreground text-xs shrink-0">{t.area_ha} ha</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.cultura_atual && <span className="text-xs text-muted-foreground capitalize">{t.cultura_atual}</span>}
                  <StatusBadge status={t.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {estoqueCritico.length > 0 ? (
          <Card className="border-0 shadow-sm" style={{ borderLeft: '3px solid #EF4444' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-red-600">Estoque Crítico</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-3">
                {estoqueCritico.map(e => (
                  <div key={e.id} className="bg-red-50 rounded-lg p-3">
                    <p className="font-semibold text-sm truncate">{e.insumos.nome}</p>
                    <p className="text-red-600 font-extrabold text-lg leading-tight mt-0.5">
                      {e.quantidade_atual} <span className="text-sm font-normal">{e.insumos.unidade}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">mín: {e.quantidade_minima_alerta} {e.insumos.unidade}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Últimas Operações</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {operacoes.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma operação registrada.</p>
              ) : operacoes.slice(0, 6).map((op, i) => (
                <div key={op.id} className="flex items-start justify-between gap-3 py-2.5 text-sm"
                  style={i < Math.min(operacoes.length, 6) - 1 ? { borderBottom: '1px solid var(--border)' } : undefined}>
                  <div className="min-w-0">
                    <span className="font-semibold">{op.tipo}</span>
                    {op.talhoes && <span className="text-muted-foreground"> · {op.talhoes.nome}</span>}
                  </div>
                  <div className="text-right shrink-0">
                    <FonteLabel fonte={op.fonte} />
                    <p className="text-xs text-muted-foreground">{op.data.slice(0, 10).split('-').reverse().join('/')}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function FonteLabel({ fonte }: { fonte: string }) {
  const map: Record<string, string> = { whatsapp: '💬', manual: '✏️', jd: '🚜', nfe: '📄' }
  return <span className="text-base" title={fonte}>{map[fonte] ?? fonte}</span>
}

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, { bg: string; color: string }> = {
    ativo: { bg: '#EDFAF1', color: '#16A34A' },
    pousio: { bg: '#FFFBEB', color: '#D97706' },
    colhido: { bg: '#F3F4F6', color: '#6B7280' },
  }
  const style = s[status] ?? s.colhido
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: style.bg, color: style.color }}>
      {status}
    </span>
  )
}

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="h-9 w-40 bg-muted rounded" />
      <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}</div>
      <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl" />)}</div>
      <div className="grid grid-cols-2 gap-5">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-64 bg-muted rounded-xl" />)}</div>
    </div>
  )
}
