'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Estoque } from '@/lib/types'

export function AjustarEstoqueDialog({
  item, onOpenChange, onAjustar,
}: {
  item: Estoque | null
  onOpenChange: (open: boolean) => void
  onAjustar: (
    item: Estoque, novaQuantidade: number, novoPreco: number | null,
  ) => Promise<{ ok: true } | { ok: false; erro: string }>
}) {
  const [ajuste, setAjuste] = useState('')
  const [ajustePreco, setAjustePreco] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (item) {
      setAjuste(String(item.quantidade_atual))
      setAjustePreco(item.preco_medio_unitario > 0 ? String(item.preco_medio_unitario) : '')
      setErro(null)
    }
  }, [item])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return
    const novaQtd = parseFloat(ajuste)
    if (isNaN(novaQtd)) return
    setSalvando(true)
    setErro(null)
    const novoPreco = parseFloat(ajustePreco)
    const resultado = await onAjustar(item, novaQtd, !isNaN(novoPreco) && novoPreco >= 0 ? novoPreco : null)
    setSalvando(false)
    if (!resultado.ok) { setErro(resultado.erro); return }
    onOpenChange(false)
    setAjuste('')
    setAjustePreco('')
  }

  function fechar() { onOpenChange(false); setAjustePreco(''); setErro(null) }

  return (
    <Dialog open={!!item} onOpenChange={open => { if (!open) fechar() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ajustar Estoque</DialogTitle></DialogHeader>
        {item && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Produto: <span className="font-medium text-foreground">{item.insumos.nome}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Quantidade atual:{' '}
              <span className="font-medium text-foreground">{item.quantidade_atual} {item.insumos.unidade}</span>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="ajuste">Nova quantidade ({item.insumos.unidade})</Label>
              <Input id="ajuste" type="number" step="0.01" value={ajuste} onChange={e => setAjuste(e.target.value)} required />
              <p className="text-xs text-muted-foreground">
                Valores negativos são permitidos (estoque vai aparecer em vermelho).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ajuste-preco">
                Preço unitário (R$) <span className="text-muted-foreground text-xs">opcional</span>
              </Label>
              <Input
                id="ajuste-preco" type="number" step="0.01" min="0" placeholder="0,00"
                value={ajustePreco} onChange={e => setAjustePreco(e.target.value)}
              />
            </div>
            {erro && (
              <p aria-live="polite" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {erro}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={fechar}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
