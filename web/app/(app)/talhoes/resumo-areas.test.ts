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
    expect(r.total).toBe(928.8)
    expect(r.arrendada).toBe(350)
    expect(r.emOperacao).toBe(578.8)
  })

  // A invariante que impede a tela de se contradizer.
  it('em operação + arrendada é SEMPRE igual ao total', () => {
    const r = resumirAreas([
      talhao({ id: '1', area_ha: 105.9 }),
      talhao({ id: '2', area_ha: 80.5, status: 'arrendado' }),
      talhao({ id: '3', area_ha: 196.4, status: 'pousio' }),
    ])
    expect(r.emOperacao + r.arrendada).toBeCloseTo(r.total, 10)
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
