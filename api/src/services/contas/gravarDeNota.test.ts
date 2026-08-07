import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Simulação mínima do Supabase — só a tabela contas_a_pagar ──────────────
// gravarDeNota.ts só toca `.from('contas_a_pagar').upsert(...).select(...)`.
// `estado.erroUpsert` liga/desliga a falha de banco por teste.
const { estado } = vi.hoisted(() => ({
  estado: { erroUpsert: null as null | { message: string; code: string } },
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      let ultimoUpsert: any = null
      const obj: any = {
        upsert: vi.fn((payload: any) => {
          ultimoUpsert = payload
          return obj
        }),
        select: vi.fn(() => obj),
        then: (resolve: any) => resolve(
          estado.erroUpsert
            ? { data: null, error: estado.erroUpsert }
            : { data: ultimoUpsert, error: null },
        ),
      }
      return obj
    }),
  },
}))

import { gravarContasDaNota } from './gravarDeNota'
import type { DadosParaConta } from './deNotaFiscal'

const base: DadosParaConta = {
  numero:         '4516',
  emitenteNome:   'TRIANGULO DIESEL TRR LTDA',
  dataEmissao:    '2026-07-14',
  valorTotal:     30600,
  formaPagamento: '15',
  duplicatas:     [{ numero: '001', vencimento: '2026-07-21', valor: 30600 }],
  items:          [{ descricao: 'DIESEL S10' }],
}

beforeEach(() => { estado.erroUpsert = null })

// Esta é a lacuna que a Task 3 deixou aberta: parcelasDescartadasDaNota()
// existia mas ninguém a chamava, então uma parcela ruim no meio de uma nota
// que "deu certo" nunca aparecia em lugar nenhum.
describe('gravarContasDaNota — parcelas descartadas', () => {
  it('nota sem problema nenhum: descartadas vem vazia', async () => {
    const r = await gravarContasDaNota(base, 'nfe-id', 'fazenda-id')
    expect(r.contas).toHaveLength(1)
    expect(r.descartadas).toEqual([])
  })

  it('3 parcelas, uma ruim no meio: contas tem as 2 boas, descartadas tem a ruim', async () => {
    const r = await gravarContasDaNota({
      ...base,
      duplicatas: [
        { numero: '001', vencimento: '2026-08-15', valor: 220000 },
        { numero: '002', vencimento: '2026-13-40', valor: 220000 }, // malformada
        { numero: '003', vencimento: '2026-10-15', valor: 220000 },
      ],
    }, 'nfe-id', 'fazenda-id')

    expect(r.contas).toHaveLength(2)
    expect(r.contas.map(c => c.vencimento)).toEqual(['2026-08-15', '2026-10-15'])
    expect(r.descartadas).toHaveLength(1)
    expect(r.descartadas[0].numero).toBe('002')
    expect(r.descartadas[0].motivo).toMatch(/Data em formato inválido/)
  })

  it('cartao de credito: nem contas nem descartadas — a nota nem tenta gerar boleto', async () => {
    const r = await gravarContasDaNota({ ...base, formaPagamento: '05' }, 'nfe-id', 'fazenda-id')
    expect(r.contas).toEqual([])
    expect(r.descartadas).toEqual([])
  })

  it('nota sem quadro de cobranca (caso ERCAL): descartadas vem vazia', async () => {
    const r = await gravarContasDaNota({ ...base, duplicatas: [] }, 'nfe-id', 'fazenda-id')
    expect(r.contas).toHaveLength(1)
    expect(r.descartadas).toEqual([])
  })

  it('todas as parcelas ruins: lanca erro (nao confundir com "sem boleto por decisao")', async () => {
    await expect(gravarContasDaNota({
      ...base,
      duplicatas: [
        { numero: '001', vencimento: '2026-13-40', valor: 100 },
        { numero: '002', vencimento: '2026-99-99', valor: 200 },
      ],
    }, 'nfe-id', 'fazenda-id')).rejects.toThrow(/NF 4516 \(TRIANGULO DIESEL TRR LTDA\)/)
  })

  it('parcela ruim no meio, mas o banco falha ao gravar: a funcao inteira estoura (nao devolve descartadas parcial)', async () => {
    estado.erroUpsert = { message: 'coluna inexistente', code: '42703' }
    await expect(gravarContasDaNota({
      ...base,
      duplicatas: [
        { numero: '001', vencimento: '2026-08-15', valor: 100 },
        { numero: '002', vencimento: '2026-13-40', valor: 100 }, // malformada
      ],
    }, 'nfe-id', 'fazenda-id')).rejects.toThrow(/falha ao gravar boleto no banco/)
  })
})
