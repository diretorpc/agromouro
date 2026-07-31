import { describe, it, expect } from 'vitest'
import { contasDaNota, motivoSemBoleto, type DadosParaConta } from './deNotaFiscal'

const base: DadosParaConta = {
  numero:         '4516',
  emitenteNome:   'TRIANGULO DIESEL TRR LTDA',
  dataEmissao:    '2026-07-14T18:15:00-03:00',
  valorTotal:     30600,
  formaPagamento: '15',
  duplicatas:     [{ numero: '001', vencimento: '2026-07-21', valor: 30600 }],
}

describe('motivoSemBoleto', () => {
  it('cartao de credito nao gera boleto', () => {
    expect(motivoSemBoleto('03')).toBe('a nota diz cartão de crédito')
  })
  it('credito loja nao gera boleto', () => {
    expect(motivoSemBoleto('05')).toBe('a nota diz crédito da loja')
  })
  it('dinheiro nao gera boleto', () => {
    expect(motivoSemBoleto('01')).toBe('a nota diz pagamento em dinheiro')
  })
  it('boleto gera', () => {
    expect(motivoSemBoleto('15')).toBeNull()
  })
  it('forma desconhecida gera — na duvida, cria a conta', () => {
    expect(motivoSemBoleto('99')).toBeNull()
  })
  it('sem forma informada gera — ausencia nao e recusa', () => {
    expect(motivoSemBoleto(null)).toBeNull()
  })
})

describe('contasDaNota', () => {
  it('uma duplicata vira uma conta 1 de 1', () => {
    const r = contasDaNota(base)
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBe('2026-07-21')
    expect(r[0].valor).toBe(30600)
    expect(r[0].numero_parcela).toBe(1)
    expect(r[0].total_parcelas).toBe(1)
    expect(r[0].fornecedor).toBe('TRIANGULO DIESEL TRR LTDA')
  })

  it('descricao de parcela unica nao mostra numero de parcela', () => {
    expect(contasDaNota(base)[0].descricao).toBe('TRIANGULO DIESEL TRR LTDA — NF 4516')
  })

  it('tres duplicatas viram tres contas numeradas, cada uma com seu valor', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 10200 },
      { numero: '002', vencimento: '2026-09-15', valor: 10200 },
      { numero: '003', vencimento: '2026-10-15', valor: 10200 },
    ]})
    expect(r).toHaveLength(3)
    expect(r.map(c => c.numero_parcela)).toEqual([1, 2, 3])
    expect(r.every(c => c.total_parcelas === 3)).toBe(true)
    expect(r[1].descricao).toBe('TRIANGULO DIESEL TRR LTDA — NF 4516 (2/3)')
    expect(r.map(c => c.vencimento)).toEqual(['2026-08-15', '2026-09-15', '2026-10-15'])
  })

  it('competencia e o mes do VENCIMENTO, nao o da emissao', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-09-15', valor: 100 },
    ]})
    expect(r[0].competencia).toBe('2026-09-01')
  })

  it('sem duplicata: uma conta sem data, com o valor TOTAL da nota (caso ERCAL)', () => {
    const r = contasDaNota({ ...base, duplicatas: [] })
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBeNull()
    expect(r[0].valor).toBe(30600)
    expect(r[0].numero_parcela).toBe(1)
    expect(r[0].total_parcelas).toBe(1)
  })

  it('sem duplicata: competencia cai no mes da EMISSAO', () => {
    expect(contasDaNota({ ...base, duplicatas: [] })[0].competencia).toBe('2026-07-01')
  })

  it('duplicata sem data tambem vira conta sem data, nao e descartada', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: null, valor: 500 },
    ]})
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBeNull()
    expect(r[0].valor).toBe(500)
    expect(r[0].competencia).toBe('2026-07-01')
  })

  it('parcela com data e sem valor vira conta com data e sem valor', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: null },
    ]})
    expect(r[0].vencimento).toBe('2026-08-15')
    expect(r[0].valor).toBeNull()
  })

  it('cartao de credito nao gera conta nenhuma', () => {
    expect(contasDaNota({ ...base, formaPagamento: '05' })).toEqual([])
  })

  it('soma das parcelas diferente do total da nota gera assim mesmo', () => {
    const r = contasDaNota({ ...base, valorTotal: 30600, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 10000 },
      { numero: '002', vencimento: '2026-09-15', valor: 10000 },
    ]})
    expect(r).toHaveLength(2)
    expect(r.map(c => c.valor)).toEqual([10000, 10000])
  })

  it('data de emissao ja em formato curto tambem funciona', () => {
    const r = contasDaNota({ ...base, dataEmissao: '2026-07-14', duplicatas: [] })
    expect(r[0].competencia).toBe('2026-07-01')
  })
})
