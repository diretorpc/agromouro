'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useControleItens } from './hooks/use-controle-itens'
import { GradeItens } from './components/grade-itens'
import { DialogoImportar } from './components/dialogo-importar'

// Tela "Controle" — grade totalmente editável estilo Excel (pedido do
// Matheus, 18/08/2026): "pegar uma tabela de Excel e jogar lá dentro da
// aba". Substitui a tabela agrupada por documento/paginada (PR #61) — ver
// desenho completo: docs/superpowers/specs/2026-08-18-controle-tabela-
// editavel-design.md. `tabela-documentos.tsx`/`use-controle-data.ts`
// (antigos) ficam no repo, sem uso, até decisão explícita de limpar.
export default function ControlePage() {
  const {
    itens, atualizarLocal, totalItens, versaoDados,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading, primeiraCarga, erroCarregamento, erroAcao,
    temMais, carregarMais, carregandoMais,
    editarItem, criarItem, excluirItem, excluirDocumento, abrirPdf, importarDocumento,
  } = useControleItens()

  // Mesmo raciocínio da tela antiga: atualização (troca de filtro) NÃO
  // desmonta a grade — só o primeiro carregamento. Desmontar a grade a cada
  // filtro perderia célula em edição, seleção ativa e o menu de filtro
  // aberto, exatamente o "estilo Excel" que a decisão nº 4 pede.
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
            <span className="sr-only" role="status">
              {atualizando ? 'Atualizando a lista de itens.' : ''}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Extratos e contratos de fornecedor — clique numa célula para editar, Tab/Enter confirma,
            cole do Excel, adicione ou apague linhas. Tudo salva sozinho.
            {totalItens > 0 && ` ${totalItens} ${totalItens === 1 ? 'item' : 'itens'} ao todo.`}
          </p>
        </div>
        <DialogoImportar onImportar={importarDocumento} />
      </div>

      {erroCarregamento && (
        <p className="text-sm text-destructive">{erroCarregamento}</p>
      )}

      {erroAcao && (
        <p aria-live="polite" className="text-sm text-destructive">{erroAcao}</p>
      )}

      {primeiraCarga ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <div className={cn('transition-opacity', atualizando && 'opacity-60')}>
          <GradeItens
            // `key={versaoDados}` REMONTA a grade inteira toda vez que o hook
            // carrega uma página 1 fresca do servidor (troca de filtro,
            // `recarregar()` forçada por erro, ou upload de PDF) — descarta de
            // propósito timer de autosave, patch acumulado e baseline de diff
            // que a grade tivesse em voo, porque nesse momento o servidor É a
            // verdade nova (achado 2 da revisão do Apolo, 18/08/2026). NÃO
            // muda em "carregar mais" (só acrescenta linhas, sem invalidar
            // edição em andamento).
            key={versaoDados}
            itens={itens}
            atualizarLocal={atualizarLocal}
            filtrosDisponiveis={filtrosDisponiveis}
            filtros={filtros}
            onFiltrosChange={aplicarFiltros}
            temMais={temMais}
            carregandoMais={carregandoMais}
            onCarregarMais={carregarMais}
            onAbrirPdf={abrirPdf}
            onEditarItem={editarItem}
            onCriarItem={criarItem}
            onExcluirItem={excluirItem}
            onExcluirDocumento={excluirDocumento}
          />
        </div>
      )}
    </div>
  )
}
