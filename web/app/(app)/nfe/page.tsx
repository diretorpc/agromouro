'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

function setUrlParam(key: string, value: string, dflt = 'todos') {
  const p = new URLSearchParams(window.location.search)
  if (!value || value === dflt) p.delete(key)
  else p.set(key, value)
  window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname)
}
import { FileText, RefreshCw, Plus, Download, Upload, CircleDollarSign, Trash2, Search, Wallet, Hourglass, AlertCircle, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KpiCard } from '@/components/ui/kpi-card'
import { ActionMenu } from '@/components/ui/action-menu'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useFazenda } from '@/context/fazenda-context'
import { ConferenciaPdf } from './conferencia-pdf'
import {
  TODOS_OS_MESES, mesDaNota, mesPadraoDaLista, mesesDisponiveis, notaVisivel, rotuloDoMes,
} from './filtro-mes'
import type { NotaFiscal, ItemNfe, ResultadoImportacaoXml } from '@/lib/types'

const STATUS_STYLE: Record<string, string> = {
  recebida: 'bg-blue-100 text-blue-700 border-blue-200',
  processando: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  processada: 'bg-green-100 text-green-700 border-green-200',
  erro: 'bg-red-100 text-red-700 border-red-200',
}

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

async function exportarXML(nota: NotaFiscal) {
  const { data } = await supabase
    .from('itens_nfe')
    .select('*')
    .eq('nota_fiscal_id', nota.id)
  const itens = (data ?? []) as ItemNfe[]

  const itensXml = itens.map(item =>
    `    <item>\n      <descricao>${item.descricao}</descricao>\n      <quantidade>${item.quantidade}</quantidade>\n      <unidade>${item.unidade}</unidade>\n      <valorUnitario>${item.valor_unitario.toFixed(2)}</valorUnitario>\n      <valorTotal>${item.valor_total.toFixed(2)}</valorTotal>\n    </item>`
  ).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NotaFiscal>
  <numero>${nota.numero}</numero>
  <emitente>
    <nome>${nota.emitente_nome}</nome>
    <cnpj>${nota.emitente_cnpj}</cnpj>
  </emitente>
  <dataEmissao>${nota.data_emissao}</dataEmissao>
  <valorTotal>${nota.valor_total.toFixed(2)}</valorTotal>
  <status>${nota.status}</status>
  <itens>
${itensXml}
  </itens>
</NotaFiscal>`

  const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `NF-${nota.numero}.xml`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function NfePage() {
  const router = useRouter()
  const { fazendaAtiva } = useFazenda()
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<NotaFiscal | null>(null)
  const [itens, setItens] = useState<ItemNfe[]>([])
  const [loadingItens, setLoadingItens] = useState(false)

  // excluir NF
  const [deleteNota, setDeleteNota] = useState<NotaFiscal | null>(null)
  const [deleteNotaErro, setDeleteNotaErro] = useState<string | null>(null)
  const [deletandoNota, setDeletandoNota] = useState(false)

  // adicionar NF
  const [addDialog, setAddDialog] = useState(false)
  const [addMode, setAddMode] = useState<'xml' | 'manual' | 'pdf'>('xml')
  const [xmlFileContent, setXmlFileContent] = useState<string | null>(null)
  const [xmlFileName, setXmlFileName] = useState<string | null>(null)
  const [xmlError, setXmlError] = useState('')
  const [addErro, setAddErro] = useState('')
  const [salvandoNF, setSalvandoNF] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [manualForm, setManualForm] = useState({
    numero: '', emitente_nome: '', emitente_cnpj: '',
    data_emissao: '', valor_total: '',
  })

  // filtros
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')
  // `null` = ainda não decidido. Quem decide é `mesPadraoDaLista`, depois da
  // primeira carga (ou o `?mes=` da URL, que roda antes e ganha).
  const [filtroMes, setFiltroMes] = useState<string | null>(null)

  // `mesPreferido` força o filtro a ir para um mês específico — usado depois de
  // importar um PDF, para a lista abrir no mês da nota que acabou de entrar.
  async function loadNotas(mesPreferido?: string) {
    const { data } = await supabase
      .from('notas_fiscais')
      .select('*')
      .order('data_emissao', { ascending: false })
    const lista = (data ?? []) as NotaFiscal[]
    setNotas(lista)
    setFiltroMes(atual => mesPreferido ?? atual ?? mesPadraoDaLista(lista))
    setLoading(false)
    return lista
  }

  useEffect(() => { loadNotas() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get('q')
    const status = params.get('status')
    const mes = params.get('mes')
    if (q !== null) setBusca(q)
    if (status !== null) setFiltroStatus(status)
    // Roda antes de `loadNotas` resolver, então vence o padrão calculado lá.
    if (mes !== null && (mes === TODOS_OS_MESES || /^\d{4}-\d{2}$/.test(mes))) setFiltroMes(mes)
  }, [])

  async function openNota(nota: NotaFiscal) {
    setSelected(nota)
    setLoadingItens(true)
    const { data } = await supabase
      .from('itens_nfe')
      .select('*, insumos(nome, tipo, unidade)')
      .eq('nota_fiscal_id', nota.id)
    setItens((data ?? []) as ItemNfe[])
    setLoadingItens(false)
  }

  async function handleDeleteNota() {
    if (!deleteNota) return
    setDeletandoNota(true)
    setDeleteNotaErro(null)

    try {
      await api.del(`/nfe/${deleteNota.id}`)
    } catch (err) {
      setDeletandoNota(false)
      setDeleteNotaErro(err instanceof Error ? err.message : 'Erro ao excluir a nota.')
      return
    }

    setDeletandoNota(false)
    if (selected?.id === deleteNota.id) setSelected(null)
    setDeleteNota(null)
    loadNotas()
  }

  async function reprocessar(nota: NotaFiscal) {
    await supabase.from('notas_fiscais').update({ status: 'recebida' }).eq('id', nota.id)
    loadNotas()
  }

  function handleXmlFile(file: File) {
    setXmlError('')
    setXmlFileContent(null)
    setXmlFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      if (!text || text.length < 50) {
        setXmlError('Arquivo vazio ou pequeno demais para ser uma NF-e.')
        return
      }
      setXmlFileContent(text)
    }
    reader.readAsText(file, 'UTF-8')
  }

  async function handleSaveNF() {
    if (!fazendaAtiva) return
    setSalvandoNF(true)
    setAddErro('')
    // Pistas para achar a nota recém-gravada e levar a lista até o mês dela.
    // O modo PDF recebe a data pronta do componente de conferência; XML e manual
    // não têm esse caminho, e sem isto o filtro de mês esconderia justamente a
    // nota que acabou de entrar sempre que ela for de mês passado.
    let dataManual:      string | null = null
    let dataXml:         string | null = null
    let numeroImportado: string | null = null
    try {
      if (addMode === 'xml' && xmlFileContent) {
        try {
          const resultado = await api.post<ResultadoImportacaoXml>('/nfe/importar-xml', {
            xml: xmlFileContent,
          })
          if (resultado.status === 'duplicada') {
            const dataFmt = resultado.nota.data_emissao
              ? resultado.nota.data_emissao.slice(0, 10).split('-').reverse().join('/')
              : 'data desconhecida'
            setAddErro(`Esta nota já está no sistema (entrou em ${dataFmt}).`)
            return
          }
          numeroImportado = resultado.numero
          dataXml         = resultado.dataEmissao ?? null
        } catch (err) {
          setAddErro(err instanceof Error ? err.message : 'Erro ao importar a nota.')
          return
        }
      } else if (addMode === 'manual') {
        dataManual = manualForm.data_emissao
        const valor = parseFloat(manualForm.valor_total) || 0
        const { data: nota, error: errManual } = await supabase.from('notas_fiscais').insert({
          fazenda_id: fazendaAtiva.id,
          numero: manualForm.numero.trim(),
          emitente_nome: manualForm.emitente_nome.trim(),
          emitente_cnpj: manualForm.emitente_cnpj.trim(),
          data_emissao: manualForm.data_emissao,
          valor_total: valor,
          status: 'recebida',
        }).select().single()
        if (errManual) { setAddErro(errManual.message); return }

        // Sem isto, a nota fica com zero itens e o gasto some do Financeiro
        // (que soma itens_nfe, não notas_fiscais) — achado em 05/08/2026.
        if (nota) {
          const { error: errItem } = await supabase.from('itens_nfe').insert({
            nota_fiscal_id: nota.id,
            fazenda_id: fazendaAtiva.id,
            descricao: manualForm.emitente_nome.trim(),
            quantidade: 1,
            unidade: 'un',
            valor_unitario: valor,
            valor_total: valor,
            insumo_id: null,
            cfop: null,
            conta_como_compra: true,
          })
          if (errItem) { setAddErro(errItem.message); return }
        }
      }
      setAddDialog(false)
      setXmlFileContent(null)
      setXmlFileName(null)
      setXmlError('')
      setManualForm({ numero: '', emitente_nome: '', emitente_cnpj: '', data_emissao: '', valor_total: '' })
      const lista = await loadNotas()
      // A data vem da resposta da API (XML) ou do formulário (manual). O
      // fallback pelo número só existe para API antiga, que não devolve
      // `dataEmissao`: nesse caso, número repetido em fornecedores diferentes
      // faz desistir do salto em vez de chutar o mês da nota errada.
      const homonimas = numeroImportado ? lista.filter(n => n.numero === numeroImportado) : []
      const mes = mesDaNota(dataManual ?? dataXml)
        ?? (homonimas.length === 1 ? mesDaNota(homonimas[0].data_emissao) : null)
      if (mes) { setFiltroMes(mes); setUrlParam('mes', mes, '') }
    } finally {
      setSalvandoNF(false)
    }
  }

  const canSave = addMode === 'xml' ? !!xmlFileContent : !!(manualForm.numero && manualForm.emitente_nome && manualForm.data_emissao)

  // A peneira mora em filtro-mes.ts, testada de mesa. Ela vivia aqui dentro, e
  // foi exatamente onde a busca virou refém do mês sem ninguém notar.
  const notasFiltradas = useMemo(
    () => notas.filter(nota => notaVisivel(nota, { busca, status: filtroStatus, mes: filtroMes })),
    [notas, busca, filtroStatus, filtroMes],
  )

  // Enquanto há busca, o mês está desligado — e a tela precisa DIZER isso, senão
  // o dono vê "1 de 135" e conclui que só existe uma nota daquele fornecedor.
  const buscando = busca.trim() !== ''

  const meses = useMemo(() => mesesDisponiveis(notas, filtroMes ?? undefined), [notas, filtroMes])

  // "Tem coisa escondida?" em vez de "o filtro está diferente do padrão": o mês
  // agora quase sempre esconde alguma nota, e é isso que o contador e o botão
  // Limpar precisam anunciar.
  const filtroAtivo = busca.trim() !== '' || filtroStatus !== 'todos' || notasFiltradas.length !== notas.length

  // Limpar = mostrar tudo, inclusive os outros meses. Voltar para o mês padrão
  // aqui seria um botão que não muda nada quando o mês é justamente o que está
  // escondendo a nota procurada.
  function limparFiltros() {
    setBusca('')
    setFiltroStatus('todos')
    setFiltroMes(TODOS_OS_MESES)
    window.history.replaceState(null, '', `${window.location.pathname}?mes=${TODOS_OS_MESES}`)
  }

  const valorTotalNFs = notas.reduce((s, n) => s + (n.valor_total ?? 0), 0)
  const pendentes = notas.filter(n => n.status === 'recebida' || n.status === 'processando').length
  const erros     = notas.filter(n => n.status === 'erro').length

  if (loading) return <PageSkeleton />

  // Ações da nota — compartilhado entre a tabela (desktop) e os cards (mobile)
  const acoesNota = (nota: (typeof notasFiltradas)[number]) => {
    const menuItems = [
      { label: 'Baixar XML', icon: <Download className="h-3.5 w-3.5" />, onClick: () => exportarXML(nota) },
      // Só para nota que entrou por PDF: o arquivo original fica num bucket
      // privado, e a URL assinada (60 s) vem da API, que usa a chave de serviço.
      ...(nota.arquivo_pdf ? [{
        label: 'Baixar PDF',
        icon: <FileText className="h-3.5 w-3.5" />,
        onClick: async () => {
          try {
            const { url } = await api.get<{ url: string }>(`/nfe/${nota.id}/arquivo`)
            window.open(url, '_blank')
          } catch {
            alert('Não consegui abrir o PDF desta nota.')
          }
        },
      }] : []),
      ...(nota.status === 'processada' ? [{
        label: 'Ver no Financeiro',
        icon: <CircleDollarSign className="h-3.5 w-3.5 text-green-600" />,
        onClick: () => router.push('/financeiro'),
      }] : []),
      ...(nota.status === 'erro' ? [{
        label: 'Reprocessar',
        icon: <RefreshCw className="h-3.5 w-3.5" />,
        onClick: () => reprocessar(nota),
      }] : []),
      {
        label: 'Excluir',
        icon: <Trash2 className="h-3.5 w-3.5" />,
        onClick: () => { setDeleteNota(nota); setDeleteNotaErro(null) },
        destructive: true,
      },
    ]
    return (
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => openNota(nota)}>
          Ver itens
        </Button>
        <ActionMenu items={menuItems} />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notas Fiscais</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">Notas fiscais recebidas e processadas</p>
        </div>
        <Button
          size="sm"
          onClick={() => { setAddDialog(true); setAddMode('xml'); setXmlFileContent(null); setXmlFileName(null); setXmlError(''); setAddErro('') }}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Adicionar NF
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total de Notas"
          value={notas.length}
          sub={notas.length === 0 ? 'nenhuma recebida' : 'todas as NF-e recebidas'}
          icon={<FileText className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          label="Valor Total"
          value={valorTotalNFs.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
          sub="soma de todas as NF-e"
          icon={<Wallet className="h-5 w-5" />}
          iconBg="#EFF6FF" iconColor="#2563EB"
        />
        <KpiCard
          label="Pendentes"
          value={pendentes}
          sub={pendentes === 0 ? 'nada aguardando' : 'recebida ou processando'}
          icon={<Hourglass className="h-5 w-5" />}
          iconBg={pendentes > 0 ? '#FFFBEB' : '#EDFAF1'}
          iconColor={pendentes > 0 ? '#D97706' : '#16A34A'}
          valueColor={pendentes > 0 ? 'text-amber-600' : undefined}
        />
        <KpiCard
          label="Com Erro"
          value={erros}
          sub={erros === 0 ? 'nenhum erro' : 'precisam reprocessamento'}
          icon={<AlertCircle className="h-5 w-5" />}
          iconBg={erros > 0 ? '#FEF2F2' : '#EDFAF1'}
          iconColor={erros > 0 ? '#DC2626' : '#16A34A'}
          valueColor={erros > 0 ? 'text-red-600' : undefined}
        />
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              NF-e Recebidas
              {filtroAtivo && (
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  {notasFiltradas.length} de {notas.length}
                </span>
              )}
            </CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por número, emitente ou CNPJ…"
                value={busca}
                onChange={e => { setBusca(e.target.value); setUrlParam('q', e.target.value, '') }}
                className="pl-8 h-9"
              />
            </div>
            {/* A lista carrega TODAS as notas (135 em 25/08/2026) e ordena por
                data de emissão. Sem corte por mês, uma nota nova de mês passado
                nasce na posição 69 e parece perdida. */}
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Filtrar por mês de emissão"
                className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[160px]'}
                value={filtroMes ?? TODOS_OS_MESES}
                onChange={e => { setFiltroMes(e.target.value); setUrlParam('mes', e.target.value, '') }}
              >
                <option value={TODOS_OS_MESES}>{rotuloDoMes(TODOS_OS_MESES)}</option>
                {meses.map(m => (
                  <option key={m} value={m}>{rotuloDoMes(m)}</option>
                ))}
              </select>
              {buscando && filtroMes && filtroMes !== TODOS_OS_MESES && (
                <span className="text-xs text-muted-foreground">a busca está olhando todos os meses</span>
              )}
            </div>
            <select
              aria-label="Filtrar por status"
              className={SELECT_CLASS.replace('w-full', 'w-auto') + ' min-w-[140px]'}
              value={filtroStatus}
              onChange={e => { setFiltroStatus(e.target.value); setUrlParam('status', e.target.value) }}
            >
              <option value="todos">Todos os status</option>
              <option value="recebida">Recebida</option>
              <option value="processando">Processando</option>
              <option value="processada">Processada</option>
              <option value="erro">Erro</option>
            </select>
            {filtroAtivo && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground"
                onClick={limparFiltros}
              >
                Limpar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {notas.length === 0 ? (
            <div className="py-10">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Nenhuma nota fiscal recebida</p>
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                    NF-es chegam automaticamente pelo email via Make. Você também pode adicionar manualmente.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => { setAddDialog(true); setAddMode('xml'); setXmlFileContent(null); setXmlFileName(null); setXmlError(''); setAddErro('') }}
                >
                  <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                  Adicionar NF
                </Button>
              </div>
            </div>
          ) : notasFiltradas.length === 0 ? (
            <div className="py-10">
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-sm text-muted-foreground">
                  Nenhuma nota fiscal corresponde aos filtros aplicados
                  {filtroMes && filtroMes !== TODOS_OS_MESES ? ` (mês: ${rotuloDoMes(filtroMes)})` : ''}.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={limparFiltros}
                >
                  Ver todos os meses
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Desktop: tabela */}
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Emitente</TableHead>
                    <TableHead>Data Emissão</TableHead>
                    <TableHead className="text-right">Valor Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notasFiltradas.map(nota => (
                    <TableRow key={nota.id}>
                      <TableCell className="font-medium">{nota.numero}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{nota.emitente_nome}</p>
                          <p className="text-xs text-muted-foreground">{nota.emitente_cnpj}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {nota.data_emissao.slice(0, 10).split('-').reverse().join('/')}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {nota.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_STYLE[nota.status] ?? ''}>
                          {nota.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{acoesNota(nota)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Mobile: cards */}
              <ul className="md:hidden divide-y">
                {notasFiltradas.map(nota => (
                  <li key={nota.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{nota.emitente_nome}</p>
                        <p className="text-xs text-muted-foreground truncate">{nota.emitente_cnpj}</p>
                      </div>
                      <Badge variant="outline" className={`shrink-0 ${STATUS_STYLE[nota.status] ?? ''}`}>
                        {nota.status}
                      </Badge>
                    </div>
                    <div className="flex items-end justify-between gap-2 mt-2">
                      <div className="min-w-0">
                        <p className="font-semibold tabular-nums">
                          {nota.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Nº {nota.numero} · {nota.data_emissao.slice(0, 10).split('-').reverse().join('/')}
                        </p>
                      </div>
                      <div className="shrink-0">{acoesNota(nota)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialog: Ver Itens */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}>
        <DialogContent className="sm:max-w-[800px]">
          <DialogHeader>
            <DialogTitle className="text-base">
              NF-e {selected?.numero}
            </DialogTitle>
            {selected?.emitente_nome && (
              <p className="text-sm text-muted-foreground truncate">{selected.emitente_nome}</p>
            )}
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto overflow-x-hidden">
            {loadingItens ? (
              <div className="space-y-2 animate-pulse p-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <Table className="table-fixed w-full">
                  <colgroup>
                    <col />
                    <col className="w-[80px]" />
                    <col className="w-[100px]" />
                    <col className="w-[100px]" />
                    <col className="w-[200px]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Qtd.</TableHead>
                      <TableHead className="text-right">Valor Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Insumo Vinculado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itens.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                          Nenhum item encontrado.
                        </TableCell>
                      </TableRow>
                    ) : itens.map(item => (
                      <TableRow key={item.id} className={!item.insumo_id ? 'bg-yellow-50/50' : ''}>
                        <TableCell className="text-sm font-medium">
                          <span className="block truncate" title={item.descricao}>{item.descricao}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm">{item.quantidade} {item.unidade}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {item.valor_unitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {item.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </TableCell>
                        <TableCell className="text-sm overflow-hidden align-top whitespace-normal">
                          {item.insumos
                            ? <span className="text-green-700 leading-snug">{item.insumos.nome}</span>
                            : <span className="text-yellow-600 text-xs">Não vinculado</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {selected && (
                  <div className="flex justify-between text-sm border-t pt-3 px-1">
                    <span className="text-muted-foreground">Total da NF-e</span>
                    <span className="font-bold text-base">
                      {selected.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Excluir NF */}
      <Dialog open={!!deleteNota} onOpenChange={open => { if (!open) { setDeleteNota(null); setDeleteNotaErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir nota fiscal?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            A NF-e <span className="font-medium text-foreground">nº {deleteNota?.numero}</span> de{' '}
            <span className="font-medium text-foreground">{deleteNota?.emitente_nome}</span> será removida permanentemente,
            incluindo todos os seus itens.
          </p>
          {deleteNotaErro && (
            <p aria-live="polite" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {deleteNotaErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteNota(null); setDeleteNotaErro(null) }}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteNota} disabled={deletandoNota}>
              {deletandoNota ? 'Excluindo…' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Adicionar NF */}
      <Dialog open={addDialog} onOpenChange={open => { if (!open) { setAddDialog(false); setAddErro('') } }}>
        {/* O modo PDF mostra a tabela de itens conferida — precisa de mais largura. */}
        {/* A conferência do PDF mostra tabela de itens com produto, quantidade,
            valor, efeito e centro de custo — em 3xl tudo espremia e o nome do
            produto e o efeito ficavam cortados (achado do Matheus na primeira
            importação real, 24/08/2026). Largura de verdade, mas limitada pela
            tela: `min(96vw, ...)` não estoura em notebook nem no celular. */}
        {/* ⚠️ TEM que ser `sm:max-w-[...]`, nunca `max-w-[...]`: o DialogContent do
            shadcn (components/ui/dialog.tsx:56) já traz `sm:max-w-sm`, e o twMerge
            NÃO remove uma classe de grupo diferente — as duas sobrevivem, e a que
            vier depois no CSS vence. Provado em 24/08/2026 compilando o CSS real:
            com `max-w-[1200px]` a janela continuava com 384px em qualquer tela
            ≥640px. É por isso que a primeira importação real do Matheus mostrou o
            menu de efeito como "Fatu…". Mesmo padrão de nfe/page.tsx:521 e
            cartoes/page.tsx:1126, que já usam `sm:max-w-[...]`. */}
        <DialogContent className={addMode === 'pdf' ? 'w-[96vw] sm:max-w-[1200px]' : 'max-w-lg'}>
          <DialogHeader>
            <DialogTitle>Adicionar Nota Fiscal</DialogTitle>
          </DialogHeader>

          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => { setAddMode('xml'); setXmlFileContent(null); setXmlFileName(null); setXmlError(''); setAddErro('') }}
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-all ${addMode === 'xml' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload XML
            </button>
            <button
              type="button"
              onClick={() => { setAddMode('pdf'); setAddErro('') }}
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-all ${addMode === 'pdf' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <FileText className="h-3.5 w-3.5" />
              Upload PDF
            </button>
            <button
              type="button"
              onClick={() => setAddMode('manual')}
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-all ${addMode === 'manual' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Plus className="h-3.5 w-3.5" />
              Manual
            </button>
          </div>

          {/* O modo PDF traz os próprios botões (ler → conferir → gravar), por
              isso o DialogFooter lá embaixo some quando ele está ativo. */}
          {addMode === 'pdf' ? (
            <ConferenciaPdf
              // Leva a lista até o mês da nota que acabou de entrar. Sem isto o
              // filtro de mês repetiria — agora por conta própria — o sumiço que
              // ele veio consertar: nota de julho importada em agosto ficaria
              // fora da vista logo depois de gravada.
              onGravada={dataEmissao => {
                setAddDialog(false)
                const mes = mesDaNota(dataEmissao) ?? TODOS_OS_MESES
                setUrlParam('mes', mes, '')
                loadNotas(mes)
              }}
              onCancelar={() => setAddDialog(false)}
            />
          ) : addMode === 'xml' ? (
            <div className="space-y-3">
              {/* File drop area */}
              <button
                type="button"
                className="w-full border-2 border-dashed border-input rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file) handleXmlFile(file)
                }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Arraste o arquivo XML aqui ou <span className="text-primary font-medium">clique para selecionar</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">Formato NF-e padrão SEFAZ</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xml,text/xml"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleXmlFile(file)
                  }}
                />
              </button>

              {xmlError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{xmlError}</p>
              )}

              {xmlFileName && !xmlError && (
                <div className="border rounded-lg p-3 bg-green-50/50 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-green-700 shrink-0" aria-hidden="true" />
                  <span className="text-sm font-medium truncate">{xmlFileName}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nf-numero">Número da NF</Label>
                  <Input
                    id="nf-numero"
                    placeholder="000001"
                    value={manualForm.numero}
                    onChange={e => setManualForm(f => ({ ...f, numero: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nf-data">Data de emissão</Label>
                  <Input
                    id="nf-data"
                    type="date"
                    value={manualForm.data_emissao}
                    onChange={e => setManualForm(f => ({ ...f, data_emissao: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nf-emitente">Nome do emitente</Label>
                <Input
                  id="nf-emitente"
                  placeholder="Distribuidora XYZ Ltda"
                  value={manualForm.emitente_nome}
                  onChange={e => setManualForm(f => ({ ...f, emitente_nome: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nf-cnpj">CNPJ <span className="text-muted-foreground text-xs">opcional</span></Label>
                  <Input
                    id="nf-cnpj"
                    placeholder="00.000.000/0001-00"
                    value={manualForm.emitente_cnpj}
                    onChange={e => setManualForm(f => ({ ...f, emitente_cnpj: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nf-valor">Valor total (R$)</Label>
                  <Input
                    id="nf-valor"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    value={manualForm.valor_total}
                    onChange={e => setManualForm(f => ({ ...f, valor_total: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          {addErro && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{addErro}</span>
            </div>
          )}

          {addMode !== 'pdf' && (
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddDialog(false); setAddErro('') }}>
                Cancelar
              </Button>
              <Button onClick={handleSaveNF} disabled={salvandoNF || !canSave || !fazendaAtiva}>
                {salvandoNF ? 'Salvando…' : 'Importar'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-40 bg-muted rounded" />
      <div className="h-72 bg-muted rounded-xl" />
    </div>
  )
}
