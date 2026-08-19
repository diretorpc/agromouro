import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Por que este teste existe ─────────────────────────────────────────────
//
// `agregarControle` é uma casca fina em cima da função `controle_graficos`
// (migration 020) — a soma de verdade acontece no Postgres, de propósito
// (ver o cabeçalho da migration: gráfico montado em cima da PÁGINA carregada
// mente em silêncio). Justamente por ser fina, o que precisa de prova aqui
// não é aritmética: é o CONTRATO da chamada.
//
// O item mais importante é o `p_fazenda_id`. A API usa SUPABASE_SERVICE_KEY,
// que bypassa RLS — não existe rede de segurança do banco nesta porta. Se
// alguém remover o argumento, ou deixá-lo vir do corpo da requisição, o
// vazamento entre fazendas não dá erro nenhum: só devolve dado a mais. Os
// testes de FAZENDA_A/FAZENDA_B abaixo falham nesse caso.

const FAZENDA_A = 'fazenda-aaa'
const FAZENDA_B = 'fazenda-bbb'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { rpc: rpcMock },
}))

import { agregarControle } from './agregarControle'

const RESPOSTA_VAZIA = {
  porFornecedor: [], porProduto: [], porMes: [], precoNoTempo: [], precoPorFornecedor: [],
  meta: {
    totalGeral: 0, totalItens: 0, itensSemData: 0, valorSemData: 0,
    itensSemProduto: 0, valorSemProduto: 0, itensSemQuantidade: 0, valorSemQuantidade: 0,
    fornecedoresDistintos: 0, produtosDistintos: 0, produtosNoPrecoTempo: 0,
    produtosComparaveis: 0, produtosNoPrecoPorFornecedor: 0,
    topAplicado: 10, mediaPonderadaPor: 'quantidade',
  },
}

const FILTRO_VAZIO = { fornecedor: [], status: [] }

beforeEach(() => {
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: RESPOSTA_VAZIA, error: null })
})

describe('agregarControle', () => {
  it('chama a função controle_graficos passando a fazenda recebida', async () => {
    await agregarControle(FAZENDA_A, FILTRO_VAZIO)

    expect(rpcMock).toHaveBeenCalledTimes(1)
    const [nomeFuncao, argumentos] = rpcMock.mock.calls[0]
    expect(nomeFuncao).toBe('controle_graficos')
    expect(argumentos.p_fazenda_id).toBe(FAZENDA_A)
  })

  it('ISOLAMENTO: fazendas diferentes viram chamadas com p_fazenda_id diferente', async () => {
    await agregarControle(FAZENDA_A, FILTRO_VAZIO)
    await agregarControle(FAZENDA_B, FILTRO_VAZIO)

    expect(rpcMock.mock.calls[0][1].p_fazenda_id).toBe(FAZENDA_A)
    expect(rpcMock.mock.calls[1][1].p_fazenda_id).toBe(FAZENDA_B)
  })

  it('ISOLAMENTO: recusa antes de tocar no banco quando a fazenda vem vazia', async () => {
    // Sem isto, `p_fazenda_id: undefined` chegaria ao PostgREST como
    // argumento ausente e a função usaria... nada — e o "cinto" da CTE
    // `guarda` (migration 020) devolveria vazio em vez de erro, escondendo
    // um bug de autenticação atrás de uma tela em branco. Falhar alto aqui
    // é melhor que devolver vazio calado.
    await expect(agregarControle('', FILTRO_VAZIO)).rejects.toThrow(/fazenda/i)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('filtro vazio vira null (não array vazio) em cada parâmetro opcional', async () => {
    await agregarControle(FAZENDA_A, FILTRO_VAZIO)

    const args = rpcMock.mock.calls[0][1]
    expect(args.p_fornecedor).toBeNull()
    expect(args.p_status).toBeNull()
    expect(args.p_data_inicio).toBeNull()
    expect(args.p_data_fim).toBeNull()
  })

  it('normaliza o fornecedor igual à grade — senão gráfico e tabela divergem', async () => {
    // `listarItensControle` filtra por `fornecedor_normalizado` usando
    // `normalizarFornecedor`. Se aqui passasse o nome cru, um filtro com
    // espaço sobrando traria linhas na grade e nenhuma no gráfico.
    await agregarControle(FAZENDA_A, { ...FILTRO_VAZIO, fornecedor: ['  syagri  agronegocios '] })

    expect(rpcMock.mock.calls[0][1].p_fornecedor).toEqual(['SYAGRI AGRONEGOCIOS'])
  })

  it('repassa período, status e top', async () => {
    await agregarControle(FAZENDA_A, {
      fornecedor: [], status: ['processado', 'erro'],
      dataInicio: '2026-01-01', dataFim: '2026-07-31', top: 5,
    })

    const args = rpcMock.mock.calls[0][1]
    expect(args.p_status).toEqual(['processado', 'erro'])
    expect(args.p_data_inicio).toBe('2026-01-01')
    expect(args.p_data_fim).toBe('2026-07-31')
    expect(args.p_top).toBe(5)
  })

  it('usa top 10 por padrão — o mesmo número que a legenda da tela promete', async () => {
    await agregarControle(FAZENDA_A, FILTRO_VAZIO)
    expect(rpcMock.mock.calls[0][1].p_top).toBe(10)
  })

  it('devolve o payload do banco intacto', async () => {
    const payload = {
      ...RESPOSTA_VAZIA,
      porProduto: [{ rotulo: 'ENGEO PLENO S 20 LT', total: 105930, itens: 8 }],
      meta: { ...RESPOSTA_VAZIA.meta, totalGeral: 1406915.25, totalItens: 28 },
    }
    rpcMock.mockResolvedValue({ data: payload, error: null })

    await expect(agregarControle(FAZENDA_A, FILTRO_VAZIO)).resolves.toEqual(payload)
  })

  it('propaga erro do banco em vez de devolver payload vazio', async () => {
    // Migration 020 não aplicada em produção é EXATAMENTE este caso (foi o
    // que aconteceu com a 019). Devolver `{porProduto: []}` faria a tela
    // dizer "sem dados" — mentira. A rota precisa de um 500 pra doer.
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function controle_graficos does not exist' } })

    await expect(agregarControle(FAZENDA_A, FILTRO_VAZIO)).rejects.toThrow(/controle_graficos/)
  })

  it('trata resposta nula do banco como erro, não como "sem dados"', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })

    await expect(agregarControle(FAZENDA_A, FILTRO_VAZIO)).rejects.toThrow()
  })
})
