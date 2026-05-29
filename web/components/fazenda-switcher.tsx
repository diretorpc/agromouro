'use client'

import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useFazenda } from '@/context/fazenda-context'
import { cn } from '@/lib/utils'

const ESTADO_ICON: Record<string, string> = {
  MG: '🌿',
  SP: '🌾',
  MT: '🌻',
}

export function FazendaSwitcher() {
  const { fazendaAtiva, fazendas, switchFazenda, loading } = useFazenda()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  // Não renderizar se só tiver 1 fazenda ou ainda carregando
  if (loading || !fazendaAtiva || fazendas.length <= 1) return null

  async function handleSwitch(fazendaId: string) {
    if (fazendaId === fazendaAtiva?.id) { setOpen(false); return }
    setSwitching(true)
    setOpen(false)
    try {
      await switchFazenda(fazendaId)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="relative px-3 pb-3">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={switching}
        className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-white/70 hover:text-white hover:bg-white/8 transition-all disabled:opacity-50"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{ESTADO_ICON[fazendaAtiva.estado] ?? '🏡'}</span>
          <span className="truncate">{fazendaAtiva.nome}</span>
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <>
          {/* Backdrop — fecha ao clicar fora */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-white/10 bg-[#192d08] shadow-2xl overflow-hidden">
            {fazendas.map(f => (
              <button
                key={f.id}
                onClick={() => handleSwitch(f.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] hover:bg-white/8 transition-colors text-left"
              >
                <span className="shrink-0">{ESTADO_ICON[f.estado] ?? '🏡'}</span>
                <span className={cn(
                  'flex-1 truncate font-medium',
                  f.id === fazendaAtiva.id ? 'text-white' : 'text-white/55'
                )}>
                  {f.nome}
                </span>
                {f.id === fazendaAtiva.id && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[#8FB840]" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
