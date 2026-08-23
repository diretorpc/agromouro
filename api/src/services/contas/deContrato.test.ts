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
    pagamentosDescartados: 0,
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

  // ⚠️ MUDANÇA DE COMPORTAMENTO — Critical 2 da revisão final (23/08/2026).
  // Até aqui, contrato sem data de pagamento legível não gerava conta e a
  // tela mandava "cadastre a conta à mão". Esse conselho ERA O FURO: conta
  // avulsa nasce sem `documento_controle_id`, então pagá-la CRIA lançamento
  // financeiro — e o gasto do contrato já está em `itens_nfe`. R$ 1,29 mi
  // para uma compra de R$ 648 mil. A coluna `vencimento` é NULLABLE desde a
  // migration 006 (caso ERCAL), a tela de Contas a Pagar já tem filtro de
  // "sem vencimento" e o resumo do WhatsApp já tem o balde `semVencimento` —
  // criar a conta sem data usa estrada que já existe, e o caminho manual
  // (o perigoso) deixa de ser necessário.
  it('contrato sem pagamento legível cria a conta SEM vencimento, vinculada ao documento', () => {
    const contas = contasDoContrato(contrato({ pagamentos: [] }), 'doc-1')
    expect(contas).toHaveLength(1)
    expect(contas[0].vencimento).toBeNull()
    expect(contas[0].documento_controle_id).toBe('doc-1')
    expect(contas[0].valor_estimado).toBe(true)
    expect(contas[0].status).toBe('aberta')
    // Sem vencimento, a competência é o mês do CONTRATO — a mesma data em
    // que o gasto entra no Financeiro (`data_manual` do item).
    expect(contas[0].competencia).toBe('2026-07-01')
  })

  it('conta sem vencimento ainda leva o valor total do contrato', () => {
    const contas = contasDoContrato(contrato({ pagamentos: [] }), 'doc-1')
    expect(contas[0].valor).toBe(647986.35)
  })

  // Sem data de pagamento E sem data de contrato não há competência
  // possível (coluna DATE NOT NULL) — não inventa "hoje". Inalcançável na
  // prática: sem `dataDocumento` o documento nem chega a ser gravado
  // (`sem-identidade` em gravarDocumentoPdf.ts).
  it('sem pagamento E sem data do documento: não cria conta nenhuma', () => {
    expect(contasDoContrato(contrato({ pagamentos: [], dataDocumento: null }), 'doc-1')).toEqual([])
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

  // Important 1 da revisão final (23/08/2026). O par de bugs: a leitura
  // descartava em silêncio uma parcela com data ilegível, e a regra "1
  // pagamento herda o total" fazia a sobrevivente carregar o contrato
  // inteiro — R$ 647.986,35 de dívida marcada como valor CONFIRMADO, quando
  // a verdade eram duas parcelas de R$ 323 mil e uma delas se perdeu.
  describe('com parcela descartada na leitura, o total do documento vira intocável', () => {
    it('1 pagamento sobrevivente NÃO herda o total — nasce sem valor, estimado', () => {
      const contas = contasDoContrato(contrato({
        pagamentos: [{ data: '2026-08-28', valor: null }],
        pagamentosDescartados: 1,
      }), 'doc-1')
      expect(contas).toHaveLength(1)
      expect(contas[0].valor).toBeNull()
      expect(contas[0].valor_estimado).toBe(true)
      expect(contas[0].vencimento).toBe('2026-08-28')
    })

    it('rateio também é bloqueado: dividir o total entre os SOBREVIVENTES mentiria', () => {
      const contas = contasDoContrato(contrato({
        pagamentos: [{ data: '2026-08-28', valor: null }, { data: '2026-09-28', valor: null }],
        pagamentosDescartados: 1,
      }), 'doc-1')
      expect(contas.map(c => c.valor)).toEqual([null, null])
      expect(contas.every(c => c.valor_estimado === true)).toBe(true)
    })

    // Valor IMPRESSO ao lado da data continua valendo: ele foi lido no
    // documento, não derivado do total. Descartar uma parcela não apaga o
    // que estava escrito nas outras.
    it('pagamento com valor PRÓPRIO continua confirmado, mesmo com descarte', () => {
      const contas = contasDoContrato(contrato({
        pagamentos: [{ data: '2026-08-28', valor: 323993.18 }],
        pagamentosDescartados: 1,
      }), 'doc-1')
      expect(contas[0].valor).toBe(323993.18)
      expect(contas[0].valor_estimado).toBe(false)
    })
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
