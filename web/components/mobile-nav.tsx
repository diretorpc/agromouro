'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'

export function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Top bar only visible on mobile */}
      <header
        className="md:hidden flex items-center gap-3 px-4 py-3 sticky top-0 z-30 border-b"
        style={{ backgroundColor: '#F4F6F1' }}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir menu de navegação"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="font-extrabold text-sm tracking-tight">AGROMOURO</span>
      </header>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Slide-in drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegação"
        aria-hidden={!open}
        className={[
          'fixed inset-y-0 left-0 z-50 md:hidden',
          'transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <Sidebar onClose={() => setOpen(false)} />
      </div>
    </>
  )
}
