'use client'

import { ArrowUp, ArrowDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type Props = {
  ativo: boolean
  direcao: 'asc' | 'desc'
  onClick: () => void
  className?: string
  style?: React.CSSProperties
  numeric?: boolean
  children: React.ReactNode
  resizeHandle?: React.ReactNode
}

// Cabeçalho de tabela clicável, com seta indicando a coluna ativa e a direção
// da ordenação. Usado em Financeiro e Contas a Pagar — mesmo padrão visual
// que a coluna "Data" do Financeiro já tinha antes desta mudança existir em
// mais de um lugar (12 usos ao todo, por isso virou componente compartilhado
// em vez de repetir o botão em cada arquivo).
//
// `resizeHandle` é opcional e renderiza FORA do <button> (irmão dele, dentro
// do <th>) — nunca dentro, porque um <div> arrastável dentro de um <button>
// disputaria o clique de ordenar com o gesto de arrastar. `relative` no <th>
// é o que permite o handle (que usa `absolute`) se posicionar na borda.
export function SortableTableHead({ ativo, direcao, onClick, className, style, numeric, children, resizeHandle }: Props) {
  return (
    <TableHead className={cn('relative', className)} style={style}>
      <button
        onClick={onClick}
        className={`flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors${numeric ? ' justify-end w-full' : ''}`}
        aria-label={
          ativo
            ? `Ordenado por esta coluna, ${direcao === 'asc' ? 'crescente' : 'decrescente'}. Clique para inverter`
            : 'Clique para ordenar por esta coluna'
        }
      >
        {children}
        {ativo && (direcao === 'asc'
          ? <ArrowUp className="h-3 w-3" aria-hidden="true" />
          : <ArrowDown className="h-3 w-3" aria-hidden="true" />)}
      </button>
      {resizeHandle}
    </TableHead>
  )
}
