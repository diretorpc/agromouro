'use client'

// Importar SÓ o boleto de uma nota que já está no sistema.
//
// POR QUE EM DOIS PASSOS (31/08/2026). A nota 4507 da MIKAMI entrou em julho,
// quando o sistema ainda não puxava boleto — a conta a pagar nunca nasceu.
// Reimportar a nota duplicaria os itens; importar o boleto SOLTO é pior e mais
// silencioso: sem `nota_fiscal_id`, pagar a conta cria um lançamento no
// Financeiro EM CIMA do gasto da nota, e ninguém vê o erro.
//
// Por isso a tela LÊ, MOSTRA e só grava depois que o dono confirma a qual nota
// este boleto pertence. Casamento automático foi recusado de propósito:
// grampear na nota errada faz a despesa sumir do Financeiro.
//
// NADA aqui decide sobre dinheiro. Quem vem pré-marcado é escolhido no
// SERVIDOR (`sugestaoParaPreSelecionar`, com teste); quem pode ser amarrado é
// decidido no servidor; a tela só mostra e obedece.

import { useRef, useState } from 'react'
import { Loader2, FileText, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'
import { fmtBRL, fmtDate } from './lista-contas'
import type { BoletoLidoWeb, NotaSugeridaWeb, PreviewBoletoWeb } from './tipos'

// Alinhado com `LIMITE_MB = 8` em api/src/services/contas/boletoPdf.ts — o
// leitor recusa acima disso. O corpo viaja em base64 (infla ~33%), e
// `/contas/boleto` aceita 12 MB (api/src/index.ts), então 8 MB de PDF cabem.
// A versão anterior dizia 10 MB e o comentário citava "15 MB no servidor": os
// dois números estavam errados, e um boleto escaneado de 3 MB devolvia
// "Erro interno do servidor" (achado 6 do Apolo).
const TAMANHO_MAXIMO_BYTES = 8 * 1024 * 1024

type Estado =
  | { fase: 'ocioso' }
  | { fase: 'lendo' }
  | { fase: 'escolhendo'; boleto: BoletoLidoWeb; sugestoes: NotaSugeridaWeb[]; nomeArquivo: string; recusa?: string }
  | { fase: 'gravando'; boleto: BoletoLidoWeb; sugestoes: NotaSugeridaWeb[]; nomeArquivo: string }
  | { fase: 'sucesso'; mensagem: string }
  | { fase: 'aviso'; mensagem: string }
  | { fase: 'erro'; mensagem: string }

// `null` = "nenhuma nota" escolhido de propósito; `undefined` = ainda não
// escolheu. A diferença importa: sem ela o botão ficaria ativo antes de o dono
// decidir, e "nenhuma nota" é a opção perigosa.
type Escolha = string | null | undefined

export function DialogoImportarBoleto({ onGravado }: { onGravado: () => Promise<void> | void }) {
  const [aberto, setAberto] = useState(false)
  const [estado, setEstado] = useState<Estado>({ fase: 'ocioso' })
  const [escolha, setEscolha] = useState<Escolha>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  function reiniciar() {
    setEstado({ fase: 'ocioso' })
    setEscolha(undefined)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleArquivo(file: File) {
    if (file.size > TAMANHO_MAXIMO_BYTES) {
      setEstado({ fase: 'erro', mensagem: 'Arquivo maior que 8 MB — acima do que o leitor de boletos aceita.' })
      return
    }
    setEstado({ fase: 'lendo' })
    setEscolha(undefined)
    try {
      const arquivo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        // readAsDataURL devolve "data:application/pdf;base64,XXXX" — a API
        // espera só o base64 puro.
        reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
        reader.readAsDataURL(file)
      })

      const r = await api.post<PreviewBoletoWeb>('/contas/boleto/ler', { arquivo, nomeArquivo: file.name })
      setEstado({ fase: 'escolhendo', boleto: r.boleto, sugestoes: r.sugestoes, nomeArquivo: file.name })
      // Quem pode vir marcado é decisão do SERVIDOR. A tela não tem opinião.
      setEscolha(r.preSelecionar ?? undefined)
    } catch (err) {
      // 422 (não é boleto) e 503 (IA fora do ar) chegam com a mensagem certa em
      // português no campo `error` — web/lib/api.ts repassa em .message.
      setEstado({ fase: 'erro', mensagem: err instanceof Error ? err.message : 'Erro ao ler o boleto.' })
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleGravar() {
    if (estado.fase !== 'escolhendo' || escolha === undefined) return
    const { boleto, sugestoes, nomeArquivo } = estado
    setEstado({ fase: 'gravando', boleto, sugestoes, nomeArquivo })

    let gravou = false
    try {
      const r = await api.post<{ status: string }>('/contas/boleto', {
        boleto, nomeArquivo, notaFiscalId: escolha,
      })
      gravou = true
      if (r.status === 'duplicada') {
        setEstado({
          fase: 'aviso',
          mensagem: 'Já existe uma conta com este mesmo valor, vencimento e fornecedor. Nada foi criado — '
            + 'confira se aquela conta está amarrada na nota certa antes de pagar.',
        })
      } else if (r.status === 'adotada') {
        setEstado({
          fase: 'sucesso',
          mensagem: 'Já existia uma conta solta para esta cobrança, e ela foi amarrada à nota agora. '
            + 'Pagar não vai lançar o gasto de novo.',
        })
      } else {
        setEstado({
          fase: 'sucesso',
          mensagem: escolha === null
            ? 'Conta solta criada. Ao marcar como paga, o gasto será lançado no Financeiro.'
            : 'Amarrada à nota escolhida: pagar esta conta não vai lançar o gasto de novo no Financeiro.',
        })
      }
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Erro ao gravar o boleto.'
      // 409 é RECUSA, não falha: a nota não lançou gasto, o boleto já foi
      // importado, ou a conta que casou está encerrada. Volta para a escolha
      // com a leitura INTACTA — jogar para a tela de erro obrigaria a subir o
      // PDF de novo e a pagar outra leitura de IA, e o 409 mais provável vem
      // justamente da nota que o servidor pré-marcou (achado 5, rodada 2).
      if (err instanceof ApiError && err.status === 409) {
        setEstado({ fase: 'escolhendo', boleto, sugestoes, nomeArquivo, recusa: mensagem })
      } else {
        setEstado({ fase: 'erro', mensagem })
      }
    }

    // FORA do try: se a lista falhar ao recarregar (rede oscilando), a conta já
    // foi criada — dizer "erro ao gravar" seria mentir sobre um boleto de
    // dezenas de milhares (achado 10 do Apolo).
    if (gravou) {
      try { await onGravado() } catch { /* a lista se recupera no próximo F5 */ }
    }
  }

  function limparRecusa() {
    setEstado(e => (e.fase === 'escolhendo' && e.recusa ? { ...e, recusa: undefined } : e))
  }

  const podeGravar = estado.fase === 'escolhendo' && escolha !== undefined

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
        <FileText className="h-4 w-4 mr-1.5" aria-hidden="true" />
        Importar boleto (PDF)
      </Button>

      <Dialog open={aberto} onOpenChange={o => { setAberto(o); if (!o) reiniciar() }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar boleto de nota que já está no sistema</DialogTitle>
          </DialogHeader>

          {(estado.fase === 'ocioso' || estado.fase === 'lendo' || estado.fase === 'erro') && (
            <>
              <p className="text-sm text-muted-foreground">
                Para quando a nota já foi lançada mas o boleto ficou de fora. Cria só a conta a
                pagar — não mexe em estoque nem lança o gasto de novo.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                disabled={estado.fase === 'lendo'}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleArquivo(f) }}
                className="text-sm"
              />
            </>
          )}

          {estado.fase === 'lendo' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Lendo o boleto… isso pode levar alguns segundos.
            </div>
          )}

          {(estado.fase === 'escolhendo' || estado.fase === 'gravando') && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium">{estado.boleto.beneficiario}</p>
                <p className="text-muted-foreground">
                  {fmtBRL(estado.boleto.valor)} · vence {fmtDate(estado.boleto.vencimento)}
                  {estado.boleto.documento ? ` · documento ${estado.boleto.documento}` : ''}
                </p>
                {estado.boleto.cobradoPor && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Cobrança cedida a {estado.boleto.cobradoPor} — é esse nome que vai aparecer no extrato.
                  </p>
                )}
                {/* Carnê/nota parcelada: só a 1ª parcela vira conta. Sem este
                    aviso, 11 parcelas sumiriam sem nada na tela indicando. */}
                {estado.boleto.totalDeCobrancas > 1 && (
                  <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    Este documento tem {estado.boleto.totalDeCobrancas} cobranças. Só esta vira conta —
                    as outras precisam ser lançadas à mão.
                  </p>
                )}
              </div>

              {estado.fase === 'escolhendo' && estado.recusa && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{estado.recusa}</span>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-2">A qual nota este boleto pertence?</p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {estado.sugestoes.map(n => (
                    <label
                      key={n.id}
                      className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                    >
                      {/* NÃO desabilita nota que já tem conta: pode ser a 2ª
                          parcela, caso legítimo. Desabilitar empurrava o dono
                          para a caixa vermelha — o caminho do gasto dobrado
                          (achado 3 do Apolo). O servidor recusa só quando o
                          valor E o vencimento batem, aí é o mesmo boleto. */}
                      <input
                        type="radio"
                        name="nota"
                        className="mt-1"
                        disabled={estado.fase === 'gravando'}
                        checked={escolha === n.id}
                        onChange={() => { setEscolha(n.id); limparRecusa() }}
                      />
                      <span className="min-w-0">
                        <span className="font-medium">NF {n.numero} — {n.emitente_nome}</span>
                        <span className="block text-muted-foreground">
                          {fmtBRL(n.valor_total)} · emitida {fmtDate(n.data_emissao)} · {n.motivos.join(', ')}
                        </span>
                        {n.contas.length > 0 && (
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            Já tem {n.contas.length === 1 ? 'uma conta' : `${n.contas.length} contas`}:{' '}
                            {n.contas.map(c => `${fmtBRL(c.valor ?? 0)}${c.vencimento ? ` em ${fmtDate(c.vencimento)}` : ''}`).join(' · ')}.
                            Se este boleto é outra parcela, pode escolher assim mesmo.
                          </span>
                        )}
                        {/* Amarrar em nota que não lançou gasto faz o dinheiro
                            SUMIR — pior que dobrado, porque dobrado o dono vê. */}
                        {!n.lancouGasto && (
                          <span className="block text-xs text-amber-700 mt-0.5">
                            Esta nota não lançou gasto no Financeiro. Amarrar aqui faria a despesa sumir —
                            use &quot;Nenhuma&quot; para que o pagamento vire despesa.
                          </span>
                        )}
                      </span>
                    </label>
                  ))}

                  {estado.sugestoes.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma nota no sistema parece ser deste boleto.
                    </p>
                  )}

                  <label className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="nota"
                      className="mt-1"
                      disabled={estado.fase === 'gravando'}
                      checked={escolha === null}
                      onChange={() => { setEscolha(null); limparRecusa() }}
                    />
                    <span>
                      <span className="font-medium text-red-700">Nenhuma — esta cobrança não tem nota no sistema</span>
                      <span className="block text-red-700/90">
                        A conta nasce solta. Ao marcar como paga, o sistema vai lançar o gasto no
                        Financeiro. <strong>Se a nota já estiver lançada, o gasto conta duas vezes.</strong>
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {estado.fase === 'gravando' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Gravando…
                </div>
              )}
            </div>
          )}

          {estado.fase === 'sucesso' && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <p className="font-medium">Conta a pagar pronta.</p>
              <p>{estado.mensagem}</p>
            </div>
          )}

          {estado.fase === 'aviso' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {estado.mensagem}
            </div>
          )}

          {estado.fase === 'erro' && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {estado.mensagem}
            </div>
          )}

          <DialogFooter>
            {(estado.fase === 'escolhendo' || estado.fase === 'gravando') ? (
              <>
                <Button variant="outline" onClick={reiniciar} disabled={estado.fase === 'gravando'}>
                  Trocar arquivo
                </Button>
                <Button onClick={handleGravar} disabled={!podeGravar}>
                  {estado.fase === 'gravando' ? 'Gravando…' : 'Criar conta a pagar'}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setAberto(false)}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
