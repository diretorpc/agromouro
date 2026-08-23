'use client'

import { useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { plural } from '@/lib/utils'
import type { ResultadoGravarDocumento } from '@/lib/types'

type DialogoImportarProps = {
  onImportar: (pdf: File) => Promise<ResultadoGravarDocumento>
  // Rótulo do botão e do cabeçalho. O comportamento NÃO muda com ele: o
  // servidor decide o que fazer pelo TIPO lido do PDF, nunca pela aba de
  // origem — dois caminhos com regras diferentes para o mesmo arquivo seria
  // a porta dos fundos por onde uma trava de dedupe deixa de valer.
  titulo?: string
  // Important 5 da revisão final (23/08/2026). O servidor SEMPRE devolve o
  // aviso "isto é um extrato de revenda, nenhuma conta a pagar foi criada" —
  // e na aba Contas a Pagar ele é exatamente a informação que o dono precisa
  // (ele subiu o PDF ali esperando uma conta). Na aba Controle, importar
  // extrato é o caminho NORMAL: o mesmo aviso apareceria em âmbar em toda
  // importação, e âmbar que aparece sempre é âmbar que ninguém lê — o dono
  // seria treinado a ignorar justamente o canal dos avisos caros (parcela
  // perdida, conta sem vencimento, gasto que pode contar duas vezes).
  //
  // ⚠️ Isto muda SÓ O QUE A TELA EXIBE. A decisão de negócio continua 100%
  // no servidor, tomada pelo TIPO lido do PDF — nunca pela aba de origem.
  // Ver o comentário de `titulo`, logo acima, e a spec §7.
  mostrarAvisoDeExtrato?: boolean
}

type Estado =
  | { fase: 'ocioso' }
  | { fase: 'lendo' }
  | { fase: 'sucesso'; itensGravados: number; itensDuplicados: number; itensDescartados: number; contasCriadas: number; avisoContas: string | null; tipoDocumento: 'extrato' | 'contrato' }
  | { fase: 'aviso'; mensagem: string }  // duplicada — não é erro, não fecha sozinho
  | { fase: 'erro'; mensagem: string }

// Teto do lado do cliente. Precisa ficar abaixo do limite do servidor
// (express.json({ limit: '15mb' }) em api/src/index.ts, aplicado a
// /controle/documentos): o PDF viaja em base64, que infla ~33% — 10 MB de
// arquivo viram ~13,4 MB de corpo, ainda dentro dos 15 MB. Recusar aqui evita
// gastar upload e leitura por IA num arquivo que o servidor cortaria depois.
const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024

export function DialogoImportar({ onImportar, titulo, mostrarAvisoDeExtrato = false }: DialogoImportarProps) {
  const [aberto, setAberto] = useState(false)
  const [estado, setEstado] = useState<Estado>({ fase: 'ocioso' })
  const inputRef = useRef<HTMLInputElement>(null)

  function reiniciar() {
    setEstado({ fase: 'ocioso' })
    limparInput()
  }

  // Limpa o `value` do <input type="file"> SEM mexer no estado — o input não
  // dispara onChange numa segunda seleção do MESMO arquivo enquanto o value não
  // for zerado, e quem tenta reenviar o mesmo PDF não vê nada acontecer.
  function limparInput() {
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleArquivo(file: File) {
    // Checagem local ANTES da rede: um arquivo grande demais ou que não é PDF
    // gastaria leitura em base64 na memória do navegador, upload inteiro e, no
    // fim, um 413/500 do servidor com mensagem que não explica nada.
    // `file.type` vem do sistema operacional e pode vir vazio em alguns casos —
    // por isso aceita também a extensão .pdf em vez de recusar por falta de tipo.
    const parecePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!parecePdf) {
      setEstado({ fase: 'erro', mensagem: 'Só é possível importar arquivo PDF. Escolha um arquivo .pdf.' })
      limparInput()
      return
    }
    if (file.size > TAMANHO_MAXIMO_BYTES) {
      const tamanhoMb = (file.size / 1024 / 1024).toFixed(1).replace('.', ',')
      setEstado({
        fase: 'erro',
        mensagem: `O arquivo tem ${tamanhoMb} MB e o limite é 10 MB. Envie um PDF menor (ou divida o extrato em partes).`,
      })
      limparInput()
      return
    }

    setEstado({ fase: 'lendo' })
    try {
      const resultado = await onImportar(file)

      if (resultado.status === 'gravado') {
        // NÃO fecha sozinho: os três contadores são a única prova de que o
        // upload valeu alguma coisa. Antes o diálogo fechava calado e um extrato
        // reimportado (0 item novo, 40 já existentes) parecia idêntico a um
        // extrato novo inteiro. Fechar por temporizador exigiria cancelar o timer
        // em toda saída possível — deixar o Matheus fechar é mais simples e não
        // tem como dar errado. A lista atrás do diálogo já recarregou.
        setEstado({
          fase: 'sucesso',
          itensGravados:    resultado.itensGravados,
          itensDuplicados:  resultado.itensDuplicados,
          itensDescartados: resultado.itensDescartados,
          contasCriadas:    resultado.contasCriadas,
          avisoContas:      resultado.avisoContas,
          tipoDocumento:    resultado.tipoDocumento,
        })
        limparInput()
        return
      }
      // duplicada-hash / duplicada-conteudo
      setEstado({ fase: 'aviso', mensagem: 'Este documento já foi importado antes.' })
      limparInput()
    } catch (err) {
      // 422 (não reconhecido / sem item aproveitável / sem identidade), 503 (IA
      // indisponível) e 500 chegam aqui como Error — a API já manda a mensagem
      // certa em português no campo `error` (web/lib/api.ts repassa em .message).
      setEstado({ fase: 'erro', mensagem: err instanceof Error ? err.message : 'Erro ao importar o documento.' })
      limparInput()
    }
  }

  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
        {titulo ?? 'Importar documento'}
      </Button>

      <Dialog open={aberto} onOpenChange={o => { setAberto(o); if (!o) reiniciar() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{titulo ?? 'Importar documento de fornecedor'}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Extrato &quot;Contas a Receber&quot; ou contrato de compra (PDF, até 10 MB).
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            disabled={estado.fase === 'lendo'}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleArquivo(file)
            }}
            className="text-sm"
          />

          {estado.fase === 'lendo' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Lendo documento... isso pode levar alguns segundos.
            </div>
          )}

          {estado.fase === 'sucesso' && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <p className="font-medium">Documento importado.</p>
              <p>
                {plural(estado.itensGravados, 'item novo', 'itens novos')}
                {', '}
                {plural(estado.itensDuplicados, 'já constava', 'já constavam')}
                {', '}
                {plural(estado.itensDescartados, 'não pôde ser lido', 'não puderam ser lidos')}.
              </p>
              {estado.contasCriadas > 0 && (
                <p className="text-sm text-muted-foreground">
                  {plural(estado.contasCriadas, 'conta criada', 'contas criadas')} em Contas a Pagar.
                </p>
              )}
              {/* Aviso de CONTRATO sempre aparece (é caro: vencimento sem
                  data, parcela perdida, conta que faltou). Aviso de EXTRATO
                  só onde ele é notícia — a aba Contas a Pagar. Ver
                  `mostrarAvisoDeExtrato` no topo deste arquivo.
                  Checa `!== 'extrato'` em vez de `=== 'contrato'` de propósito:
                  se o Vercel subir antes do Railway numa janela de deploy, o
                  servidor antigo pode não mandar `tipoDocumento` nenhum
                  (undefined). Nesse caso o default precisa MOSTRAR o aviso —
                  esconder um aviso de contrato é o lado caro (vencimento sem
                  data passa batido); mostrar um aviso de extrato a mais é só
                  um âmbar de sobra, sem custo. */}
              {estado.avisoContas && (estado.tipoDocumento !== 'extrato' || mostrarAvisoDeExtrato) && (
                <p className="text-sm text-amber-600">{estado.avisoContas}</p>
              )}
            </div>
          )}

          {estado.fase === 'aviso' && (
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {estado.mensagem}
            </p>
          )}

          {estado.fase === 'erro' && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-destructive">
              {estado.mensagem}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAberto(false); reiniciar() }}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
