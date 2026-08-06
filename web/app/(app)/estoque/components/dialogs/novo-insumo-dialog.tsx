'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TIPOS, UNIDADES, SELECT_CLASS } from '../../constants'

const FORM_INICIAL = { nome: '', tipo: 'herbicida', unidade: 'L', quantidade: '0', minimo: '0', preco: '' }

export function NovoInsumoDialog({
  open, onOpenChange, onCriar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCriar: (form: { nome: string; tipo: string; unidade: string; quantidade: number; minimo: number; preco: number }) => Promise<void>
}) {
  const [form, setForm] = useState(FORM_INICIAL)
  const [salvando, setSalvando] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    await onCriar({
      nome: form.nome.trim(),
      tipo: form.tipo,
      unidade: form.unidade,
      quantidade: parseFloat(form.quantidade) || 0,
      minimo: parseFloat(form.minimo) || 0,
      preco: parseFloat(form.preco) || 0,
    })
    setSalvando(false)
    onOpenChange(false)
    setForm(FORM_INICIAL)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo Insumo</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome do produto</Label>
            <Input
              id="nome"
              placeholder="Ex: Roundup Original"
              value={form.nome}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <select
                id="tipo" className={SELECT_CLASS} value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
              >
                {TIPOS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unidade">Unidade</Label>
              <select
                id="unidade" className={SELECT_CLASS} value={form.unidade}
                onChange={e => setForm(f => ({ ...f, unidade: e.target.value }))}
              >
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="quantidade">Qtd. inicial</Label>
              <Input
                id="quantidade" type="number" step="0.01" min="0"
                value={form.quantidade}
                onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minimo">Qtd. mínima (alerta)</Label>
              <Input
                id="minimo" type="number" step="0.01" min="0"
                value={form.minimo}
                onChange={e => setForm(f => ({ ...f, minimo: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="preco">Preço médio unitário (R$) <span className="text-muted-foreground text-xs">opcional</span></Label>
            <Input
              id="preco" type="number" step="0.01" min="0" placeholder="0,00"
              value={form.preco}
              onChange={e => setForm(f => ({ ...f, preco: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Adicionar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
