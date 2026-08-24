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
  // Qual família de efeito o CFOP lido representa, calculada pela API
  // (contas/cfop.ts). Vazia quando o CFOP não foi lido — aí o dono escolhe.
  // Só existe na tela: o servidor reconstrói o item a partir do `cfop`.
  familia?:       string
}

// Efeitos que a tela oferece, em português de produtor. Vêm prontos da API —
// regra fiscal tem um dono só neste projeto, e não é o front.
type FamiliaItem = { chave: string; rotulo: string; cfop: string }

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
  // Nota com o mesmo número e CNPJ gravada no OUTRO modelo (NF-e x NFS-e).
  // Aviso, não bloqueio: se a IA classificou errado, as duas travas de
  // duplicidade procuram no modelo errado e a compra entra duas vezes.
  existeNoOutroModelo?: NotaNoBanco | null
  familias?: FamiliaItem[]
}

type RespostaGravacao = {
  status: 'gravada' | 'duplicada-nota' | 'duplicada-arquivo'
  nota?: NotaNoBanco
}

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

// Mesmo teto do leitor (LIMITE_MB em api/src/services/nfe/notaPdf.ts) e do
// bucket. Barrar AQUI é o que dá mensagem em português: acima de ~11,3 MB o
// corpo estoura o body-parser da API antes de a rota rodar, e o dono lê
// "Erro interno do servidor" (achado do Apolo, 24/08/2026).
const LIMITE_BYTES = 10 * 1024 * 1024

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
  // Quantas linhas o dono tirou à mão — muda o que o rodapé pode afirmar sobre
  // a diferença entre a soma dos itens e o total da nota.
  const [itensRemovidos, setItensRemovidos] = useState(0)
  // O aviso "esta nota já existe" vale para o número/CNPJ/tipo que a IA LEU.
  // Se o dono corrigir qualquer um dos três, o aviso envelheceu e não pode
  // continuar travando o botão (achado do Apolo, 24/08/2026: número lido errado
  // que casava com nota existente deixava a nota real sem caminho de entrada).
  const [identidadeEditada, setIdentidadeEditada] = useState(false)
  // Foto do que a IA leu, tirada no instante em que a leitura chega — antes de
  // qualquer edição. Mostrado ao lado dos campos para o dono CONFERIR contra o
  // papel, em vez de só confiar que "o servidor recusa se for duplicata": um
  // dígito errado no CNPJ faz o servidor não achar nada e gravar a nota como
  // se fosse nova (achado do Apolo, 24/08/2026).
  const [lidoOriginal, setLidoOriginal] = useState<{ numero: string; emitenteCnpj: string } | null>(null)

  function escolherArquivo(file: File) {
    setErro(''); setLeitura(null); setNota(null)
    setNomeArquivo(file.name)
    setBase64(null)
    setLidoOriginal(null)
    setIdentidadeEditada(false)
    if (file.size > LIMITE_BYTES) {
      setErro(`Arquivo grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB). O limite é 10 MB.`)
      return
    }
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
      setLidoOriginal({ numero: r.nota.numero, emitenteCnpj: r.nota.emitenteCnpj })
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
    setItensRemovidos(n => n + 1)
  }

  // Trocar o efeito de um item grava o CFOP representante daquela família —
  // o dono escolhe "já paguei antes", não "5117". MAS: se a família escolhida
  // é a MESMA que o item já tinha e ele já veio com um CFOP lido, não
  // reescrever — só quando a família muda de verdade ou o CFOP original
  // estava vazio. Sem essa trava, confirmar a família de um item 6117
  // (interestadual) gravava 5117 (interno) — um código que a nota nunca
  // imprimiu, só porque o dono confirmou o que a IA já tinha acertado.
  function escolherFamilia(indice: number, chave: string) {
    if (!nota) return
    const familia = leitura?.familias?.find(f => f.chave === chave)
    if (!familia) return
    setNota({
      ...nota,
      itens: nota.itens.map((item, n) => {
        if (n !== indice) return item
        const mantemCfopOriginal = item.familia === chave && !!item.cfop
        return { ...item, cfop: mantemCfopOriginal ? item.cfop : familia.cfop, familia: familia.chave }
      }),
    })
  }

  // Atalho para a nota comum (tudo é compra) — evita 30 cliques quando a coluna
  // CFOP inteira saiu borrada. É escolha EXPLÍCITA do dono, não default calado.
  function marcarRestantesComoCompra() {
    if (!nota) return
    const compra = leitura?.familias?.find(f => f.chave === 'compra')
    if (!compra) return
    setNota({
      ...nota,
      itens: nota.itens.map(item =>
        item.cfop ? item : { ...item, cfop: compra.cfop, familia: compra.chave }),
    })
  }

  function editar<K extends keyof NotaLida>(campo: K, valor: NotaLida[K]) {
    if (!nota) return
    if (campo === 'numero' || campo === 'emitenteCnpj' || campo === 'modelo') setIdentidadeEditada(true)
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
  // O aviso só vale enquanto o dono não mexer na identificação da nota.
  const duplicataValendo = leitura.jaExiste && !identidadeEditada

  return (
    <div className="space-y-4">
      {duplicataValendo && (
        <div className="rounded-md bg-red-50 text-red-700 px-3 py-2 text-sm">
          <strong>Esta nota já está no sistema</strong>
          {leitura.jaExiste?.data_emissao ? ` (entrou em ${ddmmaaaa(leitura.jaExiste.data_emissao)})` : ''}.
          {' '}Gravar de novo somaria estoque e gasto duas vezes.
          {' '}Se o número ou o CNPJ estiverem lidos errado, corrija abaixo — o sistema confere
          de novo com o número corrigido.
        </div>
      )}

      {leitura.jaExiste && identidadeEditada && (
        <div className="rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-sm">
          Você corrigiu a identificação da nota. A conferência de duplicidade é refeita no
          servidor ao gravar — se ainda for a mesma nota, ela é recusada lá.
        </div>
      )}

      {leitura.existeNoOutroModelo && (
        <div className="rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-sm">
          Já existe uma nota <strong>{nota.modelo === 'nfe' ? 'de serviço (NFS-e)' : 'de produto (NF-e)'}</strong>{' '}
          com este mesmo número e fornecedor. Confira o campo <strong>Tipo</strong>: se o tipo estiver
          errado, o sistema não reconhece a nota repetida e a compra entra duas vezes.
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
          {/* `familias` pode vir vazia/undefined quando a API é mais velha que o
              front (web novo na Vercel, API antiga no Railway — sobem separados).
              Sem família não existe escolha possível: o select só teria "— escolha
              —" e o atalho não faria nada, então travar o botão prenderia o dono
              sem saída. Mostramos o aviso antigo (sem exigir escolha) nesse caso. */}
          {semCfop > 0 && ((leitura.familias?.length ?? 0) > 0 ? (
            <p>
              {semCfop} item(ns) sem CFOP legível. <strong>Escolha na coluna "O que é este item"</strong> —
              sem escolha o sistema assume compra nova, e numa nota de entrega de pedido já pago isso
              conta o gasto duas vezes.{' '}
              <button
                type="button"
                className="underline font-medium"
                onClick={marcarRestantesComoCompra}
              >
                São todos compra normal
              </button>
            </p>
          ) : (
            <p>
              {semCfop} item(ns) sem CFOP legível — vão entrar como compra normal e somar no estoque.
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="pdf-numero">Número da nota</Label>
          <Input id="pdf-numero" value={nota.numero} onChange={e => editar('numero', e.target.value)} />
          {lidoOriginal && <p className="text-[10px] text-muted-foreground">a IA leu: {lidoOriginal.numero}</p>}
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
          {lidoOriginal && <p className="text-[10px] text-muted-foreground">a IA leu: {lidoOriginal.emitenteCnpj}</p>}
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
                <th className="text-left p-2">O que é este item</th>
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
                  {/* O CFOP decide estoque, bonificação e entrega futura. Quando a
                      IA não conseguiu ler, sem escolha o item entra como COMPRA — e
                      numa nota de entrega futura isso dobra o gasto. O dono escolhe o
                      EFEITO em português; o código sai da lista que a API mandou.
                      Família fora da lista (consignação, remessa sem compra) aparece
                      como código cru: trocá-la por "compra" seria piorar. */}
                  <td className={`p-2 ${item.cfop ? '' : 'bg-amber-50'}`}>
                    {item.cfop && !item.familia ? (
                      <span title="CFOP com efeito próprio — não mexa sem motivo">CFOP {item.cfop}</span>
                    ) : (
                      <>
                        <select
                          className={`w-full rounded border bg-background px-1 py-0.5 text-xs ${item.familia ? 'border-input' : 'border-amber-400 text-amber-800'}`}
                          value={item.familia ?? ''}
                          aria-label={`O que é o item ${item.descricao}`}
                          onChange={e => escolherFamilia(n, e.target.value)}
                        >
                          {!item.familia && <option value="">— escolha —</option>}
                          {(leitura.familias ?? []).map(f => (
                            <option key={f.chave} value={f.chave}>{f.rotulo}</option>
                          ))}
                        </select>
                        {/* `efeitoDoCfop` (api/contas/cfop.ts) devolve "compra normal"
                            para todo código FORA da tabela conhecida — inclusive 5906/
                            6906 (retirada de depósito, problema aberto no backlog: conta
                            como gasto novo sem ser). O select já preenchido some com essa
                            pista; manter o código impresso, discreto, é o que deixa o dono
                            notar um CFOP que o sistema classificou como compra sem ser. */}
                        {item.cfop && (
                          <span className="block text-[10px] text-muted-foreground">CFOP {item.cfop}</span>
                        )}
                      </>
                    )}
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
        {/* Duas frases diferentes de propósito: com item removido, dizer "a
            diferença é frete e imposto" seria mentira — e é justamente a frase
            que faria o dono não desconfiar (achado do Apolo, 24/08/2026). */}
        {itensRemovidos > 0 ? (
          <p className="text-xs text-amber-700 mt-1">
            Você removeu {itensRemovidos} linha(s). Remover linha tira o item do estoque
            <strong> e</strong> da lista do Financeiro. O lançamento de gasto só mantém o
            total impresso na nota ({brl(nota.valorTotal)}) quando todas as linhas restantes
            forem compra — havendo bonificação ou entrega já paga entre elas, o lançamento
            passa a ser a soma dos itens ({brl(somaItens)}), e os dois totais podem ficar
            diferentes. Não use isto para descontar valor da nota.
          </p>
        ) : Math.abs(somaItens - nota.valorTotal) > 0.01 && (
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
        {/* Item sem efeito escolhido TRAVA a gravação: deixar passar equivale a
            decidir "é compra" por omissão, que é o caminho do gasto dobrado. Mas
            só trava quando existe ESCOLHA possível (`familias` não vazia) — um
            botão que trava sem oferecer a ação que destrava é pior que o default
            que ele evita (achado do Apolo, 24/08/2026: API antiga sem `familias`
            deixava o dono sem nenhum caminho para gravar a nota). */}
        <Button
          onClick={gravar}
          disabled={gravando || nota.itens.length === 0 || !!duplicataValendo || (semCfop > 0 && (leitura.familias?.length ?? 0) > 0)}
          title={semCfop > 0 && (leitura.familias?.length ?? 0) > 0 ? 'Escolha o que é cada item marcado em amarelo' : undefined}
        >
          {gravando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {gravando ? 'Gravando…' : 'Confirmar e gravar'}
        </Button>
      </div>
    </div>
  )
}
