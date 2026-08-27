import { describe, it, expect } from 'vitest'
import { aplicarFamiliaATodos, sinaisDeNotaDeProduto, itemTrancado, cfopAposEscolha, linhasSemQuantidade, pendenciasDeCfop, podeGravar, precisaConfirmarEfeitoIncomum, type FamiliaItem } from './regras-conferencia'

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
  const BASE = { quantidadeItens: 2, semCfop: 0, familias: [COMPRA, ENTREGA_FATURADA, FATURAMENTO, BONIFICACAO], duplicataValendo: null, gravando: false, linhasSemQuantidade: 0, efeitoIncomumPendente: false }

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
    duplicataValendo: null, gravando: false, linhasSemQuantidade: 0,
    efeitoIncomumPendente: false,
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

describe('pendenciasDeCfop — NFS-e não tem CFOP', () => {
  const servico = [{ cfop: '' }]

  it('NFS-e sem CFOP não é pendência — o botão de gravar NÃO trava', () => {
    // Achado [alto] do Apolo (27/08/2026): contar o CFOP vazio de uma nota de
    // serviço como pendência desabilitava "Confirmar e gravar", e a única saída
    // da tela era escolher uma família — que carimba um 5102 inventado numa nota
    // que não tem CFOP nenhum. O 422 tinha virado botão morto.
    const p = pendenciasDeCfop('nfse', servico)
    expect(p).toEqual({ semCfop: 0, efeitoIncomum: false })
    expect(podeGravar({
      quantidadeItens: 1, semCfop: p.semCfop, familias: [{ chave: 'compra' }],
      duplicataValendo: null, gravando: false, efeitoIncomumPendente: p.efeitoIncomum,
      linhasSemQuantidade: 0,
    })).toBe(true)
  })

  it('a MESMA nota marcada como NF-e volta a travar — a régua do DANFE fica de pé', () => {
    // É o que acontece quando o dono corrige o campo "Tipo" na tela.
    const p = pendenciasDeCfop('nfe', servico)
    expect(p).toEqual({ semCfop: 1, efeitoIncomum: true })
    expect(podeGravar({
      quantidadeItens: 1, semCfop: p.semCfop, familias: [{ chave: 'compra' }],
      duplicataValendo: null, gravando: false, efeitoIncomumPendente: p.efeitoIncomum,
      linhasSemQuantidade: 0,
    })).toBe(false)
  })

  it('DANFE normal não é afetada: conta os sem CFOP e respeita a família lida', () => {
    expect(pendenciasDeCfop('nfe', [
      { cfop: '5102', familia: 'compra' },
      { cfop: '',     familia: undefined },
    ])).toEqual({ semCfop: 1, efeitoIncomum: false })
  })

  it('DANFE inteira fora de "compra" continua parando o dono', () => {
    expect(pendenciasDeCfop('nfe', [
      { cfop: '5922', familia: 'entregaFutura' },
      { cfop: '5910', familia: 'bonificacao' },
    ])).toEqual({ semCfop: 0, efeitoIncomum: true })
  })
})

describe('sinaisDeNotaDeProduto — o papel contradiz o campo "Tipo"', () => {
  // Achado [médio] do Apolo (27/08/2026), medido com a nota 289122 real (19
  // linhas de CFOP impresso): trocar o "Tipo" para NFS-e apagava banner
  // vermelho, banner âmbar e a trava do botão de uma vez só, num clique — a
  // nota entrava inteira como serviço e NENHUM item ia para o estoque.
  it('NFS-e com CFOP impresso nas linhas: conta e avisa', () => {
    expect(sinaisDeNotaDeProduto('nfse', [
      { cfop: '5922', cfopLido: '5922' },
      { cfop: '5102', cfopLido: '5102' },
    ])).toBe(2)
  })

  it('NCM impresso sozinho já basta para o aviso', () => {
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', ncm: '31021000' }])).toBe(1)
  })

  it('NFS-e de verdade não dispara aviso nenhum', () => {
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', ncm: '', cfopLido: '', quantidade: null, unidade: 'un' }])).toBe(0)
  })

  it('quantidade COM unidade de mercadoria acende — o sinal que sobrevive ao rótulo errado', () => {
    // O caso caro: a IA decide "isto é serviço" e, coerente com essa decisão,
    // devolve ncm/cfop nulos — apagando a própria evidência. Quantidade e
    // unidade não somem junto: NFS-e não tem coluna de quantidade.
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 3, unidade: 'TON' }])).toBe(1)
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 165, unidade: 'MTN' }])).toBe(1)
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 2, unidade: 'sc' }])).toBe(1)
  })

  it('quantidade SOZINHA não acende — NFS-e do padrão ABRASF traz "Qtde 1,00"', () => {
    // Achado [médio] do Apolo, 4ª rodada (27/08/2026): com quantidade sozinha
    // como sinal, o aviso acendia em nota de serviço legítima e virava ruído.
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 1, unidade: 'un' }])).toBe(0)
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 3, unidade: 'H' }])).toBe(0)
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 40, unidade: 'M2' }])).toBe(0)
    // Sem unidade nenhuma, quantidade sozinha continua não bastando.
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 1 }])).toBe(0)
  })

  it('unidade de mercadoria SOZINHA também não acende — precisa do par', () => {
    // Sem quantidade impressa a nota tem cara de serviço de verdade: NFS-e não
    // tem a coluna. A unidade sozinha vem do default 'un' do validador.
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: null, unidade: 'KG' }])).toBe(0)
  })

  it('unidade que NINGUÉM previu acende — é lista de negação, não de permissão', () => {
    // O ponto do achado [médio] da 5ª rodada: `uCom` é texto livre na NF-e, e
    // lista de permissão erra por omissão — calando. Duas versões dela já
    // tinham errado justo nas unidades que este projeto usa (TON do fixture de
    // DANFE, MTN do contrato da SYAGRI), e uma DANFE de 8 linhas com
    // PEÇA/FRASCO/BALDE/PACOTE não acendia aviso nenhum.
    for (const un of ['TON', 'ton', 'MTN', 'SACO', 'FD', 'CENTO', 'KIT',
                      'PEÇA', 'FRASCO', 'BALDE', 'PACOTE', 'MT', 'RESMA', 'xyz']) {
      expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 1, unidade: un }])).toBe(1)
    }
  })

  it('as unidades de SERVIÇO de verdade continuam quietas', () => {
    for (const un of ['un', 'UN', 'UND', 'UNIDADE', 'H', 'HORA', 'HRS',
                      'DIA', 'MES', 'M2', 'M³', 'SERV', 'VB', '']) {
      expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '', quantidade: 3, unidade: un }])).toBe(0)
    }
  })

  it('nota de PRODUTO nunca dispara — lá o código é o normal', () => {
    expect(sinaisDeNotaDeProduto('nfe', [{ cfop: '5102', cfopLido: '5102', ncm: '38089329' }])).toBe(0)
  })

  it('o CFOP que o DONO escolheu não conta como impresso — só o lido', () => {
    // `cfop` sem `cfopLido` é escolha de família, não leitura do papel. Contar
    // isso faria o aviso nascer do próprio conserto do dono.
    expect(sinaisDeNotaDeProduto('nfse', [{ cfop: '5102', cfopLido: '' }])).toBe(0)
  })
})

describe('linhasSemQuantidade — nota de produto exige quantidade impressa', () => {
  it('NF-e com linha sem quantidade TRAVA o botão, em vez de deixar bater no 422', () => {
    // Achado [baixo] do Apolo (27/08/2026): sem esta trava o dono escolhia
    // "Compra normal" no CFOP, o botão habilitava, e o servidor respondia
    // "Não consegui ler nenhum item desta nota" com o item ali, à vista.
    const itens = [{ cfop: '5102', quantidade: null }]
    expect(linhasSemQuantidade('nfe', itens)).toBe(1)
    expect(podeGravar({
      quantidadeItens: 1, semCfop: 0, familias: [{ chave: 'compra' }],
      duplicataValendo: null, gravando: false, efeitoIncomumPendente: false,
      linhasSemQuantidade: linhasSemQuantidade('nfe', itens),
    })).toBe(false)
  })

  it('a MESMA linha numa NFS-e é legítima — não conta e não trava', () => {
    const itens = [{ cfop: '', quantidade: null }]
    expect(linhasSemQuantidade('nfse', itens)).toBe(0)
    expect(podeGravar({
      quantidadeItens: 1, semCfop: 0, familias: [{ chave: 'compra' }],
      duplicataValendo: null, gravando: false, efeitoIncomumPendente: false,
      linhasSemQuantidade: linhasSemQuantidade('nfse', itens),
    })).toBe(true)
  })

  it('DANFE com quantidade lida em todas as linhas não é afetada', () => {
    expect(linhasSemQuantidade('nfe', [{ cfop: '5102', quantidade: 5 }])).toBe(0)
  })

  it('o campo é OBRIGATÓRIO — esquecer de passar é erro de compilação, não bug calado', () => {
    // O `web` não tem testing-library: nenhum teste prova que o componente
    // chama `podeGravar` com o valor certo. O Apolo mediu na 3ª rodada
    // (27/08/2026) que arrancar o argumento da chamada em conferencia-pdf.tsx
    // deixava as 281 verdes e o tsc limpo. Com o campo obrigatório, o
    // compilador é a guarda. Este teste existe para explicar o porquê — se
    // alguém voltar o `?`, ele some junto e o motivo se perde.
    // @ts-expect-error — faltam `linhasSemQuantidade` e `efeitoIncomumPendente`
    expect(() => podeGravar({
      quantidadeItens: 1, semCfop: 0, familias: [{ chave: 'compra' }],
      duplicataValendo: null, gravando: false,
    })).not.toThrow()
  })
})
