import { describe, it, expect, vi, beforeEach } from 'vitest'

const { estadoBanco, chamadasDelete } = vi.hoisted(() => ({
  estadoBanco: {
    itemSelect: { data: null as any, error: null as any },
    erroDelete: null as any,
  },
  chamadasDelete: [] as Record<string, any>[],
}))

vi.mock('../supabase', () => {
  function builder() {
    const filtros: Record<string, any> = {}
    let modo: 'select' | 'delete' | null = null
    const obj: any = {
      select: vi.fn(() => { modo = 'select'; return obj }),
      delete: vi.fn(() => { modo = 'delete'; return obj }),
      eq: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      is: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      maybeSingle: vi.fn(() => Promise.resolve(estadoBanco.itemSelect)),
      then(resolve: any) {
        // Só o modo DELETE termina aqui (o SELECT sempre passa por
        // `.maybeSingle()` antes de alguém dar `await`) — mesmo padrão de
        // excluirDocumentoControle.test.ts.
        chamadasDelete.push({ ...filtros })
        return Promise.resolve(resolve({ error: estadoBanco.erroDelete }))
      },
    }
    return obj
  }
  return { supabase: { from: vi.fn(() => builder()) } }
})

import { excluirItemControle } from './excluirItemControle'

const FAZENDA_A = 'fazenda-aaa'

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.itemSelect = { data: null, error: null }
  estadoBanco.erroDelete = null
  chamadasDelete.length = 0
})

describe('excluirItemControle', () => {
  it('item não encontrado (id errado, outra fazenda, ou é item de NF-e): nao_encontrado, não tenta DELETE', async () => {
    estadoBanco.itemSelect = { data: null, error: null }

    const r = await excluirItemControle('item-x', FAZENDA_A)

    expect(r).toEqual({ status: 'nao_encontrado' })
    expect(chamadasDelete).toHaveLength(0)
  })

  it('falha ao BUSCAR: erro, não tenta DELETE', async () => {
    estadoBanco.itemSelect = { data: null, error: { message: 'timeout' } }

    const r = await excluirItemControle('item-1', FAZENDA_A)

    expect(r).toEqual({ status: 'erro', mensagem: 'timeout' })
    expect(chamadasDelete).toHaveLength(0)
  })

  it('sucesso: apaga isolando por fazenda', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1' }, error: null }

    const r = await excluirItemControle('item-1', FAZENDA_A)

    expect(r).toEqual({ status: 'excluido' })
    expect(chamadasDelete).toEqual([{ id: 'item-1', fazenda_id: FAZENDA_A }])
  })

  it('erro no DELETE: status erro com a mensagem', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1' }, error: null }
    estadoBanco.erroDelete = { message: 'lock timeout' }

    const r = await excluirItemControle('item-1', FAZENDA_A)

    expect(r).toEqual({ status: 'erro', mensagem: 'lock timeout' })
  })
})
