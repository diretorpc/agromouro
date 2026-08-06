'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SELECT_CLASS } from '../../constants'
import type { MovimentacaoComFornecedor } from '../../hooks/use-estoque-data'

export function EditarMovimentacaoDialog({
  mov, onOpenChange, onEditar,
}: {
  mov: MovimentacaoComFornecedor | null
  onOpenChange: (open: boolean) => void
  onEditar: (mov: MovimentacaoComFornecedor, novoTipo: 'entrada' | 'saida', novaQuantidade: number, novaData: string) => Promise<void>
}) {
  const [form, setForm] = useState({ tipo: 'entrada' as 'entrada' | 'saida', quantidade: '', data: '' })
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (mov) setForm({ tipo: mov.tipo, quantidade: String(mov.quantidade), data: mov.data.slice(0, 10) })
  }, [mov])

  async function handleSalvar() {
    if (!mov) return
    setSalvando(true)
    await onEditar(mov, form.tipo, parseFloat(form.quantidade) || 0, form.data)
    setSalvando(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={!!mov} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Editar Movimentação</DialogTitle></DialogHeader>
        {mov && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Insumo: <span className="font-medium text-foreground">{mov.insumos.nome}</span>
            </p>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <select
                className={SELECT_CLASS} value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value as 'entrada' | 'saida' }))}
              >
                <option value="entrada">+ Entrada</option>
                <option value="saida">− Saída</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantidade ({mov.insumos.unidade})</Label>
              <Input
                type="number" step="0.01" min="0" value={form.quantidade}
                onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando || !form.quantidade}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
