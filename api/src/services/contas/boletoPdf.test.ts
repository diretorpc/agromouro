import { describe, it, expect } from 'vitest'
import { validarBoletoLido } from './boletoPdf'

// A leitura em si (a chamada de IA) não dá para testar de mesa. O que dá — e o
// que decide se um boleto entra ou não no sistema — e a validacao do que voltou.
// Ela e a unica coisa entre uma leitura errada e uma conta a pagar errada.

const HOJE = '2026-08-14'

function lido(over: Record<string, unknown> = {}) {
  return {
    ehBoleto: true,
    valor: 642.22,
    vencimento: '2026-09-02',
    beneficiario: 'HIGA COMERCIO E DISTRIBUICAO LTDA',
    documento: '76593',
    ...over,
  }
}

describe('validarBoletoLido — aceita boleto bom', () => {
  it('boleto completo passa e devolve os campos limpos', () => {
    const r = validarBoletoLido(lido(), HOJE)
    expect(r).toEqual({
      valor: 642.22,
      vencimento: '2026-09-02',
      beneficiario: 'HIGA COMERCIO E DISTRIBUICAO LTDA',
      documento: '76593',
      totalDeCobrancas: 1,
    })
  })

  it('tira espaco sobrando do beneficiario e do documento', () => {
    const r = validarBoletoLido(lido({ beneficiario: '  HIGA  ', documento: ' 76593 ' }), HOJE)
    expect(r?.beneficiario).toBe('HIGA')
    expect(r?.documento).toBe('76593')
  })

  it('sem documento e sem beneficiario legivel, ainda vira boleto', () => {
    // Valor e data sao o que importa para pagar. Recusar por causa do NOME
    // seria perder um boleto de verdade por um detalhe cosmetico.
    const r = validarBoletoLido(lido({ documento: null, beneficiario: null }), HOJE)
    expect(r?.valor).toBe(642.22)
    expect(r?.beneficiario).toBe('Fornecedor não identificado')
    expect(r?.documento).toBeNull()
  })

  it('boleto vencido ha poucos dias ainda entra — atrasado precisa aparecer', () => {
    expect(validarBoletoLido(lido({ vencimento: '2026-08-01' }), HOJE)).not.toBeNull()
  })
})

describe('validarBoletoLido — recusa em vez de adivinhar', () => {
  it('nao e boleto: nota fiscal, propaganda, comprovante', () => {
    expect(validarBoletoLido(lido({ ehBoleto: false }), HOJE)).toBeNull()
  })

  it('resposta vazia ou quebrada nao vira boleto', () => {
    expect(validarBoletoLido(null, HOJE)).toBeNull()
    expect(validarBoletoLido({}, HOJE)).toBeNull()
  })

  it('valor ilegivel, zero ou negativo', () => {
    for (const valor of [null, 0, -50, 'R$ 642,22', NaN, Infinity]) {
      expect(validarBoletoLido(lido({ valor }), HOJE)).toBeNull()
    }
  })

  it('data em formato errado — inclusive o formato do proprio boleto', () => {
    // '02/09/2026' e como a data aparece IMPRESSA. Se ela voltar assim, a
    // conversao falhou; gravar isso daria vencimento invalido no banco.
    for (const vencimento of [null, '02/09/2026', '2026-9-2', 'setembro', '']) {
      expect(validarBoletoLido(lido({ vencimento }), HOJE)).toBeNull()
    }
  })

  it('data que NAO EXISTE e recusada — Date.UTC rolaria para o mes seguinte', () => {
    expect(validarBoletoLido(lido({ vencimento: '2026-02-31' }), HOJE)).toBeNull()
    expect(validarBoletoLido(lido({ vencimento: '2026-13-01' }), HOJE)).toBeNull()
  })

  it('ano mal lido vira data absurda e e recusado', () => {
    // Uma conta com vencimento em 2062 nunca mais seria cobrada: ela some no
    // fim da lista e nenhum aviso de vencimento a alcanca.
    expect(validarBoletoLido(lido({ vencimento: '2062-09-02' }), HOJE)).toBeNull()
    // E um "boleto" de 2019 nao chega por e-mail hoje — e leitura errada.
    expect(validarBoletoLido(lido({ vencimento: '2019-09-02' }), HOJE)).toBeNull()
  })

  // Achados do Apolo (14/08/2026), todos provados por ele antes da correcao.
  it('valor acima do teto e recusado — a coluna e NUMERIC(12,2) e o INSERT estouraria', () => {
    // Sem esta trava o boleto se perdia num erro de banco, calado: pior que
    // recusar, porque nao ha nem log de leitura recusada para investigar.
    expect(validarBoletoLido(lido({ valor: 999_999_999_999.99 }), HOJE)).toBeNull()
    // R$ 1,06 mi (a maior nota ja vista aqui, SYAGRI) continua passando.
    expect(validarBoletoLido(lido({ valor: 1_060_000 }), HOJE)).not.toBeNull()
  })

  it("ehBoleto vindo como string 'false' nao vira boleto", () => {
    // 'false' e VERDADEIRO em JavaScript: a checagem frouxa aceitava um
    // documento que o modelo tinha acabado de dizer que nao era boleto.
    expect(validarBoletoLido(lido({ ehBoleto: 'false' }), HOJE)).toBeNull()
    expect(validarBoletoLido(lido({ ehBoleto: 'true' }), HOJE)).toBeNull()
  })
})

describe('validarBoletoLido — centavos e parcelas', () => {
  it('arredonda para 2 casas antes de gravar', () => {
    // O banco arredondaria sozinho (642.226 -> 642,23) e o log diria outra
    // coisa: um centavo de diferenca que ninguem conseguiria explicar depois.
    expect(validarBoletoLido(lido({ valor: 642.226 }), HOJE)?.valor).toBe(642.23)
    expect(validarBoletoLido(lido({ valor: 100.004 }), HOJE)?.valor).toBe(100)
  })

  it('carne com varias parcelas devolve a contagem — o aviso depende dela', () => {
    // So a primeira parcela vira conta. Sem esta contagem, as outras 11 de um
    // carne venciam sem log, sem aviso e sem nada na tela.
    expect(validarBoletoLido(lido({ totalDeCobrancas: 12 }), HOJE)?.totalDeCobrancas).toBe(12)
  })

  it('contagem ausente ou absurda vira 1, sem recusar o boleto', () => {
    // Numero de parcelas mal lido nao pode derrubar um boleto que tem valor e
    // data validos: o aviso e extra, a conta e o que nao pode se perder.
    for (const totalDeCobrancas of [null, 0, -3, 1.5, 'doze', undefined]) {
      const r = validarBoletoLido(lido({ totalDeCobrancas }), HOJE)
      expect(r?.totalDeCobrancas).toBe(1)
    }
  })
})
