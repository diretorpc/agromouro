import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Trava de área arrendada + isolamento por fazenda em buscarTalhao ─────────
// A spec chama o filtro do seletor web de "a trava que impede lançar operação e
// gasto em terra operada por terceiro" (Usina Uberaba). O WhatsApp é o canal
// principal do produtor e resolvia o talhão só por ilike frouxo, sem excluir
// status='arrendado' nem filtrar por fazenda_id — "apliquei glifosato no Gogo"
// podia casar com um talhão arrendado de nome parecido (Gogo I/II/III, Alvorada
// I/II) OU com um talhão de outra fazenda com o mesmo nome.
//
// O cliente supabase de services/supabase.ts autentica com SUPABASE_SERVICE_KEY,
// que bypassa RLS por completo (as policies *_tenant dependem de auth.uid(), que
// não existe no backend). O filtro .eq('fazenda_id', ...) escrito à mão aqui é o
// ÚNICO isolamento entre fazendas nesta função.

const { estadoBanco } = vi.hoisted(() => ({
  estadoBanco: {
    talhoes: [
      { id: 'talhao-gogo-1', nome: 'Gogo I', area_ha: 50, status: 'ativo', fazenda_id: 'fazenda-mg' },
      { id: 'talhao-gogo-usina', nome: 'Gogo Usina', area_ha: 80, status: 'arrendado', fazenda_id: 'fazenda-mg' },
      { id: 'talhao-mt-gogo-1', nome: 'Gogo I', area_ha: 30, status: 'ativo', fazenda_id: 'fazenda-mt' },
    ] as any[],
  },
}))

// Simula supabase-js o suficiente para buscarTalhao:
// select().eq().neq().ilike().limit().single() — thenable ausente, só single().
vi.mock('../services/supabase', () => {
  function talhoesBuilder() {
    const eqFiltros: Record<string, any> = {}
    const neqFiltros: Record<string, any> = {}
    let ilikeCampo: string | undefined
    let ilikeValor: string | undefined
    const obj: any = {
      select: vi.fn(() => obj),
      eq: vi.fn((campo: string, valor: any) => { eqFiltros[campo] = valor; return obj }),
      neq: vi.fn((campo: string, valor: any) => { neqFiltros[campo] = valor; return obj }),
      ilike: vi.fn((campo: string, padrao: string) => {
        ilikeCampo = campo
        ilikeValor = padrao.replace(/%/g, '').toLowerCase()
        return obj
      }),
      limit: vi.fn(() => obj),
      single: vi.fn(async () => {
        const linhas = estadoBanco.talhoes.filter(t =>
          Object.entries(eqFiltros).every(([campo, valor]) => t[campo] === valor)
          && Object.entries(neqFiltros).every(([campo, valor]) => t[campo] !== valor)
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
    const talhao = await buscarTalhao('Gogo I', 'fazenda-mg')
    expect(talhao?.id).toBe('talhao-gogo-1')
  })

  it('NUNCA devolve talhão arrendado, mesmo quando o nome bate melhor', async () => {
    // "Gogo Usina" contém "gogo" e casaria pelo ilike frouxo — a trava tem que
    // excluir esse talhão antes do match de nome, não depois.
    const talhao = await buscarTalhao('Gogo Usina', 'fazenda-mg')
    expect(talhao).toBeNull()
  })

  it('talhão arrendado não aparece nem como match parcial de "gogo"', async () => {
    const talhao = await buscarTalhao('gogo', 'fazenda-mg')
    expect(talhao?.id).toBe('talhao-gogo-1')
    expect(talhao?.id).not.toBe('talhao-gogo-usina')
  })

  it('talhão de OUTRA fazenda com nome idêntico não pode casar', async () => {
    // Duas fazendas têm um talhão "Gogo I". Buscar na fazenda MT tem que devolver
    // o talhão da fazenda MT, nunca o da MG — mesmo que o da MG bata primeiro
    // num banco sem filtro por fazenda_id (esta é a falha que este PR corrige).
    const talhaoMt = await buscarTalhao('Gogo I', 'fazenda-mt')
    expect(talhaoMt?.id).toBe('talhao-mt-gogo-1')
    expect(talhaoMt?.id).not.toBe('talhao-gogo-1')
  })
})
