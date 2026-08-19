import { FileText, Trash2, AlertTriangle } from 'lucide-react'
import { keyColumn, createTextColumn, type CellComponent, type Column } from 'react-datasheet-grid'
import { colunaNumeroBR, colunaDataBR, colunaTextoSemNulo } from './colunas-br'
import { acoesIsCellEmpty } from './deletar-linha'
import type { ItemControleFlat } from '@/lib/types'

// Extraído de `grade-itens.tsx` (achado 5 da revisão do Apolo, 18/08/2026,
// 5ª rodada): o teste anterior (`deletar-linha.test.ts`) reconstruía a
// lista de colunas EM PARALELO à lista real do componente — provava o
// HELPER (`acoesIsCellEmpty`) isolado, não a FIAÇÃO (será que a coluna de
// ações da TELA de verdade usa esse helper?). Prova: removida a
// propriedade `isCellEmpty: acoesIsCellEmpty` diretamente da coluna em
// `grade-itens.tsx` (o defeito ORIGINAL do achado 1, sem tocar o helper),
// os 36 testes da suíte inteira continuavam verdes.
//
// Este arquivo NÃO importa a folha de estilo (`react-datasheet-grid/dist/
// style.css`) nem o módulo CSS da grade (`grade-itens.module.css`) — só
// monta a ESTRUTURA das colunas. `grade-itens.tsx` chama
// `construirColunas(...)` pra montar a MESMA lista usada na tela de
// verdade; `colunas-controle.test.ts` importa esta MESMA função (não uma
// cópia) e roda `columns.every(isCellEmpty)` em cima do resultado — muda a
// fiação aqui, o teste sente. Confirmado por mutação: remover
// `isCellEmpty: acoesIsCellEmpty` da coluna abaixo derruba o teste
// dedicado (ver `colunas-controle.test.ts`).

// Célula de ação "Documento" — não editável. Duas ações quando a linha veio
// de um PDF importado (documento_controle_id not null): abrir o PDF de
// origem, e excluir o DOCUMENTO inteiro. Linha avulsa (sem documento) não
// mostra nenhum dos dois. Ícone de aviso (âmbar) some/aparece conforme
// `rowData.duplicado` — tooltip nativo do navegador (`title`) explica o
// motivo.
function celulaAcoes(
  onAbrirPdf: (documentoId: string) => void,
  onPedirExclusao: (documentoId: string, item: ItemControleFlat) => void,
): CellComponent<ItemControleFlat, unknown> {
  return function CelulaAcoes({ rowData }) {
    const docId = rowData.documento_controle_id
    return (
      <div className="flex h-full w-full items-center justify-center gap-1.5">
        {rowData.duplicado && (
          <span
            title={
              rowData.duplicadoMotivo === 'reimportacao'
                ? `Linha confirmada de novo numa reimportação${rowData.duplicata_confirmada_vezes > 0 ? ` (${rowData.duplicata_confirmada_vezes}x)` : ''}.`
                : 'Existe outra linha muito parecida (mesmo fornecedor, número e valor) nesta grade.'
            }
            className="text-amber-600"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
        {docId && (
          <>
            <button
              type="button"
              onClick={() => onAbrirPdf(docId)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Abrir PDF de origem"
              title="Abrir PDF de origem"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onPedirExclusao(docId, rowData)}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Excluir documento de origem"
              title="Excluir documento de origem"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    )
  }
}

// Tipo explícito no array inteiro (em vez de deixar o TypeScript inferir
// cada `keyColumn(...)` isoladamente): sem isso, o compilador não liga os
// pontos entre a chave string ('data_manual', 'fornecedor'...) e o tipo
// `ItemControleFlat` — cada chamada isolada infere um `T` genérico demais
// e a coluna de ações (que usa `ItemControleFlat` explicitamente no seu
// `CellComponent`) para de bater com o resto do array.
export function construirColunas(
  onAbrirPdf: (documentoId: string) => void,
  onPedirExclusao: (documentoId: string, item: ItemControleFlat) => void,
): Partial<Column<ItemControleFlat, any, any>>[] {
  return [
    {
      ...keyColumn<ItemControleFlat, 'data_manual'>('data_manual', colunaDataBR()),
      title: 'Data',
      minWidth: 110,
    },
    {
      ...keyColumn<ItemControleFlat, 'fornecedor'>('fornecedor', createTextColumn({ continuousUpdates: false })),
      title: 'Fornecedor',
      minWidth: 160,
    },
    {
      ...keyColumn<ItemControleFlat, 'numero_documento'>('numero_documento', createTextColumn({ continuousUpdates: false })),
      title: 'NF',
      minWidth: 90,
    },
    {
      ...keyColumn<ItemControleFlat, 'descricao'>('descricao', colunaTextoSemNulo()),
      title: 'Produto',
      minWidth: 220,
      grow: 2,
    },
    {
      ...keyColumn<ItemControleFlat, 'quantidade'>('quantidade', colunaNumeroBR()),
      title: 'Quant.',
      minWidth: 90,
    },
    {
      ...keyColumn<ItemControleFlat, 'unidade'>('unidade', colunaTextoSemNulo()),
      title: 'Unidade',
      minWidth: 80,
    },
    {
      ...keyColumn<ItemControleFlat, 'valor_unitario'>('valor_unitario', colunaNumeroBR()),
      title: 'V.Unit.',
      minWidth: 100,
    },
    {
      ...keyColumn<ItemControleFlat, 'valor_total'>('valor_total', colunaNumeroBR()),
      title: 'V.Total',
      minWidth: 100,
    },
    {
      id: 'acoes',
      title: 'Documento',
      minWidth: 78,
      maxWidth: 78,
      disabled: true,
      component: celulaAcoes(onAbrirPdf, onPedirExclusao),
      // Achado 1 da revisão do Apolo (18/08/2026, 4ª rodada): sem isto, o
      // Delete de linha inteira nunca disparava — ver deletar-linha.ts,
      // `acoesIsCellEmpty`, para o porquê completo. Achado 5 (5ª rodada):
      // este é o ponto exato que precisa ficar sob teste de fiação, não só
      // o helper isolado.
      isCellEmpty: acoesIsCellEmpty,
    },
  ]
}
