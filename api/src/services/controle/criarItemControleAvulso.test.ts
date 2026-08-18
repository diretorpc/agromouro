import { describe, it, expect, vi, beforeEach } from 'vitest'

const { estadoBanco, chamadasInsert } = vi.hoisted(() => ({
  estadoBanco: { resultado: { data: null as any, error: null as any } },
  chamadasInsert: [] as any[],
}))

vi.mock('../supabase', () => {
  function builder() {
    const obj: any = {
      insert: vi.fn((payload: any) => { chamadasInsert.push(payload); return obj }),
      select: vi.fn(() => obj),
      single: vi.fn(() => Promise.resolve(estadoBanco.resultado)),
    }
    return obj
  }
  return { supabase: { from: vi.fn(() => builder()) } }
})

import { criarItemControleAvulso } from './criarItemControleAvulso'

const FAZENDA_A = 'fazenda-aaa'

const NOVO = {
  descricao: 'ADUBO LANÇADO À MÃO',
  quantidade: 10,
  unidade: 'SC',
  valor_unitario: 150,
  valor_total: 1500,
  data_manual: '2026-08-18',
  fornecedor: 'FORNECEDOR X',
  numero_documento: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.resultado = { data: null, error: null }
  chamadasInsert.length = 0
})

describe('criarItemControleAvulso', () => {
  it('sucesso: cria e devolve o item', async () => {
    const criado = { id: 'item-novo', ...NOVO, conta_como_compra: false }
    estadoBanco.resultado = { data: criado, error: null }

    const r = await criarItemControleAvulso(NOVO, FAZENDA_A)

    expect(r).toEqual({ status: 'criado', item: criado })
  })

  // TRAVA DE DINHEIRO — mesma trava de editarItemControle.ts: item de
  // Controle nunca conta como gasto no Financeiro, mesmo criado avulso.
  it('grava sempre conta_como_compra: false, documento_controle_id/nota_fiscal_id null, ocorrencia 0', async () => {
    estadoBanco.resultado = { data: { id: 'item-novo' }, error: null }

    await criarItemControleAvulso(NOVO, FAZENDA_A)

    expect(chamadasInsert).toHaveLength(1)
    expect(chamadasInsert[0]).toMatchObject({
      conta_como_compra:       false,
      documento_controle_id:   null,
      nota_fiscal_id:          null,
      ocorrencia_no_documento: 0,
      fazenda_id:              FAZENDA_A,
    })
  })

  it('erro no INSERT: status erro com a mensagem', async () => {
    estadoBanco.resultado = { data: null, error: { message: 'RLS bloqueou o insert' } }

    const r = await criarItemControleAvulso(NOVO, FAZENDA_A)

    expect(r).toEqual({ status: 'erro', mensagem: 'RLS bloqueou o insert' })
  })
})
