import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Fallback 'mg' na URL do webhook precisa GRITAR, não silenciar ───────────
// Medido em produção (24/08/2026): existem 3 fazendas (mg, tejuco, mt) e TODO
// o dado hoje está em mg (18 talhões, 56 insumos, 55 linhas de estoque —
// tejuco e mt vazias). Se a URL configurada na Z-API não passar ?fazenda=, uma
// mensagem de QUALQUER fazenda cairia sempre em mg, e cairia "certa" por
// coincidência (é o único banco com dado) — nada no comportamento do bot
// denunciaria o problema. Como ainda não dá pra confirmar se a URL em produção
// passa o parâmetro (falta ZAPI_CLIENT_TOKEN no .env local para consultar a
// config), o fallback continua ligado (zero risco de derrubar o bot), mas
// precisa aparecer no log de erro toda vez que precisar adivinhar.
//
// Sem supertest/servidor HTTP — mesmo padrão de controle.test.ts: pega o
// handler direto do .stack do Router e chama com req/res fake.

const { estadoBanco } = vi.hoisted(() => ({
  estadoBanco: {
    fazendas: [
      { id: 'fazenda-mg-id', codigo: 'mg' },
      { id: 'fazenda-mt-id', codigo: 'mt' },
    ] as any[],
  },
}))

vi.mock('../services/supabase', () => {
  function fazendasBuilder() {
    let codigoFiltro: string | undefined
    const obj: any = {
      select: vi.fn(() => obj),
      eq: vi.fn((campo: string, valor: any) => {
        if (campo === 'codigo') codigoFiltro = valor
        return obj
      }),
      single: vi.fn(async () => {
        const linha = estadoBanco.fazendas.find(f => f.codigo === codigoFiltro)
        // Nas duas fazendas do fixture NÃO existe nenhuma que force o handler
        // a seguir além da resolução de fazenda_codigo — de propósito: o alvo
        // deste teste é só o log do fallback, não o fluxo de processamento
        // completo (que chamaria a API real da Anthropic em background).
        return { data: null, error: { message: 'not found' } }
      }),
    }
    return obj
  }
  return {
    supabase: { from: vi.fn((_tabela: string) => fazendasBuilder()) },
  }
})

// enviarMensagem é a resposta que chega ao agricultor no WhatsApp — mockado
// para o Item 2 (mensagem nunca pode ser engolida em silêncio) sem disparar
// requisição HTTPS real para a Z-API.
const { enviarMensagemMock } = vi.hoisted(() => ({ enviarMensagemMock: vi.fn().mockResolvedValue(true) }))
vi.mock('../services/zapi', () => ({
  enviarMensagem: enviarMensagemMock,
  getAuthorizedPhones: vi.fn(() => [] as string[]),
}))

import { whatsappWebhook } from './whatsapp'

function pegarHandlerPost(path: string) {
  const layer = (whatsappWebhook as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.post,
  )
  if (!layer) throw new Error(`Rota POST ${path} não encontrada`)
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>
}

function criarReqRes(query: Record<string, any> = {}) {
  const req: any = {
    body: { phone: '5511999998888', text: { message: 'quanto tem de glifosato?' } },
    query,
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

let erroSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  enviarMensagemMock.mockClear()
  erroSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  erroSpy.mockRestore()
})

describe('POST /webhook/whatsapp — fallback de fazenda_codigo', () => {
  const handler = pegarHandlerPost('/')

  it('SEM ?fazenda= na URL: dispara console.error e ainda assim processa como \'mg\'', async () => {
    const { req, res, next } = criarReqRes({}) // sem query.fazenda
    await handler(req, res, next)

    // O fixture NUNCA acha a fazenda (de propósito — ver comentário do mock),
    // então o 1º log é o fallback e o 2º é "fazenda não encontrada" (Item 2).
    expect(erroSpy).toHaveBeenCalledTimes(2)
    const [mensagemFallback] = erroSpy.mock.calls[0]
    expect(mensagemFallback).toContain("assumindo fazenda 'mg'")
    expect(mensagemFallback).toContain('?fazenda=')

    // "processa como mg": a fazenda efetivamente consultada foi 'mg', não
    // vazia nem undefined — confirma que o fallback continua funcionando.
    const { supabase } = await import('../services/supabase')
    const fromCall = (supabase.from as any).mock.results[0].value
    expect(fromCall.eq).toHaveBeenCalledWith('codigo', 'mg')
  })

  it('COM ?fazenda=mt na URL: NÃO dispara o log de fallback (só o de "fazenda não encontrada")', async () => {
    const { req, res, next } = criarReqRes({ fazenda: 'mt' })
    await handler(req, res, next)

    expect(erroSpy).toHaveBeenCalledTimes(1)
    expect(erroSpy.mock.calls[0][0]).not.toContain("assumindo fazenda 'mg'")

    const { supabase } = await import('../services/supabase')
    const fromCall = (supabase.from as any).mock.results[0].value
    expect(fromCall.eq).toHaveBeenCalledWith('codigo', 'mt')
  })

  // ─── req.query.fazenda nem sempre é string (Item 1 — regressão da Tarefa 4-lite) ─
  // Express 4 usa `qs` com extended por padrão: "fazenda=mg&fazenda=mt" vira
  // ["mg","mt"]; "fazenda[]=mg" vira ["mg"]; "fazenda[a]=1" vira {a:"1"}. Um
  // `.trim()` direto num array/objeto lança TypeError. Como o handler é async
  // e o Express 4 não captura rejeição de promise de handler (sem
  // process.on('unhandledRejection') em api/src), isso derrubava o PROCESSO
  // inteiro, não só a mensagem — reproduzido de verdade num round anterior
  // desta correção. O critério aqui é o handler NUNCA rejeitar, não importa a
  // forma de req.query.fazenda.
  it('?fazenda=mg&fazenda=mt (array, qs de verdade): NÃO rejeita a promise do handler, cai no fallback com log', async () => {
    const { req, res, next } = criarReqRes({ fazenda: ['mg', 'mt'] })

    await expect(handler(req, res, next)).resolves.toBeUndefined()

    // 1º log = fallback (Item 1); 2º log = fazenda não encontrada (Item 2) —
    // o fixture nunca acha fazenda nenhuma, de propósito.
    const [mensagem] = erroSpy.mock.calls[0]
    expect(mensagem).toContain("assumindo fazenda 'mg'")
  })

  it('?fazenda[]=mg (array de 1 item): mesmo comportamento — não rejeita, cai no fallback', async () => {
    const { req, res, next } = criarReqRes({ fazenda: ['mg'] })

    await expect(handler(req, res, next)).resolves.toBeUndefined()

    const [mensagem] = erroSpy.mock.calls[0]
    expect(mensagem).toContain("assumindo fazenda 'mg'")
  })

  it('?fazenda[a]=1 (objeto): mesmo comportamento — não rejeita, cai no fallback', async () => {
    const { req, res, next } = criarReqRes({ fazenda: { a: '1' } })

    await expect(handler(req, res, next)).resolves.toBeUndefined()

    const [mensagem] = erroSpy.mock.calls[0]
    expect(mensagem).toContain("assumindo fazenda 'mg'")
  })
})

// ─── Item 2 — fazenda não encontrada NUNCA pode engolir a mensagem em silêncio ─
// É o pior modo de falha deste projeto: o agricultor não tem outro canal além
// do WhatsApp. Alcançável de verdade: o .env.example chegou a documentar um
// código de fazenda 'sp' que não existe — se a URL na Z-API tiver ?fazenda=sp,
// toda mensagem cairia aqui e sumiria (hipótese não confirmada, mas o canal só
// produziu 1 operação na vida, em 22/06/2026, e nada depois).
describe('POST /webhook/whatsapp — fazenda não encontrada', () => {
  const handler = pegarHandlerPost('/')

  it('avisa o agricultor via enviarMensagem, loga com console.error e prefixo [WhatsApp] (não [WA])', async () => {
    const { req, res, next } = criarReqRes({ fazenda: 'sp' }) // código documentado no .env.example que não existe
    await handler(req, res, next)

    expect(enviarMensagemMock).toHaveBeenCalledTimes(1)
    const [telefoneChamado, mensagemAoAgricultor, fazendaCodigoChamado] = enviarMensagemMock.mock.calls[0]
    expect(telefoneChamado).toBe('5511999998888')
    expect(typeof mensagemAoAgricultor).toBe('string')
    expect(mensagemAoAgricultor.length).toBeGreaterThan(0)
    expect(fazendaCodigoChamado).toBe('mg') // instância Z-API que sabemos que funciona

    // Grep "[WhatsApp]" precisa achar esta linha — "[WA]" (prefixo antigo) não.
    const chamadaComFazendaNaoEncontrada = erroSpy.mock.calls.find(([msg]) => String(msg).includes('não encontrada'))
    expect(chamadaComFazendaNaoEncontrada, 'nenhum console.error mencionou "não encontrada"').toBeTruthy()
    expect(chamadaComFazendaNaoEncontrada![0]).toContain('[WhatsApp]')
    expect(chamadaComFazendaNaoEncontrada![0]).not.toContain('[WA]')
  })
})
