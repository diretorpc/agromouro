import { describe, it, expect } from 'vitest'
import { acoesIsCellEmpty, linhaIndoParaOLixo, podeSerDeleteDeLinha, selecaoCobreLinhaInteira } from './deletar-linha'
import type { ItemControleFlat } from '@/lib/types'

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

describe('acoesIsCellEmpty', () => {
  it('é sempre true — a coluna de ações (abrir PDF/excluir documento) nunca guarda dado de item', () => {
    expect(acoesIsCellEmpty()).toBe(true)
  })
})

describe('linhaIndoParaOLixo', () => {
  it('detecta a linha totalmente limpa (todos os campos editáveis no valor de "vazio")', () => {
    const vazia: ItemControleFlat = {
      ...ITEM_BASE,
      descricao: '', unidade: '', quantidade: null, valor_unitario: null,
      valor_total: null, data_manual: null, fornecedor: null, numero_documento: null,
    }
    expect(linhaIndoParaOLixo(vazia)).toBe(true)
  })

  it('linha com CONTEÚDO não é confundida com "indo pro lixo"', () => {
    expect(linhaIndoParaOLixo(ITEM_BASE)).toBe(false)
  })

  it('apagar SÓ o valor_total (resto da linha com conteúdo) NÃO conta como "indo pro lixo"', () => {
    const soValorLimpo: ItemControleFlat = { ...ITEM_BASE, valor_total: null }
    expect(linhaIndoParaOLixo(soValorLimpo)).toBe(false)
  })

  it('apagar SÓ a descrição (resto da linha com conteúdo) NÃO conta como "indo pro lixo"', () => {
    const soDescricaoLimpa: ItemControleFlat = { ...ITEM_BASE, descricao: '' }
    expect(linhaIndoParaOLixo(soDescricaoLimpa)).toBe(false)
  })
})

// O teste que ANTES vivia aqui ("columns.every(isCellEmpty) — o critério
// real...") reconstruía a lista de colunas EM PARALELO à lista real do
// componente — provava o HELPER (`acoesIsCellEmpty`) isolado, não a
// FIAÇÃO. Achado 5 da revisão do Apolo (18/08/2026, 5ª rodada), provado por
// mutação: removida a propriedade `isCellEmpty: acoesIsCellEmpty` da
// coluna de ações DIRETO em `grade-itens.tsx` (o defeito ORIGINAL do
// achado 1, sem tocar o helper), a suíte inteira continuava 36/36 verde.
// O teste que prova a fiação de verdade agora mora em
// `colunas-controle.test.ts`, em cima de `construirColunas` — a MESMA
// função que `grade-itens.tsx` chama pra montar a tela.

// Achados 1-3 da revisão do Apolo (18/08/2026, 5ª rodada): CRÍTICO — a 1ª
// versão de "Delete apaga a linha" só olhava o RESULTADO (linhaIndoParaOLixo),
// sem saber COMO a linha chegou lá. Isso também disparava em Ctrl+A (todas
// as linhas carregadas apagadas numa tecla), colar bloco vazio do Excel,
// Ctrl+X, e Delete numa faixa parcial de célula de linha "magra".
describe('selecaoCobreLinhaInteira', () => {
  it('seleção cobrindo as 8 colunas de dado (índices 0 a 7): cobre a linha inteira', () => {
    expect(selecaoCobreLinhaInteira({ min: { col: 0 }, max: { col: 7 } })).toBe(true)
  })

  it('seleção além de 7 (ex.: incluindo a coluna de ações): ainda cobre — min continua em 0', () => {
    expect(selecaoCobreLinhaInteira({ min: { col: 0 }, max: { col: 8 } })).toBe(true)
  })

  // Achado 3: Delete numa faixa PARCIAL (ex.: Produto..V.Total, colunas
  // 3-7) de uma linha avulsa "magra" (só Produto+V.Total preenchidos, o
  // mínimo que `possivelmenteCriar` exige) não pode apagar a linha — item
  // avulso não tem PDF pra reimportar, seria irrecuperável.
  it('faixa PARCIAL (não começa na coluna 0): NÃO cobre a linha inteira', () => {
    expect(selecaoCobreLinhaInteira({ min: { col: 3 }, max: { col: 7 } })).toBe(false)
  })

  it('sem seleção nenhuma (null): NÃO cobre a linha inteira', () => {
    expect(selecaoCobreLinhaInteira(null)).toBe(false)
  })
})

describe('podeSerDeleteDeLinha', () => {
  const SELECAO_LINHA_INTEIRA = { min: { col: 0 }, max: { col: 7 } }

  it('as 3 condições juntas (tecla + 1 linha + seleção inteira): true', () => {
    expect(podeSerDeleteDeLinha({
      foiTeclaDelete: true, quantasLinhasNaOperacao: 1, selecao: SELECAO_LINHA_INTEIRA,
    })).toBe(true)
  })

  // Achado 1 [CRÍTICO]: Ctrl+A + Delete produz UMA operação cobrindo TODAS
  // as linhas carregadas (até 500) — `quantasLinhasNaOperacao` bem maior
  // que 1.
  it('Ctrl+A (mais de 1 linha na operação): false, mesmo com tecla e seleção certas', () => {
    expect(podeSerDeleteDeLinha({
      foiTeclaDelete: true, quantasLinhasNaOperacao: 500, selecao: SELECAO_LINHA_INTEIRA,
    })).toBe(false)
  })

  // Achado 2: colar um bloco vazio do Excel, ou Ctrl+X — nenhum dos dois
  // passa pelo keydown de Delete/Backspace que arma `foiTeclaDelete`.
  it('não veio da tecla Delete/Backspace (paste ou Ctrl+X): false', () => {
    expect(podeSerDeleteDeLinha({
      foiTeclaDelete: false, quantasLinhasNaOperacao: 1, selecao: SELECAO_LINHA_INTEIRA,
    })).toBe(false)
  })

  // Achado 3: faixa parcial de seleção.
  it('seleção não cobre a linha inteira (faixa parcial): false', () => {
    expect(podeSerDeleteDeLinha({
      foiTeclaDelete: true, quantasLinhasNaOperacao: 1, selecao: { min: { col: 3 }, max: { col: 7 } },
    })).toBe(false)
  })
})
