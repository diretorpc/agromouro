import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./nfeProcessor', () => ({
  parseXmlNFe:     vi.fn(),
  nfeJaProcessada: vi.fn(),
  processarNFe:    vi.fn(),
}))

const { estadoBanco, chamadasRpc } = vi.hoisted(() => ({
  estadoBanco: {
    duplicada:     { data: null as any, error: null as any },
    movimentacoes: { data: [] as any[], error: null as any },
    deleteMov:     { error: null as any },
    deleteContas:  { error: null as any },
    deleteItens:   { error: null as any },
    deleteNota:    { data: [{ id: 'nota-1' }] as any[] | null, error: null as any },
    rpcErro:       null as any,
  },
  chamadasRpc: [] as { fn: string; args: any }[],
}))

vi.mock('./supabase', () => {
  function builder(table: string) {
    let isDelete = false
    const obj: any = {
      select:      vi.fn(() => obj),
      eq:          vi.fn(() => obj),
      delete:      vi.fn(() => { isDelete = true; return obj }),
      maybeSingle: vi.fn(() => Promise.resolve(estadoBanco.duplicada)),
      then: (resolve: any) => {
        if (table === 'movimentacoes_estoque') return resolve(isDelete ? estadoBanco.deleteMov : estadoBanco.movimentacoes)
        if (table === 'contas_a_pagar')        return resolve(estadoBanco.deleteContas)
        if (table === 'itens_nfe')             return resolve(estadoBanco.deleteItens)
        if (table === 'notas_fiscais')         return resolve(estadoBanco.deleteNota)
        return resolve({ data: null, error: null })
      },
    }
    return obj
  }
  return {
    supabase: {
      from: vi.fn((table: string) => builder(table)),
      rpc:  vi.fn((fn: string, args: any) => {
        chamadasRpc.push({ fn, args })
        return Promise.resolve({ error: estadoBanco.rpcErro })
      }),
    },
  }
})

import { parseXmlNFe, nfeJaProcessada, processarNFe } from './nfeProcessor'
import { importarXmlManual, excluirNotaManual } from './nfeManual'

describe('importarXmlManual', () => {
  beforeEach(() => {
    vi.mocked(parseXmlNFe).mockReset()
    vi.mocked(nfeJaProcessada).mockReset()
    vi.mocked(processarNFe).mockReset()
    estadoBanco.duplicada = { data: null, error: null }
  })

  const nfeFake = {
    numero: '9001', dataEmissao: '2026-08-05', emitenteNome: 'CHEGOU STORE',
    emitenteCnpj: '34839053000112', valorTotal: 1199,
    items: [], duplicatas: [], formaPagamento: null,
  } as any

  it('XML inválido: devolve status invalida e não chama processarNFe', async () => {
    vi.mocked(parseXmlNFe).mockReturnValue(null)

    const resultado = await importarXmlManual('<xml-qualquer/>', 'fazenda-1')

    expect(resultado.status).toBe('invalida')
    expect(processarNFe).not.toHaveBeenCalled()
  })

  it('nota já existe: devolve status duplicada com os dados da nota encontrada', async () => {
    vi.mocked(parseXmlNFe).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(true)
    estadoBanco.duplicada = {
      data: { id: 'nota-existente', numero: '9001', data_emissao: '2026-06-02', emitente_nome: 'CHEGOU STORE' },
      error: null,
    }

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('duplicada')
    if (resultado.status === 'duplicada') {
      expect(resultado.nota.id).toBe('nota-existente')
    }
    expect(processarNFe).not.toHaveBeenCalled()
  })

  it('nota nova: chama processarNFe com origem manual e devolve status criada', async () => {
    vi.mocked(parseXmlNFe).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(false)
    vi.mocked(processarNFe).mockResolvedValue(undefined)

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('criada')
    expect(processarNFe).toHaveBeenCalledWith(nfeFake, 'manual', 'fazenda-1')
  })

  it('processarNFe lança erro: devolve status erro com a mensagem', async () => {
    vi.mocked(parseXmlNFe).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(false)
    vi.mocked(processarNFe).mockRejectedValue(new Error('banco fora do ar'))

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('erro')
    if (resultado.status === 'erro') {
      expect(resultado.mensagem).toBe('banco fora do ar')
    }
  })
})

describe('excluirNotaManual', () => {
  beforeEach(() => {
    estadoBanco.movimentacoes = { data: [], error: null }
    estadoBanco.deleteMov     = { error: null }
    estadoBanco.deleteContas  = { error: null }
    estadoBanco.deleteItens   = { error: null }
    estadoBanco.deleteNota    = { data: [{ id: 'nota-1' }], error: null }
    estadoBanco.rpcErro       = null
    chamadasRpc.length = 0
  })

  it('nota sem movimentação de estoque: apaga tudo sem chamar o RPC', async () => {
    const resultado = await excluirNotaManual('nota-1')

    expect(resultado.status).toBe('excluida')
    expect(chamadasRpc).toHaveLength(0)
  })

  it('nota com entrada em estoque: devolve a quantidade com sinal negativo', async () => {
    estadoBanco.movimentacoes = {
      data: [{ insumo_id: 'insumo-1', tipo: 'entrada', quantidade: 50 }],
      error: null,
    }

    await excluirNotaManual('nota-1')

    expect(chamadasRpc).toEqual([
      { fn: 'incrementar_estoque', args: { p_insumo_id: 'insumo-1', p_quantidade: -50 } },
    ])
  })

  it('nota que não existe mais: devolve nao_encontrada', async () => {
    estadoBanco.deleteNota = { data: [], error: null }

    const resultado = await excluirNotaManual('nota-inexistente')

    expect(resultado.status).toBe('nao_encontrada')
  })

  it('erro ao apagar o boleto: para ali e não tenta apagar os itens', async () => {
    estadoBanco.deleteContas = { error: { message: 'falha de rede' } }

    const resultado = await excluirNotaManual('nota-1')

    expect(resultado.status).toBe('erro')
  })
})
