import { describe, it, expect } from 'vitest'
import { efeitoDoCfop, familiaDoCfop, FAMILIAS_ITEM } from './cfop'

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

describe('efeitoDoCfop — imutabilidade (garante que corrupção silenciosa nao vai acontecer)', () => {
  it('tentar mutar um efeito retornado nao muda a proxima chamada (CFOP registrado)', () => {
    const e1 = efeitoDoCfop('5117')
    const rotulo1 = e1.rotulo

    // Tenta mutar — deve falhar silenciosamente ou lancar em strict mode
    try {
      ;(e1 as any).rotulo = 'foi alterado!'
    } catch {
      // TypeError esperado em strict mode; OK
    }

    // Proxima chamada retorna o original intacto
    const e2 = efeitoDoCfop('5117')
    expect(e2.rotulo).toBe(rotulo1)
  })

  it('tentar mutar um efeito retornado nao muda a proxima chamada (fallback COMPRA_NORMAL)', () => {
    const e1 = efeitoDoCfop('9999') // CFOP desconhecido
    const contaComoCompra1 = e1.contaComoCompra

    // Tenta mutar
    try {
      ;(e1 as any).contaComoCompra = false
    } catch {
      // TypeError esperado em strict mode; OK
    }

    // Proxima chamada retorna o original intacto
    const e2 = efeitoDoCfop('8888') // outro desconhecido
    expect(e2.contaComoCompra).toBe(contaComoCompra1)
  })
})

describe('FAMILIAS_ITEM / familiaDoCfop — o que a tela de conferência oferece', () => {
  it('cada família representante devolve a própria chave', () => {
    for (const f of FAMILIAS_ITEM) {
      expect(familiaDoCfop(f.cfop)).toBe(f.chave)
    }
  })

  it('qualquer CFOP da mesma família cai na mesma chave — não é lista de códigos', () => {
    expect(familiaDoCfop('6117')).toBe('entrega-faturada')
    expect(familiaDoCfop('5116')).toBe('entrega-faturada')
    expect(familiaDoCfop('6922')).toBe('faturamento')
    expect(familiaDoCfop('6910')).toBe('bonificacao')
  })

  it('CFOP ausente cai em compra — é o que efeitoDoCfop já faz por omissão', () => {
    expect(familiaDoCfop('')).toBe('compra')
  })

  it('família que a tela NÃO oferece devolve vazio, em vez de mentir que é compra', () => {
    // Consignação e remessa sem compra têm efeito próprio; oferecer "compra"
    // para elas trocaria um efeito certo por um errado.
    expect(familiaDoCfop('5917')).toBe('')
    expect(familiaDoCfop('5912')).toBe('')
  })

  it('escolher a família grava um CFOP que produz exatamente aquele efeito', () => {
    const entrega = FAMILIAS_ITEM.find(f => f.chave === 'entrega-faturada')!
    expect(efeitoDoCfop(entrega.cfop).entraNoEstoque).toBe(true)
    expect(efeitoDoCfop(entrega.cfop).contaComoCompra).toBe(false)

    const bonificacao = FAMILIAS_ITEM.find(f => f.chave === 'bonificacao')!
    expect(efeitoDoCfop(bonificacao.cfop).custoZero).toBe(true)
  })

  // Achado [médio] do Apolo, 3ª rodada (24/08/2026): a tela de conferência do
  // PDF precisa saber, por família, se ela conta como gasto — sem duplicar a
  // regra fiscal de cabeça (o erro medido: supor que só "compra" conta, quando
  // "faturamento" — paga agora, entrega depois — também conta). Cada
  // `contaComoCompra` do FAMILIAS_ITEM tem que bater com o `efeitoDoCfop` do
  // seu próprio CFOP representante, para as duas fontes nunca divergirem.
  it('contaComoCompra de cada família bate com efeitoDoCfop do seu cfop representante', () => {
    for (const f of FAMILIAS_ITEM) {
      expect(f.contaComoCompra).toBe(efeitoDoCfop(f.cfop).contaComoCompra)
    }
  })

  it('doutrina: compra e faturamento contam como gasto; entrega-faturada e bonificacao não', () => {
    const por = (chave: string) => FAMILIAS_ITEM.find(f => f.chave === chave)!.contaComoCompra
    expect(por('compra')).toBe(true)
    expect(por('faturamento')).toBe(true)
    expect(por('entrega-faturada')).toBe(false)
    expect(por('bonificacao')).toBe(false)
  })
})
