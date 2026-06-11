'use client'

import { useEffect, useState } from 'react'
import { TrendingDown, DollarSign, Package, Sprout, Tractor, BarChart2, CloudRain, Sun, Cloud, TrendingUp, AlertTriangle, Wind, Droplets, CloudDrizzle, MapPin, RefreshCw } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Label,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KpiCard } from '@/components/ui/kpi-card'
import { EmptyState } from '@/components/ui/empty-state'
import { supabase } from '@/lib/supabase'
import { useFazenda } from '@/context/fazenda-context'
import type { Talhao, Operacao, Estoque, Alerta, LancamentoFinanceiro, Safra, Insumo, Cotacao, ClimaDay } from '@/lib/types'

// ─── helpers ───────────────────────────────────────────────
function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

// ─── Paleta semântica por cultura ──────────────────────────
const CULTURE_PALETTE: Record<string, string> = {
  soja:          '#22C55E',
  milho:         '#EAB308',
  trigo:         '#F97316',
  aveia:         '#3B82F6',
  cana:          '#8B5CF6',
  sorgo:         '#06B6D4',
  pasto:         '#84CC16',
  'sem cultura': '#9CA3AF',
}
const CULTURE_FALLBACK = ['#22C55E','#EAB308','#F97316','#3B82F6','#8B5CF6','#06B6D4','#84CC16','#F43F5E']

function getCultureColor(name: string, index: number): string {
  return CULTURE_PALETTE[name.toLowerCase()] ?? CULTURE_FALLBACK[index % CULTURE_FALLBACK.length]
}

// ─── Página ────────────────────────────────────────────────
export default function DashboardPage() {
  const { fazendaAtiva } = useFazenda()

  const [talhoes, setTalhoes] = useState<Talhao[]>([])
  const [operacoes, setOperacoes] = useState<Operacao[]>([])
  const [estoque, setEstoque] = useState<Estoque[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([])
  const [safras, setSafras] = useState<Safra[]>([])
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([])
  const [clima, setClima] = useState<ClimaDay[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

    Promise.all([
      supabase.from('talhoes').select('id, nome, area_ha, cultura_atual, status').then(r => (r.data ?? []) as Talhao[]),
      supabase.from('operacoes').select('id, talhao_id, safra_id, tipo, data, descricao, fonte, talhoes(nome)').then(r => (r.data ?? []) as unknown as Operacao[]),
      supabase.from('estoque').select('id, insumo_id, quantidade_atual, quantidade_minima_alerta, preco_medio_unitario, insumos(id, nome, tipo, unidade)').then(r => (r.data ?? []) as unknown as Estoque[]),
      supabase.from('alertas').select('id, tipo, titulo, mensagem, nivel, lido, enviado_whatsapp, created_at').then(r => (r.data ?? []) as Alerta[]),
      supabase.from('lancamentos_financeiros').select('*').then(r => (r.data ?? []) as LancamentoFinanceiro[]),
      supabase.from('safras').select('*, talhoes(area_ha)').then(r => (r.data ?? []) as Safra[]),
      supabase.from('insumos').select('id, nome, tipo, unidade').then(r => (r.data ?? []) as Insumo[]),
      supabase.from('cotacoes_commodities').select('commodity, preco_rs, data')
        .gte('data', twoDaysAgo.toISOString().slice(0, 10))
        .order('data', { ascending: false })
        .then(r => (r.data ?? []) as Cotacao[]),
    ]).then(([t, o, e, a, l, s, ins, cot]) => {
      setTalhoes(t); setOperacoes(o); setEstoque(e)
      setAlertas(a); setLancamentos(l); setSafras(s); setInsumos(ins)
      setCotacoes(cot)
      setLoading(false)
    })
  }, [])

  // Busca clima quando a fazenda ativa estiver disponível
  useEffect(() => {
    if (!fazendaAtiva?.id) return

    setClima(null)
    let cancelado = false

    async function carregarClima() {
      const { data: fazenda } = await supabase
        .from('fazendas')
        .select('lat, lng')
        .eq('id', fazendaAtiva!.id)
        .single()

      if (cancelado) return

      const lat = (fazenda as { lat?: number | null } | null)?.lat
      const lng = (fazenda as { lng?: number | null } | null)?.lng
      if (!lat || !lng) { setClima([]); return }

      try {
        const url = [
          'https://api.open-meteo.com/v1/forecast',
          `?latitude=${lat}&longitude=${lng}`,
          '&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,windspeed_10m_max',
          '&forecast_days=5&timezone=America%2FSao_Paulo',
        ].join('')

        const res = await fetch(url)
        if (cancelado) return
        if (!res.ok) return

        const json = await res.json()
        if (cancelado) return

        const {
          time,
          temperature_2m_min, temperature_2m_max,
          precipitation_sum, precipitation_probability_max,
          windspeed_10m_max,
        } = json.daily

        setClima((time as string[]).map((date: string, i: number) => ({
          date,
          tempMin:                  temperature_2m_min[i]         as number,
          tempMax:                  temperature_2m_max[i]         as number,
          precipitation:            precipitation_sum[i]          as number,
          precipitationProbability: precipitation_probability_max[i] as number,
          windspeed:                windspeed_10m_max[i]          as number,
        })))
      } catch {
        // falha silenciosa — card mostra estado vazio
      }
    }

    carregarClima()
    return () => { cancelado = true }
  }, [fazendaAtiva?.id])

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
  )
    .map(([name, value], i) => ({ name, value: Math.round(value * 10) / 10, color: getCultureColor(name, i) }))
    .sort((a, b) => b.value - a.value)

  const totalHaCulturas = culturasPorArea.reduce((s, c) => s + c.value, 0)

  if (loading) return <DashboardSkeleton />

  // Última cotação por commodity
  const cotacaoMap = cotacoes.reduce<Record<string, Cotacao>>((acc, c) => {
    if (!acc[c.commodity]) acc[c.commodity] = c
    return acc
  }, {})

  void alertas; void safras

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1 font-medium">Visão geral das suas operações agrícolas</p>
      </div>

      {/* Cards de clima + cotações */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ClimaCard clima={clima} fazenda={fazendaAtiva} />
        <CotacoesCard cotacaoMap={cotacaoMap} onCotacoesAtualizadas={() => {
          const twoDaysAgo = new Date()
          twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
          supabase.from('cotacoes_commodities').select('commodity, preco_rs, data')
            .gte('data', twoDaysAgo.toISOString().slice(0, 10))
            .order('data', { ascending: false })
            .then(r => setCotacoes((r.data ?? []) as Cotacao[]))
        }} />
      </div>

      {/* KPIs principais — 4 cards em fileira única */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          href="/financeiro"
          label={`Gasto em ${nomeMesAtual}`}
          value={formatBRL(totalGastoMes)}
          sub={`${lancamentosMes.length} lançamento${lancamentosMes.length !== 1 ? 's' : ''}`}
          icon={totalGastoMes > 0 ? <TrendingDown className="h-5 w-5" /> : <DollarSign className="h-5 w-5" />}
          iconBg={totalGastoMes > 0 ? '#FEF2F2' : '#F3F4F6'}
          iconColor={totalGastoMes > 0 ? '#DC2626' : '#6B7280'}
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
              <EmptyState
                icon={<BarChart2 className="h-6 w-6" />}
                title="Nenhuma operação registrada"
                description="Registre operações via WhatsApp ou manualmente para visualizar o gráfico."
              />
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
              <div className="flex items-center gap-6">
                <div className="shrink-0" style={{ width: 160, height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={culturasPorArea}
                        cx="50%" cy="50%"
                        innerRadius={50} outerRadius={72}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {culturasPorArea.map((c, i) => <Cell key={i} fill={c.color} />)}
                        <Label
                          content={(props) => {
                            const vb = (props as { viewBox?: { cx?: number; cy?: number } }).viewBox
                            const cx = vb?.cx ?? 80
                            const cy = vb?.cy ?? 80
                            return (
                              <g>
                                <text x={cx} y={cy - 4} textAnchor="middle" fontSize={17} fontWeight={700} fill="#111827">
                                  {totalHaCulturas.toFixed(0)}
                                </text>
                                <text x={cx} y={cy + 13} textAnchor="middle" fontSize={10} fill="#9CA3AF" fontWeight={500}>
                                  ha total
                                </text>
                              </g>
                            )
                          }}
                          position="center"
                        />
                      </Pie>
                      <Tooltip
                        formatter={(v, _, entry) => [
                          `${Number(v)} ha · ${((Number(v) / totalHaCulturas) * 100).toFixed(1)}%`,
                          (entry as { payload?: { name: string } }).payload?.name ?? '',
                        ]}
                        contentStyle={{ border: 'none', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex-1 min-w-0 space-y-2.5">
                  {culturasPorArea.map((c) => {
                    const pct = totalHaCulturas > 0 ? ((c.value / totalHaCulturas) * 100).toFixed(1) : '0'
                    return (
                      <div key={c.name} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: c.color }} />
                        <span className="text-sm capitalize flex-1 truncate font-medium">{c.name}</span>
                        <span className="text-sm text-muted-foreground tabular-nums">{c.value} ha</span>
                        <span className="text-sm font-bold tabular-nums w-12 text-right" style={{ color: c.color }}>{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
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
                <EmptyState
                  size="sm"
                  icon={<Tractor className="h-4 w-4" />}
                  title="Nenhuma operação no campo"
                  description="As operações aparecerão aqui conforme forem registradas."
                />
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


// ─── Card Clima ────────────────────────────────────────────
interface FazendaBasic { nome: string; estado: string; municipio?: string | null }

function climaIcon(prob: number, tempMin: number, size: 'sm' | 'lg' | 'xl' = 'sm') {
  const cls = size === 'xl' ? 'h-14 w-14' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5'
  if (tempMin < 2)   return <AlertTriangle className={`${cls} text-red-500`} />
  if (prob > 60)     return <CloudRain     className={`${cls} text-blue-500`} />
  if (prob > 25)     return <CloudDrizzle  className={`${cls} text-sky-400`}  />
  if (prob > 10)     return <Cloud         className={`${cls} text-slate-400`} />
  return <Sun className={`${cls} text-yellow-400`} />
}

function climaLabel(prob: number, tempMin: number): string {
  if (tempMin < 2) return 'Risco de geada'
  if (prob > 60)   return 'Chuvoso'
  if (prob > 25)   return 'Pancadas'
  if (prob > 10)   return 'Nublado'
  return 'Ensolarado'
}

function ClimaCard({ clima, fazenda }: { clima: ClimaDay[] | null; fazenda: FazendaBasic | null }) {
  const hoje     = clima?.[0]
  const previsao = clima?.slice(0, 5) ?? []

  const locLabel = fazenda
    ? (fazenda.municipio && fazenda.municipio !== 'A preencher'
        ? `${fazenda.municipio}, ${fazenda.estado}`
        : `${fazenda.nome}, ${fazenda.estado}`)
    : 'Previsão do tempo'

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        {!clima ? (
          <div className="h-36 flex items-center justify-center text-sm text-muted-foreground animate-pulse px-6">
            Carregando previsão…
          </div>
        ) : !hoje ? (
          <div className="h-36 flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
            Coordenadas não configuradas para esta fazenda.
          </div>
        ) : (
          <>
            {/* ── Seção principal ── */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              {/* Esquerda: ícone + condição */}
              <div className="flex items-center gap-4">
                {climaIcon(hoje.precipitationProbability, hoje.tempMin, 'xl')}
                <div>
                  <p className="text-3xl font-bold leading-tight">
                    {climaLabel(hoje.precipitationProbability, hoje.tempMin)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />{locLabel}
                  </p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Droplets className="h-4 w-4 text-blue-500 shrink-0" />
                      {hoje.precipitationProbability}% chuva
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Wind className="h-4 w-4 shrink-0" />
                      {Math.round(hoje.windspeed)} km/h
                    </span>
                  </div>
                </div>
              </div>

              {/* Direita: temperatura */}
              <div className="text-right shrink-0 ml-4">
                <p className="text-6xl font-bold leading-none tabular-nums">
                  {Math.round(hoje.tempMax)}°
                </p>
                <p className="text-sm text-muted-foreground mt-2 tabular-nums">
                  {Math.round(hoje.tempMax)}° / {Math.round(hoje.tempMin)}°C
                </p>
              </div>
            </div>

            {/* ── Divisor ── */}
            <div className="h-px bg-border mx-4" />

            {/* ── Previsão 5 dias ── */}
            <div className="flex px-3 py-3">
              {previsao.map(d => {
                const dayAbbr = new Date(d.date + 'T12:00:00')
                  .toLocaleDateString('pt-BR', { weekday: 'short' })
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <p className="text-xs font-semibold text-muted-foreground capitalize">{dayAbbr}</p>
                    {climaIcon(d.precipitationProbability, d.tempMin, 'sm')}
                    <p className="text-base font-bold tabular-nums">{Math.round(d.tempMax)}°</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{Math.round(d.tempMin)}°</p>
                    <div className="flex items-center gap-0.5 mt-0.5">
                      <Droplets className="h-3 w-3 text-blue-400 shrink-0" />
                      <span className="text-xs text-muted-foreground">{d.precipitationProbability}%</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── Fonte ── */}
            <div className="flex justify-end px-4 pb-2.5">
              <a
                href="https://open-meteo.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                Dados: Open-Meteo ↗
              </a>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Card Cotações ──────────────────────────────────────────
const COMMODITY_LABELS: Record<string, string> = {
  soja:  'Soja',
  milho: 'Milho',
  trigo: 'Trigo',
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

function CotacoesCard({ cotacaoMap, onCotacoesAtualizadas }: {
  cotacaoMap: Record<string, Cotacao>
  onCotacoesAtualizadas: () => void
}) {
  const commodities = ['soja', 'milho', 'trigo']
  const temDados = commodities.some(c => !!cotacaoMap[c])
  const [rodando, setRodando] = useState(false)
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'erro'; msg: string } | null>(null)

  const hoje = new Date().toISOString().slice(0, 10)
  const desatualizados = temDados && commodities.some(c => cotacaoMap[c] && cotacaoMap[c].data < hoje)

  async function rodarJob() {
    setRodando(true)
    setFeedback(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/admin/run-cotacoes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setFeedback({ tipo: 'erro', msg: json.message ?? `Erro ${res.status}` })
        return
      }
      // Backend só responde ok após gravar — re-consulta imediata, sem race.
      setFeedback({ tipo: 'ok', msg: json.message ?? 'Cotações atualizadas.' })
      onCotacoesAtualizadas()
      setTimeout(() => setFeedback(null), 4000)
    } catch (e) {
      setFeedback({ tipo: 'erro', msg: e instanceof Error ? e.message : 'Erro de rede' })
    } finally {
      setRodando(false)
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            Cotações CBOT
            {desatualizados && (
              <span className="text-xs text-amber-600 normal-case font-medium">desatualizado</span>
            )}
          </CardTitle>
          <button
            onClick={rodarJob}
            disabled={rodando}
            title="Buscar cotações agora"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${rodando ? 'animate-spin' : ''}`} />
            {rodando ? 'Buscando…' : 'Atualizar'}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {feedback && (
          <p className={`text-xs mb-3 px-2 py-1.5 rounded ${feedback.tipo === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {feedback.msg}
          </p>
        )}
        {!temDados ? (
          <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
            {rodando ? 'Buscando cotações…' : 'Aguardando primeira cotação — clique em Atualizar.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {commodities.map(c => {
              const cot = cotacaoMap[c]
              return (
                <div key={c} className="bg-muted/40 rounded-lg p-3 text-center">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {COMMODITY_LABELS[c]}
                  </p>
                  {cot ? (
                    <>
                      <p className="text-lg font-bold mt-1 flex items-center justify-center gap-0.5">
                        <TrendingUp className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        {cot.preco_rs.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-muted-foreground">R$/sc · {cot.data.split('-').reverse().join('/')}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-2">—</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
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
