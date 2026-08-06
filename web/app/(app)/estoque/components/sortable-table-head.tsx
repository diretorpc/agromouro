'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export function SortableTableHead<T extends string>({
  campo, ordenacao, direcao, onSort, children, className,
}: {
  campo: T
  ordenacao: T | null
  direcao: 'asc' | 'desc'
  onSort: (campo: T) => void
  children: React.ReactNode
  className?: string
}) {
  const ativo = ordenacao === campo
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(campo)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground transition-colors',
          ativo && 'text-foreground font-semibold'
        )}
      >
        {children}
        {ativo && (direcao === 'asc' ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />)}
      </button>
    </TableHead>
  )
}
