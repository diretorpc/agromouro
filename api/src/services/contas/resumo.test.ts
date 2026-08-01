import { describe, it, expect } from 'vitest'
import { montarResumo, resumoVazio, textoResumo, type ContaResumo } from './resumo'

const HOJE = '2026-07-29'

function conta(over: Partial<ContaResumo> = {}): ContaResumo {
  return {
    descricao: 'Energia', fornecedor: 'Cemig', vencimento: '2026-08-10',
    valor: 890, status: 'aberta', avisar_dias_antes: 3,
    criada_em: '2026-07-29', ...over,
  }
}

describe('montarResumo', () => {
  it('conta vencida e nao paga entra como atrasada', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-25' })], HOJE)
    expect(r.atrasadas).toHaveLength(1)
    expect(r.vencendo).toHaveLength(0)
  })

  it('conta aberta dentro do prazo de aviso entra como vencendo', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-31' })], HOJE)
    expect(r.vencendo).toHaveLength(1)
  })

  it('conta aberta ainda longe do vencimento nao entra', () => {
    const r = montarResumo([conta({ vencimento: '2026-08-20' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('conta aguardando perto do vencimento entra como nao chegou', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-31', status: 'aguardando' })], HOJE)
    expect(r.naoChegaram).toHaveLength(1)
    expect(r.vencendo).toHaveLength(0)
  })

  it('conta paga nunca entra em aviso, nem vencida', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-01', status: 'paga' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('conta dispensada nunca entra em aviso, nem vencida', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-01', status: 'dispensada' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('respeita o prazo de aviso configurado em cada conta', () => {
    const r = montarResumo([conta({ vencimento: '2026-08-05', avisar_dias_antes: 10 })], HOJE)
    expect(r.vencendo).toHaveLength(1)
  })

  it('vencendo hoje ainda conta como vencendo, nao como atrasada', () => {
    const r = montarResumo([conta({ vencimento: HOJE })], HOJE)
    expect(r.vencendo).toHaveLength(1)
    expect(r.atrasadas).toHaveLength(0)
  })

  it('conta vencida com status aguardando entra como atrasada, nao como nao chegou', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-25', status: 'aguardando' })], HOJE)
    expect(r.atrasadas).toHaveLength(1)
    expect(r.naoChegaram).toHaveLength(0)
  })

  it('conta vencendo exatamente no limite do aviso entra no resumo', () => {
    const r = montarResumo([conta({ vencimento: '2026-08-01', avisar_dias_antes: 3 })], HOJE)
    expect(r.vencendo).toHaveLength(1)
  })
})

describe('textoResumo', () => {
  it('descreve as tres situacoes na mensagem', () => {
    const r = montarResumo([
      conta({ descricao: 'Agua',    vencimento: '2026-07-25', valor: 340 }),
      conta({ descricao: 'Energia', vencimento: '2026-07-31', valor: 890 }),
      conta({ descricao: 'Telefone', vencimento: '2026-07-30', status: 'aguardando', valor: 120 }),
    ], HOJE)
    const txt = textoResumo(r, HOJE)
    // A Task 7 fundiu "atrasadas" e "sem vencimento antigas" sob o mesmo
    // cabeçalho de urgência — o rótulo virou "urgente", não "atrasada".
    expect(txt).toContain('urgente')
    expect(txt).toContain('Agua')
    expect(txt).toContain('Energia')
    expect(txt).toContain('Telefone')
    expect(txt).toContain('ainda não chegou')
  })

  it('duas contas nao chegadas usam o plural correto', () => {
    const r = montarResumo([
      conta({ descricao: 'Telefone', vencimento: '2026-07-30', status: 'aguardando' }),
      conta({ descricao: 'Internet', vencimento: '2026-07-31', status: 'aguardando' }),
    ], HOJE)
    expect(textoResumo(r, HOJE)).toContain('2 ainda não chegaram')
  })

  it('uma conta nao chegada usa o singular', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-30', status: 'aguardando' })], HOJE)
    expect(textoResumo(r, HOJE)).toContain('1 ainda não chegou')
  })

  it('valor na casa dos milhares sai com ponto separador', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-30', valor: 1234.56 })], HOJE)
    expect(textoResumo(r, HOJE)).toContain('R$ 1.234,56')
  })
})

describe('conta sem vencimento', () => {
  it('entra no grupo proprio, e em nenhum outro', () => {
    const r = montarResumo([conta({ vencimento: null })], HOJE)
    expect(r.semVencimento).toHaveLength(1)
    expect(r.atrasadas).toHaveLength(0)
    expect(r.vencendo).toHaveLength(0)
    expect(r.naoChegaram).toHaveLength(0)
  })

  it('nao e atrasada — nao existe data para dizer que passou', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-01-01' })], HOJE)
    expect(r.atrasadas).toHaveLength(0)
  })

  it('com 5 dias ainda NAO subiu de tom', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-07-24' })], HOJE)
    expect(r.semVencimento).toHaveLength(1)
    expect(r.semVencimentoAntigas).toHaveLength(0)
  })

  it('com 6 dias sobe para o grupo critico', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-07-23' })], HOJE)
    expect(r.semVencimentoAntigas).toHaveLength(1)
    expect(r.semVencimento).toHaveLength(0)
  })

  it('paga ou dispensada sem vencimento nao entra em aviso nenhum', () => {
    const r = montarResumo([
      conta({ vencimento: null, status: 'paga' }),
      conta({ vencimento: null, status: 'dispensada' }),
    ], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('resumo so com conta sem vencimento NAO e vazio', () => {
    expect(resumoVazio(montarResumo([conta({ vencimento: null })], HOJE))).toBe(false)
  })

  it('o texto descreve o grupo e leva o link', () => {
    const txt = textoResumo(montarResumo([conta({ vencimento: null })], HOJE), HOJE)
    expect(txt).toContain('sem vencimento')
    expect(txt).toContain('/contas?filtro=sem-vencimento')
  })

  it('o texto da conta antiga diz ha quantos dias esta esperando', () => {
    const txt = textoResumo(montarResumo([conta({ vencimento: null, criada_em: '2026-07-20' })], HOJE), HOJE)
    expect(txt).toContain('9 dias')
  })
})
