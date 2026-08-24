import { describe, it, expect, vi, beforeEach } from 'vitest'

// A gravação é a parte que mexe em dinheiro: sobe o arquivo, entrega ao mesmo
// processarNFe que o XML usa e precisa limpar TUDO quando o caminho quebra no
// meio. Cada teste aqui é um jeito de quebrar.

const { estado, updates, uploadMock, removeMock, rpcMock, processarNFeMock, nfeJaProcessadaMock } = vi.hoisted(() => ({
  estado: { notaExistente: null as any },
  updates: [] as any[],
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  rpcMock: vi.fn(),
  processarNFeMock: vi.fn(),
  nfeJaProcessadaMock: vi.fn(),
}))

vi.mock('../nfeProcessor', () => ({
  processarNFe: processarNFeMock,
  nfeJaProcessada: nfeJaProcessadaMock,
}))

vi.mock('../supabase', () => {
  // Cadeia .from().select().eq()...maybeSingle() — devolve sempre a nota que o
  // teste plantou em estado.notaExistente. O update() registra o que tentou
  // gravar e é "thenable", como o cliente real.
  function builder(): any {
    const obj: any = {
      select:      () => obj,
      eq:          () => obj,
      update:      (payload: any) => { updates.push(payload); return obj },
      maybeSingle: async () => ({ data: estado.notaExistente, error: null }),
      then:        (resolve: any) => resolve({ error: null }),
    }
    return obj
  }

  return {
    supabase: {
      from: () => builder(),
      rpc:  rpcMock,
      storage: { from: () => ({ upload: uploadMock, remove: removeMock }) },
    },
  }
})

import { gravarNotaDoPdf } from './gravarNotaDoPdf'
import type { NotaLidaDoPdf } from './notaPdf'

const PDF = Buffer.from('%PDF-1.4 conteudo de teste')

function notaLida(over: Partial<NotaLidaDoPdf> = {}): NotaLidaDoPdf {
  return {
    modelo: 'nfe', numero: '58717',
    emitenteNome: 'SOLOS SOLUCOES AGRICOLAS LTDA', emitenteCnpj: '04063805000135',
    dataEmissao: '2026-08-10', valorTotal: 4400, formaPagamento: '15',
    duplicatas: [{ numero: '001', vencimento: '2026-09-10', valor: 4400 }],
    itens: [{
      descricao: 'TEBURAZ 500 SC', quantidade: 5, unidade: 'L',
      valorUnitario: 880, valorTotal: 4400, quantidadeTrib: 5, unidadeTrib: 'L',
      ncm: '38089329', cfop: '5102',
    }],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  estado.notaExistente = null
  updates.length = 0
  uploadMock.mockResolvedValue({ error: null })
  removeMock.mockResolvedValue({ error: null })
  rpcMock.mockResolvedValue({ error: null })
  nfeJaProcessadaMock.mockResolvedValue(false)
  processarNFeMock.mockResolvedValue('nota-id-1')
})

describe('gravarNotaDoPdf — caminho feliz', () => {
  it('sobe o PDF, chama processarNFe e devolve o id', async () => {
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r).toEqual({
      status: 'gravada', notaId: 'nota-id-1', numero: '58717',
      emitenteNome: 'SOLOS SOLUCOES AGRICOLAS LTDA', valorTotal: 4400,
    })
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('o caminho do arquivo comeca pela fazenda e termina em .pdf', async () => {
    await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    const [caminho] = uploadMock.mock.calls[0]
    expect(caminho).toMatch(/^fazenda-1\/[0-9a-f-]{36}\.pdf$/)
  })

  it('o hash vai junto do caminho pro processarNFe, no mesmo insert', async () => {
    await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    const [, origem, fazenda, arquivo] = processarNFeMock.mock.calls[0]
    expect(origem).toBe('manual')
    expect(fazenda).toBe('fazenda-1')
    expect(arquivo.pdfPath).toMatch(/^fazenda-1\//)
    // sha256 é determinístico: o mesmo Buffer sempre dá o mesmo hash — é isso
    // que faz o índice único reconhecer o reenvio do MESMO arquivo.
    expect(arquivo.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('o PDF vira NFeData antes de chegar no processarNFe', async () => {
    await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    const [nfe] = processarNFeMock.mock.calls[0]
    expect(nfe.items[0].description).toBe('TEBURAZ 500 SC')
    expect(nfe.items[0].cfop).toBe('5102')
    expect(nfe.duplicatas[0].vencimento).toBe('2026-09-10')
  })
})

describe('gravarNotaDoPdf — recusa e limpeza', () => {
  it('nota ja existente devolve os dados da que ja esta la, sem subir arquivo', async () => {
    nfeJaProcessadaMock.mockResolvedValue(true)
    estado.notaExistente = { id: 'ja-existe', numero: '58717', data_emissao: '2026-06-08', emitente_nome: 'SOLOS' }
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r.status).toBe('duplicada-nota')
    expect(uploadMock).not.toHaveBeenCalled()
    expect(processarNFeMock).not.toHaveBeenCalled()
  })

  it('falha no upload nao cria nota nenhuma', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'bucket fora do ar' } })
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r.status).toBe('erro')
    expect(processarNFeMock).not.toHaveBeenCalled()
  })

  it('mesmo arquivo reenviado: 23505 no indice do hash vira duplicada-arquivo e limpa o Storage', async () => {
    processarNFeMock.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_nfe_arquivo_hash"',
    })
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r.status).toBe('duplicada-arquivo')
    expect(removeMock).toHaveBeenCalledTimes(1)
    // Insert que falhou não deixa casca — não há o que apagar via RPC.
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('corrida com o e-mail: 23505 no indice da nota vira duplicada-nota', async () => {
    processarNFeMock.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_nfe_numero_emitente_fazenda_modelo"',
    })
    estado.notaExistente = { id: 'chegou-primeiro', numero: '58717', data_emissao: '2026-08-10', emitente_nome: 'SOLOS' }
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r.status).toBe('duplicada-nota')
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('falha no MEIO do processamento apaga a casca E o arquivo', async () => {
    // processarNFe grava a nota como PRIMEIRO passo (status 'processando').
    // Se ele estourar depois disso, a casca fica no banco e envenena a nota
    // real que vier por e-mail: nfeJaProcessada só confere se a nota EXISTE.
    processarNFeMock.mockRejectedValue(new Error('IA de classificacao fora do ar'))
    estado.notaExistente = { id: 'casca-1', numero: '58717', data_emissao: '2026-08-10', emitente_nome: 'SOLOS' }
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r.status).toBe('erro')
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('excluir_nota_fiscal', { p_nota_id: 'casca-1', p_fazenda_id: 'fazenda-1' })
  })

  it('falha no meio sem casca no banco nao chama a RPC', async () => {
    processarNFeMock.mockRejectedValue(new Error('caiu antes do insert'))
    estado.notaExistente = null
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r.status).toBe('erro')
    expect(rpcMock).not.toHaveBeenCalled()
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('casca que nao pode ser apagada fica sem apontar pro arquivo que ja foi removido', async () => {
    // ACHADO 10 do Apolo: o arquivo do Storage ja foi removido; se a casca
    // sobrevive apontando pra ele, "Baixar PDF" nessa nota responde 500.
    processarNFeMock.mockRejectedValue(new Error('estourou no meio'))
    estado.notaExistente = { id: 'casca-1', numero: '58717', data_emissao: '2026-08-10', emitente_nome: 'SOLOS' }
    rpcMock.mockResolvedValue({ error: { message: 'nota_em_processamento' } })

    await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')

    expect(updates).toContainEqual({ arquivo_pdf: null, arquivo_hash: null })
  })

  it('casca apagada com sucesso nao precisa de update nenhum', async () => {
    processarNFeMock.mockRejectedValue(new Error('estourou no meio'))
    estado.notaExistente = { id: 'casca-1', numero: '58717', data_emissao: '2026-08-10', emitente_nome: 'SOLOS' }

    await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')

    expect(updates).toEqual([])
  })

  it('erro do Supabase (objeto puro, sem instanceof Error) ainda vira mensagem legivel', async () => {
    processarNFeMock.mockRejectedValue({ code: '42703', message: 'column "x" does not exist' })
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r.status === 'erro' && r.mensagem).toBe('column "x" does not exist')
  })

  it('falha ao limpar o Storage nao mascara a falha original', async () => {
    processarNFeMock.mockRejectedValue(new Error('estourou no meio'))
    removeMock.mockResolvedValue({ error: { message: 'storage fora do ar' } })
    const r = await gravarNotaDoPdf(notaLida(), PDF, 'fazenda-1')
    expect(r.status === 'erro' && r.mensagem).toBe('estourou no meio')
  })
})
