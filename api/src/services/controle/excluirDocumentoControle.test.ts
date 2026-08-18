import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Banco fake ─────────────────────────────────────────────────────────────
// Mesmo padrão de nfeManual.test.ts: um builder por chamada de `from()`, com
// `then()` fazendo o papel de thenable pro `await supabase.from(x).delete()...`
// do service (sem `.select()` depois do delete, então nunca passa por `.single()`).
const { estadoBanco, chamadasDelete, chamadasUpdate, removeStorageMock } = vi.hoisted(() => ({
  estadoBanco: {
    documentoSelect: { data: null as any, error: null as any },
    erroDeleteItens: null as any,
    erroDeleteDocumento: null as any,
    erroMarcarComoErro: null as any,
  },
  chamadasDelete: [] as { tabela: string; filtros: Record<string, any> }[],
  chamadasUpdate: [] as { tabela: string; payload: any; filtros: Record<string, any> }[],
  removeStorageMock: vi.fn(),
}))

vi.mock('../supabase', () => {
  function builder(tabela: string) {
    const filtros: Record<string, any> = {}
    let modo: 'delete' | 'update' | null = null
    let payloadUpdate: any = null
    const obj: any = {
      select: vi.fn(() => obj),
      delete: vi.fn(() => { modo = 'delete'; return obj }),
      update: vi.fn((payload: any) => { modo = 'update'; payloadUpdate = payload; return obj }),
      eq:          vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      maybeSingle: vi.fn(() => Promise.resolve(estadoBanco.documentoSelect)),
      // Só os modos DELETE/UPDATE passam por aqui — o modo SELECT sempre
      // termina em `.maybeSingle()` antes de alguém dar `await` no builder.
      then(resolve: any) {
        if (modo === 'update') {
          chamadasUpdate.push({ tabela, payload: payloadUpdate, filtros: { ...filtros } })
          return Promise.resolve(resolve({ error: estadoBanco.erroMarcarComoErro }))
        }
        chamadasDelete.push({ tabela, filtros: { ...filtros } })
        const erro = tabela === 'itens_nfe' ? estadoBanco.erroDeleteItens : estadoBanco.erroDeleteDocumento
        return Promise.resolve(resolve({ error: erro }))
      },
    }
    return obj
  }

  return {
    supabase: {
      from: vi.fn((tabela: string) => builder(tabela)),
      storage: {
        from: vi.fn(() => ({ remove: removeStorageMock })),
      },
    },
  }
})

import { excluirDocumentoControle } from './excluirDocumentoControle'

const FAZENDA_A = 'fazenda-aaa'

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.documentoSelect = { data: null, error: null }
  estadoBanco.erroDeleteItens = null
  estadoBanco.erroDeleteDocumento = null
  estadoBanco.erroMarcarComoErro = null
  chamadasDelete.length = 0
  chamadasUpdate.length = 0
  removeStorageMock.mockResolvedValue({ error: null })
})

describe('excluirDocumentoControle', () => {
  it('documento não encontrado (id errado ou de outra fazenda): nao_encontrado, não tenta apagar nada', async () => {
    estadoBanco.documentoSelect = { data: null, error: null }

    const resultado = await excluirDocumentoControle('doc-x', FAZENDA_A)

    expect(resultado).toEqual({ status: 'nao_encontrado' })
    expect(chamadasDelete).toHaveLength(0)
    expect(removeStorageMock).not.toHaveBeenCalled()
  })

  it('falha ao BUSCAR o documento: status erro com a mensagem, não tenta apagar nada', async () => {
    estadoBanco.documentoSelect = { data: null, error: { message: 'timeout de conexão' } }

    const resultado = await excluirDocumentoControle('doc-1', FAZENDA_A)

    expect(resultado).toEqual({ status: 'erro', mensagem: 'timeout de conexão' })
    expect(chamadasDelete).toHaveLength(0)
  })

  it('sucesso: apaga itens ANTES do documento (ordem exigida pela FK RESTRICT), depois o PDF no Storage', async () => {
    estadoBanco.documentoSelect = {
      data: { id: 'doc-1', arquivo_path: `${FAZENDA_A}/doc-1.pdf` },
      error: null,
    }

    const resultado = await excluirDocumentoControle('doc-1', FAZENDA_A)

    expect(resultado).toEqual({ status: 'excluido' })
    expect(chamadasDelete).toEqual([
      { tabela: 'itens_nfe', filtros: { documento_controle_id: 'doc-1', fazenda_id: FAZENDA_A } },
      { tabela: 'documentos_controle', filtros: { id: 'doc-1', fazenda_id: FAZENDA_A } },
    ])
    expect(removeStorageMock).toHaveBeenCalledWith([`${FAZENDA_A}/doc-1.pdf`])
  })

  it('falha ao apagar os ITENS: devolve erro e NÃO tenta apagar o documento (evitaria violar itens_nfe_doc_controle_fk)', async () => {
    estadoBanco.documentoSelect = { data: { id: 'doc-1', arquivo_path: 'x/doc-1.pdf' }, error: null }
    estadoBanco.erroDeleteItens = { message: 'conexão perdida' }

    const resultado = await excluirDocumentoControle('doc-1', FAZENDA_A)

    expect(resultado).toEqual({ status: 'erro', mensagem: 'conexão perdida' })
    expect(chamadasDelete).toHaveLength(1)
    expect(chamadasDelete[0].tabela).toBe('itens_nfe')
    expect(removeStorageMock).not.toHaveBeenCalled()
  })

  // Achado do Apolo: sem este cuidado, os itens já tinham sido apagados de
  // verdade (o DELETE de itens_nfe deu certo) mas a linha de
  // documentos_controle sobrevivia com o status antigo — GET / mostraria
  // "nenhum item novo — documento já importado antes" (frase pensada pra
  // REIMPORTAÇÃO, migration 018), mentindo sobre o que aconteceu: os itens
  // não "já constavam", foram DESTRUÍDOS agora. Marcar 'erro' evita a mentira.
  it('itens apagados mas o DOCUMENTO falha: marca o documento como erro (não deixa "mentindo" como se nada tivesse mudado)', async () => {
    estadoBanco.documentoSelect = { data: { id: 'doc-1', arquivo_path: 'x/doc-1.pdf' }, error: null }
    estadoBanco.erroDeleteDocumento = { message: 'lock timeout' }

    const resultado = await excluirDocumentoControle('doc-1', FAZENDA_A)

    expect(resultado.status).toBe('erro')
    if (resultado.status === 'erro') {
      expect(resultado.mensagem).toContain('lock timeout')
      expect(resultado.mensagem).toContain('itens foram removidos')
    }
    expect(chamadasDelete).toHaveLength(2)
    expect(chamadasUpdate).toEqual([{
      tabela: 'documentos_controle',
      payload: { status: 'erro', erro_mensagem: expect.stringContaining('lock timeout') },
      filtros: { id: 'doc-1', fazenda_id: FAZENDA_A },
    }])
    expect(removeStorageMock).not.toHaveBeenCalled()
  })

  it('falha ao apagar o documento E falha ao marcá-lo como erro: ainda devolve erro (só loga o follow-up, não quebra a resposta)', async () => {
    estadoBanco.documentoSelect = { data: { id: 'doc-1', arquivo_path: 'x/doc-1.pdf' }, error: null }
    estadoBanco.erroDeleteDocumento = { message: 'lock timeout' }
    estadoBanco.erroMarcarComoErro = { message: 'RLS bloqueou o update' }

    const resultado = await excluirDocumentoControle('doc-1', FAZENDA_A)

    expect(resultado.status).toBe('erro')
    expect(chamadasUpdate).toHaveLength(1)
  })

  it('falha ao remover o PDF do Storage NÃO desfaz a exclusão já confirmada no banco', async () => {
    estadoBanco.documentoSelect = { data: { id: 'doc-1', arquivo_path: 'x/doc-1.pdf' }, error: null }
    removeStorageMock.mockResolvedValueOnce({ error: { message: 'bucket indisponível' } })

    const resultado = await excluirDocumentoControle('doc-1', FAZENDA_A)

    expect(resultado).toEqual({ status: 'excluido' })
  })
})
