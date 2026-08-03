import { describe, it, expect } from 'vitest'
import { efeitoDoCfop } from './cfop'

describe('efeitoDoCfop — entrega futura (o caso que originou este trabalho)', () => {
  it('faturamento 5922: conta o gasto e NAO mexe no estoque', () => {
    const e = efeitoDoCfop('5922')
    expect(e.entraNoEstoque).toBe(false)
    expect(e.contaComoCompra).toBe(true)
  })

  it('remessa 5117: soma o estoque e NAO conta o gasto de novo', () => {
    const e = efeitoDoCfop('5117')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(false)
  })

  it('remessa 5116 e as versoes interestaduais seguem a mesma regra', () => {
    for (const c of ['5116', '6116', '6117']) {
      expect(efeitoDoCfop(c).entraNoEstoque).toBe(true)
      expect(efeitoDoCfop(c).contaComoCompra).toBe(false)
    }
    expect(efeitoDoCfop('6922').contaComoCompra).toBe(true)
    expect(efeitoDoCfop('6922').entraNoEstoque).toBe(false)
  })
})

describe('efeitoDoCfop — bonificacao', () => {
  it('5910 entra no estoque com custo ZERO e nao conta como compra', () => {
    const e = efeitoDoCfop('5910')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(false)
    expect(e.custoZero).toBe(true)
  })

  it('amostra gratis 5911 idem', () => {
    expect(efeitoDoCfop('5911').custoZero).toBe(true)
  })

  it('compra normal NAO e custo zero', () => {
    expect(efeitoDoCfop('5102').custoZero).toBe(false)
  })
})

describe('efeitoDoCfop — mercadoria que passa mas nao e compra', () => {
  it('conserto, demonstracao, vasilhame, armazem e industrializacao nao mexem em nada', () => {
    for (const c of ['5915', '5912', '5920', '5905', '5924', '6925', '5934']) {
      const e = efeitoDoCfop(c)
      expect(e.entraNoEstoque).toBe(false)
      expect(e.contaComoCompra).toBe(false)
    }
  })
})

describe('efeitoDoCfop — consignacao', () => {
  it('remessa em consignacao 5917 entra no estoque mas ainda nao e compra', () => {
    const e = efeitoDoCfop('5917')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(false)
  })

  it('devolucao simbolica 5919 vira compra sem mexer no estoque de novo', () => {
    const e = efeitoDoCfop('5919')
    expect(e.entraNoEstoque).toBe(false)
    expect(e.contaComoCompra).toBe(true)
  })
})

describe('efeitoDoCfop — na duvida, faz o que sempre fez', () => {
  it('venda normal soma estoque e conta compra', () => {
    for (const c of ['5101', '5102', '6101', '6102']) {
      const e = efeitoDoCfop(c)
      expect(e.entraNoEstoque).toBe(true)
      expect(e.contaComoCompra).toBe(true)
    }
  })

  it('venda a ordem (5118-5120) e compra normal, NAO entrega futura', () => {
    for (const c of ['5118', '5119', '5120']) {
      const e = efeitoDoCfop(c)
      expect(e.entraNoEstoque).toBe(true)
      expect(e.contaComoCompra).toBe(true)
    }
  })

  it('CFOP desconhecido se comporta como compra normal', () => {
    const e = efeitoDoCfop('7777')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(true)
  })

  it('CFOP vazio se comporta como compra normal', () => {
    const e = efeitoDoCfop('')
    expect(e.entraNoEstoque).toBe(true)
    expect(e.contaComoCompra).toBe(true)
  })
})

describe('efeitoDoCfop — rotulo em portugues, para a mensagem do WhatsApp', () => {
  it('descreve a operacao sem jargao', () => {
    expect(efeitoDoCfop('5117').rotulo).toMatch(/entrega/i)
    expect(efeitoDoCfop('5910').rotulo).toMatch(/bonifica/i)
  })
})
