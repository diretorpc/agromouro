import { describe, it, expect } from 'vitest'
import {
  avisosDoArquivo, contasExportaveis, historicoDaConta, linhasLivroCaixa,
  nomeArquivoExport, pareceTruncado, type ContextoNome,
} from './exportar'
import type { ContaAPI } from './tipos'

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

/** A linha do livro caixa de UMA conta. Falha se a conta não entrar no arquivo. */
function linha(c: ContaAPI, fazenda: string | null = 'mg') {
  const saida = linhasLivroCaixa([c], fazenda)
  expect(saida).toHaveLength(1)
  return saida[0]
}

const CTX: ContextoNome = {
  filtroStatus: 'todas', filtroTipo: 'todos', filtroMes: '2026-08',
  fazenda: 'MG', parcial: false,
}

// ─── Quem entra no arquivo ────────────────────────────────────────────────────

describe('contasExportaveis', () => {
  // Toda ocorrência de conta fixa nasce com valor CHUTADO a partir do último
  // pagamento, e o formato do livro caixa não tem coluna, crachá nem rodapé
  // onde dizer isso. Decisão do Matheus em 01/09/2026: fica de fora.
  it('deixa a conta de valor estimado de fora', () => {
    const lista = [
      conta({ id: 'a', valor_estimado: false }),
      conta({ id: 'b', valor_estimado: true }),
      conta({ id: 'c', valor_estimado: false }),
    ]
    expect(contasExportaveis(lista).map(c => c.id)).toEqual(['a', 'c'])
  })

  // Dispensar é decidir NÃO pagar, e a conta nunca ganha `data_pagamento`.
  // Sem esta exclusão, exportar a aba "Dispensadas" entregava ao contador um
  // arquivo em que toda linha era "Custo" com valor negativo e "D" de débito —
  // despesa que ele lançaria, de dinheiro que nunca vai sair. Achado 2 do Apolo.
  it('deixa a conta dispensada de fora', () => {
    const lista = [conta({ id: 'a' }), conta({ id: 'b', status: 'dispensada' })]
    expect(contasExportaveis(lista).map(c => c.id)).toEqual(['a'])
  })

  it('os dois filtros valem também dentro de linhasLivroCaixa', () => {
    const saida = linhasLivroCaixa(
      [conta({ valor_estimado: true }), conta({ status: 'dispensada' }), conta()],
      'mg',
    )
    expect(saida).toHaveLength(1)
  })
})

// ─── Avisos da tela ───────────────────────────────────────────────────────────

// São a ÚNICA defesa contra o arquivo omitir e distorcer em silêncio: o formato
// do livro caixa não tem rodapé, coluna de status nem crachá. Moram em
// `exportar.ts` justamente para terem teste — no JSX não teriam.
describe('avisosDoArquivo', () => {
  // Aviso permanente treina quem lê a ignorar o âmbar.
  it('não avisa nada quando está tudo em ordem', () => {
    expect(avisosDoArquivo([conta(), conta()])).toEqual([])
  })

  it('avisa quantas estimadas ficaram de fora', () => {
    const avisos = avisosDoArquivo([conta({ valor_estimado: true }), conta()])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toContain('1 conta deste recorte tem')
    expect(avisos[0]).toContain('ESTIMADO')
  })

  // A frase INTEIRA concorda em número, não só o primeiro verbo. A 1ª versão
  // dizia "2 contas deste recorte têm valor ESTIMADO e não ENTRA no arquivo" —
  // visto na tela em 01/09/2026, porque o plural cobria só o começo.
  it('concorda em número do começo ao fim da frase', () => {
    expect(avisosDoArquivo([conta({ valor_estimado: true })])[0])
      .toContain('1 conta deste recorte tem valor ESTIMADO e não entra no arquivo')
    expect(avisosDoArquivo([conta({ valor_estimado: true }), conta({ valor_estimado: true })])[0])
      .toContain('2 contas deste recorte têm valor ESTIMADO e não entram no arquivo')
  })

  it('avisa quantas dispensadas ficaram de fora', () => {
    const avisos = avisosDoArquivo([conta({ status: 'dispensada' }), conta()])
    expect(avisos.some(a => a.includes('1 conta dispensada não entra'))).toBe(true)
  })

  // Achado 1 do Apolo: o formato perdeu a coluna de status. A linha de uma conta
  // aberta sai com valor cheio, sinal negativo e "D" de débito — num livro caixa
  // isso é dinheiro que saiu. Só a data fica em branco, e data em branco não grita.
  it('avisa sobre as contas que ENTRAM no arquivo sem ter sido pagas', () => {
    const avisos = avisosDoArquivo([conta({ status: 'aberta', data_pagamento: null }), conta()])
    expect(avisos.some(a => a.includes('1 conta do arquivo ainda não foi paga'))).toBe(true)
  })

  it('não conta como "não paga" quem já ficou de fora do arquivo', () => {
    const avisos = avisosDoArquivo([conta({ valor_estimado: true, data_pagamento: null })])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toContain('ESTIMADO')
  })

  it('os três avisos aparecem juntos quando os três casos existem', () => {
    const avisos = avisosDoArquivo([
      conta({ valor_estimado: true }),
      conta({ status: 'dispensada' }),
      conta({ status: 'aberta', data_pagamento: null }),
      conta(),
    ])
    expect(avisos).toHaveLength(3)
  })
})

// ─── HISTÓRICO ────────────────────────────────────────────────────────────────

describe('historicoDaConta', () => {
  it('junta fornecedor e descrição', () => {
    expect(historicoDaConta(conta())).toBe('CEMIG - Energia elétrica — sede')
  })

  it('usa só o que existe quando falta fornecedor', () => {
    expect(historicoDaConta(conta({ fornecedor: null }))).toBe('Energia elétrica — sede')
  })

  it('ignora fornecedor que é só espaço', () => {
    expect(historicoDaConta(conta({ fornecedor: '   ' }))).toBe('Energia elétrica — sede')
  })

  it('devolve null quando não sobra nada', () => {
    expect(historicoDaConta(conta({ fornecedor: null, descricao: '' }))).toBeNull()
  })

  // Sem a parcela, duas parcelas do mesmo contrato — mesmo fornecedor, mesmo
  // valor, mesma descrição — viram duas linhas IDÊNTICAS, e quem confere não
  // sabe se é parcela 2 ou lançamento em duplicidade.
  it('acrescenta a parcela no fim', () => {
    const c = conta({ numero_parcela: 2, total_parcelas: 3 })
    expect(historicoDaConta(c)).toBe('CEMIG - Energia elétrica — sede (2/3)')
  })

  it('parcela sozinha vira o histórico inteiro quando não há texto', () => {
    const c = conta({ fornecedor: null, descricao: '', numero_parcela: 2, total_parcelas: 3 })
    expect(historicoDaConta(c)).toBe('Parcela 2/3')
  })

  it('não inventa parcela quando só um dos dois campos veio', () => {
    expect(historicoDaConta(conta({ numero_parcela: 2, total_parcelas: null })))
      .toBe('CEMIG - Energia elétrica — sede')
  })

  // Visto em produção em 01/09/2026 (conta da HIGA): boleto de nota comum nasce
  // 1/1, e "(1/1)" em toda linha é ruído que ensina a ignorar o "(2/3)".
  it('não escreve (1/1) em cobrança de parcela única', () => {
    expect(historicoDaConta(conta({ numero_parcela: 1, total_parcelas: 1 })))
      .toBe('CEMIG - Energia elétrica — sede')
  })

  it('mas escreve (1/3) na primeira de três', () => {
    expect(historicoDaConta(conta({ numero_parcela: 1, total_parcelas: 3 })))
      .toBe('CEMIG - Energia elétrica — sede (1/3)')
  })
})

// ─── A linha do livro caixa ───────────────────────────────────────────────────

describe('linhasLivroCaixa', () => {
  // No modelo, custo é NEGATIVO — e é o sinal que faz a coluna C/D calcular
  // "D" de débito. No banco o valor é sempre positivo.
  it('inverte o sinal do valor', () => {
    expect(linha(conta({ valor: 1234.56 })).valor).toBe(-1234.56)
  })

  it('valor já negativo continua negativo, não vira positivo', () => {
    expect(linha(conta({ valor: -500 })).valor).toBe(-500)
  })

  // Célula vazia e zero são coisas diferentes na planilha do contador.
  it('valor nulo continua nulo — não vira zero', () => {
    expect(linha(conta({ valor: null })).valor).toBeNull()
  })

  // É livro CAIXA: registra quando o dinheiro saiu, não quando venceria.
  it('a data é a DO PAGAMENTO, não a do vencimento', () => {
    const l = linha(conta({ vencimento: '2026-08-10', data_pagamento: '2026-08-08' }))
    expect(l.data?.getDate()).toBe(8)
    expect(l.data?.getMonth()).toBe(7) // agosto, base 0 no Date
    expect(l.data?.getFullYear()).toBe(2026)
  })

  // Consequência aceita da decisão de 01/09/2026: conta não paga sai com
  // DIA/MÊS/ANO em branco.
  it('conta sem pagamento sai sem data', () => {
    expect(linha(conta({ status: 'aberta', data_pagamento: null })).data).toBeNull()
  })

  // `new Date('2026-08-01')` é meia-noite UTC = 31/07 21h no Brasil. O dia 1º
  // sairia como último dia do mês anterior. Mesmo bug que já mordeu o
  // Financeiro em junho/2026.
  it('o dia 1º não escorrega para o mês anterior por causa de fuso', () => {
    const l = linha(conta({ data_pagamento: '2026-08-01' }))
    expect(l.data?.getDate()).toBe(1)
    expect(l.data?.getMonth()).toBe(7)
  })

  it('data inválida vira null em vez de Invalid Date', () => {
    expect(linha(conta({ data_pagamento: 'nao-e-data' })).data).toBeNull()
  })

  it('é sempre Custo — esta tela não tem receita', () => {
    expect(linha(conta()).custoOuReceita).toBe('Custo')
  })

  it('a transação é o rótulo da categoria, não o código do banco', () => {
    expect(linha(conta({ categoria: 'combustivel' })).transacao).toBe('Combustível')
  })

  it('sem categoria, a transação fica vazia', () => {
    expect(linha(conta({ categoria: null })).transacao).toBeNull()
  })

  // O caso MAIS COMUM do sistema: toda conta nascida de boleto de NF-e grava
  // `categoria: 'insumos'`, e 'insumos' não está em CATEGORIAS_FINANCEIRAS.
  // Sem tratamento, a planilha do contador leva "insumos" em minúscula no meio
  // de "Combustível" e "Manutenção".
  it('categoria fora da lista sai capitalizada, não crua', () => {
    expect(linha(conta({ categoria: 'insumos' })).transacao).toBe('Insumos')
  })

  it('categoria fora da lista com underscore vira texto legível', () => {
    expect(linha(conta({ categoria: 'tejuco_gado' })).transacao).toBe('Tejuco gado')
  })

  it('rótulo conhecido não é mexido', () => {
    expect(linha(conta({ categoria: 'rh' })).transacao).toBe('Mão de Obra (RH)')
  })

  // O modelo usa 'MG' / 'TJ'; o banco guarda minúsculo.
  it('o centro de custo é o código da fazenda em maiúscula', () => {
    expect(linha(conta(), 'tejuco').centroCusto).toBe('TEJUCO')
  })

  it('sem fazenda, o centro de custo fica vazio', () => {
    expect(linha(conta(), null).centroCusto).toBeNull()
  })

  it('o nº do documento é o número da nota, quando existe', () => {
    expect(linha(conta({ notas_fiscais: { numero: '004521' } })).numeroDocumento).toBe('004521')
  })

  it('conta fixa ou avulsa sai sem nº de documento', () => {
    expect(linha(conta()).numeroDocumento).toBeNull()
  })

  it('leva a observação como está', () => {
    expect(linha(conta({ observacao: 'Casa Alexandre' })).observacao).toBe('Casa Alexandre')
  })

  // Não são esquecimento: o sistema não tem esses dados. O cabeçalho AMARELO
  // delas no modelo é justamente a marca de "preenche à mão".
  it('as 7 colunas sem fonte de dado ficam vazias', () => {
    const l = linha(conta())
    expect(l.banco).toBeUndefined()
    expect(l.agencia).toBeUndefined()
    expect(l.contaCorrente).toBeUndefined()
    expect(l.dependenciaOrigem).toBeUndefined()
    expect(l.terceiro).toBeUndefined()
    expect(l.imovel).toBeUndefined()
    expect(l.inscricaoImovel).toBeUndefined()
  })

  // Livro caixa é documento cronológico, e a tela ordena por VENCIMENTO (ou
  // pelo que o dono tiver clicado no cabeçalho). Duas contas que vencem 05/08 e
  // 10/08 podem ter sido pagas 20/08 e 06/08: herdar a ordem da tela punha
  // 20/08 antes de 06/08 no arquivo. Achado 3 do Apolo.
  it('ordena pela data do pagamento, não pela ordem da tela', () => {
    const saida = linhasLivroCaixa([
      conta({ fornecedor: 'A', vencimento: '2026-08-05', data_pagamento: '2026-08-20' }),
      conta({ fornecedor: 'B', vencimento: '2026-08-10', data_pagamento: '2026-08-06' }),
    ], 'mg')
    expect(saida.map(l => l.historico?.[0])).toEqual(['B', 'A'])
    expect(saida.map(l => l.data?.getDate())).toEqual([6, 20])
  })

  it('conta sem pagamento vai para o fim, não para o começo', () => {
    const saida = linhasLivroCaixa([
      conta({ fornecedor: 'A', status: 'aberta', data_pagamento: null }),
      conta({ fornecedor: 'B', data_pagamento: '2026-08-06' }),
      conta({ fornecedor: 'C', status: 'aberta', data_pagamento: null }),
      conta({ fornecedor: 'D', data_pagamento: '2026-08-02' }),
    ], 'mg')
    expect(saida.map(l => l.historico?.[0])).toEqual(['D', 'B', 'A', 'C'])
  })

  // Estabilidade: mesmo dia mantém a ordem que chegou, então o sort da tela
  // ainda desempata dentro do dia em vez de embaralhar.
  it('empate de data preserva a ordem recebida', () => {
    const saida = linhasLivroCaixa(
      [conta({ fornecedor: 'A' }), conta({ fornecedor: 'B' }), conta({ fornecedor: 'C' })],
      'mg',
    )
    expect(saida.map(l => l.historico?.[0])).toEqual(['A', 'B', 'C'])
  })

  // Ordenar não pode mexer no array de quem chamou — `contasFiltradas` é estado
  // do React, e ordenar no lugar re-renderizaria a tabela na ordem do arquivo.
  it('não altera a lista recebida', () => {
    const lista = [
      conta({ fornecedor: 'A', data_pagamento: '2026-08-20' }),
      conta({ fornecedor: 'B', data_pagamento: '2026-08-06' }),
    ]
    linhasLivroCaixa(lista, 'mg')
    expect(lista.map(c => c.fornecedor)).toEqual(['A', 'B'])
  })

  it('lista vazia devolve lista vazia, sem estourar', () => {
    expect(linhasLivroCaixa([], 'mg')).toEqual([])
  })
})

// ─── Truncamento ──────────────────────────────────────────────────────────────

describe('pareceTruncado', () => {
  it('desconfia dos tetos redondos conhecidos', () => {
    expect(pareceTruncado(1000)).toBe(true)
    expect(pareceTruncado(10000)).toBe(true)
  })

  it('não desconfia de número comum', () => {
    expect(pareceTruncado(0)).toBe(false)
    expect(pareceTruncado(999)).toBe(false)
    expect(pareceTruncado(1001)).toBe(false)
    // Medido em 31/08/2026: 594 de 594 linhas voltaram numa consulta real.
    expect(pareceTruncado(594)).toBe(false)
  })
})

// ─── Nome do arquivo ──────────────────────────────────────────────────────────

describe('nomeArquivoExport', () => {
  // Formato novo desde 01/09/2026. Sem o prefixo, os arquivos novos se
  // confundem com os antigos já salvos na pasta de Downloads.
  it('começa com livro-caixa', () => {
    expect(nomeArquivoExport(CTX)).toBe('livro-caixa-mg-todas-2026-08.xlsx')
  })

  it('a fazenda entra logo depois — dois recortes iguais em fazendas diferentes não colidem', () => {
    const mg = nomeArquivoExport({ ...CTX, fazenda: 'MG' })
    const tj = nomeArquivoExport({ ...CTX, fazenda: 'Tejuco' })
    expect(mg).not.toBe(tj)
    expect(tj).toBe('livro-caixa-tejuco-todas-2026-08.xlsx')
  })

  it('sem fazenda, omite o pedaço em vez de escrever null', () => {
    expect(nomeArquivoExport({ ...CTX, fazenda: null })).toBe('livro-caixa-todas-2026-08.xlsx')
  })

  it('marca parcial quando a lista pode estar cortada', () => {
    expect(nomeArquivoExport({ ...CTX, parcial: true }))
      .toBe('livro-caixa-mg-parcial-todas-2026-08.xlsx')
  })

  it('pluraliza o status — o arquivo tem várias contas', () => {
    expect(nomeArquivoExport({ ...CTX, filtroStatus: 'paga' }))
      .toBe('livro-caixa-mg-pagas-2026-08.xlsx')
  })

  it('acrescenta o tipo quando não é "todos"', () => {
    expect(nomeArquivoExport({ ...CTX, filtroTipo: 'nota' }))
      .toBe('livro-caixa-mg-todas-boletos-2026-08.xlsx')
  })

  it('mês "todos" vira "tudo"', () => {
    expect(nomeArquivoExport({ ...CTX, filtroMes: 'todos' }))
      .toBe('livro-caixa-mg-todas-tudo.xlsx')
  })

  it('tira acento e espaço do código da fazenda', () => {
    expect(nomeArquivoExport({ ...CTX, fazenda: 'São João' }))
      .toBe('livro-caixa-sao-joao-todas-2026-08.xlsx')
  })
})
