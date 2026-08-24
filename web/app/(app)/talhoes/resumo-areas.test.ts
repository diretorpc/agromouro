import { describe, it, expect } from 'vitest'
import { resumirAreas } from './resumo-areas'
import type { Talhao } from '@/lib/types'

function talhao(over: Partial<Talhao>): Talhao {
  return {
    id: 'x', nome: 'T', area_ha: 100, cultura_atual: null,
    status: 'ativo', arrendatario: null, ...over,
  }
}

describe('resumirAreas', () => {
  it('soma tudo no total e separa a arrendada', () => {
    const r = resumirAreas([
      talhao({ id: '1', area_ha: 450, status: 'ativo' }),
      talhao({ id: '2', area_ha: 128.8, status: 'colhido' }),
      talhao({ id: '3', area_ha: 350, status: 'arrendado', arrendatario: 'Usina Uberaba' }),
    ])
    expect(r.total).toBeCloseTo(928.8, 10)
    expect(r.arrendada).toBeCloseTo(350, 10)
    expect(r.emOperacao).toBeCloseTo(578.8, 10)
  })

  // Valores CONCRETOS, não a identidade algébrica: `emOperacao` é derivado por
  // subtração (`total - arrendada`), então `emOperacao + arrendada === total`
  // seria verdade mesmo com a classificação por status quebrada. O que precisa
  // ser provado é que o status `arrendado` cai no balde certo.
  it('classifica por status: arrendado sai de emOperacao e entra em arrendada', () => {
    const r = resumirAreas([
      talhao({ id: '1', area_ha: 105.9, status: 'ativo' }),
      talhao({ id: '2', area_ha: 80.5, status: 'arrendado' }),
      talhao({ id: '3', area_ha: 196.4, status: 'pousio' }),
      talhao({ id: '4', area_ha: 128.77, status: 'arrendado' }),
    ])
    expect(r.emOperacao).toBeCloseTo(302.3, 10)   // 105,9 + 196,4 — pousio continua sendo área nossa
    expect(r.arrendada).toBeCloseTo(209.27, 10)   // 80,5 + 128,77
    expect(r.total).toBeCloseTo(511.57, 10)
  })

  it('conta os talhões nos três recortes', () => {
    const r = resumirAreas([
      talhao({ id: '1' }),
      talhao({ id: '2', status: 'arrendado' }),
      talhao({ id: '3', status: 'arrendado' }),
    ])
    expect(r.qtdTotal).toBe(3)
    expect(r.qtdArrendados).toBe(2)
    expect(r.qtdEmOperacao).toBe(1)
  })

  it('lista vazia devolve tudo zerado, não NaN', () => {
    const r = resumirAreas([])
    expect(r).toEqual({
      total: 0, arrendada: 0, emOperacao: 0,
      qtdTotal: 0, qtdArrendados: 0, qtdEmOperacao: 0,
    })
  })

  it('area_ha nula não vira NaN e contamina o total', () => {
    const r = resumirAreas([
      talhao({ id: '1', area_ha: null as unknown as number }),
      talhao({ id: '2', area_ha: 100 }),
    ])
    expect(r.total).toBe(100)
  })
})
