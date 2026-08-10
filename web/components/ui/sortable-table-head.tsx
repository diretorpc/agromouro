'use client'

import { ArrowUp, ArrowDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'

type Props = {
  ativo: boolean
  direcao: 'asc' | 'desc'
  onClick: () => void
  className?: string
  numeric?: boolean
  children: React.ReactNode
}

// Cabeçalho de tabela clicável, com seta indicando a coluna ativa e a direção
// da ordenação. Usado em Financeiro e Contas a Pagar — mesmo padrão visual
// que a coluna "Data" do Financeiro já tinha antes desta mudança existir em
// mais de um lugar (12 usos ao todo, por isso virou componente compartilhado
// em vez de repetir o botão em cada arquivo).
export function SortableTableHead({ ativo, direcao, onClick, className, numeric, children }: Props) {
  return (
    <TableHead className={className}>
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
    </TableHead>
  )
}
