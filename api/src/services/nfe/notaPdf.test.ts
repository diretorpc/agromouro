import { describe, it, expect } from 'vitest'
import { SCHEMA, validarNotaLida, converterParaNFeData } from './notaPdf'

// A leitura em si (a chamada de IA) não dá para testar de mesa. O que dá — e o
// que decide se uma nota entra ou não no sistema — é a validação do que voltou.
// Ela é a única coisa entre uma leitura errada e estoque/gasto errados.

// ─── Invariante que só a API real cobraria ──────────────────────────────────
// Percorre o SCHEMA inteiro atrás da combinação que a API da Anthropic recusa:
// `enum` na mesma propriedade que `type` como ARRAY de tipos. Descoberto em
// runtime em 23/08/2026 no schema irmão (documentoPdf.ts) — a suíte inteira
// verde e TODA chamada real devolvendo HTTP 400, porque os testes mockam a IA.
function propriedadesQuebradas(no: any, caminho = 'SCHEMA'): string[] {
  if (!no || typeof no !== 'object') return []
  const achados: string[] = []
  if (Array.isArray(no.enum) && Array.isArray(no.type)) achados.push(caminho)
  for (const [chave, filho] of Object.entries(no)) {
    achados.push(...propriedadesQuebradas(filho, `${caminho}.${chave}`))
  }
  return achados
}

describe('SCHEMA — invariantes que só a API real cobraria', () => {
  it('nenhuma propriedade combina enum com type em array', () => {
    expect(propriedadesQuebradas(SCHEMA)).toEqual([])
  })
})

const HOJE = '2026-08-24'

function item(over: Record<string, unknown> = {}) {
  return {
    descricao: 'TEBURAZ 500 SC', quantidade: 5, unidade: 'L',
    valorUnitario: 880, valorTotal: 4400, ncm: '38089329', cfop: '5102',
    ...over,
  }
}

function lida(over: Record<string, unknown> = {}) {
  return {
    ehNotaFiscal: true, modelo: 'nfe', numero: '58717',
    emitenteNome: 'SOLOS SOLUCOES AGRICOLAS LTDA', emitenteCnpj: '04063805000135',
    dataEmissao: '2026-08-10', valorTotal: 4400, formaPagamento: '15',
    duplicatas: [{ numero: '001', vencimento: '2026-09-10', valor: 4400 }],
    itens: [item()],
    ...over,
  }
}

describe('validarNotaLida — aceita nota boa', () => {
  it('nota completa passa com os campos limpos', () => {
    const r = validarNotaLida(lida(), HOJE)
    expect(r.status).toBe('nota')
    if (r.status !== 'nota') return
    expect(r.nota.numero).toBe('58717')
    expect(r.nota.emitenteCnpj).toBe('04063805000135')
    expect(r.nota.itens).toHaveLength(1)
    expect(r.itensDescartados).toBe(0)
  })

  it('CNPJ com pontuacao vira so digitos', () => {
    const r = validarNotaLida(lida({ emitenteCnpj: '04.063.805/0001-35' }), HOJE)
    expect(r.status === 'nota' && r.nota.emitenteCnpj).toBe('04063805000135')
  })

  it('zero a esquerda do CNPJ nao se perde', () => {
    // O mesmo defeito que o parser de XML teve até 17/08/2026: CNPJ lido como
    // número perde o zero e o dado fiscal vai errado pro contador.
    const r = validarNotaLida(lida({ emitenteCnpj: '04063805000135' }), HOJE)
    expect(r.status === 'nota' && r.nota.emitenteCnpj.startsWith('0')).toBe(true)
  })

  it('CPF de produtor rural (11 digitos) e aceito', () => {
    const r = validarNotaLida(lida({ emitenteCnpj: '12345678901' }), HOJE)
    expect(r.status).toBe('nota')
  })

  it('numero com zeros de enfeite e pontuacao vira o MESMO texto que o XML gravaria', () => {
    // Isto NÃO é cosmético. O parser de XML lê <nNF> como número e grava
    // "58717"; se o caminho do PDF gravasse "000058717", a trava de
    // duplicidade (numero, cnpj, fazenda, modelo) veria DUAS notas diferentes
    // e o Make somaria estoque e gasto de novo quando o XML chegasse.
    const r = validarNotaLida(lida({ numero: 'Nº 000.058.717' }), HOJE)
    expect(r.status === 'nota' && r.nota.numero).toBe('58717')
  })

  it('numero que e so zeros e recusado — nao existe nota zero', () => {
    expect(validarNotaLida(lida({ numero: '0000' }), HOJE).status).toBe('sem-identidade')
  })

  it('quantidade tributavel espelha a comercial — o DANFE nao imprime qTrib', () => {
    const r = validarNotaLida(lida(), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].quantidadeTrib).toBe(5)
    expect(r.status === 'nota' && r.nota.itens[0].unidadeTrib).toBe('L')
  })

  it('emitente ilegivel nao derruba a nota — vira rotulo generico', () => {
    const r = validarNotaLida(lida({ emitenteNome: null }), HOJE)
    expect(r.status === 'nota' && r.nota.emitenteNome).toBe('Fornecedor não identificado')
  })
})

describe('validarNotaLida — recusa a nota inteira', () => {
  it('sem numero ou sem CNPJ legivel', () => {
    expect(validarNotaLida(lida({ numero: null }), HOJE).status).toBe('sem-identidade')
    expect(validarNotaLida(lida({ numero: '   ' }), HOJE).status).toBe('sem-identidade')
    expect(validarNotaLida(lida({ emitenteCnpj: null }), HOJE).status).toBe('sem-identidade')
  })

  it('numero sem nenhum digito e recusado', () => {
    expect(validarNotaLida(lida({ numero: 'ILEGIVEL' }), HOJE).status).toBe('sem-identidade')
  })

  it('CNPJ com quantidade de digitos que nao existe', () => {
    for (const cnpj of ['123', '0406380500013', '040638050001355', 'CNPJ ILEGIVEL']) {
      expect(validarNotaLida(lida({ emitenteCnpj: cnpj }), HOJE).status).toBe('sem-identidade')
    }
  })

  it('resposta vazia ou quebrada', () => {
    expect(validarNotaLida(null, HOJE).status).toBe('sem-identidade')
    expect(validarNotaLida({}, HOJE).status).toBe('sem-identidade')
  })

  it('data de emissao em formato errado, inexistente ou fora da janela', () => {
    // '10/08/2026' é como a data aparece IMPRESSA — se voltar assim, a
    // conversão falhou. '2026-02-31' passa no regex e não existe.
    for (const data of [null, '10/08/2026', '2026-8-10', '2026-02-31', '2126-08-10', '2019-01-01', '2026-12-31']) {
      const r = validarNotaLida(lida({ dataEmissao: data }), HOJE)
      expect(r.status === 'dados-invalidos' && r.campo).toBe('dataEmissao')
    }
  })

  it('valor total ilegivel, zero, negativo ou absurdo', () => {
    for (const valor of [null, 0, -10, 'R$ 4.400,00', NaN, Infinity, 9_000_000]) {
      const r = validarNotaLida(lida({ valorTotal: valor }), HOJE)
      expect(r.status === 'dados-invalidos' && r.campo).toBe('valorTotal')
    }
  })

  it('nota sem nenhum item aproveitavel', () => {
    // Nota sem item cairia em `todosSaoCompra` no processarNFe (o `every` de
    // lista vazia é true) e lançaria o valor cheio no Financeiro sem um único
    // item que justifique o gasto.
    expect(validarNotaLida(lida({ itens: [] }), HOJE).status).toBe('sem-itens')
    expect(validarNotaLida(lida({ itens: [item({ descricao: null })] }), HOJE).status).toBe('sem-itens')
  })
})

describe('validarNotaLida — descarta a linha, nunca a nota', () => {
  it('item sem descricao sai e e contado; os bons ficam', () => {
    const r = validarNotaLida(lida({ itens: [item(), item({ descricao: '  ' })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens).toHaveLength(1)
    expect(r.status === 'nota' && r.itensDescartados).toBe(1)
  })

  it('quantidade zero, negativa ou absurda derruba a linha', () => {
    for (const q of [null, 0, -3, 2_000_000_000, NaN]) {
      const r = validarNotaLida(lida({ itens: [item(), item({ quantidade: q })] }), HOJE)
      expect(r.status === 'nota' && r.itensDescartados).toBe(1)
    }
  })

  it('valor de item acima do teto derruba a linha', () => {
    const r = validarNotaLida(lida({ itens: [item(), item({ valorTotal: 3_000_000 })] }), HOJE)
    expect(r.status === 'nota' && r.itensDescartados).toBe(1)
  })

  it('valor unitario absurdo NAO derruba a linha — vira total ÷ quantidade', () => {
    // O que importa da linha é o valor TOTAL (é o que soma no Financeiro).
    // Perder a linha inteira por causa do unitário custaria mais.
    //
    // Antes virava ZERO, e o zero era fabricado AQUI, não lido da IA. O
    // `handleEdit` do Financeiro recalcula `valor_total = quantidade × unitário`
    // ao salvar, então o zero apagava o gasto no primeiro clique — achado
    // [alto] do Apolo, 4ª rodada (27/08/2026), medido.
    const r = validarNotaLida(lida({ itens: [item({ valorUnitario: 90_000_000 })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].valorUnitario).toBe(880)   // 4400 ÷ 5
    expect(r.status === 'nota' && r.itensDescartados).toBe(0)
  })

  it('CFOP e NCM fora do formato viram vazio, e a linha sobrevive', () => {
    const r = validarNotaLida(lida({ itens: [item({ cfop: '510', ncm: '3808932' })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].cfop).toBe('')
    expect(r.status === 'nota' && r.nota.itens[0].ncm).toBe('')
    expect(r.status === 'nota' && r.itensDescartados).toBe(0)
  })

  it('CFOP com pontuacao ainda e aproveitado', () => {
    const r = validarNotaLida(lida({ itens: [item({ cfop: '5.102' })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].cfop).toBe('5102')
  })

  it('5000 itens alucinados: corta em 200 e CONTA o excedente', () => {
    const r = validarNotaLida(lida({ itens: Array.from({ length: 5000 }, () => item()) }), HOJE)
    expect(r.status === 'nota' && r.nota.itens).toHaveLength(200)
    expect(r.status === 'nota' && r.itensDescartados).toBe(4800)
  })

  it('duplicata com vencimento ilegivel entra com vencimento nulo, e nao e descartada', () => {
    // Caso ERCAL, medido em 31/07/2026: fornecedor que não preenche a data.
    // A duplicata NÃO pode sumir — duplicataEhReal já sabe tratar vencimento
    // nulo, e sumi-la esconderia uma cobrança real.
    const r = validarNotaLida(lida({ duplicatas: [{ numero: '001', vencimento: 'a combinar', valor: 4400 }] }), HOJE)
    expect(r.status === 'nota' && r.nota.duplicatas).toHaveLength(1)
    expect(r.status === 'nota' && r.nota.duplicatas[0].vencimento).toBeNull()
    expect(r.status === 'nota' && r.duplicatasDescartadas).toBe(0)
  })

  it('vencimento de 3 anos a frente vira nulo — digito errado, nao boleto', () => {
    const r = validarNotaLida(lida({ duplicatas: [{ numero: '001', vencimento: '2029-09-10', valor: 4400 }] }), HOJE)
    expect(r.status === 'nota' && r.nota.duplicatas[0].vencimento).toBeNull()
  })

  it('vencimento de 1 ano a frente CONTINUA valido — contrato de adubo', () => {
    const r = validarNotaLida(lida({ duplicatas: [{ numero: '001', vencimento: '2027-04-20', valor: 4400 }] }), HOJE)
    expect(r.status === 'nota' && r.nota.duplicatas[0].vencimento).toBe('2027-04-20')
  })

  it('duplicatas acima do teto sao cortadas e contadas', () => {
    const muitas = Array.from({ length: 40 }, (_, n) => ({ numero: String(n), vencimento: '2026-09-10', valor: 100 }))
    const r = validarNotaLida(lida({ duplicatas: muitas }), HOJE)
    expect(r.status === 'nota' && r.nota.duplicatas).toHaveLength(24)
    expect(r.status === 'nota' && r.duplicatasDescartadas).toBe(16)
  })

  it('nota sem quadro de cobranca vira lista vazia, sem reclamar', () => {
    const r = validarNotaLida(lida({ duplicatas: [] }), HOJE)
    expect(r.status === 'nota' && r.nota.duplicatas).toEqual([])
  })
})

describe('validarNotaLida — forma de pagamento sai no MESMO formato do XML', () => {
  // Achado [alto] do Apolo (24/08/2026): motivoSemBoletoDaNota e
  // motivoVencidoPelaDuplicata comparam tPag com dois dígitos. Um '3' cru, ou a
  // descrição impressa no DANFE, nao casa com nada — e a nota de cartao COM
  // duplicata perde o aviso "Conferir antes de pagar" nos tres lugares onde ele
  // deveria aparecer.
  it('um digito NAO ganha zero da frente e vira null — e o valor de indPag "A PRAZO" no papel', () => {
    // Achado [médio] do Apolo, 3ª rodada (24/08/2026), medido: o DANFE imprime
    // `indPag` com UM dígito no quadro de fatura ('1' = A PRAZO — a nota que
    // TEM boleto). Um padStart aqui transformaria '1' em '01' = "dinheiro à
    // vista", exatamente o oposto do que o papel diz, calando o aviso na nota
    // que mais precisa dele. Perder um código de 1 dígito custa um boleto A
    // MAIS (o dono dispensa num toque, lado seguro); aceitá-lo sem saber se é
    // tPag ou indPag custaria um boleto A MENOS — o erro caro.
    const r = validarNotaLida(lida({ formaPagamento: '3' }), HOJE)
    expect(r.status === 'nota' && r.nota.formaPagamento).toBeNull()
  })

  it('dois digitos passam intactos', () => {
    for (const [entrada, esperado] of [['03', '03'], ['15', '15'], ['90', '90']]) {
      const r = validarNotaLida(lida({ formaPagamento: entrada }), HOJE)
      expect(r.status === 'nota' && r.nota.formaPagamento).toBe(esperado)
    }
  })

  it('codigo com descricao junto vira null — nao ARRISCA achar o digito certo na frase', () => {
    // Achado [crítico] do Apolo em 24/08/2026: a versão anterior catava dígito
    // de dentro de frase (`.replace(/\D/g,'')`), e "1 - A prazo" virava '01'
    // (dinheiro à vista) — com duplicata na nota, o sistema dispensava um
    // boleto real. Frase inteira nunca é o código puro: null é "não li".
    const r = validarNotaLida(lida({ formaPagamento: '03 - Cartao de Credito' }), HOJE)
    expect(r.status === 'nota' && r.nota.formaPagamento).toBeNull()
  })

  it('descricao sem digito nenhum vira null, nao string que finge ser codigo', () => {
    for (const entrada of ['Boleto Bancario', 'Dinheiro', '', null]) {
      const r = validarNotaLida(lida({ formaPagamento: entrada }), HOJE)
      expect(r.status === 'nota' && r.nota.formaPagamento).toBeNull()
    }
  })

  it('numero com digitos demais vira null — nao existe tPag de 3 digitos', () => {
    const r = validarNotaLida(lida({ formaPagamento: '1503' }), HOJE)
    expect(r.status === 'nota' && r.nota.formaPagamento).toBeNull()
  })

  it('frase com numero de dias NUNCA e o codigo — "90 dias" nao e tPag 90', () => {
    // Caso medido do achado crítico: "90 dias" catava '90' (= "sem
    // pagamento") e a nota ficava SEM conta a pagar. "1 - A prazo" catava
    // '01' (= dinheiro) e, havendo duplicata, o sistema dispensava um boleto
    // real. Nenhuma frase deve virar código — só o código puro.
    for (const entrada of ['90 dias', 'PRAZO 90 DIAS', '1 - A prazo', 'a vista 5 dias', 'Cartao 3x', 'Cond. pag: 05']) {
      const r = validarNotaLida(lida({ formaPagamento: entrada }), HOJE)
      expect(r.status === 'nota' && r.nota.formaPagamento).toBeNull()
    }
  })

  it('codigo que nao existe na tabela tPag vira null', () => {
    for (const entrada of ['07', '55']) {
      const r = validarNotaLida(lida({ formaPagamento: entrada }), HOJE)
      expect(r.status === 'nota' && r.nota.formaPagamento).toBeNull()
    }
  })

  it('codigos validos de dois digitos da tabela continuam passando', () => {
    for (const [entrada, esperado] of [['03', '03'], ['15', '15'], ['90', '90']]) {
      const r = validarNotaLida(lida({ formaPagamento: entrada }), HOJE)
      expect(r.status === 'nota' && r.nota.formaPagamento).toBe(esperado)
    }
  })
})

describe('validarNotaLida — formaPagamentoLido guarda o texto cru, para a tela', () => {
  // Achado [alto] do Apolo, 3ª rodada (24/08/2026): quando tPagNormalizado
  // recusa o texto ("03 - Cartao de Credito" não é código puro) e
  // formaPagamento vira null, a tela de conferência não tinha como mostrar ao
  // dono O QUE sumiu — a conta nascia sem a tarja "Conferir antes de pagar" e
  // sem explicação nenhuma. formaPagamentoLido preserva o texto que a IA leu,
  // ANTES da normalização, só para a tela.
  it('guarda o texto cru mesmo quando formaPagamento normalizado vira null', () => {
    const r = validarNotaLida(lida({ formaPagamento: '03 - Cartao de Credito' }), HOJE)
    expect(r.status === 'nota' && r.nota.formaPagamento).toBeNull()
    expect(r.status === 'nota' && r.nota.formaPagamentoLido).toBe('03 - Cartao de Credito')
  })

  it('guarda o texto cru mesmo quando formaPagamento normalizado passa (dois digitos validos)', () => {
    const r = validarNotaLida(lida({ formaPagamento: '15' }), HOJE)
    expect(r.status === 'nota' && r.nota.formaPagamento).toBe('15')
    expect(r.status === 'nota' && r.nota.formaPagamentoLido).toBe('15')
  })

  it('e null quando o campo nao veio', () => {
    for (const entrada of [null, '', '   ']) {
      const r = validarNotaLida(lida({ formaPagamento: entrada }), HOJE)
      expect(r.status === 'nota' && r.nota.formaPagamentoLido).toBeNull()
    }
  })
})

describe('validarNotaLida — centro de custo é escolha do dono, não leitura do papel', () => {
  it('sem escolha, fica vazio: o sistema decide como sempre decidiu', () => {
    const r = validarNotaLida(lida(), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].centroCusto).toBe('')
  })

  it('escolha do dono sobrevive à validacao', () => {
    const r = validarNotaLida(lida({ itens: [item({ centroCusto: 'manutencao' })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].centroCusto).toBe('manutencao')
  })

  it('texto arbitrario vindo do navegador e cortado, nao recusado', () => {
    // A coluna e texto livre de proposito (o dropdown mistura categoria
    // agricola com categoria de cartao). Cortar evita entrada gigante; recusar
    // recriaria o bug de "nao salva em silencio".
    const r = validarNotaLida(lida({ itens: [item({ centroCusto: 'x'.repeat(200) })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].centroCusto.length).toBe(40)
  })

  it('centro de custo vazio NAO viaja pro NFeData — a coluna fica nula', () => {
    const r = validarNotaLida(lida(), HOJE)
    if (r.status !== 'nota') throw new Error('fixture deveria validar')
    expect(converterParaNFeData(r.nota).items[0].centroCusto).toBeUndefined()
  })

  it('centro de custo escolhido chega no NFeData que processarNFe grava', () => {
    const r = validarNotaLida(lida({ itens: [item({ centroCusto: 'manutencao' })] }), HOJE)
    if (r.status !== 'nota') throw new Error('fixture deveria validar')
    expect(converterParaNFeData(r.nota).items[0].centroCusto).toBe('manutencao')
  })
})

describe('converterParaNFeData', () => {
  it('NFS-e marca servico:true em todo item — servico nunca e estocavel', () => {
    const r = validarNotaLida(lida({ modelo: 'nfse' }), HOJE)
    if (r.status !== 'nota') throw new Error('fixture deveria validar')
    const nfe = converterParaNFeData(r.nota)
    expect(nfe.modelo).toBe('nfse')
    expect(nfe.items[0].servico).toBe(true)
  })

  it('NF-e de produto nao marca servico', () => {
    const r = validarNotaLida(lida(), HOJE)
    if (r.status !== 'nota') throw new Error('fixture deveria validar')
    expect(converterParaNFeData(r.nota).items[0].servico).toBeUndefined()
  })

  it('modelo desconhecido cai em nfe, nunca em nfse', () => {
    const r = validarNotaLida(lida({ modelo: 'PDF' }), HOJE)
    expect(r.status === 'nota' && r.nota.modelo).toBe('nfe')
  })

  it('formaPagamentoLido NAO vaza pro NFeData — e so pra tela, processarNFe nunca o consome', () => {
    const r = validarNotaLida(lida({ formaPagamento: '03 - Cartao de Credito' }), HOJE)
    if (r.status !== 'nota') throw new Error('fixture deveria validar')
    const nfe = converterParaNFeData(r.nota)
    expect(nfe).not.toHaveProperty('formaPagamentoLido')
  })

  it('campos vao pros nomes que processarNFe espera', () => {
    const r = validarNotaLida(lida(), HOJE)
    if (r.status !== 'nota') throw new Error('fixture deveria validar')
    const nfe = converterParaNFeData(r.nota)
    expect(nfe.numero).toBe('58717')
    expect(nfe.emitenteCnpj).toBe('04063805000135')
    expect(nfe.items[0].description).toBe('TEBURAZ 500 SC')
    expect(nfe.items[0].totalValue).toBe(4400)
    expect(nfe.items[0].quantityTrib).toBe(5)
    expect(nfe.duplicatas[0].vencimento).toBe('2026-09-10')
    expect(nfe.formaPagamento).toBe('15')
  })
})

// ─── NFS-e: o papel não tem coluna de quantidade ────────────────────────────
// Defeito medido em 27/08/2026 com nota real que o Matheus mandou: a NFS-e da
// MAQNELSON (licença de software, R$ 4.370) era recusada com 'sem-itens', e a
// tela dizia "Não consegui ler nenhum item desta nota" — mentira, a IA leu a
// nota INTEIRA. O JSON abaixo é a resposta CRUA da IA, copiada da execução
// real contra o PDF, não inventada para o teste.
//
// A causa: uma NFS-e não tem as colunas QUANT/UN/V.UNIT do DANFE — tem um
// parágrafo de "Discriminação dos Serviços" e um valor. A IA devolveu
// `quantidade: null` porque é o certo (não existe "quantidade" de licença), e
// o validador, escrito para DANFE, derrubou a única linha da nota.
//
// O caminho do XML já resolvia isto desde 17/08/2026: parseXmlNFSe
// (nfeProcessor.ts) monta o item com quantity 1, unit 'un' e unitValue =
// valorTotal. Estes testes prendem os DOIS caminhos na mesma régua.
const NFSE_MAQNELSON = {
  ehNotaFiscal: true,
  modelo: 'nfse',
  numero: '2080',
  emitenteNome: 'MAQNELSON AGRICOLA LTDA',
  emitenteCnpj: '07791111000960',
  dataEmissao: '2026-08-25',
  valorTotal: 4370.0,
  formaPagamento: null,
  duplicatas: [],
  itens: [{
    descricao: 'PEDIDO 11403553 - LICENCA MASTER 1.0 12 MESES 1NW4030MVMF210282 - IE 0011145440177 Licenciamento ou cessao de direito de uso de programas',
    quantidade: null, unidade: null, valorUnitario: null,
    valorTotal: 4370.0, ncm: null, cfop: null,
  }],
}

describe('validarNotaLida — NFS-e não tem coluna de quantidade', () => {
  it('a NFS-e real da MAQNELSON entra, em vez de virar "sem-itens"', () => {
    const r = validarNotaLida(NFSE_MAQNELSON, HOJE)
    expect(r.status).toBe('nota')
    if (r.status !== 'nota') return
    expect(r.nota.modelo).toBe('nfse')
    expect(r.nota.numero).toBe('2080')
    expect(r.nota.valorTotal).toBe(4370)
    expect(r.nota.itens).toHaveLength(1)
    expect(r.itensDescartados).toBe(0)
  })

  it('quantidade que o papel não traz fica NULL — o "1" não é guardado', () => {
    // Fail-closed: enquanto o número não existir em lugar nenhum, ninguém pode
    // perdê-lo no caminho e acabar com quantidade inventada no estoque.
    const r = validarNotaLida(NFSE_MAQNELSON, HOJE)
    if (r.status !== 'nota') throw new Error(`esperava nota, veio ${r.status}`)
    const i = r.nota.itens[0]
    expect(i.quantidade).toBeNull()
    expect(i.quantidadeTrib).toBeNull()
    expect(i.unidade).toBe('un')
    expect(i.unidadeTrib).toBe('un')
    // O unitário SIM é resolvido aqui: com quantidade 1, ele é o total da linha.
    expect(i.valorUnitario).toBe(4370)
  })

  it('quantidade IMPRESSA numa NFS-e é preservada, nunca sobrescrita por 1', () => {
    // Prestador que discrimina "3 x hora técnica" tem quantidade legível no
    // papel. Copiar o que está impresso vence inventar — mesma doutrina do CFOP.
    const r = validarNotaLida(
      { ...NFSE_MAQNELSON, itens: [{ ...NFSE_MAQNELSON.itens[0], quantidade: 3, unidade: 'H', valorUnitario: 1456.67 }] },
      HOJE,
    )
    if (r.status !== 'nota') throw new Error(`esperava nota, veio ${r.status}`)
    expect(r.nota.itens[0].quantidade).toBe(3)
    expect(r.nota.itens[0].unidade).toBe('H')
    expect(r.nota.itens[0].valorUnitario).toBe(1456.67)
  })

  it('numa DANFE, quantidade ilegível CONTINUA derrubando a linha', () => {
    // A trava do ESTOQUE não afrouxou. Aqui a quantidade é o que entra no
    // galpão: inventar 1 tiraria mercadoria real do controle, calado. A folga
    // vale só onde a coluna não existe no papel.
    for (const q of [null, 0, -3, NaN]) {
      const r = validarNotaLida(lida({ modelo: 'nfe', itens: [item(), item({ quantidade: q })] }), HOJE)
      expect(r.status === 'nota' && r.itensDescartados).toBe(1)
    }
  })

  it('modelo desconhecido é tratado como DANFE, e a linha sem quantidade cai', () => {
    // Mesma doutrina de converterParaNFeData: quem não é 'nfse' é 'nfe'.
    const r = validarNotaLida({ ...NFSE_MAQNELSON, modelo: 'sei-la' }, HOJE)
    expect(r.status).toBe('sem-itens')
  })

  it('NFS-e sem descrição continua sendo descartada — não inventamos linha', () => {
    // O conserto dá folga na QUANTIDADE, que o papel não traz. Não dá folga em
    // descrição nem em valor: sem eles a linha é leitura falhada, e um gasto
    // fantasma no Financeiro custa mais que uma recusa.
    for (const item of [{ descricao: '   ' }, { valorTotal: null }]) {
      const r = validarNotaLida(
        { ...NFSE_MAQNELSON, itens: [{ ...NFSE_MAQNELSON.itens[0], ...item }] },
        HOJE,
      )
      expect(r.status).toBe('sem-itens')
    }
  })

  it('converterParaNFeData entrega a NFS-e no MESMO formato do parseXmlNFSe', () => {
    const r = validarNotaLida(NFSE_MAQNELSON, HOJE)
    if (r.status !== 'nota') throw new Error(`esperava nota, veio ${r.status}`)
    const nfe = converterParaNFeData(r.nota)
    expect(nfe.modelo).toBe('nfse')
    expect(nfe.items).toHaveLength(1)
    expect(nfe.items[0].servico).toBe(true)   // serviço nunca é estocável
    expect(nfe.items[0].quantity).toBe(1)     // o "1" nasce AQUI, não no validador
    expect(nfe.items[0].quantityTrib).toBe(1)
    expect(nfe.items[0].unit).toBe('un')
    expect(nfe.items[0].unitValue).toBe(4370)
    expect(nfe.items[0].totalValue).toBe(4370)
    expect(nfe.items[0].ncm).toBe('')
    expect(nfe.items[0].cfop).toBe('')
  })
})

// ─── Passo 2: o que volta do navegador ──────────────────────────────────────
// `validarNotaLida` roda DUAS vezes no fluxo real — na leitura e de novo em
// POST /nfe/importar-pdf, quando o dono confirma o que editou na tela. Achado
// [médio] do Apolo (27/08/2026): os testes acima só alimentam dado CRU de IA;
// nenhum devolvia a saída do passo 1 na entrada do passo 2, que é o formato que
// o navegador realmente manda — e é por esse buraco que passava o achado [alto]
// da quantidade inferida virando estoque.
describe('validarNotaLida — passo 2: a nota que volta do navegador', () => {
  // O envelope que a tela manda: a nota do passo 1, possivelmente editada.
  function idaEVolta(cru: unknown, editado: Record<string, unknown> = {}) {
    const r1 = validarNotaLida(cru, HOJE)
    if (r1.status !== 'nota') throw new Error(`passo 1 já falhou: ${r1.status}`)
    return validarNotaLida({ ehNotaFiscal: true, ...r1.nota, ...editado }, HOJE)
  }

  it('NFS-e confirmada sem edição entra igual — mesma régua nos dois passos', () => {
    const r = idaEVolta(NFSE_MAQNELSON)
    expect(r.status).toBe('nota')
    if (r.status !== 'nota') return
    expect(r.nota.itens[0].quantidade).toBeNull()
    expect(r.itensDescartados).toBe(0)
  })

  it('dono corrige o Tipo para NF-e: a quantidade inferida NÃO vira estoque', () => {
    // O cenário caro: a IA rotula um DANFE como 'nfse', a linha ganha
    // quantidade 1, e o dono corrige o campo "Tipo" — que é exatamente o que o
    // banner de duplicidade da tela manda ele conferir. Sem esta trava, "1 TON
    // a R$ 6.000" entrava no galpão no lugar de "3 TON a R$ 2.000", calado.
    const r = idaEVolta(NFSE_MAQNELSON, { modelo: 'nfe' })
    expect(r.status).toBe('sem-itens')
  })

  it('o aviso da tela reacende: a linha inferida cai e é CONTADA em itensDescartados', () => {
    // Antes desta trava a linha entrava e `itensDescartados` valia 0 — o dono
    // perdia o aviso "N item(ns) não puderam ser lidos", que é pior que o
    // defeito original, porque o original gritava.
    const misto = {
      ...NFSE_MAQNELSON,
      itens: [
        { descricao: 'UREIA 45%', quantidade: 3, unidade: 'TON', valorUnitario: 2000, valorTotal: 6000, ncm: '31021000', cfop: '5102' },
        { ...NFSE_MAQNELSON.itens[0] },
      ],
      valorTotal: 10370,
    }
    const r = idaEVolta(misto, { modelo: 'nfe' })
    expect(r.status).toBe('nota')
    if (r.status !== 'nota') return
    expect(r.nota.itens).toHaveLength(1)
    expect(r.nota.itens[0].descricao).toBe('UREIA 45%')
    expect(r.nota.itens[0].quantidade).toBe(3)
    expect(r.itensDescartados).toBe(1)
  })

  it('item de DANFE lido de verdade sobrevive à ida e volta, sem marca nenhuma', () => {
    const r = idaEVolta(lida())
    expect(r.status === 'nota' && r.nota.itens[0].quantidade).toBe(5)
    expect(r.status === 'nota' && r.itensDescartados).toBe(0)
  })
})

describe('validarNotaLida — unitário do serviço inferido', () => {
  // A INVARIANTE que o Financeiro cobra: sem quantidade impressa, a linha vale
  // `1 × unitário = total`. `parseXmlNFSe` garante isso por construção
  // (`unitValue: valorTotal`); aqui tem que ser garantido na mão.
  //
  // Achado [alto] do Apolo, 3ª rodada (27/08/2026), executado ponta a ponta: a
  // versão anterior preservava o unitário LIDO, gravando `{q: 1, vu: 200,
  // vt: 600}` — e `handleEdit` do Financeiro RECALCULA
  // `valor_total = quantidade × valor_unitario` ao salvar. Abrir o item só para
  // trocar o centro de custo derrubava o gasto de R$ 600 para R$ 200.
  it('sem quantidade impressa, unitário SEMPRE vira o total — mesmo se a IA leu um', () => {
    for (const unitario of [200, 0, null, 90_000_000]) {
      const r = validarNotaLida(
        { ...NFSE_MAQNELSON, itens: [{ ...NFSE_MAQNELSON.itens[0], valorUnitario: unitario }] },
        HOJE,
      )
      if (r.status !== 'nota') throw new Error(`esperava nota, veio ${r.status}`)
      const i = r.nota.itens[0]
      expect(i.quantidade).toBeNull()
      expect(i.valorUnitario).toBe(i.valorTotal)   // a invariante
    }
  })

  it('a invariante sobrevive à conversão: quantity 1 × unitValue === totalValue', () => {
    const r = validarNotaLida(
      { ...NFSE_MAQNELSON, itens: [{ ...NFSE_MAQNELSON.itens[0], valorUnitario: 200 }] },
      HOJE,
    )
    if (r.status !== 'nota') throw new Error(`esperava nota, veio ${r.status}`)
    const it0 = converterParaNFeData(r.nota).items[0]
    expect(it0.quantity * it0.unitValue).toBe(it0.totalValue)
  })

  it('a invariante vale para TODA linha, DANFE inclusive — nunca unitário fabricado como 0', () => {
    // `quantidade × unitário === total` em qualquer nota, para que o recálculo
    // do Financeiro nunca encolha um gasto.
    for (const unitario of [null, 0, 90_000_000, 'nada']) {
      const r = validarNotaLida(lida({ itens: [item({ valorUnitario: unitario })] }), HOJE)
      if (r.status !== 'nota') throw new Error(`esperava nota, veio ${r.status}`)
      const i = r.nota.itens[0]
      expect(i.quantidade! * i.valorUnitario).toBeCloseTo(i.valorTotal, 6)
    }
  })

  it('unitário 0 com total 0 é preservado — linha de bonificação existe de verdade', () => {
    const r = validarNotaLida(lida({ itens: [item({ valorUnitario: 0, valorTotal: 0 })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].valorUnitario).toBe(0)
    expect(r.status === 'nota' && r.itensDescartados).toBe(0)
  })
})

describe('converterParaNFeData — NFS-e sai sem CFOP e sem NCM, como o XML', () => {
  // Achado [alto] do Apolo (27/08/2026), medido: `servico: true` protege o
  // ESTOQUE, não o DINHEIRO. processarNFe roda efeitoDoCfop em TODOS os itens
  // sem olhar `servico` — um CFOP alucinado numa nota de serviço zerava o
  // `valorCompra` e a nota gravava SEM lançamento: o gasto evaporava calado.
  const comCodigo = {
    ...NFSE_MAQNELSON,
    itens: [{ ...NFSE_MAQNELSON.itens[0], cfop: '5910', ncm: '38089329' }],
  }

  it('CFOP alucinado numa NFS-e não chega em processarNFe', () => {
    const r = validarNotaLida(comCodigo, HOJE)
    if (r.status !== 'nota') throw new Error(`esperava nota, veio ${r.status}`)
    // A EVIDÊNCIA fica: a tela precisa dela para avisar que o Tipo pode estar
    // errado. O que não pode é o código ter EFEITO.
    expect(r.nota.itens[0].cfop).toBe('5910')
    expect(r.nota.itens[0].ncm).toBe('38089329')

    const nfe = converterParaNFeData(r.nota)
    expect(nfe.items[0].cfop).toBe('')
    expect(nfe.items[0].ncm).toBe('')
  })

  it('a MESMA nota marcada como NF-e mantém os códigos — a régua do DANFE não mexeu', () => {
    const r = validarNotaLida({ ...comCodigo, modelo: 'nfe', itens: [{ ...comCodigo.itens[0], quantidade: 2 }] }, HOJE)
    if (r.status !== 'nota') throw new Error(`esperava nota, veio ${r.status}`)
    const nfe = converterParaNFeData(r.nota)
    expect(nfe.items[0].cfop).toBe('5910')
    expect(nfe.items[0].ncm).toBe('38089329')
    expect(nfe.items[0].servico).toBeUndefined()
  })
})

describe('validarNotaLida — a invariante quantidade × unitário === total', () => {
  // A tela Financeiro RECALCULA `valor_total = quantidade × valor_unitario` ao
  // salvar um item. Toda linha que sai daqui violando a invariante é um gasto
  // que muda sozinho no primeiro clique — inclusive num clique que só queria
  // trocar o centro de custo. Três rodadas do Apolo para acertar a régua:
  // preservar o unitário lido (2ª), fabricar 0 (4ª), aceitar qualquer positivo
  // (5ª). A régua certa é CONSISTÊNCIA com o total, não o sinal.

  it('unitário positivo mas INCONSISTENTE é derivado do total', () => {
    // {q:3, vu:200, vt:6000}: passava por ser positivo, e o Financeiro derrubava
    // R$ 6.000 para R$ 600.
    const r = validarNotaLida(lida({ itens: [item({ quantidade: 3, valorUnitario: 200, valorTotal: 6000 })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].valorUnitario).toBe(2000)
  })

  it('unitário positivo contra total ZERO também é derivado — gasto fantasma', () => {
    // {q:5, vu:880, vt:0}: passava pela cláusula que protegia a bonificação, e o
    // Financeiro criava R$ 4.400 do nada.
    const r = validarNotaLida(lida({ itens: [item({ quantidade: 5, valorUnitario: 880, valorTotal: 0 })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].valorUnitario).toBe(0)
  })

  it('unitário CONSISTENTE é preservado como impresso', () => {
    const r = validarNotaLida(lida({ itens: [item({ quantidade: 3, valorUnitario: 2000, valorTotal: 6000 })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].valorUnitario).toBe(2000)
  })

  it('arredondamento honesto da nota impressa NÃO é reescrito', () => {
    // 3 × 33,33 = 99,99 contra total 100,00. Diferença de 1 centavo: é como a
    // nota foi impressa, e reescrever perderia fidelidade sem ganhar nada.
    const r = validarNotaLida(lida({ itens: [item({ quantidade: 3, valorUnitario: 33.33, valorTotal: 100 })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].valorUnitario).toBe(33.33)
  })

  it('a tolerância acompanha o tamanho da nota (0,1%), não é 2 centavos fixos', () => {
    // 46.000 KG × 2,9783 = 137.001,80 contra total 137.000: R$ 1,80 de deriva
    // em nota grande é arredondamento, não erro de leitura.
    const r = validarNotaLida(lida({ itens: [item({ quantidade: 46000, valorUnitario: 2.9783, valorTotal: 137000 })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens[0].valorUnitario).toBe(2.9783)
  })

  it('unitário derivado que estoura o teto DERRUBA a linha, e ela é contada', () => {
    // {q: 0.001, vt: 2.000.000} deriva 2 bilhões — acima do numeric(12,4) da
    // coluna. Gravar mataria o INSERT e levaria a NOTA INTEIRA junto.
    const r = validarNotaLida(lida({ itens: [item(), item({ quantidade: 0.001, valorUnitario: null, valorTotal: 2_000_000 })] }), HOJE)
    expect(r.status === 'nota' && r.nota.itens).toHaveLength(1)
    expect(r.status === 'nota' && r.itensDescartados).toBe(1)
  })
})
