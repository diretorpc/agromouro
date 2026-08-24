import { describe, it, expect } from 'vitest'
import { parseNumeroBR } from './numeros-br'

// Testes mudaram de endereco junto com a funcao em 24/08/2026 (achado 4 da
// 3a revisao do Apolo): eles moravam em
// `app/(app)/controle/components/colunas-br.test.ts` e chegavam na funcao
// atravessando um reexport. Modulo compartilhado sem teste no proprio
// endereco e a mesma lacuna que deixou passar o bug de "sem conexao".
//
// Casos MEDIDOS ao vivo (achado 1 de 18/08/2026): o `floatColumn` da
// biblioteca lia com `parseFloat` cru — R$ 1.234,56 virava R$ 1,23.

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
