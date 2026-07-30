import { describe, it, expect } from 'vitest'
import { precisaCriarLancamento, montarLancamento } from './pagamento'

describe('precisaCriarLancamento', () => {
  it('conta sem nota fiscal precisa gerar lancamento', () => {
    expect(precisaCriarLancamento({ nota_fiscal_id: null })).toBe(true)
  })
  it('conta vinda de nota fiscal NAO gera lancamento (ja existe desde a NF-e)', () => {
    expect(precisaCriarLancamento({ nota_fiscal_id: 'abc-123' })).toBe(false)
  })
})

describe('montarLancamento', () => {
  const conta = {
    descricao: 'Energia', fornecedor: 'Cemig',
    categoria: 'energia', fazenda_id: 'faz-1',
  }

  it('usa a data e o valor REALMENTE pagos, nao os previstos', () => {
    const l = montarLancamento(conta, '2026-08-11', 912.35)
    expect(l.data).toBe('2026-08-11')
    expect(l.valor).toBe(912.35)
  })

  it('e sempre despesa', () => {
    expect(montarLancamento(conta, '2026-08-11', 100).tipo).toBe('despesa')
  })

  it('descricao junta fornecedor e descricao', () => {
    expect(montarLancamento(conta, '2026-08-11', 100).descricao).toBe('Cemig — Energia')
  })

  it('sem fornecedor usa so a descricao', () => {
    const l = montarLancamento({ ...conta, fornecedor: null }, '2026-08-11', 100)
    expect(l.descricao).toBe('Energia')
  })

  it('carrega a categoria e a fazenda da conta', () => {
    const l = montarLancamento(conta, '2026-08-11', 100)
    expect(l.categoria).toBe('energia')
    expect(l.fazenda_id).toBe('faz-1')
  })
})
