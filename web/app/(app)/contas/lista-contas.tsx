'use client'

import {
  CircleDollarSign, Ban, CheckCircle2, Undo2,
} from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { SortableTableHead } from '@/components/ui/sortable-table-head'
import { ENCERRADAS, type ContaAPI, type Conta } from './tipos'

// Declarado aqui (não em page.tsx) para não duplicar a mesma verdade em dois
// lugares — page.tsx importa este tipo de volta, mesmo padrão que `fmtBRL`
// já segue neste arquivo.
export type SortColuna = 'fornecedor' | 'descricao' | 'vencimento' | 'valor' | 'categoria'

type Props = {
  contas:          ContaAPI[]
  hoje:            string
  onPagar:         (c: ContaAPI) => void
  onDispensar:     (c: ContaAPI) => void
  onDesfazer:      (c: ContaAPI) => void
  onEditarValor:   (c: ContaAPI) => void
  onInformarData:  (c: ContaAPI) => void
  sortColuna:      SortColuna
  sortDirecao:     'asc' | 'desc'
  onSort:          (coluna: SortColuna) => void
}

// ─── Formatação (mesmo padrão do resto do site — ver financeiro/page.tsx) ─────
// fmtBRL é usado tanto aqui quanto nos cartões de KPI de page.tsx: fica definido
// uma vez só, aqui, e page.tsx importa de volta — DRY sem criar um arquivo novo
// de utilitário fora do que o brief da Task 8 pediu.

export function fmtBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(dateStr: string) {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR')
}

const STATUS_LABEL: Record<Conta['status'], string> = {
  aguardando: 'Aguardando',
  aberta:     'Aberta',
  paga:       'Paga',
  dispensada: 'Dispensada',
}

const STATUS_STYLE: Record<Conta['status'], string> = {
  aguardando: 'bg-amber-100 text-amber-700 border-amber-200',
  aberta:     'bg-blue-100 text-blue-700 border-blue-200',
  paga:       'bg-green-100 text-green-700 border-green-200',
  dispensada: 'bg-gray-100 text-gray-600 border-gray-200',
}

export function ListaContas({ contas, onPagar, onDispensar, onDesfazer, onEditarValor, onInformarData, sortColuna, sortDirecao, onSort }: Props) {
  return (
    <Table className="border-collapse [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border">
      <TableHeader>
        <TableRow>
          <SortableTableHead className="w-[220px]" ativo={sortColuna === 'fornecedor'} direcao={sortDirecao} onClick={() => onSort('fornecedor')}>Fornecedor</SortableTableHead>
          <SortableTableHead ativo={sortColuna === 'descricao'} direcao={sortDirecao} onClick={() => onSort('descricao')}>Descrição</SortableTableHead>
          <SortableTableHead className="w-[110px]" ativo={sortColuna === 'vencimento'} direcao={sortDirecao} onClick={() => onSort('vencimento')}>Vencimento</SortableTableHead>
          <SortableTableHead className="w-[150px] text-right" numeric ativo={sortColuna === 'valor'} direcao={sortDirecao} onClick={() => onSort('valor')}>Valor</SortableTableHead>
          <SortableTableHead className="w-[140px]" ativo={sortColuna === 'categoria'} direcao={sortDirecao} onClick={() => onSort('categoria')}>Categoria</SortableTableHead>
          <TableHead className="w-[110px]">Status</TableHead>
          <TableHead className="w-[60px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {contas.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
              Nenhuma conta para este filtro.
            </TableCell>
          </TableRow>
        ) : contas.map(conta => {
          const podeAgir = !ENCERRADAS.has(conta.status)
          // Conta sem vencimento troca o menu de ações por três botões visíveis
          // — para uma pessoa leiga, um problema que precisa de ação não pode
          // ficar escondido atrás de um menu de três pontinhos.
          const semVencimentoAcionavel = !conta.vencimento && podeAgir

          const acoes: ActionMenuItem[] = []
          if (podeAgir && conta.valor_estimado) {
            acoes.push({
              label: 'Registrar valor real',
              icon: <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />,
              onClick: () => onEditarValor(conta),
            })
          }
          if (podeAgir) {
            acoes.push({
              label: 'Marcar como paga',
              icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
              onClick: () => onPagar(conta),
            })
            acoes.push({
              label: 'Dispensar',
              icon: <Ban className="h-3.5 w-3.5" aria-hidden="true" />,
              onClick: () => onDispensar(conta),
              destructive: true,
            })
          }
          // Só conta paga: é a única que tem pagamento para desfazer.
          if (conta.status === 'paga') {
            acoes.push({
              label: 'Desfazer pagamento',
              icon: <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />,
              onClick: () => onDesfazer(conta),
              destructive: true,
            })
          }
          return (
            <TableRow key={conta.id}>
              <TableCell className="text-sm font-medium max-w-[220px] whitespace-normal break-words">
                {conta.fornecedor ?? '—'}
              </TableCell>
              <TableCell className="text-sm max-w-[280px]">
                <p className="truncate" title={conta.descricao}>{conta.descricao}</p>
                {conta.nota_fiscal_id && conta.notas_fiscais && (
                  <p className="text-xs text-muted-foreground">NF {conta.notas_fiscais.numero}</p>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                {conta.vencimento
                  ? fmtDate(conta.vencimento)
                  : <span className="text-amber-600 font-medium">vencimento não informado</span>}
              </TableCell>
              <TableCell className="text-right text-sm">
                {conta.valor !== null ? (
                  <div>
                    <p className="font-semibold tabular-nums">{fmtBRL(conta.valor)}</p>
                    {conta.valor_estimado && (
                      <Badge
                        variant="outline"
                        className="text-[10px] mt-0.5 bg-amber-50 text-amber-700 border-amber-200"
                      >
                        estimado
                      </Badge>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-sm">
                <Badge variant="outline" className="text-xs">
                  {conta.categoria ?? 'Sem categoria'}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={`text-xs ${STATUS_STYLE[conta.status]}`}>
                  {STATUS_LABEL[conta.status]}
                </Badge>
              </TableCell>
              <TableCell>
                {semVencimentoAcionavel ? (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" onClick={() => onInformarData(conta)}>Informar data</Button>
                    <Button size="sm" variant="outline" onClick={() => onPagar(conta)}>Já foi paga</Button>
                    <Button size="sm" variant="outline" onClick={() => onDispensar(conta)}>Sem boleto</Button>
                  </div>
                ) : (
                  acoes.length > 0 && (
                    <ActionMenu label={`Ações — ${conta.descricao}`} items={acoes} />
                  )
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
