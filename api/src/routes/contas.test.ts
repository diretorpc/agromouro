import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Cobre o achado CRÍTICO do Apolo (18/08/2026) ──────────────────────────────
// O dialog de "Editar conta" (Matheus, 18/08/2026) reenvia SEMPRE o campo `valor`
// pré-preenchido, mesmo quando o dono só queria corrigir a categoria de uma conta
// JÁ PAGA. A regra antiga de PATCH /:id ("informar valor confirma a conta") reabria
// a conta (status volta pra 'aberta') sem o dono pedir isso — ela reentra no aviso
// de atraso do WhatsApp e, se for paga de novo, nasce um segundo lançamento no
// Financeiro (gasto duplicado). Estes testes travam a correção: conta paga ou
// dispensada NUNCA muda de status por uma edição de cadastro.

const { estadoBanco } = vi.hoisted(() => ({
  estadoBanco: {
    contas_a_pagar: [] as any[],
  },
}))

// Simula supabase-js o suficiente para PATCH /:id: select().eq().eq().maybeSingle()
// (busca do estado atual) e update().eq().eq().select() (grava e devolve a linha).
// Mesmo padrão de mock já usado em routes/estoque.test.ts — sem infraestrutura nova.
vi.mock('../services/supabase', () => {
  function builder(tabela: 'contas_a_pagar') {
    const filtros: Record<string, any> = {}
    let pendingUpdate: Record<string, any> | null = null
    const linhas = () => estadoBanco[tabela]
    const aplicaFiltro = () => linhas().filter(l =>
      Object.entries(filtros).every(([campo, valor]) => l[campo] === valor),
    )
    const obj: any = {
      select: vi.fn(() => obj),
      eq: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      update: vi.fn((patch: Record<string, any>) => { pendingUpdate = patch; return obj }),
      maybeSingle: vi.fn(async () => {
        const encontradas = aplicaFiltro()
        return { data: encontradas[0] ?? null, error: null }
      }),
      then(resolve: any) {
        const encontradas = aplicaFiltro()
        if (pendingUpdate) encontradas.forEach(l => Object.assign(l, pendingUpdate))
        return Promise.resolve(resolve({ data: encontradas, error: null }))
      },
    }
    return obj
  }
  return {
    supabase: { from: vi.fn((tabela: string) => builder(tabela as 'contas_a_pagar')) },
  }
})

import { contaRoutes } from './contas'

const FAZENDA = 'fazenda-teste'

function pegarHandler(method: 'patch', path: string) {
  const layer = (contaRoutes as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  )
  if (!layer) throw new Error(`Rota não encontrada: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>
}

function criarReqRes(id: string, body: Record<string, any>) {
  const req: any = {
    params: { id },
    body,
    user: { app_metadata: { fazenda_ativa_id: FAZENDA } },
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
  estadoBanco.contas_a_pagar = [
    {
      id: 'conta-paga-1', fazenda_id: FAZENDA, status: 'paga', valor: 912.35,
      valor_estimado: false, categoria: 'insumos', descricao: 'Boleto', fornecedor: 'UBE',
      nota_fiscal_id: null, vencimento: '2026-08-10',
    },
    {
      id: 'conta-estimativa-1', fazenda_id: FAZENDA, status: 'aguardando', valor: 800,
      valor_estimado: true, categoria: 'combustivel', descricao: 'Conta fixa', fornecedor: null,
      nota_fiscal_id: null, vencimento: '2026-08-20',
    },
  ]
})

describe('PATCH /contas/:id — conta já paga não pode reabrir', () => {
  const handler = pegarHandler('patch', '/:id')

  it('corrigir só a categoria (dialog reenvia o mesmo valor): status continua paga', async () => {
    const { req, res, next } = criarReqRes('conta-paga-1', { categoria: 'combustivel', valor: 912.35 })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.body.status).toBe('paga')
    expect(res.body.valor_estimado).toBe(false)
    expect(res.body.categoria).toBe('combustivel')
  })

  it('editar o valor de uma conta paga (correção de digitação): status continua paga, não reabre', async () => {
    const { req, res, next } = criarReqRes('conta-paga-1', { valor: 950 })
    await handler(req, res, next)

    expect(res.body.status).toBe('paga')
    expect(res.body.valor).toBe(950)
  })

  it('conta dispensada também não reabre ao editar', async () => {
    estadoBanco.contas_a_pagar.push({
      id: 'conta-disp-1', fazenda_id: FAZENDA, status: 'dispensada', valor: 100,
      valor_estimado: false, categoria: 'outro', descricao: 'x', fornecedor: null,
      nota_fiscal_id: null, vencimento: null,
    })
    const { req, res } = criarReqRes('conta-disp-1', { valor: 150, descricao: 'x corrigido' })
    await handler(req, res, vi.fn())

    expect(res.body.status).toBe('dispensada')
  })
})

describe('PATCH /contas/:id — comportamento preservado pra conta aberta/estimativa', () => {
  const handler = pegarHandler('patch', '/:id')

  it('"Registrar valor real": valor diferente confirma a estimativa (vira aberta, deixa de ser estimado)', async () => {
    const { req, res } = criarReqRes('conta-estimativa-1', { valor: 845.9 })
    await handler(req, res, vi.fn())

    expect(res.body.status).toBe('aberta')
    expect(res.body.valor_estimado).toBe(false)
    expect(res.body.valor).toBe(845.9)
  })

  it('editar só a categoria de uma conta com estimativa (valor pré-preenchido igual): continua estimativa', async () => {
    const { req, res } = criarReqRes('conta-estimativa-1', { categoria: 'peca_maquina', valor: 800 })
    await handler(req, res, vi.fn())

    expect(res.body.status).toBe('aguardando')
    expect(res.body.valor_estimado).toBe(true)
    expect(res.body.categoria).toBe('peca_maquina')
  })

  it('editar descrição/fornecedor sem mexer no valor: não altera status nem estimativa', async () => {
    const { req, res } = criarReqRes('conta-estimativa-1', { descricao: 'Conta fixa — corrigida', fornecedor: 'CEMIG' })
    await handler(req, res, vi.fn())

    expect(res.body.status).toBe('aguardando')
    expect(res.body.valor_estimado).toBe(true)
    expect(res.body.descricao).toBe('Conta fixa — corrigida')
    expect(res.body.fornecedor).toBe('CEMIG')
  })
})
