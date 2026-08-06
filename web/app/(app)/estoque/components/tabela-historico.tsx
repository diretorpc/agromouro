'use client'

import { Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { Pencil, Trash2 } from 'lucide-react'
import { ORIGENS, SELECT_CLASS } from '../constants'
import type { MovimentacaoComFornecedor } from '../hooks/use-estoque-data'
import type { useFiltrosHistorico } from '../hooks/use-filtros-historico'
import { SortableTableHead } from './sortable-table-head'

type Filtros = ReturnType<typeof useFiltrosHistorico>

export function TabelaHistorico({
  filtros, onEditar, onExcluir,
}: {
  filtros: Filtros
  onEditar: (mov: MovimentacaoComFornecedor) => void
  onExcluir: (mov: MovimentacaoComFornecedor) => void
}) {
  const {
    busca, setBusca, filtroOrigem, setFiltroOrigem, ordenacao, direcao, toggleSort,
    movimentacoesFiltradas, filtroAtivo, limpar,
  } = filtros

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Histórico de Movimentações</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome do produto…"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <select
            aria-label="Filtrar por origem"
            className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[160px]'}
            value={filtroOrigem}
            onChange={e => setFiltroOrigem(e.target.value as typeof filtroOrigem)}
          >
            <option value="todos">Todas origens</option>
            {ORIGENS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {filtroAtivo && (
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={limpar}>
              Limpar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Mostrando as últimas 100 movimentações.</p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead campo="data" ordenacao={ordenacao} direcao={direcao} onSort={toggleSort}>Data</SortableTableHead>
              <SortableTableHead campo="insumo" ordenacao={ordenacao} direcao={direcao} onSort={toggleSort}>Insumo</SortableTableHead>
              <SortableTableHead campo="tipo" ordenacao={ordenacao} direcao={direcao} onSort={toggleSort}>Tipo</SortableTableHead>
              <SortableTableHead campo="quantidade" ordenacao={ordenacao} direcao={direcao} onSort={toggleSort} className="text-right">Quantidade</SortableTableHead>
              <SortableTableHead campo="origem" ordenacao={ordenacao} direcao={direcao} onSort={toggleSort}>Origem</SortableTableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {movimentacoesFiltradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {filtroAtivo ? 'Nenhuma movimentação corresponde aos filtros aplicados.' : 'Nenhuma movimentação registrada.'}
                </TableCell>
              </TableRow>
            ) : movimentacoesFiltradas.map(m => {
              const menuItems: ActionMenuItem[] = [{
                label: 'Excluir', destructive: true,
                icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
                onClick: () => onExcluir(m),
              }]
              return (
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
                  <TableCell className="text-right font-medium tabular-nums">
                    {m.quantidade} {m.insumos.unidade}
                  </TableCell>
                  <TableCell>
                    <OrigemLabel origem={m.origem} fornecedor={m.fornecedor_nome} talhao={m.talhao_nome} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onEditar(m)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        Editar
                      </Button>
                      <ActionMenu items={menuItems} label={`Mais ações — movimentação de ${m.insumos.nome}`} />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
            <TooltipContent side="top" className="max-w-xs text-xs">{fornecedor}</TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }
  if (origem === 'operacao') {
    return (
      <div>
        <p className="text-xs text-muted-foreground">🌾 Operação</p>
        {talhao && <p className="text-xs font-medium text-foreground">{talhao}</p>}
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
