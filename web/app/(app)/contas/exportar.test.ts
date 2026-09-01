import { describe, it, expect } from 'vitest'
import {
  avisosDoArquivo, contasExportaveis, historicoDaConta, linhasLivroCaixa,
  nomeArquivoExport, ordenarPorData, pareceTruncado, type ContextoNome,
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
  // A regra virou UMA só em 01/09/2026 (2ª decisão do Matheus, depois da 1ª
  // revisão do Apolo): livro caixa registra dinheiro que SAIU. O formato do
  // modelo não tem coluna de status, então conta em aberto entrava com valor
  // cheio e "D" de débito, indistinguível de pagamento feito.
  it('só deixa passar conta paga', () => {
    const lista = [
      conta({ id: 'a', status: 'paga' }),
      conta({ id: 'b', status: 'aberta' }),
      conta({ id: 'c', status: 'aguardando' }),
      conta({ id: 'd', status: 'dispensada' }),
    ]
    expect(contasExportaveis(lista).map(c => c.id)).toEqual(['a'])
  })

  // Cinto de segurança para linha antiga: `POST /contas/:id/pagar` grava
  // `valor_estimado: false` junto com o status, então conta paga E estimada só
  // existe se foi gravada antes dessa regra. Sairia como número duro num
  // arquivo que o contador lança como fato.
  it('barra a conta paga que ficou com valor estimado', () => {
    const lista = [conta({ id: 'a' }), conta({ id: 'b', status: 'paga', valor_estimado: true })]
    expect(contasExportaveis(lista).map(c => c.id)).toEqual(['a'])
  })

  it('a regra vale também dentro de linhasLivroCaixa', () => {
    const saida = linhasLivroCaixa([
      conta({ status: 'aberta' }),
      conta({ status: 'dispensada' }),
      conta({ status: 'paga', valor_estimado: true }),
      conta(),
    ], 'mg')
    expect(saida).toHaveLength(1)
  })
})

// ─── Avisos da tela ───────────────────────────────────────────────────────────

// São a ÚNICA defesa contra o arquivo omitir e distorcer em silêncio: o formato
// do livro caixa não tem rodapé, coluna de status nem crachá. Moram em
// `exportar.ts` justamente para terem teste — no JSX não teriam.
describe('avisosDoArquivo', () => {
  const HOJE = '2026-09-01'
  // Atalho: por padrão nada foi escondido e o mês é 'todos', para cada teste
  // ligar SÓ o aviso que ele está medindo.
  const avisos = (lista: ContaAPI[], over: Partial<Parameters<typeof avisosDoArquivo>[0]> = {}) =>
    avisosDoArquivo({
      contasFiltradas: lista, contasCarregadas: lista,
      filtroStatus: 'paga', filtroTipo: 'todos', filtroMes: 'todos', hoje: HOJE, ...over,
    })

  it('não avisa nada quando todas do recorte foram pagas', () => {
    expect(avisos([conta(), conta()])).toEqual([])
  })

  // ─── O que a tela escondeu antes de a lista chegar aqui ────────────────────

  // Aviso permanente treina quem lê a ignorar o âmbar — e o filtro nasce em
  // 'todas', então sem contagem a tarja apareceria em toda abertura da tela.
  // Achado 5 da 3ª rodada do Apolo.
  it('não avisa dos 30 dias quando não há pagamento escondido', () => {
    const recente = conta({ data_pagamento: '2026-08-28' })
    expect(avisos([recente], { filtroStatus: 'todas' })).toEqual([])
  })

  it('avisa, com número, o pagamento que a aba "Todas" escondeu', () => {
    const antiga = conta({ id: 'velha', data_pagamento: '2026-05-01' })
    const saida = avisosDoArquivo({
      contasFiltradas: [], contasCarregadas: [antiga],
      filtroStatus: 'todas', filtroTipo: 'todos', filtroMes: 'todos', hoje: HOJE,
    })
    expect(saida.some(a => a.includes('1 pagamento com mais de 30 dias está escondido'))).toBe(true)
  })

  // `contaBateFiltro(c,'todas')` esconde dispensada TAMBÉM. Sem este caso, um
  // mutante que tire o `c.status === 'paga'` da contagem anuncia conta
  // dispensada como "pagamento escondido" — o dono troca de aba e não acha.
  // Mutante estava vivo; achado 6 da 4ª rodada do Apolo.
  it('conta dispensada não é anunciada como pagamento escondido', () => {
    const saida = avisos([conta({ status: 'dispensada' })], { filtroStatus: 'todas' })
    expect(saida.some(a => a.includes('30 dias'))).toBe(false)
  })

  // O aviso conta o que o dono RECUPERA trocando de aba. A tela também filtra
  // por tipo, e o contexto não carregava `filtroTipo`: o número prometia um
  // dinheiro que a instrução não devolvia. Achado 2 da 4ª rodada.
  it('a contagem dos 30 dias respeita o filtro de tipo da tela', () => {
    const deNota = conta({ id: 'n', data_pagamento: '2026-05-01', nota_fiscal_id: 'nf1' })
    const semAba = avisos([deNota], { filtroStatus: 'todas', filtroTipo: 'todos' })
    expect(semAba.some(a => a.includes('1 pagamento com mais de 30 dias'))).toBe(true)
    // Com a tela em "Contas fixas", esse pagamento de nota não é recuperável
    // trocando só de aba — então não pode ser contado.
    const soFixas = avisos([deNota], { filtroStatus: 'todas', filtroTipo: 'fixas' })
    expect(soFixas.some(a => a.includes('30 dias'))).toBe(false)
  })

  // Paga, estimada e antiga: ela não entraria no arquivo de jeito nenhum, então
  // anunciá-la como "escondida pela aba" mandaria o dono trocar de filtro atrás
  // de um pagamento que não ia aparecer. Mutante que tira o `!valor_estimado`
  // estava vivo — sobrevivente da 1ª tentativa de conserto do achado 2.
  it('conta paga E estimada não conta nos 30 dias — ela não entraria de todo jeito', () => {
    const saida = avisos([conta({ data_pagamento: '2026-05-01', valor_estimado: true })],
      { filtroStatus: 'todas' })
    expect(saida.some(a => a.includes('30 dias'))).toBe(false)
  })

  it('e manda "Todos os meses" junto, que é o que devolve o número contado', () => {
    const antiga = conta({ data_pagamento: '2026-05-01' })
    const saida = avisos([antiga], { filtroStatus: 'todas' })
    expect(saida.some(a => a.includes('Use a aba "Pagas" com "Todos os meses"'))).toBe(true)
  })

  it('não avisa dos 30 dias na aba "Pagas", que não tem limite de data', () => {
    const antiga = conta({ data_pagamento: '2026-05-01' })
    expect(avisos([antiga], { filtroStatus: 'paga' }).some(a => a.includes('30 dias'))).toBe(false)
  })

  // O filtro de mês recorta pelo VENCIMENTO (`mesDaConta`), não pela data do
  // pagamento. A 1ª versão deste aviso mandava "exporte pela aba Pagas para o
  // mês fechado" — conselho que produzia justamente o livro caixa furado, com
  // linha de outro mês dentro. Achado 1 da 3ª rodada do Apolo.
  // Venceu 28/07, foi paga 05/08: NÃO entra no recorte de agosto, embora o
  // dinheiro tenha saído em agosto. É o furo que o aviso denuncia.
  it('avisa o pagamento que o filtro de mês deixou no mês errado', () => {
    const desalinhada = conta({ vencimento: '2026-07-28', data_pagamento: '2026-08-05' })
    const saida = avisos([desalinhada], { filtroMes: '2026-08' })
    expect(saida.some(a => a.includes('1 pagamento deste recorte está no mês errado'))).toBe(true)
    expect(saida.some(a => a.includes('recorta pelo VENCIMENTO'))).toBe(true)
  })

  // O outro lado: venceu 25/08 e foi paga 03/09 — entra no recorte de agosto
  // carregando uma data de setembro.
  it('pega também o pagamento de outro mês que ENTROU no recorte', () => {
    const desalinhada = conta({ vencimento: '2026-08-25', data_pagamento: '2026-09-03' })
    const saida = avisos([desalinhada], { filtroMes: '2026-08' })
    expect(saida.some(a => a.includes('1 pagamento deste recorte está no mês errado'))).toBe(true)
  })

  // SEM CONTAGEM a tarja era permanente: `filtroMes` nasce no mês corrente,
  // nunca em 'todos'. Toda abertura da tela mostraria âmbar, e âmbar permanente
  // treina quem lê a ignorar os outros quatro avisos — que são a única defesa
  // que sobrou depois que o formato tirou rodapé e coluna de status. Achado 1
  // da 4ª rodada do Apolo, e é o mesmo defeito que o aviso dos 30 dias tinha.
  it('não avisa quando todo pagamento do recorte está no mês certo', () => {
    const alinhada = conta({ vencimento: '2026-08-10', data_pagamento: '2026-08-12' })
    expect(avisos([alinhada], { filtroMes: '2026-08' })).toEqual([])
  })

  it('nem com a tela recém-aberta e o banco vazio', () => {
    expect(avisos([], { filtroStatus: 'todas', filtroMes: '2026-09' })).toEqual([])
  })

  // COMPORTAMENTO, não a guarda. `contaBateFiltro` exige `!ENCERRADAS` nas duas
  // abas, então conta paga nunca cai lá e a contagem já dá zero: tirar o
  // `filtroDeMesSeAplica` do código NÃO faz este teste reprovar (conferido por
  // mutação, e dito em voz alta no comentário da guarda). O que ele garante é
  // o que o dono vê — nenhuma tarja falsa nessas abas —, e isso continua
  // valendo qualquer que seja o caminho interno. Achado 3 da 4ª rodada.
  it('não avisa do mês nas abas onde o filtro de mês não recorta nada', () => {
    const desalinhada = conta({ vencimento: '2026-07-28', data_pagamento: '2026-08-05' })
    for (const aba of ['atrasada', 'sem-vencimento'] as const) {
      expect(
        avisos([desalinhada], { filtroStatus: aba, filtroMes: '2026-08' })
          .some(a => a.includes('mês errado')),
        `aba ${aba}`,
      ).toBe(false)
    }
  })

  it('e não avisa em "Todos os meses", onde esse recorte não existe', () => {
    const desalinhada = conta({ vencimento: '2026-07-28', data_pagamento: '2026-08-05' })
    expect(avisos([desalinhada], { filtroMes: 'todos' })
      .some(a => a.includes('VENCIMENTO'))).toBe(false)
  })

  // ─── O que o recorte tem e o arquivo não leva ──────────────────────────────

  it('separa dispensada de simplesmente não paga', () => {
    const saida = avisos([conta({ status: 'aberta' }), conta({ status: 'dispensada' }), conta()])
    expect(saida.some(a => a.includes('1 conta deste recorte não entra'))).toBe(true)
    expect(saida.some(a => a.includes('1 conta dispensada não entra'))).toBe(true)
  })

  // "Registre o valor real" era conselho MORTO: `PATCH /contas/:id` só limpa
  // `valor_estimado` quando o status não é paga/dispensada. O dono editaria o
  // valor e nada mudaria. Achado 2 da 3ª rodada do Apolo.
  it('manda desfazer o pagamento, não editar o valor', () => {
    const saida = avisos([conta({ status: 'paga', valor_estimado: true })])
    expect(saida.some(a => a.includes('desfaça o pagamento e registre-o de novo'))).toBe(true)
    expect(saida.some(a => a.includes('Registre o valor real'))).toBe(false)
  })

  it('avisa a conta paga sem data — ela ENTRA, com DIA/MÊS/ANO em branco', () => {
    expect(avisos([conta({ data_pagamento: null })])
      .some(a => a.includes('sai com DIA, MÊS e ANO em branco'))).toBe(true)
  })

  // Sem este caso, o filtro `contasExportaveis` dentro da contagem de "sem
  // data" não tem teste: um mutante que o troque por `contasFiltradas` conta
  // toda conta em aberto (que também não tem data_pagamento) como se estivesse
  // NO arquivo. Mutante estava vivo — achado 4 da 3ª rodada do Apolo.
  // O `it` abaixo mata a metade do `status`; esta mata a do `!valor_estimado`.
  // Sem ela, um mutante que troque `contasExportaveis(...)` por
  // `filter(c => c.status === 'paga')` anuncia uma conta paga-e-estimada como
  // estando NO arquivo — e ela não está. Mutante estava vivo; achado 7 da 4ª
  // rodada do Apolo.
  it('conta paga E estimada sai como estimada, nunca como "do arquivo sem data"', () => {
    const saida = avisos([conta({ valor_estimado: true, data_pagamento: null })])
    expect(saida.some(a => a.includes('ficou com valor ESTIMADO'))).toBe(true)
    expect(saida.some(a => a.includes('sem data de pagamento'))).toBe(false)
  })

  it('conta em aberto não é contada como "conta do arquivo sem data"', () => {
    const saida = avisos([conta({ status: 'aberta', data_pagamento: null })])
    expect(saida.some(a => a.includes('sem data de pagamento'))).toBe(false)
  })

  // As três contagens de EXCLUSÃO são disjuntas e exaustivas. Soma só elas: o
  // aviso de "paga sem data" conta o que ENTRA, e incluí-lo fazia o teste
  // reprovar com dado legítimo — media a coisa errada e passava por escolha de
  // fixture. Achado 3 da 3ª rodada do Apolo, com a conta 'f' que o derrubou.
  it('as contagens de exclusão somam exatamente o que ficou de fora', () => {
    const lista = [
      conta({ id: 'a', status: 'aberta' }),
      conta({ id: 'b', status: 'aguardando' }),
      conta({ id: 'c', status: 'dispensada', valor_estimado: true }),
      conta({ id: 'd', status: 'paga', valor_estimado: true }),
      conta({ id: 'e' }),
      conta({ id: 'f', status: 'paga', data_pagamento: null }),
    ]
    const soma = avisos(lista)
      .filter(a => /não entra|não entram/.test(a))
      .map(a => Number(a.match(/^([\d.]+) /)![1].replace('.', '')))
      .reduce((s, n) => s + n, 0)
    expect(soma).toBe(lista.length - contasExportaveis(lista).length)
  })

  // A frase INTEIRA concorda em número, não só o primeiro verbo. A 1ª versão
  // dizia "2 contas ... e não ENTRA no arquivo"; consertei num aviso e deixei o
  // mesmo erro nos outros — por isso a tabela cobre TODOS. Assert que para
  // antes do verbo final passa por acaso; estes vão até o fim da oração.
  const NUM_E_VERBO = [
    { nome: 'mes errado', muda: { vencimento: '2026-07-28', data_pagamento: '2026-08-05' },
      over: { filtroMes: '2026-08' },
      um:     '1 pagamento deste recorte está no mês errado: o filtro de mês recorta pelo VENCIMENTO',
      varios: '2 pagamentos deste recorte estão no mês errado: o filtro de mês recorta pelo VENCIMENTO' },
    { nome: '30 dias', muda: { data_pagamento: '2026-05-01' },
      over: { filtroStatus: 'todas' as const },
      um:     '1 pagamento com mais de 30 dias está escondido pela aba "Todas" e não entra no arquivo',
      varios: '2 pagamentos com mais de 30 dias estão escondidos pela aba "Todas" e não entram no arquivo' },
    { nome: 'nao pagas', muda: { status: 'aberta' as const },
      um:     '1 conta deste recorte não entra no arquivo porque ainda não foi paga',
      varios: '2 contas deste recorte não entram no arquivo porque ainda não foram pagas' },
    { nome: 'dispensadas', muda: { status: 'dispensada' as const },
      um:     '1 conta dispensada não entra no arquivo',
      varios: '2 contas dispensadas não entram no arquivo' },
    { nome: 'pagas estimadas', muda: { valor_estimado: true },
      um:     '1 conta paga ficou com valor ESTIMADO e não entra no arquivo: desfaça o pagamento e registre-o de novo com o valor real',
      varios: '2 contas pagas ficaram com valor ESTIMADO e não entram no arquivo: desfaça os pagamentos e registre-os de novo com o valor real' },
    { nome: 'pagas sem data', muda: { data_pagamento: null },
      um:     '1 conta do arquivo está paga mas sem data de pagamento: sai com DIA, MÊS e ANO em branco',
      varios: '2 contas do arquivo estão pagas mas sem data de pagamento: saem com DIA, MÊS e ANO em branco' },
  ]

  for (const caso of NUM_E_VERBO) {
    it(`concorda em número do começo ao fim da frase — ${caso.nome}`, () => {
      const over = 'over' in caso ? caso.over : {}
      const um = avisos([conta(caso.muda)], over)
      expect(um.some(a => a.includes(caso.um)), `singular saiu: ${um.join(' | ')}`).toBe(true)
      const dois = avisos([conta({ id: 'a', ...caso.muda }), conta({ id: 'b', ...caso.muda })], over)
      expect(dois.some(a => a.includes(caso.varios)), `plural saiu: ${dois.join(' | ')}`).toBe(true)
    })
  }

  // Alcançável: `pareceTruncado` desconfia justamente de 1.000 linhas
  // carregadas, e "1000 contas" numa tela que escreve "R$ 1.099,22" é descuido.
  it('separa o milhar no número', () => {
    const muitas = Array.from({ length: 1000 }, (_, i) => conta({ id: `c${i}`, status: 'aberta' }))
    expect(avisos(muitas).some(a => a.includes('1.000 contas'))).toBe(true)
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

  // O CASO REAL, que o fixture acima nunca exercitava: `deNotaFiscal.ts` grava
  // `descricao: 'DIESEL S10 (1/3)'` E preenche numero_parcela/total_parcelas.
  // Sem a guarda, toda conta de NF-e parcelada — o caso mais comum do sistema —
  // saía no arquivo do contador como "... (1/3) (1/3)", que é exatamente a cara
  // de lançamento duplicado que este código existe para evitar. Achado 1 da 2ª
  // rodada do Apolo.
  it('não duplica a parcela que a descrição do banco já traz', () => {
    const c = conta({
      fornecedor: 'MIKAMI COM DE PROD AGROP',
      descricao: 'DIESEL S10 (1/3)',
      numero_parcela: 1,
      total_parcelas: 3,
    })
    expect(historicoDaConta(c)).toBe('MIKAMI COM DE PROD AGROP - DIESEL S10 (1/3)')
  })

  // A guarda compara o sufixo EXATO: (1/3) no fim não pode calar (2/3).
  it('acrescenta quando a descrição traz OUTRA parcela no fim', () => {
    const c = conta({ descricao: 'DIESEL S10 (1/3)', numero_parcela: 2, total_parcelas: 3 })
    expect(historicoDaConta(c)).toBe('CEMIG - DIESEL S10 (1/3) (2/3)')
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

  // Conta não paga NÃO entra mais no arquivo (regra de 01/09/2026, 2ª decisão
  // do Matheus). Antes ela entrava com valor e "D" de débito, e só a data ficava
  // em branco — o que num livro caixa é dinheiro que saiu.
  it('conta não paga não entra no arquivo', () => {
    expect(linhasLivroCaixa([conta({ status: 'aberta', data_pagamento: null })], 'mg'))
      .toEqual([])
  })

  // A que ENTRA sem data é a linha antiga: 'paga' mas sem `data_pagamento`. A
  // rota de pagar sempre grava a data, então isto é cinto de segurança — e a
  // tela avisa quando acontece.
  it('conta paga sem data sai com as três colunas de data vazias', () => {
    expect(linha(conta({ status: 'paga', data_pagamento: null })).data).toBeNull()
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

  // Só a linha antiga ('paga' sem data) chega ao arquivo sem data — e vai pro
  // fim, para não abrir um buraco no meio de um livro cronológico.
  it('conta paga sem data vai para o fim, não para o começo', () => {
    const saida = linhasLivroCaixa([
      conta({ fornecedor: 'A', data_pagamento: null }),
      conta({ fornecedor: 'B', data_pagamento: '2026-08-06' }),
      conta({ fornecedor: 'C', data_pagamento: null }),
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

// ─── Ordenação ────────────────────────────────────────────────────────────────

// Testada DIRETO, e não através de `linhasLivroCaixa`: por lá, o `.filter()` de
// `contasExportaveis` já entrega um array novo, então um teste de "não mutou"
// feito de fora passa mesmo se a cópia sumir. O Apolo provou com mutante
// sobrevivente (achado 4 da 2ª rodada) — o assert de baixo é o que tem guarda.
describe('ordenarPorData', () => {
  it('não altera o array recebido', () => {
    const lista = [
      conta({ fornecedor: 'A', data_pagamento: '2026-08-20' }),
      conta({ fornecedor: 'B', data_pagamento: '2026-08-06' }),
    ]
    const saida = ordenarPorData(lista)
    expect(lista.map(c => c.fornecedor)).toEqual(['A', 'B'])
    expect(saida.map(c => c.fornecedor)).toEqual(['B', 'A'])
    expect(saida).not.toBe(lista)
  })

  it('põe as sem data no fim, na ordem em que chegaram', () => {
    const saida = ordenarPorData([
      conta({ fornecedor: 'A', data_pagamento: null }),
      conta({ fornecedor: 'B', data_pagamento: '2026-08-06' }),
      conta({ fornecedor: 'C', data_pagamento: null }),
    ])
    expect(saida.map(c => c.fornecedor)).toEqual(['B', 'A', 'C'])
  })

  it('ordena virada de mês e de ano pela string, sem Date', () => {
    const saida = ordenarPorData([
      conta({ fornecedor: 'A', data_pagamento: '2026-01-02' }),
      conta({ fornecedor: 'B', data_pagamento: '2025-12-31' }),
      conta({ fornecedor: 'C', data_pagamento: '2026-01-10' }),
    ])
    expect(saida.map(c => c.fornecedor)).toEqual(['B', 'A', 'C'])
  })
})
