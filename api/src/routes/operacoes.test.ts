import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Trava de área arrendada no POST /operacoes ────────────────────────────────
// A spec chama o filtro do seletor web de "a trava que impede lançar operação e
// gasto em terra operada por terceiro" (Usina Uberaba). Mas o POST /operacoes é
// uma das três portas que inserem linha em `operacoes` e não tinha guarda
// nenhuma — qualquer cliente da API (não só o seletor web) podia lançar
// operação num talhão arrendado. Este teste trava que o backend recusa,
// não só a tela.

const TALHAO_ATIVO     = '11111111-1111-1111-1111-111111111111'
const TALHAO_ARRENDADO = '22222222-2222-2222-2222-222222222222'
const TALHAO_FANTASMA  = '33333333-3333-3333-3333-333333333333'

const { estadoBanco } = vi.hoisted(() => ({
  estadoBanco: {
    talhoes: [
      { id: '11111111-1111-1111-1111-111111111111', status: 'ativo' },
      { id: '22222222-2222-2222-2222-222222222222', status: 'arrendado' },
    ] as any[],
    operacoes: [] as any[],
  },
}))

// Simula supabase-js o suficiente para o POST /operacoes:
// - talhoes:   select().eq('id', ...).single()
// - operacoes: insert(body).select().single()
vi.mock('../services/supabase', () => {
  function talhoesBuilder() {
    const filtros: Record<string, any> = {}
    const obj: any = {
      select: vi.fn(() => obj),
      eq: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      single: vi.fn(async () => {
        const encontrada = estadoBanco.talhoes.find(t =>
          Object.entries(filtros).every(([campo, valor]) => t[campo] === valor),
        )
        return encontrada
          ? { data: encontrada, error: null }
          : { data: null, error: { message: 'not found' } }
      }),
    }
    return obj
  }

  function operacoesBuilder() {
    let pendingInsert: Record<string, any> | null = null
    const obj: any = {
      insert: vi.fn((body: Record<string, any>) => { pendingInsert = body; return obj }),
      select: vi.fn(() => obj),
      single: vi.fn(async () => {
        const linha = { id: 'op-nova', ...pendingInsert }
        estadoBanco.operacoes.push(linha)
        return { data: linha, error: null }
      }),
    }
    return obj
  }

  return {
    supabase: {
      from: vi.fn((tabela: string) => (tabela === 'talhoes' ? talhoesBuilder() : operacoesBuilder())),
    },
  }
})

import { operacaoRoutes } from './operacoes'

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.operacoes = []
})

function pegarHandler(method: 'post', path: string) {
  const layer = (operacaoRoutes as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  )
  if (!layer) throw new Error(`Rota não encontrada: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>
}

function criarReqRes(body: Record<string, any>) {
  const req: any = { body }
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this },
    json(payload: any) { this.body = payload; return this },
  }
  const next = vi.fn()
  return { req, res, next }
}

describe('POST /operacoes', () => {
  const handler = pegarHandler('post', '/')

  const bodyBase = {
    tipo:      'pulverizacao',
    data:      '2026-08-24',
    descricao: 'Pulverização de teste',
  }

  it('talhão arrendado: recusa com mensagem em português e não insere operação', async () => {
    const { req, res, next } = criarReqRes({ ...bodyBase, talhao_id: TALHAO_ARRENDADO })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/arrendad/i)
    expect(estadoBanco.operacoes).toHaveLength(0)
    expect(next).not.toHaveBeenCalled()
  })

  it('talhão em operação normal: aceita e grava a operação', async () => {
    const { req, res, next } = criarReqRes({ ...bodyBase, talhao_id: TALHAO_ATIVO })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(201)
    expect(estadoBanco.operacoes).toHaveLength(1)
    expect(estadoBanco.operacoes[0].talhao_id).toBe(TALHAO_ATIVO)
  })

  it('talhão inexistente: devolve 400 e não insere operação', async () => {
    const { req, res, next } = criarReqRes({ ...bodyBase, talhao_id: TALHAO_FANTASMA })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(estadoBanco.operacoes).toHaveLength(0)
  })
})
