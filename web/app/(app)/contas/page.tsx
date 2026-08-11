'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock, AlertTriangle, Clock, Plus,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { CATEGORIAS_CONTAS_A_PAGAR } from '@/lib/centro-custo'
import { FormularioContaFixa } from './formulario-conta-fixa'
import { FormularioContaAvulsa } from './formulario-conta-avulsa'
import { DialogoVencimento } from './dialogo-vencimento'
import { ListaContas, fmtBRL, type SortColuna } from './lista-contas'
import { ENCERRADAS, type Conta, type ContaAPI } from './tipos'
import { hojeISO, diasEntre } from './datas'

// ─── Cálculo dos três números (task-9-brief.md, verbatim — não alterar) ───────
// Erra calada se mexido: um total que soma confirmado + estimado vira um
// número que mente sem avisar. Ver brief da Task 9.

export function calcularTotais(contas: Conta[], hoje: string) {
  let semanaConfirmado = 0, semanaEstimado = 0
  let atrasadoTotal = 0, atrasadoQtd = 0, aguardandoQtd = 0

  for (const c of contas) {
    // Conta sem vencimento não entra em nenhum dos três números: não há data
    // para dizer se está atrasada nem se vence esta semana. Ela é cobrada pelo
    // filtro próprio e pelo aviso diário, não por um total que mentiria.
    if (!c.vencimento) continue

    if (ENCERRADAS.has(c.status)) continue

    const dias  = diasEntre(hoje, c.vencimento)
    const valor = c.valor ?? 0

    if (dias < 0) { atrasadoTotal += valor; atrasadoQtd++; continue }

    if (c.status === 'aguardando') aguardandoQtd++

    // "esta semana" = de hoje até 7 dias à frente
    if (dias <= 7) {
      // NUNCA somar estimativa com valor real num número só:
      // um número que mistura chute com fato mente sem avisar.
      if (c.valor_estimado) semanaEstimado += valor
      else                  semanaConfirmado += valor
    }
  }

  return { semanaConfirmado, semanaEstimado, atrasadoTotal, atrasadoQtd, aguardandoQtd }
}

// ─── Tipos da página ────────────────────────────────────────────────────────

type FiltroStatus = 'todas' | 'sem-vencimento' | 'aguardando' | 'aberta' | 'atrasada' | 'paga' | 'dispensada'
type FiltroTipo   = 'todos' | 'fixas' | 'nota'

const FILTROS: { value: FiltroStatus; label: string }[] = [
  { value: 'todas',          label: 'Todas' },
  { value: 'sem-vencimento', label: 'Falta vencimento' },
  { value: 'aguardando',     label: 'Aguardando' },
  { value: 'aberta',         label: 'Abertas' },
  { value: 'atrasada',       label: 'Atrasadas' },
  { value: 'paga',           label: 'Pagas' },
  { value: 'dispensada',     label: 'Dispensadas' },
]

// Conta fixa veio de uma regra recorrente; boleto veio de uma nota fiscal.
// Nenhuma coluna nova no banco: a informação já existe nas duas chaves.
const FILTROS_TIPO: { value: FiltroTipo; label: string }[] = [
  { value: 'todos', label: 'Todas' },
  { value: 'fixas', label: 'Contas fixas' },
  { value: 'nota',  label: 'Boletos de nota' },
]

function contaBateTipo(c: ContaAPI, filtroTipo: FiltroTipo): boolean {
  if (filtroTipo === 'todos') return true
  if (filtroTipo === 'fixas') return c.nota_fiscal_id === null
  return c.nota_fiscal_id !== null
}

// "Todas" esconde dispensada sempre, e paga com mais de 30 dias (pedido de
// 10/08/2026): a aba deixa de ser um histórico infinito e vira "o que ainda
// pede atenção ou foi resolvido recentemente". Quem quiser o histórico
// completo de pagamento usa a aba "Pagas" — essa continua sem limite de data.
function contaBateFiltro(c: ContaAPI, filtro: FiltroStatus, hoje: string): boolean {
  if (filtro === 'todas') {
    if (c.status === 'dispensada') return false
    if (c.status === 'paga')       return diasEntre(c.data_pagamento ?? hoje, hoje) <= 30
    return true
  }
  if (filtro === 'sem-vencimento') return !ENCERRADAS.has(c.status) && !c.vencimento
  if (filtro === 'atrasada')       return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
  return c.status === filtro
}

// Contas atrasadas e sem vencimento pedem ação urgente, então sempre aparecem —
// nunca somem por causa do filtro de mês (pedido do Matheus, 10/08/2026): esconder
// dívida ativa atrás de um filtro de data seria perigoso.
function contaBateMes(c: ContaAPI, filtroMes: string, hoje: string): boolean {
  if (filtroMes === 'todos') return true
  if (!c.vencimento) return true
  if (!ENCERRADAS.has(c.status) && diasEntre(hoje, c.vencimento) < 0) return true
  return c.vencimento.startsWith(filtroMes)
}

// Ordena o RESTO da lista (abaixo do grupo "sem data" fixo no topo — ver
// contasFiltradas). Não decide sozinha quem fica em cima; isso continua sendo
// só a regra de "sem data sobe" em contasFiltradas.
function compararContasPorColuna(a: ContaAPI, b: ContaAPI, coluna: SortColuna, direcao: 'asc' | 'desc'): number {
  let cmp = 0
  switch (coluna) {
    case 'fornecedor': cmp = (a.fornecedor ?? '').localeCompare(b.fornecedor ?? ''); break
    case 'descricao':  cmp = a.descricao.localeCompare(b.descricao); break
    case 'vencimento': cmp = (a.vencimento ?? '').localeCompare(b.vencimento ?? ''); break
    case 'valor':      cmp = (a.valor ?? 0) - (b.valor ?? 0); break
    case 'categoria':  cmp = (a.categoria ?? 'Sem categoria').localeCompare(b.categoria ?? 'Sem categoria'); break
  }
  return direcao === 'asc' ? cmp : -cmp
}

// ─── Formulários auxiliares (estado local dos diálogos) ───────────────────────

type PagamentoForm = { data_pagamento: string; valor_pago: string }

export default function ContasPage() {
  const [contas, setContas]           = useState<ContaAPI[]>([])
  const [loading, setLoading]         = useState(true)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [filtro, setFiltro]           = useState<FiltroStatus>('todas')
  const [filtroTipo, setFiltroTipo]   = useState<FiltroTipo>('todos')
  const [filtroMes, setFiltroMes]     = useState(() => hojeISO().slice(0, 7))
  const [sortColuna, setSortColuna]   = useState<SortColuna>('vencimento')
  const [sortDirecao, setSortDirecao] = useState<'asc' | 'desc'>('asc')
  const [visivelCount, setVisivelCount] = useState(50)
  const [salvando, setSalvando]       = useState(false)

  function handleSort(coluna: SortColuna) {
    if (coluna === sortColuna) {
      setSortDirecao(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColuna(coluna)
      setSortDirecao('asc')
    }
  }

  const [valorDialog, setValorDialog] = useState<ContaAPI | null>(null)
  const [valorInput, setValorInput]   = useState('')
  const [valorErro, setValorErro]     = useState<string | null>(null)

  const [pagarDialog, setPagarDialog] = useState<ContaAPI | null>(null)
  const [pagarForm, setPagarForm]     = useState<PagamentoForm>({ data_pagamento: '', valor_pago: '' })
  const [pagarErro, setPagarErro]     = useState<string | null>(null)

  const [dispensarDialog, setDispensarDialog] = useState<ContaAPI | null>(null)
  const [dispensarErro, setDispensarErro]     = useState<string | null>(null)

  const [desfazerDialog, setDesfazerDialog] = useState<ContaAPI | null>(null)
  const [desfazerErro, setDesfazerErro]     = useState<string | null>(null)

  const [novaFixaOpen, setNovaFixaOpen]     = useState(false)
  const [novaAvulsaOpen, setNovaAvulsaOpen] = useState(false)

  const [dataDialog, setDataDialog] = useState<ContaAPI | null>(null)

  async function load() {
    setErroCarregar(null)
    try {
      const data = await api.get<ContaAPI[]>('/contas')
      setContas(data)
    } catch (err) {
      console.error('[Contas] Erro ao carregar:', err)
      setErroCarregar('Não foi possível carregar as contas. Tente novamente em instantes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // O aviso do WhatsApp manda /contas?filtro=sem-vencimento — a tela já abre filtrada.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filtro')
    if (f && FILTROS.some(o => o.value === f)) setFiltro(f as FiltroStatus)
  }, [])

  // Reset paginação ao trocar filtro de status, tipo ou mês
  useEffect(() => { setVisivelCount(50) }, [filtro, filtroTipo, filtroMes])

  const hoje = hojeISO()
  const totais = calcularTotais(contas, hoje)

  const meses = Array.from(
    new Set([
      hoje.slice(0, 7),
      ...contas.filter(c => c.vencimento).map(c => c.vencimento!.slice(0, 7)),
    ])
  ).sort((a, b) => b.localeCompare(a))

  // Sugestão pro campo Categoria dos formulários: a lista oficial (a mesma que
  // o Financeiro usa pros itens de nota fiscal) + o que já foi digitado em
  // alguma conta antes. Escolher uma da lista oficial evita que "Manutenção"
  // digitado aqui vire uma categoria diferente de 'manutencao' vindo de nota
  // fiscal — o campo continua texto livre, isto é só sugestão, não trava.
  const categoriasExistentes = useMemo(() => Array.from(
    new Set([
      ...CATEGORIAS_CONTAS_A_PAGAR.map(c => c.label),
      ...contas.map(c => c.categoria).filter((c): c is string => !!c && c.trim() !== ''),
    ])
  ).sort((a, b) => a.localeCompare(b, 'pt-BR')), [contas])

  const contasFiltradas = contas
    .filter(c => contaBateTipo(c, filtroTipo) && contaBateFiltro(c, filtro, hoje) && contaBateMes(c, filtroMes, hoje))
    // Conta sem data sobe para o topo: é a única que exige ação do Matheus
    // para o sistema voltar a funcionar sozinho. Enterrada no meio da lista,
    // ela some — e é justamente a que o sistema não consegue vigiar.
    .sort((a, b) => {
      const aSemData = !a.vencimento && !ENCERRADAS.has(a.status)
      const bSemData = !b.vencimento && !ENCERRADAS.has(b.status)
      if (aSemData !== bSemData) return aSemData ? -1 : 1
      return compararContasPorColuna(a, b, sortColuna, sortDirecao)
    })

  const contasExibidas = contasFiltradas.slice(0, visivelCount)

  // ─── Ações: registrar valor real ─────────────────────────────────────────

  function abrirValorDialog(conta: ContaAPI) {
    setValorInput(conta.valor !== null ? String(conta.valor) : '')
    setValorErro(null)
    setValorDialog(conta)
  }

  async function handleRegistrarValor() {
    if (!valorDialog) return
    const valorNum = parseFloat(valorInput)
    if (isNaN(valorNum) || valorNum < 0) { setValorErro('Informe um valor válido.'); return }
    setSalvando(true)
    setValorErro(null)
    try {
      await api.patch(`/contas/${valorDialog.id}`, { valor: valorNum })
      setValorDialog(null)
      await load()
    } catch (err) {
      console.error('[Contas] Erro ao registrar valor:', err)
      setValorErro('Não foi possível salvar o valor. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  // ─── Ações: marcar como paga ─────────────────────────────────────────────

  function abrirPagarDialog(conta: ContaAPI) {
    setPagarForm({
      data_pagamento: hojeISO(),
      valor_pago: conta.valor !== null ? String(conta.valor) : '',
    })
    setPagarErro(null)
    setPagarDialog(conta)
  }

  async function handleMarcarPaga() {
    if (!pagarDialog) return
    const valorNum = parseFloat(pagarForm.valor_pago)
    if (isNaN(valorNum) || valorNum < 0) { setPagarErro('Informe o valor pago.'); return }
    if (!pagarForm.data_pagamento) { setPagarErro('Informe a data do pagamento.'); return }
    setSalvando(true)
    setPagarErro(null)
    try {
      await api.post(`/contas/${pagarDialog.id}/pagar`, {
        data_pagamento: pagarForm.data_pagamento,
        valor_pago: valorNum,
      })
      setPagarDialog(null)
      await load()
    } catch (err) {
      console.error('[Contas] Erro ao marcar como paga:', err)
      setPagarErro('Não foi possível registrar o pagamento. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  // ─── Ações: desfazer pagamento ───────────────────────────────────────────
  // Sem esta ação, pagamento digitado com valor errado é definitivo para quem
  // não sabe rodar SQL — e ele já criou um lançamento no Financeiro.

  function abrirDesfazerDialog(conta: ContaAPI) {
    setDesfazerErro(null)
    setDesfazerDialog(conta)
  }

  async function handleDesfazerPagamento() {
    if (!desfazerDialog) return
    setSalvando(true)
    setDesfazerErro(null)
    try {
      await api.post(`/contas/${desfazerDialog.id}/desfazer-pagamento`, {})
      setDesfazerDialog(null)
      await load()
    } catch (err) {
      console.error('[Contas] Erro ao desfazer pagamento:', err)
      setDesfazerErro('Não foi possível desfazer o pagamento. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  // ─── Ações: dispensar ────────────────────────────────────────────────────

  function abrirDispensarDialog(conta: ContaAPI) {
    setDispensarErro(null)
    setDispensarDialog(conta)
  }

  async function handleDispensar() {
    if (!dispensarDialog) return
    setSalvando(true)
    setDispensarErro(null)
    try {
      await api.post(`/contas/${dispensarDialog.id}/dispensar`, {})
      setDispensarDialog(null)
      await load()
    } catch (err) {
      console.error('[Contas] Erro ao dispensar:', err)
      setDispensarErro('Não foi possível dispensar esta conta. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  if (loading) return <PageSkeleton />

  if (erroCarregar) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-14 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto text-red-500 mb-3" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground mb-1">{erroCarregar}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => { setLoading(true); load() }}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contas a Pagar</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">O que a fazenda deve e quando vence</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setNovaAvulsaOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Nova conta avulsa
          </Button>
          <Button size="sm" onClick={() => setNovaFixaOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Nova conta fixa
          </Button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="space-y-4">
        <p className="text-sm font-semibold text-muted-foreground">Resumo geral</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />Vence esta semana
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{fmtBRL(totais.semanaConfirmado)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">confirmado</p>
              <p className="text-base font-semibold text-amber-600 tabular-nums mt-2">
                + {fmtBRL(totais.semanaEstimado)}
              </p>
              <p className="text-xs text-amber-600/80">estimado</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />Atrasado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600 tabular-nums">{fmtBRL(totais.atrasadoTotal)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {totais.atrasadoQtd} {totais.atrasadoQtd === 1 ? 'conta atrasada' : 'contas atrasadas'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />Aguardando
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{totais.aguardandoQtd}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {totais.aguardandoQtd === 1 ? 'conta sem valor confirmado' : 'contas sem valor confirmado'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      {/* ── Lista ── */}
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">
            Contas
            <span className="text-xs font-normal text-muted-foreground ml-2">
              {contasFiltradas.length} de {contas.length}
            </span>
          </CardTitle>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Select value={filtroTipo} onValueChange={v => setFiltroTipo((v ?? 'todos') as FiltroTipo)}>
                <SelectTrigger className="w-44 h-9 text-sm">
                  <SelectValue>{FILTROS_TIPO.find(o => o.value === filtroTipo)?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FILTROS_TIPO.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filtroMes} onValueChange={v => setFiltroMes(v ?? 'todos')}>
                <SelectTrigger className="w-44 h-9 text-sm">
                  <SelectValue>
                    {filtroMes === 'todos'
                      ? 'Todos os meses'
                      : (() => { const [y, mo] = filtroMes.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os meses</SelectItem>
                  {meses.map(m => (
                    <SelectItem key={m} value={m}>
                      {(() => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTROS.map(o => {
                const n = contas.filter(c => contaBateTipo(c, filtroTipo) && contaBateFiltro(c, o.value, hoje) && contaBateMes(c, filtroMes, hoje)).length
                return (
                  <Button
                    key={o.value}
                    size="sm"
                    variant={filtro === o.value ? 'default' : 'outline'}
                    onClick={() => setFiltro(o.value)}
                  >
                    {o.label}{n > 0 ? ` (${n})` : ''}
                  </Button>
                )
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ListaContas
            contas={contasExibidas}
            hoje={hoje}
            onPagar={abrirPagarDialog}
            onDispensar={abrirDispensarDialog}
            onDesfazer={abrirDesfazerDialog}
            onEditarValor={abrirValorDialog}
            onInformarData={setDataDialog}
            sortColuna={sortColuna}
            sortDirecao={sortDirecao}
            onSort={handleSort}
          />
          {contasFiltradas.length > visivelCount && (
            <div className="text-center py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisivelCount(c => c + 50)}
              >
                Carregar mais {Math.min(50, contasFiltradas.length - visivelCount)}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Dialog: registrar valor real ── */}
      <Dialog open={!!valorDialog} onOpenChange={open => { if (!open) { setValorDialog(null); setValorErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Registrar valor real</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{valorDialog?.descricao}</span>
            {valorDialog?.fornecedor && <> — {valorDialog.fornecedor}</>}
          </p>
          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input
              type="number" min="0" step="0.01" placeholder="0,00"
              value={valorInput}
              onChange={e => setValorInput(e.target.value)}
            />
          </div>
          {valorErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{valorErro}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setValorDialog(null)}>Cancelar</Button>
            <Button onClick={handleRegistrarValor} disabled={salvando || !valorInput}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: marcar como paga ── */}
      <Dialog open={!!pagarDialog} onOpenChange={open => { if (!open) { setPagarDialog(null); setPagarErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Marcar como paga</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{pagarDialog?.descricao}</span>
            {pagarDialog?.fornecedor && <> — {pagarDialog.fornecedor}</>}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data do pagamento</Label>
              <Input
                type="date"
                value={pagarForm.data_pagamento}
                onChange={e => setPagarForm(f => ({ ...f, data_pagamento: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor pago (R$)</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0,00"
                value={pagarForm.valor_pago}
                onChange={e => setPagarForm(f => ({ ...f, valor_pago: e.target.value }))}
              />
            </div>
          </div>
          {pagarErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{pagarErro}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagarDialog(null)}>Cancelar</Button>
            <Button
              onClick={handleMarcarPaga}
              disabled={salvando || !pagarForm.valor_pago || !pagarForm.data_pagamento}
            >
              {salvando ? 'Salvando…' : 'Confirmar pagamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: desfazer pagamento ── */}
      <Dialog open={!!desfazerDialog} onOpenChange={open => { if (!open) { setDesfazerDialog(null); setDesfazerErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Desfazer o pagamento?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{desfazerDialog?.descricao}</span>
            {desfazerDialog?.fornecedor && <> ({desfazerDialog.fornecedor})</>} volta a ficar
            aberta, e a data e o valor pagos são apagados.
          </p>
          <p className="text-sm text-muted-foreground">
            O gasto que este pagamento lançou no Financeiro também será removido.
            Use quando o valor ou a data foram digitados errado — depois é só marcar
            como paga de novo, com os dados certos.
          </p>
          {desfazerErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{desfazerErro}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDesfazerDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDesfazerPagamento} disabled={salvando}>
              {salvando ? 'Desfazendo…' : 'Desfazer pagamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: dispensar ── */}
      <Dialog open={!!dispensarDialog} onOpenChange={open => { if (!open) { setDispensarDialog(null); setDispensarErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Dispensar esta conta?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{dispensarDialog?.descricao}</span>
            {dispensarDialog?.fornecedor && <> ({dispensarDialog.fornecedor})</>} deixa de aparecer como
            pendente este mês. Use quando, excepcionalmente, não houver cobrança.
          </p>
          {dispensarErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{dispensarErro}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispensarDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDispensar} disabled={salvando}>
              {salvando ? 'Dispensando…' : 'Dispensar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: informar data de vencimento ── */}
      <DialogoVencimento
        conta={dataDialog}
        onFechar={() => setDataDialog(null)}
        onSalvo={() => { setDataDialog(null); load() }}
      />

      {/* ── Formulários: nova conta fixa / avulsa ── */}
      <FormularioContaFixa
        open={novaFixaOpen}
        onOpenChange={setNovaFixaOpen}
        onSalvo={load}
        categoriasExistentes={categoriasExistentes}
      />
      <FormularioContaAvulsa
        open={novaAvulsaOpen}
        onOpenChange={setNovaAvulsaOpen}
        onSalvo={() => { setFiltroMes('todos'); load() }}
        categoriasExistentes={categoriasExistentes}
      />
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
      </div>
      <div className="h-72 bg-muted rounded-xl" />
    </div>
  )
}
