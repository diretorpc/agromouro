'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingDown, Package, Sprout, Tractor } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { Talhao, Operacao, Estoque, Alerta, LancamentoFinanceiro, Safra, Insumo } from '@/lib/types'

// ─── helpers ───────────────────────────────────────────────
function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

// ─── Card KPI ──────────────────────────────────────────────
interface KpiCardProps {
  href?: string
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  valueColor?: string
}
function KpiCard({ href, label, value, sub, icon, iconBg, iconColor, valueColor }: KpiCardProps) {
  const content = (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow h-full">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className={`text-2xl font-extrabold mt-2 leading-none tracking-tight ${valueColor ?? 'text-foreground'}`}>
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-1.5 font-medium">{sub}</p>}
          </div>
          <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: iconBg }}>
            <span style={{ color: iconColor }}>{icon}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block">{content}</Link> : content
}

// ─── Cores culturas ────────────────────────────────────────
const CULTURE_COLORS = ['#5B8C2A', '#7B3D1A', '#8FB840', '#A0522D', '#6BAF2A', '#4A7020']

// ─── Página ────────────────────────────────────────────────
export default function DashboardPage() {
  const [talhoes, setTalhoes] = useState<Talhao[]>([])
  const [operacoes, setOperacoes] = useState<Operacao[]>([])
  const [estoque, setEstoque] = useState<Estoque[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([])
  const [safras, setSafras] = useState<Safra[]>([])
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get<Talhao[]>('/talhoes').catch(() => [] as Talhao[]),
      api.get<Operacao[]>('/operacoes').catch(() => [] as Operacao[]),
      api.get<Estoque[]>('/estoque').catch(() => [] as Estoque[]),
      api.get<Alerta[]>('/alertas').catch(() => [] as Alerta[]),
      supabase.from('lancamentos_financeiros').select('*').then(r => (r.data ?? []) as LancamentoFinanceiro[]),
      supabase.from('safras').select('*, talhoes(area_ha)').then(r => (r.data ?? []) as Safra[]),
      supabase.from('insumos').select('id, nome, tipo, unidade').then(r => (r.data ?? []) as Insumo[]),
    ]).then(([t, o, e, a, l, s, ins]) => {
      setTalhoes(t); setOperacoes(o); setEstoque(e)
      setAlertas(a); setLancamentos(l); setSafras(s); setInsumos(ins)
      setLoading(false)
    })
  }, [])

  // ── Métricas dos 4 KPIs ──
  // 1. Total gasto no mês atual (calendar month)
  const inicioMes = new Date()
  inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0)
  const inicioMesISO = inicioMes.toISOString().slice(0, 10)
  const lancamentosMes = lancamentos.filter(l => l.tipo === 'despesa' && l.data >= inicioMesISO)
  const totalGastoMes  = lancamentosMes.reduce((s, l) => s + l.valor, 0)
  const nomeMesAtual   = inicioMes.toLocaleDateString('pt-BR', { month: 'long' })

  // 2. Insumos cadastrados
  const tiposDistintos = [...new Set(insumos.map(i => i.tipo))].length
  const subInsumos = insumos.length === 0 ? 'nenhum cadastrado' : `${tiposDistintos} tipo${tiposDistintos !== 1 ? 's' : ''}`

  // Estoque crítico + negativo (usados no card inferior)
  const estoqueNegativo = estoque.filter(e => e.quantidade_atual < 0)
  const estoqueCritico  = estoque.filter(e => e.quantidade_atual >= 0 && e.quantidade_atual <= e.quantidade_minima_alerta)

  // 3. Talhões
  const talhoesAtivos = talhoes.filter(t => t.status === 'ativo')
  const haTotal       = talhoes.reduce((s, t) => s + (t.area_ha ?? 0), 0)

  // 4. Operações nos últimos 30 dias
  const trintaDiasAtras = new Date()
  trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30)
  const trintaDiasISO = trintaDiasAtras.toISOString().slice(0, 10)
  const operacoes30d  = operacoes.filter(o => o.data >= trintaDiasISO)
  const ultimaOp      = operacoes[0]

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

  if (loading) return <DashboardSkeleton />

  void alertas; void safras

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1 font-medium">Visão geral das suas operações agrícolas</p>
      </div>

      {/* KPIs principais — 4 cards em fileira única */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          href="/financeiro"
          label={`Gasto em ${nomeMesAtual}`}
          value={formatBRL(totalGastoMes)}
          sub={`${lancamentosMes.length} lançamento${lancamentosMes.length !== 1 ? 's' : ''}`}
          icon={<TrendingDown className="h-5 w-5" />}
          iconBg="#FEF2F2" iconColor="#DC2626"
          valueColor={totalGastoMes > 0 ? 'text-red-600' : undefined}
        />
        <KpiCard
          href="/estoque"
          label="Insumos"
          value={insumos.length}
          sub={subInsumos}
          icon={<Package className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          href="/talhoes"
          label="Talhões Ativos"
          value={talhoesAtivos.length}
          sub={`${haTotal.toFixed(0)} ha em ${talhoes.length} talhões`}
          icon={<Sprout className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          href="/operacoes"
          label="Operações (30d)"
          value={operacoes30d.length}
          sub={ultimaOp ? `Última: ${ultimaOp.data.slice(0, 10).split('-').reverse().join('/')}` : 'nenhuma registrada'}
          icon={<Tractor className="h-5 w-5" />}
          iconBg="#EFF6FF" iconColor="#2563EB"
        />
      </div>

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-64 bg-muted rounded-xl" />)}
      </div>
    </div>
  )
}
