import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn()
vi.mock('../supabase', () => ({
  supabase: { from: () => ({ insert: insertMock }) },
}))

import { gravarContasDoContrato } from './gravarContasDoContrato'
import type { DocumentoLido } from '../controle/documentoPdf'

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
      descricao: 'MS15F 09 23 18 S15', quantidade: 165, unidade: 'MTN',
      valorUnitario: 3927.19, valorTotal: 647986.35,
      numeroDocumento: '280451', data: '2026-07-03',
    }],
    itensDescartados: 0,
    ...over,
  }
}

beforeEach(() => { insertMock.mockReset() })

describe('gravarContasDoContrato', () => {
  it('grava a conta com fazenda_id e devolve criadas: 1', async () => {
    insertMock.mockResolvedValue({ error: null })
    const r = await gravarContasDoContrato(contrato(), 'doc-1', 'fazenda-1')
    expect(r).toEqual({ criadas: 1, duplicadas: 0, erro: null })
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      vencimento: '2026-08-28',
      valor: 647986.35,
      documento_controle_id: 'doc-1',
      fazenda_id: 'fazenda-1',
    }))
  })

  it('extrato não chama o banco', async () => {
    const r = await gravarContasDoContrato(contrato({ tipoDocumento: 'extrato', pagamentos: [] }), 'doc-1', 'f1')
    expect(r).toEqual({ criadas: 0, duplicadas: 0, erro: null })
    expect(insertMock).not.toHaveBeenCalled()
  })

  // Reimportar o mesmo contrato: o índice único da migration 012 devolve
  // 23505. Não é erro — é a trava funcionando.
  it('23505 conta como duplicada, não como erro', async () => {
    insertMock.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    const r = await gravarContasDoContrato(contrato(), 'doc-1', 'f1')
    expect(r).toEqual({ criadas: 0, duplicadas: 1, erro: null })
  })

  // Uma parcela que falha não pode derrubar as demais. Erro no MEIO (não na
  // última posição): só assim o teste distingue "continua tentando as
  // parcelas seguintes" de "para no primeiro erro genérico" — com o erro na
  // última posição, um `return` precoce e o laço completo dão o mesmo
  // resultado observável, e o teste não acusaria a diferença.
  it('erro numa parcela não impede as demais, e é reportado', async () => {
    insertMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: '42501', message: 'RLS' } })
      .mockResolvedValueOnce({ error: null })
    const r = await gravarContasDoContrato(contrato({
      pagamentos: [
        { data: '2026-08-28', valor: 200000 },
        { data: '2026-09-28', valor: 200000 },
        { data: '2026-10-28', valor: 247986.35 },
      ],
    }), 'doc-1', 'f1')
    expect(insertMock).toHaveBeenCalledTimes(3)
    expect(r.criadas).toBe(2)
    expect(r.erro).toContain('RLS')
  })
})
