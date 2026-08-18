'use client'

import { useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ResultadoGravarDocumento } from '@/lib/types'

type DialogoImportarProps = {
  onImportar: (pdf: File) => Promise<ResultadoGravarDocumento>
}

type Estado =
  | { fase: 'ocioso' }
  | { fase: 'lendo' }
  | { fase: 'aviso'; mensagem: string }  // duplicada — não é erro, não fecha sozinho
  | { fase: 'erro'; mensagem: string }

export function DialogoImportar({ onImportar }: DialogoImportarProps) {
  const [aberto, setAberto] = useState(false)
  const [estado, setEstado] = useState<Estado>({ fase: 'ocioso' })
  const inputRef = useRef<HTMLInputElement>(null)

  function reiniciar() {
    setEstado({ fase: 'ocioso' })
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleArquivo(file: File) {
    setEstado({ fase: 'lendo' })
    try {
      const resultado = await onImportar(file)

      if (resultado.status === 'gravado') {
        setAberto(false)
        reiniciar()
        return
      }
      // duplicada-hash / duplicada-conteudo
      setEstado({ fase: 'aviso', mensagem: 'Este documento já foi importado antes.' })
      // Limpa o input SEM resetar `estado` (a mensagem continua visível) — senão
      // o <input type="file"> não dispara onChange numa segunda seleção do MESMO
      // arquivo enquanto o value não for limpo, e o usuário que tenta reenviar o
      // mesmo PDF não vê nada acontecer.
      if (inputRef.current) inputRef.current.value = ''
    } catch (err) {
      // 422 (não reconhecido / sem item aproveitável / sem identidade), 503 (IA
      // indisponível) e 500 chegam aqui como Error — a API já manda a mensagem
      // certa em português no campo `error` (web/lib/api.ts repassa em .message).
      setEstado({ fase: 'erro', mensagem: err instanceof Error ? err.message : 'Erro ao importar o documento.' })
      // Mesmo motivo do branch de aviso acima: limpa o value pra permitir
      // reenviar o mesmo arquivo sem precisar fechar e reabrir o diálogo.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
        Importar Documento
      </Button>

      <Dialog open={aberto} onOpenChange={o => { setAberto(o); if (!o) reiniciar() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar documento de fornecedor</DialogTitle>
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
