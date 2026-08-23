import { describe, it, expect } from 'vitest'
import { contasDoContrato } from './deContrato'
import type { DocumentoLido } from '../controle/documentoPdf'

// Contrato Mosaic real (280451) — o mesmo que originou esta feature.
function contrato(over: Partial<DocumentoLido> = {}): DocumentoLido {
  return {
    fornecedor: 'Mosaic Fertilizantes do Brasil Ltda.',
    dataDocumento: '2026-07-03',
    numeroDocumento: '280451-2026-07-03',
    codigoCliente: '280451',
    valorTotalDocumento: 647986.35,
    divergenciaTotal: 0,
    tipoDocumento: 'contrato',
    pagamentos: [{ data: '2026-08-28', valor: 647986.35 }],
    itens: [{
      descricao: 'MS15F 09 23 18 S15',
      quantidade: 165,
      unidade: 'MTN',
      valorUnitario: 3927.19,
      valorTotal: 647986.35,
      numeroDocumento: '280451',
      data: '2026-07-03',
    }],
    itensDescartados: 0,
    ...over,
  }
}

describe('contasDoContrato', () => {
  it('uma conta por pagamento, com vencimento e valor do Quadro Resumo', () => {
    const contas = contasDoContrato(contrato(), 'doc-1')
    expect(contas).toHaveLength(1)
    expect(contas[0]).toEqual({
      descricao: 'Contrato 280451 — MS15F 09 23 18 S15',
      fornecedor: 'Mosaic Fertilizantes do Brasil Ltda.',
      categoria: 'fertilizante_outro',
      vencimento: '2026-08-28',
      valor: 647986.35,
      valor_estimado: false,
      status: 'aberta',
      competencia: '2026-08-01',
      documento_controle_id: 'doc-1',
    })
  })

  it('extrato não gera conta nenhuma', () => {
    const contas = contasDoContrato(contrato({ tipoDocumento: 'extrato', pagamentos: [] }), 'doc-1')
    expect(contas).toEqual([])
  })

  it('contrato sem pagamento não gera conta', () => {
    expect(contasDoContrato(contrato({ pagamentos: [] }), 'doc-1')).toEqual([])
  })

  it('1 pagamento sem valor herda o total do documento', () => {
    const contas = contasDoContrato(contrato({ pagamentos: [{ data: '2026-08-28', valor: null }] }), 'doc-1')
    expect(contas[0].valor).toBe(647986.35)
    expect(contas[0].valor_estimado).toBe(false)
  })

  it('N pagamentos com valor próprio usam cada um o seu', () => {
    const contas = contasDoContrato(contrato({
      pagamentos: [
        { data: '2026-08-28', valor: 300000 },
        { data: '2026-09-28', valor: 347986.35 },
      ],
    }), 'doc-1')
    expect(contas.map(c => c.valor)).toEqual([300000, 347986.35])
    expect(contas.every(c => c.valor_estimado === false)).toBe(true)
  })

  // O BUG QUE ESTE TESTE EXISTE PRA IMPEDIR: herdar o total em cada parcela
  // transformaria um contrato de R$ 647.986,35 numa dívida de R$ 1,29 mi.
  it('2 pagamentos sem valor RATEIAM o total — não herdam cada um', () => {
    const contas = contasDoContrato(contrato({
      pagamentos: [
        { data: '2026-08-28', valor: null },
        { data: '2026-09-28', valor: null },
      ],
    }), 'doc-1')
    expect(contas.map(c => c.valor)).toEqual([323993.17, 323993.18])
    expect(contas.reduce((s, c) => s + (c.valor ?? 0), 0)).toBe(647986.35)
    expect(contas.every(c => c.valor_estimado === true)).toBe(true)
  })

  it('rateio com sobra de centavo joga a diferença na ÚLTIMA parcela', () => {
    const contas = contasDoContrato(contrato({
      valorTotalDocumento: 100,
      pagamentos: [
        { data: '2026-08-28', valor: null },
        { data: '2026-09-28', valor: null },
        { data: '2026-10-28', valor: null },
      ],
    }), 'doc-1')
    expect(contas.map(c => c.valor)).toEqual([33.33, 33.33, 33.34])
    expect(contas.reduce((s, c) => s + (c.valor ?? 0), 0)).toBe(100)
  })

  it('sem valor e sem total: conta nasce sem valor, marcada como estimada', () => {
    const contas = contasDoContrato(contrato({
      valorTotalDocumento: null,
      pagamentos: [{ data: '2026-08-28', valor: null }],
    }), 'doc-1')
    expect(contas[0].valor).toBeNull()
    expect(contas[0].valor_estimado).toBe(true)
  })

  it('descrição cai no número do documento quando não há item legível', () => {
    const contas = contasDoContrato(contrato({ itens: [] }), 'doc-1')
    expect(contas[0].descricao).toBe('Contrato 280451')
  })

  it('sem codigoCliente, a descrição usa o fornecedor', () => {
    const contas = contasDoContrato(contrato({ codigoCliente: null }), 'doc-1')
    expect(contas[0].descricao).toBe('Contrato Mosaic Fertilizantes do Brasil Ltda. — MS15F 09 23 18 S15')
  })
})
