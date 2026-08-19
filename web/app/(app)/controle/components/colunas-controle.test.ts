import { describe, it, expect, vi } from 'vitest'
import { construirColunas } from './colunas-controle'
import type { ItemControleFlat } from '@/lib/types'

// Achado 5 da revisão do Apolo (18/08/2026, 5ª rodada): o teste anterior
// (`deletar-linha.test.ts`, bloco "columns.every(isCellEmpty)") reconstruía
// a lista de colunas EM PARALELO à lista real de `grade-itens.tsx` — provava
// o HELPER (`acoesIsCellEmpty`) isolado, não a FIAÇÃO ("será que a coluna de
// ações da TELA de verdade usa esse helper?"). Prova, por mutação: removida
// a propriedade `isCellEmpty: acoesIsCellEmpty` diretamente da coluna em
// `grade-itens.tsx` (o defeito ORIGINAL do achado 1, sem tocar o helper), a
// suíte inteira (36 testes) continuava verde.
//
// Este arquivo importa `construirColunas` — a MESMA função que
// `grade-itens.tsx` chama pra montar as colunas da tela de verdade (depois
// da extração pra colunas-controle.tsx) — e reproduz o critério REAL que
// `dist/components/DataSheetGrid.js` usa pra decidir se apaga a linha:
// `columns.every(isCellEmpty)`. Uma mutação que remova `isCellEmpty` da
// coluna de ações AQUI (no arquivo de produção) agora derruba este teste —
// verificado manualmente durante o desenvolvimento desta correção.

const ITEM_BASE: ItemControleFlat = {
  id: 'item-1',
  descricao: 'ADUBO NPK',
  quantidade: 10,
  unidade: 'SC',
  valor_unitario: 100,
  valor_total: 1000,
  fornecedor: 'SOLOS',
  numero_documento: '57106',
  ocorrencia_no_documento: 0,
  documento_controle_id: 'doc-1',
  conta_como_compra: false,
  data_manual: '2026-08-18',
  insumo_id: null,
  fazenda_id: 'fazenda-1',
  duplicata_confirmada_em: null,
  duplicata_confirmada_vezes: 0,
  duplicado: false,
  duplicadoMotivo: null,
}

const ITEM_VAZIO: ItemControleFlat = {
  ...ITEM_BASE,
  descricao: '', unidade: '', quantidade: null, valor_unitario: null,
  valor_total: null, data_manual: null, fornecedor: null, numero_documento: null,
}

function todasAsColunasDizemVazia(linha: ItemControleFlat): boolean {
  // `construirColunas` devolve as colunas já com `keyColumn(...)` aplicado
  // — cada `isCellEmpty` (dos campos de dado) já espera o rowData sendo a
  // LINHA INTEIRA (o wrapper de `keyColumn` extrai `rowData[key]` sozinho,
  // confirmado lendo dist/columns/keyColumn.js) — exatamente como
  // `dist/components/DataSheetGrid.js` chama de verdade
  // (`column.isCellEmpty({ rowData, rowIndex })`, `rowData` = a linha).
  const columns = construirColunas(vi.fn(), vi.fn())
  return columns.every(coluna =>
    (coluna.isCellEmpty as (opt: { rowData: ItemControleFlat; rowIndex: number }) => boolean)({
      rowData: linha, rowIndex: 0,
    }),
  )
}

describe('construirColunas — columns.every(isCellEmpty), o critério real que decide se a grade apaga a linha', () => {
  it('linha totalmente limpa: TODAS as colunas da tela de verdade (dado + ações) concordam que está vazia', () => {
    expect(todasAsColunasDizemVazia(ITEM_VAZIO)).toBe(true)
  })

  it('linha com conteúdo: nem todas as colunas concordam — Delete de linha NÃO dispara', () => {
    expect(todasAsColunasDizemVazia(ITEM_BASE)).toBe(false)
  })

  it('a coluna de ações ("Documento") existe e tem isCellEmpty definido', () => {
    const columns = construirColunas(vi.fn(), vi.fn())
    const colunaAcoes = columns.find(c => c.id === 'acoes')
    expect(colunaAcoes).toBeDefined()
    expect(typeof colunaAcoes?.isCellEmpty).toBe('function')
  })
})
