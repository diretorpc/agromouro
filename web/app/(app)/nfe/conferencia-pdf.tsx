'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Trash2, AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

// Toda a UI do modo "Upload PDF" mora aqui, fora de page.tsx (que já passa de
// 700 linhas). O fluxo tem DOIS passos porque a leitura é da IA, não do dado
// fiscal: primeiro LER (não grava nada), depois CONFERIR e gravar.
//
// A conferência não é enfeite: um dígito errado no número ou no CNPJ fura o
// índice único da nota, e quando a mesma nota chegar pelo Make o estoque e o
// gasto contam duas vezes, calados.

type ItemLido = {
  descricao:      string
  quantidade:     number
  unidade:        string
  valorUnitario:  number
  valorTotal:     number
  quantidadeTrib: number
  unidadeTrib:    string
  ncm:            string
  cfop:           string
}

type DuplicataLida = { numero: string; vencimento: string | null; valor: number | null }

type NotaLida = {
  modelo:         'nfe' | 'nfse'
  numero:         string
  emitenteNome:   string
  emitenteCnpj:   string
  dataEmissao:    string
  valorTotal:     number
  formaPagamento: string | null
  duplicatas:     DuplicataLida[]
  itens:          ItemLido[]
}

type NotaNoBanco = { id: string; numero: string; data_emissao: string; emitente_nome: string }

type RespostaLeitura = {
  status: 'nota'
  nota: NotaLida
  itensDescartados: number
  duplicatasDescartadas: number
  jaExiste: NotaNoBanco | null
}

type RespostaGravacao = {
  status: 'gravada' | 'duplicada-nota' | 'duplicada-arquivo'
  nota?: NotaNoBanco
}

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ddmmaaaa = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

export function ConferenciaPdf({ onGravada, onCancelar }: { onGravada: () => void; onCancelar: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [base64, setBase64] = useState<string | null>(null)
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')
  const [leitura, setLeitura] = useState<RespostaLeitura | null>(null)
  const [nota, setNota] = useState<NotaLida | null>(null)

  function escolherArquivo(file: File) {
    setErro(''); setLeitura(null); setNota(null)
    setNomeArquivo(file.name)
    setBase64(null)
    const reader = new FileReader()
    reader.onload = e => {
      // readAsDataURL devolve "data:application/pdf;base64,XXXX" — a API quer
      // só o miolo. O arquivo fica AQUI, no navegador, entre os dois passos:
      // desistir na conferência não deixa órfão no Storage.
      const url = String(e.target?.result ?? '')
      setBase64(url.split(',')[1] ?? null)
    }
    reader.onerror = () => setErro('Não consegui ler o arquivo do seu computador.')
    reader.readAsDataURL(file)
  }

  async function ler() {
    if (!base64 || !nomeArquivo) return
    setLendo(true); setErro('')
    try {
      const r = await api.post<RespostaLeitura>('/nfe/ler-pdf', { arquivo: base64, nomeArquivo })
      setLeitura(r)
      setNota(r.nota)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao ler o PDF.')
    } finally {
      setLendo(false)
    }
  }

  async function gravar() {
    if (!nota || !base64 || !nomeArquivo) return
    setGravando(true); setErro('')
    try {
      const r = await api.post<RespostaGravacao>('/nfe/importar-pdf', { arquivo: base64, nomeArquivo, nota })
      if (r.status === 'duplicada-nota') {
        const quando = r.nota?.data_emissao ? ` (entrou em ${ddmmaaaa(r.nota.data_emissao)})` : ''
        setErro(`Esta nota já está no sistema${quando}.`)
        return
      }
      if (r.status === 'duplicada-arquivo') {
        setErro('Este mesmo PDF já foi importado antes.')
        return
      }
      onGravada()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao gravar a nota.')
    } finally {
      setGravando(false)
    }
  }

  function removerItem(indice: number) {
    if (!nota) return
    setNota({ ...nota, itens: nota.itens.filter((_, n) => n !== indice) })
  }

  function editar<K extends keyof NotaLida>(campo: K, valor: NotaLida[K]) {
    if (!nota) return
    setNota({ ...nota, [campo]: valor })
  }

  // ─── Passo 1: escolher o arquivo e mandar ler ─────────────────────────────
  if (!leitura || !nota) {
    return (
      <div className="space-y-4">
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Arraste o PDF da nota aqui ou <span className="text-primary font-medium">clique para selecionar</span>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) escolherArquivo(f) }}
          />
        </div>

        {nomeArquivo && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium truncate">{nomeArquivo}</span>
          </div>
        )}

        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>}

        <p className="text-xs text-muted-foreground">
          A leitura leva alguns segundos. Nada é gravado até você conferir e confirmar.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
          <Button onClick={ler} disabled={!base64 || lendo}>
            {lendo && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {lendo ? 'Lendo o PDF…' : 'Ler PDF'}
          </Button>
        </div>
      </div>
    )
  }

  // ─── Passo 2: conferir o que a IA leu e gravar ────────────────────────────
  const somaItens = nota.itens.reduce((s, i) => s + i.valorTotal, 0)
  const semCfop = nota.itens.filter(i => !i.cfop).length

  return (
    <div className="space-y-4">
      {leitura.jaExiste && (
        <div className="rounded-md bg-red-50 text-red-700 px-3 py-2 text-sm">
          <strong>Esta nota já está no sistema</strong>
          {leitura.jaExiste.data_emissao ? ` (entrou em ${ddmmaaaa(leitura.jaExiste.data_emissao)})` : ''}.
          {' '}Gravar de novo somaria estoque e gasto duas vezes.
        </div>
      )}

      {(leitura.itensDescartados > 0 || leitura.duplicatasDescartadas > 0 || semCfop > 0) && (
        <div className="rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> Confira antes de gravar
          </div>
          {leitura.itensDescartados > 0 && (
            <p>{leitura.itensDescartados} item(ns) não puderam ser lidos e ficaram de fora.</p>
          )}
          {leitura.duplicatasDescartadas > 0 && (
            <p>{leitura.duplicatasDescartadas} parcela(s) de cobrança ficaram de fora.</p>
          )}
          {semCfop > 0 && (
            <p>{semCfop} item(ns) sem CFOP legível — vão entrar como compra normal e somar no estoque.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="pdf-numero">Número da nota</Label>
          <Input id="pdf-numero" value={nota.numero} onChange={e => editar('numero', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-modelo">Tipo</Label>
          <select
            id="pdf-modelo"
            className={SELECT_CLASS}
            value={nota.modelo}
            onChange={e => editar('modelo', e.target.value as 'nfe' | 'nfse')}
          >
            <option value="nfe">NF-e (produto)</option>
            <option value="nfse">NFS-e (serviço)</option>
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <Label htmlFor="pdf-emitente">Fornecedor</Label>
          <Input id="pdf-emitente" value={nota.emitenteNome} onChange={e => editar('emitenteNome', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-cnpj">CNPJ do fornecedor</Label>
          <Input id="pdf-cnpj" value={nota.emitenteCnpj} onChange={e => editar('emitenteCnpj', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-data">Data de emissão</Label>
          <Input id="pdf-data" type="date" value={nota.dataEmissao} onChange={e => editar('dataEmissao', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-valor">Valor total</Label>
          <Input
            id="pdf-valor"
            type="number"
            step="0.01"
            value={nota.valorTotal}
            onChange={e => editar('valorTotal', parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Itens ({nota.itens.length})</p>
        <div className="max-h-64 overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left p-2">Produto</th>
                <th className="text-right p-2">Qtd</th>
                <th className="text-left p-2">Un</th>
                <th className="text-right p-2">Total</th>
                <th className="text-center p-2">CFOP</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {nota.itens.map((item, n) => (
                <tr key={n} className="border-t">
                  <td className="p-2">{item.descricao}</td>
                  <td className="p-2 text-right">{item.quantidade}</td>
                  <td className="p-2">{item.unidade}</td>
                  <td className="p-2 text-right">{brl(item.valorTotal)}</td>
                  {/* CFOP vazio fica amarelo: é ele que decide estoque, bonificação
                      e remessa de entrega futura — sem ele o item entra como compra. */}
                  <td className={`p-2 text-center ${item.cfop ? '' : 'bg-amber-50 text-amber-700'}`}>
                    {item.cfop || '—'}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      onClick={() => removerItem(n)}
                      aria-label={`Remover ${item.descricao}`}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {Math.abs(somaItens - nota.valorTotal) > 0.01 && (
          <p className="text-xs text-muted-foreground mt-1">
            Soma dos itens: {brl(somaItens)} — diferente do total da nota ({brl(nota.valorTotal)}).
            A diferença normalmente é frete e imposto, que o total já inclui.
          </p>
        )}
      </div>

      {nota.duplicatas.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">Boletos que vão para Contas a Pagar</p>
          <ul className="text-xs space-y-1">
            {nota.duplicatas.map((d, n) => (
              <li key={n} className="flex justify-between rounded bg-muted px-2 py-1">
                <span>
                  Parcela {d.numero || n + 1} — {d.vencimento ? ddmmaaaa(d.vencimento) : 'sem vencimento lido'}
                </span>
                <span>{d.valor !== null ? brl(d.valor) : '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {erro && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
        <Button onClick={gravar} disabled={gravando || nota.itens.length === 0 || !!leitura.jaExiste}>
          {gravando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {gravando ? 'Gravando…' : 'Confirmar e gravar'}
        </Button>
      </div>
    </div>
  )
}
