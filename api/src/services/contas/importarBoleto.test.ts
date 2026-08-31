import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BoletoLido } from './boletoPdf'

const { fake } = vi.hoisted(() => ({
  fake: {
    leitura: null as any,
    candidatas: [] as any[],
    nota: null as any,
    soltas: [] as any[],
    adocaoOk: true,
    adotou: [] as any[],
    gravou: [] as any[],
    resultadoGravar: { status: 'criada', id: 'conta-1' } as any,
  },
}))

vi.mock('./boletoPdf', async (importarReal) => {
  // `validarBoletoLido` é a trava de verdade — não pode ser simulada, senão o
  // teste da revalidação provaria só o mock.
  const real = await importarReal<typeof import('./boletoPdf')>()
  return { ...real, lerBoletoDoPdf: vi.fn(async () => fake.leitura) }
})

vi.mock('./notasCandidatas', () => ({
  buscarNotasCandidatas: vi.fn(async () => fake.candidatas),
  buscarNotaDaFazenda: vi.fn(async () => fake.nota),
  buscarContasSoltas: vi.fn(async () => fake.soltas),
  adotarContaNaNota: vi.fn(async (...args: any[]) => { fake.adotou.push(args); return fake.adocaoOk }),
}))

vi.mock('./gravarBoletoPdf', () => ({
  gravarBoletoDoPdf: vi.fn(async (...args: any[]) => {
    fake.gravou.push(args)
    return fake.resultadoGravar
  }),
}))

import { lerBoletoEProcurarNotas, gravarBoletoConfirmado } from './importarBoleto'

const HOJE = '2026-08-31'
const FAZENDA = 'faz-1'

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

const NOTA_MIKAMI = {
  id: 'nf-4507',
  numero: '4507',
  emitente_nome: 'MIKAMI COMERCIO DE PRODUTOS AGRICOLAS LTDA',
  valor_total: 37644,
  data_emissao: '2026-07-31',
  contas: [] as any[],
  lancouGasto: true,
}

/** Conta solta no formato que `buscarContasSoltas` devolve, com o ESTADO. */
const solta = (over: any = {}) => ({
  id: 'conta-solta',
  fornecedor: 'MIKAMI COMERCIO LTDA',
  status: 'aberta',
  recorrente_id: null,
  documento_controle_id: null,
  ...over,
})

const pedido = (over: any = {}) => ({
  boleto: boleto(), nomeArquivo: 'boleto.pdf', notaFiscalId: 'nf-4507', ...over,
})

beforeEach(() => {
  fake.leitura = { status: 'boleto', boleto: boleto() }
  fake.candidatas = [NOTA_MIKAMI]
  fake.nota = { ...NOTA_MIKAMI, contas: [] }
  fake.soltas = []
  fake.adocaoOk = true
  fake.adotou = []
  fake.gravou = []
  fake.resultadoGravar = { status: 'criada', id: 'conta-1' }
})

describe('lerBoletoEProcurarNotas', () => {
  it('devolve o boleto lido junto com as notas que podem ser dele', async () => {
    const r = await lerBoletoEProcurarNotas(Buffer.from('x'), 'boleto.pdf', HOJE, FAZENDA, {} as any)
    expect(r.status).toBe('lido')
    if (r.status !== 'lido') return
    expect(r.boleto.valor).toBe(37644)
    expect(r.sugestoes.map(s => s.id)).toEqual(['nf-4507'])
    expect(r.sugestoes[0].motivos.length).toBe(3)
  })

  it('não grava nada na leitura', async () => {
    await lerBoletoEProcurarNotas(Buffer.from('x'), 'boleto.pdf', HOJE, FAZENDA, {} as any)
    expect(fake.gravou).toHaveLength(0)
  })

  it('repassa "não é boleto" sem inventar sugestão', async () => {
    fake.leitura = { status: 'nao-boleto' }
    const r = await lerBoletoEProcurarNotas(Buffer.from('x'), 'x.pdf', HOJE, FAZENDA, {} as any)
    expect(r).toEqual({ status: 'nao-boleto' })
  })

  it('repassa falha de leitura com o motivo', async () => {
    fake.leitura = { status: 'falha', motivo: 'API fora do ar' }
    const r = await lerBoletoEProcurarNotas(Buffer.from('x'), 'x.pdf', HOJE, FAZENDA, {} as any)
    expect(r).toEqual({ status: 'falha', motivo: 'API fora do ar' })
  })

  it('devolve lista vazia quando nenhuma nota casa', async () => {
    fake.candidatas = []
    const r = await lerBoletoEProcurarNotas(Buffer.from('x'), 'b.pdf', HOJE, FAZENDA, {} as any)
    expect(r.status).toBe('lido')
    if (r.status !== 'lido') return
    expect(r.sugestoes).toEqual([])
  })
})

describe('gravarBoletoConfirmado', () => {
  it('grava a conta AMARRADA na nota escolhida', async () => {
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r).toEqual({ status: 'criada', id: 'conta-1' })
    // 4º argumento de gravarBoletoDoPdf = nota_fiscal_id. É ELE que faz
    // `precisaCriarLancamento` devolver false e impedir o gasto dobrado.
    expect(fake.gravou[0][3]).toBe('nf-4507')
  })

  it('grava conta solta quando o dono diz que não há nota', async () => {
    const r = await gravarBoletoConfirmado(pedido({ notaFiscalId: null }), HOJE, FAZENDA)
    expect(r.status).toBe('criada')
    expect(fake.gravou[0][3]).toBeNull()
  })

  // ACHADO 1 do Apolo [alto]. A regra já existia do outro lado do sistema
  // (`idDaNotaQueLancouGasto`) e faltava aqui. Caso ERCAL: nota de remessa,
  // boleto cheio, gasto zero. Amarrar faria o dinheiro sair do banco sem virar
  // despesa em tela nenhuma — pior que dobrado, porque dobrado o dono enxerga.
  it('RECUSA amarrar em nota que NÃO lançou gasto no Financeiro', async () => {
    fake.nota = { ...NOTA_MIKAMI, lancouGasto: false }
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r.status).toBe('nota-sem-gasto')
    expect(fake.gravou).toHaveLength(0)
    expect(fake.adotou).toHaveLength(0)
  })

  // ACHADO 3 [alto]. A 1ª versão recusava qualquer nota que já tivesse UMA
  // conta — proibindo a 2ª parcela, que é caso legítimo, e empurrando o dono
  // para "nenhuma nota", que é o caminho do gasto dobrado.
  it('ACEITA a 2ª parcela: nota com conta de outro vencimento', async () => {
    fake.nota = {
      ...NOTA_MIKAMI,
      contas: [{ id: 'c1', valor: 12548, vencimento: '2026-09-03', status: 'aberta' }],
    }
    const r = await gravarBoletoConfirmado(pedido({ boleto: boleto({ valor: 12548, vencimento: '2026-10-03' }) }), HOJE, FAZENDA)
    expect(r.status).toBe('criada')
    expect(fake.gravou[0][3]).toBe('nf-4507')
  })

  it('RECUSA o MESMO boleto: conta da nota com mesmo valor e vencimento', async () => {
    fake.nota = {
      ...NOTA_MIKAMI,
      contas: [{ id: 'c-igual', valor: 37644, vencimento: '2026-11-03', status: 'aberta' }],
    }
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r).toEqual({ status: 'parcela-repetida', contaId: 'c-igual' })
    expect(fake.gravou).toHaveLength(0)
  })

  // ACHADO 4 [alto]. Antes isto devolvia 'duplicada' e a tela dizia "nada foi
  // criado", tranquilizando o dono enquanto a conta solta continuava lá — e
  // pagá-la lançaria o gasto em cima do que a nota já lançou.
  it('ADOTA a conta solta que já existia, amarrando na nota', async () => {
    fake.soltas = [solta()]
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r).toEqual({ status: 'adotada', id: 'conta-solta' })
    expect(fake.adotou[0]).toEqual(['conta-solta', 'nf-4507', FAZENDA])
    // Não cria uma segunda: a existente foi consertada.
    expect(fake.gravou).toHaveLength(0)
  })

  it('não adota conta solta de OUTRO fornecedor com mesmo valor e data', async () => {
    fake.soltas = [solta({ id: 'de-outro', fornecedor: 'AGRO XYZ LTDA' })]
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r.status).toBe('criada')
    expect(fake.adotou).toHaveLength(0)
  })

  it('trata a corrida: se outra aba amarrou ou pagou primeiro, não cria a segunda', async () => {
    fake.soltas = [solta()]
    fake.adocaoOk = false
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r).toEqual({ status: 'duplicada' })
    expect(fake.gravou).toHaveLength(0)
  })

  // Sem nota escolhida não há o que adotar: a conta solta É o resultado
  // desejado, e a trava de duplicata do gravador cuida da repetição.
  it('não procura conta solta quando o dono escolheu "nenhuma nota"', async () => {
    fake.soltas = [solta({ id: 'x' })]
    const r = await gravarBoletoConfirmado(pedido({ notaFiscalId: null }), HOJE, FAZENDA)
    expect(r.status).toBe('criada')
    expect(fake.adotou).toHaveLength(0)
  })


  // ── ACHADO 1 da rodada 2 [alto] ────────────────────────────────────────────
  // A adoção é escrita NOVA em cima de linha existente e não olhava em que
  // estado essa linha está. Medido na produção em 31/08/2026: 25 das 28 contas
  // soltas eram de um dos tipos abaixo.

  it('NÃO adota conta já PAGA — o lançamento dela mantém a duplicidade de pé', async () => {
    fake.soltas = [solta({ status: 'paga' })]
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r).toEqual({ status: 'conta-encerrada', contaId: 'conta-solta', statusConta: 'paga' })
    expect(fake.adotou).toHaveLength(0)
    expect(fake.gravou).toHaveLength(0)
  })

  // Dispensada some da lista da tela (ver web/.../filtros.ts): o boleto
  // recém-importado NUNCA apareceria para pagar, e a tela diria que deu certo.
  it('NÃO adota conta DISPENSADA — ela some da tela e o boleto sumiria junto', async () => {
    fake.soltas = [solta({ status: 'dispensada' })]
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r.status).toBe('conta-encerrada')
    expect(fake.adotou).toHaveLength(0)
  })

  // Conta de luz/arrendamento amarrada numa NF-e para de lançar despesa ao ser
  // paga: a terceira linha da tabela verdade, "GASTO SOME".
  it('NÃO adota conta RECORRENTE', async () => {
    fake.soltas = [solta({ recorrente_id: 'rec-1' })]
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r.status).toBe('conta-encerrada')
    expect(fake.adotou).toHaveLength(0)
  })

  it('NÃO adota conta de CONTRATO — o gasto já entrou por lá', async () => {
    fake.soltas = [solta({ documento_controle_id: 'doc-1' })]
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r.status).toBe('conta-encerrada')
    expect(fake.adotou).toHaveLength(0)
  })

  it('adota conta AGUARDANDO, que é estado vivo', async () => {
    fake.soltas = [solta({ status: 'aguardando' })]
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r).toEqual({ status: 'adotada', id: 'conta-solta' })
  })

  // ── ACHADO 2 da rodada 2 [medio] ───────────────────────────────────────────
  // `pareceMesmoFornecedor` daqui é a TERCEIRA cópia da regra das duas
  // palavras, e era a única sem teste na fronteira: o mutante `slice(0, 1)`
  // passava por 323 testes. Com ele, o boleto da AGRO XYZ adotaria a conta da
  // AGRO SANTA MARIA — conta do fornecedor errado amarrada na nota.
  it('NÃO adota conta solta de fornecedor que só compartilha a PRIMEIRA palavra', async () => {
    fake.soltas = [solta({ fornecedor: 'AGRO SANTA MARIA LTDA' })]
    const r = await gravarBoletoConfirmado(
      pedido({ boleto: boleto({ beneficiario: 'AGRO XYZ COMERCIO LTDA' }) }), HOJE, FAZENDA,
    )
    expect(r.status).toBe('criada')
    expect(fake.adotou).toHaveLength(0)
  })

  // ── ACHADO 3 da rodada 2 [medio] ───────────────────────────────────────────
  // Havia teste do lado do VENCIMENTO ("aceita a 2ª parcela" com data
  // diferente) e nenhum do lado do VALOR: comparar só a data passava na suíte.
  // Se alguém "simplificar" assim, volta o 409 indevido que empurra o dono para
  // "nenhuma nota" — o caminho do gasto dobrado.
  it('ACEITA boleto de MESMO vencimento e valor DIFERENTE na mesma nota', async () => {
    fake.nota = {
      ...NOTA_MIKAMI,
      contas: [{ id: 'c1', valor: 12548, vencimento: '2026-11-03', status: 'aberta' }],
    }
    const r = await gravarBoletoConfirmado(pedido(), HOJE, FAZENDA)
    expect(r.status).toBe('criada')
    expect(fake.gravou[0][3]).toBe('nf-4507')
  })

  it('RECUSA nota que não é da fazenda ativa', async () => {
    fake.nota = null
    const r = await gravarBoletoConfirmado(pedido({ notaFiscalId: 'nf-de-outra-fazenda' }), HOJE, FAZENDA)
    expect(r.status).toBe('nota-invalida')
    expect(fake.gravou).toHaveLength(0)
  })

  // Os números vêm do navegador na confirmação (a leitura acontece uma vez só).
  // As MESMAS travas do boletoPdf.ts são reaplicadas aqui.
  it('RECUSA valor acima do teto', async () => {
    const r = await gravarBoletoConfirmado(pedido({ boleto: boleto({ valor: 9_000_000 }), notaFiscalId: null }), HOJE, FAZENDA)
    expect(r.status).toBe('boleto-invalido')
    expect(fake.gravou).toHaveLength(0)
  })

  it('RECUSA vencimento fora da janela', async () => {
    const r = await gravarBoletoConfirmado(pedido({ boleto: boleto({ vencimento: '2062-11-03' }), notaFiscalId: null }), HOJE, FAZENDA)
    expect(r.status).toBe('boleto-invalido')
  })

  it('RECUSA data que não existe', async () => {
    const r = await gravarBoletoConfirmado(pedido({ boleto: boleto({ vencimento: '2026-02-30' }), notaFiscalId: null }), HOJE, FAZENDA)
    expect(r.status).toBe('boleto-invalido')
  })

  it('RECUSA valor zero ou negativo', async () => {
    for (const valor of [0, -5]) {
      const r = await gravarBoletoConfirmado(pedido({ boleto: boleto({ valor }), notaFiscalId: null }), HOJE, FAZENDA)
      expect(r.status).toBe('boleto-invalido')
    }
  })

  // A revalidação acontece ANTES de qualquer consulta: boleto inválido não
  // pode nem chegar perto do banco.
  it('recusa o boleto inválido sem consultar a nota', async () => {
    fake.nota = null
    const r = await gravarBoletoConfirmado(pedido({ boleto: boleto({ valor: -1 }) }), HOJE, FAZENDA)
    expect(r.status).toBe('boleto-invalido')
  })

  it('preserva a cobrança cedida a banco na revalidação', async () => {
    await gravarBoletoConfirmado(
      pedido({ boleto: boleto({ cobradoPor: 'MILAGRE FUNDO DE INVESTIMENTOS' }), notaFiscalId: null }),
      HOJE, FAZENDA,
    )
    const gravado: BoletoLido = fake.gravou[0][0]
    expect(gravado.beneficiario).toContain('MIKAMI')
    expect(gravado.cobradoPor).toBe('MILAGRE FUNDO DE INVESTIMENTOS')
  })

  it('repassa a duplicata detectada pelo gravador', async () => {
    fake.resultadoGravar = { status: 'duplicada' }
    const r = await gravarBoletoConfirmado(pedido({ notaFiscalId: null }), HOJE, FAZENDA)
    expect(r).toEqual({ status: 'duplicada' })
  })
})
