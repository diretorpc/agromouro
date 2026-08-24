import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./nfeProcessor', () => ({
  parseXmlNota:    vi.fn(),
  nfeJaProcessada: vi.fn(),
  processarNFe:    vi.fn(),
}))

const { estadoBanco, chamadasRpc, removeMock } = vi.hoisted(() => ({
  estadoBanco: {
    // Resposta do único SELECT em notas_fiscais que este arquivo mocka —
    // reaproveitado pelas duas buscas de importarXmlManual (nota duplicada
    // E nota que falhou no meio do processamento), porque as duas fazem a
    // MESMA forma de consulta (.select().eq().eq().eq().maybeSingle()) e
    // cada teste só exercita uma das duas por vez.
    notaSelect: { data: null as any, error: null as any },
    rpcErro:    null as any,
  },
  chamadasRpc: [] as { fn: string; args: any }[],
  removeMock: vi.fn(),
}))

vi.mock('./supabase', () => {
  function builder() {
    const obj: any = {
      select:      vi.fn(() => obj),
      eq:          vi.fn(() => obj),
      maybeSingle: vi.fn(() => Promise.resolve(estadoBanco.notaSelect)),
    }
    return obj
  }
  return {
    supabase: {
      from: vi.fn(() => builder()),
      rpc:  vi.fn((fn: string, args: any) => {
        chamadasRpc.push({ fn, args })
        return Promise.resolve({ error: estadoBanco.rpcErro })
      }),
      storage: { from: vi.fn(() => ({ remove: removeMock })) },
    },
  }
})

import { parseXmlNota, nfeJaProcessada, processarNFe } from './nfeProcessor'
import { importarXmlManual, excluirNotaManual } from './nfeManual'

describe('importarXmlManual', () => {
  beforeEach(() => {
    vi.mocked(parseXmlNota).mockReset()
    vi.mocked(nfeJaProcessada).mockReset()
    vi.mocked(processarNFe).mockReset()
    estadoBanco.notaSelect = { data: null, error: null }
    estadoBanco.rpcErro = null
    chamadasRpc.length = 0
  })

  const nfeFake = {
    numero: '9001', dataEmissao: '2026-08-05', emitenteNome: 'CHEGOU STORE',
    emitenteCnpj: '34839053000112', valorTotal: 1199,
    items: [], duplicatas: [], formaPagamento: null, modelo: 'nfe',
  } as any

  it('XML inválido: devolve status invalida e não chama processarNFe', async () => {
    vi.mocked(parseXmlNota).mockReturnValue(null)

    const resultado = await importarXmlManual('<xml-qualquer/>', 'fazenda-1')

    expect(resultado.status).toBe('invalida')
    expect(processarNFe).not.toHaveBeenCalled()
  })

  it('nota já existe: devolve status duplicada com os dados da nota encontrada', async () => {
    vi.mocked(parseXmlNota).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(true)
    estadoBanco.notaSelect = {
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
    vi.mocked(parseXmlNota).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(false)
    vi.mocked(processarNFe).mockResolvedValue(undefined)

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('criada')
    expect(processarNFe).toHaveBeenCalledWith(nfeFake, 'manual', 'fazenda-1')
    expect(chamadasRpc).toHaveLength(0)
  })

  it('processarNFe lança erro SEM ter deixado casca no banco: devolve erro e não chama limpeza', async () => {
    vi.mocked(parseXmlNota).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(false)
    vi.mocked(processarNFe).mockRejectedValue(new Error('banco fora do ar'))
    estadoBanco.notaSelect = { data: null, error: null }

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('erro')
    if (resultado.status === 'erro') {
      expect(resultado.mensagem).toBe('banco fora do ar')
    }
    expect(chamadasRpc).toHaveLength(0)
  })

  it('ACHADO 2: processarNFe lança erro COM casca já gravada — limpa a nota antes de devolver o erro', async () => {
    vi.mocked(parseXmlNota).mockReturnValue(nfeFake)
    vi.mocked(nfeJaProcessada).mockResolvedValue(false)
    vi.mocked(processarNFe).mockRejectedValue(new Error('IA de classificação fora do ar'))
    // processarNFe grava a nota como PRIMEIRO passo — se falhar depois, a
    // casca fica no banco com status 'erro'. Esta busca simula encontrá-la.
    estadoBanco.notaSelect = { data: { id: 'nota-casca-8001' }, error: null }

    const resultado = await importarXmlManual('<xml/>', 'fazenda-1')

    expect(resultado.status).toBe('erro')
    expect(chamadasRpc).toEqual([
      { fn: 'excluir_nota_fiscal', args: { p_nota_id: 'nota-casca-8001', p_fazenda_id: 'fazenda-1' } },
    ])
  })
})

describe('excluirNotaManual', () => {
  beforeEach(() => {
    estadoBanco.rpcErro = null
    estadoBanco.notaSelect = { data: null, error: null }
    chamadasRpc.length = 0
    removeMock.mockReset()
    removeMock.mockResolvedValue({ error: null })
  })

  // ACHADO 5 do Apolo (24/08/2026): a RPC apaga tudo no banco e nao sabe que
  // Storage existe. O caminho do PDF so vive na coluna arquivo_pdf, que some
  // junto com a linha — sem ler ANTES, o DANFE fica orfao para sempre.
  it('nota que veio de PDF: apaga tambem o arquivo do bucket', async () => {
    estadoBanco.notaSelect = { data: { arquivo_pdf: 'fazenda-1/abc.pdf' }, error: null }

    const resultado = await excluirNotaManual('nota-1', 'fazenda-1')

    expect(resultado.status).toBe('excluida')
    expect(removeMock).toHaveBeenCalledWith(['fazenda-1/abc.pdf'])
  })

  it('nota sem PDF (XML, e-mail, webhook): nao chama o Storage', async () => {
    estadoBanco.notaSelect = { data: { arquivo_pdf: null }, error: null }

    await excluirNotaManual('nota-1', 'fazenda-1')

    expect(removeMock).not.toHaveBeenCalled()
  })

  it('RPC recusou: o arquivo NAO e apagado — a nota continua la, apontando pra ele', async () => {
    estadoBanco.notaSelect = { data: { arquivo_pdf: 'fazenda-1/abc.pdf' }, error: null }
    estadoBanco.rpcErro = { message: 'boleto_ja_pago' }

    const resultado = await excluirNotaManual('nota-1', 'fazenda-1')

    expect(resultado.status).toBe('boleto_pago')
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('falha ao remover do Storage nao desfaz a exclusao ja confirmada no banco', async () => {
    estadoBanco.notaSelect = { data: { arquivo_pdf: 'fazenda-1/abc.pdf' }, error: null }
    removeMock.mockResolvedValue({ error: { message: 'storage fora do ar' } })

    const resultado = await excluirNotaManual('nota-1', 'fazenda-1')

    expect(resultado.status).toBe('excluida')
  })

  it('RPC sem erro: devolve excluida', async () => {
    const resultado = await excluirNotaManual('nota-1', 'fazenda-1')

    expect(resultado.status).toBe('excluida')
    expect(chamadasRpc).toEqual([
      { fn: 'excluir_nota_fiscal', args: { p_nota_id: 'nota-1', p_fazenda_id: 'fazenda-1' } },
    ])
  })

  it('RPC devolve nota_nao_encontrada: devolve nao_encontrada', async () => {
    estadoBanco.rpcErro = { message: 'nota_nao_encontrada' }

    const resultado = await excluirNotaManual('nota-inexistente', 'fazenda-1')

    expect(resultado.status).toBe('nao_encontrada')
  })

  it('RPC devolve nota_em_processamento: devolve em_processamento', async () => {
    estadoBanco.rpcErro = { message: 'nota_em_processamento' }

    const resultado = await excluirNotaManual('nota-1', 'fazenda-1')

    expect(resultado.status).toBe('em_processamento')
  })

  it('RPC devolve boleto_ja_pago: devolve boleto_pago', async () => {
    estadoBanco.rpcErro = { message: 'boleto_ja_pago' }

    const resultado = await excluirNotaManual('nota-1', 'fazenda-1')

    expect(resultado.status).toBe('boleto_pago')
  })

  it('RPC devolve erro desconhecido: devolve erro com a mensagem original', async () => {
    estadoBanco.rpcErro = { message: 'connection timeout' }

    const resultado = await excluirNotaManual('nota-1', 'fazenda-1')

    expect(resultado.status).toBe('erro')
    if (resultado.status === 'erro') {
      expect(resultado.mensagem).toBe('connection timeout')
    }
  })
})
