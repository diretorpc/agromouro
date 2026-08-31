import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Por que este arquivo existe ──────────────────────────────────────────────
// O backend usa a service key e IGNORA o RLS (memória `backend-service-key-
// ignora-rls`): o `.eq('fazenda_id', ...)` escrito na query é a barreira
// INTEIRA entre a MG e a Tejuco. O Apolo removeu essa linha de
// `buscarNotaDaFazenda` e os 763 testes do projeto passaram — o teste que
// deveria pegar mockava a função toda, provando o `if` e não o filtro.
//
// Aqui o Supabase é simulado no nível do BUILDER, então cada `.eq` fica
// registrado e dá para afirmar sobre ele.

const { chamadas, dados, erros } = vi.hoisted(() => ({
  erros: {} as Record<string, string | null>,
  chamadas: [] as { tabela: string; eq: [string, any][]; is: [string, any][]; not: string[] }[],
  dados: {
    notas_fiscais: [] as any[],
    contas_a_pagar: [] as any[],
    lancamentos_financeiros: [] as any[],
  } as Record<string, any[]>,
}))

vi.mock('../supabase', () => {
  function builder(tabela: string) {
    const registro = { tabela, eq: [] as [string, any][], is: [] as [string, any][], not: [] as string[] }
    chamadas.push(registro)
    let updatePatch: any = null
    const obj: any = {
      select: () => obj,
      update: (p: any) => { updatePatch = p; return obj },
      eq: (campo: string, valor: any) => { registro.eq.push([campo, valor]); return obj },
      is: (campo: string, valor: any) => { registro.is.push([campo, valor]); return obj },
      not: (campo: string) => { registro.not.push(campo); return obj },
      in: () => obj,
      order: () => obj,
      limit: () => obj,
      maybeSingle: async () => (erros[tabela]
        ? { data: null, error: { message: erros[tabela] } }
        : { data: dados[tabela]?.[0] ?? null, error: null }),
      then: (resolve: any) => {
        if (erros[tabela]) return Promise.resolve(resolve({ data: null, error: { message: erros[tabela] } }))
        const linhas = dados[tabela] ?? []
        if (updatePatch) linhas.forEach(l => Object.assign(l, updatePatch))
        return Promise.resolve(resolve({ data: linhas, error: null }))
      },
    }
    return obj
  }
  return { supabase: { from: (t: string) => builder(t) } }
})

import {
  adotarContaNaNota, buscarContasSoltas, buscarNotaDaFazenda, buscarNotasCandidatas,
} from './notasCandidatas'

const FAZENDA = 'faz-mg'

/** Todo `.eq('fazenda_id', ...)` visto nesta rodada, por tabela. */
function filtrouFazenda(tabela: string): boolean {
  const daTabela = chamadas.filter(c => c.tabela === tabela)
  return daTabela.length > 0 && daTabela.every(c => c.eq.some(([campo, v]) => campo === 'fazenda_id' && v === FAZENDA))
}

beforeEach(() => {
  chamadas.length = 0
  for (const k of Object.keys(erros)) delete erros[k]
  dados.notas_fiscais = [
    { id: 'nf-1', numero: '4507', emitente_nome: 'MIKAMI', valor_total: 37644, data_emissao: '2026-07-31' },
  ]
  dados.contas_a_pagar = [
    { id: 'c-1', nota_fiscal_id: 'nf-1', valor: 37644, vencimento: '2026-11-03', status: 'aberta' },
  ]
  dados.lancamentos_financeiros = [{ nota_fiscal_id: 'nf-1' }]
})

describe('buscarNotasCandidatas', () => {
  it('filtra por fazenda nas TRÊS tabelas que consulta', async () => {
    await buscarNotasCandidatas(FAZENDA)
    expect(filtrouFazenda('notas_fiscais')).toBe(true)
    expect(filtrouFazenda('contas_a_pagar')).toBe(true)
    expect(filtrouFazenda('lancamentos_financeiros')).toBe(true)
  })

  it('traz as contas da nota e marca que ela lançou gasto', async () => {
    const [nota] = await buscarNotasCandidatas(FAZENDA)
    expect(nota.id).toBe('nf-1')
    expect(nota.lancouGasto).toBe(true)
    expect(nota.contas).toEqual([{ id: 'c-1', valor: 37644, vencimento: '2026-11-03', status: 'aberta' }])
  })

  it('marca lancouGasto FALSO quando não há lançamento da nota', async () => {
    dados.lancamentos_financeiros = []
    const [nota] = await buscarNotasCandidatas(FAZENDA)
    expect(nota.lancouGasto).toBe(false)
  })

  // Varre as contas/lançamentos da fazenda em vez de perguntar por uma lista de
  // ids: `.in()` com 500 uuids monta URL de ~19 KB e gateway com buffer padrão
  // de 8 KB recusaria (achado 7 do Apolo).
  it('não usa .in() com lista de ids — pede só o que é da fazenda', async () => {
    await buscarNotasCandidatas(FAZENDA)
    const contas = chamadas.find(c => c.tabela === 'contas_a_pagar')!
    expect(contas.not).toContain('nota_fiscal_id')
  })
})

describe('buscarNotaDaFazenda', () => {
  it('filtra por id E por fazenda — o RLS não faz isso por nós', async () => {
    await buscarNotaDaFazenda('nf-1', FAZENDA)
    const nota = chamadas.find(c => c.tabela === 'notas_fiscais')!
    expect(nota.eq).toEqual(expect.arrayContaining([['id', 'nf-1'], ['fazenda_id', FAZENDA]]))
  })

  it('devolve null quando a nota não é da fazenda', async () => {
    dados.notas_fiscais = []
    expect(await buscarNotaDaFazenda('nf-de-outra', FAZENDA)).toBeNull()
  })
})

describe('buscarContasSoltas', () => {
  it('procura só conta SEM nota, na fazenda certa, com valor e vencimento exatos', async () => {
    await buscarContasSoltas(37644, '2026-11-03', FAZENDA)
    const c = chamadas.find(x => x.tabela === 'contas_a_pagar')!
    expect(c.eq).toEqual(expect.arrayContaining([
      ['fazenda_id', FAZENDA], ['vencimento', '2026-11-03'], ['valor', 37644],
    ]))
    expect(c.is).toEqual(expect.arrayContaining([['nota_fiscal_id', null]]))
  })
})

describe('adotarContaNaNota', () => {
  it('só amarra conta que ainda está solta, e só na fazenda certa', async () => {
    const ok = await adotarContaNaNota('c-1', 'nf-1', FAZENDA)
    expect(ok).toBe(true)
    const c = chamadas.find(x => x.tabela === 'contas_a_pagar')!
    expect(c.eq).toEqual(expect.arrayContaining([['id', 'c-1'], ['fazenda_id', FAZENDA]]))
    // `IS NULL` no próprio UPDATE: se outra aba amarrou primeiro, nenhuma linha
    // é tocada e a decisão dela é preservada.
    expect(c.is).toEqual(expect.arrayContaining([['nota_fiscal_id', null]]))
  })

  it('devolve false quando nenhuma linha foi tocada', async () => {
    dados.contas_a_pagar = []
    expect(await adotarContaNaNota('c-1', 'nf-1', FAZENDA)).toBe(false)
  })
})

// ACHADO 4 da rodada 2: o comentário promete que erro de banco NUNCA vira
// "nenhuma tem conta" nem "nenhuma lançou" — e trocar os dois `throw` por
// retorno vazio passava nos 799 testes. Com o erro engolido, um Supabase
// instável por 30 s faria `lancouGasto = false` em todas as notas, a tela
// mandaria o dono usar "Nenhuma", e o gasto contaria duas vezes. O modo de
// falha apontava para dinheiro errado, e a garantia era só um comentário.
describe('erro de banco não vira resposta vazia', () => {
  it('estoura quando a consulta de contas falha', async () => {
    erros.contas_a_pagar = 'conexão perdida'
    await expect(buscarNotasCandidatas(FAZENDA)).rejects.toThrow(/contas da fazenda/)
  })

  it('estoura quando a consulta de lançamentos falha', async () => {
    erros.lancamentos_financeiros = 'conexão perdida'
    await expect(buscarNotasCandidatas(FAZENDA)).rejects.toThrow(/lançamentos da fazenda/)
  })

  it('estoura quando a consulta de notas falha', async () => {
    erros.notas_fiscais = 'conexão perdida'
    await expect(buscarNotasCandidatas(FAZENDA)).rejects.toThrow(/buscar notas/)
  })

  it('estoura ao procurar conta solta', async () => {
    erros.contas_a_pagar = 'conexão perdida'
    await expect(buscarContasSoltas(1, '2026-11-03', FAZENDA)).rejects.toThrow(/conta solta/)
  })

  it('estoura ao amarrar a conta', async () => {
    erros.contas_a_pagar = 'conexão perdida'
    await expect(adotarContaNaNota('c-1', 'nf-1', FAZENDA)).rejects.toThrow(/amarrar/)
  })
})
