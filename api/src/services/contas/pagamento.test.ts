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

describe('precisaCriarLancamento — conta vinda de contrato', () => {
  // O gasto do contrato JÁ entrou no Financeiro na data do contrato, via
  // itens_nfe (conta_como_compra = true). Criar lançamento ao marcar a conta
  // como paga somaria os mesmos R$ 647.986,35 uma segunda vez.
  it('conta de contrato NÃO cria lançamento', () => {
    expect(precisaCriarLancamento({
      nota_fiscal_id: null,
      documento_controle_id: 'doc-1',
    })).toBe(false)
  })

  it('conta avulsa (os dois vínculos nulos) CONTINUA criando lançamento', () => {
    expect(precisaCriarLancamento({
      nota_fiscal_id: null,
      documento_controle_id: null,
    })).toBe(true)
  })

  it('conta de NF-e continua sem criar lançamento', () => {
    expect(precisaCriarLancamento({
      nota_fiscal_id: 'nota-1',
      documento_controle_id: null,
    })).toBe(false)
  })

  // Conta antiga, gravada antes da migration 012: o Supabase devolve
  // undefined para coluna ausente no select, e `undefined === null` é false
  // — sem o tratamento, TODA conta avulsa antiga pararia de lançar.
  it('coluna ausente (conta antiga) se comporta como nula', () => {
    expect(precisaCriarLancamento({
      nota_fiscal_id: null,
      documento_controle_id: undefined as unknown as null,
    })).toBe(true)
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

  // A tela Financeiro carrega os lancamentos filtrando por origem
  // (.in('origem', [...])) e o IN do SQL nunca casa com nulo. Origem vazia aqui
  // = gasto invisivel no Financeiro e presente no Dashboard, no mesmo mes.
  it('carimba origem "conta" — e por esse campo que o Financeiro filtra', () => {
    expect(montarLancamento(conta, '2026-08-11', 100).origem).toBe('conta')
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
