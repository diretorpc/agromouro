import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Serviços de item mockados ──────────────────────────────────────────────
// Mesmo padrão de controle.test.ts: cada service tem cobertura própria
// (listarItensControle.test.ts, editarItemControle.test.ts,
// criarItemControleAvulso.test.ts, excluirItemControle.test.ts) — aqui só o
// mapeamento status→HTTP + isolamento por fazenda (fazendaId sempre vem do
// auth, nunca do corpo/params).
const listarItensControleMock = vi.hoisted(() => vi.fn())
vi.mock('../services/controle/listarItensControle', () => ({
  listarItensControle: listarItensControleMock,
}))

const editarItemControleMock = vi.hoisted(() => vi.fn())
vi.mock('../services/controle/editarItemControle', () => ({
  editarItemControle: editarItemControleMock,
}))

const criarItemControleAvulsoMock = vi.hoisted(() => vi.fn())
vi.mock('../services/controle/criarItemControleAvulso', () => ({
  criarItemControleAvulso: criarItemControleAvulsoMock,
}))

const excluirItemControleMock = vi.hoisted(() => vi.fn())
vi.mock('../services/controle/excluirItemControle', () => ({
  excluirItemControle: excluirItemControleMock,
}))

import { controleItensRoutes } from './controleItens'

const FAZENDA_A = 'fazenda-aaa'
const FAZENDA_B = 'fazenda-bbb'

// ─── Helpers para invocar a rota Express diretamente ───────────────────────
// Sem supertest/servidor HTTP — mesmo padrão de controle.test.ts. IMPORTANTE:
// isto testa o HANDLER isolado, não o caminho HTTP completo (mount +
// prefixo) — é exatamente esse buraco que deixou passar o bug de 18/08/2026
// (rota existia, mas no lugar errado: `/controle/documentos/itens` em vez de
// `/controle/itens`). O caminho completo é conferido à parte, em
// routeMounts.test.ts — leia aquele arquivo primeiro se estiver mexendo em
// mount de rota de novo.
function pegarHandler(method: 'get' | 'post' | 'delete' | 'patch', path: string) {
  const layer = (controleItensRoutes as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  )
  if (!layer) throw new Error(`Rota não encontrada: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>
}

function criarReqRes(overrides: { fazendaId?: string; body?: any; params?: Record<string, string>; query?: Record<string, any> } = {}) {
  const req: any = {
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    user: overrides.fazendaId
      ? { app_metadata: { fazenda_ativa_id: overrides.fazendaId } }
      : undefined,
  }
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    sent: false,
    status(code: number) { this.statusCode = code; return this },
    json(payload: any) { this.body = payload; return this },
    send(payload?: any) { this.sent = true; this.body = payload; return this },
  }
  const next = vi.fn()
  return { req, res, next }
}

beforeEach(() => {
  vi.clearAllMocks()
  listarItensControleMock.mockReset()
  editarItemControleMock.mockReset()
  criarItemControleAvulsoMock.mockReset()
  excluirItemControleMock.mockReset()
})

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /controle/itens (router raiz — mount real conferido em routeMounts.test.ts)', () => {
  const handler = pegarHandler('get', '/')

  it('sem fazenda identificada no token: 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes()
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
    expect(listarItensControleMock).not.toHaveBeenCalled()
  })

  it('parâmetro de paginação inválido: 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { pagina: 'abc' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(listarItensControleMock).not.toHaveBeenCalled()
  })

  it('porPagina acima do teto (1000): 400', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { porPagina: '5000' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
  })

  it('sucesso: devolve o resultado do service com o default de porPagina=500', async () => {
    const resultado = { itens: [{ id: 'item-1' }], paginaAtual: 1, totalPaginas: 1, totalItens: 1 }
    listarItensControleMock.mockResolvedValue(resultado)
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(resultado)
    expect(listarItensControleMock).toHaveBeenCalledWith(FAZENDA_A, expect.objectContaining({ pagina: 1, porPagina: 500 }))
  })

  it('erro do service: propagado pro errorHandler (next), não vira 200 mudo', async () => {
    listarItensControleMock.mockRejectedValue(new Error('timeout de conexão'))
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    expect(next).toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /controle/itens (router raiz)', () => {
  const handler = pegarHandler('post', '/')
  const corpoValido = {
    descricao: 'ADUBO AVULSO', valor_total: 1500, quantidade: 10, unidade: 'SC',
    valor_unitario: 150, data_manual: '2026-08-18', fornecedor: 'FORNECEDOR X', numero_documento: null,
  }

  it('sem fazenda identificada no token: 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(criarItemControleAvulsoMock).not.toHaveBeenCalled()
  })

  it('corpo inválido (sem descricao/valor_total): 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: {} })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(criarItemControleAvulsoMock).not.toHaveBeenCalled()
  })

  it('sucesso: 201 com o item criado', async () => {
    const criado = { id: 'item-novo', ...corpoValido }
    criarItemControleAvulsoMock.mockResolvedValue({ status: 'criado', item: criado })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual(criado)
  })

  // TRAVA DE DINHEIRO no nível da ROTA: mesmo que o corpo mande
  // conta_como_compra, o schema zod (fora do objeto de campos aceitos) o
  // descarta antes de chegar no service — a segunda camada (o service
  // sempre cravar false no INSERT) já está provada em
  // criarItemControleAvulso.test.ts.
  it('conta_como_compra no corpo é descartado pelo schema antes de chegar no service', async () => {
    criarItemControleAvulsoMock.mockResolvedValue({ status: 'criado', item: { id: 'item-novo' } })
    const { req, res, next } = criarReqRes({
      fazendaId: FAZENDA_A,
      body: { ...corpoValido, conta_como_compra: true },
    })
    await handler(req, res, next)

    expect(res.statusCode).toBe(201)
    const chamadaComQueFoiFeita = criarItemControleAvulsoMock.mock.calls[0][0]
    expect(chamadaComQueFoiFeita).not.toHaveProperty('conta_como_compra')
  })

  it('fazenda_id no corpo é IGNORADO — o service sempre recebe a fazenda do auth', async () => {
    criarItemControleAvulsoMock.mockResolvedValue({ status: 'criado', item: { id: 'item-novo' } })
    const { req, res, next } = criarReqRes({
      fazendaId: FAZENDA_A,
      body: { ...corpoValido, fazenda_id: FAZENDA_B },
    })
    await handler(req, res, next)

    expect(res.statusCode).toBe(201)
    expect(criarItemControleAvulsoMock).toHaveBeenCalledWith(expect.anything(), FAZENDA_A)
  })

  it('erro do service: 500 com detalhe', async () => {
    criarItemControleAvulsoMock.mockResolvedValue({ status: 'erro', mensagem: 'RLS bloqueou' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ detalhe: 'RLS bloqueou' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('PATCH /controle/itens/:id (router raiz)', () => {
  const handler = pegarHandler('patch', '/:id')

  it('sem fazenda identificada no token: 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ params: { id: 'item-1' }, body: { descricao: 'x' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(editarItemControleMock).not.toHaveBeenCalled()
  })

  it('corpo vazio (nenhum campo para editar): 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-1' }, body: {} })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(editarItemControleMock).not.toHaveBeenCalled()
  })

  it('sucesso: 200 com o item editado', async () => {
    const editado = { id: 'item-1', descricao: 'NOVO' }
    editarItemControleMock.mockResolvedValue({ status: 'editado', item: editado })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-1' }, body: { descricao: 'NOVO' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(editado)
  })

  it('conta_como_compra no corpo é descartado pelo schema antes de chegar no service', async () => {
    editarItemControleMock.mockResolvedValue({ status: 'editado', item: { id: 'item-1' } })
    const { req, res, next } = criarReqRes({
      fazendaId: FAZENDA_A, params: { id: 'item-1' }, body: { descricao: 'x', conta_como_compra: true },
    })
    await handler(req, res, next)

    const patchQueFoiEnviado = editarItemControleMock.mock.calls[0][2]
    expect(patchQueFoiEnviado).not.toHaveProperty('conta_como_compra')
  })

  it('item não encontrado (id errado, outra fazenda, ou é de NF-e): 404', async () => {
    editarItemControleMock.mockResolvedValue({ status: 'nao_encontrado' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-x' }, body: { descricao: 'x' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(404)
    expect(editarItemControleMock).toHaveBeenCalledWith('item-x', FAZENDA_A, expect.anything())
  })

  it('conflito de unicidade: 409, não 500 cru', async () => {
    editarItemControleMock.mockResolvedValue({ status: 'conflito' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-1' }, body: { valor_total: 100 } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(409)
  })

  // Achado 8 da revisão do Apolo: apagar a Data de um item de PDF batia na
  // constraint do banco e virava 500 cru — agora o service recusa antes,
  // e a rota mapeia pra 400 com mensagem em português.
  it('data_obrigatoria (item de PDF sem data): 400, não 500 cru', async () => {
    editarItemControleMock.mockResolvedValue({ status: 'data_obrigatoria' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-1' }, body: { data_manual: null } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(typeof res.body.error).toBe('string')
    expect(res.body.error.length).toBeGreaterThan(0)
  })

  it('erro do service: 500 com detalhe', async () => {
    editarItemControleMock.mockResolvedValue({ status: 'erro', mensagem: 'connection reset' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-1' }, body: { descricao: 'x' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ detalhe: 'connection reset' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('DELETE /controle/itens/:id (router raiz)', () => {
  const handler = pegarHandler('delete', '/:id')

  it('sem fazenda identificada no token: 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ params: { id: 'item-1' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(excluirItemControleMock).not.toHaveBeenCalled()
  })

  it('item não encontrado: 404', async () => {
    excluirItemControleMock.mockResolvedValue({ status: 'nao_encontrado' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-x' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(404)
    expect(excluirItemControleMock).toHaveBeenCalledWith('item-x', FAZENDA_A)
  })

  it('sucesso: 204 sem corpo', async () => {
    excluirItemControleMock.mockResolvedValue({ status: 'excluido' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-1' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(204)
    expect(res.sent).toBe(true)
  })

  it('erro do service: 500 com detalhe', async () => {
    excluirItemControleMock.mockResolvedValue({ status: 'erro', mensagem: 'lock timeout' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'item-1' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ detalhe: 'lock timeout' })
  })
})
