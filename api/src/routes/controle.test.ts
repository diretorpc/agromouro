import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── gravarDocumentoDoPdf mockado ───────────────────────────────────────────
// A rota só decide o mapeamento status→HTTP; a lógica de leitura/gravação já
// tem cobertura própria em gravarDocumentoPdf.test.ts. Mockar o service aqui
// evita reimplementar a cadeia inteira de Storage + duas tabelas só pra
// testar roteamento.
const gravarDocumentoDoPdfMock = vi.hoisted(() => vi.fn())
vi.mock('../services/controle/gravarDocumentoPdf', () => ({
  gravarDocumentoDoPdf: gravarDocumentoDoPdfMock,
}))

// ─── excluirDocumentoControle mockado ───────────────────────────────────────
// Mesmo motivo do mock acima: a lógica de exclusão (ordem itens→documento,
// FK RESTRICT, limpeza do Storage, marcar 'erro' em falha parcial) já tem
// cobertura própria em excluirDocumentoControle.test.ts — aqui só o
// mapeamento status→HTTP da rota.
const excluirDocumentoControleMock = vi.hoisted(() => vi.fn())
vi.mock('../services/controle/excluirDocumentoControle', () => ({
  excluirDocumentoControle: excluirDocumentoControleMock,
}))

// ─── Banco fake com DUAS fazendas ──────────────────────────────────────────
// Mesmo padrão de estoque.test.ts: o client Supabase da API usa a service
// key (ignora RLS sempre), então sem o filtro manual de fazenda_id as duas
// fazendas apareceriam misturadas. `select()` aqui faz PROJEÇÃO de verdade
// (recorta as colunas pedidas) — diferente do builder de estoque.test.ts —
// porque um dos testes existe exatamente pra provar que arquivo_path nunca
// vaza no payload de GET /, e um builder que ignora o select() não pegaria
// essa regressão.
const FAZENDA_A = 'fazenda-aaa'
const FAZENDA_B = 'fazenda-bbb'

const { estadoBanco, createSignedUrlMock } = vi.hoisted(() => ({
  estadoBanco: {
    documentos: [] as any[],
    itens: [] as any[],
  },
  createSignedUrlMock: vi.fn(),
}))

vi.mock('../services/supabase', () => {
  // Espelha a coluna GERADA documentos_controle.fornecedor_normalizado
  // (migration 017: upper(btrim(regexp_replace(fornecedor,'\s+',' ','g')))).
  // Calculada aqui, e não escrita à mão nas fixtures, de propósito: fixture que
  // escreve o valor normalizado à mão pode mentir (dizer que duas grafias têm o
  // mesmo normalizado quando o Postgres diria outra coisa) e o teste passaria
  // provando nada.
  function fornecedorNormalizado(fornecedor: unknown): string | null {
    if (typeof fornecedor !== 'string') return null
    const limpo = fornecedor.replace(/\s+/g, ' ').trim().toUpperCase()
    return limpo === '' ? null : limpo
  }

  function builder(tabela: 'documentos_controle' | 'itens_nfe') {
    const filtros: Record<string, any> = {}
    const filtrosIn: Record<string, any[]> = {}
    const filtrosGte: Record<string, any> = {}
    const filtrosLte: Record<string, any> = {}
    const ordenacoes: { campo: string; ascendente: boolean }[] = []
    let colunas: string[] | null = null
    let contarTotal = false
    let rangeSlice: [number, number] | null = null

    function linhasBase() {
      if (tabela === 'itens_nfe') return estadoBanco.itens
      // documentos_controle: coluna gerada entra aqui, como no banco real.
      return estadoBanco.documentos.map(d => ({
        ...d,
        fornecedor_normalizado: fornecedorNormalizado(d.fornecedor),
      }))
    }
    // `.order()` de verdade — o mock antigo devolvia o builder e ignorava o
    // pedido, então nenhum teste conseguia provar ordenação (nem detectar que
    // ela sumiu). Aplica na ordem em que foi pedida: 1º critério, depois
    // desempate, igual ao PostgREST.
    function ordenar(linhas: any[]) {
      if (ordenacoes.length === 0) return linhas
      return [...linhas].sort((a, b) => {
        for (const { campo, ascendente } of ordenacoes) {
          const va = a[campo]
          const vb = b[campo]
          if (va === vb) continue
          // null por último, como o `NULLS LAST` padrão do Postgres em ASC.
          if (va === null || va === undefined) return 1
          if (vb === null || vb === undefined) return -1
          return (va < vb ? -1 : 1) * (ascendente ? 1 : -1)
        }
        return 0
      })
    }
    function filtrar() {
      return linhasBase().filter(l =>
        Object.entries(filtros).every(([campo, valor]) => l[campo] === valor) &&
        Object.entries(filtrosIn).every(([campo, valores]) => valores.includes(l[campo])) &&
        Object.entries(filtrosGte).every(([campo, valor]) => l[campo] >= valor) &&
        Object.entries(filtrosLte).every(([campo, valor]) => l[campo] <= valor),
      )
    }
    function projetar(linha: any) {
      if (!colunas) return linha
      const out: any = {}
      for (const c of colunas) out[c] = linha[c]
      return out
    }

    const obj: any = {
      select: vi.fn((cols?: string, opts?: { count?: 'exact' }) => {
        colunas = cols ? cols.split(',').map(c => c.trim()) : null
        contarTotal = opts?.count === 'exact'
        return obj
      }),
      order: vi.fn((campo: string, opts?: { ascending?: boolean }) => {
        ordenacoes.push({ campo, ascendente: opts?.ascending !== false })
        return obj
      }),
      eq: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      in: vi.fn((campo: string, valores: any[]) => { filtrosIn[campo] = valores; return obj }),
      gte: vi.fn((campo: string, valor: any) => { filtrosGte[campo] = valor; return obj }),
      lte: vi.fn((campo: string, valor: any) => { filtrosLte[campo] = valor; return obj }),
      range: vi.fn((de: number, ate: number) => { rangeSlice = [de, ate]; return obj }),
      single: vi.fn(() => {
        const linhas = filtrar()
        if (linhas.length === 0) {
          return Promise.resolve({ data: null, error: { message: 'not found', code: 'PGRST116' } })
        }
        return Promise.resolve({ data: projetar(linhas[0]), error: null })
      }),
      then(resolve: any) {
        const todasFiltradas = ordenar(filtrar())
        const pagina = rangeSlice ? todasFiltradas.slice(rangeSlice[0], rangeSlice[1] + 1) : todasFiltradas
        return Promise.resolve(resolve({
          data: pagina.map(projetar),
          error: null,
          count: contarTotal ? todasFiltradas.length : null,
        }))
      },
    }
    return obj
  }

  return {
    supabase: {
      from: vi.fn((tabela: string) => builder(tabela as any)),
      storage: {
        from: vi.fn(() => ({ createSignedUrl: createSignedUrlMock })),
      },
    },
  }
})

import { controleRoutes } from './controle'
import { gravarDocumentoDoPdf } from '../services/controle/gravarDocumentoPdf'

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.documentos = []
  estadoBanco.itens = []
  createSignedUrlMock.mockReset()
  excluirDocumentoControleMock.mockReset()
})

// ─── Helpers para invocar a rota Express diretamente ───────────────────────
// Sem supertest/servidor HTTP — mesmo padrão de estoque.test.ts.
function pegarHandler(method: 'get' | 'post' | 'delete', path: string) {
  const layer = (controleRoutes as any).stack.find(
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
    // `sent` distingue "204 sem corpo" (DELETE /:id) de "nada foi chamado
    // ainda" — sem isso, um teste que espera corpo vazio não consegue provar
    // que a rota chegou a responder de verdade.
    sent: false,
    status(code: number) { this.statusCode = code; return this },
    json(payload: any) { this.body = payload; return this },
    send(payload?: any) { this.sent = true; this.body = payload; return this },
  }
  const next = vi.fn()
  return { req, res, next }
}

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /controle/documentos', () => {
  const handler = pegarHandler('post', '/')
  const corpoValido = { arquivo: Buffer.from('%PDF-1.4').toString('base64'), nomeArquivo: 'extrato.pdf' }

  it('sem fazenda identificada no token: 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
    expect(gravarDocumentoDoPdf).not.toHaveBeenCalled()
  })

  it('corpo inválido (sem arquivo/nomeArquivo): 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: {} })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(gravarDocumentoDoPdf).not.toHaveBeenCalled()
  })

  it('sucesso: status "gravado" vira 201 com o resultado', async () => {
    gravarDocumentoDoPdfMock.mockResolvedValue({
      status: 'gravado', documentoId: 'doc-1', itensGravados: 3, itensDescartados: 0, itensDuplicados: 0,
    })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoValido })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ status: 'gravado', documentoId: 'doc-1', itensGravados: 3, itensDescartados: 0, itensDuplicados: 0 })
  })

  it('duplicada-hash: 200, não 4xx/5xx — reenvio do mesmo arquivo é resposta válida', async () => {
    gravarDocumentoDoPdfMock.mockResolvedValue({ status: 'duplicada-hash' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'duplicada-hash' })
  })

  it('duplicada-conteudo: 200', async () => {
    gravarDocumentoDoPdfMock.mockResolvedValue({ status: 'duplicada-conteudo' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'duplicada-conteudo' })
  })

  // Achado 1 da revisão do Apolo: os 4 status de recusa mandavam o resultado
  // CRU (sem campo `error`) — o front (web/lib/api.ts) só usa `corpo.error`
  // pra mostrar mensagem, então caía no fallback genérico "API error: {status}"
  // e o motivo real da recusa nunca chegava na tela. Cada `it.each` abaixo
  // confere status HTTP + `error` com mensagem ESPECÍFICA (não genérica) +
  // que os demais campos do resultado original continuam no corpo.
  it.each([
    ['nao-documento', { status: 'nao-documento' }, 422],
    ['sem-itens-aproveitaveis', { status: 'sem-itens-aproveitaveis', itensDescartados: 5 }, 422],
    ['sem-identidade', { status: 'sem-identidade' }, 422],
  ])('%s: %i, com error específico e os campos do resultado preservados', async (_nome, resultado, statusEsperado) => {
    gravarDocumentoDoPdfMock.mockResolvedValue(resultado)
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(statusEsperado)
    expect(res.body).toMatchObject(resultado)
    expect(typeof res.body.error).toBe('string')
    expect(res.body.error.length).toBeGreaterThan(0)
  })

  // Achado 2 da revisão do Apolo: 'falha' é problema de INFRA da chamada à IA
  // (rede, sobrecarga, chave inválida — ver comentário de gravarDocumentoPdf.ts),
  // não do conteúdo do PDF. Antes virava 422 igual aos outros 3 — o dono via
  // "API error: 422", achava que o ARQUIVO dele tinha problema e não tentava
  // de novo. Agora vira 503 ("tente de novo"), status diferente dos outros 3.
  it("falha (infra da IA): 503 com mensagem de 'tente de novo', não 422", async () => {
    const resultado = { status: 'falha', motivo: 'resposta truncada (max_tokens)' }
    gravarDocumentoDoPdfMock.mockResolvedValue(resultado)
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject(resultado)
    expect(res.body.error).toMatch(/tente de novo/i)
  })

  it('erro genérico do service: 500', async () => {
    gravarDocumentoDoPdfMock.mockResolvedValue({ status: 'erro', mensagem: 'connection reset' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoValido })
    await handler(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ detalhe: 'connection reset' })
  })

  // ACHADO (mesmo padrão de nfe.ts): fazenda_id nunca pode vir do corpo —
  // a API usa a service key, que ignora RLS. Um fazenda_id forjado no body
  // não pode conseguir gravar documento em fazenda alheia.
  it('fazenda_id no corpo é IGNORADO — o service sempre recebe a fazenda do auth', async () => {
    gravarDocumentoDoPdfMock.mockResolvedValue({
      status: 'gravado', documentoId: 'doc-1', itensGravados: 1, itensDescartados: 0, itensDuplicados: 0,
    })
    const corpoComFazendaForjada = { ...corpoValido, fazenda_id: FAZENDA_B, fazendaId: FAZENDA_B }
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, body: corpoComFazendaForjada })
    await handler(req, res, next)

    expect(res.statusCode).toBe(201)
    // 4º argumento posicional de gravarDocumentoDoPdf é fazendaId — precisa
    // ser o da SESSÃO (FAZENDA_A), nunca o valor forjado no corpo (FAZENDA_B).
    expect(gravarDocumentoDoPdf).toHaveBeenCalledWith(
      expect.any(Buffer), 'extrato.pdf', expect.any(String), FAZENDA_A, expect.anything(),
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /controle/documentos/filtros', () => {
  const handler = pegarHandler('get', '/filtros')

  it('devolve fornecedores distintos (sem repetir) e a lista fixa de status', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS SOLUÇÕES', status: 'processado' },
      { id: 'doc-2', fazenda_id: FAZENDA_A, fornecedor: 'SYAGRI', status: 'processado' },
      { id: 'doc-3', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS SOLUÇÕES', status: 'erro' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })

    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(res.body.fornecedores).toEqual(['SOLOS SOLUÇÕES', 'SYAGRI'])
    expect(res.body.status).toEqual(['importado', 'processando', 'processado', 'erro'])
  })

  // ACHADO da revisão final: o menu lia `fornecedor` CRU. Duas leituras por IA do
  // MESMO fornecedor saem grafadas diferente (caixa, espaço duplo, espaço nas
  // pontas) e viravam DUAS opções no menu, cada uma trazendo metade dos
  // documentos — o Matheus conferindo "loja por loja" perderia metade sem saber.
  // A coluna gerada fornecedor_normalizado (migration 017) é a mesma dos dois
  // lados: menu e filtro.
  it('duas grafias do MESMO fornecedor viram UMA opção só (fornecedor_normalizado)', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fazenda_id: FAZENDA_A, fornecedor: 'Solos Soluções',     status: 'processado' },
      { id: 'doc-2', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS SOLUÇÕES  ',   status: 'processado' },
      { id: 'doc-3', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS  SOLUÇÕES',    status: 'erro' },
      { id: 'doc-4', fazenda_id: FAZENDA_A, fornecedor: 'SYAGRI',             status: 'processado' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })

    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.body.fornecedores).toEqual(['SOLOS SOLUÇÕES', 'SYAGRI'])
  })

  it('isola por fazenda — não mistura fornecedor de outra fazenda', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS SOLUÇÕES', status: 'processado' },
      { id: 'doc-2', fazenda_id: FAZENDA_B, fornecedor: 'MOSAIC', status: 'processado' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })

    await handler(req, res, next)

    expect(res.body.fornecedores).toEqual(['SOLOS SOLUÇÕES'])
  })

  it('sem documento nenhum: fornecedores vazio, status continua fixo', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })

    await handler(req, res, next)

    expect(res.body.fornecedores).toEqual([])
    expect(res.body.status).toEqual(['importado', 'processando', 'processado', 'erro'])
  })

  it('sem fazenda identificada no token: 400, não consulta o banco', async () => {
    const { req, res, next } = criarReqRes()

    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /controle/documentos', () => {
  const handler = pegarHandler('get', '/')

  it('sem fazenda identificada no token: 400, não consulta o banco', async () => {
    const { req, res, next } = criarReqRes()
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })

  it('lista os documentos da fazenda ativa com os itens agrupados corretamente por documento', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'SOLOS', numero_documento: '57106', data_documento: '2026-07-01', valor_total: 1505, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', arquivo_path: FAZENDA_A + '/x.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'MOSAIC', numero_documento: '288658', data_documento: '2026-07-05', valor_total: 250000, status: 'processado', erro_mensagem: null, nome_arquivo: 'b.pdf', arquivo_path: FAZENDA_A + '/y.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
      { id: 'doc-3', fornecedor: 'OUTRO', numero_documento: '999', data_documento: '2026-07-06', valor_total: 100, status: 'processado', erro_mensagem: null, nome_arquivo: 'c.pdf', arquivo_path: FAZENDA_B + '/z.pdf', fazenda_id: FAZENDA_B, created_at: '2026-08-12' },
    ]
    estadoBanco.itens = [
      { id: 'item-1', descricao: 'ADUBO', quantidade: 10, unidade: 'SC', valor_unitario: 150.5, valor_total: 1505, fornecedor: 'SOLOS', numero_documento: '57106', ocorrencia_no_documento: 0, documento_controle_id: 'doc-1', conta_como_compra: false, data_manual: '2026-07-01', insumo_id: null, fazenda_id: FAZENDA_A },
      { id: 'item-2', descricao: 'KCL', quantidade: 5, unidade: 'SC', valor_unitario: 200, valor_total: 1000, fornecedor: 'SOLOS', numero_documento: '57107', ocorrencia_no_documento: 0, documento_controle_id: 'doc-1', conta_como_compra: false, data_manual: '2026-07-02', insumo_id: null, fazenda_id: FAZENDA_A },
      // doc-2 não tem nenhum item ainda — precisa aparecer com itens: [].
      // item de outra fazenda, mesmo que (por erro) apontasse pro doc-1, não pode entrar.
      { id: 'item-x', descricao: 'ALHEIO', quantidade: 1, unidade: 'UN', valor_unitario: 1, valor_total: 1, fornecedor: 'X', numero_documento: '1', ocorrencia_no_documento: 0, documento_controle_id: 'doc-1', conta_como_compra: false, data_manual: '2026-07-01', insumo_id: null, fazenda_id: FAZENDA_B },
    ]

    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.body.totalDocumentos).toBe(2) // só os 2 documentos da fazenda A
    expect(res.body.documentos).toHaveLength(2)
    expect(res.body.documentos.every((d: any) => d.fazenda_id === FAZENDA_A)).toBe(true)

    const doc1 = res.body.documentos.find((d: any) => d.id === 'doc-1')
    expect(doc1.itens).toHaveLength(2)
    expect(doc1.itens.map((i: any) => i.id).sort()).toEqual(['item-1', 'item-2'])
    // item de outra fazenda nunca aparece agrupado, mesmo apontando pro doc-1.
    expect(doc1.itens.some((i: any) => i.id === 'item-x')).toBe(false)

    const doc2 = res.body.documentos.find((d: any) => d.id === 'doc-2')
    expect(doc2.itens).toEqual([])
  })

  it('lista vazia quando a fazenda não tem nenhum documento: não tenta buscar itens', async () => {
    estadoBanco.documentos = []
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    expect(res.body).toEqual({ documentos: [], paginaAtual: 1, totalPaginas: 1, totalDocumentos: 0 })
  })

  it('nunca devolve arquivo_path no payload (caminho interno do Storage privado)', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'SOLOS', numero_documento: '57106', data_documento: '2026-07-01', valor_total: 1505, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', arquivo_path: FAZENDA_A + '/segredo.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    expect(res.body.documentos[0]).not.toHaveProperty('arquivo_path')
  })

  it('pagina e conta o total — porPagina 2, pagina 1 devolve 2 e informa 2 páginas/3 documentos', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'A', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'B', numero_documento: '2', data_documento: '2026-01-02', valor_total: 20, status: 'processado', erro_mensagem: null, nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
      { id: 'doc-3', fornecedor: 'C', numero_documento: '3', data_documento: '2026-01-03', valor_total: 30, status: 'processado', erro_mensagem: null, nome_arquivo: 'c.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-12' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { pagina: '1', porPagina: '2' } })

    await handler(req, res, next)

    expect(res.body.documentos).toHaveLength(2)
    expect(res.body.paginaAtual).toBe(1)
    expect(res.body.totalPaginas).toBe(2)
    expect(res.body.totalDocumentos).toBe(3)
  })

  it('filtra por fornecedor — só devolve documento do fornecedor pedido', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'SOLOS', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'MOSAIC', numero_documento: '2', data_documento: '2026-01-02', valor_total: 20, status: 'processado', erro_mensagem: null, nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { fornecedor: 'SOLOS' } })

    await handler(req, res, next)

    expect(res.body.documentos).toHaveLength(1)
    expect(res.body.documentos[0].id).toBe('doc-1')
  })

  // ACHADO da revisão final (par do teste de /filtros): o filtro batia em
  // `fornecedor` cru, então marcar a única opção do menu ("SOLOS SOLUÇÕES")
  // trazia só os documentos gravados com aquela grafia exata e escondia os
  // outros do MESMO fornecedor, em silêncio.
  it('filtra por fornecedor_normalizado — pega TODAS as grafias do mesmo fornecedor', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'Solos Soluções',   numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'SOLOS SOLUÇÕES  ', numero_documento: '2', data_documento: '2026-01-02', valor_total: 20, status: 'processado', erro_mensagem: null, nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
      { id: 'doc-3', fornecedor: 'MOSAIC',           numero_documento: '3', data_documento: '2026-01-03', valor_total: 30, status: 'processado', erro_mensagem: null, nome_arquivo: 'c.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-12' },
    ]
    // Valor exatamente como GET /filtros o entrega ao front (já normalizado).
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { fornecedor: 'SOLOS SOLUÇÕES' } })

    await handler(req, res, next)

    expect(res.body.documentos.map((d: any) => d.id).sort()).toEqual(['doc-1', 'doc-2'])
  })

  it('normaliza também o valor que chega na URL — grafia crua no query param acha os mesmos documentos', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'SOLOS SOLUÇÕES', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { fornecedor: '  solos  soluções ' } })

    await handler(req, res, next)

    expect(res.body.documentos.map((d: any) => d.id)).toEqual(['doc-1'])
  })

  it('filtra por status combinado com fornecedor — os dois valem ao mesmo tempo', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'SOLOS', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'SOLOS', numero_documento: '2', data_documento: '2026-01-02', valor_total: 20, status: 'erro', erro_mensagem: 'x', nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { fornecedor: 'SOLOS', status: 'erro' } })

    await handler(req, res, next)

    expect(res.body.documentos).toHaveLength(1)
    expect(res.body.documentos[0].id).toBe('doc-2')
  })

  it('filtra por período (dataInicio/dataFim)', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'A', numero_documento: '1', data_documento: '2026-01-01', valor_total: 10, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
      { id: 'doc-2', fornecedor: 'A', numero_documento: '2', data_documento: '2026-06-15', valor_total: 20, status: 'processado', erro_mensagem: null, nome_arquivo: 'b.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-11' },
    ]
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { dataInicio: '2026-03-01', dataFim: '2026-12-31' } })

    await handler(req, res, next)

    expect(res.body.documentos).toHaveLength(1)
    expect(res.body.documentos[0].id).toBe('doc-2')
  })

  // ACHADO da revisão final: a query de itens não tinha `.order()` nenhum — o
  // Postgres podia devolver as linhas de um documento em qualquer ordem, e mudar
  // de ordem entre duas recargas da mesma página. O mock só passou a respeitar
  // `.order()` por causa deste teste; sem isso a regressão voltaria calada.
  it('devolve os itens do documento ordenados por ocorrencia_no_documento (e id como desempate estável)', async () => {
    estadoBanco.documentos = [
      { id: 'doc-1', fornecedor: 'SOLOS', numero_documento: '57106', data_documento: '2026-07-01', valor_total: 3010, status: 'processado', erro_mensagem: null, nome_arquivo: 'a.pdf', fazenda_id: FAZENDA_A, created_at: '2026-08-10' },
    ]
    // Inseridos FORA de ordem de propósito: se a rota não ordenasse, o resultado
    // sairia nesta mesma ordem embaralhada e o teste falharia.
    estadoBanco.itens = [
      { id: 'item-c', descricao: 'ADUBO', quantidade: 1, unidade: 'SC', valor_unitario: 1505, valor_total: 1505, fornecedor: 'SOLOS', numero_documento: '57106', ocorrencia_no_documento: 1, documento_controle_id: 'doc-1', conta_como_compra: false, data_manual: '2026-07-01', insumo_id: null, fazenda_id: FAZENDA_A },
      { id: 'item-b', descricao: 'KCL',   quantidade: 1, unidade: 'SC', valor_unitario: 500,  valor_total: 500,  fornecedor: 'SOLOS', numero_documento: '57106', ocorrencia_no_documento: 0, documento_controle_id: 'doc-1', conta_como_compra: false, data_manual: '2026-07-01', insumo_id: null, fazenda_id: FAZENDA_A },
      { id: 'item-a', descricao: 'ADUBO', quantidade: 1, unidade: 'SC', valor_unitario: 1505, valor_total: 1505, fornecedor: 'SOLOS', numero_documento: '57106', ocorrencia_no_documento: 0, documento_controle_id: 'doc-1', conta_como_compra: false, data_manual: '2026-07-01', insumo_id: null, fazenda_id: FAZENDA_A },
    ]

    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A })
    await handler(req, res, next)

    // ocorrencia 0 antes de ocorrencia 1; dentro do empate de ocorrencia 0, o id
    // decide (item-a antes de item-b) — ordem arbitrária, mas sempre a mesma.
    expect(res.body.documentos[0].itens.map((i: any) => i.id)).toEqual(['item-a', 'item-b', 'item-c'])
  })

  it('parâmetro de paginação inválido: 400', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, query: { pagina: 'abc' } })

    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /controle/documentos/:id/arquivo', () => {
  const handler = pegarHandler('get', '/:id/arquivo')

  beforeEach(() => {
    estadoBanco.documentos = [
      { id: 'doc-a1', fornecedor: 'SOLOS', numero_documento: '57106', arquivo_path: `${FAZENDA_A}/x.pdf`, fazenda_id: FAZENDA_A },
      { id: 'doc-b1', fornecedor: 'OUTRO', numero_documento: '999',   arquivo_path: `${FAZENDA_B}/z.pdf`, fazenda_id: FAZENDA_B },
    ]
  })

  it('sem fazenda identificada no token: 400, não gera signed URL', async () => {
    const { req, res, next } = criarReqRes({ params: { id: 'doc-a1' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(createSignedUrlMock).not.toHaveBeenCalled()
  })

  it('documento da própria fazenda: gera signed URL de 60s e devolve { url }', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://storage.example/assinado' }, error: null })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'doc-a1' } })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ url: 'https://storage.example/assinado' })
    expect(createSignedUrlMock).toHaveBeenCalledWith(`${FAZENDA_A}/x.pdf`, 60)
  })

  // ISOLAMENTO POR FAZENDA — o tipo de bug que este projeto já teve 3 vezes.
  // Signed URL do Storage NÃO passa pela RLS do Postgres; se a rota confiasse
  // só no :id (sem cruzar com fazenda_id), fazenda A leria o PDF da fazenda B
  // trocando o id na URL (IDOR).
  it('IDOR: fazenda A pedindo :id de documento da fazenda B recebe 404, nunca gera signed URL do arquivo alheio', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'doc-b1' } })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)
    expect(createSignedUrlMock).not.toHaveBeenCalled()
  })

  it(':id inexistente: 404, não gera signed URL', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'nao-existe' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(404)
    expect(createSignedUrlMock).not.toHaveBeenCalled()
  })

  it('falha ao gerar signed URL (erro do Storage): 500', async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: 'bucket indisponível' } })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'doc-a1' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(500)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// A lógica de exclusão em si (ordem itens→documento pela FK RESTRICT, marcar
// 'erro' em falha parcial, limpeza do Storage) tem cobertura própria em
// excluirDocumentoControle.test.ts — aqui só o mapeamento status→HTTP da
// rota, mesmo padrão de POST /controle/documentos com gravarDocumentoDoPdf
// mockado. Isolamento entre fazendas fica a cargo do PRÓPRIO service (que já
// recebe fazendaId da sessão, nunca do :id) — coberto lá, não repetido aqui.
describe('DELETE /controle/documentos/:id', () => {
  const handler = pegarHandler('delete', '/:id')

  it('sem fazenda identificada no token: 400, não chama o service', async () => {
    const { req, res, next } = criarReqRes({ params: { id: 'doc-1' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
    expect(excluirDocumentoControleMock).not.toHaveBeenCalled()
  })

  it('service devolve nao_encontrado: 404 com mensagem', async () => {
    excluirDocumentoControleMock.mockResolvedValue({ status: 'nao_encontrado' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'doc-x' } })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'Documento não encontrado.' })
    expect(excluirDocumentoControleMock).toHaveBeenCalledWith('doc-x', FAZENDA_A)
  })

  it('sucesso: 204 sem corpo', async () => {
    excluirDocumentoControleMock.mockResolvedValue({ status: 'excluido' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'doc-1' } })
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(204)
    expect(res.sent).toBe(true)
    expect(res.body).toBeUndefined()
  })

  it('service devolve erro: 500 com detalhe', async () => {
    excluirDocumentoControleMock.mockResolvedValue({ status: 'erro', mensagem: 'lock timeout' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA_A, params: { id: 'doc-1' } })
    await handler(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ detalhe: 'lock timeout' })
  })
})
