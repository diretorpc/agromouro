'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { MovimentacaoComFornecedor } from '../../hooks/use-estoque-data'

export function ExcluirMovimentacaoDialog({
  mov, onOpenChange, onExcluir,
}: {
  mov: MovimentacaoComFornecedor | null
  onOpenChange: (open: boolean) => void
  onExcluir: (mov: MovimentacaoComFornecedor) => Promise<{ ok: true } | { ok: false; erro: string }>
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  function fechar() { onOpenChange(false); setErro(null) }

  async function handleExcluir() {
    if (!mov) return
    setExcluindo(true)
    setErro(null)
    const resultado = await onExcluir(mov)
    setExcluindo(false)
    if (!resultado.ok) { setErro(resultado.erro); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={!!mov} onOpenChange={open => { if (!open) fechar() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Excluir movimentação?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Será removida a {mov?.tipo === 'entrada' ? 'entrada' : 'saída'} de{' '}
          <span className="font-medium text-foreground">{mov?.quantidade} {mov?.insumos.unidade}</span>{' '}
          de <span className="font-medium text-foreground">{mov?.insumos.nome}</span>.
          O saldo do estoque será ajustado automaticamente.
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
