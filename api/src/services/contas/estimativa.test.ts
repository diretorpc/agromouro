import { describe, it, expect } from 'vitest'
import { estimativaDaOcorrencia } from './estimativa'

describe('estimativaDaOcorrencia', () => {
  it('a segunda ocorrencia herda o ultimo valor PAGO, nao o do cadastro', () => {
    expect(estimativaDaOcorrencia(912.35, 800)).toBe(912.35)
  })

  it('sem pagamento anterior, usa o valor de referencia do cadastro', () => {
    expect(estimativaDaOcorrencia(null, 800)).toBe(800)
  })

  it('sem pagamento e sem referencia, fica sem valor', () => {
    expect(estimativaDaOcorrencia(null, null)).toBeNull()
  })

  it('valor pago zero e um valor valido, nao e ausencia', () => {
    expect(estimativaDaOcorrencia(0, 800)).toBe(0)
  })
})
