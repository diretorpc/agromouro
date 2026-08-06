'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Estoque } from '@/lib/types'

export function ExcluirInsumoDialog({
  item, onOpenChange, onExcluir,
}: {
  item: Estoque | null
  onOpenChange: (open: boolean) => void
  onExcluir: (item: Estoque) => Promise<{ ok: true } | { ok: false; erro: string }>
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  function fechar() { onOpenChange(false); setErro(null) }

  async function handleExcluir() {
    if (!item) return
    setExcluindo(true)
    setErro(null)
    const resultado = await onExcluir(item)
    setExcluindo(false)
    if (!resultado.ok) { setErro(resultado.erro); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={!!item} onOpenChange={open => { if (!open) fechar() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Excluir insumo?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Isso vai remover permanentemente{' '}
          <span className="font-medium text-foreground">{item?.insumos.nome}</span>{' '}
          e todo o seu histórico de movimentações. Esta ação não pode ser desfeita.
        </p>
        {erro && (
          <p aria-live="polite" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button variant="destructive" onClick={handleExcluir} disabled={excluindo}>
            {excluindo ? 'Excluindo…' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
