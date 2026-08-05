'use client'

import { Package, Plus, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { Trash2 } from 'lucide-react'
import type { Estoque } from '@/lib/types'
import { TIPOS, UNIDADES_BASE, SELECT_CLASS } from '../constants'
import { formatTipoInsumo } from '@/lib/insumos'
import type { useFiltrosProdutos } from '../hooks/use-filtros-produtos'

type Filtros = ReturnType<typeof useFiltrosProdutos>

export function TabelaProdutos({
  estoque, filtros, onNovoInsumo, onAjustar, onConverter, onExcluir,
}: {
  estoque: Estoque[]
  filtros: Filtros
  onNovoInsumo: () => void
  onAjustar: (item: Estoque) => void
  onConverter: (item: Estoque) => void
  onExcluir: (item: Estoque) => void
}) {
  const {
    busca, setBusca, filtroTipo, setFiltroTipo, filtroStatus, setFiltroStatus,
    ordenacao, setOrdenacao, estoqueFiltrado, filtroAtivo, limpar,
  } = filtros

  const situacaoBadge = (negativo: boolean, critico: boolean) =>
    negativo ? <Badge variant="destructive" className="font-bold">Negativo</Badge>
    : critico ? <Badge variant="destructive">Crítico</Badge>
    : <Badge variant="outline" className="text-green-700 border-green-200">OK</Badge>

  const acoesInsumo = (item: Estoque) => {
    const menuItems: ActionMenuItem[] = []
    if (!UNIDADES_BASE.has(item.insumos.unidade)) {
      menuItems.push({ label: 'Converter Unidade', onClick: () => onConverter(item) })
    }
    menuItems.push({
      label: 'Excluir', destructive: true,
      icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
      onClick: () => onExcluir(item),
    })
    return (
      <>
        <Button size="sm" variant="ghost" onClick={() => onAjustar(item)}>Ajustar</Button>
        <ActionMenu items={menuItems} label={`Mais ações — ${item.insumos.nome}`} />
      </>
    )
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Insumos
            {filtroAtivo && (
              <span className="text-xs font-normal text-muted-foreground ml-1">
                {estoqueFiltrado.length} de {estoque.length}
              </span>
            )}
          </CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome…"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <select
            aria-label="Filtrar por tipo"
            className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[140px]'}
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
          >
            <option value="todos">Todos os tipos</option>
            {TIPOS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar por situação"
            className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[140px]'}
            value={filtroStatus}
            onChange={e => setFiltroStatus(e.target.value as typeof filtroStatus)}
          >
            <option value="todos">Todas situações</option>
            <option value="ok">OK</option>
            <option value="critico">Crítico</option>
            <option value="negativo">Negativo</option>
          </select>
          <select
            aria-label="Ordenar por"
            className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[140px]'}
            value={ordenacao}
            onChange={e => setOrdenacao(e.target.value as typeof ordenacao)}
          >
            <option value="recentes">Mais recentes</option>
            <option value="nome">Nome (A-Z)</option>
          </select>
          {filtroAtivo && (
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={limpar}>
              Limpar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {estoque.length === 0 ? (
          <div className="py-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">Nenhum insumo cadastrado</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cadastre seu primeiro insumo ou importe via NF-e.
                </p>
              </div>
              <Button size="sm" onClick={onNovoInsumo}>
                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Cadastrar insumo
              </Button>
            </div>
          </div>
        ) : estoqueFiltrado.length === 0 ? (
          <div className="py-10">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">Nenhum insumo corresponde aos filtros aplicados.</p>
              <Button variant="ghost" size="sm" onClick={limpar}>Limpar filtros</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop: tabela */}
            <Table className="hidden md:table">
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
                {estoqueFiltrado.map(item => {
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
                      <TableCell className={`font-medium max-w-[180px] ${negativo ? 'font-bold' : ''}`}>
                        <Tooltip>
                          <TooltipTrigger className="truncate block w-full text-left cursor-default bg-transparent border-0 p-0 font-[inherit]">
                            {item.insumos.nome}
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            {item.insumos.nome}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {formatTipoInsumo(item.insumos.tipo)}
                        </span>
                      </TableCell>
                      <TableCell className={qtdClass}>
                        {item.quantidade_atual} {item.insumos.unidade}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {item.preco_medio_unitario > 0 ? `R$ ${item.preco_medio_unitario.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right">{situacaoBadge(negativo, critico)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">{acoesInsumo(item)}</div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Mobile: cards */}
            <ul className="md:hidden divide-y">
              {estoqueFiltrado.map(item => {
                const negativo = item.quantidade_atual < 0
                const critico  = !negativo && item.quantidade_atual <= item.quantidade_minima_alerta
                const linhaBg  = negativo ? 'bg-red-100' : critico ? 'bg-red-50/50' : ''
                const qtdColor = negativo ? 'font-bold text-red-700' : critico ? 'font-semibold text-red-600' : 'font-semibold'
                return (
                  <li key={item.id} className={`px-4 py-3 ${linhaBg}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${negativo ? 'font-bold' : ''}`}>{item.insumos.nome}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatTipoInsumo(item.insumos.tipo)}
                        </p>
                      </div>
                      {situacaoBadge(negativo, critico)}
                    </div>
                    <div className="flex items-end justify-between gap-2 mt-2">
                      <p className="text-sm tabular-nums">
                        <span className={qtdColor}>{item.quantidade_atual} {item.insumos.unidade}</span>
                        <span className="text-muted-foreground">
                          {' · '}{item.preco_medio_unitario > 0 ? `R$ ${item.preco_medio_unitario.toFixed(2)}` : '—'}
                        </span>
                      </p>
                      <div className="flex items-center gap-1 shrink-0">{acoesInsumo(item)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
