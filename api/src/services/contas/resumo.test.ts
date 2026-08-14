import { describe, it, expect } from 'vitest'
import { montarResumo, resumoVazio, textoResumo, COLUNAS_CONTA_RESUMO, type ContaResumo } from './resumo'
import { PREFIXO_CONFERIR } from './deNotaFiscal'

const HOJE = '2026-07-29'

function conta(over: Partial<ContaResumo> = {}): ContaResumo {
  return {
    descricao: 'Energia', fornecedor: 'Cemig', vencimento: '2026-08-10',
    valor: 890, status: 'aberta', avisar_dias_antes: 3,
    criada_em: '2026-07-29', ...over,
  }
}

describe('montarResumo', () => {
  it('conta vencida e nao paga entra como atrasada', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-25' })], HOJE)
    expect(r.atrasadas).toHaveLength(1)
    expect(r.vencendo).toHaveLength(0)
  })

  it('conta aberta dentro do prazo de aviso entra como vencendo', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-31' })], HOJE)
    expect(r.vencendo).toHaveLength(1)
  })

  it('conta aberta ainda longe do vencimento nao entra', () => {
    const r = montarResumo([conta({ vencimento: '2026-08-20' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('conta aguardando perto do vencimento entra como nao chegou', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-31', status: 'aguardando' })], HOJE)
    expect(r.naoChegaram).toHaveLength(1)
    expect(r.vencendo).toHaveLength(0)
  })

  it('conta paga nunca entra em aviso, nem vencida', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-01', status: 'paga' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('conta dispensada nunca entra em aviso, nem vencida', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-01', status: 'dispensada' })], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('respeita o prazo de aviso configurado em cada conta', () => {
    const r = montarResumo([conta({ vencimento: '2026-08-05', avisar_dias_antes: 10 })], HOJE)
    expect(r.vencendo).toHaveLength(1)
  })

  it('vencendo hoje ainda conta como vencendo, nao como atrasada', () => {
    const r = montarResumo([conta({ vencimento: HOJE })], HOJE)
    expect(r.vencendo).toHaveLength(1)
    expect(r.atrasadas).toHaveLength(0)
  })

  it('conta vencida com status aguardando entra como atrasada, nao como nao chegou', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-25', status: 'aguardando' })], HOJE)
    expect(r.atrasadas).toHaveLength(1)
    expect(r.naoChegaram).toHaveLength(0)
  })

  it('conta vencendo exatamente no limite do aviso entra no resumo', () => {
    const r = montarResumo([conta({ vencimento: '2026-08-01', avisar_dias_antes: 3 })], HOJE)
    expect(r.vencendo).toHaveLength(1)
  })
})

describe('textoResumo', () => {
  it('descreve as tres situacoes na mensagem', () => {
    const r = montarResumo([
      conta({ descricao: 'Agua',    vencimento: '2026-07-25', valor: 340 }),
      conta({ descricao: 'Energia', vencimento: '2026-07-31', valor: 890 }),
      conta({ descricao: 'Telefone', vencimento: '2026-07-30', status: 'aguardando', valor: 120 }),
    ], HOJE)
    const txt = textoResumo(r, HOJE)
    // A Task 7 fundiu "atrasadas" e "sem vencimento antigas" sob o mesmo
    // cabeçalho de urgência — o rótulo virou "urgente", não "atrasada".
    expect(txt).toContain('urgente')
    expect(txt).toContain('Agua')
    expect(txt).toContain('Energia')
    expect(txt).toContain('Telefone')
    expect(txt).toContain('ainda não chegou')
  })

  it('duas contas nao chegadas usam o plural correto', () => {
    const r = montarResumo([
      conta({ descricao: 'Telefone', vencimento: '2026-07-30', status: 'aguardando' }),
      conta({ descricao: 'Internet', vencimento: '2026-07-31', status: 'aguardando' }),
    ], HOJE)
    expect(textoResumo(r, HOJE)).toContain('2 ainda não chegaram')
  })

  it('uma conta nao chegada usa o singular', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-30', status: 'aguardando' })], HOJE)
    expect(textoResumo(r, HOJE)).toContain('1 ainda não chegou')
  })

  it('valor na casa dos milhares sai com ponto separador', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-30', valor: 1234.56 })], HOJE)
    expect(textoResumo(r, HOJE)).toContain('R$ 1.234,56')
  })

  // Regressão pega pelo Apolo (06/08/2026): a Descrição da conta passou a
  // mostrar os produtos da nota, não mais "fornecedor — NF número" — então o
  // aviso diário perdeu o nome do fornecedor, que antes vinha embutido na
  // descrição. Sem ele, "DIESEL S10 — venceu 03/08, R$ 30.600,00" não diz de
  // quem é o boleto.
  it('a linha da conta atrasada mostra o fornecedor na frente da descricao', () => {
    const r = montarResumo([
      conta({ descricao: 'DIESEL S10', fornecedor: 'TRIANGULO DIESEL TRR LTDA', vencimento: '2026-07-25', valor: 30600 }),
    ], HOJE)
    const txt = textoResumo(r, HOJE)
    expect(txt).toContain('TRIANGULO DIESEL TRR LTDA — DIESEL S10 — venceu')
  })

  it('conta sem fornecedor (avulsa) mostra so a descricao, sem travessao sobrando na frente', () => {
    const r = montarResumo([
      conta({ descricao: 'Energia', fornecedor: null, vencimento: '2026-07-25', valor: 890 }),
    ], HOJE)
    const txt = textoResumo(r, HOJE)
    expect(txt).toContain('• Energia — venceu')
  })
})

describe('conta sem vencimento', () => {
  it('entra no grupo proprio, e em nenhum outro', () => {
    const r = montarResumo([conta({ vencimento: null })], HOJE)
    expect(r.semVencimento).toHaveLength(1)
    expect(r.atrasadas).toHaveLength(0)
    expect(r.vencendo).toHaveLength(0)
    expect(r.naoChegaram).toHaveLength(0)
  })

  it('nao e atrasada — nao existe data para dizer que passou', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-01-01' })], HOJE)
    expect(r.atrasadas).toHaveLength(0)
  })

  it('com 5 dias ainda NAO subiu de tom', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-07-24' })], HOJE)
    expect(r.semVencimento).toHaveLength(1)
    expect(r.semVencimentoAntigas).toHaveLength(0)
  })

  it('com 6 dias sobe para o grupo critico', () => {
    const r = montarResumo([conta({ vencimento: null, criada_em: '2026-07-23' })], HOJE)
    expect(r.semVencimentoAntigas).toHaveLength(1)
    expect(r.semVencimento).toHaveLength(0)
  })

  it('paga ou dispensada sem vencimento nao entra em aviso nenhum', () => {
    const r = montarResumo([
      conta({ vencimento: null, status: 'paga' }),
      conta({ vencimento: null, status: 'dispensada' }),
    ], HOJE)
    expect(resumoVazio(r)).toBe(true)
  })

  it('resumo so com conta sem vencimento NAO e vazio', () => {
    expect(resumoVazio(montarResumo([conta({ vencimento: null })], HOJE))).toBe(false)
  })

  it('o texto descreve o grupo e leva o link', () => {
    const txt = textoResumo(montarResumo([conta({ vencimento: null })], HOJE), HOJE)
    expect(txt).toContain('sem vencimento')
    expect(txt).toContain('/contas?filtro=sem-vencimento')
  })

  it('o texto da conta antiga diz ha quantos dias esta esperando', () => {
    const txt = textoResumo(montarResumo([conta({ vencimento: null, criada_em: '2026-07-20' })], HOJE), HOJE)
    expect(txt).toContain('9 dias')
  })
})

// O resumo diario e o canal que o Matheus le todo dia — e era o unico dos tres pontos
// de aviso sem teste nenhum (achado [medio-alto] do Apolo, 14/08/2026: zerar
// marcaConferir ou tirar `observacao` do select deixava a suite inteira verde).
describe('textoResumo — marca de "confira antes de pagar"', () => {
  const OBS_CONFERIR = `${PREFIXO_CONFERIR} a nota diz crédito da loja, mas veio com cobrança marcada.`

  it('conta atrasada com o aviso ganha a marca e o link da tela', () => {
    const txt = textoResumo(
      montarResumo([conta({ vencimento: '2026-07-25', observacao: OBS_CONFERIR })], HOJE),
      HOJE,
    )
    expect(txt).toContain('confira antes de pagar')
    expect(txt).toContain('/contas')
  })

  it('a marca vale nos outros grupos tambem, nao so nas atrasadas', () => {
    const vencendo = textoResumo(
      montarResumo([conta({ vencimento: '2026-07-31', observacao: OBS_CONFERIR })], HOJE),
      HOJE,
    )
    expect(vencendo).toContain('confira antes de pagar')

    const semData = textoResumo(
      montarResumo([conta({ vencimento: null, observacao: OBS_CONFERIR })], HOJE),
      HOJE,
    )
    expect(semData).toContain('confira antes de pagar')
  })

  it('sem observacao, o texto e IDENTICO ao de antes da marca existir', () => {
    const r = montarResumo([conta({ vencimento: '2026-07-25' })], HOJE)
    const txt = textoResumo(r, HOJE)
    expect(txt).toContain('• Cemig — Energia — venceu 25/07, R$ 890,00')
    expect(txt).not.toContain('confira')
    expect(txt).not.toContain('👀')
  })

  // A coluna e campo livre: ja existe conta em producao com nota de auditoria escrita
  // a mao ("Dispensada em 04/08: cobranca duplicada..."). So o prefixo vira alerta.
  it('observacao escrita a mao NAO vira alerta', () => {
    const txt = textoResumo(
      montarResumo([conta({
        vencimento: '2026-07-25',
        observacao: 'Combinado com o fornecedor: pagar junto com a proxima compra.',
      })], HOJE),
      HOJE,
    )
    expect(txt).not.toContain('confira antes de pagar')
    expect(txt).not.toContain('👀')
  })

  it('o link nao aparece quando nenhuma conta pede conferencia', () => {
    const txt = textoResumo(montarResumo([conta({ vencimento: '2026-07-25' })], HOJE), HOJE)
    expect(txt).not.toContain('/contas')
  })

  // Duas contas com aviso: um link so, no fim. Nao um por conta.
  it('varias contas com aviso levam UM link so', () => {
    const txt = textoResumo(
      montarResumo([
        conta({ vencimento: '2026-07-25', observacao: OBS_CONFERIR }),
        conta({ vencimento: '2026-07-26', observacao: OBS_CONFERIR, descricao: 'Água' }),
      ], HOJE),
      HOJE,
    )
    expect(txt.match(/\/contas/g)).toHaveLength(1)
  })
})

// Sem isto, apagar `observacao` do .select() do job (api/src/jobs/contas.ts) faria a
// marca sumir da mensagem diaria sem quebrar teste nenhum — o campo chegaria undefined.
describe('COLUNAS_CONTA_RESUMO — o job precisa trazer o que a regra usa', () => {
  it('traz todas as colunas que montarResumo/textoResumo leem', () => {
    for (const coluna of ['descricao', 'fornecedor', 'vencimento', 'valor', 'status', 'observacao', 'created_at']) {
      expect(COLUNAS_CONTA_RESUMO).toContain(coluna)
    }
    expect(COLUNAS_CONTA_RESUMO).toContain('contas_recorrentes(avisar_dias_antes)')
  })
})
