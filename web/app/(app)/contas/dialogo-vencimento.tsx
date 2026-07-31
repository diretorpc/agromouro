'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { ContaAPI } from './tipos'

// Hoje no fuso de São Paulo. NÃO usar toISOString(): devolve UTC e vira o dia
// seguinte depois das 21h — defeito que este projeto já teve no Financeiro.
function hojeISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function diasEntre(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number)
  const [by, bm, bd] = bISO.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

// Aviso, NUNCA bloqueio. Errar o ano ao digitar é comum, e travar o usuário
// fora do próprio sistema é pior que o erro que se quer evitar.
function avisoData(dataISO: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) return null
  const dias = diasEntre(hojeISO(), dataISO)
  if (dias < 0)   return 'Essa data já passou. Se estiver certo, pode salvar assim mesmo.'
  if (dias > 180) return 'Essa data está a mais de 6 meses. Confira o ano antes de salvar.'
  return null
}

type Props = {
  conta:    ContaAPI | null
  onFechar: () => void
  onSalvo:  () => void
}

export function DialogoVencimento({ conta, onFechar, onSalvo }: Props) {
  const [data, setData]         = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState<string | null>(null)

  const aviso = avisoData(data)

  async function salvar() {
    if (!conta || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      setErro('Informe uma data válida.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      await api.patch(`/contas/${conta.id}`, { vencimento: data })
      setData('')
      onSalvo()
    } catch (e) {
      // Erro visível: escrita que falha calada faz o usuário achar que salvou.
      setErro(e instanceof Error ? e.message : 'Não consegui salvar. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={!!conta} onOpenChange={o => { if (!o) { setData(''); setErro(null); onFechar() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quando vence esta conta?</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{conta?.descricao}</p>

        <div className="space-y-2">
          <Label htmlFor="vencimento">Data de vencimento</Label>
          <Input id="vencimento" type="date" value={data} onChange={e => setData(e.target.value)} />
          {aviso && <p className="text-sm text-amber-600">{aviso}</p>}
          {erro  && <p className="text-sm text-red-600">{erro}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !data}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
