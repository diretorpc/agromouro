import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Trava de área arrendada em buscarTalhao ───────────────────────────────────
// A spec chama o filtro do seletor web de "a trava que impede lançar operação e
// gasto em terra operada por terceiro" (Usina Uberaba). O WhatsApp é o canal
// principal do produtor e resolvia o talhão só por ilike frouxo, sem excluir
// status='arrendado' — "apliquei glifosato no Gogo" podia casar com um talhão
// arrendado de nome parecido aos da família (Gogo I/II/III, Alvorada I/II).
// Este teste trava que buscarTalhao nunca devolve um talhão arrendado.

const { estadoBanco } = vi.hoisted(() => ({
  estadoBanco: {
    talhoes: [
      { id: 'talhao-gogo-1', nome: 'Gogo I', area_ha: 50, status: 'ativo' },
      { id: 'talhao-gogo-usina', nome: 'Gogo Usina', area_ha: 80, status: 'arrendado' },
    ] as any[],
  },
}))

// Simula supabase-js o suficiente para buscarTalhao:
// select().neq().ilike().limit().single() — thenable ausente, só single().
vi.mock('../services/supabase', () => {
  function talhoesBuilder() {
    const neqFiltros: Record<string, any> = {}
    let ilikeCampo: string | undefined
    let ilikeValor: string | undefined
    const obj: any = {
      select: vi.fn(() => obj),
      neq: vi.fn((campo: string, valor: any) => { neqFiltros[campo] = valor; return obj }),
      ilike: vi.fn((campo: string, padrao: string) => {
        ilikeCampo = campo
        ilikeValor = padrao.replace(/%/g, '').toLowerCase()
        return obj
      }),
      limit: vi.fn(() => obj),
      single: vi.fn(async () => {
        const linhas = estadoBanco.talhoes.filter(t =>
          Object.entries(neqFiltros).every(([campo, valor]) => t[campo] !== valor)
          && (!ilikeValor || String(t[ilikeCampo!]).toLowerCase().includes(ilikeValor)),
        )
        return linhas.length > 0
          ? { data: linhas[0], error: null }
          : { data: null, error: { message: 'not found' } }
      }),
    }
    return obj
  }
  return {
    supabase: { from: vi.fn((tabela: string) => talhoesBuilder()) },
  }
})

import { buscarTalhao } from './whatsapp'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buscarTalhao', () => {
  it('acha talhão em operação normal pelo nome', async () => {
    const talhao = await buscarTalhao('Gogo I')
    expect(talhao?.id).toBe('talhao-gogo-1')
  })

  it('NUNCA devolve talhão arrendado, mesmo quando o nome bate melhor', async () => {
    // "Gogo Usina" contém "gogo" e casaria pelo ilike frouxo — a trava tem que
    // excluir esse talhão antes do match de nome, não depois.
    const talhao = await buscarTalhao('Gogo Usina')
    expect(talhao).toBeNull()
  })

  it('talhão arrendado não aparece nem como match parcial de "gogo"', async () => {
    const talhao = await buscarTalhao('gogo')
    expect(talhao?.id).toBe('talhao-gogo-1')
    expect(talhao?.id).not.toBe('talhao-gogo-usina')
  })
})
