import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

export function EmptyState({ icon, title, description, action, size = 'md', className }: EmptyStateProps) {
  const iconSize  = size === 'sm' ? 'h-10 w-10' : 'h-14 w-14'
  const iconInner = size === 'sm' ? 'h-4 w-4'   : 'h-6 w-6'
  const py        = size === 'sm' ? 'py-8'       : 'py-12'

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 text-center', py, className)}>
      <div className={cn('rounded-full bg-muted flex items-center justify-center shrink-0', iconSize)}>
        <span className={cn('text-muted-foreground', iconInner)}>{icon}</span>
      </div>
      <div className="space-y-1 max-w-xs">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
