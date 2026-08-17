import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Simulação mínima do Supabase — só a tabela contas_a_pagar ──────────────
// gravarDeNota.ts só toca `.from('contas_a_pagar').upsert(...).select(...)`.
// `estado.erroUpsert` liga/desliga a falha de banco por teste.
const { estado } = vi.hoisted(() => ({
  // ultimoUpsert fica no MESMO objeto hoisted (não numa variável local dentro
  // do factory de `from`): o teste precisa inspecionar o payload gravado
  // (coluna `observacao`, entre outras) depois de chamar gravarContasDaNota,
  // e uma variável local ao closure de `from()` não é visível fora dele.
  estado: { erroUpsert: null as null | { message: string; code: string }, ultimoUpsert: null as any },
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const obj: any = {
        upsert: vi.fn((payload: any) => {
          estado.ultimoUpsert = payload
          return obj
        }),
        select: vi.fn(() => obj),
        then: (resolve: any) => resolve(
          estado.erroUpsert
            ? { data: null, error: estado.erroUpsert }
            : { data: estado.ultimoUpsert, error: null },
        ),
      }
      return obj
    }),
  },
}))

import { gravarContasDaNota } from './gravarDeNota'
import type { DadosParaConta } from './deNotaFiscal'

const base: DadosParaConta = {
  numero:         '4516',
  emitenteNome:   'TRIANGULO DIESEL TRR LTDA',
  dataEmissao:    '2026-07-14',
  valorTotal:     30600,
  formaPagamento: '15',
  duplicatas:     [{ numero: '001', vencimento: '2026-07-21', valor: 30600 }],
  items:          [{ descricao: 'DIESEL S10' }],
  modelo:         'nfe',
}

beforeEach(() => {
  estado.erroUpsert = null
  estado.ultimoUpsert = null
})

// Esta é a lacuna que a Task 3 deixou aberta: parcelasDescartadasDaNota()
// existia mas ninguém a chamava, então uma parcela ruim no meio de uma nota
// que "deu certo" nunca aparecia em lugar nenhum.
describe('gravarContasDaNota — parcelas descartadas', () => {
  it('nota sem problema nenhum: descartadas vem vazia', async () => {
    const r = await gravarContasDaNota(base, 'nfe-id', 'fazenda-id')
    expect(r.contas).toHaveLength(1)
    expect(r.descartadas).toEqual([])
  })

  it('3 parcelas, uma ruim no meio: contas tem as 2 boas, descartadas tem a ruim', async () => {
    const r = await gravarContasDaNota({
      ...base,
      duplicatas: [
        { numero: '001', vencimento: '2026-08-15', valor: 220000 },
        { numero: '002', vencimento: '2026-13-40', valor: 220000 }, // malformada
        { numero: '003', vencimento: '2026-10-15', valor: 220000 },
      ],
    }, 'nfe-id', 'fazenda-id')

    expect(r.contas).toHaveLength(2)
    expect(r.contas.map(c => c.vencimento)).toEqual(['2026-08-15', '2026-10-15'])
    expect(r.descartadas).toHaveLength(1)
    expect(r.descartadas[0].numero).toBe('002')
    expect(r.descartadas[0].motivo).toMatch(/Data em formato inválido/)
  })

  it('credito da loja SEM duplicata: nem contas nem descartadas — a nota nem tenta gerar boleto', async () => {
    const r = await gravarContasDaNota({ ...base, formaPagamento: '05', duplicatas: [] }, 'nfe-id', 'fazenda-id')
    expect(r.contas).toEqual([])
    expect(r.descartadas).toEqual([])
  })

  // Caso HIGA 76593 (14/08/2026) chegando ate a gravacao: a duplicata vence o tPag
  // e o boleto vai pro banco, em vez de sumir calado no meio do caminho.
  it('credito da loja COM duplicata: o boleto e gravado (a duplicata vence o codigo)', async () => {
    const r = await gravarContasDaNota({
      ...base, formaPagamento: '05',
      duplicatas: [{ numero: '001', vencimento: '2026-09-02', valor: 642.22 }],
    }, 'nfe-id', 'fazenda-id')
    expect(r.contas).toHaveLength(1)
    expect(r.contas[0].vencimento).toBe('2026-09-02')
    expect(r.descartadas).toEqual([])
  })

  it('nota sem quadro de cobranca (caso ERCAL): descartadas vem vazia', async () => {
    const r = await gravarContasDaNota({ ...base, duplicatas: [] }, 'nfe-id', 'fazenda-id')
    expect(r.contas).toHaveLength(1)
    expect(r.descartadas).toEqual([])
  })

  it('todas as parcelas ruins: lanca erro (nao confundir com "sem boleto por decisao")', async () => {
    await expect(gravarContasDaNota({
      ...base,
      duplicatas: [
        { numero: '001', vencimento: '2026-13-40', valor: 100 },
        { numero: '002', vencimento: '2026-99-99', valor: 200 },
      ],
    }, 'nfe-id', 'fazenda-id')).rejects.toThrow(/NF 4516 \(TRIANGULO DIESEL TRR LTDA\)/)
  })

  it('parcela ruim no meio, mas o banco falha ao gravar: a funcao inteira estoura (nao devolve descartadas parcial)', async () => {
    estado.erroUpsert = { message: 'coluna inexistente', code: '42703' }
    await expect(gravarContasDaNota({
      ...base,
      duplicatas: [
        { numero: '001', vencimento: '2026-08-15', valor: 100 },
        { numero: '002', vencimento: '2026-13-40', valor: 100 }, // malformada
      ],
    }, 'nfe-id', 'fazenda-id')).rejects.toThrow(/falha ao gravar boleto no banco/)
  })
})

// CONSERTO 1 — Achado [alto] do Apolo, 2ª rodada (17/08/2026): probe em produção
// achou uma conta RECORRENTE da SITRACK já cadastrada (recorrente_id preenchido,
// nota_fiscal_id nulo) pro mesmo mês/valor. Reenviar a NFS-e da SITRACK sem este
// aviso criaria uma segunda conta — e como a recorrente tem nota_fiscal_id nulo,
// pagar as duas duplica o gasto de verdade (precisaCriarLancamento em
// contas/pagamento.ts). Ver a função em deNotaFiscal.ts para o raciocínio completo.
describe('gravarContasDaNota — observacao de alerta em NFS-e sem vencimento', () => {
  it('NFS-e sem duplicata (sempre o caso hoje): a conta gravada leva a observacao de conferir conta recorrente', async () => {
    const r = await gravarContasDaNota(
      { ...base, modelo: 'nfse', formaPagamento: null, duplicatas: [] },
      'nfe-id', 'fazenda-id',
    )
    expect(r.contas).toHaveLength(1)
    expect(estado.ultimoUpsert[0].observacao).toMatch(/Conferir antes de pagar/)
    expect(estado.ultimoUpsert[0].observacao).toMatch(/conta recorrente/)
  })

  // O MESMO cenário (sem duplicata, conta sem vencimento) para NF-e é o caso
  // ERCAL — já provado em deNotaFiscal.test.ts e em produção (R$ 8.258,40 real).
  // Ele não pode ganhar uma tarja nova: comportamento antigo intacto.
  it('NF-e (produto) no mesmo cenario sem duplicata: NAO ganha a observacao (caso ERCAL, comportamento antigo intacto)', async () => {
    const r = await gravarContasDaNota(
      { ...base, modelo: 'nfe', duplicatas: [] },
      'nfe-id', 'fazenda-id',
    )
    expect(r.contas).toHaveLength(1)
    expect(estado.ultimoUpsert[0].observacao).toBeNull()
  })
})
