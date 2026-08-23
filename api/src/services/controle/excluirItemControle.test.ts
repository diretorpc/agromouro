import { describe, it, expect, vi, beforeEach } from 'vitest'

const { estadoBanco, chamadasDelete, chamadasConta } = vi.hoisted(() => ({
  estadoBanco: {
    itemSelect: { data: null as any, error: null as any },
    // O que a busca por conta a pagar AINDA EM ABERTO deste documento
    // devolve (Important 3). Padrão: nenhuma conta — o caminho de quase
    // todo teste deste arquivo, que fala de item avulso ou de extrato.
    contaSelect: { data: null as any, error: null as any },
    erroDelete: null as any,
  },
  chamadasDelete: [] as Record<string, any>[],
  chamadasConta: [] as Record<string, any>[],
}))

vi.mock('../supabase', () => {
  function builder(tabela: string) {
    const filtros: Record<string, any> = {}
    let modo: 'select' | 'delete' | null = null
    const obj: any = {
      select: vi.fn(() => { modo = 'select'; return obj }),
      delete: vi.fn(() => { modo = 'delete'; return obj }),
      eq: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      is: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      in: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      limit: vi.fn(() => obj),
      maybeSingle: vi.fn(() => {
        if (tabela === 'contas_a_pagar') {
          chamadasConta.push({ ...filtros })
          return Promise.resolve(estadoBanco.contaSelect)
        }
        return Promise.resolve(estadoBanco.itemSelect)
      }),
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
  return { supabase: { from: vi.fn((tabela: string) => builder(tabela)) } }
})

import { excluirItemControle } from './excluirItemControle'

const FAZENDA_A = 'fazenda-aaa'

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.itemSelect = { data: null, error: null }
  estadoBanco.contaSelect = { data: null, error: null }
  estadoBanco.erroDelete = null
  chamadasDelete.length = 0
  chamadasConta.length = 0
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

// Important 3 da revisão final da branch do contrato de adubo (23/08/2026).
// A grade estilo Excel deixa apagar QUALQUER linha, e a linha do contrato
// Mosaic agora é o único registro do gasto de R$ 647.986,35 — apagá-la
// tirava o gasto do Financeiro E deixava a conta a pagar viva e vinculada
// (`on delete set null` só solta a conta quando o DOCUMENTO some). Como a
// conta continua com `documento_controle_id`, `precisaCriarLancamento`
// recusa lançar quando ela for paga: o dinheiro sumia por completo, das três
// telas ao mesmo tempo. Recusar a exclusão é a trava mais barata — o dono
// dispensa/paga a conta primeiro, ou apaga o documento inteiro.
describe('excluirItemControle — item de documento com dívida em aberto', () => {
  it('item de PDF com conta a pagar em aberto: RECUSA, não apaga nada', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: 'doc-1' }, error: null }
    estadoBanco.contaSelect = { data: { id: 'conta-1' }, error: null }

    const r = await excluirItemControle('item-1', FAZENDA_A)

    expect(r).toEqual({ status: 'divida_em_aberto' })
    expect(chamadasDelete).toHaveLength(0)
  })

  it('a busca da conta é isolada por fazenda e só olha conta NÃO encerrada', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: 'doc-1' }, error: null }
    estadoBanco.contaSelect = { data: { id: 'conta-1' }, error: null }

    await excluirItemControle('item-1', FAZENDA_A)

    expect(chamadasConta).toEqual([{
      documento_controle_id: 'doc-1',
      fazenda_id: FAZENDA_A,
      status: ['aguardando', 'aberta'],
    }])
  })

  it('item de PDF cuja conta já foi paga/dispensada (nenhuma em aberto): apaga normalmente', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: 'doc-1' }, error: null }
    estadoBanco.contaSelect = { data: null, error: null }

    const r = await excluirItemControle('item-1', FAZENDA_A)

    expect(r).toEqual({ status: 'excluido' })
    expect(chamadasDelete).toEqual([{ id: 'item-1', fazenda_id: FAZENDA_A }])
  })

  it('item AVULSO (sem documento) nem consulta contas a pagar', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: null }, error: null }

    const r = await excluirItemControle('item-1', FAZENDA_A)

    expect(r).toEqual({ status: 'excluido' })
    expect(chamadasConta).toHaveLength(0)
  })

  // Falhar a consulta NÃO pode virar "então pode apagar": o item some e a
  // dívida fica invisível, exatamente o buraco que esta trava fecha. Recusar
  // é reversível (o dono tenta de novo); apagar não é.
  it('erro ao consultar contas a pagar: recusa com erro, NÃO apaga', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: 'doc-1' }, error: null }
    estadoBanco.contaSelect = { data: null, error: { message: 'column does not exist' } }

    const r = await excluirItemControle('item-1', FAZENDA_A)

    expect(r).toEqual({ status: 'erro', mensagem: 'column does not exist' })
    expect(chamadasDelete).toHaveLength(0)
  })
})
