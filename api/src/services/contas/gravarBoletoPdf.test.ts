import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Simulação mínima do Supabase ────────────────────────────────────────────
// gravarBoletoPdf.ts faz duas coisas: consulta contas com mesmo valor+vencimento
// (select encadeado com .eq) e insere a nova. `estado` controla o que a consulta
// devolve e se cada uma das duas falha.
const { estado } = vi.hoisted(() => ({
  estado: {
    existentes: [] as Array<{ id: string; fornecedor: string | null }>,
    erroSelect: null as null | { message: string },
    erroInsert: null as null | { message: string },
    inserido:   null as any,
  },
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const obj: any = {
        select: vi.fn(() => obj),
        eq:     vi.fn(() => obj),
        limit:  vi.fn(() => obj),
        single: vi.fn(() => Promise.resolve(
          estado.erroInsert
            ? { data: null, error: estado.erroInsert }
            : { data: { id: 'conta-nova' }, error: null },
        )),
        insert: vi.fn((payload: any) => { estado.inserido = payload; return obj }),
        // A consulta termina no await do encadeamento .eq() — sem .single().
        then: (resolve: any) => resolve(
          estado.erroSelect
            ? { data: null, error: estado.erroSelect }
            : { data: estado.existentes, error: null },
        ),
      }
      return obj
    }),
  },
}))

import { gravarBoletoDoPdf } from './gravarBoletoPdf'
import type { BoletoLido } from './boletoPdf'

const boleto: BoletoLido = {
  valor: 642.22,
  vencimento: '2026-09-02',
  beneficiario: 'HIGA COMERCIO E DISTRIBUICAO LTDA',
  documento: '76593',
  totalDeCobrancas: 1,
}

beforeEach(() => {
  estado.existentes = []
  estado.erroSelect = null
  estado.erroInsert = null
  estado.inserido   = null
})

// O CRÍTICO das duas rodadas de revisão do Apolo. `nota_fiscal_id` decide quem
// lança o gasto quando o boleto for pago (precisaCriarLancamento, pagamento.ts):
// amarrado, pagar NÃO lança; solto, pagar lança. Amarrar na hora errada faz o
// gasto DOBRAR ou SUMIR — e as duas falhas são silenciosas.
describe('gravarBoletoDoPdf — a quem o boleto se amarra', () => {
  it('sem nota no e-mail: nasce SOLTO, para que pagar lance o gasto', async () => {
    const r = await gravarBoletoDoPdf(boleto, 'b.pdf', 'fazenda-1')
    expect(r.status).toBe('criada')
    expect(estado.inserido.nota_fiscal_id).toBeNull()
  })

  it('com nota que lançou gasto: AMARRA, para que pagar não lance de novo', async () => {
    const r = await gravarBoletoDoPdf(boleto, 'b.pdf', 'fazenda-1', 'nota-abc')
    expect(r.status).toBe('criada')
    expect(estado.inserido.nota_fiscal_id).toBe('nota-abc')
  })

  it('grava a tarja de conferência e o arquivo de origem', async () => {
    await gravarBoletoDoPdf(boleto, 'boleto-higa.pdf', 'fazenda-1')
    // O prefixo é o que a tela e o resumo diário reconhecem para mostrar o
    // alerta — sem ele o boleto lido por IA passaria como conta comum.
    expect(estado.inserido.observacao).toMatch(/^Conferir antes de pagar:/)
    expect(estado.inserido.observacao).toContain('boleto-higa.pdf')
  })
})

describe('gravarBoletoDoPdf — duplicata', () => {
  it('mesma data, mesmo valor e MESMO fornecedor: não repete', async () => {
    estado.existentes = [{ id: 'conta-velha', fornecedor: 'HIGA COMERCIO E DISTRIBUICAO LTDA' }]
    const r = await gravarBoletoDoPdf(boleto, 'b.pdf', 'fazenda-1')
    expect(r.status).toBe('duplicada')
    expect(estado.inserido).toBeNull()
  })

  it('o nome não precisa bater letra por letra — acento e caixa não contam', async () => {
    // O beneficiário IMPRESSO no boleto quase nunca é idêntico à razão social
    // do emitente da nota. Exigir igualdade exata criaria conta repetida sempre.
    estado.existentes = [{ id: 'conta-velha', fornecedor: 'Higa Comércio' }]
    expect((await gravarBoletoDoPdf(boleto, 'b.pdf', 'fazenda-1')).status).toBe('duplicada')
  })

  it('mesma data e valor, mas OUTRO fornecedor: grava assim mesmo', async () => {
    // Duas parcelas redondas de fornecedores diferentes vencendo no mesmo dia
    // acontece. Engolir a segunda perderia um boleto de verdade — o erro caro.
    estado.existentes = [{ id: 'conta-velha', fornecedor: 'SYAGRI AGRONEGOCIOS' }]
    const r = await gravarBoletoDoPdf(boleto, 'b.pdf', 'fazenda-1')
    expect(r.status).toBe('criada')
  })

  it('conta existente sem fornecedor não engole o boleto', async () => {
    estado.existentes = [{ id: 'conta-velha', fornecedor: null }]
    expect((await gravarBoletoDoPdf(boleto, 'b.pdf', 'fazenda-1')).status).toBe('criada')
  })
})

// Achado [alto] do Apolo: erro de banco devolvia 'duplicada', o job marcava o
// e-mail como lido e o boleto se perdia para sempre. 'erro' é o que faz o
// e-mail voltar no próximo ciclo.
describe('gravarBoletoDoPdf — falha de banco NÃO pode virar duplicata', () => {
  it('erro ao consultar existentes devolve erro, não duplicada', async () => {
    estado.erroSelect = { message: 'connection reset' }
    const r = await gravarBoletoDoPdf(boleto, 'b.pdf', 'fazenda-1')
    expect(r.status).toBe('erro')
    expect(estado.inserido).toBeNull()
  })

  it('erro ao inserir devolve erro', async () => {
    estado.erroInsert = { message: 'numeric field overflow' }
    expect((await gravarBoletoDoPdf(boleto, 'b.pdf', 'fazenda-1')).status).toBe('erro')
  })
})
