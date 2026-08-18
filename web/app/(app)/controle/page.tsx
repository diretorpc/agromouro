'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useControleData } from './hooks/use-controle-data'
import { TabelaDocumentos } from './components/tabela-documentos'
import { DialogoImportar } from './components/dialogo-importar'

export default function ControlePage() {
  const {
    documentos, paginaAtual, totalPaginas, setPagina,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading, primeiraCarga, erroCarregamento, erroAcao,
    importarDocumento, abrirPdf, excluirDocumento,
  } = useControleData()

  // Atualização (troca de filtro/página) NÃO desmonta a tabela: só o primeiro
  // carregamento, quando ainda não há nada na tela pra manter. Trocar a tabela
  // por um texto a cada filtro destruía o estado interno do menu de filtro junto
  // — fechava o menu no primeiro clique e tornava a seleção múltipla ("SOLOS E
  // status erro") impossível na prática, que é justamente o motivo de o filtro
  // ser combinado. Enquanto atualiza, a tabela só esmaece: sem
  // `pointer-events-none`, porque o clique seguinte no mesmo menu precisa passar.
  const atualizando = loading && !primeiraCarga

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Controle</h1>
            {atualizando && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            )}
            {/* Região viva sempre presente (mesmo vazia): leitor de tela só
                anuncia mudança de conteúdo se o elemento já existia antes. */}
            <span className="sr-only" role="status">
              {atualizando ? 'Atualizando a lista de documentos.' : ''}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Extratos e contratos de fornecedor importados manualmente.
          </p>
        </div>
        <DialogoImportar onImportar={importarDocumento} />
      </div>

      {erroCarregamento && (
        <p className="text-sm text-destructive">{erroCarregamento}</p>
      )}

      {/* Erro de ação (abrir PDF) no MESMO lugar e estilo do erro de
          carregamento — antes o abrirPdf rejeitava sem ninguém tratar: a aba
          abria em branco, fechava, e nada era dito. */}
      {erroAcao && (
        <p className="text-sm text-destructive">{erroAcao}</p>
      )}

      {primeiraCarga ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <div className={cn('transition-opacity', atualizando && 'opacity-60')}>
          <TabelaDocumentos
            documentos={documentos}
            filtrosDisponiveis={filtrosDisponiveis}
            filtros={filtros}
            onFiltrosChange={aplicarFiltros}
            paginaAtual={paginaAtual}
            totalPaginas={totalPaginas}
            onPaginaChange={setPagina}
            onAbrirPdf={abrirPdf}
            onExcluirDocumento={excluirDocumento}
            comErro={erroCarregamento !== null}
          />
        </div>
      )}
    </div>
  )
}
