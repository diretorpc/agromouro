import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Banco fake com DUAS fazendas ──────────────────────────────────────────────
// O objetivo do teste é provar que a tela mostra só a fazenda ativa do usuário
// — não é uma muralha de segurança entre inquilinos (qualquer usuário logado
// pode trocar de fazenda ativa livremente, ver supabase/functions/switch-farm).
// O client Supabase usado pela API é a service key (ignora RLS sempre), então
// sem este filtro manual as duas fazendas aparecem misturadas na mesma lista.
const FAZENDA_A = 'fazenda-aaa'
const FAZENDA_B = 'fazenda-bbb'

const { estadoBanco } = vi.hoisted(() => ({
  estadoBanco: {
    estoque: [
      { id: 'est-a1', insumo_id: 'ins-a1', fazenda_id: 'fazenda-aaa', quantidade_atual: 10, quantidade_minima_alerta: 5, insumos: { nome: 'Glifosato', tipo: 'herbicida', unidade: 'L' } },
      { id: 'est-b1', insumo_id: 'ins-b1', fazenda_id: 'fazenda-bbb', quantidade_atual: 20, quantidade_minima_alerta: 5, insumos: { nome: 'Ureia', tipo: 'fertilizante', unidade: 'kg' } },
    ] as any[],
    movimentacoes: [
      { id: 'mov-a1', insumo_id: 'ins-a1', fazenda_id: 'fazenda-aaa', tipo: 'entrada', quantidade: 10, created_at: '2026-08-01' },
      { id: 'mov-b1', insumo_id: 'ins-b1', fazenda_id: 'fazenda-bbb', tipo: 'entrada', quantidade: 20, created_at: '2026-08-02' },
    ] as any[],
  },
}))

// Simula o query builder do supabase-js o suficiente para as rotas de estoque:
// select().eq().eq()...order().limit() — thenable, aplica cada .eq() como
// filtro em memória sobre a tabela "banco" correspondente.
vi.mock('../services/supabase', () => {
  function builder(tabela: 'estoque' | 'movimentacoes_estoque') {
    const filtros: Record<string, any> = {}
    const obj: any = {
      select: vi.fn(() => obj),
      order:  vi.fn(() => obj),
      limit:  vi.fn(() => obj),
      eq: vi.fn((campo: string, valor: any) => {
        filtros[campo] = valor
        return obj
      }),
      then(resolve: any) {
        const linhas = tabela === 'estoque' ? estadoBanco.estoque : estadoBanco.movimentacoes
        const filtradas = linhas.filter(l =>
          Object.entries(filtros).every(([campo, valor]) => l[campo] === valor),
        )
        return Promise.resolve(resolve({ data: filtradas, error: null }))
      },
    }
    return obj
  }
  return {
    supabase: {
      from: vi.fn((tabela: string) => builder(tabela as 'estoque' | 'movimentacoes_estoque')),
    },
  }
})

import { estoqueRoutes } from './estoque'
import { supabase } from '../services/supabase'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Helpers para invocar a rota Express diretamente ───────────────────────────
// Sem supertest/servidor HTTP: o Router expõe os handlers em .stack, então
// chamamos a função da rota como o Express chamaria, com req/res falsos.
// Consistente com o padrão já usado no repo (mock do supabase + asserts diretos),
// sem introduzir infraestrutura de teste nova.
function pegarHandler(method: 'get', path: string) {
  const layer = (estoqueRoutes as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  )
  if (!layer) throw new Error(`Rota não encontrada: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>
}

function criarReqRes(overrides: { fazendaId?: string; params?: Record<string, string> } = {}) {
  const req: any = {
    params: overrides.params ?? {},
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

describe('GET /estoque', () => {
  const handler = pegarHandler('get', '/')

  it('sem fazenda identificada no token: devolve 400 e não consulta o banco', async () => {
    const { req, res, next } = criarReqRes()
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('fazenda A só vê o estoque de fazenda A, nunca o de fazenda B', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('est-a1')
    expect(res.body.some((item: any) => item.fazenda_id === FAZENDA_B)).toBe(false)
  })

  it('fazenda B só vê o estoque de fazenda B', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_B })
    await handler(req, res, next)

    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('est-b1')
  })
})

describe('GET /estoque/:insumo_id/movimentacoes', () => {
  const handler = pegarHandler('get', '/:insumo_id/movimentacoes')

  it('sem fazenda identificada no token: devolve 400 e não consulta o banco', async () => {
    const { req, res, next } = criarReqRes({ params: { insumo_id: 'ins-a1' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('fazenda A pedindo o próprio insumo: recebe as movimentações normalmente', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { insumo_id: 'ins-a1' } })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('mov-a1')
  })

  // IDOR: fazenda A tenta ler o histórico de um insumo que pertence à fazenda B
  // passando o insumo_id dela direto na URL.
  it('IDOR: fazenda A pedindo insumo_id de fazenda B recebe lista vazia, não o dado alheio', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { insumo_id: 'ins-b1' } })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.body).toEqual([])
  })

  it('fazenda B pedindo o próprio insumo: recebe as movimentações normalmente', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_B, params: { insumo_id: 'ins-b1' } })
    await handler(req, res, next)

    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('mov-b1')
  })
})
