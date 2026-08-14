import { describe, it, expect } from 'vitest'
import { linhaBoleto } from './avisoBoleto'
import type { ContaDeNota, ParcelaDescartada } from './deNotaFiscal'

const HOJE = '2026-07-14'

function conta(over: Partial<ContaDeNota> = {}): ContaDeNota {
  return {
    descricao: 'X — NF 1', fornecedor: 'X', vencimento: '2026-07-21',
    competencia: '2026-07-01', valor: 30600, numero_parcela: 1, total_parcelas: 1, ...over,
  }
}

function descartada(over: Partial<ParcelaDescartada> = {}): ParcelaDescartada {
  return { numero: '002', motivo: 'Data em formato inválido ao calcular competência da conta: "2026-13-40"', ...over }
}

describe('linhaBoleto', () => {
  it('um boleto mostra valor, data e quantos dias faltam', () => {
    const t = linhaBoleto([conta()], null, HOJE, false)
    expect(t).toContain('R$ 30.600,00')
    expect(t).toContain('21/07')
    expect(t).toContain('em 7 dias')
  })

  it('boleto que vence hoje nao diz "em 0 dias"', () => {
    const t = linhaBoleto([conta({ vencimento: HOJE })], null, HOJE, false)
    expect(t).toContain('hoje')
    expect(t).not.toContain('0 dias')
  })

  it('boleto que vence amanha fala no singular', () => {
    const t = linhaBoleto([conta({ vencimento: '2026-07-15' })], null, HOJE, false)
    expect(t).toContain('em 1 dia')
    expect(t).not.toContain('1 dias')
  })

  it('tres boletos mostram as tres datas', () => {
    const t = linhaBoleto([
      conta({ vencimento: '2026-08-15', valor: 10200, numero_parcela: 1, total_parcelas: 3 }),
      conta({ vencimento: '2026-09-15', valor: 10200, numero_parcela: 2, total_parcelas: 3 }),
      conta({ vencimento: '2026-10-15', valor: 10200, numero_parcela: 3, total_parcelas: 3 }),
    ], null, HOJE, false)
    expect(t).toContain('3 boletos')
    expect(t).toContain('15/08')
    expect(t).toContain('15/09')
    expect(t).toContain('15/10')
  })

  it('boleto sem data pede a data e manda o link', () => {
    const t = linhaBoleto([conta({ vencimento: null })], null, HOJE, false)
    expect(t).toContain('sem data')
    expect(t).toContain('/contas')
  })

  it('quando nao cria, DIZ o motivo — recusa nunca e silenciosa', () => {
    const t = linhaBoleto([], 'a nota diz cartão de crédito', HOJE, false)
    expect(t).toContain('Sem boleto')
    expect(t).toContain('cartão de crédito')
  })

  it('quando a criacao falhou, avisa que falhou — nao finge que nao tinha boleto', () => {
    const t = linhaBoleto([], null, HOJE, true)
    expect(t).toContain('não consegui')
    expect(t).toContain('/contas')
  })

  it('nada a dizer devolve string vazia', () => {
    expect(linhaBoleto([], null, HOJE, false)).toBe('')
  })
})

// ─── Parcela descartada (Task 3 tinha a função, ninguém a chamava) ──────────
// Uma nota com 3 parcelas onde 1 vem com data malformada "dá certo" no geral —
// os outros 2 boletos são criados, o estoque bate, a NF-e vira 'processada'.
// Sem isto, essa parcela perdida nunca chega ao dono: ele só ia notar quando o
// fornecedor cobrasse por fora um boleto que o sistema nunca soube que existia.
describe('linhaBoleto — parcela descartada (perdida no meio de uma nota que deu certo)', () => {
  it('uma parcela descartada some junto do boleto que sobrou: avisa as duas coisas', () => {
    const t = linhaBoleto([conta()], null, HOJE, false, [descartada()])
    // ainda mostra o boleto que deu certo
    expect(t).toContain('R$ 30.600,00')
    // e avisa, em português simples, que faltou um
    expect(t).toContain('Falta 1 boleto desta nota')
    expect(t).toContain('/contas')
    // sem despejar o erro técnico cru (JSON da data) na mensagem do dono
    expect(t).not.toContain('formato inválido')
  })

  it('duas parcelas descartadas falam no plural', () => {
    const t = linhaBoleto([conta()], null, HOJE, false, [
      descartada({ numero: '002' }),
      descartada({ numero: '003' }),
    ])
    expect(t).toContain('Faltam 2 boletos desta nota')
    expect(t).not.toContain('Falta 1 boleto')
  })

  it('parcela descartada aparece mesmo quando os boletos restantes sao varios', () => {
    const t = linhaBoleto([
      conta({ vencimento: '2026-08-15', numero_parcela: 1, total_parcelas: 3 }),
      conta({ vencimento: '2026-10-15', numero_parcela: 3, total_parcelas: 3 }),
    ], null, HOJE, false, [descartada({ numero: '002' })])
    expect(t).toContain('2 boletos')
    expect(t).toContain('Falta 1 boleto desta nota')
  })

  it('sem parcela descartada, a mensagem nao muda (compatibilidade com a Task 6 original)', () => {
    const t = linhaBoleto([conta()], null, HOJE, false, [])
    expect(t).not.toContain('Falta')
    expect(t).not.toContain('⚠️')
  })

  it('chamar sem o quinto argumento continua funcionando (parametro opcional)', () => {
    expect(linhaBoleto([conta()], null, HOJE, false)).not.toContain('Falta')
  })
})

// A mitigacao da mudanca de 14/08/2026 (a duplicata vence qualquer tPag), no nivel da
// funcao pura: o TEXTO do aviso e a pluralizacao. Quem prova que nfeProcessor.ts
// realmente PASSA o motivo adiante sao os testes de nfeProcessor.test.ts — foi la que a
// mutacao "apagar o 6o argumento" falhou quando o Apolo mediu. Os dois niveis se
// completam; nenhum dos dois sozinho travaria o aviso.
describe('linhaBoleto — aviso de boleto criado CONTRA o codigo de pagamento', () => {
  it('com motivoVencido, pede conferencia e diz como dispensar', () => {
    const t = linhaBoleto([conta()], null, HOJE, false, [], 'a nota diz cartão de crédito')
    expect(t).toContain('👀')
    expect(t).toContain('Confira este boleto')
    expect(t).toContain('a nota diz cartão de crédito')
    expect(t).toContain('dispense em')
    // O boleto em si continua sendo anunciado — o aviso acrescenta, nao substitui.
    expect(t).toContain('R$ 30.600,00')
  })

  it('sem motivoVencido (caso comum), a mensagem nao muda', () => {
    const t = linhaBoleto([conta()], null, HOJE, false, [], null)
    expect(t).not.toContain('Confira')
    expect(t).not.toContain('👀')
  })

  it('tres boletos suspeitos falam no plural — singular faria dispensar so um dos tres', () => {
    const t = linhaBoleto([
      conta({ vencimento: '2026-09-10', numero_parcela: 1, total_parcelas: 3 }),
      conta({ vencimento: '2026-10-10', numero_parcela: 2, total_parcelas: 3 }),
      conta({ vencimento: '2026-11-10', numero_parcela: 3, total_parcelas: 3 }),
    ], null, HOJE, false, [], 'a nota diz cartão de crédito')
    expect(t).toContain('Confira estes 3 boletos')
    expect(t).not.toContain('Confira este boleto')
  })

  it('boleto sem data de vencimento tambem recebe o aviso', () => {
    const t = linhaBoleto([conta({ vencimento: null })], null, HOJE, false, [], 'a nota diz PIX')
    expect(t).toContain('Boleto sem data de vencimento')
    expect(t).toContain('Confira este boleto')
  })

  it('quando NAO ha boleto nenhum, nao manda conferir o que nao existe', () => {
    expect(linhaBoleto([], null, HOJE, false, [], 'a nota diz cartão de crédito')).not.toContain('Confira')
    // Recusa declarada tem a linha dela ("Sem boleto") e nao deve ganhar a de conferencia.
    const recusa = linhaBoleto([], 'a nota diz cartão de crédito', HOJE, false, [], null)
    expect(recusa).toContain('Sem boleto')
    expect(recusa).not.toContain('Confira')
  })
})
