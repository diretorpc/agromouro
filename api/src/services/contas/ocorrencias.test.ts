import { describe, it, expect } from 'vitest'
import { ocorrenciasEsperadas, ocorrenciasFaltantes, type Regra } from './ocorrencias'

const base: Regra = {
  id: 'r1', periodicidade: 'mensal', dia_vencimento: 10,
  mes_primeira: null, ativa: true,
}

describe('ocorrenciasEsperadas', () => {
  it('mensal gera uma por mes da janela', () => {
    const r = ocorrenciasEsperadas(base, { ano: 2026, mes: 7 }, { ano: 2026, mes: 9 })
    expect(r.map(o => o.competencia)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(r[0].vencimento).toBe('2026-07-10')
    expect(r[0].recorrente_id).toBe('r1')
  })

  it('regra inativa nao gera nada', () => {
    const r = ocorrenciasEsperadas({ ...base, ativa: false }, { ano: 2026, mes: 7 }, { ano: 2026, mes: 9 })
    expect(r).toEqual([])
  })

  it('semestral com mes_primeira 3 cai em marco e setembro, e em mais nenhum', () => {
    const regra: Regra = { ...base, periodicidade: 'semestral', mes_primeira: 3 }
    const r = ocorrenciasEsperadas(regra, { ano: 2026, mes: 1 }, { ano: 2026, mes: 12 })
    expect(r.map(o => o.competencia)).toEqual(['2026-03-01', '2026-09-01'])
  })

  it('anual so cai no mes da primeira', () => {
    const regra: Regra = { ...base, periodicidade: 'anual', mes_primeira: 5 }
    const r = ocorrenciasEsperadas(regra, { ano: 2026, mes: 1 }, { ano: 2027, mes: 12 })
    expect(r.map(o => o.competencia)).toEqual(['2026-05-01', '2027-05-01'])
  })

  it('trimestral com mes_primeira 2 cai de 3 em 3 meses', () => {
    const regra: Regra = { ...base, periodicidade: 'trimestral', mes_primeira: 2 }
    const r = ocorrenciasEsperadas(regra, { ano: 2026, mes: 1 }, { ano: 2026, mes: 12 })
    expect(r.map(o => o.competencia)).toEqual(['2026-02-01', '2026-05-01', '2026-08-01', '2026-11-01'])
  })

  it('aplica o dia 31 ao ultimo dia de fevereiro', () => {
    const regra: Regra = { ...base, dia_vencimento: 31 }
    const r = ocorrenciasEsperadas(regra, { ano: 2026, mes: 2 }, { ano: 2026, mes: 2 })
    expect(r[0].vencimento).toBe('2026-02-28')
  })

  it('atravessa a virada de ano', () => {
    const r = ocorrenciasEsperadas(base, { ano: 2026, mes: 12 }, { ano: 2027, mes: 1 })
    expect(r.map(o => o.competencia)).toEqual(['2026-12-01', '2027-01-01'])
  })
})

describe('ocorrenciasFaltantes', () => {
  it('tira as que ja existem no banco', () => {
    const esperadas = ocorrenciasEsperadas(base, { ano: 2026, mes: 7 }, { ano: 2026, mes: 9 })
    const faltam = ocorrenciasFaltantes(esperadas, [
      { recorrente_id: 'r1', competencia: '2026-08-01' },
    ])
    expect(faltam.map(o => o.competencia)).toEqual(['2026-07-01', '2026-09-01'])
  })

  it('nao confunde competencia igual de regras diferentes', () => {
    const esperadas = ocorrenciasEsperadas(base, { ano: 2026, mes: 7 }, { ano: 2026, mes: 7 })
    const faltam = ocorrenciasFaltantes(esperadas, [
      { recorrente_id: 'OUTRA', competencia: '2026-07-01' },
    ])
    expect(faltam).toHaveLength(1)
  })

  it('devolve vazio quando tudo ja existe', () => {
    const esperadas = ocorrenciasEsperadas(base, { ano: 2026, mes: 7 }, { ano: 2026, mes: 7 })
    expect(ocorrenciasFaltantes(esperadas, esperadas)).toEqual([])
  })
})
