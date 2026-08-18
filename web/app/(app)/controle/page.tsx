'use client'

import { useControleData } from './hooks/use-controle-data'
import { TabelaDocumentos } from './components/tabela-documentos'
import { DialogoImportar } from './components/dialogo-importar'

export default function ControlePage() {
  const {
    documentos, pagina, setPagina, totalPaginas,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading, erroCarregamento, importarDocumento, abrirPdf,
  } = useControleData()

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Controle</h1>
          <p className="text-sm text-muted-foreground">
            Extratos e contratos de fornecedor importados manualmente.
          </p>
        </div>
        <DialogoImportar onImportar={importarDocumento} />
      </div>

      {erroCarregamento && (
        <p className="text-sm text-destructive">{erroCarregamento}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <TabelaDocumentos
          documentos={documentos}
          filtrosDisponiveis={filtrosDisponiveis}
          filtros={filtros}
          onFiltrosChange={aplicarFiltros}
          pagina={pagina}
          totalPaginas={totalPaginas}
          onPaginaChange={setPagina}
          onAbrirPdf={abrirPdf}
        />
      )}
    </div>
  )
}
