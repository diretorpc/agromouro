'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox } from '@/components/ui/combobox'
import { api } from '@/lib/api'

type FormState = {
  descricao: string
  fornecedor: string
  categoria: string
  vencimento: string
  valor: string
  parcelado: boolean
  quantidadeParcelas: string
}

const FORM_VAZIO: FormState = {
  descricao: '',
  fornecedor: '',
  categoria: '',
  vencimento: '',
  valor: '',
  parcelado: false,
  quantidadeParcelas: '',
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSalvo: () => void
  categoriasExistentes: string[]
}

export function FormularioContaAvulsa({ open, onOpenChange, onSalvo, categoriasExistentes }: Props) {
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

  const parcelasNum    = parseInt(form.quantidadeParcelas, 10)
  const parcelasValido = !form.parcelado ||
    (Number.isInteger(parcelasNum) && parcelasNum >= 2 && parcelasNum <= 60)

  const podeSalvar = form.descricao.trim() !== '' && form.vencimento !== '' && valorValido && parcelasValido

  async function handleSalvar() {
    if (!podeSalvar) {
      setErro(form.parcelado && !parcelasValido
        ? 'Quantidade de parcelas precisa ser um número entre 2 e 60.'
        : 'Preencha descrição, vencimento e valor.')
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
        parcelas:   form.parcelado ? parcelasNum : undefined,
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
              <Combobox
                placeholder="Opcional"
                value={form.categoria}
                onValueChange={categoria => setForm(f => ({ ...f, categoria }))}
                items={categoriasExistentes}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{form.parcelado ? 'Vencimento da 1ª parcela' : 'Vencimento'}</Label>
              <Input
                type="date"
                value={form.vencimento}
                onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor (R$){form.parcelado ? ' — de cada parcela' : ''}</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0,00"
                value={form.valor}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.parcelado}
              onChange={e => setForm(f => ({ ...f, parcelado: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 accent-green-600"
            />
            Parcelar esta conta
          </label>

          {form.parcelado && (
            <div className="space-y-1.5">
              <Label>Quantidade de parcelas</Label>
              <Input
                type="number" min="2" max="60" placeholder="Ex: 4"
                value={form.quantidadeParcelas}
                onChange={e => setForm(f => ({ ...f, quantidadeParcelas: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Cria {form.parcelado && parcelasValido ? parcelasNum : 'N'} contas, uma por mês a
                partir do vencimento acima, todas com o mesmo valor.
              </p>
            </div>
          )}
        </div>

        {erro && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{erro}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando || !podeSalvar}>
            {salvando
              ? 'Salvando…'
              : form.parcelado && parcelasValido
                ? `Salvar ${parcelasNum} parcelas`
                : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
