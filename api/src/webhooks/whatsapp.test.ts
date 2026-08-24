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
      // Linha "fantasma": existe para o SELECT batch achar (estoqueMap tem a linha),
      // mas _updateNaoEncontra faz o UPDATE simulado não casar nenhuma linha —
      // reproduz o cenário que a Tarefa 3 corrige (Supabase retorna error:null
      // mesmo com 0 linhas afetadas; só contar as linhas do .select() denuncia).
      { insumo_id: 'insumo-fantasma', fazenda_id: 'fazenda-mg', quantidade_atual: 100, quantidade_minima_alerta: 10, _updateNaoEncontra: true },
      // Linha que faz o UPDATE simulado devolver ERROR de verdade (não apenas
      // 0 linhas) — o caminho `if (updErr)` de decrementarEstoque não tinha
      // nenhum teste até o Apolo apontar (Item 3 da rodada de correção).
      { insumo_id: 'insumo-erro-update', fazenda_id: 'fazenda-mg', quantidade_atual: 40, quantidade_minima_alerta: 5, _updateGeraErro: true },
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
    let updatePatch: Record<string, any> | undefined

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

    const executaUpdate = (): any[] => {
      // Linhas com _updateNaoEncontra simulam um UPDATE que não casa nenhuma
      // linha mesmo a linha existindo (cenário de teste da Tarefa 3 — não
      // representa um caminho real do código, só o comportamento que ele
      // precisa tolerar: Supabase retorna error:null mesmo com 0 linhas).
      const linhas = aplicaFiltros(linhasBase()).filter((row: any) => !row._updateNaoEncontra)
      linhas.forEach((row: any) => Object.assign(row, updatePatch))
      return linhas
    }

    // _updateGeraErro simula um UPDATE que devolve error DE VERDADE (rede,
    // constraint, etc.) — diferente de "0 linhas casadas". Cobre o caminho
    // `if (updErr)` de decrementarEstoque, sem teste até a rodada do Apolo.
    const forcaErroDeUpdate = (): boolean =>
      aplicaFiltros(linhasBase()).some((row: any) => row._updateGeraErro)

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
      update: vi.fn((patch: Record<string, any>) => { updatePatch = patch; return obj }),
      single: vi.fn(async () => {
        const linhas = executaSelect()
        return linhas.length > 0
          ? { data: linhas[0], error: null }
          : { data: null, error: { message: 'not found' } }
      }),
      // thenable: cobre os caminhos que fazem `await` direto na cadeia sem .single()
      then: (resolve: any, reject: any) => {
        if (updatePatch !== undefined) {
          if (forcaErroDeUpdate()) {
            return Promise.resolve({ data: null, error: { message: 'erro simulado de conexão' } }).then(resolve, reject)
          }
          return Promise.resolve({ data: executaUpdate(), error: null }).then(resolve, reject)
        }
        return Promise.resolve({ data: executaSelect(), error: null }).then(resolve, reject)
      },
    }
    return obj
  }

  return {
    supabase: { from: vi.fn((tabela: string) => tabelaBuilder(tabela)) },
  }
})

import { buscarTalhao, buscarInsumo, consultarEstoque, decrementarEstoque, formatarSaidas } from './whatsapp'
import { supabase } from '../services/supabase'

// Acha o builder de uma chamada `supabase.from(tabela)` específica pela ORDEM
// em que aconteceu (0 = 1ª vez que a tabela foi consultada, 1 = 2ª, ...) — usado
// pelos testes de mutação abaixo para provar que um .eq(...) específico foi
// chamado de verdade, em vez de inferir isso só pelo dado devolvido (o Apolo
// mostrou que dado devolvido pode ser igual mesmo com o filtro removido, quando
// outro filtro da mesma função "mascara" o mutante).
function builderDaChamada(tabela: string, ocorrencia: number): any {
  const chamadas = (supabase.from as any).mock.calls
    .map((args: any[], i: number) => ({ tabela: args[0], builder: (supabase.from as any).mock.results[i].value }))
    .filter((c: any) => c.tabela === tabela)
  if (!chamadas[ocorrencia]) {
    throw new Error(`supabase.from('${tabela}') não foi chamado ${ocorrencia + 1}x — só ${chamadas.length}x`)
  }
  return chamadas[ocorrencia].builder
}

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

  // ─── Item 3 (mutação) — mata o mutante que remove .eq('fazenda_id') de INSUMOS ─
  // Os dois testes acima SOBREVIVEM à remoção desse filtro: como o MT também tem
  // um "Glifosato" cadastrado (com id próprio), o filtro de ESTOQUE (linha ~160)
  // sozinho já filtra o resultado certo — o filtro de INSUMOS fica sem prova
  // própria. Aqui a fazenda MT não tem NENHUM "glifosato" cadastrado (nem
  // insumo, nem estoque) — só a MG tem. Sem o filtro de fazenda_id em insumos,
  // a busca por "glifosato" pedida para MT encontraria o insumo DA MG (ilike
  // não distingue fazenda) e devolveria "sem registro de estoque" em vez de
  // "não encontrei" — mensagem diferente, mutante morre.
  it('MT sem NENHUM "glifosato" cadastrado (só MG tem): devolve "Não encontrei", nunca o número do MG', async () => {
    estadoBanco.insumos = estadoBanco.insumos.filter(i => i.id !== 'insumo-glifosato-mt')
    estadoBanco.estoque = estadoBanco.estoque.filter(e => e.insumo_id !== 'insumo-glifosato-mt')

    const resposta = await consultarEstoque('glifosato', 'fazenda-mt')
    expect(resposta).toContain('Não encontrei')
    expect(resposta).not.toContain('300')
  })

  // ─── Item 3 (mutação) — mata o mutante que remove .eq('fazenda_id') de ESTOQUE ─
  // Prova por INSPEÇÃO DE CHAMADA, não por dado devolvido: dado que o id de
  // insumo já vem filtrado por fazenda (linha ~148), o `.in('insumo_id', ids)`
  // sozinho já restringe ao id certo em qualquer cenário de dado plausível — o
  // filtro de fazenda_id em ESTOQUE só importa como defesa contra uma linha de
  // estoque corrompida (mesmo insumo_id, fazenda_id errado). Testar por dado
  // exigiria simular corrupção; inspecionar a chamada prova o filtro existe.
  it('a query de ESTOQUE realmente chama .eq(fazenda_id, ...) — não só a de insumos', async () => {
    await consultarEstoque('glifosato', 'fazenda-mt')

    const builderEstoque = builderDaChamada('estoque', 0)
    expect(builderEstoque.eq).toHaveBeenCalledWith('fazenda_id', 'fazenda-mt')
  })
})

describe('decrementarEstoque + formatarSaidas', () => {
  it('quando o UPDATE não pega nenhuma linha, novaQuantidade fica null e a resposta não mostra "(estoque:"', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-fantasma', nome: 'Glifosato', quantidade: 2, unidade: 'L', dose_por_ha: null },
    ]
    const saidas = await decrementarEstoque(okItems, 'fazenda-mg')
    expect(saidas[0].novaQuantidade).toBeNull()

    const resposta = formatarSaidas(saidas)
    expect(resposta).not.toContain('(estoque:')
  })

  it('quando o UPDATE grava normalmente, a resposta mostra o novo saldo', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-glifosato-mg', nome: 'Glifosato', quantidade: 2, unidade: 'L', dose_por_ha: null },
    ]
    const saidas = await decrementarEstoque(okItems, 'fazenda-mg')
    expect(saidas[0].novaQuantidade).toBe(298) // 300 - 2

    const resposta = formatarSaidas(saidas)
    expect(resposta).toContain('(estoque: 298L)')
  })

  // ─── Item 3 (mutação) — updErr != null nunca foi testado ───────────────────
  // Até aqui só o caminho "UPDATE devolveu 0 linhas" (error: null) tinha teste.
  // O `if (updErr)` — erro de verdade (rede, constraint) — não tinha nenhum.
  it('quando o UPDATE devolve ERROR de verdade (não só 0 linhas), novaQuantidade fica null e loga', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-erro-update', nome: 'ProdutoComErro', quantidade: 3, unidade: 'L', dose_por_ha: null },
    ]
    const saidas = await decrementarEstoque(okItems, 'fazenda-mg')
    expect(saidas[0].novaQuantidade).toBeNull()

    const resposta = formatarSaidas(saidas)
    expect(resposta).not.toContain('(estoque:')
  })

  // ─── Item 3 (mutação) — mata os mutantes que removem .eq('fazenda_id') no ──
  // SELECT batch (linha ~313) e no UPDATE por item (linha ~334). Ambos são
  // descritos no código como "última linha de defesa": com o dado do fixture
  // (cada insumo_id só existe numa fazenda), remover UM dos dois filtros ainda
  // deixa o resultado final (novaQuantidade) correto por acaso, porque o OUTRO
  // filtro (mais o próprio dado ser fazenda-exclusivo) mascara o mutante — é
  // exatamente por isso que o Apolo os achou sobreviventes. Prova por
  // INSPEÇÃO DE CHAMADA, que não depende dessa coincidência de dado.
  it('o SELECT batch realmente chama .eq(fazenda_id, ...)', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-glifosato-mg', nome: 'Glifosato', quantidade: 2, unidade: 'L', dose_por_ha: null },
    ]
    await decrementarEstoque(okItems, 'fazenda-mg')

    const builderSelect = builderDaChamada('estoque', 0) // 1ª chamada = SELECT batch
    expect(builderSelect.eq).toHaveBeenCalledWith('fazenda_id', 'fazenda-mg')
  })

  it('o UPDATE de cada item realmente chama .eq(fazenda_id, ...)', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-glifosato-mg', nome: 'Glifosato', quantidade: 2, unidade: 'L', dose_por_ha: null },
    ]
    await decrementarEstoque(okItems, 'fazenda-mg')

    const builderUpdate = builderDaChamada('estoque', 1) // 2ª chamada = UPDATE do item
    expect(builderUpdate.eq).toHaveBeenCalledWith('fazenda_id', 'fazenda-mg')
  })
})
