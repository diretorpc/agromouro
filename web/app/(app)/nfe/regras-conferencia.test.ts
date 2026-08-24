import { describe, it, expect } from 'vitest'
import { cfopAposEscolha, podeGravar, type FamiliaItem } from './regras-conferencia'

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
