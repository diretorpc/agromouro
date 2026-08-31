import { describe, it, expect } from 'vitest'
import {
  contaBateFiltro, contaBateMes, contaBateTipo, mesDaConta, FILTROS,
  comoEntraContaSemVencimento, filtroDeMesSeAplica, podeTerAtrasadaDeOutroMes,
  podeTerContaSemVencimento, type FiltroStatus,
} from './filtros'
import type { ContaAPI } from './tipos'

const HOJE = '2026-08-31'
const MES  = '2026-08'

function conta(over: Partial<ContaAPI> = {}): ContaAPI {
  return {
    id: 'c1', descricao: 'x', fornecedor: null, categoria: null,
    vencimento: '2026-08-10', valor: 100, valor_estimado: false, status: 'aberta',
    data_pagamento: null, valor_pago: null, observacao: null, nota_fiscal_id: null,
    lancamento_id: null, numero_parcela: null, total_parcelas: null,
    created_at: '2026-08-01T10:00:00Z', contas_recorrentes: null, notas_fiscais: null,
    ...over,
  }
}

// Conjunto de sondas que cobre as combinações que decidem o recorte.
const SONDAS: Record<string, ContaAPI> = {
  // Vencida DENTRO do mês: com HOJE = 31/08, dia 10 já passou. Ela é do mês E
  // está atrasada — as duas coisas ao mesmo tempo, que é o caso que confunde.
  abertaVencidaNoMes:   conta({ status: 'aberta',     vencimento: '2026-08-10' }),
  // A vencer ainda hoje: do mês e NÃO atrasada. Sem uma sonda assim, o filtro
  // de mês parecia inerte em "aberta" (todas as outras eram atrasadas, e
  // atrasada passa em qualquer mês).
  abertaAVencerNoMes:   conta({ status: 'aberta',     vencimento: '2026-08-31' }),
  aguardandoFutura:     conta({ status: 'aguardando', vencimento: '2026-09-20' }),
  // As três abaixo entraram na rodada 3: sem elas, o filtro "aguardando" não
  // tinha NENHUMA conta no recorte de agosto (n=0) e o `it.each` afirmava
  // coisas sobre conjunto vazio; "dispensada" tinha uma só.
  aguardandoSemVenc:    conta({ status: 'aguardando', vencimento: null }),
  aguardandoAtrasada:   conta({ status: 'aguardando', vencimento: '2026-03-20' }),
  dispensadaSemVenc:    conta({ status: 'dispensada', vencimento: null, data_pagamento: null }),
  // Vencimento e pagamento em MESES DIFERENTES. Era o buraco que faltava: sem
  // ela, inverter a ordem dentro de `mesDaConta` (preferir o pagamento) passava
  // nos 311 testes -- e e justamente a regra que `page.tsx` documenta, "conta de
  // agosto paga em setembro continua contando como de agosto" (achado 4, rodada 4).
  vencJulhoPagaAgosto:  conta({ status: 'paga',       vencimento: '2026-07-20', data_pagamento: '2026-08-05' }),
  abertaDeOutroMes:     conta({ status: 'aberta',     vencimento: '2026-09-10' }),
  atrasadaDeMarco:      conta({ status: 'aberta',     vencimento: '2026-03-15' }),
  semVencimento:        conta({ status: 'aberta',     vencimento: null }),
  pagaDoMes:            conta({ status: 'paga',       vencimento: '2026-08-05', data_pagamento: '2026-08-05' }),
  pagaAntiga:           conta({ status: 'paga',       vencimento: '2026-04-05', data_pagamento: '2026-04-05' }),
  pagaSemVencMarco:     conta({ status: 'paga',       vencimento: null,         data_pagamento: '2026-03-15' }),
  pagaSemVencAgosto:    conta({ status: 'paga',       vencimento: null,         data_pagamento: '2026-08-15' }),
  dispensadaDoMes:      conta({ status: 'dispensada', vencimento: '2026-08-12' }),
}

/** O que sobra na tela para um dado filtro de status + o mês de agosto. */
function passam(filtro: FiltroStatus): ContaAPI[] {
  return Object.values(SONDAS).filter(
    c => contaBateFiltro(c, filtro, HOJE) && contaBateMes(c, MES, HOJE),
  )
}

describe('contaBateTipo', () => {
  it('separa boleto de nota do resto', () => {
    const deNota = conta({ nota_fiscal_id: 'nf1' })
    expect(contaBateTipo(deNota, 'nota')).toBe(true)
    expect(contaBateTipo(deNota, 'fixas')).toBe(false)
    expect(contaBateTipo(conta(), 'fixas')).toBe(true)
    expect(contaBateTipo(conta(), 'todos')).toBe(true)
  })
})

describe('contaBateFiltro', () => {
  it('"todas" esconde dispensada e paga com mais de 30 dias', () => {
    expect(contaBateFiltro(SONDAS.dispensadaDoMes, 'todas', HOJE)).toBe(false)
    expect(contaBateFiltro(SONDAS.pagaAntiga, 'todas', HOJE)).toBe(false)
    expect(contaBateFiltro(SONDAS.pagaDoMes, 'todas', HOJE)).toBe(true)
    expect(contaBateFiltro(SONDAS.abertaVencidaNoMes, 'todas', HOJE)).toBe(true)
  })

  // A planilha escreve esta regra por extenso dentro do arquivo ("exceto
  // dispensadas e pagas há mais de 30 dias"), então ela virou promessa a
  // terceiros. Sem sonda na borda, trocar 30 por 60 passava batido.
  it('a janela de "Todas" corta exatamente em 30 dias', () => {
    const noLimite  = conta({ status: 'paga', vencimento: '2026-08-01', data_pagamento: '2026-08-01' })
    const umDiaAlem = conta({ status: 'paga', vencimento: '2026-07-31', data_pagamento: '2026-07-31' })
    expect(contaBateFiltro(noLimite, 'todas', HOJE)).toBe(true)
    expect(contaBateFiltro(umDiaAlem, 'todas', HOJE)).toBe(false)
  })

  it('"atrasada" exige vencimento no passado e conta não encerrada', () => {
    expect(contaBateFiltro(SONDAS.atrasadaDeMarco, 'atrasada', HOJE)).toBe(true)
    expect(contaBateFiltro(SONDAS.semVencimento, 'atrasada', HOJE)).toBe(false)
    expect(contaBateFiltro(SONDAS.abertaAVencerNoMes, 'atrasada', HOJE)).toBe(false)
    expect(contaBateFiltro(SONDAS.pagaAntiga, 'atrasada', HOJE)).toBe(false)
  })

  it('"sem-vencimento" só pega conta não encerrada e sem data', () => {
    expect(contaBateFiltro(SONDAS.semVencimento, 'sem-vencimento', HOJE)).toBe(true)
    expect(contaBateFiltro(SONDAS.pagaSemVencMarco, 'sem-vencimento', HOJE)).toBe(false)
  })
})

// O seletor de meses da tela é montado com esta mesma função. Se ela e o
// filtro discordassem, existiria conta visível só em "Todos os meses" e sem
// nenhum mês do seletor capaz de mostrá-la (achado 1 da rodada 3).
describe('mesDaConta', () => {
  it('usa o vencimento quando ele existe', () => {
    expect(mesDaConta(SONDAS.pagaDoMes)).toBe('2026-08')
    expect(mesDaConta(SONDAS.atrasadaDeMarco)).toBe('2026-03')
  })

  it('cai no pagamento só para conta encerrada sem vencimento', () => {
    expect(mesDaConta(SONDAS.pagaSemVencMarco)).toBe('2026-03')
    expect(mesDaConta(SONDAS.semVencimento)).toBeNull()
  })

  // O vencimento MANDA quando existe: conta de julho paga em agosto continua
  // sendo de julho. É a mesma regra que o card "Total de contas pagas" segue.
  it('o vencimento ganha do pagamento quando os dois existem', () => {
    expect(mesDaConta(SONDAS.vencJulhoPagaAgosto)).toBe('2026-07')
  })

  // A guarda `ENCERRADAS.has(...)` precisa ser exercitada, senão o "só" do
  // título acima não passa de intenção. Estado não alcançável pela API hoje —
  // `data_pagamento` só é escrito ao pagar —, mas a regra é essa.
  it('ignora o pagamento de conta que não está encerrada', () => {
    const estranha = conta({ status: 'aberta', vencimento: null, data_pagamento: '2026-03-10' })
    expect(mesDaConta(estranha)).toBeNull()
  })

  it('devolve null quando não há data nenhuma', () => {
    expect(mesDaConta(SONDAS.dispensadaSemVenc)).toBeNull()
  })

  // A prova do achado 1: todo mês que o filtro usa precisa existir no seletor.
  it('todo mês que o filtro aceita aparece na lista do seletor', () => {
    const seletor = new Set(Object.values(SONDAS).map(mesDaConta).filter(Boolean))
    for (const c of Object.values(SONDAS)) {
      const mes = mesDaConta(c)
      if (mes === null) continue
      expect(contaBateMes(c, mes, HOJE)).toBe(true)
      expect(seletor.has(mes)).toBe(true)
    }
  })
})

describe('contaBateMes', () => {
  it('deixa passar tudo quando não há filtro de mês', () => {
    expect(Object.values(SONDAS).every(c => contaBateMes(c, 'todos', HOJE))).toBe(true)
  })

  it('mantém atrasada de outro mês e conta sem vencimento à vista', () => {
    expect(contaBateMes(SONDAS.atrasadaDeMarco, MES, HOJE)).toBe(true)
    expect(contaBateMes(SONDAS.semVencimento, MES, HOJE)).toBe(true)
  })

  it('esconde conta de outro mês que não está atrasada', () => {
    expect(contaBateMes(SONDAS.abertaDeOutroMes, MES, HOJE)).toBe(false)
  })

  // Fronteira: vencer HOJE não é estar atrasada. Sem esta asserção, trocar
  // `< 0` por `<= 0` passava batido — e a conta que vence hoje passaria a
  // aparecer em todo mês, discordando do filtro "Atrasadas", que mantém `< 0`.
  it('conta que vence HOJE não pega a carona das atrasadas', () => {
    expect(contaBateMes(SONDAS.abertaAVencerNoMes, '2026-09', HOJE)).toBe(false)
    expect(contaBateFiltro(SONDAS.abertaAVencerNoMes, 'atrasada', HOJE)).toBe(false)
  })

  // ACHADO 1 da rodada 2 do Apolo. Sem isto, o boleto sem vencimento pago em
  // março entrava no relatório de agosto — e o total em negrito do arquivo
  // discordava do card "Total de contas pagas" logo acima, que já usava
  // `vencimento ?? data_pagamento`.
  it('encerrada sem vencimento cai no MÊS DO PAGAMENTO, não em todo mês', () => {
    expect(contaBateMes(SONDAS.pagaSemVencMarco, MES, HOJE)).toBe(false)
    expect(contaBateMes(SONDAS.pagaSemVencMarco, '2026-03', HOJE)).toBe(true)
    expect(contaBateMes(SONDAS.pagaSemVencAgosto, MES, HOJE)).toBe(true)
  })

  // Sumir calada é pior que aparecer demais: sem data nenhuma, ela continua
  // visível em qualquer mês para alguém consertar.
  it('encerrada sem vencimento E sem pagamento continua aparecendo', () => {
    const orfa = conta({ status: 'dispensada', vencimento: null, data_pagamento: null })
    expect(contaBateMes(orfa, MES, HOJE)).toBe(true)
  })
})

// ─── A frase da planilha contra o filtro de verdade ──────────────────────────
// `exportar.ts` escreve dentro do arquivo o que este recorte inclui. Estes
// testes rodam o filtro DE VERDADE e conferem que a promessa bate — para a
// descrição nunca mais prometer o que o filtro não entrega (achado 2, rodada 2).

describe('propriedades do recorte batem com o filtro real', () => {
  const TODOS = FILTROS.map(f => f.value)

  // MÃO DUPLA, de propósito. A 1ª versão só cobrava a direção negativa ("não
  // prometi o que não entrego") e deixava a positiva solta — trocar o predicado
  // por `return true` passava nos 74 testes. Prometer DEMAIS é exatamente o
  // defeito que estes predicados existem para impedir.
  it.each(TODOS)('podeTerContaSemVencimento("%s") diz a verdade', filtro => {
    expect(podeTerContaSemVencimento(filtro)).toBe(passam(filtro).some(c => !c.vencimento))
  })

  // A 4a resposta, que nasceu sem teste e mentia em "dispensada". Mede POR QUE
  // a conta sem vencimento entrou: se `mesDaConta` e null ela entra sempre; se
  // nao e, entra pelo mes do pagamento. Varre todos os meses porque uma conta
  // que entra "pelo pagamento" so aparece no mes dela.
  it.each(TODOS)('comoEntraContaSemVencimento("%s") diz a verdade', filtro => {
    const meses = ['2026-01', '2026-03', '2026-08', '2026-09', '2026-12']
    const jeitos = new Set(
      Object.values(SONDAS)
        .filter(c => !c.vencimento)
        .filter(c => contaBateFiltro(c, filtro, HOJE))
        .filter(c => meses.some(m => contaBateMes(c, m, HOJE)))
        .map(c => (mesDaConta(c) === null ? 'sempre' : 'pelo-pagamento')),
    )
    const real =
      jeitos.size === 0 ? 'nenhuma' :
      jeitos.size === 2 ? 'ambos' :
      [...jeitos][0]
    expect(comoEntraContaSemVencimento(filtro)).toBe(real)
  })

  it.each(TODOS)('podeTerAtrasadaDeOutroMes("%s") diz a verdade', filtro => {
    const temCarona = passam(filtro).some(
      c => !!c.vencimento && !c.vencimento.startsWith(MES) && c.status !== 'paga' && c.status !== 'dispensada',
    )
    expect(podeTerAtrasadaDeOutroMes(filtro)).toBe(temCarona)
  })

  // "Não se aplica" = trocar o mês não muda NADA no que passa. Medido rodando
  // o filtro com dois meses diferentes e comparando os conjuntos.
  it.each(TODOS)('filtroDeMesSeAplica("%s") diz a verdade', filtro => {
    const ids = (mes: string) => Object.values(SONDAS)
      .filter(c => contaBateFiltro(c, filtro, HOJE) && contaBateMes(c, mes, HOJE))
      .map(c => c.descricao + c.vencimento + c.data_pagamento)
      .sort()
      .join('|')
    const inerte = ['2026-01', '2026-03', '2026-09', '2026-12']
      .every(mes => ids(mes) === ids('2026-08'))
    expect(filtroDeMesSeAplica(filtro)).toBe(!inerte)
  })
})
