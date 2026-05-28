'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ActionMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  destructive?: boolean
}

export function ActionMenu({ items, label = 'Mais ações' }: { items: ActionMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <Button
        size="sm"
        variant="ghost"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-input bg-background shadow-lg py-1"
        >
          {items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick() }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors',
                item.destructive ? 'text-red-600 hover:text-red-700' : 'text-foreground'
              )}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
