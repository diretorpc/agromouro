'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

type FormState = {
  descricao: string
  fornecedor: string
  categoria: string
  vencimento: string
  valor: string
}

const FORM_VAZIO: FormState = {
  descricao: '',
  fornecedor: '',
  categoria: '',
  vencimento: '',
  valor: '',
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSalvo: () => void
}

export function FormularioContaAvulsa({ open, onOpenChange, onSalvo }: Props) {
  const [form, setForm]         = useState<FormState>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState<string | null>(null)

  function fechar() {
    onOpenChange(false)
    setForm(FORM_VAZIO)
    setErro(null)
  }

  const valorNum    = parseFloat(form.valor)
  const valorValido = form.valor !== '' && !isNaN(valorNum) && valorNum >= 0

  const podeSalvar = form.descricao.trim() !== '' && form.vencimento !== '' && valorValido

  async function handleSalvar() {
    if (!podeSalvar) {
      setErro('Preencha descrição, vencimento e valor.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      await api.post('/contas', {
        descricao:  form.descricao.trim(),
        fornecedor: form.fornecedor.trim() || undefined,
        categoria:  form.categoria.trim() || undefined,
        vencimento: form.vencimento,
        valor:      valorNum,
      })
      onSalvo()
      fechar()
    } catch (err) {
      console.error('[ContaAvulsa] Erro ao salvar:', err)
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar a conta. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) fechar() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova conta avulsa</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input
              placeholder="Ex: Conserto do trator"
              value={form.descricao}
              onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <Input
                placeholder="Opcional"
                value={form.fornecedor}
                onChange={e => setForm(f => ({ ...f, fornecedor: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Input
                placeholder="Opcional"
                value={form.categoria}
                onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vencimento</Label>
              <Input
                type="date"
                value={form.vencimento}
                onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor (R$)</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0,00"
                value={form.valor}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {erro && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{erro}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando || !podeSalvar}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
