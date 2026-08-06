'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Estoque } from '@/lib/types'
import { UNIDADES, SELECT_CLASS } from '../../constants'

export function ConverterUnidadeDialog({
  item, onOpenChange, onConverter,
}: {
  item: Estoque | null
  onOpenChange: (open: boolean) => void
  onConverter: (item: Estoque, novaUnidade: string, fator: number) => Promise<void>
}) {
  const [form, setForm] = useState({ novaUnidade: 'L', fator: '' })
  const [salvando, setSalvando] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return
    const fator = parseFloat(form.fator.replace(',', '.'))
    if (isNaN(fator) || fator <= 0) return
    setSalvando(true)
    await onConverter(item, form.novaUnidade, fator)
    setSalvando(false)
    onOpenChange(false)
    setForm({ novaUnidade: 'L', fator: '' })
  }

  const fatorNum = parseFloat(form.fator.replace(',', '.'))

  return (
    <Dialog open={!!item} onOpenChange={open => { if (!open) onOpenChange(false) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Converter Unidade</DialogTitle></DialogHeader>
        {item && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Produto: <span className="font-medium text-foreground">{item.insumos.nome}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Situação atual:{' '}
              <span className="font-semibold text-amber-600">{item.quantidade_atual} {item.insumos.unidade}</span>
            </p>
            <div className="space-y-1.5">
              <Label>Nova unidade</Label>
              <select
                className={SELECT_CLASS} value={form.novaUnidade}
                onChange={e => setForm(f => ({ ...f, novaUnidade: e.target.value }))}
              >
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fator">
                Quantos <span className="font-semibold">{form.novaUnidade}</span> tem em 1{' '}
                <span className="font-semibold">{item.insumos.unidade}</span>?
              </Label>
              <Input
                id="fator" type="number" step="0.001" min="0.001" placeholder="Ex: 20"
                value={form.fator} onChange={e => setForm(f => ({ ...f, fator: e.target.value }))} required
              />
            </div>
            {form.fator && !isNaN(fatorNum) && (
              <p className="text-sm bg-muted rounded px-3 py-2">
                Resultado:{' '}
                <span className="font-semibold">
                  {(item.quantidade_atual * fatorNum).toFixed(2)} {form.novaUnidade}
                </span>
                {item.preco_medio_unitario > 0 && (
                  <> · preço{' '}
                    <span className="font-semibold">
                      R$ {(item.preco_medio_unitario / fatorNum).toFixed(2)}/{form.novaUnidade}
                    </span>
                  </>
                )}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={salvando || !form.fator}>{salvando ? 'Salvando…' : 'Converter'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
