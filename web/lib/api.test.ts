import { describe, it, expect } from 'vitest'
import { ApiError, ehErroDeValidacao } from './api'

// Achado 6 da revisão do Apolo (18/08/2026, 3ª rodada): "web/" tinha ZERO
// arquivo de teste. `ehErroDeValidacao` decide se uma falha de PATCH marca
// só a linha (`grade-itens.tsx`) ou recarrega a grade inteira
// (`use-controle-itens.ts`) — errar essa decisão prende o usuário numa
// linha fantasma (404) ou numa sessão expirada (401) sem caminho de
// recuperação, ou perde a proteção de "não mentir na tela" (400/409).

describe('ehErroDeValidacao', () => {
  // Achado 2 da revisão do Apolo (18/08/2026, 3ª rodada): a 1ª versão
  // aceitava QUALQUER 4xx — a função tinha que ser restrita a 400/409.
  it('400 (corpo recusado pelo zod) e 409 (conflito de duplicidade): SÃO erro de validação', () => {
    expect(ehErroDeValidacao(new ApiError('Corpo inválido.', 400))).toBe(true)
    expect(ehErroDeValidacao(new ApiError('Já existe um item idêntico...', 409))).toBe(true)
  })

  it('401/403 (token expirado/sem permissão): NÃO são erro de validação — precisam recarregar', () => {
    expect(ehErroDeValidacao(new ApiError('Não autorizado.', 401))).toBe(false)
    expect(ehErroDeValidacao(new ApiError('Acesso negado.', 403))).toBe(false)
  })

  it('404 (item apagado em outra aba): NÃO é erro de validação — precisa recarregar pra tirar o fantasma da tela', () => {
    expect(ehErroDeValidacao(new ApiError('Item não encontrado.', 404))).toBe(false)
  })

  it('5xx (erro do servidor): NÃO é erro de validação — precisa recarregar', () => {
    expect(ehErroDeValidacao(new ApiError('Erro ao editar o item.', 500))).toBe(false)
    expect(ehErroDeValidacao(new ApiError('Serviço indisponível.', 503))).toBe(false)
  })

  it('erro que não é ApiError (ex.: falha de rede, fetch nem completou): NÃO é erro de validação', () => {
    expect(ehErroDeValidacao(new TypeError('Failed to fetch'))).toBe(false)
    expect(ehErroDeValidacao(new Error('erro genérico'))).toBe(false)
    expect(ehErroDeValidacao('string qualquer')).toBe(false)
    expect(ehErroDeValidacao(null)).toBe(false)
  })

  it('fronteira: 399 e 500 exatos ficam FORA (só 400 e 409 valem)', () => {
    expect(ehErroDeValidacao(new ApiError('x', 399))).toBe(false)
    expect(ehErroDeValidacao(new ApiError('x', 500))).toBe(false)
  })
})
