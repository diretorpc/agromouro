import { describe, it, expect } from 'vitest'
import { contasDaNota, motivoSemBoleto, parcelasDescartadasDaNota, type DadosParaConta } from './deNotaFiscal'

const base: DadosParaConta = {
  numero:         '4516',
  emitenteNome:   'TRIANGULO DIESEL TRR LTDA',
  dataEmissao:    '2026-07-14T18:15:00-03:00',
  valorTotal:     30600,
  formaPagamento: '15',
  duplicatas:     [{ numero: '001', vencimento: '2026-07-21', valor: 30600 }],
  items:          [{ descricao: 'DIESEL S10' }],
}

describe('motivoSemBoleto', () => {
  it('cartao de credito nao gera boleto', () => {
    expect(motivoSemBoleto('03')).toBe('a nota diz cartão de crédito')
  })
  it('credito loja nao gera boleto', () => {
    expect(motivoSemBoleto('05')).toBe('a nota diz crédito da loja')
  })
  it('dinheiro nao gera boleto', () => {
    expect(motivoSemBoleto('01')).toBe('a nota diz pagamento em dinheiro')
  })
  it('boleto gera', () => {
    expect(motivoSemBoleto('15')).toBeNull()
  })
  it('forma desconhecida gera — na duvida, cria a conta', () => {
    expect(motivoSemBoleto('99')).toBeNull()
  })
  it('sem forma informada gera — ausencia nao e recusa', () => {
    expect(motivoSemBoleto(null)).toBeNull()
  })
  it('90 (sem pagamento) NAO gera boleto', () => {
    expect(motivoSemBoleto('90')).toBe('a nota diz que não há pagamento')
  })
  it('17 (PIX) nao gera boleto', () => {
    expect(motivoSemBoleto('17')).toBe('a nota diz PIX')
  })
  it('18 (transferencia/carteira digital) nao gera boleto', () => {
    expect(motivoSemBoleto('18')).toBe('a nota diz transferência bancária ou carteira digital')
  })
  it('20 (PIX estatico) nao gera boleto', () => {
    expect(motivoSemBoleto('20')).toBe('a nota diz PIX')
  })
  // '16' (depósito bancário), '19' (cashback/crédito virtual) e '21' (crédito
  // em loja) foram avaliados e propositalmente NÃO entraram em MOTIVO_SEM_BOLETO
  // — ver comentário em deNotaFiscal.ts. Por não estarem mapeados, caem no
  // caminho padrão: "na dúvida, GERA".
  it('16/19/21 nao estao mapeados — seguem o padrao "na duvida, gera"', () => {
    expect(motivoSemBoleto('16')).toBeNull()
    expect(motivoSemBoleto('19')).toBeNull()
    expect(motivoSemBoleto('21')).toBeNull()
  })
})

describe('contasDaNota — nota de entrega futura (tPag 90)', () => {
  it('tPag 90 e sem duplicata: nao gera conta nenhuma (caso real SYAGRI 62402)', () => {
    const r = contasDaNota({ ...base, formaPagamento: '90', duplicatas: [] })
    expect(r).toEqual([])
  })

  it('tPag 90 MAS com duplicata: o boleto e real e a conta nasce (revenda que cobra na remessa)', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '90',
      duplicatas: [{ numero: '001', vencimento: '2026-09-15', valor: 5000 }],
    })
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBe('2026-09-15')
  })

  it('REGRESSAO (achada pelo Apolo, 06/08/2026): tPag 90 com duplicata SEM data mas COM valor DEVE gerar a conta, com vencimento null', () => {
    // <dup><nDup>1</nDup><vDup>5000.00</vDup></dup> sem <dVenc> — duplicata real,
    // so sem data. Exigir vencimento (criterio anterior) fazia isso convergir com
    // duplicata vazia e a nota inteira sumir: R$ 5.000 sem virar boleto e sem
    // nenhuma linha na mensagem do WhatsApp avisando.
    const r = contasDaNota({
      ...base, formaPagamento: '90',
      duplicatas: [{ numero: '001', vencimento: null, valor: 5000 }],
    })
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBeNull()
    expect(r[0].valor).toBe(5000)
  })

  it('regressao do cartao: tPag 05 com duplicata continua sem gerar conta (METAL AGRICOLA 51843)', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '05',
      duplicatas: [{ numero: '001', vencimento: '2026-08-01', valor: 355 }],
    })
    expect(r).toEqual([])
  })

  it('regressao do cartao: tPag 03 com duplicata continua sem gerar conta', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '03',
      duplicatas: [{ numero: '001', vencimento: '2026-08-01', valor: 355 }],
    })
    expect(r).toEqual([])
  })

  // '16'/'19'/'21' não estão mapeados em MOTIVO_SEM_BOLETO (decisão registrada
  // em deNotaFiscal.ts, 06/08/2026) — então, com ou sem duplicata, seguem o
  // caminho padrão desta função: código desconhecido = "na dúvida, GERA".
  it('tPag 16/19/21 SEM duplicata: gera conta pelo valor total (caminho padrao, igual a um tPag qualquer nao mapeado)', () => {
    for (const tPag of ['16', '19', '21']) {
      const r = contasDaNota({ ...base, formaPagamento: tPag, duplicatas: [] })
      expect(r).toHaveLength(1)
      expect(r[0].valor).toBe(base.valorTotal)
    }
  })

  it('tPag 16/19/21 COM duplicata: gera conta a partir da duplicata (caminho padrao)', () => {
    for (const tPag of ['16', '19', '21']) {
      const r = contasDaNota({
        ...base, formaPagamento: tPag,
        duplicatas: [{ numero: '001', vencimento: '2026-09-15', valor: 5000 }],
      })
      expect(r).toHaveLength(1)
      expect(r[0].vencimento).toBe('2026-09-15')
      expect(r[0].valor).toBe(5000)
    }
  })

  it('dinheiro (01) nao cede a duplicata: mesmo com vencimento futuro real, nao gera conta', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '01',
      duplicatas: [{ numero: '001', vencimento: '2026-08-01', valor: 355 }],
    })
    expect(r).toEqual([])
  })

  it('cartao de debito (04) nao cede a duplicata: mesmo com vencimento futuro real, nao gera conta', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '04',
      duplicatas: [{ numero: '001', vencimento: '2026-08-01', valor: 355 }],
    })
    expect(r).toEqual([])
  })
})

describe('contasDaNota — PIX/transferencia (tPag 17/18/20) cedem a duplicata igual ao 90', () => {
  it('caso real USINA UBERABA S/A nota 16246: tPag 18, R$ 88.939,27, SEM duplicata: nao gera conta', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '18', valorTotal: 88939.27, duplicatas: [],
    })
    expect(r).toEqual([])
  })

  it('REGRESSAO (achada pelo Apolo): tPag 18 COM duplicata de vencimento futuro DEVE gerar a conta', () => {
    // tPag descreve o MEIO (transferência), nao o MOMENTO: a compra pode ter sido
    // combinada com entrada e saldo a prazo. Perder este boleto e o bug que motivou
    // a correcao inteira.
    const r = contasDaNota({
      ...base, formaPagamento: '18',
      duplicatas: [{ numero: '001', vencimento: '2026-11-15', valor: 88939.27 }],
    })
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBe('2026-11-15')
    expect(r[0].valor).toBe(88939.27)
  })

  it('tPag 17 (PIX dinamico) COM duplicata tambem gera a conta', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '17',
      duplicatas: [{ numero: '001', vencimento: '2026-11-15', valor: 68939.27 }],
    })
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBe('2026-11-15')
  })

  it('tPag 20 (PIX estatico) COM duplicata tambem gera a conta', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '20',
      duplicatas: [{ numero: '001', vencimento: '2026-11-15', valor: 1000 }],
    })
    expect(r).toHaveLength(1)
  })

  it('tPag 17 sem duplicata: nao gera conta', () => {
    expect(contasDaNota({ ...base, formaPagamento: '17', duplicatas: [] })).toEqual([])
  })

  it('tPag 18 com duplicata VAZIA (numero preenchido, sem vencimento nem valor — <dup> so com numero no XML): nao gera conta, igual a sem duplicata nenhuma (caso USINA UBERABA)', () => {
    const r = contasDaNota({
      ...base, formaPagamento: '18',
      duplicatas: [{ numero: '001', vencimento: null, valor: null }],
    })
    expect(r).toEqual([])
  })
})

describe('parcelasDescartadasDaNota — tPag 90 concorda com contasDaNota', () => {
  it('tPag 90 com duplicata malformada: reporta a parcela descartada (nao recusa mais de saida)', () => {
    const nfe = {
      ...base, formaPagamento: '90',
      duplicatas: [{ numero: '001', vencimento: '2026-13-40', valor: 100 }], // malformada
    }
    // contasDaNota estoura (unica parcela, malformada, nada sobra pra salvar) —
    // e parcelasDescartadasDaNota concorda mostrando a parcela perdida.
    expect(() => contasDaNota(nfe)).toThrow(/Nenhuma das 1 parcela\(s\)/)
    const r = parcelasDescartadasDaNota(nfe)
    expect(r).toHaveLength(1)
    expect(r[0].numero).toBe('001')
    expect(r[0].motivo).toMatch(/Data em formato inválido/)
  })

  it('tPag 05 com duplicata: lista vazia, igual contasDaNota (cartao nao cede a duplicata)', () => {
    const nfe = {
      ...base, formaPagamento: '05',
      duplicatas: [{ numero: '001', vencimento: '2026-08-01', valor: 355 }],
    }
    expect(contasDaNota(nfe)).toEqual([])
    expect(parcelasDescartadasDaNota(nfe)).toEqual([])
  })
})

describe('parcelasDescartadasDaNota — tPag 17/18 (PIX/transferencia) sem duplicata', () => {
  it('tPag 18 sem duplicata: lista vazia, igual ao padrao ja testado pro 05', () => {
    const nfe = { ...base, formaPagamento: '18', duplicatas: [] }
    expect(contasDaNota(nfe)).toEqual([])
    expect(parcelasDescartadasDaNota(nfe)).toEqual([])
  })

  it('tPag 17 sem duplicata: lista vazia', () => {
    const nfe = { ...base, formaPagamento: '17', duplicatas: [] }
    expect(contasDaNota(nfe)).toEqual([])
    expect(parcelasDescartadasDaNota(nfe)).toEqual([])
  })
})

describe('contasDaNota', () => {
  it('uma duplicata vira uma conta 1 de 1', () => {
    const r = contasDaNota(base)
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBe('2026-07-21')
    expect(r[0].valor).toBe(30600)
    expect(r[0].numero_parcela).toBe(1)
    expect(r[0].total_parcelas).toBe(1)
    expect(r[0].fornecedor).toBe('TRIANGULO DIESEL TRR LTDA')
  })

  it('descricao de parcela unica nao mostra numero de parcela', () => {
    expect(contasDaNota(base)[0].descricao).toBe('DIESEL S10')
  })

  it('tres duplicatas viram tres contas numeradas, cada uma com seu valor', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 10200 },
      { numero: '002', vencimento: '2026-09-15', valor: 10200 },
      { numero: '003', vencimento: '2026-10-15', valor: 10200 },
    ]})
    expect(r).toHaveLength(3)
    expect(r.map(c => c.numero_parcela)).toEqual([1, 2, 3])
    expect(r.every(c => c.total_parcelas === 3)).toBe(true)
    expect(r[1].descricao).toBe('DIESEL S10 (2/3)')
    expect(r.map(c => c.vencimento)).toEqual(['2026-08-15', '2026-09-15', '2026-10-15'])
  })

  it('competencia e o mes do VENCIMENTO, nao o da emissao', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-09-15', valor: 100 },
    ]})
    expect(r[0].competencia).toBe('2026-09-01')
  })

  it('sem duplicata: uma conta sem data, com o valor TOTAL da nota (caso ERCAL)', () => {
    const r = contasDaNota({ ...base, duplicatas: [] })
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBeNull()
    expect(r[0].valor).toBe(30600)
    expect(r[0].numero_parcela).toBe(1)
    expect(r[0].total_parcelas).toBe(1)
  })

  it('sem duplicata: competencia cai no mes da EMISSAO', () => {
    expect(contasDaNota({ ...base, duplicatas: [] })[0].competencia).toBe('2026-07-01')
  })

  it('duplicata sem data tambem vira conta sem data, nao e descartada', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: null, valor: 500 },
    ]})
    expect(r).toHaveLength(1)
    expect(r[0].vencimento).toBeNull()
    expect(r[0].valor).toBe(500)
    expect(r[0].competencia).toBe('2026-07-01')
  })

  it('parcela com data e sem valor vira conta com data e sem valor', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: null },
    ]})
    expect(r[0].vencimento).toBe('2026-08-15')
    expect(r[0].valor).toBeNull()
  })

  it('cartao de credito nao gera conta nenhuma', () => {
    expect(contasDaNota({ ...base, formaPagamento: '05' })).toEqual([])
  })

  it('soma das parcelas diferente do total da nota gera assim mesmo', () => {
    const r = contasDaNota({ ...base, valorTotal: 30600, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 10000 },
      { numero: '002', vencimento: '2026-09-15', valor: 10000 },
    ]})
    expect(r).toHaveLength(2)
    expect(r.map(c => c.valor)).toEqual([10000, 10000])
  })

  it('data de emissao ja em formato curto tambem funciona', () => {
    const r = contasDaNota({ ...base, dataEmissao: '2026-07-14', duplicatas: [] })
    expect(r[0].competencia).toBe('2026-07-01')
  })

  it('dataEmissao vazia estoura com erro reconhecivel, nao gera competencia invalida', () => {
    expect(() => contasDaNota({ ...base, dataEmissao: '', duplicatas: [] }))
      .toThrow(/Data em formato inválido/)
  })

  it('dataEmissao em formato inesperado tambem estoura', () => {
    expect(() => contasDaNota({ ...base, dataEmissao: '14/07/2026', duplicatas: [] }))
      .toThrow(/Data em formato inválido/)
  })

  it('dataEmissao com componentes zerados (0000-00-00) estoura, mesmo com formato certo', () => {
    expect(() => contasDaNota({ ...base, dataEmissao: '0000-00-00', duplicatas: [] }))
      .toThrow(/Data em formato inválido/)
  })

  it('dataEmissao com mes inexistente (13) estoura, mesmo com formato certo', () => {
    expect(() => contasDaNota({ ...base, dataEmissao: '2026-13-01', duplicatas: [] }))
      .toThrow(/Data em formato inválido/)
  })

  it('29 de fevereiro em ano nao bissexto (2026) estoura', () => {
    expect(() => contasDaNota({ ...base, dataEmissao: '2026-02-29', duplicatas: [] }))
      .toThrow(/Data em formato inválido/)
  })

  it('29 de fevereiro em ano bissexto (2028) passa normalmente', () => {
    const r = contasDaNota({ ...base, dataEmissao: '2028-02-29', duplicatas: [] })
    expect(r[0].competencia).toBe('2028-02-01')
  })
})

// A descricao da conta mostra os PRODUTOS/SERVICOS da nota, nao o fornecedor
// repetido (a tela ja tem uma coluna Fornecedor separada). Testado via
// contasDaNota (sem duplicata, pra isolar so a construcao da descricao do
// resto da logica de parcela) porque resumoDosItens/descricaoDaConta nao sao
// exportadas de proposito — sao detalhe interno desta funcao.
describe('contasDaNota — descricao mostra os itens da nota, nao o fornecedor', () => {
  it('1 item: mostra so o nome do produto', () => {
    const r = contasDaNota({ ...base, duplicatas: [], items: [
      { descricao: 'Glifosato 20L' },
    ]})
    expect(r[0].descricao).toBe('Glifosato 20L')
  })

  it('2 itens: junta com "e"', () => {
    const r = contasDaNota({ ...base, duplicatas: [], items: [
      { descricao: 'Glifosato 20L' },
      { descricao: 'Ureia 50kg' },
    ]})
    expect(r[0].descricao).toBe('Glifosato 20L e Ureia 50kg')
  })

  it('3 itens: virgula entre os dois primeiros, "e" antes do ultimo', () => {
    const r = contasDaNota({ ...base, duplicatas: [], items: [
      { descricao: 'Glifosato 20L' },
      { descricao: 'Ureia 50kg' },
      { descricao: '2,4-D 5L' },
    ]})
    expect(r[0].descricao).toBe('Glifosato 20L, Ureia 50kg e 2,4-D 5L')
  })

  it('4 itens: trunca nos 2 primeiros + "e mais 2 itens" (plural)', () => {
    const r = contasDaNota({ ...base, duplicatas: [], items: [
      { descricao: 'Glifosato 20L' },
      { descricao: 'Ureia 50kg' },
      { descricao: '2,4-D 5L' },
      { descricao: 'Adjuvante 1L' },
    ]})
    expect(r[0].descricao).toBe('Glifosato 20L, Ureia 50kg e mais 2 itens')
  })

  it('5 itens: continua truncando nos 2 primeiros, contagem do resto sobe', () => {
    const r = contasDaNota({ ...base, duplicatas: [], items: [
      { descricao: 'Glifosato 20L' },
      { descricao: 'Ureia 50kg' },
      { descricao: '2,4-D 5L' },
      { descricao: 'Adjuvante 1L' },
      { descricao: 'Fungicida 10L' },
    ]})
    expect(r[0].descricao).toBe('Glifosato 20L, Ureia 50kg e mais 3 itens')
  })

  it('items vazio: cai no formato antigo (fornecedor — NF numero), defensivo — descricao nunca fica em branco', () => {
    const r = contasDaNota({ ...base, duplicatas: [], items: [] })
    expect(r[0].descricao).toBe('TRIANGULO DIESEL TRR LTDA — NF 4516')
  })

  it('item repetido (mesmo nome, varias linhas — lotes/precos diferentes): aparece 1 vez so (regressao Apolo 06/08/2026, nota real de 52 linhas do mesmo produto)', () => {
    const itensRepetidos = Array.from({ length: 52 }, () => ({ descricao: 'SOJA EM GRAOS DE TERCEIROS' }))
    const r = contasDaNota({ ...base, duplicatas: [], items: itensRepetidos })
    expect(r[0].descricao).toBe('SOJA EM GRAOS DE TERCEIROS')
  })

  it('item repetido com espacos extras ao redor tambem conta como o mesmo produto', () => {
    const r = contasDaNota({ ...base, duplicatas: [], items: [
      { descricao: 'Glifosato 20L' },
      { descricao: '  Glifosato 20L  ' },
    ]})
    expect(r[0].descricao).toBe('Glifosato 20L')
  })

  it('item com nome so de espacos e ignorado, nao vira celula vazia', () => {
    const r = contasDaNota({ ...base, duplicatas: [], items: [
      { descricao: 'Glifosato 20L' },
      { descricao: '   ' },
    ]})
    expect(r[0].descricao).toBe('Glifosato 20L')
  })

  it('items com parcelas (mais de uma duplicata): resumo dos itens + sufixo de parcela', () => {
    const r = contasDaNota({ ...base, items: [
      { descricao: 'Glifosato 20L' },
      { descricao: 'Ureia 50kg' },
    ], duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 15300 },
      { numero: '002', vencimento: '2026-09-15', valor: 15300 },
    ]})
    expect(r[0].descricao).toBe('Glifosato 20L e Ureia 50kg (1/2)')
    expect(r[1].descricao).toBe('Glifosato 20L e Ureia 50kg (2/2)')
  })
})

describe('contasDaNota — uma parcela ruim nao pode derrubar as boas', () => {
  it('3 parcelas, uma ruim no meio: devolve as 2 boas, na ordem, com os valores certos', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 220000 },
      { numero: '002', vencimento: '2026-13-40', valor: 220000 }, // malformada: mes 13, dia 40
      { numero: '003', vencimento: '2026-10-15', valor: 220000 },
    ]})
    expect(r).toHaveLength(2)
    expect(r.map(c => c.vencimento)).toEqual(['2026-08-15', '2026-10-15'])
    expect(r.map(c => c.valor)).toEqual([220000, 220000])
  })

  it('3 parcelas, a primeira ruim: devolve as 2 boas', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-13-40', valor: 100 }, // malformada
      { numero: '002', vencimento: '2026-08-15', valor: 200 },
      { numero: '003', vencimento: '2026-09-15', valor: 300 },
    ]})
    expect(r).toHaveLength(2)
    expect(r.map(c => c.vencimento)).toEqual(['2026-08-15', '2026-09-15'])
    expect(r.map(c => c.valor)).toEqual([200, 300])
  })

  it('3 parcelas, a ultima ruim: devolve as 2 boas', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 100 },
      { numero: '002', vencimento: '2026-09-15', valor: 200 },
      { numero: '003', vencimento: '2026-13-40', valor: 300 }, // malformada
    ]})
    expect(r).toHaveLength(2)
    expect(r.map(c => c.vencimento)).toEqual(['2026-08-15', '2026-09-15'])
    expect(r.map(c => c.valor)).toEqual([100, 200])
  })

  it('numero_parcela e total_parcelas preservam a POSICAO e o TOTAL originais da nota, com um buraco visivel onde a parcela ruim caiu', () => {
    const r = contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 100 },
      { numero: '002', vencimento: '2026-13-40', valor: 100 }, // malformada — some
      { numero: '003', vencimento: '2026-10-15', valor: 100 },
    ]})
    expect(r).toHaveLength(2)
    // Renumerar para 1/2, 2/2 apagaria o rastro de que uma parcela sumiu e pareceria
    // completo por engano. "1/3" seguido de "3/3" (sem "2/3") é o próprio aviso.
    expect(r.map(c => c.numero_parcela)).toEqual([1, 3])
    expect(r.every(c => c.total_parcelas === 3)).toBe(true)
    expect(r[0].descricao).toBe('DIESEL S10 (1/3)')
    expect(r[1].descricao).toBe('DIESEL S10 (3/3)')
  })

  it('todas as parcelas ruins: nao devolve lista vazia (indistinguivel de "nao gera boleto") — lanca erro', () => {
    expect(() => contasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-13-40', valor: 100 },
      { numero: '002', vencimento: '2026-99-99', valor: 200 },
    ]})).toThrow(/Nenhuma das 2 parcela\(s\)/)
  })
})

describe('parcelasDescartadasDaNota', () => {
  it('nota sem problema nenhum: lista vazia', () => {
    expect(parcelasDescartadasDaNota(base)).toEqual([])
  })

  it('nota sem duplicata (caso ERCAL): lista vazia — nao ha parcela pra descartar', () => {
    expect(parcelasDescartadasDaNota({ ...base, duplicatas: [] })).toEqual([])
  })

  it('cartao de credito: lista vazia — a nota nem tenta gerar boleto', () => {
    expect(parcelasDescartadasDaNota({ ...base, formaPagamento: '05' })).toEqual([])
  })

  it('parcela ruim no meio: aparece aqui com o numero da duplicata e o motivo', () => {
    const r = parcelasDescartadasDaNota({ ...base, duplicatas: [
      { numero: '001', vencimento: '2026-08-15', valor: 100 },
      { numero: '002', vencimento: '2026-13-40', valor: 100 },
      { numero: '003', vencimento: '2026-10-15', valor: 100 },
    ]})
    expect(r).toHaveLength(1)
    expect(r[0].numero).toBe('002')
    expect(r[0].motivo).toMatch(/Data em formato inválido/)
  })
})
