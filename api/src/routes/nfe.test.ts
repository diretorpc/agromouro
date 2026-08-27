import { describe, it, expect, vi, beforeEach } from 'vitest'

// A rota só decide o mapeamento status→HTTP e a frase em português que chega
// na tela. A leitura e a gravação têm cobertura própria em
// services/nfe/notaPdf.test.ts e services/nfe/gravarNotaDoPdf.test.ts.
//
// `validarNotaLida` NÃO é mockada de propósito: a rota de importação a chama
// de novo sobre o que o navegador devolveu, e provar que um corpo torto é
// recusado ANTES de tocar no banco é o ponto principal deste arquivo.

const { lerNotaPdfMock, gravarNotaDoPdfMock, nfeJaProcessadaMock, createSignedUrlMock, estado } = vi.hoisted(() => ({
  lerNotaPdfMock: vi.fn(),
  gravarNotaDoPdfMock: vi.fn(),
  nfeJaProcessadaMock: vi.fn(),
  createSignedUrlMock: vi.fn(),
  estado: { nota: null as any },
}))

vi.mock('../services/nfe/notaPdf', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  lerNotaPdf: lerNotaPdfMock,
}))

vi.mock('../services/nfe/gravarNotaDoPdf', () => ({ gravarNotaDoPdf: gravarNotaDoPdfMock }))

// nfeManual (importado por nfe.ts) também consome este módulo — por isso as
// três chaves, não só a que as rotas novas usam.
vi.mock('../services/nfeProcessor', () => ({
  nfeJaProcessada: nfeJaProcessadaMock,
  processarNFe:    vi.fn(),
  parseXmlNota:    vi.fn(),
}))

vi.mock('../services/supabase', () => {
  // O `eq` GUARDA os filtros para o teste poder responder por modelo. Sem isso,
  // o mock devolvia a mesma linha para qualquer consulta e nenhum teste
  // conseguia pegar inversao de `notasNoBanco.nfe` com `.nfse` — achado
  // [medio] do Apolo, 6a rodada (27/08/2026): trocar os dois lados na rota
  // deixava as 734 verdes, e a tela travaria o modelo certo e liberaria o
  // errado, que e' o defeito que a rodada veio consertar.
  function builder(): any {
    const filtros: Record<string, unknown> = {}
    const obj: any = {
      select:      () => obj,
      eq:          (coluna: string, valor: unknown) => { filtros[coluna] = valor; return obj },
      maybeSingle: async () => ({
        data: typeof estado.nota === 'function' ? estado.nota(filtros) : estado.nota,
        error: null,
      }),
    }
    return obj
  }
  return {
    supabase: {
      from: () => builder(),
      storage: { from: () => ({ createSignedUrl: createSignedUrlMock }) },
    },
  }
})

import { nfeRoutes } from './nfe'

const FAZENDA = 'fazenda-1'
const PDF_BASE64 = Buffer.from('%PDF-1.4 teste').toString('base64')

const NOTA_LIDA = {
  modelo: 'nfe', numero: '58717', emitenteNome: 'SOLOS', emitenteCnpj: '04063805000135',
  dataEmissao: '2026-08-10', valorTotal: 4400, formaPagamento: '15',
  duplicatas: [],
  itens: [{
    descricao: 'TEBURAZ', quantidade: 5, unidade: 'L', valorUnitario: 880, valorTotal: 4400,
    quantidadeTrib: 5, unidadeTrib: 'L', ncm: '38089329', cfop: '5102',
  }],
}

function pegarHandler(method: 'get' | 'post' | 'delete', path: string) {
  const layer = (nfeRoutes as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  )
  if (!layer) throw new Error(`Rota não encontrada: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>
}

function criarReqRes(overrides: { fazendaId?: string; body?: any; params?: Record<string, string> } = {}) {
  const req: any = {
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    user: overrides.fazendaId ? { app_metadata: { fazenda_ativa_id: overrides.fazendaId } } : undefined,
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
  estado.nota = null
  nfeJaProcessadaMock.mockResolvedValue(false)
})

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /nfe/ler-pdf', () => {
  const handler = pegarHandler('post', '/ler-pdf')
  const corpoValido = { arquivo: PDF_BASE64, nomeArquivo: 'nf.pdf' }

  it('sem fazenda no token: 400, nao chama o leitor', async () => {
    const { req, res, next } = criarReqRes({ body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(400)
    expect(lerNotaPdfMock).not.toHaveBeenCalled()
  })

  it('corpo sem arquivo: 400', async () => {
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: { nomeArquivo: 'nf.pdf' } })
    await handler(req, res, next)
    expect(res.statusCode).toBe(400)
    expect(lerNotaPdfMock).not.toHaveBeenCalled()
  })

  it('leitura boa: 200 com a nota e jaExiste nulo', async () => {
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(200)
    expect(res.body.nota.numero).toBe('58717')
    expect(res.body.jaExiste).toBeNull()
  })

  it('avisos de descarte chegam na resposta — nunca somem calados', async () => {
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 3, duplicatasDescartadas: 1 })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.body.itensDescartados).toBe(3)
    expect(res.body.duplicatasDescartadas).toBe(1)
  })

  it('nota que ja existe: 200 com jaExiste preenchido — quem barra e a tela', async () => {
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    nfeJaProcessadaMock.mockResolvedValue(true)
    estado.nota = { id: 'ja', numero: '58717', data_emissao: '2026-06-08', emitente_nome: 'SOLOS' }
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(200)
    expect(res.body.jaExiste.id).toBe('ja')
  })

  it('nota com o mesmo numero no OUTRO modelo vira aviso, nao bloqueio', async () => {
    // Achado 6 do Apolo: `modelo` entra na chave de duplicidade (migration 011).
    // Um DANFE classificado como NFS-e nao acha a nota que o Make gravou como
    // NF-e — nem aqui, nem no indice unico — e a compra entra duas vezes.
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    nfeJaProcessadaMock.mockResolvedValue(false)
    estado.nota = { id: 'gemea', numero: '58717', data_emissao: '2026-08-10', emitente_nome: 'SOLOS' }
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(200)
    expect(res.body.jaExiste).toBeNull()
    expect(res.body.existeNoOutroModelo.id).toBe('gemea')
  })

  it('quando a nota ja existe no MESMO modelo, nao repete o aviso do outro', async () => {
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    nfeJaProcessadaMock.mockResolvedValue(true)
    estado.nota = { id: 'ja', numero: '58717', data_emissao: '2026-06-08', emitente_nome: 'SOLOS' }
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.body.jaExiste.id).toBe('ja')
    expect(res.body.existeNoOutroModelo).toBeNull()
  })

  it('devolve as DUAS consultas por modelo, mesmo quando a nota ja existe', async () => {
    // Achado [alto] do Apolo, 5a rodada (27/08/2026): `existeNoOutroModelo` era
    // curto-circuitado quando `jaExiste` estava preenchido, e a tela ficava CEGA
    // para a gemea do outro modelo justo quando o dono ia mexer no campo "Tipo".
    // Sem saber das duas, ela travava a nota LEGITIMA do outro modelo (NF-e n 500
    // de pecas + NFS-e n 500 de mao de obra, o par da migration 011).
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    nfeJaProcessadaMock.mockResolvedValue(true)
    estado.nota = { id: 'ja', numero: '58717', data_emissao: '2026-06-08', emitente_nome: 'SOLOS' }
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    // NOTA_LIDA e' 'nfe': a gemea encontrada entra nos dois lados porque o mock
    // devolve a mesma linha para qualquer consulta — o que importa e' que o
    // campo do OUTRO modelo deixou de vir vazio.
    expect(res.body.notasNoBanco.nfe.id).toBe('ja')
    expect(res.body.notasNoBanco.nfse.id).toBe('ja')
    // E os campos antigos seguem com o MESMO significado, para a web mais velha
    // que esta API (elas sobem separadas).
    expect(res.body.jaExiste.id).toBe('ja')
    expect(res.body.existeNoOutroModelo).toBeNull()
  })

  it('notasNoBanco poe cada gemea no SEU lado — pega inversao nfe/nfse', async () => {
    // NOTA_LIDA e 'nfe'. A gemea existe SO como NFS-e: o lado nfe tem que vir
    // nulo e o nfse preenchido. Com os dois lados iguais, uma inversao passaria
    // despercebida (achado [medio] do Apolo, 6a rodada).
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    nfeJaProcessadaMock.mockResolvedValue(false)
    estado.nota = (f: any) => f.modelo === 'nfse'
      ? { id: 'so-nfse', numero: '58717', data_emissao: '2026-08-10', emitente_nome: 'SOLOS', valor_total: 4400 }
      : null
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.body.notasNoBanco.nfe).toBeNull()
    expect(res.body.notasNoBanco.nfse.id).toBe('so-nfse')
    expect(res.body.notasNoBanco.nfse.valor_total).toBe(4400)
  })

  it('sem gemea nenhuma, notasNoBanco vem com os dois lados nulos', async () => {
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    nfeJaProcessadaMock.mockResolvedValue(false)
    estado.nota = null
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.body.notasNoBanco).toEqual({ nfe: null, nfse: null })
  })

  it('devolve as familias de efeito e a familia de cada item', async () => {
    // Achado 2 do Apolo: CFOP ilegivel vira "compra" por omissao e dobra o
    // gasto numa nota de entrega futura. A tela deixa o dono escolher o EFEITO,
    // e a lista vem pronta da API — regra fiscal mora em contas/cfop.ts.
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)

    expect(res.body.familias.map((f: any) => f.chave))
      .toEqual(['compra', 'entrega-faturada', 'faturamento', 'bonificacao'])
    expect(res.body.nota.itens[0].familia).toBe('compra')   // CFOP 5102 lido
  })

  it('item SEM CFOP volta com familia vazia — a tela nao pode ja mostrar "compra"', async () => {
    const semCfop = { ...NOTA_LIDA, itens: [{ ...NOTA_LIDA.itens[0], cfop: '' }] }
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: semCfop, itensDescartados: 0, duplicatasDescartadas: 0 })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)

    expect(res.body.nota.itens[0].familia).toBe('')
  })

  it('CFOP de entrega futura volta na familia certa, nao em compra', async () => {
    const entrega = { ...NOTA_LIDA, itens: [{ ...NOTA_LIDA.itens[0], cfop: '5117' }] }
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: entrega, itensDescartados: 0, duplicatasDescartadas: 0 })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)

    expect(res.body.nota.itens[0].familia).toBe('entrega-faturada')
  })

  it('devolve cfopLido — o CFOP tal como a IA leu, congelado pra tela distinguir leitura de escolha do dono', async () => {
    // Achado [baixo] do Apolo, 3ª rodada (24/08/2026): sem isto, um item sem
    // CFOP em que o dono escolhe "Compra normal" (grava 5102) imprimia
    // "CFOP 5102" embaixo do select, idêntico ao que teria sido lido de
    // verdade — o `lidoOriginal` do commit anterior existe justamente para
    // separar leitura de edição, e este achado era a mesma brecha no item.
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: NOTA_LIDA, itensDescartados: 0, duplicatasDescartadas: 0 })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)

    expect(res.body.nota.itens[0].cfopLido).toBe(NOTA_LIDA.itens[0].cfop)
  })

  it('cfopLido continua vazio quando o item veio sem CFOP', async () => {
    const semCfop = { ...NOTA_LIDA, itens: [{ ...NOTA_LIDA.itens[0], cfop: '' }] }
    lerNotaPdfMock.mockResolvedValue({ status: 'nota', nota: semCfop, itensDescartados: 0, duplicatasDescartadas: 0 })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)

    expect(res.body.nota.itens[0].cfopLido).toBe('')
  })

  it('cada recusa de conteudo vira 422 com mensagem em portugues', async () => {
    for (const status of ['nao-nota', 'sem-identidade', 'sem-itens', 'grande-demais']) {
      lerNotaPdfMock.mockResolvedValue({ status })
      const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
      await handler(req, res, next)
      expect(res.statusCode).toBe(422)
      expect(typeof res.body.error).toBe('string')
      expect(res.body.error.length).toBeGreaterThan(0)
    }
  })

  it('dados-invalidos nomeia o campo que o dono precisa corrigir', async () => {
    lerNotaPdfMock.mockResolvedValue({ status: 'dados-invalidos', campo: 'valorTotal' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toContain('valor total')

    lerNotaPdfMock.mockResolvedValue({ status: 'dados-invalidos', campo: 'dataEmissao' })
    const segundo = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(segundo.req, segundo.res, segundo.next)
    expect(segundo.res.body.error).toContain('data de emissão')
  })

  it('IA fora do ar vira 503, nunca 422 — 422 diria "seu arquivo e invalido"', async () => {
    lerNotaPdfMock.mockResolvedValue({ status: 'falha', motivo: 'overloaded' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(503)
    expect(typeof res.body.error).toBe('string')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /nfe/importar-pdf', () => {
  const handler = pegarHandler('post', '/importar-pdf')
  const corpoValido = { arquivo: PDF_BASE64, nomeArquivo: 'nf.pdf', nota: NOTA_LIDA }

  it('sem fazenda no token: 400', async () => {
    const { req, res, next } = criarReqRes({ body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(400)
    expect(gravarNotaDoPdfMock).not.toHaveBeenCalled()
  })

  it('grava e devolve 201', async () => {
    gravarNotaDoPdfMock.mockResolvedValue({ status: 'gravada', notaId: 'n1', numero: '58717', emitenteNome: 'SOLOS', valorTotal: 4400 })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(201)
    expect(res.body.notaId).toBe('n1')
  })

  it('a nota EDITADA na tela passa pela MESMA validacao da leitura', async () => {
    // CNPJ de 3 dígitos é recusado AQUI, antes de tocar em banco ou Storage.
    const { req, res, next } = criarReqRes({
      fazendaId: FAZENDA,
      body: { ...corpoValido, nota: { ...NOTA_LIDA, emitenteCnpj: '123' } },
    })
    await handler(req, res, next)
    expect(res.statusCode).toBe(422)
    expect(gravarNotaDoPdfMock).not.toHaveBeenCalled()
  })

  it('nota editada ate ficar sem item nenhum tambem e recusada', async () => {
    const { req, res, next } = criarReqRes({
      fazendaId: FAZENDA,
      body: { ...corpoValido, nota: { ...NOTA_LIDA, itens: [] } },
    })
    await handler(req, res, next)
    expect(res.statusCode).toBe(422)
    expect(gravarNotaDoPdfMock).not.toHaveBeenCalled()
  })

  it('linha descartada no passo 2 RECUSA a nota inteira, em vez de gravar metade', async () => {
    // Achado [medio] do Apolo (27/08/2026): a rota lia so `validada.nota` e
    // jogava `itensDescartados` fora — a nota gravava com 1 de 2 linhas, o
    // painel fechava e ninguem dizia nada. O dono nao edita quantidade na
    // conferencia, entao linha caindo AQUI significa que a nota mudou de
    // natureza entre os dois passos (campo "Tipo" trocado para NF-e).
    const { req, res, next } = criarReqRes({
      fazendaId: FAZENDA,
      body: { ...corpoValido, nota: { ...NOTA_LIDA, itens: [
        NOTA_LIDA.itens[0],
        { descricao: 'SERVICO', quantidade: null, unidade: 'un', valorUnitario: 100, valorTotal: 100, quantidadeTrib: null, unidadeTrib: 'un', ncm: '', cfop: '' },
      ] } },
    })
    await handler(req, res, next)
    expect(res.statusCode).toBe(422)
    expect(res.body.status).toBe('itens-descartados-no-passo-2')
    expect(gravarNotaDoPdfMock).not.toHaveBeenCalled()
  })

  it('a MESMA nota como NFS-e grava inteira — a linha sem quantidade e legitima ali', async () => {
    gravarNotaDoPdfMock.mockResolvedValue({ status: 'gravada', notaId: 'n2', numero: '58717', emitenteNome: 'SOLOS', valorTotal: 4500 })
    const { req, res, next } = criarReqRes({
      fazendaId: FAZENDA,
      body: { ...corpoValido, nota: { ...NOTA_LIDA, modelo: 'nfse', itens: [
        { descricao: 'SERVICO', quantidade: null, unidade: 'un', valorUnitario: 100, valorTotal: 100, quantidadeTrib: null, unidadeTrib: 'un', ncm: '', cfop: '' },
      ] } },
    })
    await handler(req, res, next)
    expect(res.statusCode).toBe(201)
  })

  it('duplicada-nota volta 200: reenviar e resposta valida, nao erro de requisicao', async () => {
    gravarNotaDoPdfMock.mockResolvedValue({
      status: 'duplicada-nota',
      nota: { id: 'ja', numero: '58717', data_emissao: '2026-06-08', emitente_nome: 'SOLOS' },
    })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('duplicada-nota')
  })

  it('duplicada-arquivo volta 200', async () => {
    gravarNotaDoPdfMock.mockResolvedValue({ status: 'duplicada-arquivo' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('duplicada-arquivo')
  })

  it('erro de gravacao vira 500 com mensagem em portugues', async () => {
    gravarNotaDoPdfMock.mockResolvedValue({ status: 'erro', mensagem: 'banco fora' })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, body: corpoValido })
    await handler(req, res, next)
    expect(res.statusCode).toBe(500)
    expect(typeof res.body.error).toBe('string')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /nfe/:id/arquivo', () => {
  const handler = pegarHandler('get', '/:id/arquivo')

  it('devolve a URL assinada', async () => {
    estado.nota = { id: 'n1', arquivo_pdf: 'fazenda-1/abc.pdf' }
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://exemplo/assinado' }, error: null })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, params: { id: 'n1' } })
    await handler(req, res, next)
    expect(res.statusCode).toBe(200)
    expect(res.body.url).toBe('https://exemplo/assinado')
  })

  it('nota sem PDF guardado: 404', async () => {
    estado.nota = { id: 'n1', arquivo_pdf: null }
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, params: { id: 'n1' } })
    await handler(req, res, next)
    expect(res.statusCode).toBe(404)
    expect(createSignedUrlMock).not.toHaveBeenCalled()
  })

  it('nota de outra fazenda: 404 — o filtro de fazenda e a propria consulta', async () => {
    estado.nota = null
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, params: { id: 'n1' } })
    await handler(req, res, next)
    expect(res.statusCode).toBe(404)
  })

  it('falha ao assinar vira 500', async () => {
    estado.nota = { id: 'n1', arquivo_pdf: 'fazenda-1/abc.pdf' }
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: 'bucket indisponivel' } })
    const { req, res, next } = criarReqRes({ fazendaId: FAZENDA, params: { id: 'n1' } })
    await handler(req, res, next)
    expect(res.statusCode).toBe(500)
  })
})
