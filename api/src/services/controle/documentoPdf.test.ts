import { describe, it, expect } from 'vitest'
import { validarDocumentoLido } from './documentoPdf'

// A leitura em si (a chamada de IA) não dá para testar de mesa. O que dá — e
// o que decide se um documento vira gasto de verdade ou é recusado — é a
// validação do que voltou. Mesmo espírito de boletoPdf.test.ts.

const HOJE = '2026-08-17'

function item(over: Record<string, unknown> = {}) {
  return {
    descricao: 'ADUBO NPK 04-14-08',
    quantidade: 10,
    unidade: 'SC',
    valor_unitario: 150.5,
    valor_total: 1505,
    numero_documento: '57106',
    data: '2026-07-10',
    ...over,
  }
}

function bruto(over: Record<string, unknown> = {}) {
  return {
    ehDocumentoValido: true,
    fornecedor: 'SOLOS SOLUCOES AGRICOLAS',
    dataDocumento: '2026-07-01',
    codigoCliente: '000786',
    valorTotalDocumento: 1505,
    itens: [item()],
    ...over,
  }
}

// Atalho: a maioria dos testes só se importa com o caminho de sucesso —
// evita repetir `if (r.status !== 'documento') throw ...` em todo teste.
function documento(bruto: any, hoje = HOJE) {
  const r = validarDocumentoLido(bruto, hoje)
  if (r.status !== 'documento') throw new Error(`esperava status 'documento', veio '${r.status}'`)
  return r.documento
}

describe('validarDocumentoLido — aceita documento bom', () => {
  it('extrato com vários itens passa e devolve os campos limpos', () => {
    const d = documento(
      bruto({ itens: [item(), item({ descricao: 'HERBICIDA X', numero_documento: '57107' })] }),
    )
    expect(d.fornecedor).toBe('SOLOS SOLUCOES AGRICOLAS')
    expect(d.dataDocumento).toBe('2026-07-01')
    expect(d.numeroDocumento).toBe('000786-2026-07-01')
    expect(d.valorTotalDocumento).toBe(1505)
    expect(d.itens).toHaveLength(2)
    expect(d.itensDescartados).toBe(0)
    // dois itens de 1505 somam 3010 contra um total de documento de 1505 —
    // divergência positiva, exatamente a soma do segundo item.
    expect(d.divergenciaTotal).toBe(1505)
    expect(d.itens[0]).toEqual({
      descricao: 'ADUBO NPK 04-14-08',
      quantidade: 10,
      unidade: 'SC',
      valorUnitario: 150.5,
      valorTotal: 1505,
      numeroDocumento: '57106',
      data: '2026-07-10',
    })
  })

  it('divergenciaTotal fecha em zero quando a soma dos itens bate com o total do documento', () => {
    const d = documento(bruto())
    expect(d.divergenciaTotal).toBe(0)
  })
})

describe('validarDocumentoLido — recusa em vez de adivinhar', () => {
  it('ehDocumentoValido false: boleto avulso, NF-e, documento sem produto', () => {
    expect(validarDocumentoLido(bruto({ ehDocumentoValido: false }), HOJE)).toEqual({ status: 'nao-documento' })
  })

  it("ehDocumentoValido vindo como string 'false' não vira válido", () => {
    expect(validarDocumentoLido(bruto({ ehDocumentoValido: 'false' }), HOJE)).toEqual({ status: 'nao-documento' })
    expect(validarDocumentoLido(bruto({ ehDocumentoValido: 'true' }), HOJE)).toEqual({ status: 'nao-documento' })
  })

  it('resposta vazia ou quebrada não vira documento', () => {
    expect(validarDocumentoLido(null, HOJE)).toEqual({ status: 'nao-documento' })
    expect(validarDocumentoLido({}, HOJE)).toEqual({ status: 'nao-documento' })
  })
})

describe('validarDocumentoLido — documento sem nenhum item aproveitável não pode ser sucesso, mas é status diferente de "não é documento"', () => {
  it('itens ausente, null ou não-array: sem itens aproveitáveis, 0 descartados', () => {
    expect(validarDocumentoLido(bruto({ itens: undefined }), HOJE)).toEqual({ status: 'sem-itens-aproveitaveis', itensDescartados: 0 })
    expect(validarDocumentoLido(bruto({ itens: null }), HOJE)).toEqual({ status: 'sem-itens-aproveitaveis', itensDescartados: 0 })
    expect(validarDocumentoLido(bruto({ itens: 'nao é array' }), HOJE)).toEqual({ status: 'sem-itens-aproveitaveis', itensDescartados: 0 })
  })

  it('itens vazio: sem itens aproveitáveis, 0 descartados', () => {
    expect(validarDocumentoLido(bruto({ itens: [] }), HOJE)).toEqual({ status: 'sem-itens-aproveitaveis', itensDescartados: 0 })
  })

  it('todos os itens descartados na validação: status sem-itens-aproveitaveis com a contagem certa', () => {
    const r = validarDocumentoLido(
      bruto({ itens: [item({ descricao: null }), item({ valor_unitario: null, valor_total: null })] }),
      HOJE,
    )
    expect(r).toEqual({ status: 'sem-itens-aproveitaveis', itensDescartados: 2 })
  })
})

describe('validarDocumentoLido — descarte item a item, sem derrubar os outros', () => {
  it('item sem descrição é descartado, os outros sobrevivem', () => {
    const d = documento(bruto({ itens: [item({ descricao: null }), item({ numero_documento: '57108' })] }))
    expect(d.itens).toHaveLength(1)
    expect(d.itensDescartados).toBe(1)
    expect(d.itens[0].numeroDocumento).toBe('57108')
  })

  it('item vazio/whitespace na descrição também é descartado, o outro sobrevive', () => {
    const d = documento(bruto({ itens: [item({ descricao: '   ' }), item({ numero_documento: '57108' })] }))
    expect(d.itens).toHaveLength(1)
    expect(d.itensDescartados).toBe(1)
    expect(d.itens[0].numeroDocumento).toBe('57108')
  })

  it('quantidade ausente, zero, negativa, não numérica ou absurda NÃO descarta mais o item — vira null, o valor sobrevive', () => {
    for (const quantidade of [null, 0, -5, 'dez', undefined, 2_000_000_000]) {
      const d = documento(bruto({ itens: [item({ quantidade })] }))
      expect(d.itens).toHaveLength(1)
      expect(d.itensDescartados).toBe(0)
      expect(d.itens[0].quantidade).toBeNull()
      // O valor_total informado no item() default sobrevive mesmo sem
      // quantidade — é exatamente o que o achado crítico do Apolo corrigiu.
      expect(d.itens[0].valorTotal).toBe(1505)
    }
  })

  it('quantidade é arredondada para 3 casas antes de comparar com o teto', () => {
    const d = documento(bruto({ itens: [item({ quantidade: 3.00049 })] }))
    expect(d.itens[0].quantidade).toBe(3)
  })

  it('item só com valor_total (sem unitário) é aceito', () => {
    const d = documento(bruto({ itens: [item({ valor_unitario: null, valor_total: 800 })] }))
    expect(d.itens).toHaveLength(1)
    expect(d.itens[0].valorUnitario).toBeNull()
    expect(d.itens[0].valorTotal).toBe(800)
  })

  it('item só com valor_unitario (sem total) é aceito e calcula o total', () => {
    const d = documento(bruto({ itens: [item({ quantidade: 4, valor_unitario: 100, valor_total: null })] }))
    expect(d.itens).toHaveLength(1)
    expect(d.itens[0].valorTotal).toBe(400)
  })

  it('item sem valor_unitario NEM valor_total é descartado, o outro sobrevive', () => {
    const d = documento(
      bruto({ itens: [item({ valor_unitario: null, valor_total: null }), item({ numero_documento: '57108' })] }),
    )
    expect(d.itens).toHaveLength(1)
    expect(d.itensDescartados).toBe(1)
    expect(d.itens[0].numeroDocumento).toBe('57108')
  })

  it('item com valorTotal negativo ou zero é descartado, os outros sobrevivem', () => {
    const d = documento(
      bruto({
        itens: [
          item({ valor_total: -100, numero_documento: '1' }),
          item({ valor_total: 0, numero_documento: '2' }),
          item({ numero_documento: '3' }),
        ],
      }),
    )
    expect(d.itens).toHaveLength(1)
    expect(d.itensDescartados).toBe(2)
    expect(d.itens[0].numeroDocumento).toBe('3')
  })

  it('valorUnitario negativo usado como base do cálculo gera valorTotal negativo e é descartado', () => {
    const d = documento(
      bruto({
        itens: [
          item({ valor_unitario: -10, valor_total: null, quantidade: 5, numero_documento: '1' }),
          item({ numero_documento: '2' }),
        ],
      }),
    )
    expect(d.itens).toHaveLength(1)
    expect(d.itensDescartados).toBe(1)
    expect(d.itens[0].numeroDocumento).toBe('2')
  })

  it('valorUnitario negativo/zero junto de um valorTotal já informado não descarta a linha — só zera o valorUnitario', () => {
    const d = documento(bruto({ itens: [item({ valor_unitario: -10, valor_total: 1505 })] }))
    expect(d.itens).toHaveLength(1)
    expect(d.itensDescartados).toBe(0)
    expect(d.itens[0].valorUnitario).toBeNull()
    expect(d.itens[0].valorTotal).toBe(1505)
  })

  it('valorUnitario zero junto de um valorTotal já informado também vira null, sem descartar', () => {
    const d = documento(bruto({ itens: [item({ valor_unitario: 0, valor_total: 1505 })] }))
    expect(d.itens[0].valorUnitario).toBeNull()
    expect(d.itens[0].valorTotal).toBe(1505)
  })

  it('valor acima do teto de sanidade é descartado, o outro sobrevive — coluna é NUMERIC(12,2)', () => {
    const d = documento(
      bruto({ itens: [item({ valor_total: 3_000_000, numero_documento: '1' }), item({ numero_documento: '2' })] }),
    )
    expect(d.itens).toHaveLength(1)
    expect(d.itensDescartados).toBe(1)
    expect(d.itens[0].numeroDocumento).toBe('2')
  })

  it('valorUnitario acima do teto de sanidade é descartado, o outro sobrevive — coluna é NUMERIC(12,4)', () => {
    const d = documento(
      bruto({
        itens: [
          item({ valor_unitario: 90_000_000, valor_total: null, numero_documento: '1' }),
          item({ numero_documento: '2' }),
        ],
      }),
    )
    expect(d.itens).toHaveLength(1)
    expect(d.itensDescartados).toBe(1)
    expect(d.itens[0].numeroDocumento).toBe('2')
  })

  it('unidade ausente vira UN, não derruba o item', () => {
    const d = documento(bruto({ itens: [item({ unidade: null })] }))
    expect(d.itens[0].unidade).toBe('UN')
  })
})

describe('validarDocumentoLido — datas nunca viram "hoje" por default', () => {
  it('item sem data própria herda a data do documento', () => {
    const d = documento(bruto({ itens: [item({ data: null })] }))
    expect(d.itens[0].data).toBe('2026-07-01')
  })

  it('item sem data e documento também sem data: fica null, nunca vira hoje', () => {
    const d = documento(bruto({ dataDocumento: null, itens: [item({ data: null })] }))
    expect(d.itens[0].data).toBeNull()
    expect(d.itens[0].data).not.toBe(HOJE)
  })

  it('dataDocumento inexistente (31/02) é tratada como ilegível — cai como null', () => {
    const d = documento(bruto({ dataDocumento: '2026-02-31', itens: [item({ data: null })] }))
    expect(d.dataDocumento).toBeNull()
    expect(d.itens[0].data).toBeNull()
  })

  it('data do item com mês inválido (13) cai para a data do documento, não passa direto', () => {
    const d = documento(bruto({ itens: [item({ data: '2026-13-01' })] }))
    expect(d.itens[0].data).toBe('2026-07-01')
  })

  it('data do item inexistente (31/02) cai para a data do documento, não passa direto', () => {
    const d = documento(bruto({ itens: [item({ data: '2026-02-31' })] }))
    expect(d.itens[0].data).toBe('2026-07-01')
  })
})

describe('validarDocumentoLido — janela de sanidade de data (bem mais larga que o boleto)', () => {
  it('dataDocumento 100 anos no futuro (2126) vira null — item herda null', () => {
    const d = documento(bruto({ dataDocumento: '2126-07-10', itens: [item({ data: null })] }))
    expect(d.dataDocumento).toBeNull()
    expect(d.itens[0].data).toBeNull()
  })

  it('dataDocumento 100 anos no passado (1926) vira null', () => {
    const d = documento(bruto({ dataDocumento: '1926-07-10', itens: [item({ data: null })] }))
    expect(d.dataDocumento).toBeNull()
  })

  it('data do item fora da janela (2126) vira null e cai para a data do documento', () => {
    const d = documento(bruto({ itens: [item({ data: '2126-07-10' })] }))
    expect(d.itens[0].data).toBe('2026-07-01')
  })

  it('data dentro da janela larga (mais de 6 meses atrás, coisa que o boleto recusaria) passa normal', () => {
    // A janela do documento é 5 anos pra trás — bem diferente dos 180 dias
    // do boleto. Um extrato de "Contas a Receber" cobre vários meses.
    const d = documento(bruto({ itens: [item({ data: '2025-01-15' })] }))
    expect(d.itens[0].data).toBe('2025-01-15')
  })
})

describe('validarDocumentoLido — valorTotalDocumento: teto, sinal e divergência', () => {
  it('valorTotalDocumento acima do teto vira null, mas o documento continua válido', () => {
    const d = documento(bruto({ valorTotalDocumento: 6_000_000 }))
    expect(d.valorTotalDocumento).toBeNull()
    expect(d.itens).toHaveLength(1)
  })

  it('valorTotalDocumento negativo vira null, mas o documento continua válido', () => {
    const d = documento(bruto({ valorTotalDocumento: -999_999_999_999 }))
    expect(d.valorTotalDocumento).toBeNull()
    expect(d.itens).toHaveLength(1)
  })

  it('valorTotalDocumento zero vira null, mas o documento continua válido', () => {
    const d = documento(bruto({ valorTotalDocumento: 0 }))
    expect(d.valorTotalDocumento).toBeNull()
  })

  it('valorTotalDocumento é arredondado para 2 casas antes de aplicar o teto', () => {
    const d = documento(bruto({ valorTotalDocumento: 1504.999 }))
    expect(d.valorTotalDocumento).toBe(1505)
  })

  it('divergenciaTotal é null quando valorTotalDocumento é null', () => {
    const d = documento(bruto({ valorTotalDocumento: null }))
    expect(d.valorTotalDocumento).toBeNull()
    expect(d.divergenciaTotal).toBeNull()
  })
})

describe('validarDocumentoLido — numeroDocumento montado em código a partir de codigoCliente + dataDocumento', () => {
  it('codigoCliente e dataDocumento presentes: numeroDocumento é montado deterministicamente', () => {
    const d = documento(bruto({ codigoCliente: '000786', dataDocumento: '2026-07-29' }))
    expect(d.numeroDocumento).toBe('000786-2026-07-29')
  })

  it('duas leituras do MESMO extrato (mesmo codigoCliente, mesma dataDocumento) produzem a MESMA chave — mesmo com fornecedor/valor grafados diferente', () => {
    const a = documento(bruto({ codigoCliente: '000786', dataDocumento: '2026-07-29', fornecedor: 'Solos Soluções' }))
    const b = documento(bruto({ codigoCliente: '000786', dataDocumento: '2026-07-29', fornecedor: 'SOLOS SOLUCOES LTDA' }))
    expect(a.numeroDocumento).toBe(b.numeroDocumento)
  })

  it('codigoCliente ausente: numeroDocumento fica null mesmo com dataDocumento presente — não monta chave parcial', () => {
    const d = documento(bruto({ codigoCliente: null }))
    expect(d.numeroDocumento).toBeNull()
  })

  it('dataDocumento ausente/inválida: numeroDocumento fica null mesmo com codigoCliente presente — não monta chave parcial', () => {
    const d = documento(bruto({ dataDocumento: null }))
    expect(d.numeroDocumento).toBeNull()
  })
})

// Achado C da revisão do Apolo, rodada 3: `codigoCliente` (a metade CRUA de
// `numeroDocumento`, sem a data de geração do relatório/contrato embutida)
// precisa ser devolvido junto no objeto — `gravarDocumentoPdf.ts` usa ele
// (não `numeroDocumento`) como fallback ESTÁVEL para item sem número de
// duplicata próprio, porque `numeroDocumento` muda a cada reimportação.
describe('validarDocumentoLido — codigoCliente é devolvido separado de numeroDocumento (Achado C)', () => {
  it('codigoCliente sozinho (sem a data) fica exposto no documento', () => {
    const d = documento(bruto({ codigoCliente: '288658', dataDocumento: '2026-07-01' }))
    expect(d.codigoCliente).toBe('288658')
    expect(d.numeroDocumento).toBe('288658-2026-07-01')
  })

  it('mesmo codigoCliente, dataDocumento diferente entre duas leituras: numeroDocumento muda, codigoCliente não', () => {
    const a = documento(bruto({ codigoCliente: '288658', dataDocumento: '2026-07-01' }))
    const b = documento(bruto({ codigoCliente: '288658', dataDocumento: '2026-08-01' }))
    expect(a.numeroDocumento).not.toBe(b.numeroDocumento)
    expect(a.codigoCliente).toBe(b.codigoCliente)
  })

  it('codigoCliente ausente/ilegível: fica null, igual numeroDocumento', () => {
    const d = documento(bruto({ codigoCliente: null }))
    expect(d.codigoCliente).toBeNull()
    expect(d.numeroDocumento).toBeNull()
  })
})

describe('validarDocumentoLido — arredondamento do total calculado', () => {
  it('3 × 33.333 (fração de ponto flutuante) fecha em 100.00, não só o caso redondo', () => {
    const d = documento(bruto({ itens: [item({ quantidade: 3, valor_unitario: 33.333, valor_total: null })] }))
    expect(d.itens[0].valorTotal).toBe(100)
  })
})

describe('validarDocumentoLido — limite de itens', () => {
  it('mais de MAX_ITENS (300) trunca sem quebrar, contando o excedente como descartado', () => {
    const muitos = Array.from({ length: 305 }, (_, i) => item({ numero_documento: String(i) }))
    const d = documento(bruto({ itens: muitos }))
    expect(d.itens).toHaveLength(300)
    expect(d.itensDescartados).toBe(5)
  })
})

describe('validarDocumentoLido — pagamentos do contrato', () => {
  const contrato = (pagamentos: unknown) => ({
    ...bruto(),
    tipoDocumento: 'contrato',
    pagamentos,
  })

  it('lê data e valor do Quadro Resumo', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2026-08-28', valor: 647986.35 }]),
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-08-28', valor: 647986.35 }])
  })

  it('pagamento sem valor entra com valor null (quem monta a conta resolve)', () => {
    const r = validarDocumentoLido(contrato([{ data: '2026-08-28' }]), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-08-28', valor: null }])
  })

  // Nunca corrige data — descarta. Um '2126-08-28' é dígito mal lido, e
  // adivinhar o século criaria uma dívida numa data inventada.
  it('data fora da janela de sanidade é descartada, documento sobrevive', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2126-08-28', valor: 100 }, { data: '2026-09-10', valor: 200 }]),
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-09-10', valor: 200 }])
    expect(r.documento.itens).toHaveLength(1)   // o documento NÃO foi derrubado
  })

  // Important 1 da revisão final (23/08/2026): descartar em silêncio era o
  // começo do bug caro. Quem monta a conta PRECISA saber que uma parcela se
  // perdeu, senão a sobrevivente herda o total do contrato inteiro e vira
  // uma dívida de R$ 647.986,35 marcada como valor CONFIRMADO.
  it('pagamento descartado é CONTADO — a perda não pode ser silenciosa', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2126-08-28', valor: null }, { data: '2026-09-10', valor: null }]),
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toHaveLength(1)
    expect(r.documento.pagamentosDescartados).toBe(1)
  })

  it('nenhum pagamento descartado: contador fica em 0', () => {
    const r = validarDocumentoLido(contrato([{ data: '2026-08-28', valor: 100 }]), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentosDescartados).toBe(0)
  })

  // Important 2 da revisão final: sem deduplicar, a 2ª conta batia no índice
  // único (fazenda_id, documento_controle_id, vencimento) da migration 012 e
  // virava "duplicada" — o dono via "1 conta criada" com METADE da dívida e
  // nada explicando. Mesma data = mesma parcela lida duas vezes.
  it('duas datas de pagamento IGUAIS viram uma só parcela', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2026-08-28', valor: 323993.18 }, { data: '2026-08-28', valor: 323993.18 }]),
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-08-28', valor: 323993.18 }])
  })

  // Repetição não é perda: a parcela continua lá, só foi lida duas vezes.
  // Contar como descartada faria a regra do valor (Important 1) travar sem
  // motivo e a conta nasceria sem valor à toa.
  it('data repetida NÃO conta como pagamento descartado', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2026-08-28', valor: 100 }, { data: '2026-08-28', valor: 100 }]),
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentosDescartados).toBe(0)
  })

  it('data repetida: a primeira sem valor adota o valor da repetida', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2026-08-28', valor: null }, { data: '2026-08-28', valor: 500 }]),
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-08-28', valor: 500 }])
  })

  // Minor da revisão final: MAX_PAGAMENTOS limitava os ACEITOS, não as
  // iterações — uma resposta com 5.000 entradas era percorrida inteira. E o
  // excedente cortado é perda de parcela como qualquer outra: entra no
  // contador, senão a sobrevivente herdaria o total do contrato.
  it('acima de MAX_PAGAMENTOS (24): corta a ENTRADA e conta o excedente como descartado', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({
      data: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      valor: 10,
    }))
    const r = validarDocumentoLido(contrato(muitos), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toHaveLength(24)
    expect(r.documento.pagamentosDescartados).toBe(6)
  })

  it('extrato nunca tem pagamento descartado (nem pagamento)', () => {
    const r = validarDocumentoLido(
      { ...bruto(), tipoDocumento: 'extrato', pagamentos: [{ data: '2126-08-28', valor: 500 }] },
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([])
    expect(r.documento.pagamentosDescartados).toBe(0)
  })

  it('valor de pagamento acima do teto do documento vira null, mantém a data', () => {
    const r = validarDocumentoLido(
      contrato([{ data: '2026-08-28', valor: 99_000_000 }]),
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([{ data: '2026-08-28', valor: null }])
  })

  it.each([
    ['ausente',   undefined],
    ['nulo',      null],
    ['não-array', { data: '2026-08-28' }],
    ['vazio',     []],
  ])('pagamentos %s vira lista vazia', (_nome, valor) => {
    const r = validarDocumentoLido(contrato(valor), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([])
  })

  // Extrato tem DUPLICATA, não contrato de pagamento. Cada duplicata já vira
  // ITEM, e o boleto dela chega por e-mail pelo Make. Criar conta a pagar
  // aqui duplicaria o que o boleto já faz.
  it('extrato ignora pagamentos mesmo se a IA devolver', () => {
    const r = validarDocumentoLido(
      { ...bruto(), tipoDocumento: 'extrato', pagamentos: [{ data: '2026-08-28', valor: 500 }] },
      HOJE,
    )
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.pagamentos).toEqual([])
  })
})

describe('validarDocumentoLido — tipo do documento', () => {
  it('contrato explícito vira tipoDocumento "contrato"', () => {
    const r = validarDocumentoLido(bruto({ tipoDocumento: 'contrato' }), HOJE)
    expect(r.status).toBe('documento')
    if (r.status !== 'documento') return
    expect(r.documento.tipoDocumento).toBe('contrato')
  })

  it('extrato explícito vira tipoDocumento "extrato"', () => {
    const r = validarDocumentoLido(bruto({ tipoDocumento: 'extrato' }), HOJE)
    expect(r.status).toBe('documento')
    if (r.status !== 'documento') return
    expect(r.documento.tipoDocumento).toBe('extrato')
  })

  // A TRAVA MAIS IMPORTANTE DESTE ARQUIVO. Errar para "contrato" dobra
  // dinheiro em silêncio; errar para "extrato" só deixa um valor sem somar,
  // e o dono corrige na tela. Todo valor que não seja exatamente 'contrato'
  // cai no lado barato.
  it.each([
    ['ausente',    undefined],
    ['nulo',       null],
    ['vazio',      ''],
    ['desconhecido', 'nota'],
    ['número',     42],
    ['maiúsculo com espaço', ' CONTRATO '],
  ])('tipoDocumento %s cai em "extrato"', (_nome, valor) => {
    const r = validarDocumentoLido(bruto({ tipoDocumento: valor }), HOJE)
    expect(r.status).toBe('documento')
    if (r.status !== 'documento') return
    expect(r.documento.tipoDocumento).toBe('extrato')
  })
})

// Important 4 da revisão final (23/08/2026): a trava dos R$ 2,77 milhões
// tinha virado JULGAMENTO DA IA — o prompt descrevia os dois formatos, mas
// nada em CÓDIGO conferia a resposta. Uma classificação errada para
// 'contrato' liga `conta_como_compra: true` num extrato cuja NF-e o Make
// ainda vai derrubar, e o Financeiro passa a somar o mesmo dinheiro duas
// vezes, calado.
//
// O cinto de segurança é determinístico e só aperta para UM LADO: pode
// forçar 'extrato', NUNCA 'contrato'. A forma dos dois documentos é
// diferente de verdade — extrato lista muitas duplicatas, cada uma com o
// seu próprio número; contrato tem poucas linhas de mercadoria e nenhuma
// numeração por linha (o número que existe é o do contrato inteiro).
describe('validarDocumentoLido — cinto determinístico do tipo (Important 4)', () => {
  const numerado = (i: number) => item({ numero_documento: `5710${i}`, descricao: `PRODUTO ${i}` })

  it('IA disse "contrato" mas o documento tem cara de extrato: força "extrato"', () => {
    const r = validarDocumentoLido(bruto({
      tipoDocumento: 'contrato',
      itens: [numerado(1), numerado(2), numerado(3), numerado(4), numerado(5), numerado(6)],
      pagamentos: [{ data: '2026-08-28', valor: 500 }],
    }), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.tipoDocumento).toBe('extrato')
    // Rebaixado a extrato, os pagamentos morrem junto — extrato nunca gera
    // conta a pagar (o boleto dele chega por e-mail).
    expect(r.documento.pagamentos).toEqual([])
  })

  it('contrato de verdade (poucas linhas, sem numeração própria) continua "contrato"', () => {
    const r = validarDocumentoLido(bruto({
      tipoDocumento: 'contrato',
      itens: [item({ numero_documento: null }), item({ numero_documento: null, descricao: 'MAP' })],
      pagamentos: [{ data: '2026-08-28', valor: 500 }],
    }), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.tipoDocumento).toBe('contrato')
    expect(r.documento.pagamentos).toHaveLength(1)
  })

  it('muitas linhas SEM numeração própria não bastam para rebaixar', () => {
    const r = validarDocumentoLido(bruto({
      tipoDocumento: 'contrato',
      itens: Array.from({ length: 8 }, (_, i) => item({ numero_documento: null, descricao: `LINHA ${i}` })),
    }), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.tipoDocumento).toBe('contrato')
  })

  it('poucas linhas, todas numeradas, não bastam para rebaixar', () => {
    const r = validarDocumentoLido(bruto({
      tipoDocumento: 'contrato',
      itens: [numerado(1), numerado(2), numerado(3), numerado(4)],
    }), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.tipoDocumento).toBe('contrato')
  })

  // A TRAVA SUPREMA: o cinto só aperta num sentido. Nenhuma combinação de
  // itens pode PROMOVER um extrato a contrato — promover é o lado que
  // dobra dinheiro.
  it('extrato com poucas linhas sem numeração continua "extrato" — o cinto nunca PROMOVE', () => {
    const r = validarDocumentoLido(bruto({
      tipoDocumento: 'extrato',
      itens: [item({ numero_documento: null })],
    }), HOJE)
    if (r.status !== 'documento') throw new Error('esperava documento')
    expect(r.documento.tipoDocumento).toBe('extrato')
  })
})
