'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, LabelList, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'

type ItemOperacao = {
  id: string
  insumo_id: string | null
  descricao: string | null
  quantidade: number
  unidade: string | null
  insumos?: { nome: string }
}

type OperacaoRaw = {
  id: string
  talhao_id: string
  tipo: string
  data: string
  talhoes?: { id: string; nome: string; area_ha: number }
  itens_operacao?: ItemOperacao[]
}

type ItemComCusto = {
  id: string
  nome: string
  quantidade: number
  unidade: string | null
  preco_unitario: number
  custo: number
}

type OperacaoComCusto = {
  id: string
  tipo: string
  data: string
  custo: number
  itens: ItemComCusto[]
}

type TalhaoStats = {
  id: string
  nome: string
  area_ha: number
  custo_total: number
  custo_por_ha: number
  por_tipo: Record<string, number>
  operacoes: OperacaoComCusto[]
}

const TIPO_LABEL: Record<string, string> = {
  pulverizacao: 'Pulverização',
  adubacao:     'Adubação',
  plantio:      'Plantio',
  colheita:     'Colheita',
  calagem:      'Calagem',
  irrigacao:    'Irrigação',
  outro:        'Outro',
}

const TIPO_COLOR: Record<string, string> = {
  pulverizacao: '#ef4444',
  adubacao:     '#f59e0b',
  plantio:      '#22c55e',
  colheita:     '#f97316',
  calagem:      '#a855f7',
  irrigacao:    '#06b6d4',
  outro:        '#9ca3af',
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtNum(v: number, dec = 2) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

export default function CustosPage() {
  const [talhoes, setTalhoes]     = useState<TalhaoStats[]>([])
  const [loading, setLoading]     = useState(true)
  const [semPreco, setSemPreco]   = useState(0)
  const [expandido, setExpandido] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [resOps, resEstoque] = await Promise.all([
      supabase
        .from('operacoes')
        .select('id, talhao_id, tipo, data, talhoes(id, nome, area_ha), itens_operacao(id, insumo_id, descricao, quantidade, unidade, insumos(nome))')
        .order('data', { ascending: false }),
      supabase
        .from('estoque')
        .select('insumo_id, preco_medio_unitario'),
    ])

    if (resOps.error)     console.error('[Custos] operacoes:', resOps.error)
    if (resEstoque.error) console.error('[Custos] estoque:',   resEstoque.error)

    const precoMap = new Map<string, number>()
    ;((resEstoque.data ?? []) as unknown as { insumo_id: string; preco_medio_unitario: number | null }[])
      .forEach(e => {
        if (e.preco_medio_unitario) precoMap.set(e.insumo_id, e.preco_medio_unitario)
      })

    let usosSemPreco = 0
    const talhaoMap = new Map<string, TalhaoStats>()

    ;((resOps.data ?? []) as unknown as OperacaoRaw[]).forEach((op: OperacaoRaw) => {
      const t = op.talhoes
      if (!t) return

      if (!talhaoMap.has(op.talhao_id)) {
        talhaoMap.set(op.talhao_id, {
          id: t.id, nome: t.nome, area_ha: t.area_ha,
          custo_total: 0, custo_por_ha: 0, por_tipo: {}, operacoes: [],
        })
      }

      const stats = talhaoMap.get(op.talhao_id)!

      const itens: ItemComCusto[] = (op.itens_operacao ?? []).map(item => {
        const preco = item.insumo_id ? (precoMap.get(item.insumo_id) ?? 0) : 0
        if (item.insumo_id && preco === 0) usosSemPreco++
        return {
          id:             item.id,
          nome:           item.insumos?.nome ?? item.descricao ?? '—',
          quantidade:     item.quantidade,
          unidade:        item.unidade,
          preco_unitario: preco,
          custo:          item.quantidade * preco,
        }
      })

      const custoOp = itens.reduce((s, i) => s + i.custo, 0)
      stats.custo_total += custoOp
      stats.por_tipo[op.tipo] = (stats.por_tipo[op.tipo] ?? 0) + custoOp
      stats.operacoes.push({ id: op.id, tipo: op.tipo, data: op.data, custo: custoOp, itens })
    })

    const result = Array.from(talhaoMap.values())
      .map(t => ({ ...t, custo_por_ha: t.area_ha > 0 ? t.custo_total / t.area_ha : 0 }))
      .sort((a, b) => b.custo_total - a.custo_total)

    setSemPreco(usosSemPreco)
    setTalhoes(result)
    setLoading(false)
  }

  const totalGeral    = talhoes.reduce((s, t) => s + t.custo_total, 0)
  const totalOps      = talhoes.reduce((s, t) => s + t.operacoes.length, 0)
  const maisCaroPorHa = talhoes.length > 0
    ? talhoes.reduce((max, t) => t.custo_por_ha > max.custo_por_ha ? t : max, talhoes[0])
    : null

  const chartHa = talhoes
    .filter(t => t.custo_total > 0)
    .map(t => ({ nome: t.nome, valor: parseFloat(t.custo_por_ha.toFixed(2)) }))

  const tiposPresentes = Array.from(new Set(talhoes.flatMap(t => Object.keys(t.por_tipo).filter(k => t.por_tipo[k] > 0))))
  const chartStacked = talhoes
    .filter(t => t.custo_total > 0)
    .map(t => ({
      nome: t.nome,
      ...Object.fromEntries(tiposPresentes.map(tipo => [tipo, parseFloat((t.por_tipo[tipo] ?? 0).toFixed(2))])),
    }))

  if (loading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Custo por Talhão</h1>

      {semPreco > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <b>{semPreco} uso(s)</b> de insumo sem preço — importe uma NF-e para preencher automaticamente ou edite o preço direto no Estoque.
          </span>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm text-muted-foreground font-medium">Total Gasto nas Operações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtBRL(totalGeral)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{totalOps} operações registradas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm text-muted-foreground font-medium">Talhão Mais Caro (R$/ha)</CardTitle>
          </CardHeader>
          <CardContent>
            {maisCaroPorHa && maisCaroPorHa.custo_total > 0 ? (
              <>
                <p className="text-2xl font-bold">
                  {fmtBRL(maisCaroPorHa.custo_por_ha)}
                  <span className="text-sm font-normal text-muted-foreground">/ha</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{maisCaroPorHa.nome}</p>
              </>
            ) : (
              <p className="text-2xl font-bold text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm text-muted-foreground font-medium">Talhões Monitorados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{talhoes.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {talhoes.reduce((s, t) => s + t.area_ha, 0).toFixed(0)} ha no total
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico: custo/ha por talhão */}
      {chartHa.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Custo por Hectare — Comparativo entre Talhões</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={Math.max(chartHa.length * 52 + 16, 80)}>
              <BarChart data={chartHa} layout="vertical" margin={{ top: 0, right: 110, bottom: 0, left: 8 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 13 }} tickLine={false} axisLine={false} />
                <RechartsTooltip
                  formatter={(v: unknown) => [fmtBRL(Number(v ?? 0)) + '/ha', 'Custo']}
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]} fill="#4a7c20">
                  <LabelList
                    dataKey="valor"
                    position="right"
                    formatter={(v: unknown) => fmtBRL(Number(v ?? 0))}
                    style={{ fontSize: 13, fill: '#6b7280' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Gráfico: custo empilhado por tipo de operação */}
      {chartStacked.length > 0 && tiposPresentes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Custo por Tipo de Operação — por Talhão</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={Math.max(chartStacked.length * 52 + 48, 100)}>
              <BarChart data={chartStacked} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 8 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 13 }} tickLine={false} axisLine={false} />
                <RechartsTooltip
                  formatter={(v: unknown, name: unknown) => [
                    fmtBRL(Number(v ?? 0)),
                    TIPO_LABEL[String(name)] ?? String(name),
                  ]}
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
                <Legend
                  formatter={(value) => TIPO_LABEL[value] ?? value}
                  wrapperStyle={{ fontSize: 12 }}
                />
                {tiposPresentes.map(tipo => (
                  <Bar key={tipo} dataKey={tipo} stackId="a" fill={TIPO_COLOR[tipo] ?? '#9ca3af'} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Tabela detalhada expandível */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalhamento por Talhão</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {talhoes.length === 0 ? (
            <p className="text-center text-muted-foreground py-10 text-sm">
              Nenhuma operação com custo registrado ainda.
            </p>
          ) : (
            <div className="divide-y">
              {talhoes.map(t => (
                <div key={t.id}>
                  <button
                    onClick={() => setExpandido(expandido === t.id ? null : t.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                  >
                    {expandido === t.id
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}

                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm">{t.nome}</span>
                      <span className="text-xs text-muted-foreground ml-2">{fmtNum(t.area_ha, 0)} ha</span>
                    </div>

                    <div className="flex items-center gap-6 shrink-0 text-sm">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="font-semibold">{fmtBRL(t.custo_total)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Por ha</p>
                        <p className="font-semibold">{fmtBRL(t.custo_por_ha)}</p>
                      </div>
                      <div className="text-right w-16">
                        <p className="text-xs text-muted-foreground">Operações</p>
                        <p className="font-semibold">{t.operacoes.length}</p>
                      </div>
                    </div>
                  </button>

                  {expandido === t.id && (
                    <div className="bg-muted/20 border-t">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-10 w-28">Data</TableHead>
                            <TableHead className="w-36">Tipo</TableHead>
                            <TableHead>Produtos</TableHead>
                            <TableHead className="text-right w-36">Custo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {t.operacoes.map(op => (
                            <TableRow key={op.id}>
                              <TableCell className="pl-10 text-sm text-muted-foreground whitespace-nowrap">
                                {op.data.slice(0, 10).split('-').reverse().join('/')}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">
                                  {TIPO_LABEL[op.tipo] ?? op.tipo}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {op.itens.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {op.itens.map(item => (
                                      <div key={item.id} className="text-xs flex flex-wrap gap-x-2">
                                        <span className="font-medium">{item.nome}</span>
                                        <span className="text-muted-foreground">
                                          {fmtNum(item.quantidade)} {item.unidade}
                                          {item.preco_unitario > 0 && (
                                            <> × {fmtBRL(item.preco_unitario)}</>
                                          )}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {op.custo > 0
                                  ? <span className="font-semibold text-sm">{fmtBRL(op.custo)}</span>
                                  : <span className="text-xs text-muted-foreground">sem preço</span>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map(i => <div key={i} className="h-24 bg-muted rounded-xl" />)}
      </div>
      <div className="h-48 bg-muted rounded-xl" />
      <div className="h-48 bg-muted rounded-xl" />
      <div className="h-72 bg-muted rounded-xl" />
    </div>
  )
}
