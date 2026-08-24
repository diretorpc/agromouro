import { describe, it, expect } from 'vitest'
import { ehFalhaDeConexao, mensagemErroBanco } from './erros-supabase'

// As quatro frases REAIS de falha de rede, uma por runtime. Estão aqui porque
// a 1ª versão deste módulo só reconhecia a do Chrome — e o aparelho mais
// provável no campo é justamente o iPhone, que escreve "Load failed".
const FRASES_DE_REDE = [
  ['Chrome',      'TypeError: Failed to fetch'],
  ['Node/undici', 'TypeError: fetch failed'],
  ['Safari/iOS',  'TypeError: Load failed'],
  ['Firefox',     'NetworkError when attempting to fetch resource.'],
] as const

describe('ehFalhaDeConexao', () => {
  it.each(FRASES_DE_REDE)('reconhece a frase do %s', (_runtime, message) => {
    expect(ehFalhaDeConexao({ code: '', message })).toBe(true)
  })

  it('reconhece pelo code vazio mesmo com frase desconhecida', () => {
    expect(ehFalhaDeConexao({ code: '', message: 'algo que nenhum runtime escreve' })).toBe(true)
  })

  it('reconhece pelo status 0 — nenhuma resposta HTTP chegou', () => {
    expect(ehFalhaDeConexao({ status: 0, code: '23505' })).toBe(true)
  })

  it('NÃO confunde erro legítimo do Postgres com queda de rede', () => {
    expect(ehFalhaDeConexao({ code: '23505', message: 'duplicate key value' })).toBe(false)
    expect(ehFalhaDeConexao({ code: '42501', message: 'permission denied' })).toBe(false)
  })

  // O caso que motivou trocar o discriminador: apikey errada num deploy da
  // Vercel faz o gateway responder 401 SEM `code`. Com a internet perfeita.
  it('apikey errada (401 do gateway, sem code) NÃO é falta de internet', () => {
    expect(ehFalhaDeConexao({ status: 401, message: 'No API key found in request' })).toBe(false)
  })

  it.each([400, 403, 404, 500, 502])('houve resposta HTTP %i — não é falta de rede', (status) => {
    expect(ehFalhaDeConexao({ status, message: 'qualquer coisa' })).toBe(false)
  })
})

describe('mensagemErroBanco — códigos traduzidos', () => {
  it('23502 (coluna obrigatória vazia) aponta a fazenda — foi o bug do talhão', () => {
    expect(mensagemErroBanco({ code: '23502', message: 'null value in column "fazenda_id"' }, 'talhão'))
      .toBe('Faltou informar a fazenda. Recarregue a página e tente de novo.')
  })

  it('23505 usa a entidade recebida', () => {
    expect(mensagemErroBanco({ code: '23505', message: 'duplicate key' }, 'talhão'))
      .toBe('Já existe um talhão com esse nome.')
    expect(mensagemErroBanco({ code: '23505', message: 'duplicate key' }, 'produto'))
      .toBe('Já existe um produto com esse nome.')
  })

  it('23503 é frase NEUTRA — não afirma "não pode ser excluído" num erro de salvar', () => {
    const msg = mensagemErroBanco({ code: '23503', message: 'foreign key' }, 'talhão')
    expect(msg).toBe('Este talhão está ligado a outros registros do sistema.')
    expect(msg).not.toContain('excluí')
  })

  it('42501 (RLS barrou) fala de permissão, não de "permission denied"', () => {
    expect(mensagemErroBanco({ code: '42501', message: 'permission denied' }, 'talhão'))
      .toBe('Seu acesso não permite gravar nesta fazenda.')
  })
})

describe('mensagemErroBanco — rede e fallback', () => {
  it.each(FRASES_DE_REDE)('%s nunca despeja inglês na tela do produtor', (_runtime, message) => {
    expect(mensagemErroBanco({ code: '', message }, 'talhão'))
      .toBe('Sem conexão com o servidor. Verifique a internet e tente de novo.')
  })

  it('sessão vencida (401) manda ENTRAR de novo, não tentar de novo', () => {
    expect(mensagemErroBanco({ status: 401, message: 'JWT expired' }, 'talhão'))
      .toBe('Sua sessão expirou ou o acesso foi negado. Entre de novo.')
  })

  it('403 cai na mesma frase de sessão/acesso', () => {
    expect(mensagemErroBanco({ status: 403, message: 'forbidden' }, 'talhão'))
      .toBe('Sua sessão expirou ou o acesso foi negado. Entre de novo.')
  })

  // Apikey errada TAMBÉM chega como 401, mas "entre de novo" não conserta
  // variável de ambiente — o produtor tentaria login para sempre.
  it('apikey errada aponta configuração, não login', () => {
    expect(mensagemErroBanco({ status: 401, message: 'No API key found in request' }, 'talhão'))
      .toBe('Erro de configuração do sistema. Avise o suporte.')
  })

  it.each([500, 502, 503, 504])('%i vira "servidor fora do ar", sem vazar corpo do gateway', (status) => {
    expect(mensagemErroBanco({ status, message: '<html><head><title>502 Bad Gateway</title>' }, 'talhão'))
      .toBe('O servidor está fora do ar no momento. Tente de novo em alguns minutos.')
  })

  it('mensagem VAZIA não vira "Erro: " pelado — `??` deixava string vazia passar', () => {
    expect(mensagemErroBanco({ status: 400, message: '' }, 'talhão')).toBe('Erro: sem detalhe')
    expect(mensagemErroBanco({ status: 400, message: '   ' }, 'talhão')).toBe('Erro: sem detalhe')
  })

  it('4xx sem code não imprime "Erro ()" na tela', () => {
    const msg = mensagemErroBanco({ status: 400, message: 'bad request' }, 'talhão')
    expect(msg).toBe('Erro: bad request')
    expect(msg).not.toContain('()')
  })

  it('código sem tradução preserva o código, para o suporte', () => {
    expect(mensagemErroBanco({ code: 'PGRST116', message: 'no rows returned' }, 'talhão'))
      .toBe('Erro (PGRST116): no rows returned')
  })

  it('código sem tradução e sem mensagem não quebra', () => {
    expect(mensagemErroBanco({ code: 'PGRST116' }, 'talhão'))
      .toBe('Erro (PGRST116): sem detalhe')
  })
})
