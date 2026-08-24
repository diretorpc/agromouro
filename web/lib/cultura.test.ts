import { describe, it, expect } from 'vitest'
import { normalizarCultura } from './cultura'

describe('normalizarCultura', () => {
  // O caso REAL medido em 24/08/2026: talhão Teimosa gravado com "Cana" enquanto
  // Dida e 3M tinham "cana". Dashboard mostrou duas fatias com o mesmo rótulo e a
  // mesma cor (578,8 ha e 80,5 ha); o KPI de Talhões contou 5 culturas havendo 4.
  it('"Cana" e "cana" viram a MESMA chave', () => {
    expect(normalizarCultura('Cana')).toBe(normalizarCultura('cana'))
    expect(normalizarCultura('Cana')).toBe('cana')
  })

  it('caixa mista e espaço de colagem não criam cultura nova', () => {
    for (const bruto of ['CANA', ' cana ', 'CaNa', '\tcana\n']) {
      expect(normalizarCultura(bruto)).toBe('cana')
    }
  })

  it('preserva acento — "café" não pode virar "cafe"', () => {
    expect(normalizarCultura('Café')).toBe('café')
  })

  it('preserva o resto do nome composto', () => {
    expect(normalizarCultura('Cana-de-açúcar')).toBe('cana-de-açúcar')
  })

  it.each(['', '   ', '\t\n'])('vazio (%j) vira null, nunca string vazia', (bruto) => {
    expect(normalizarCultura(bruto)).toBeNull()
  })

  it('null e undefined atravessam como null', () => {
    expect(normalizarCultura(null)).toBeNull()
    expect(normalizarCultura(undefined)).toBeNull()
  })
})
