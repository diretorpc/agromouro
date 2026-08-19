import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Banco fake com DUAS fazendas ──────────────────────────────────────────
// Builder genérico o bastante para as DUAS consultas que o service faz contra
// itens_nfe (lista principal, paginada/contada; e o grupo "linhas iguais" da
// duplicata Caso 2, sem paginação) e a consulta contra documentos_controle
// (ids por status). Mesmo espírito do builder de routes/controle.test.ts,
// com `.is()` e `.or()` a mais — precisos aqui e ausentes lá.
const FAZENDA_A = 'fazenda-aaa'
const FAZENDA_B = 'fazenda-bbb'

const { estadoBanco } = vi.hoisted(() => ({
  estadoBanco: {
    documentos: [] as any[],
    itens: [] as any[],
  },
}))

function fornecedorNormalizado(fornecedor: unknown): string | null {
  if (typeof fornecedor !== 'string') return null
  const limpo = fornecedor.replace(/\s+/g, ' ').trim().toUpperCase()
  return limpo === '' ? null : limpo
}

vi.mock('../supabase', () => {
  function builder(tabela: 'documentos_controle' | 'itens_nfe') {
    const filtros: Record<string, any> = {}
    const filtrosIn: Record<string, any[]> = {}
    const filtrosGte: Record<string, any> = {}
    const filtrosLte: Record<string, any> = {}
    const filtrosIs: Record<string, any> = {}
    const filtrosOr: string[] = []
    const ordenacoes: { campo: string; ascendente: boolean }[] = []
    let colunas: string[] | null = null
    let contarTotal = false
    let rangeSlice: [number, number] | null = null

    function linhasBase() {
      if (tabela === 'documentos_controle') return estadoBanco.documentos
      return estadoBanco.itens.map(i => ({ ...i, fornecedor_normalizado: fornecedorNormalizado(i.fornecedor) }))
    }
    function matchOr(linha: any, expr: string): boolean {
      return expr.split(',').some(clausula => {
        const [campo, op, valorCru] = clausula.split('.')
        if (op === 'is') return valorCru === 'null' ? (linha[campo] === null || linha[campo] === undefined) : false
        if (op === 'in') {
          const lista = valorCru.replace(/^\(|\)$/g, '').split(',').filter(Boolean)
          return lista.includes(linha[campo])
        }
        return false
      })
    }
    function filtrar() {
      return linhasBase().filter(l =>
        Object.entries(filtros).every(([campo, valor]) => l[campo] === valor) &&
        Object.entries(filtrosIn).every(([campo, valores]) => valores.includes(l[campo])) &&
        Object.entries(filtrosGte).every(([campo, valor]) => l[campo] >= valor) &&
        Object.entries(filtrosLte).every(([campo, valor]) => l[campo] <= valor) &&
        Object.entries(filtrosIs).every(([campo, valor]) => l[campo] === valor) &&
        filtrosOr.every(expr => matchOr(l, expr)),
      )
    }
    function ordenar(linhas: any[]) {
      if (ordenacoes.length === 0) return linhas
      return [...linhas].sort((a, b) => {
        for (const { campo, ascendente } of ordenacoes) {
          const va = a[campo]; const vb = b[campo]
          if (va === vb) continue
          if (va === null || va === undefined) return 1
          if (vb === null || vb === undefined) return -1
          return (va < vb ? -1 : 1) * (ascendente ? 1 : -1)
        }
        return 0
      })
    }
    function projetar(linha: any) {
      if (!colunas) return linha
      const out: any = {}
      for (const c of colunas) out[c] = linha[c]
      return out
    }

    const obj: any = {
      select: vi.fn((cols?: string, opts?: { count?: 'exact' }) => {
        colunas = cols ? cols.split(',').map(c => c.trim()) : null
        contarTotal = opts?.count === 'exact'
        return obj
      }),
      order:  vi.fn((campo: string, opts?: { ascending?: boolean }) => { ordenacoes.push({ campo, ascendente: opts?.ascending !== false }); return obj }),
      eq:     vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      in:     vi.fn((campo: string, valores: any[]) => { filtrosIn[campo] = valores; return obj }),
      gte:    vi.fn((campo: string, valor: any) => { filtrosGte[campo] = valor; return obj }),
      lte:    vi.fn((campo: string, valor: any) => { filtrosLte[campo] = valor; return obj }),
      is:     vi.fn((campo: string, valor: any) => { filtrosIs[campo] = valor; return obj }),
      or:     vi.fn((expr: string) => { filtrosOr.push(expr); return obj }),
      range:  vi.fn((de: number, ate: number) => { rangeSlice = [de, ate]; return obj }),
      then(resolve: any) {
        const todasFiltradas = ordenar(filtrar())
        const pagina = rangeSlice ? todasFiltradas.slice(rangeSlice[0], rangeSlice[1] + 1) : todasFiltradas
        return Promise.resolve(resolve({
          data: pagina.map(projetar),
          error: null,
          count: contarTotal ? todasFiltradas.length : null,
        }))
      },
    }
    return obj
  }

  return { supabase: { from: vi.fn((tabela: string) => builder(tabela as any)) } }
})

import { listarItensControle } from './listarItensControle'

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.documentos = []
  estadoBanco.itens = []
})

function item(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'item-x',
    descricao: 'ADUBO',
    quantidade: 1,
    unidade: 'SC',
    valor_unitario: 100,
    valor_total: 100,
    fornecedor: 'SOLOS',
    numero_documento: '1',
    ocorrencia_no_documento: 0,
    documento_controle_id: 'doc-1',
    conta_como_compra: false,
    data_manual: '2026-08-01',
    insumo_id: null,
    fazenda_id: FAZENDA_A,
    nota_fiscal_id: null,
    created_at: '2026-08-10',
    duplicata_confirmada_em: null,
    duplicata_confirmada_vezes: 0,
    ...overrides,
  }
}

const FILTRO_PADRAO = { pagina: 1, porPagina: 500, fornecedor: [] as string[], status: [] as string[] }

describe('listarItensControle', () => {
  it('isola por fazenda — item de outra fazenda nunca aparece', async () => {
    estadoBanco.itens = [
      item({ id: 'item-1', fazenda_id: FAZENDA_A }),
      item({ id: 'item-2', fazenda_id: FAZENDA_B }),
    ]

    const r = await listarItensControle(FAZENDA_A, FILTRO_PADRAO)

    expect(r.itens.map(i => i.id)).toEqual(['item-1'])
    expect(r.totalItens).toBe(1)
  })

  it('item de NF-e (nota_fiscal_id not null) NUNCA aparece na grade', async () => {
    estadoBanco.itens = [
      item({ id: 'item-pdf', nota_fiscal_id: null }),
      item({ id: 'item-nfe', nota_fiscal_id: 'nota-1', documento_controle_id: null }),
    ]

    const r = await listarItensControle(FAZENDA_A, FILTRO_PADRAO)

    expect(r.itens.map(i => i.id)).toEqual(['item-pdf'])
  })

  it('item AVULSO (documento_controle_id null, nota_fiscal_id null) aparece normalmente', async () => {
    estadoBanco.itens = [item({ id: 'item-avulso', documento_controle_id: null })]

    const r = await listarItensControle(FAZENDA_A, FILTRO_PADRAO)

    expect(r.itens.map(i => i.id)).toEqual(['item-avulso'])
  })

  it('pagina e conta o total', async () => {
    estadoBanco.itens = [
      item({ id: 'item-1', created_at: '2026-08-01' }),
      item({ id: 'item-2', created_at: '2026-08-02' }),
      item({ id: 'item-3', created_at: '2026-08-03' }),
    ]

    const r = await listarItensControle(FAZENDA_A, { ...FILTRO_PADRAO, porPagina: 2 })

    expect(r.itens).toHaveLength(2)
    expect(r.totalPaginas).toBe(2)
    expect(r.totalItens).toBe(3)
  })

  it('filtra por fornecedor (normalizado, pega grafias diferentes do mesmo fornecedor)', async () => {
    estadoBanco.itens = [
      item({ id: 'item-1', fornecedor: 'Solos Soluções' }),
      item({ id: 'item-2', fornecedor: 'SOLOS SOLUÇÕES  ' }),
      item({ id: 'item-3', fornecedor: 'MOSAIC' }),
    ]

    const r = await listarItensControle(FAZENDA_A, { ...FILTRO_PADRAO, fornecedor: ['SOLOS SOLUÇÕES'] })

    expect(r.itens.map(i => i.id).sort()).toEqual(['item-1', 'item-2'])
  })

  it('filtra por período (data_manual)', async () => {
    estadoBanco.itens = [
      item({ id: 'item-1', data_manual: '2026-01-01' }),
      item({ id: 'item-2', data_manual: '2026-06-15' }),
    ]

    const r = await listarItensControle(FAZENDA_A, { ...FILTRO_PADRAO, dataInicio: '2026-03-01', dataFim: '2026-12-31' })

    expect(r.itens.map(i => i.id)).toEqual(['item-2'])
  })

  it('filtra por status do DOCUMENTO — item avulso (sem documento) SEMPRE passa, mesmo com filtro de status ativo', async () => {
    estadoBanco.documentos = [
      { id: 'doc-erro', fazenda_id: FAZENDA_A, status: 'erro' },
      { id: 'doc-ok', fazenda_id: FAZENDA_A, status: 'processado' },
    ]
    estadoBanco.itens = [
      item({ id: 'item-doc-erro', documento_controle_id: 'doc-erro' }),
      item({ id: 'item-doc-ok', documento_controle_id: 'doc-ok' }),
      item({ id: 'item-avulso', documento_controle_id: null }),
    ]

    const r = await listarItensControle(FAZENDA_A, { ...FILTRO_PADRAO, status: ['erro'] })

    expect(r.itens.map(i => i.id).sort()).toEqual(['item-avulso', 'item-doc-erro'])
  })

  it('duplicado Caso 1 (reimportação confirmada): duplicata_confirmada_em not null vira duplicado=true, motivo reimportacao', async () => {
    estadoBanco.itens = [item({ id: 'item-1', duplicata_confirmada_em: '2026-08-18T10:00:00Z', duplicata_confirmada_vezes: 2 })]

    const r = await listarItensControle(FAZENDA_A, FILTRO_PADRAO)

    expect(r.itens[0]).toMatchObject({ duplicado: true, duplicadoMotivo: 'reimportacao' })
  })

  it('duplicado Caso 2 (linhas parecidas, trava não pegou): duas linhas com mesmo fornecedor+número+valor viram duplicado=true, motivo linhas_iguais', async () => {
    estadoBanco.itens = [
      item({ id: 'item-1', fornecedor: 'SOLOS', numero_documento: '57106', valor_total: 1505, descricao: 'ADUBO' }),
      // Descrição diferente (edição manual) — a trava exata (idx_itens_nfe_
      // dedupe_item) NÃO bloquearia isto, mas o grupo mais solto do Caso 2
      // (fornecedor+numero+valor) precisa pintar as duas mesmo assim.
      item({ id: 'item-2', fornecedor: 'SOLOS', numero_documento: '57106', valor_total: 1505, descricao: 'ADUBO NPK CORRIGIDO' }),
    ]

    const r = await listarItensControle(FAZENDA_A, FILTRO_PADRAO)

    const item1 = r.itens.find(i => i.id === 'item-1')!
    const item2 = r.itens.find(i => i.id === 'item-2')!
    expect(item1.duplicado).toBe(true)
    expect(item1.duplicadoMotivo).toBe('linhas_iguais')
    expect(item2.duplicado).toBe(true)
    expect(item2.duplicadoMotivo).toBe('linhas_iguais')
  })

  it('item único (sem par igual, nunca reimportado): duplicado=false, motivo null', async () => {
    estadoBanco.itens = [item({ id: 'item-1' })]

    const r = await listarItensControle(FAZENDA_A, FILTRO_PADRAO)

    expect(r.itens[0]).toMatchObject({ duplicado: false, duplicadoMotivo: null })
  })

  it('Caso 2 não cruza fazendas — item igual em OUTRA fazenda não pinta o da fazenda A', async () => {
    estadoBanco.itens = [
      item({ id: 'item-a', fazenda_id: FAZENDA_A, fornecedor: 'SOLOS', numero_documento: '1', valor_total: 500 }),
      item({ id: 'item-b', fazenda_id: FAZENDA_B, fornecedor: 'SOLOS', numero_documento: '1', valor_total: 500 }),
    ]

    const r = await listarItensControle(FAZENDA_A, FILTRO_PADRAO)

    expect(r.itens).toHaveLength(1)
    expect(r.itens[0]).toMatchObject({ id: 'item-a', duplicado: false })
  })
})
