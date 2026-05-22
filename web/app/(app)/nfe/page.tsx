'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, RefreshCw, Plus, Download, Upload, CircleDollarSign, Trash2 } from 'lucide-react'
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
import { supabase } from '@/lib/supabase'
import type { NotaFiscal, ItemNfe } from '@/lib/types'

const STATUS_STYLE: Record<string, string> = {
  recebida: 'bg-blue-100 text-blue-700 border-blue-200',
  processando: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  processada: 'bg-green-100 text-green-700 border-green-200',
  erro: 'bg-red-100 text-red-700 border-red-200',
}

type ParsedNFe = {
  numero: string
  emitente_nome: string
  emitente_cnpj: string
  data_emissao: string
  valor_total: number
  itens: { descricao: string; quantidade: number; unidade: string; valor_unitario: number; valor_total: number }[]
}

function parseNFeXML(xmlStr: string): ParsedNFe | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlStr, 'text/xml')
    if (doc.querySelector('parsererror')) return null

    const getTag = (tag: string, ctx?: Element | Document) =>
      (ctx ?? doc).getElementsByTagName(tag)[0]?.textContent?.trim() ?? ''

    const numero = getTag('nNF')
    const emitente_nome = getTag('xNome')
    const emitente_cnpj = doc.getElementsByTagName('CNPJ')[0]?.textContent?.trim() ?? ''
    const data_emissao = getTag('dhEmi') || getTag('dEmi')
    const valor_total = parseFloat(getTag('vNF')) || 0

    const dets = Array.from(doc.getElementsByTagName('det'))
    const itens = dets.map(det => {
      const prod = det.getElementsByTagName('prod')[0]
      return {
        descricao: getTag('xProd', prod),
        quantidade: parseFloat(getTag('qCom', prod)) || 0,
        unidade: getTag('uCom', prod),
        valor_unitario: parseFloat(getTag('vUnCom', prod)) || 0,
        valor_total: parseFloat(getTag('vProd', prod)) || 0,
      }
    })

    if (!numero || !emitente_nome) return null
    return { numero, emitente_nome, emitente_cnpj, data_emissao, valor_total, itens }
  } catch {
    return null
  }
}

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
  const [addMode, setAddMode] = useState<'xml' | 'manual'>('xml')
  const [xmlPreview, setXmlPreview] = useState<ParsedNFe | null>(null)
  const [xmlError, setXmlError] = useState('')
  const [salvandoNF, setSalvandoNF] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [manualForm, setManualForm] = useState({
    numero: '', emitente_nome: '', emitente_cnpj: '',
    data_emissao: '', valor_total: '',
  })

  async function loadNotas() {
    const { data } = await supabase
      .from('notas_fiscais')
      .select('*')
      .order('data_emissao', { ascending: false })
    setNotas((data ?? []) as NotaFiscal[])
    setLoading(false)
  }

  useEffect(() => { loadNotas() }, [])

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

    await supabase.from('itens_nfe').delete().eq('nota_fiscal_id', deleteNota.id)

    const { data: deleted, error } = await supabase
      .from('notas_fiscais')
      .delete()
      .eq('id', deleteNota.id)
      .select('id')

    setDeletandoNota(false)

    if (error) {
      setDeleteNotaErro(`Erro: ${error.message}`)
      return
    }

    if (!deleted || deleted.length === 0) {
      setDeleteNotaErro('Sem permissão para excluir esta nota. Verifique as políticas do banco.')
      return
    }

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
    setXmlPreview(null)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseNFeXML(text)
      if (!parsed) {
        setXmlError('Arquivo XML inválido ou formato não reconhecido.')
      } else {
        setXmlPreview(parsed)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  async function handleSaveNF() {
    setSalvandoNF(true)
    try {
      if (addMode === 'xml' && xmlPreview) {
        const { data: nota } = await supabase
          .from('notas_fiscais')
          .insert({
            numero: xmlPreview.numero,
            emitente_nome: xmlPreview.emitente_nome,
            emitente_cnpj: xmlPreview.emitente_cnpj,
            data_emissao: xmlPreview.data_emissao,
            valor_total: xmlPreview.valor_total,
            status: 'recebida',
          })
          .select()
          .single()
        if (nota && xmlPreview.itens.length > 0) {
          await supabase.from('itens_nfe').insert(
            xmlPreview.itens.map(item => ({
              nota_fiscal_id: nota.id,
              descricao: item.descricao,
              quantidade: item.quantidade,
              unidade: item.unidade,
              valor_unitario: item.valor_unitario,
              valor_total: item.valor_total,
              insumo_id: null,
            }))
          )
        }
      } else if (addMode === 'manual') {
        await supabase.from('notas_fiscais').insert({
          numero: manualForm.numero.trim(),
          emitente_nome: manualForm.emitente_nome.trim(),
          emitente_cnpj: manualForm.emitente_cnpj.trim(),
          data_emissao: manualForm.data_emissao,
          valor_total: parseFloat(manualForm.valor_total) || 0,
          status: 'recebida',
        })
      }
    } finally {
      setSalvandoNF(false)
      setAddDialog(false)
      setXmlPreview(null)
      setXmlError('')
      setManualForm({ numero: '', emitente_nome: '', emitente_cnpj: '', data_emissao: '', valor_total: '' })
      loadNotas()
    }
  }

  const canSave = addMode === 'xml' ? !!xmlPreview : !!(manualForm.numero && manualForm.emitente_nome && manualForm.data_emissao)

  if (loading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notas Fiscais</h1>
        <Button size="sm" onClick={() => { setAddDialog(true); setAddMode('xml'); setXmlPreview(null); setXmlError('') }}>
          <Plus className="h-4 w-4 mr-1.5" />
          Adicionar NF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            NF-e Recebidas
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
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
              {notas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nenhuma nota fiscal recebida ainda.
                  </TableCell>
                </TableRow>
              ) : notas.map(nota => (
                <TableRow key={nota.id}>
                  <TableCell className="font-medium">{nota.numero}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{nota.emitente_nome}</p>
                      <p className="text-xs text-muted-foreground">{nota.emitente_cnpj}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(nota.data_emissao).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {nota.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_STYLE[nota.status] ?? ''}>
                      {nota.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openNota(nota)}>
                        Ver itens
                      </Button>
                      <Button size="sm" variant="ghost" title="Exportar XML" onClick={() => exportarXML(nota)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      {nota.status === 'processada' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Ver no Financeiro"
                          onClick={() => router.push('/financeiro')}
                        >
                          <CircleDollarSign className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                      )}
                      {nota.status === 'erro' && (
                        <Button size="sm" variant="ghost" onClick={() => reprocessar(nota)}>
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Excluir nota"
                        onClick={() => { setDeleteNota(nota); setDeleteNotaErro(null) }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog: Ver Itens */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              NF-e {selected?.numero} — {selected?.emitente_nome}
            </DialogTitle>
          </DialogHeader>
          {loadingItens ? (
            <div className="space-y-2 animate-pulse">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <Table>
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
                      <TableCell className="text-sm font-medium">{item.descricao}</TableCell>
                      <TableCell className="text-right text-sm">{item.quantidade} {item.unidade}</TableCell>
                      <TableCell className="text-right text-sm">
                        {item.valor_unitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {item.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.insumos
                          ? <span className="text-green-700">{item.insumos.nome}</span>
                          : <span className="text-yellow-600 text-xs">Não vinculado</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {selected && (
                <div className="flex justify-between text-sm border-t pt-3">
                  <span className="text-muted-foreground">Total da NF-e</span>
                  <span className="font-bold text-base">
                    {selected.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </div>
              )}
            </div>
          )}
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
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {deleteNotaErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteNota(null); setDeleteNotaErro(null) }}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteNota} disabled={deletandoNota}>
              {deletandoNota ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Adicionar NF */}
      <Dialog open={addDialog} onOpenChange={open => { if (!open) setAddDialog(false) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar Nota Fiscal</DialogTitle>
          </DialogHeader>

          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => { setAddMode('xml'); setXmlPreview(null); setXmlError('') }}
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-all ${addMode === 'xml' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload XML
            </button>
            <button
              type="button"
              onClick={() => setAddMode('manual')}
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-all ${addMode === 'manual' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <FileText className="h-3.5 w-3.5" />
              Manual
            </button>
          </div>

          {addMode === 'xml' ? (
            <div className="space-y-3">
              {/* File drop area */}
              <div
                className="border-2 border-dashed border-input rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file) handleXmlFile(file)
                }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
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
              </div>

              {xmlError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{xmlError}</p>
              )}

              {xmlPreview && (
                <div className="border rounded-lg p-3 space-y-2 bg-green-50/50">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prévia</p>
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    <span className="text-muted-foreground">Número:</span>
                    <span className="font-medium">{xmlPreview.numero}</span>
                    <span className="text-muted-foreground">Emitente:</span>
                    <span className="font-medium">{xmlPreview.emitente_nome}</span>
                    <span className="text-muted-foreground">CNPJ:</span>
                    <span>{xmlPreview.emitente_cnpj}</span>
                    <span className="text-muted-foreground">Valor total:</span>
                    <span className="font-semibold text-green-700">
                      {xmlPreview.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                    <span className="text-muted-foreground">Itens:</span>
                    <span>{xmlPreview.itens.length} produto{xmlPreview.itens.length !== 1 ? 's' : ''}</span>
                  </div>
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveNF} disabled={salvandoNF || !canSave}>
              {salvandoNF ? 'Salvando...' : 'Importar'}
            </Button>
          </DialogFooter>
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
