import { describe, it, expect } from 'vitest'
import { patchDoItemEditado, previaDoTotal, dataEhEditavel, type ItemOriginal, type FormularioItem } from './salvar-item'

// Os quatro casos abaixo NÃO são inventados: saíram de uma varredura no banco de
// produção em 28/08/2026, quando 31 das 368 linhas de `itens_nfe` violavam
// `quantidade × valor_unitario === valor_total`.

// Linha normal: a conta fecha.
const NORMAL: ItemOriginal = { quantidade: 5, valor_unitario: 880, valor_total: 4400, nota_fiscal_id: 'nf-1' }

// CANA DE AÇÚCAR, nota fiscal real: quantidade e unitário nunca foram lidos.
// Recalcular zerava R$ 119.938,34.
const CANA: ItemOriginal = { quantidade: 0, valor_unitario: 0, valor_total: 119938.34, nota_fiscal_id: 'nf-2' }

// Documento de Controle real (VERDAVIS): quantidade e unitário existem, mas não
// batem com o total. 60 × 480 = 28.800 contra 100.000 gravados — qual dos dois
// números é o certo é outra pergunta, e este conserto protege sem precisar
// respondê-la.
// Documento de Controle: sem nota fiscal, então a data É editável aqui.
const CONTRATO: ItemOriginal = { quantidade: 60, valor_unitario: 480, valor_total: 100000, nota_fiscal_id: null }

// Cana com quantidade enorme: o unitário tem 4 casas e o total é preciso, então
// o produto erra alguns reais para cima.
const ARREDONDA: ItemOriginal = { quantidade: 711730, valor_unitario: 0.0837, valor_total: 59546.18, nota_fiscal_id: 'nf-3' }

function formDe(o: ItemOriginal, over: Partial<FormularioItem> = {}): FormularioItem {
  return {
    descricao:      'CANA DE ACUCAR',
    quantidade:     String(o.quantidade),
    unidade:        'KG',
    valor_unitario: String(o.valor_unitario),
    centro_custo:   'outro',
    data:           '2026-08-10',
    ...over,
  }
}

describe('patchDoItemEditado — trocar o centro de custo NÃO mexe no dinheiro', () => {
  // É o caminho que produz o estrago: o diálogo existe principalmente para
  // escolher o centro de custo, e salvar recalculava o total.
  it('linha de cana com quantidade e unitário zerados: o total sobrevive', () => {
    const p = patchDoItemEditado(CANA, formDe(CANA, { centro_custo: 'insumo' }))
    expect(p.valor_total).toBe(119938.34)
    expect(p.centro_custo).toBe('insumo')
  })

  it('linha de contrato (60 × 480 ≠ 100.000): o total sobrevive', () => {
    const p = patchDoItemEditado(CONTRATO, formDe(CONTRATO, { centro_custo: 'defensivo' }))
    expect(p.valor_total).toBe(100000)
  })

  it('linha com arredondamento de centavos: o total sobrevive', () => {
    const p = patchDoItemEditado(ARREDONDA, formDe(ARREDONDA, { centro_custo: 'insumo' }))
    expect(p.valor_total).toBe(59546.18)
  })

  it('linha normal também não é reescrita — nem para o mesmo número', () => {
    const p = patchDoItemEditado(NORMAL, formDe(NORMAL, { centro_custo: 'herbicida' }))
    expect(p.valor_total).toBe(4400)
  })

  it('editar a DESCRIÇÃO ou a UNIDADE também não mexe no total', () => {
    const p = patchDoItemEditado(CANA, formDe(CANA, { descricao: '  CANA MOÍDA  ', unidade: 'TON' }))
    expect(p.valor_total).toBe(119938.34)
    expect(p.descricao).toBe('CANA MOÍDA')
    expect(p.unidade).toBe('TON')
  })
})

describe('patchDoItemEditado — mexer na conta É intenção, e aí recalcula', () => {
  it('mudar a quantidade recalcula', () => {
    const p = patchDoItemEditado(NORMAL, formDe(NORMAL, { quantidade: '10' }))
    expect(p.quantidade).toBe(10)
    expect(p.valor_total).toBe(8800)
  })

  it('mudar o unitário recalcula', () => {
    const p = patchDoItemEditado(NORMAL, formDe(NORMAL, { valor_unitario: '900' }))
    expect(p.valor_total).toBe(4500)
  })

  it('preencher a quantidade de uma linha zerada recalcula — é o conserto do dono', () => {
    // O jeito legítimo de arrumar as linhas de cana: digitar a quantidade real.
    const p = patchDoItemEditado(CANA, formDe(CANA, { quantidade: '1000000', valor_unitario: '0.12' }))
    expect(p.valor_total).toBeCloseTo(120000, 6)
  })

  it('digitar e DESFAZER volta a "não mexeu" — comparação derivada, não flag', () => {
    // Flag pegajosa com reset à mão já custou um achado [alto] em
    // nfe/regras-conferencia.ts nesta mesma semana.
    const p = patchDoItemEditado(CONTRATO, formDe(CONTRATO, { quantidade: '60' }))
    expect(p.valor_total).toBe(100000)
  })

  it('reformatação não conta como edição ("480" vs "480.00")', () => {
    const p = patchDoItemEditado(CONTRATO, formDe(CONTRATO, { valor_unitario: '480.00' }))
    expect(p.valor_total).toBe(100000)
  })
})

describe('patchDoItemEditado — campo vazio preserva, nunca vira 1', () => {
  it('quantidade apagada mantém a original, e o total intacto', () => {
    // A versão anterior fazia `parseFloat(form.quantidade) || 1`: campo vazio
    // — e o próprio zero legítimo — viravam 1, calados.
    const p = patchDoItemEditado(CANA, formDe(CANA, { quantidade: '' }))
    expect(p.quantidade).toBe(0)
    expect(p.valor_total).toBe(119938.34)
  })

  it('unitário apagado mantém o original', () => {
    const p = patchDoItemEditado(NORMAL, formDe(NORMAL, { valor_unitario: '  ' }))
    expect(p.valor_unitario).toBe(880)
    expect(p.valor_total).toBe(4400)
  })

  it('texto ilegível não vira número nenhum', () => {
    const p = patchDoItemEditado(NORMAL, formDe(NORMAL, { quantidade: 'abc' }))
    expect(p.quantidade).toBe(5)
    expect(p.valor_total).toBe(4400)
  })

  it('zero DIGITADO de propósito continua sendo zero, e aí recalcula', () => {
    // Distinguir "apagou o campo" de "escreveu 0" importa: o segundo é intenção.
    const p = patchDoItemEditado(NORMAL, formDe(NORMAL, { valor_unitario: '0' }))
    expect(p.valor_unitario).toBe(0)
    expect(p.valor_total).toBe(0)
  })
})

describe('previaDoTotal — a tela precisa mostrar o que vai gravar', () => {
  it('sem mexer na conta: não muda, e a tela não precisa alarmar', () => {
    const p = previaDoTotal(CANA, formDe(CANA, { centro_custo: 'insumo' }))
    expect(p).toEqual({ totalAtual: 119938.34, totalNovo: 119938.34, vaiMudar: false })
  })

  it('mexendo na conta: mostra o de antes e o de depois', () => {
    const p = previaDoTotal(NORMAL, formDe(NORMAL, { quantidade: '10' }))
    expect(p).toEqual({ totalAtual: 4400, totalNovo: 8800, vaiMudar: true })
  })

  it('o caso que o diálogo escondia: R$ 119 mil indo a zero fica VISÍVEL', () => {
    const p = previaDoTotal(CANA, formDe(CANA, { quantidade: '1' }))
    expect(p.totalAtual).toBe(119938.34)
    expect(p.totalNovo).toBe(0)
    expect(p.vaiMudar).toBe(true)
  })
})

describe('o parser é parseFloat DE PROPÓSITO — medido, não copiado', () => {
  // O Apolo pediu `parseNumeroBR` aqui (achado [alto], 28/08/2026), pelo
  // precedente de `salvar-talhao.ts`. Eu segui, o teste quebrou, e a medição no
  // banco mostrou que seguir era pior: 5 linhas REAIS seriam lidas 1000× maiores,
  // porque `parseNumeroBR` trata `NNN.NNN` como agrupamento de milhar — certo
  // para texto digitado, errado para `<input type="number">`, cujo `value` é
  // sempre en-US e que nasce preenchido com `String(numero)`.
  const REAIS: Array<[string, number]> = [
    ['117.505', 117.505],   // ESPALHANTE TRIOMAX 5L
    ['335.999', 335.999],   // HERBICIDA DONTOR 20L
    ['0.082',     0.082],   // CANA DE ACUCAR
    ['303.131', 303.131],   // FILTRO DE AR
    ['578.431', 578.431],   // KIT FILTRO COMBUSTIVEL
  ]

  it('valores reais do banco são lidos como decimais, não como milhar', () => {
    for (const [texto, esperado] of REAIS) {
      const p = patchDoItemEditado(NORMAL, formDe(NORMAL, { valor_unitario: texto }))
      expect(p.valor_unitario).toBe(esperado)
    }
  })

  it('a linha de cana NÃO vira R$ 88 milhões', () => {
    // q = 1.084.374 e vu = 0,082. Lendo o unitário como 82, o total explodiria.
    const cana: ItemOriginal = { quantidade: 1084374, valor_unitario: 0.082, valor_total: 88939.27, nota_fiscal_id: 'nf' }
    const p = patchDoItemEditado(cana, formDe(cana, { centro_custo: 'insumo' }))
    expect(p.valor_unitario).toBe(0.082)
    expect(p.valor_total).toBe(88939.27)
  })
})

describe('a tolerância do mudou() é regra, não enfeite', () => {
  // Sem estes dois, alargar a tolerância para 0,01 passava despercebido — e aí
  // trocar o unitário de 480,00 para 480,005 gravaria o unitário novo mantendo
  // o total velho, criando a inconsistência que este arquivo combate.
  it('diferença abaixo do epsilon NÃO recalcula', () => {
    const p = patchDoItemEditado(CONTRATO, formDe(CONTRATO, { valor_unitario: '480.0000000001' }))
    expect(p.valor_total).toBe(100000)
  })

  it('diferença de um milésimo JÁ recalcula', () => {
    const p = patchDoItemEditado(CONTRATO, formDe(CONTRATO, { valor_unitario: '480.001' }))
    expect(p.valor_total).toBeCloseTo(60 * 480.001, 6)
  })
})

describe('dataEhEditavel — o campo Data mentia em item de nota fiscal', () => {
  // A tela monta `notas_fiscais.data_emissao ?? data_manual`: com nota, a data
  // da NOTA vence e `data_manual` é campo morto. O dono corrigia, via "salvo",
  // e a lista voltava com a data velha.
  it('item de nota fiscal: não é editável, e o patch não leva data_manual', () => {
    expect(dataEhEditavel(NORMAL)).toBe(false)
    expect(patchDoItemEditado(NORMAL, formDe(NORMAL, { data: '2026-01-01' })).data_manual).toBeUndefined()
  })

  it('item sem nota (Controle/avulso): é editável, e o patch leva a data', () => {
    expect(dataEhEditavel(CONTRATO)).toBe(true)
    expect(patchDoItemEditado(CONTRATO, formDe(CONTRATO, { data: '2026-01-01' })).data_manual).toBe('2026-01-01')
  })

  it('data vazia não grava string vazia por cima', () => {
    expect(patchDoItemEditado(CONTRATO, formDe(CONTRATO, { data: '' })).data_manual).toBeUndefined()
  })
})

describe('unidade entra sem espaço sobrando', () => {
  it('" KG " vira "KG"', () => {
    expect(patchDoItemEditado(NORMAL, formDe(NORMAL, { unidade: ' KG ' })).unidade).toBe('KG')
  })
})
