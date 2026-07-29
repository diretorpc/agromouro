import { describe, it, expect } from 'vitest'
import {
  ultimoDiaDoMes, dataISO, competenciaDoMes,
  vencimentoDoMes, somarMeses, diasEntre,
} from './datas'

describe('ultimoDiaDoMes', () => {
  it('fevereiro comum tem 28', () => {
    expect(ultimoDiaDoMes(2026, 2)).toBe(28)
  })
  it('fevereiro bissexto tem 29', () => {
    expect(ultimoDiaDoMes(2028, 2)).toBe(29)
  })
  it('abril tem 30 e julho tem 31', () => {
    expect(ultimoDiaDoMes(2026, 4)).toBe(30)
    expect(ultimoDiaDoMes(2026, 7)).toBe(31)
  })
})

describe('dataISO', () => {
  it('preenche mes e dia com zero a esquerda', () => {
    expect(dataISO(2026, 7, 5)).toBe('2026-07-05')
  })
})

describe('competenciaDoMes', () => {
  it('e sempre o primeiro dia do mes', () => {
    expect(competenciaDoMes(2026, 7)).toBe('2026-07-01')
  })
})

describe('vencimentoDoMes', () => {
  it('usa o dia pedido quando ele existe', () => {
    expect(vencimentoDoMes(2026, 7, 10)).toBe('2026-07-10')
  })
  it('dia 31 em fevereiro cai no ultimo dia do mes', () => {
    expect(vencimentoDoMes(2026, 2, 31)).toBe('2026-02-28')
  })
  it('dia 31 em abril cai no dia 30', () => {
    expect(vencimentoDoMes(2026, 4, 31)).toBe('2026-04-30')
  })
})

describe('somarMeses', () => {
  it('atravessa a virada de ano', () => {
    expect(somarMeses({ ano: 2026, mes: 12 }, 1)).toEqual({ ano: 2027, mes: 1 })
  })
  it('soma dentro do mesmo ano', () => {
    expect(somarMeses({ ano: 2026, mes: 3 }, 6)).toEqual({ ano: 2026, mes: 9 })
  })
})

describe('diasEntre', () => {
  it('conta dias para frente', () => {
    expect(diasEntre('2026-07-29', '2026-08-01')).toBe(3)
  })
  it('devolve negativo quando a segunda data ja passou', () => {
    expect(diasEntre('2026-07-29', '2026-07-25')).toBe(-4)
  })
  it('nao escorrega no horario de verao', () => {
    expect(diasEntre('2026-10-01', '2026-11-01')).toBe(31)
  })
})
