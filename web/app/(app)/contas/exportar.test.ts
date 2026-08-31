import { describe, it, expect } from 'vitest'
import {
  colunasExport, linhasDeTotal, montarRodape, descricaoDoFiltro,
  indiceDaColunaValor, nomeArquivoExport, pareceTruncado, HEADER_VALOR,
  type ContextoNome,
} from './exportar'
import type { ContaAPI } from './tipos'
import type { ColunaXlsx } from '@/lib/xlsx'

function conta(over: Partial<ContaAPI> = {}): ContaAPI {
  return {
    id: 'c1',
    descricao: 'Energia elétrica — sede',
    fornecedor: 'CEMIG',
    categoria: 'energia',
    vencimento: '2026-08-10',
    valor: 1234.56,
    valor_estimado: false,
    status: 'paga',
    data_pagamento: '2026-08-08',
    valor_pago: 1234.56,
    observacao: null,
    nota_fiscal_id: null,
    lancamento_id: 'l1',
    numero_parcela: null,
    total_parcelas: null,
    created_at: '2026-08-01T10:00:00Z',
    contas_recorrentes: { avisar_dias_antes: 3, periodicidade: 'mensal' },
    notas_fiscais: null,
    ...over,
  }
}

function celulas(c: ContaAPI) {
  return colunasExport().map(col => col.valor(c))
}

function celula(c: ContaAPI, header: string) {
  const colunas = colunasExport()
  const i = colunas.findIndex(col => col.header === header)
  expect(i).toBeGreaterThanOrEqual(0)
  return colunas[i].valor(c)
}

const IDX_VALOR = indiceDaColunaValor(colunasExport())

const CTX: ContextoNome = {
  filtroStatus: 'todas', filtroTipo: 'todos', filtroMes: '2026-08',
  fazenda: 'MG', geradoEm: '2026-08-31', parcial: false,
}

describe('colunasExport', () => {
  it('leva as colunas da tela mais os dados de pagamento', () => {
    expect(colunasExport().map(c => c.header)).toEqual([
      'Vencimento', 'Fornecedor', 'Descrição', 'Categoria', 'Status',
      'Valor (R$)', 'Estimado', 'Data do pagamento', 'Nº da nota', 'Tipo',
      'Parcela', 'Observação',
    ])
  })

  // Com R$ dentro da célula o Excel trata como TEXTO e não soma a coluna —
  // que é justamente o que quem recebe o relatório vai querer fazer.
  it('manda valor como número, não como texto com R$', () => {
    const v = celula(conta(), HEADER_VALOR)
    expect(typeof v).toBe('number')
    expect(v).toBe(1234.56)
  })

  // 'YYYY-MM-DD' virando Date à meia-noite UTC jogaria o dia 1º pro último dia
  // do mês anterior no Brasil (UTC-3) — bug de fuso que este projeto já teve.
  it('manda data como Date no dia certo, sem escorregar de fuso', () => {
    const d = celula(conta({ vencimento: '2026-08-01' }), 'Vencimento') as Date
    expect(d).toBeInstanceOf(Date)
    expect(d.getDate()).toBe(1)
    expect(d.getMonth()).toBe(7)
    expect(d.getFullYear()).toBe(2026)
  })

  it('deixa a célula VAZIA quando não há vencimento nem pagamento', () => {
    const c = conta({ vencimento: null, data_pagamento: null, valor: null })
    expect(celula(c, 'Vencimento')).toBeNull()
    expect(celula(c, 'Data do pagamento')).toBeNull()
    expect(celula(c, HEADER_VALOR)).toBeNull()
  })

  // Achado 1 do Apolo: sem esta coluna, uma conta fixa de R$ 380.000 chutada
  // a partir do último pagamento sai no arquivo tão dura quanto um boleto.
  it('marca a conta estimada e deixa a confirmada em branco', () => {
    expect(celula(conta({ valor_estimado: true }), 'Estimado')).toBe('SIM')
    expect(celula(conta({ valor_estimado: false }), 'Estimado')).toBeNull()
  })

  it('traduz a categoria igual à tela', () => {
    expect(celula(conta({ categoria: 'combustivel' }), 'Categoria')).toBe('Combustível')
  })

  it('mostra a categoria digitada à mão como veio', () => {
    expect(celula(conta({ categoria: 'Aluguel do galpão' }), 'Categoria')).toBe('Aluguel do galpão')
  })

  it('deixa vazio quando não há categoria', () => {
    expect(celula(conta({ categoria: null }), 'Categoria')).toBeNull()
  })

  it('escreve o status por extenso', () => {
    expect(celula(conta({ status: 'paga' }), 'Status')).toBe('Paga')
    expect(celula(conta({ status: 'aguardando' }), 'Status')).toBe('Aguardando')
  })

  // A tela chama de "Contas fixas" tudo que não veio de nota — mas conta
  // avulsa também cai aí e não é fixa. No relatório os três aparecem separados.
  it('separa boleto de nota, conta fixa e avulsa', () => {
    const deNota = conta({ nota_fiscal_id: 'nf1', notas_fiscais: { numero: '12345' }, contas_recorrentes: null })
    expect(celula(deNota, 'Tipo')).toBe('Boleto de nota')
    expect(celula(deNota, 'Nº da nota')).toBe('12345')

    expect(celula(conta(), 'Tipo')).toBe('Conta fixa')
    expect(celula(conta(), 'Nº da nota')).toBeNull()

    const avulsa = conta({ contas_recorrentes: null, nota_fiscal_id: null })
    expect(celula(avulsa, 'Tipo')).toBe('Avulsa')
  })

  it('mostra a parcela como 2/5 e vazio quando não é parcelada', () => {
    expect(celula(conta({ numero_parcela: 2, total_parcelas: 5 }), 'Parcela')).toBe('2/5')
    expect(celula(conta(), 'Parcela')).toBeNull()
  })

  it('leva a observação', () => {
    expect(celula(conta({ observacao: 'Pago em dinheiro' }), 'Observação')).toBe('Pago em dinheiro')
  })

  it('toda coluna tem largura definida — sem isso o Excel abre tudo estreito', () => {
    expect(colunasExport().every(c => typeof c.largura === 'number' && c.largura! > 0)).toBe(true)
  })

  it('não devolve undefined em nenhuma célula de uma conta cheia de nulos', () => {
    const vazia = conta({
      fornecedor: null, categoria: null, vencimento: null, valor: null,
      data_pagamento: null, observacao: null, contas_recorrentes: null, notas_fiscais: null,
    })
    expect(celulas(vazia).every(v => v !== undefined)).toBe(true)
  })
})

// Achado 5 do Apolo: com `findIndex` devolvendo -1, `linha[-1] = total` grava
// uma propriedade que o gerador nunca percorre — a planilha sairia com a
// palavra TOTAL e nenhum número ao lado, sem erro em lugar nenhum.
describe('indiceDaColunaValor', () => {
  it('acha a coluna de valor na lista de verdade', () => {
    expect(colunasExport()[IDX_VALOR].header).toBe(HEADER_VALOR)
  })

  it('ESTOURA quando o cabeçalho da coluna de valor foi renomeado', () => {
    const renomeadas = colunasExport().map(c =>
      c.header === HEADER_VALOR ? { ...c, header: 'Valor' } : c,
    ) as ColunaXlsx<ContaAPI>[]
    expect(() => indiceDaColunaValor(renomeadas)).toThrow(/não existe mais/)
  })
})

describe('linhasDeTotal', () => {
  it('soma os valores e conta as linhas', () => {
    const [linha] = linhasDeTotal([conta({ valor: 100 }), conta({ valor: 250.5 })], IDX_VALOR)
    expect(linha[0]).toBe('TOTAL CONFIRMADO · 2 contas')
    expect(linha[IDX_VALOR]).toBe(350.5)
  })

  it('fala no singular quando é uma conta só', () => {
    expect(linhasDeTotal([conta()], IDX_VALOR)[0][0]).toBe('TOTAL CONFIRMADO · 1 conta')
  })

  // ACHADO 1 [alto]: `calcularTotais` já proíbe isso na tela — "um número que
  // mistura chute com fato mente sem avisar". A primeira versão do rodapé
  // fazia exatamente isso, e num filtro de contas fixas o total era 100% chute.
  it('NUNCA soma estimativa junto com valor confirmado', () => {
    const linhas = linhasDeTotal([
      conta({ valor: 1000, valor_estimado: false }),
      conta({ valor: 4200, valor_estimado: true }),
      conta({ valor: 380000, valor_estimado: true }),
    ], IDX_VALOR)

    expect(linhas).toHaveLength(2)
    expect(linhas[0][0]).toBe('TOTAL CONFIRMADO · 1 conta')
    expect(linhas[0][IDX_VALOR]).toBe(1000)
    expect(linhas[1][0]).toBe('TOTAL ESTIMADO · 2 contas')
    expect(linhas[1][IDX_VALOR]).toBe(384200)
    // O número que a versão anterior mostrava em negrito, e que não pode
    // aparecer em célula nenhuma.
    expect(linhas.some(l => l.includes(385200))).toBe(false)
  })

  it('não gasta uma linha com "TOTAL ESTIMADO · 0 contas"', () => {
    expect(linhasDeTotal([conta({ valor_estimado: false })], IDX_VALOR)).toHaveLength(1)
  })

  it('conta só estimadas quando não há nenhuma confirmada', () => {
    const linhas = linhasDeTotal([conta({ valor: 50, valor_estimado: true })], IDX_VALOR)
    expect(linhas[0][0]).toBe('TOTAL CONFIRMADO · 0 contas')
    expect(linhas[0][IDX_VALOR]).toBe(0)
    expect(linhas[1][0]).toBe('TOTAL ESTIMADO · 1 conta')
  })

  // Somar centavos em ponto flutuante devolve 0.30000000000000004. O Excel
  // mostraria 0,30 por causa do formato, mas o número gravado estaria errado.
  it('arredonda o total em centavos', () => {
    const [linha] = linhasDeTotal([conta({ valor: 0.1 }), conta({ valor: 0.2 })], IDX_VALOR)
    expect(linha[IDX_VALOR]).toBe(0.3)
  })

  // ACHADO 6: "3 contas" com uma célula em branco no meio deixa quem confere
  // sem saber se é dado faltando ou zero.
  it('avisa quando alguma conta entrou sem valor informado', () => {
    const [linha] = linhasDeTotal(
      [conta({ valor: null }), conta({ valor: 100 }), conta({ valor: 50 })],
      IDX_VALOR,
    )
    expect(linha[0]).toBe('TOTAL CONFIRMADO · 3 contas · 1 sem valor informado')
    expect(linha[IDX_VALOR]).toBe(150)
  })

  it('põe o número embaixo da coluna Valor, não em outra qualquer', () => {
    const [linha] = linhasDeTotal([conta({ valor: 7 })], IDX_VALOR)
    expect(linha).toHaveLength(IDX_VALOR + 1)
    expect(linha[IDX_VALOR]).toBe(7)
    expect(linha.slice(1, IDX_VALOR).every(v => v === null)).toBe(true)
  })
})

// ACHADO 2 [alto]: o nome do arquivo promete um mês e um "todas" que a tela
// não cumpre — de propósito e por bom motivo. Na tela os chips explicam; no
// anexo de e-mail, nada explica.
describe('descricaoDoFiltro', () => {
  it('diz o que "todas" esconde', () => {
    expect(descricaoDoFiltro(CTX)).toContain('exceto dispensadas e pagas há mais de 30 dias')
  })

  it('avisa que o mês filtrado traz caronas de outros meses', () => {
    const d = descricaoDoFiltro(CTX)
    expect(d).toContain('vencimento em agosto de 2026')
    expect(d).toContain('inclui contas sem vencimento informado')
    expect(d).toContain('inclui contas atrasadas de meses anteriores')
  })

  // Conta paga nunca é "atrasada" (ENCERRADAS sai do cálculo em contaBateMes),
  // então prometer a carona seria mentira na outra direção.
  it('NÃO promete atrasadas quando o filtro só devolve conta encerrada', () => {
    const d = descricaoDoFiltro({ ...CTX, filtroStatus: 'paga' })
    expect(d).toContain('somente contas pagas')
    expect(d).toContain('inclui contas sem vencimento, pelo mês do pagamento')
    expect(d).not.toContain('atrasadas de meses anteriores')
  })

  it('não fala em mês nenhum quando o filtro é "todos"', () => {
    const d = descricaoDoFiltro({ ...CTX, filtroMes: 'todos' })
    expect(d).toContain('todos os meses')
    expect(d).not.toContain('vencimento em')
    expect(d).not.toContain('atrasadas de meses anteriores')
  })

  it('carrega o filtro de tipo, a fazenda e a data de geração', () => {
    const d = descricaoDoFiltro({ ...CTX, filtroTipo: 'nota' })
    expect(d).toContain('somente boletos de nota fiscal')
    expect(d).toContain('fazenda MG')
    // `codigo` chega minúsculo do banco: 'fazenda mg' num anexo de e-mail
    // parece descuido (visto no arquivo real de 31/08/2026).
    expect(descricaoDoFiltro({ ...CTX, fazenda: 'mg' })).toContain('fazenda MG')
    expect(d).toContain('gerado em 31/08/2026')
  })

  // ACHADO 2 da rodada 2: `contaBateFiltro` exige `!!c.vencimento` em
  // "atrasada" — conta sem data NUNCA entra, e a frase prometia que sim. Pior:
  // o filtro de mês é inerte nesse recorte (`contaBateMes` devolve true para
  // toda atrasada), então "vencimento em agosto de 2026" também era falso.
  it('não promete conta sem vencimento no filtro "atrasada"', () => {
    const d = descricaoDoFiltro({ ...CTX, filtroStatus: 'atrasada' })
    expect(d).toContain('somente contas atrasadas')
    expect(d).not.toContain('inclui contas sem vencimento informado')
    expect(d).not.toContain('vencimento em agosto de 2026')
    expect(d).toContain('não altera este recorte')
  })

  // "somente contas sem vencimento informado · vencimento em agosto de 2026"
  // era a frase antiga: ela se contradizia na mesma linha.
  it('não fala em vencimento de mês no filtro "sem-vencimento"', () => {
    const d = descricaoDoFiltro({ ...CTX, filtroStatus: 'sem-vencimento' })
    expect(d).toContain('somente contas sem vencimento informado')
    expect(d).not.toContain('vencimento em agosto de 2026')
    expect(d).not.toContain('atrasadas de meses anteriores')
    expect(d).toContain('não altera este recorte')
  })

  // Depois do conserto do `contaBateMes`, conta sem vencimento num recorte de
  // encerradas entra pelo mês do PAGAMENTO — não "sempre". A frase antiga era
  // sub-descrita (achado 7 da rodada 3).
  it('diz por QUE data a conta sem vencimento entrou no recorte de pagas', () => {
    expect(descricaoDoFiltro({ ...CTX, filtroStatus: 'paga' }))
      .toContain('inclui contas sem vencimento, pelo mês do pagamento')
  })

  // "Dispensar" grava só o status — conta dispensada NUNCA tem data de
  // pagamento, então ela entra em qualquer mês. A 1a tentativa de conserto
  // agrupou dispensada com paga e passou a mentir aqui (achado 2, rodada 4).
  it('NÃO promete mês de pagamento no filtro "dispensada"', () => {
    const d = descricaoDoFiltro({ ...CTX, filtroStatus: 'dispensada' })
    expect(d).toContain('inclui contas sem vencimento informado')
    expect(d).not.toContain('pelo mês do pagamento')
  })

  // Em "Todas" (o padrão da tela) os dois casos convivem: conta em aberto sem
  // vencimento entra sempre, conta paga sem vencimento entra pelo pagamento.
  // A frase única prometia inclusão que não acontecia (achado 5, rodada 4).
  it('separa os dois casos no filtro "todas"', () => {
    expect(descricaoDoFiltro(CTX))
      .toContain('inclui contas sem vencimento informado — as já pagas, pelo mês do pagamento')
  })

  it('grita quando a lista pode estar incompleta', () => {
    expect(descricaoDoFiltro({ ...CTX, parcial: true })).toContain('pode estar incompleta')
    expect(descricaoDoFiltro(CTX)).not.toContain('pode estar incompleta')
  })
})

describe('montarRodape', () => {
  it('separa dados, descrição e totais com linhas em branco', () => {
    const r = montarRodape([conta({ valor: 10 })], CTX, colunasExport())
    expect(r[0]).toEqual([])
    expect(String(r[1][0])).toContain('Filtro:')
    expect(r[2]).toEqual([])
    expect(String(r[3][0])).toContain('TOTAL CONFIRMADO')
  })

  it('não devolve rodapé nenhum quando não há contas', () => {
    expect(montarRodape([], CTX, colunasExport())).toEqual([])
  })

  // Sem este teste o 3º parâmetro é decorativo: trocar o corpo por uma segunda
  // chamada a `colunasExport()` passava nos 74 testes, e o total cairia embaixo
  // de outra coluna no dia em que alguém exportasse uma lista diferente.
  it('põe o total embaixo da coluna Valor DA LISTA RECEBIDA', () => {
    const enxutas = colunasExport().filter(c => ['Descrição', HEADER_VALOR].includes(c.header))
    const r = montarRodape([conta({ valor: 10 })], CTX, enxutas)
    expect(r[3]).toHaveLength(2)
    expect(r[3][1]).toBe(10)
  })
})

// ACHADO 3: a peça cujo trabalho é impedir perda silenciosa de dinheiro era
// justamente a única sem teste. Continua sendo um PALPITE — o teto real do
// PostgREST deste projeto nunca foi medido — e o teste trava o contrato para
// que quem mudar o palpite veja o que está mudando.
describe('pareceTruncado', () => {
  it('desconfia dos números redondos que o PostgREST costuma usar de teto', () => {
    expect(pareceTruncado(1000)).toBe(true)
    expect(pareceTruncado(10000)).toBe(true)
  })

  it('não desconfia de número comum', () => {
    expect(pareceTruncado(0)).toBe(false)
    expect(pareceTruncado(999)).toBe(false)
    expect(pareceTruncado(1001)).toBe(false)
  })

  // Documenta o limite conhecido: se o teto real for 500 ou 2000, isto devolve
  // false e o arquivo se apresenta como completo. Conserto de verdade =
  // `count: 'exact'` na rota GET /contas.
  it('NÃO pega teto fora da lista — limite conhecido e aceito', () => {
    expect(pareceTruncado(500)).toBe(false)
    expect(pareceTruncado(2000)).toBe(false)
  })
})

describe('nomeArquivoExport', () => {
  it('carrega fazenda, filtro e mês', () => {
    expect(nomeArquivoExport({ ...CTX, filtroStatus: 'paga' })).toBe('contas-mg-pagas-2026-08.xlsx')
  })

  // Sem a fazenda no nome, exportar na MG e depois na Tejuco daria dois
  // arquivos de nome idêntico e conteúdo completamente diferente.
  it('separa as fazendas', () => {
    expect(nomeArquivoExport({ ...CTX, fazenda: 'TEJUCO' })).toBe('contas-tejuco-todas-2026-08.xlsx')
  })

  it('tira acento e espaço do código da fazenda', () => {
    expect(nomeArquivoExport({ ...CTX, fazenda: 'Fazenda São João' }))
      .toBe('contas-fazenda-sao-joao-todas-2026-08.xlsx')
  })

  it('omite a fazenda quando ela não veio', () => {
    expect(nomeArquivoExport({ ...CTX, fazenda: null })).toBe('contas-todas-2026-08.xlsx')
  })

  it('diz "tudo" quando não há filtro de mês', () => {
    expect(nomeArquivoExport({ ...CTX, filtroMes: 'todos' })).toBe('contas-mg-todas-tudo.xlsx')
  })

  it('inclui o filtro de tipo só quando ele está ligado', () => {
    expect(nomeArquivoExport({ ...CTX, filtroTipo: 'nota' })).toBe('contas-mg-todas-boletos-2026-08.xlsx')
    expect(nomeArquivoExport({ ...CTX, filtroTipo: 'fixas' })).toBe('contas-mg-todas-fixas-2026-08.xlsx')
  })

  // Um arquivo chamado "tudo" que não é tudo é pior que arquivo nenhum,
  // porque ninguém desconfia dele.
  it('avisa no nome quando o arquivo é um pedaço só', () => {
    expect(nomeArquivoExport({ ...CTX, parcial: true })).toBe('contas-mg-parcial-todas-2026-08.xlsx')
  })
})
