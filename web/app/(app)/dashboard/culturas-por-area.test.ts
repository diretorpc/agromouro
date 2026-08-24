import { describe, it, expect } from 'vitest'
import { agruparCulturasPorArea, FATIA_ARRENDADO } from './culturas-por-area'
import type { Talhao } from '@/lib/types'

function talhao(over: Partial<Talhao>): Talhao {
  return {
    id: 'x', nome: 'T', area_ha: 100, cultura_atual: null,
    status: 'ativo', arrendatario: null, ...over,
  }
}

describe('agruparCulturasPorArea', () => {
  it('junta "Cana" e "cana" numa fatia só', () => {
    const r = agruparCulturasPorArea([
      talhao({ id: '1', area_ha: 450, cultura_atual: 'cana' }),
      talhao({ id: '2', area_ha: 128.8, cultura_atual: 'Cana' }),
    ])
    expect(r).toEqual([{ name: 'cana', value: 578.8 }])
  })

  // A cana da usina NÃO é a nossa cana.
  it('talhão arrendado vai para a fatia Arrendado, não para a cultura dele', () => {
    const r = agruparCulturasPorArea([
      talhao({ id: '1', area_ha: 450, cultura_atual: 'cana' }),
      talhao({ id: '2', area_ha: 80.5, cultura_atual: 'cana', status: 'arrendado' }),
    ])
    expect(r).toEqual([
      { name: 'cana', value: 450 },
      { name: FATIA_ARRENDADO, value: 80.5 },
    ])
  })

  // A invariante que impede o gráfico de discordar do "ha total" do topo.
  it('a soma das fatias é igual à área de TODOS os talhões', () => {
    const talhoes = [
      talhao({ id: '1', area_ha: 450, cultura_atual: 'cana' }),
      talhao({ id: '2', area_ha: 80.5, status: 'arrendado' }),
      talhao({ id: '3', area_ha: 105.9, cultura_atual: null }),
    ]
    const soma = agruparCulturasPorArea(talhoes).reduce((s, f) => s + f.value, 0)
    expect(soma).toBeCloseTo(636.4, 1)
  })

  it('talhão sem cultura cai em "Sem cultura"', () => {
    const r = agruparCulturasPorArea([talhao({ id: '1', area_ha: 10, cultura_atual: '  ' })])
    expect(r).toEqual([{ name: 'Sem cultura', value: 10 }])
  })

  it('ordena da maior área para a menor', () => {
    const r = agruparCulturasPorArea([
      talhao({ id: '1', area_ha: 10, cultura_atual: 'milho' }),
      talhao({ id: '2', area_ha: 90, cultura_atual: 'soja' }),
    ])
    expect(r.map(f => f.name)).toEqual(['soja', 'milho'])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(agruparCulturasPorArea([])).toEqual([])
  })
})
