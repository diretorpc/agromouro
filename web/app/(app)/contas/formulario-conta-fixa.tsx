'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { api } from '@/lib/api'

// ─── Constantes ─────────────────────────────────────────────────────────────

type Periodicidade = 'mensal' | 'bimestral' | 'trimestral' | 'semestral' | 'anual'

const PERIODICIDADES: { value: Periodicidade; label: string }[] = [
  { value: 'mensal',     label: 'Mensal' },
  { value: 'bimestral',  label: 'Bimestral' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral',  label: 'Semestral' },
  { value: 'anual',      label: 'Anual' },
]

const MESES: { value: string; label: string }[] = [
  { value: '1',  label: 'Janeiro' },
  { value: '2',  label: 'Fevereiro' },
  { value: '3',  label: 'Março' },
  { value: '4',  label: 'Abril' },
  { value: '5',  label: 'Maio' },
  { value: '6',  label: 'Junho' },
  { value: '7',  label: 'Julho' },
  { value: '8',  label: 'Agosto' },
  { value: '9',  label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
]

type FormState = {
  descricao: string
  fornecedor: string
  categoria: string
  periodicidade: Periodicidade
  dia_vencimento: string
  mes_primeira: string
  valor_referencia: string
  avisar_dias_antes: string
  ativa: boolean
}

const FORM_VAZIO: FormState = {
  descricao: '',
  fornecedor: '',
  categoria: '',
  periodicidade: 'mensal',
  dia_vencimento: '',
  mes_primeira: '',
  valor_referencia: '',
  avisar_dias_antes: '3',
  ativa: true,
}

// ─── Componente ─────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSalvo: () => void
  categoriasExistentes: string[]
}

export function FormularioContaFixa({ open, onOpenChange, onSalvo, categoriasExistentes }: Props) {
  const [form, setForm]         = useState<FormState>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState<string | null>(null)

  function fechar() {
    onOpenChange(false)
    setForm(FORM_VAZIO)
    setErro(null)
  }

  const precisaMesPrimeira = form.periodicidade !== 'mensal'

  const diaNum    = parseInt(form.dia_vencimento, 10)
  const diaValido = form.dia_vencimento !== '' && Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 31

  const mesNum    = parseInt(form.mes_primeira, 10)
  const mesValido = !precisaMesPrimeira ||
    (form.mes_primeira !== '' && Number.isInteger(mesNum) && mesNum >= 1 && mesNum <= 12)

  const avisarNum    = parseInt(form.avisar_dias_antes, 10)
  const avisarValido = form.avisar_dias_antes === '' ||
    (Number.isInteger(avisarNum) && avisarNum >= 0 && avisarNum <= 30)

  const valorRefNum    = parseFloat(form.valor_referencia)
  const valorRefValido = form.valor_referencia === '' || (!isNaN(valorRefNum) && valorRefNum >= 0)

  // Bloqueia o envio no próprio formulário — não depender do servidor para
  // recusar uma regra não-mensal sem o mês da primeira ocorrência.
  const podeSalvar =
    form.descricao.trim() !== '' &&
    form.fornecedor.trim() !== '' &&
    form.categoria.trim() !== '' &&
    diaValido &&
    mesValido &&
    avisarValido &&
    valorRefValido

  async function handleSalvar() {
    if (!podeSalvar) {
      setErro('Preencha os campos obrigatórios corretamente.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      await api.post('/contas/recorrentes', {
        descricao:         form.descricao.trim(),
        fornecedor:        form.fornecedor.trim(),
        categoria:         form.categoria.trim(),
        periodicidade:     form.periodicidade,
        dia_vencimento:    diaNum,
        mes_primeira:      precisaMesPrimeira ? mesNum : null,
        valor_referencia:  form.valor_referencia === '' ? null : valorRefNum,
        avisar_dias_antes: form.avisar_dias_antes === '' ? 3 : avisarNum,
        ativa:             form.ativa,
      })
      onSalvo()
      fechar()
    } catch (err) {
      console.error('[ContaFixa] Erro ao salvar:', err)
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar a conta fixa. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) fechar() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nova conta fixa</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input
              placeholder="Ex: Energia elétrica"
              value={form.descricao}
              onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <Input
                placeholder="Ex: Cemig"
                value={form.fornecedor}
                onChange={e => setForm(f => ({ ...f, fornecedor: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Combobox
                placeholder="Ex: Energia, Água, Imposto…"
                value={form.categoria}
                onValueChange={categoria => setForm(f => ({ ...f, categoria }))}
                items={categoriasExistentes}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Periodicidade</Label>
              <Select
                value={form.periodicidade}
                onValueChange={v => setForm(f => ({ ...f, periodicidade: (v as Periodicidade) ?? 'mensal' }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODICIDADES.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Dia do vencimento</Label>
              <Input
                type="number" min="1" max="31" placeholder="Ex: 10"
                value={form.dia_vencimento}
                onChange={e => setForm(f => ({ ...f, dia_vencimento: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Se o mês não tiver esse dia (ex.: 31 em fevereiro), a conta cai no último dia do mês.
              </p>
            </div>
          </div>

          {precisaMesPrimeira && (
            <div className="space-y-1.5">
              <Label>Mês da primeira ocorrência</Label>
              <Select
                value={form.mes_primeira}
                onValueChange={v => setForm(f => ({ ...f, mes_primeira: v ?? '' }))}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {MESES.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Em que mês cai a primeira. As seguintes são contadas a partir dela.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Valor de referência (R$)</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0,00 (opcional)"
                value={form.valor_referencia}
                onChange={e => setForm(f => ({ ...f, valor_referencia: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Só a primeira estimativa. Depois o sistema usa o último valor que você pagou.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Avisar quantos dias antes</Label>
              <Input
                type="number" min="0" max="30" placeholder="3"
                value={form.avisar_dias_antes}
                onChange={e => setForm(f => ({ ...f, avisar_dias_antes: e.target.value }))}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.ativa}
              onChange={e => setForm(f => ({ ...f, ativa: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 accent-green-600"
            />
            Ativa
          </label>
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
