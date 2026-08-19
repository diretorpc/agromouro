import { describe, it, expect } from 'vitest'
import { parseNumeroBR, parseDataBR, colunaTextoSemNulo } from './colunas-br'

// Achado 6 da revisão do Apolo (18/08/2026, 3ª rodada): "web/" tinha ZERO
// arquivo de teste, e dois bugs de DINHEIRO já passaram batido exatamente
// por causa disso — os dois medidos ao vivo, os dois cobertos abaixo.

describe('parseNumeroBR', () => {
  // Casos MEDIDOS pelo Apolo, ao vivo, no achado 1 (18/08/2026): o
  // `floatColumn` da biblioteca lia com `parseFloat` cru — R$ 1.234,56
  // virava R$ 1,23, com 200 OK e sem erro nenhum.
  it('lê os 4 casos exatos que o Apolo mediu como quebrados', () => {
    expect(parseNumeroBR('1.234,56')).toBe(1234.56)
    expect(parseNumeroBR('1234,56')).toBe(1234.56)
    expect(parseNumeroBR('0,5')).toBe(0.5)
    expect(parseNumeroBR('R$ 1.234,56')).toBe(1234.56)
  })

  it('remove NBSP (espaço sem quebra de linha, artefato de copiar do Excel)', () => {
    const comNbsp = 'R$' + String.fromCharCode(0xa0) + '1.234,56'
    expect(parseNumeroBR(comNbsp)).toBe(1234.56)
  })

  it('mantém ponto como decimal quando não há vírgula e não é padrão de milhar (ex.: "44.2")', () => {
    expect(parseNumeroBR('44.2')).toBe(44.2)
  })

  it('trata ponto como separador de milhar só no padrão exato de agrupamento (3 em 3 dígitos)', () => {
    expect(parseNumeroBR('1.234')).toBe(1234)
    expect(parseNumeroBR('12.345.678')).toBe(12345678)
  })

  it('inteiro sem separador nenhum', () => {
    expect(parseNumeroBR('1234')).toBe(1234)
  })

  it('vazio, null e lixo viram null — nunca um número inventado', () => {
    expect(parseNumeroBR('')).toBeNull()
    expect(parseNumeroBR('   ')).toBeNull()
    expect(parseNumeroBR(null as unknown as string)).toBeNull()
    expect(parseNumeroBR('abc')).toBeNull()
  })
})

describe('parseDataBR', () => {
  // Casos MEDIDOS pelo Apolo, ao vivo, no achado 4 (18/08/2026):
  // `isoDateColumn.pasteValue` da biblioteca trocava "/" por "-" e jogava
  // no `new Date(...)` — heurística ambígua do motor JS.
  it('lê os 2 casos exatos que o Apolo mediu como quebrados', () => {
    expect(parseDataBR('18/08/2026')).toBe('2026-08-18') // antes: sumia (null)
    expect(parseDataBR('01/12/2025')).toBe('2025-12-01') // antes: virava 12 de janeiro
  })

  it('aceita ISO direto (colar de outra célula desta mesma grade)', () => {
    expect(parseDataBR('2026-08-18')).toBe('2026-08-18')
  })

  it('aceita dia/mês de 1 dígito, preenchendo com zero à esquerda', () => {
    expect(parseDataBR('1/2/2026')).toBe('2026-02-01')
  })

  it('data que não existe (31 de fevereiro) vira null — não "rola" pro mês seguinte calado', () => {
    expect(parseDataBR('31/02/2026')).toBeNull()
    expect(parseDataBR('2026-02-31')).toBeNull()
  })

  it('vazio e lixo viram null', () => {
    expect(parseDataBR('')).toBeNull()
    expect(parseDataBR('lixo')).toBeNull()
  })
})

describe('colunaTextoSemNulo', () => {
  const coluna = colunaTextoSemNulo() as {
    deleteValue: (opt: { rowData: string; rowIndex: number }) => string
    isCellEmpty: (opt: { rowData: string | null; rowIndex: number }) => boolean
    columnData: { parseUserInput: (v: string) => string; parsePastedValue: (v: string) => string } | undefined
    pasteValue: (opt: { value: string; rowData: string; rowIndex: number }) => string
  }

  // Bug relatado pelo Matheus, 18/08/2026: apertar Delete numa célula de
  // Produto "recarregava a página e o produto voltava" — a causa raiz era
  // o `null` que o `createTextColumn` padrão devolve nesses 3 caminhos.
  // `colunaTextoSemNulo` existe pra NUNCA devolver `null` em nenhum deles.
  it('deleteValue (tecla Delete numa célula selecionada) devolve string vazia, nunca null', () => {
    expect(coluna.deleteValue({ rowData: 'ADUBO', rowIndex: 0 })).toBe('')
  })

  it('parseUserInput (digitar e apagar tudo) devolve string vazia, nunca null', () => {
    expect(coluna.columnData?.parseUserInput('')).toBe('')
    expect(coluna.columnData?.parseUserInput('   ')).toBe('')
  })

  it('parseUserInput mantém o texto digitado (só remove espaço nas pontas)', () => {
    expect(coluna.columnData?.parseUserInput('  ADUBO NPK  ')).toBe('ADUBO NPK')
  })

  it('parsePastedValue (colar célula vazia) devolve string vazia, nunca null', () => {
    expect(coluna.pasteValue({ value: '', rowData: 'ADUBO', rowIndex: 0 })).toBe('')
  })

  // Achado 5 da revisão do Apolo (18/08/2026, 3ª rodada): o padrão da
  // biblioteca só reconhece `null`/`undefined` como vazio — '' nunca
  // batia. Esta coluna sozinha reconhecer '' como vazia é NECESSÁRIO pro
  // Delete de linha inteira, mas NÃO É SUFICIENTE sozinho — falta ainda a
  // coluna de ações (achado 1 da revisão seguinte, 4ª rodada, coberto em
  // deletar-linha.test.ts) e o roteamento no `onChange` que evita o PATCH
  // condenado. Nome do teste deliberadamente restrito ao que ele PROVA
  // (achado 4 da revisão, 4ª rodada — corrigido: o parêntese anterior
  // prometia mais do que a asserção provava).
  it('isCellEmpty reconhece string vazia como vazia', () => {
    expect(coluna.isCellEmpty({ rowData: '', rowIndex: 0 })).toBe(true)
    expect(coluna.isCellEmpty({ rowData: 'ADUBO', rowIndex: 0 })).toBe(false)
  })
})
