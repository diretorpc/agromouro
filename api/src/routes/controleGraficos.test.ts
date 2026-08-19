import { describe, it, expect, vi, beforeEach } from 'vitest'

// Service mockado — a agregação tem cobertura própria em
// agregarControle.test.ts. Aqui só o que é responsabilidade da ROTA:
// validação de query, mapeamento para HTTP e — o mais importante — a fazenda
// vindo SEMPRE do token, nunca da query.
//
// ⚠️ Este arquivo testa o HANDLER isolado, não o caminho HTTP completo.
// Rota montada no prefixo errado passa por aqui e dá 404 no navegador — foi
// o bug de 18/08/2026. O mount real é conferido em routeMounts.test.ts.
const agregarControleMock = vi.hoisted(() => vi.fn())
vi.mock('../services/controle/agregarControle', () => ({
  agregarControle: agregarControleMock,
}))

import { controleGraficosRoutes } from './controleGraficos'

const FAZENDA_A = 'fazenda-aaa'
const FAZENDA_B = 'fazenda-bbb'

const RESPOSTA = {
  porFornecedor: [{ rotulo: 'SYAGRI', total: 1406915.25, itens: 28 }],
  porProduto: [], porMes: [], precoNoTempo: [], precoPorFornecedor: [],
  meta: { totalGeral: 1406915.25, totalItens: 28 },
}

function pegarHandler(method: 'get', path: string) {
  const layer = (controleGraficosRoutes as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  )
  if (!layer) throw new Error(`Rota não encontrada: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>
}

function criarReqRes(overrides: { fazendaId?: string; query?: Record<string, any> } = {}) {
  const req: any = {
    query: overrides.query ?? {},
    params: {},
    body: {},
    user: overrides.fazendaId
      ? { app_metadata: { fazenda_ativa_id: overrides.fazendaId } }
      : undefined,
  }
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this },
    json(payload: any) { this.body = payload; return this },
  }
  const next = vi.fn()
  return { req, res, next }
}

beforeEach(() => {
  vi.clearAllMocks()
  agregarControleMock.mockReset()
  agregarControleMock.mockResolvedValue(RESPOSTA)
})

describe('GET /controle/graficos', () => {
  const handler = pegarHandler('get', '/')

  it('sem fazenda no token: 400 e NÃO chama o service', async () => {
    const { req, res, next } = criarReqRes()
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(agregarControleMock).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('com fazenda e sem filtro: 200 e devolve o payload do service', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(RESPOSTA)
    expect(next).not.toHaveBeenCalled()
  })

  it('ISOLAMENTO: a fazenda vem do TOKEN e ignora qualquer fazenda na query', async () => {
    // O ataque óbvio contra uma rota cujo filtro de tenant é um argumento:
    // mandar `?fazendaId=<outra>`. Como a API usa SERVICE_KEY (sem RLS), a
    // única defesa é esta — a query nunca pode influenciar o valor.
    const { req, res } = criarReqRes({ fazendaId: FAZENDA_A, query: { fazendaId: FAZENDA_B, fazenda_id: FAZENDA_B } })
    await handler(req, res, vi.fn())

    expect(agregarControleMock).toHaveBeenCalledTimes(1)
    expect(agregarControleMock.mock.calls[0][0]).toBe(FAZENDA_A)
  })

  it('ISOLAMENTO: token autenticado SEM fazenda + ?fazendaId na query = 400, nunca fallback', async () => {
    // Achado 3 da revisão do Apolo (19/08/2026), provado por mutação: os dois
    // testes de isolamento acima cobrem as PONTAS (sem token / com token
    // válido) e deixavam a interseção descoberta. Um `fazendaDe` escrito como
    //   `req.user?.app_metadata?.fazenda_ativa_id ?? req.query?.fazendaId`
    // passava nos 9 testes.
    //
    // O cenário não é teórico: usuário autenticado cujo `fazenda_ativa_id`
    // ainda não propagou (convite novo, troca de fazenda em voo). requireAuth
    // deixa passar, o fallback assume o valor da URL, e a API usa SERVICE_KEY
    // sem RLS — leitura completa da fazenda alheia, HTTP 200, nenhum log.
    const { req, res } = criarReqRes({ query: { fazendaId: FAZENDA_B } })
    req.user = { app_metadata: {} }   // autenticado, mas sem fazenda ativa
    await handler(req, res, vi.fn())

    expect(res.statusCode).toBe(400)
    expect(agregarControleMock).not.toHaveBeenCalled()
  })

  it('repassa fornecedor/status/período/top já normalizados para o service', async () => {
    const { req, res } = criarReqRes({
      fazendaId: FAZENDA_A,
      query: {
        fornecedor: ['SYAGRI', 'MOSAIC'], status: 'processado',
        dataInicio: '2026-01-01', dataFim: '2026-07-31', top: '5',
      },
    })
    await handler(req, res, vi.fn())

    const filtro = agregarControleMock.mock.calls[0][1]
    expect(filtro.fornecedor).toEqual(['SYAGRI', 'MOSAIC'])
    // String única vira array de um — mesma transformação de
    // `listarItensSchema`, senão o gráfico e a grade divergem no mesmo filtro.
    expect(filtro.status).toEqual(['processado'])
    expect(filtro.dataInicio).toBe('2026-01-01')
    expect(filtro.dataFim).toBe('2026-07-31')
    expect(filtro.top).toBe(5)
  })

  it('sem filtro nenhum: arrays vazios, não undefined', async () => {
    const { req, res } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, vi.fn())

    const filtro = agregarControleMock.mock.calls[0][1]
    expect(filtro.fornecedor).toEqual([])
    expect(filtro.status).toEqual([])
  })

  it('data em formato inválido: 400, sem tocar no service', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { dataInicio: '01/01/2026' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(agregarControleMock).not.toHaveBeenCalled()
  })

  it('top fora da faixa: 400 — teto existe pra não devolver 300 séries', async () => {
    const { req, res } = criarReqRes({ fazendaId: FAZENDA_A, query: { top: '500' } })
    await handler(req, res, vi.fn())

    expect(res.statusCode).toBe(400)
    expect(agregarControleMock).not.toHaveBeenCalled()
  })

  it('top zero ou negativo: 400', async () => {
    for (const top of ['0', '-3']) {
      agregarControleMock.mockClear()
      const { req, res } = criarReqRes({ fazendaId: FAZENDA_A, query: { top } })
      await handler(req, res, vi.fn())
      expect(res.statusCode).toBe(400)
      expect(agregarControleMock).not.toHaveBeenCalled()
    }
  })

  it('erro do service vai para o errorHandler (next), não vira 200 vazio', async () => {
    // Migration 020 não aplicada devolve erro aqui. Responder 200 com listas
    // vazias faria a tela dizer "sem dados" — mentira que esconde deploy
    // faltando.
    agregarControleMock.mockRejectedValue(new Error('function controle_graficos does not exist'))
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.body).toBeUndefined()
  })
})
