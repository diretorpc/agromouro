'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useControleItens } from './hooks/use-controle-itens'
import { useControleGraficos } from './hooks/use-controle-graficos'
import { GradeItens } from './components/grade-itens'
import { GraficosControle } from './components/graficos-controle'
import { DialogoImportar } from './components/dialogo-importar'

// Tela "Controle" — grade totalmente editável estilo Excel (pedido do
// Matheus, 18/08/2026): "pegar uma tabela de Excel e jogar lá dentro da
// aba". Substitui a tabela agrupada por documento/paginada (PR #61) — ver
// desenho completo: docs/superpowers/specs/2026-08-18-controle-tabela-
// editavel-design.md. `tabela-documentos.tsx`/`use-controle-data.ts`
// (antigos) ficam no repo, sem uso, até decisão explícita de limpar.
export default function ControlePage() {
  const {
    itens, atualizarLocal, totalItens, versaoDados, versaoNumeros,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading, primeiraCarga, erroCarregamento, erroAcao,
    temMais, carregarMais, carregandoMais,
    editarItem, criarItem, excluirItem, excluirDocumento, abrirPdf, importarDocumento,
    substituirItem,
    exclusoesPendentes, desfazerExclusao,
  } = useControleItens()

  // Os gráficos leem os MESMOS filtros da grade — o hook recebe o objeto,
  // não guarda cópia. Sem isso, gráfico e tabela na mesma tela poderiam
  // mostrar números diferentes e ninguém saberia qual está certo.
  //
  // ⚠️ O segundo argumento é `versaoNumeros`, NÃO `versaoDados`: aquele
  // remonta a grade (`key={versaoDados}` abaixo) e não sobe em edição de
  // célula; este sobe só em mutação confirmada pelo servidor e não remonta
  // nada. Ver o comentário na declaração dos dois, em use-controle-itens.ts.
  const {
    dados: dadosGraficos, loading: carregandoGraficos, erro: erroGraficos,
    desatualizado: graficosDesatualizados,
  } = useControleGraficos(filtros, versaoNumeros)

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

      {/* Gráficos ACIMA da grade e recolhíveis (decisão nº 5 do desenho): a
          grade continua sendo o centro da tela; gráfico é apoio, não
          protagonista. O estado aberto/fechado fica no localStorage. */}
      <GraficosControle
        dados={dadosGraficos}
        loading={carregandoGraficos}
        erro={erroGraficos}
        desatualizado={graficosDesatualizados}
      />

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
            onReverterItem={substituirItem}
          />
        </div>
      )}

      {/* Rede de "Desfazer" pra exclusão de item (achado 4 da revisão do
          Apolo, 18/08/2026, 5ª rodada) — Delete de linha inteira virou 1
          tecla só e a biblioteca não tem undo nenhum. A fila aguenta
          quantas exclusões o Matheus fizer em sequência: cada uma tem seu
          próprio temporizador (`use-controle-itens.ts`), cada uma vira uma
          faixa própria aqui, empilhadas. */}
      {exclusoesPendentes.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
          {exclusoesPendentes.map(pendente => (
            <div
              key={pendente.id}
              className="flex items-center gap-3 rounded-md border bg-foreground px-4 py-2 text-sm text-background shadow-lg"
            >
              <span>
                Linha apagada{pendente.item.descricao ? ` — "${pendente.item.descricao}"` : ''}
              </span>
              <button
                type="button"
                onClick={() => desfazerExclusao(pendente.id)}
                className="font-medium underline underline-offset-2 hover:no-underline"
              >
                Desfazer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
