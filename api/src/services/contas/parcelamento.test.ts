import { describe, it, expect } from 'vitest'
import { montarParcelas } from './parcelamento'

describe('montarParcelas', () => {
  const base = {
    descricao: 'Trator John Deere',
    fornecedor: 'Agrishow Máquinas',
    categoria: 'peca_maquina',
    vencimento: '2026-09-10',
    valor: 4000,
    parcelas: 4,
  }

  it('cria uma linha por parcela, com o MESMO valor em todas (não divide)', () => {
    const linhas = montarParcelas(base)
    expect(linhas).toHaveLength(4)
    linhas.forEach(l => expect(l.valor).toBe(4000))
  })

  it('numera a descrição (i/total), preservando o texto original', () => {
    const linhas = montarParcelas(base)
    expect(linhas.map(l => l.descricao)).toEqual([
      'Trator John Deere (1/4)',
      'Trator John Deere (2/4)',
      'Trator John Deere (3/4)',
      'Trator John Deere (4/4)',
    ])
  })

  it('cada parcela vence um mês depois da anterior, no mesmo dia', () => {
    const linhas = montarParcelas(base)
    expect(linhas.map(l => l.vencimento)).toEqual([
      '2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10',
    ])
  })

  it('competência acompanha o mês do vencimento de CADA parcela', () => {
    const linhas = montarParcelas(base)
    expect(linhas.map(l => l.competencia)).toEqual([
      '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01',
    ])
  })

  it('dia que não existe no mês seguinte cai no último dia daquele mês', () => {
    const linhas = montarParcelas({ ...base, vencimento: '2026-01-31', parcelas: 2 })
    expect(linhas.map(l => l.vencimento)).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('atravessa a virada do ano corretamente', () => {
    const linhas = montarParcelas({ ...base, vencimento: '2026-11-15', parcelas: 3 })
    expect(linhas.map(l => l.vencimento)).toEqual([
      '2026-11-15', '2026-12-15', '2027-01-15',
    ])
  })

  it('preserva fornecedor e categoria nulos', () => {
    const linhas = montarParcelas({ ...base, fornecedor: null, categoria: null })
    linhas.forEach(l => {
      expect(l.fornecedor).toBeNull()
      expect(l.categoria).toBeNull()
    })
  })

  it('nasce sempre com status "aberta" e valor_estimado false — é valor digitado, não chute', () => {
    const linhas = montarParcelas(base)
    linhas.forEach(l => {
      expect(l.status).toBe('aberta')
      expect(l.valor_estimado).toBe(false)
    })
  })
})
