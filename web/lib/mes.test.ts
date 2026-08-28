import { describe, it, expect } from 'vitest'
import { mesCorrente, hojeLocal } from './mes'

// As duas funções existem pelo MESMO defeito: `toISOString()` converte para UTC,
// e nas últimas 3 horas de cada dia no Brasil isso já aponta para o dia (e às
// vezes o mês) seguinte. `mesCorrente` nasceu disso em 25/08/2026; `hojeLocal`
// veio depois, quando o mesmo `toISOString()` apareceu em mais quatro pontos do
// Financeiro — um deles congelado no carregamento do módulo.
//
// As duas recebem `agora` injetável porque é a única forma de testar a virada.

describe('mesCorrente', () => {
  it('devolve YYYY-MM com zero à esquerda', () => {
    expect(mesCorrente(new Date(2026, 0, 15, 12, 0))).toBe('2026-01')
  })

  it('às 21h do dia 31 NÃO pula para o mês seguinte', () => {
    // Em UTC-3, 21h do dia 31 já é dia 1º em UTC — era a tela do dinheiro
    // abrindo num mês vazio.
    expect(mesCorrente(new Date(2026, 7, 31, 21, 30))).toBe('2026-08')
  })
})

describe('hojeLocal — a data do dia, em hora LOCAL', () => {
  it('devolve YYYY-MM-DD com zero à esquerda', () => {
    expect(hojeLocal(new Date(2026, 0, 5, 10, 0))).toBe('2026-01-05')
  })

  it('às 21h do dia 31 NÃO pula para o dia seguinte', () => {
    expect(hojeLocal(new Date(2026, 7, 31, 21, 30))).toBe('2026-08-31')
  })

  it('meia-noite e um minuto ainda é o dia que começou', () => {
    expect(hojeLocal(new Date(2026, 11, 1, 0, 1))).toBe('2026-12-01')
  })
})
