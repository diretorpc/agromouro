import { describe, it, expect } from 'vitest'
import { aplicarFamiliaATodos, itemTrancado, cfopAposEscolha, podeGravar, precisaConfirmarEfeitoIncomum, type FamiliaItem } from './regras-conferencia'

const COMPRA: FamiliaItem            = { chave: 'compra',           rotulo: 'Compra normal',    cfop: '5102', contaComoCompra: true }
const ENTREGA_FATURADA: FamiliaItem  = { chave: 'entrega-faturada', rotulo: 'Entrega faturada',  cfop: '5117', contaComoCompra: false }
const FATURAMENTO: FamiliaItem       = { chave: 'faturamento',      rotulo: 'Faturamento',       cfop: '5922', contaComoCompra: true }
const BONIFICACAO: FamiliaItem       = { chave: 'bonificacao',      rotulo: 'Bonificação',       cfop: '5910', contaComoCompra: false }

describe('cfopAposEscolha — confirmar a MESMA família mantém o CFOP lido', () => {
  it('item interestadual (6117) confirmando a mesma família mantém 6117, não reescreve pra 5117', () => {
    const item = { cfop: '6117', familia: 'entrega-faturada' }
    expect(cfopAposEscolha(item, ENTREGA_FATURADA)).toBe('6117')
  })

  it('item interno (5102) confirmando a mesma família mantém 5102', () => {
    const item = { cfop: '5102', familia: 'compra' }
    expect(cfopAposEscolha(item, COMPRA)).toBe('5102')
  })

  it('mesma familia mas SEM cfop lido (ex.: item sem CFOP) usa o representante — nada pra manter', () => {
    const item = { cfop: '', familia: 'compra' }
    expect(cfopAposEscolha(item, COMPRA)).toBe('5102')
  })
})

describe('cfopAposEscolha — trocar de família preserva o dígito de estado (achado 7)', () => {
  it('item 6117 (interestadual) trocado para bonificação grava 6910, NUNCA 5910', () => {
    const item = { cfop: '6117', familia: 'entrega-faturada' }
    expect(cfopAposEscolha(item, BONIFICACAO)).toBe('6910')
  })

  it('item 6102 (interestadual) trocado para faturamento grava 6922, não 5922', () => {
    const item = { cfop: '6102', familia: 'compra' }
    expect(cfopAposEscolha(item, FATURAMENTO)).toBe('6922')
  })

  it('item interno (5117) trocado para outra família usa o representante normal (5xxx)', () => {
    const item = { cfop: '5117', familia: 'entrega-faturada' }
    expect(cfopAposEscolha(item, BONIFICACAO)).toBe('5910')
  })

  it('item sem CFOP nenhum (cfop vazio) escolhendo qualquer família usa o representante', () => {
    const item = { cfop: '', familia: '' }
    expect(cfopAposEscolha(item, COMPRA)).toBe('5102')
    expect(cfopAposEscolha(item, BONIFICACAO)).toBe('5910')
  })
})

describe('podeGravar', () => {
  const BASE = { quantidadeItens: 2, semCfop: 0, familias: [COMPRA, ENTREGA_FATURADA, FATURAMENTO, BONIFICACAO], duplicataValendo: null, gravando: false }

  it('caso comum — tudo certo, pode gravar', () => {
    expect(podeGravar(BASE)).toBe(true)
  })

  it('gravando: nao deixa clicar de novo', () => {
    expect(podeGravar({ ...BASE, gravando: true })).toBe(false)
  })

  it('sem item nenhum: nao deixa gravar nota vazia', () => {
    expect(podeGravar({ ...BASE, quantidadeItens: 0 })).toBe(false)
  })

  it('duplicata valendo: trava ate o dono corrigir a identificacao', () => {
    expect(podeGravar({ ...BASE, duplicataValendo: true })).toBe(false)
  })

  it('item sem cfop COM familias disponiveis: trava — decidir "e compra" por omissao e o caminho do gasto dobrado', () => {
    expect(podeGravar({ ...BASE, semCfop: 1 })).toBe(false)
  })

  it('familias vazias (API antiga) NAO travam o botao — sem escolha possivel, travar prenderia o dono sem saida', () => {
    expect(podeGravar({ ...BASE, semCfop: 3, familias: [] })).toBe(true)
  })

  it('familias undefined (mesmo caso da API antiga) tambem nao trava', () => {
    expect(podeGravar({ ...BASE, semCfop: 3, familias: undefined })).toBe(true)
  })
})

describe('precisaConfirmarEfeitoIncomum — a nota inteira fora de "compra"', () => {
  const item = (familia?: string, cfop = '5102') => ({ cfop, familia })

  it('nota normal (tudo compra) NAO pede confirmacao', () => {
    expect(precisaConfirmarEfeitoIncomum([item('compra'), item('compra')])).toBe(false)
  })

  it('nota inteira lida como faturamento PEDE confirmacao', () => {
    // O caso real de 24/08/2026: loja de material de construcao, CFOP 5405 e
    // 5102 impressos, lidos como 5922 nos cinco itens.
    expect(precisaConfirmarEfeitoIncomum([
      item('faturamento', '5922'), item('faturamento', '5922'), item('faturamento', '5922'),
    ])).toBe(true)
  })

  it('nota inteira como bonificacao ou entrega ja paga tambem pede', () => {
    expect(precisaConfirmarEfeitoIncomum([item('bonificacao', '5910')])).toBe(true)
    expect(precisaConfirmarEfeitoIncomum([item('entrega-faturada', '5117')])).toBe(true)
  })

  it('nota MISTA nao pede — e o caso legitimo mais comum ("compre 20, leve 2")', () => {
    expect(precisaConfirmarEfeitoIncomum([item('compra'), item('bonificacao', '5910')])).toBe(false)
  })

  it('item sem familia reconhecida (consignacao) conta como fora de compra', () => {
    expect(precisaConfirmarEfeitoIncomum([item(undefined, '5917')])).toBe(true)
  })

  it('lista vazia nao pede confirmacao — quem barra nota sem item e outra regra', () => {
    expect(precisaConfirmarEfeitoIncomum([])).toBe(false)
  })
})

describe('podeGravar — confirmacao de efeito incomum', () => {
  const base = {
    quantidadeItens: 3, semCfop: 0, familias: [{ chave: 'compra' }],
    duplicataValendo: null, gravando: false,
  }

  it('trava enquanto o efeito incomum nao for confirmado', () => {
    expect(podeGravar({ ...base, efeitoIncomumPendente: true })).toBe(false)
  })

  it('libera depois de confirmado', () => {
    expect(podeGravar({ ...base, efeitoIncomumPendente: false })).toBe(true)
  })

  it('sem o campo, comportamento antigo intacto', () => {
    expect(podeGravar(base)).toBe(true)
  })
})

describe('aplicarFamiliaATodos — o conserto de 1 clique da nota lida errado', () => {
  it('nota inteira lida como 5922 vira compra normal (5102) em todos os itens', () => {
    // O caso real de 25/08/2026: nota 289122 da RURALCENTRO, 19 itens, CFOP
    // 5102 e 5405 impressos no papel, TODOS lidos como 5922. Nenhum item
    // entrou no estoque.
    //
    // Repare que a saída é 5102 mesmo nas linhas cujo papel diz 5405: o botão
    // grava o representante da família, não sabe o que está impresso. Sem efeito
    // em dinheiro nem estoque (5102 e 5405 são os dois COMPRA_NORMAL), mas o
    // rótulo do botão não pode PROMETER fidelidade ao papel — e não promete,
    // está escrito no bloco vermelho (achado [médio] do Apolo).
    const itens = [
      { cfop: '5922', familia: 'faturamento' },
      { cfop: '5922', familia: 'faturamento' },
    ]
    expect(aplicarFamiliaATodos(itens, COMPRA)).toEqual([
      { cfop: '5102', familia: 'compra' },
      { cfop: '5102', familia: 'compra' },
    ])
  })

  it('item interestadual (6922) vira 6102, nunca 5102 — o dígito de estado é preservado', () => {
    expect(aplicarFamiliaATodos([{ cfop: '6922', familia: 'faturamento' }], COMPRA))
      .toEqual([{ cfop: '6102', familia: 'compra' }])
  })

  it('item que JÁ era compra mantém o CFOP impresso na nota (5405 não vira 5102)', () => {
    // 5405 é compra normal e não está na tabela de efeitos especiais. Reescrever
    // para 5102 gravaria um código que a nota nunca imprimiu.
    expect(aplicarFamiliaATodos([{ cfop: '5405', familia: 'compra' }], COMPRA))
      .toEqual([{ cfop: '5405', familia: 'compra' }])
  })

  it('item sem CFOP legível também é resolvido pelo mesmo clique', () => {
    expect(aplicarFamiliaATodos([{ cfop: '', familia: '' }], COMPRA))
      .toEqual([{ cfop: '5102', familia: 'compra' }])
  })

  it('não encosta nos outros campos do item (centro de custo, descrição)', () => {
    const itens = [{ cfop: '5922', familia: 'faturamento', centroCusto: 'tejuco', descricao: 'REMEDIO BAYCOX 1000ML' }]
    expect(aplicarFamiliaATodos(itens, COMPRA)).toEqual([
      { cfop: '5102', familia: 'compra', centroCusto: 'tejuco', descricao: 'REMEDIO BAYCOX 1000ML' },
    ])
  })

  it('não muta a lista original — o React precisa ver referência nova', () => {
    const itens = [{ cfop: '5922', familia: 'faturamento' }]
    const saida = aplicarFamiliaATodos(itens, COMPRA)
    expect(itens[0].cfop).toBe('5922')
    expect(saida).not.toBe(itens)
  })

  it('lista vazia devolve lista vazia', () => {
    expect(aplicarFamiliaATodos([], COMPRA)).toEqual([])
  })

  it('serve para qualquer família, não só compra', () => {
    expect(aplicarFamiliaATodos([{ cfop: '5102', familia: 'compra' }], BONIFICACAO))
      .toEqual([{ cfop: '5910', familia: 'bonificacao' }])
  })
})

describe('itemTrancado — o item que a tela não deixa trocar de efeito', () => {
  it('CFOP lido de família fora das quatro (remessa, consignação) fica trancado', () => {
    expect(itemTrancado({ cfop: '5905', familia: '' })).toBe(true)
    expect(itemTrancado({ cfop: '5912', familia: undefined })).toBe(true)
    expect(itemTrancado({ cfop: '5917', familia: '' })).toBe(true)
  })

  it('CFOP de família conhecida NÃO está trancado — o dono escolhe no select', () => {
    expect(itemTrancado({ cfop: '5922', familia: 'faturamento' })).toBe(false)
    expect(itemTrancado({ cfop: '5102', familia: 'compra' })).toBe(false)
  })

  it('item sem CFOP nenhum NÃO está trancado — é justamente quem precisa de escolha', () => {
    expect(itemTrancado({ cfop: '', familia: '' })).toBe(false)
  })
})

describe('aplicarFamiliaATodos — o botão não passa por cima da trava', () => {
  it('item de remessa (5905) sobrevive intacto ao "são todos compra normal"', () => {
    // Achado [alto] do Apolo (25/08/2026): 5905 tem entraNoEstoque=false e
    // contaComoCompra=false. Virar 5102 criaria gasto novo E entrada de estoque
    // com um clique — a mesma classe do gasto fantasma de R$ 1,06 mi da SYAGRI.
    // Pior: irreversível na tela, porque o select só oferece as quatro famílias.
    const itens = [
      { cfop: '5905', familia: '' },
      { cfop: '5922', familia: 'faturamento' },
    ]
    expect(aplicarFamiliaATodos(itens, COMPRA)).toEqual([
      { cfop: '5905', familia: '' },
      { cfop: '5102', familia: 'compra' },
    ])
  })

  it('nota inteira de remessa não muda nada — o botão fica sem efeito, e é o certo', () => {
    const itens = [{ cfop: '5912', familia: '' }, { cfop: '5920', familia: '' }]
    expect(aplicarFamiliaATodos(itens, COMPRA)).toEqual(itens)
  })

  it('o item trancado volta por REFERÊNCIA — nada nele foi reescrito', () => {
    const trancado = { cfop: '5917', familia: '' }
    expect(aplicarFamiliaATodos([trancado], COMPRA)[0]).toBe(trancado)
  })

})
