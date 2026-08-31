import { describe, it, expect } from 'vitest'
import { casarNotaComBoleto, sugestaoParaPreSelecionar, type NotaCandidata } from './casarNota'
import type { BoletoLido } from './boletoPdf'

function boleto(over: Partial<BoletoLido> = {}): BoletoLido {
  return {
    valor: 37644,
    vencimento: '2026-11-03',
    beneficiario: 'MIKAMI COMERCIO DE PRODUTOS AGRICOLAS LTDA ME',
    cobradoPor: null,
    documento: '2 -0004507-001',
    totalDeCobrancas: 1,
    ...over,
  }
}

function nota(over: Partial<NotaCandidata> = {}): NotaCandidata {
  return {
    id: 'nf-1',
    numero: '4507',
    emitente_nome: 'MIKAMI COMERCIO DE PRODUTOS AGRICOLAS LTDA',
    valor_total: 37644,
    data_emissao: '2026-07-31',
    contas: [],
    lancouGasto: true,
    ...over,
  }
}

describe('casarNotaComBoleto', () => {
  // O caso real que criou esta feature (31/08/2026): nota 4507 da MIKAMI já no
  // sistema desde julho, boleto só chegou depois.
  it('acha a nota do caso MIKAMI pelos três sinais', () => {
    const r = casarNotaComBoleto(boleto(), [nota()])
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('nf-1')
    expect(r[0].motivos).toEqual(
      expect.arrayContaining(['mesmo fornecedor', 'mesmo valor', 'número da nota no boleto']),
    )
  })

  it('não oferece nota que não casa em nada', () => {
    const r = casarNotaComBoleto(boleto(), [
      nota({ id: 'outra', numero: '9999', emitente_nome: 'AGRO XYZ LTDA', valor_total: 100 }),
    ])
    expect(r).toEqual([])
  })

  it('casa fornecedor por nome parecido, não idêntico', () => {
    const r = casarNotaComBoleto(
      boleto({ beneficiario: 'Higa Comércio' }),
      [nota({ id: 'higa', emitente_nome: 'HIGA COMERCIO E DISTRIBUICAO LTDA', valor_total: 1, numero: '77' })],
    )
    expect(r).toHaveLength(1)
    expect(r[0].motivos).toContain('mesmo fornecedor')
  })

  // ACHADO 8 do Apolo: o mutante `slice(0, 1)` — casar fornecedor por UMA
  // palavra — passava por toda a suíte. Duas empresas diferentes que começam
  // igual são o caso comum no agro ('AGRO ...', 'COMERCIAL ...').
  it('exige DUAS palavras: não casa fornecedor que só compartilha a primeira', () => {
    const r = casarNotaComBoleto(
      boleto({ beneficiario: 'AGRO SANTA MARIA LTDA', valor: 1, documento: null }),
      [nota({ emitente_nome: 'AGRO XYZ COMERCIO LTDA', valor_total: 999, numero: '1' })],
    )
    expect(r).toEqual([])
  })

  it('ordena a mais provável primeiro', () => {
    const fraca = nota({ id: 'fraca', numero: '111', valor_total: 999 })
    const forte = nota({ id: 'forte' })
    const r = casarNotaComBoleto(boleto(), [fraca, forte])
    expect(r.map(n => n.id)).toEqual(['forte', 'fraca'])
  })

  // ACHADO 8: o desempate por emissão não tinha teste — trocar o comparador por
  // `return 0` passava batido.
  it('desempata pela nota mais recente quando a força é igual', () => {
    const velha = nota({ id: 'velha', numero: '111', valor_total: 999, data_emissao: '2026-01-10' })
    const nova  = nota({ id: 'nova',  numero: '222', valor_total: 999, data_emissao: '2026-07-20' })
    const r = casarNotaComBoleto(boleto(), [velha, nova])
    expect(r.map(n => n.id)).toEqual(['nova', 'velha'])
  })

  // Nota com conta NÃO é bloqueada nem rebaixada: pode ser a 2ª parcela, que é
  // caso legítimo. Quem decide é o dono, vendo as contas que ela já tem.
  it('não rebaixa nota que já tem conta — pode ser outra parcela', () => {
    const comConta = nota({ contas: [{ id: 'c1', valor: 12548, vencimento: '2026-09-03', status: 'aberta' }] })
    const r = casarNotaComBoleto(boleto(), [comConta])
    expect(r).toHaveLength(1)
    expect(r[0].contas).toHaveLength(1)
  })

  it('acha o número da nota dentro do documento com zeros e traços', () => {
    const r = casarNotaComBoleto(
      boleto({ beneficiario: 'OUTRO NOME', valor: 1 }),
      [nota({ valor_total: 999 })],
    )
    expect(r).toHaveLength(1)
    expect(r[0].motivos).toEqual(['número da nota no boleto'])
  })

  // ACHADO 2 do Apolo [alto]. `includes` em '20004507001' aceitava ONZE números
  // de nota diferentes. Estes são os falsos positivos que ele mediu.
  it.each(['200', '450', '507', '700', '2000', '5070', '7001', '20004', '45070', '50700'])(
    'NÃO casa a nota %s com o documento "2 -0004507-001"',
    numero => {
      const r = casarNotaComBoleto(
        boleto({ beneficiario: 'OUTRO', valor: 1 }),
        [nota({ numero, valor_total: 999 })],
      )
      expect(r).toEqual([])
    },
  )

  it('ainda casa o número certo depois de fechar a fronteira', () => {
    const r = casarNotaComBoleto(
      boleto({ beneficiario: 'OUTRO', valor: 1 }),
      [nota({ numero: '4507', valor_total: 999 })],
    )
    expect(r[0].motivos).toEqual(['número da nota no boleto'])
  })

  // ACHADO 8: o mutante `< 3` → `< 2` sobrevivia. Nota de 2 dígitos casaria com
  // qualquer boleto que tivesse esses dois dígitos num bloco.
  it.each(['1', '11'])('ignora número de nota curto demais para ser sinal (%s)', numero => {
    const r = casarNotaComBoleto(
      boleto({ beneficiario: 'OUTRO', valor: 1, documento: `2 -0000${numero.padStart(3, "0")}-001` }),
      [nota({ numero, valor_total: 999 })],
    )
    expect(r).toEqual([])
  })

  it('casa nota parcelada, onde o valor do boleto é menor', () => {
    const r = casarNotaComBoleto(boleto({ valor: 12548 }), [nota()])
    expect(r).toHaveLength(1)
    expect(r[0].motivos).not.toContain('mesmo valor')
    expect(r[0].motivos).toContain('mesmo fornecedor')
  })

  it('compara valor em centavos, sem sujeira de ponto flutuante', () => {
    const r = casarNotaComBoleto(
      boleto({ valor: 0.1 + 0.2, beneficiario: 'X', documento: null }),
      [nota({ valor_total: 0.3, emitente_nome: 'Y', numero: '1' })],
    )
    expect(r).toHaveLength(1)
    expect(r[0].motivos).toEqual(['mesmo valor'])
  })

  it('aguenta boleto sem documento e nota sem nome', () => {
    const r = casarNotaComBoleto(
      boleto({ documento: null }),
      [nota({ emitente_nome: '', numero: '' })],
    )
    expect(r).toHaveLength(1)
    expect(r[0].motivos).toEqual(['mesmo valor'])
  })

  // ACHADO 8: `toBeLessThanOrEqual(10)` era frouxa — o mutante que baixava o
  // teto para 3 passava. Corta em 10 exatos.
  it('corta a lista em 10 sugestões', () => {
    const muitas = Array.from({ length: 40 }, (_, i) => nota({ id: `n${i}`, numero: String(9000 + i) }))
    expect(casarNotaComBoleto(boleto(), muitas)).toHaveLength(10)
  })
})

// ACHADO 9 do Apolo: esta regra morava dentro do JSX, sem teste — e o ACHADO 2
// provou que ela pré-marcava a nota errada.
describe('sugestaoParaPreSelecionar', () => {
  const sug = (over: Partial<NotaCandidata> & { motivos: any }) => ({ ...nota(), ...over }) as any

  it('marca quando há valor igual e a segunda é mais fraca', () => {
    const r = sugestaoParaPreSelecionar([
      sug({ id: 'forte', motivos: ['mesmo fornecedor', 'mesmo valor', 'número da nota no boleto'] }),
      sug({ id: 'fraca', motivos: ['mesmo fornecedor'] }),
    ])
    expect(r).toBe('forte')
  })

  // O caso concreto do ACHADO 2: nota errada com 2 motivos, nenhum deles sobre
  // o valor da cobrança.
  it('NÃO marca quando o valor não bate, mesmo com dois motivos', () => {
    const r = sugestaoParaPreSelecionar([
      sug({ id: 'nf-450', motivos: ['mesmo fornecedor', 'número da nota no boleto'] }),
    ])
    expect(r).toBeNull()
  })

  it('NÃO marca quando há empate de força — escolher por empate é chutar', () => {
    const r = sugestaoParaPreSelecionar([
      sug({ id: 'a', motivos: ['mesmo fornecedor', 'mesmo valor'] }),
      sug({ id: 'b', motivos: ['mesmo fornecedor', 'mesmo valor'] }),
    ])
    expect(r).toBeNull()
  })

  // Amarrar em nota que não lançou gasto faz o dinheiro sumir. Isso nunca pode
  // chegar pré-marcado.
  it('NÃO marca nota que não lançou gasto no Financeiro', () => {
    const r = sugestaoParaPreSelecionar([
      sug({ id: 'sem-gasto', lancouGasto: false, motivos: ['mesmo fornecedor', 'mesmo valor', 'número da nota no boleto'] }),
    ])
    expect(r).toBeNull()
  })

  it('não marca nada quando não há sugestão', () => {
    expect(sugestaoParaPreSelecionar([])).toBeNull()
  })
})
