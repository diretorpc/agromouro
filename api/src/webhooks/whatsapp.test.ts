import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Isolamento por fazenda no canal WhatsApp ─────────────────────────────────
// O cliente supabase de services/supabase.ts autentica com SUPABASE_SERVICE_KEY,
// que bypassa RLS por completo (as policies *_tenant dependem de auth.uid(), que
// não existe no backend). O ÚNICO isolamento entre fazendas aqui é o filtro
// .eq('fazenda_id', ...) escrito à mão em cada query — por isso cada função abaixo
// é exportada e testada isoladamente, sem depender do fluxo completo (que exigiria
// mockar a API da Anthropic).
//
// Inclui também a trava de área arrendada (PR #66): buscarTalhao nunca devolve
// um talhão com status='arrendado', mesmo quando o nome bate melhor que os ativos.

const { seed, estadoBanco } = vi.hoisted(() => {
  const seed = {
    talhoes: [
      { id: 'talhao-gogo-1', nome: 'Gogo I', area_ha: 50, status: 'ativo', fazenda_id: 'fazenda-mg' },
      { id: 'talhao-gogo-usina', nome: 'Gogo Usina', area_ha: 80, status: 'arrendado', fazenda_id: 'fazenda-mg' },
      { id: 'talhao-mt-gogo-1', nome: 'Gogo I', area_ha: 30, status: 'ativo', fazenda_id: 'fazenda-mt' },
    ] as any[],
    insumos: [
      { id: 'insumo-glifosato-mg', nome: 'Glifosato', unidade: 'L', fazenda_id: 'fazenda-mg', estoque: [{ id: 'linha-estoque-mg' }] },
      { id: 'insumo-glifosato-mt', nome: 'Glifosato', unidade: 'L', fazenda_id: 'fazenda-mt', estoque: [{ id: 'linha-estoque-mt' }] },
    ] as any[],
    estoque: [
      { insumo_id: 'insumo-glifosato-mg', fazenda_id: 'fazenda-mg', quantidade_atual: 300, quantidade_minima_alerta: 20 },
      { insumo_id: 'insumo-glifosato-mt', fazenda_id: 'fazenda-mt', quantidade_atual: 50, quantidade_minima_alerta: 5 },
    ] as any[],
  }
  return { seed, estadoBanco: JSON.parse(JSON.stringify(seed)) }
})

// Simula supabase-js o suficiente para as funções exportadas de whatsapp.ts:
// select/eq/neq/ilike/in/limit (todas encadeáveis) + single() (execução explícita)
// + thenable (execução implícita via await, quando o código não chama .single()).
vi.mock('../services/supabase', () => {
  function tabelaBuilder(tabela: string) {
    const eqFiltros: Array<[string, any]> = []
    const neqFiltros: Array<[string, any]> = []
    const inFiltros: Array<[string, any[]]> = []
    let ilikeCampo: string | undefined
    let ilikeValor: string | undefined
    let limitN: number | undefined

    const linhasBase = (): any[] => (estadoBanco as any)[tabela] ?? []

    const aplicaFiltros = (linhas: any[]): any[] =>
      linhas.filter((row: any) =>
        eqFiltros.every(([c, v]) => row[c] === v)
        && neqFiltros.every(([c, v]) => row[c] !== v)
        && inFiltros.every(([c, arr]) => arr.includes(row[c]))
        && (!ilikeValor || String(row[ilikeCampo!] ?? '').toLowerCase().includes(ilikeValor)),
      )

    const executaSelect = (): any[] => {
      let linhas = aplicaFiltros(linhasBase())
      if (limitN != null) linhas = linhas.slice(0, limitN)
      return linhas
    }

    const obj: any = {
      select: vi.fn(() => obj),
      eq:     vi.fn((campo: string, valor: any) => { eqFiltros.push([campo, valor]); return obj }),
      neq:    vi.fn((campo: string, valor: any) => { neqFiltros.push([campo, valor]); return obj }),
      in:     vi.fn((campo: string, valores: any[]) => { inFiltros.push([campo, valores]); return obj }),
      ilike:  vi.fn((campo: string, padrao: string) => {
        ilikeCampo = campo
        ilikeValor = padrao.replace(/%/g, '').toLowerCase()
        return obj
      }),
      limit:  vi.fn((n: number) => { limitN = n; return obj }),
      single: vi.fn(async () => {
        const linhas = executaSelect()
        return linhas.length > 0
          ? { data: linhas[0], error: null }
          : { data: null, error: { message: 'not found' } }
      }),
      // thenable: cobre os caminhos que fazem `await` direto na cadeia sem .single()
      then: (resolve: any, reject: any) => {
        return Promise.resolve({ data: executaSelect(), error: null }).then(resolve, reject)
      },
    }
    return obj
  }

  return {
    supabase: { from: vi.fn((tabela: string) => tabelaBuilder(tabela)) },
  }
})

import { buscarTalhao, buscarInsumo, consultarEstoque } from './whatsapp'

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.talhoes = JSON.parse(JSON.stringify(seed.talhoes))
  estadoBanco.insumos = JSON.parse(JSON.stringify(seed.insumos))
  estadoBanco.estoque = JSON.parse(JSON.stringify(seed.estoque))
})

describe('buscarTalhao', () => {
  it('acha talhão em operação normal pelo nome', async () => {
    const talhao = await buscarTalhao('Gogo I', 'fazenda-mg')
    expect(talhao?.id).toBe('talhao-gogo-1')
  })

  it('NUNCA devolve talhão arrendado, mesmo quando o nome bate melhor', async () => {
    // "Gogo Usina" contém "gogo" e casaria pelo ilike frouxo — a trava tem que
    // excluir esse talhão antes do match de nome, não depois.
    const talhao = await buscarTalhao('Gogo Usina', 'fazenda-mg')
    expect(talhao).toBeNull()
  })

  it('talhão arrendado não aparece nem como match parcial de "gogo"', async () => {
    const talhao = await buscarTalhao('gogo', 'fazenda-mg')
    expect(talhao?.id).toBe('talhao-gogo-1')
    expect(talhao?.id).not.toBe('talhao-gogo-usina')
  })

  it('talhão de OUTRA fazenda com nome idêntico não pode casar', async () => {
    // Duas fazendas têm um talhão "Gogo I". Buscar na fazenda MT tem que devolver
    // o talhão da fazenda MT, nunca o da MG — mesmo que o da MG bata primeiro
    // num banco sem filtro por fazenda_id (esta é a falha que este PR corrige).
    const talhaoMt = await buscarTalhao('Gogo I', 'fazenda-mt')
    expect(talhaoMt?.id).toBe('talhao-mt-gogo-1')
    expect(talhaoMt?.id).not.toBe('talhao-gogo-1')
  })
})

describe('buscarInsumo', () => {
  it('acha o insumo da própria fazenda', async () => {
    const insumo = await buscarInsumo('glifosato', 'fazenda-mg')
    expect(insumo?.id).toBe('insumo-glifosato-mg')
  })

  it('saída de estoque não escolhe insumo de outra fazenda', async () => {
    // As duas fazendas têm "Glifosato" cadastrado com IDs diferentes. Sem o
    // filtro de fazenda_id, o .limit(5) sem .order() podia devolver o insumo
    // da fazenda errada e gravar movimentação de estoque cruzada (a falha
    // concreta descrita no contexto do bug).
    const insumoMt = await buscarInsumo('glifosato', 'fazenda-mt')
    expect(insumoMt?.id).toBe('insumo-glifosato-mt')
    expect(insumoMt?.id).not.toBe('insumo-glifosato-mg')
  })
})

describe('consultarEstoque', () => {
  it('consulta do MT não devolve número do MG', async () => {
    const resposta = await consultarEstoque('glifosato', 'fazenda-mt')
    expect(resposta).toContain('50')
    expect(resposta).not.toContain('300')
  })

  it('consulta do MG não devolve número do MT', async () => {
    const resposta = await consultarEstoque('glifosato', 'fazenda-mg')
    expect(resposta).toContain('300')
    expect(resposta).not.toContain('50 L')
  })
})
