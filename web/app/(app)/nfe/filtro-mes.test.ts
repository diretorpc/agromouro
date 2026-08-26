import { describe, it, expect } from 'vitest'
import {
  TODOS_OS_MESES, mesCorrente, mesDaNota, mesPadraoDaLista, notaNoMes, notaVisivel, mesesDisponiveis, rotuloDoMes,
} from './filtro-mes'

const nota = (data_emissao: string | null) => ({ data_emissao })

describe('mesCorrente — no fuso de quem está olhando, não em UTC', () => {
  it('devolve AAAA-MM da data local', () => {
    expect(mesCorrente(new Date(2026, 7, 25, 18, 41))).toBe('2026-08')
  })

  it('dia 31 às 21h no Brasil ainda é o mês que está no calendário da parede', () => {
    // Em UTC já seria dia 1º do mês seguinte. Usar toISOString() aqui jogaria a
    // tela para um mês vazio nas últimas horas de todo mês.
    expect(mesCorrente(new Date(2026, 7, 31, 21, 30))).toBe('2026-08')
  })

  it('janeiro sai com zero à esquerda', () => {
    expect(mesCorrente(new Date(2027, 0, 3, 9, 0))).toBe('2027-01')
  })
})

describe('mesDaNota', () => {
  it('corta a data de emissão em AAAA-MM', () => {
    expect(mesDaNota('2026-07-04')).toBe('2026-07')
  })

  it('data ausente não tem mês', () => {
    expect(mesDaNota(null)).toBe(null)
    expect(mesDaNota(undefined)).toBe(null)
    expect(mesDaNota('')).toBe(null)
  })
})

describe('notaNoMes', () => {
  it('"todos" deixa passar qualquer nota', () => {
    expect(notaNoMes(nota('2026-07-04'), TODOS_OS_MESES)).toBe(true)
    expect(notaNoMes(nota(null), TODOS_OS_MESES)).toBe(true)
  })

  it('mês certo passa, mês errado não', () => {
    expect(notaNoMes(nota('2026-07-04'), '2026-07')).toBe(true)
    expect(notaNoMes(nota('2026-07-04'), '2026-08')).toBe(false)
  })

  it('nota sem data nunca some: aparece em qualquer mês em vez de virar fantasma', () => {
    // A coluna aceita nulo (schema.sql). Esconder para sempre uma nota por causa
    // de um campo vazio é o mesmo tipo de sumiço que este filtro veio consertar.
    expect(notaNoMes(nota(null), '2026-08')).toBe(true)
  })
})

describe('mesPadraoDaLista — qual mês a aba abre mostrando', () => {
  const hoje = new Date(2026, 7, 25)

  it('abre no mês corrente quando ele tem nota', () => {
    expect(mesPadraoDaLista([nota('2026-08-24'), nota('2026-07-04')], hoje)).toBe('2026-08')
  })

  it('mês corrente vazio abre no mês mais recente COM nota', () => {
    // Dia 2 de um mês novo, nada importado ainda: abrir vazio faria o dono achar
    // que a aba quebrou — exatamente o susto de 25/08/2026.
    expect(mesPadraoDaLista([nota('2026-07-04'), nota('2026-06-11')], new Date(2026, 8, 2))).toBe('2026-07')
  })

  it('sem nota nenhuma cai no mês corrente', () => {
    expect(mesPadraoDaLista([], hoje)).toBe('2026-08')
  })

  it('lista fora de ordem também acha o mês mais recente', () => {
    expect(mesPadraoDaLista([nota('2026-05-01'), nota('2026-07-04'), nota('2026-06-30')], new Date(2026, 8, 2))).toBe('2026-07')
  })

  it('nota sem data não atrapalha a escolha', () => {
    expect(mesPadraoDaLista([nota(null), nota('2026-07-04')], new Date(2026, 8, 2))).toBe('2026-07')
  })
})

describe('mesesDisponiveis — o que entra na lista suspensa', () => {
  it('um item por mês, do mais novo para o mais velho, sem repetir', () => {
    const notas = [nota('2026-08-24'), nota('2026-08-07'), nota('2026-07-04'), nota('2026-06-11')]
    expect(mesesDisponiveis(notas)).toEqual(['2026-08', '2026-07', '2026-06'])
  })

  it('o mês selecionado aparece mesmo sem nota nenhuma nele', () => {
    // Senão a lista suspensa fica exibindo vazio quando o filtro esvazia a tela.
    expect(mesesDisponiveis([nota('2026-08-24')], '2026-03')).toEqual(['2026-08', '2026-03'])
  })

  it('"todos" não vira opção de mês', () => {
    expect(mesesDisponiveis([nota('2026-08-24')], TODOS_OS_MESES)).toEqual(['2026-08'])
  })

  it('nota sem data não gera mês vazio na lista', () => {
    expect(mesesDisponiveis([nota(null), nota('2026-08-24')])).toEqual(['2026-08'])
  })

  it('sem nota e sem seleção, lista vazia', () => {
    expect(mesesDisponiveis([])).toEqual([])
  })
})

describe('rotuloDoMes', () => {
  it('escreve o mês por extenso, em português', () => {
    expect(rotuloDoMes('2026-07')).toBe('julho de 2026')
  })

  it('"todos" tem rótulo próprio', () => {
    expect(rotuloDoMes(TODOS_OS_MESES)).toBe('Todos os meses')
  })
})

describe('notaVisivel — busca, status e mês na mesma peneira', () => {
  const julho  = { numero: '289122', emitente_nome: 'RURALCENTRO PRODUTOS AGROPECUARIOS EIRELI', emitente_cnpj: '38629580000153', status: 'processada', data_emissao: '2026-07-04' }
  const agosto = { numero: '5251',   emitente_nome: 'TRIANGULO DIESEL TRR LTDA',                  emitente_cnpj: '54367229000198', status: 'processada', data_emissao: '2026-08-24' }
  const semFiltro = { busca: '', status: 'todos', mes: '2026-08' }

  it('o mês corta o que é de outro mês', () => {
    expect(notaVisivel(agosto, semFiltro)).toBe(true)
    expect(notaVisivel(julho, semFiltro)).toBe(false)
  })

  it('BUSCAR pelo número acha a nota de outro mês — a busca desliga o mês', () => {
    // Achado [alto] do Apolo (25/08/2026): digitar o número é exatamente o que
    // o dono faz quando acha que uma nota sumiu. Com busca E mês em AND, a
    // ferramenta de achar nota sumida devolvia zero.
    expect(notaVisivel(julho, { ...semFiltro, busca: '289122' })).toBe(true)
  })

  it('busca por emitente também atravessa os meses', () => {
    expect(notaVisivel(julho, { ...semFiltro, busca: 'ruralcentro' })).toBe(true)
  })

  it('busca por CNPJ idem', () => {
    expect(notaVisivel(julho, { ...semFiltro, busca: '38629580000153' })).toBe(true)
  })

  it('busca que não casa continua não casando', () => {
    expect(notaVisivel(julho, { ...semFiltro, busca: 'zzz' })).toBe(false)
    expect(notaVisivel(agosto, { ...semFiltro, busca: 'zzz' })).toBe(false)
  })

  it('espaço em branco não conta como busca — o mês continua valendo', () => {
    expect(notaVisivel(julho, { ...semFiltro, busca: '   ' })).toBe(false)
  })

  it('o status continua valendo mesmo durante a busca', () => {
    expect(notaVisivel(julho, { busca: '289122', status: 'erro', mes: '2026-08' })).toBe(false)
    expect(notaVisivel(julho, { busca: '289122', status: 'processada', mes: '2026-08' })).toBe(true)
  })

  it('mês nulo (antes da primeira carga) não esconde nada', () => {
    expect(notaVisivel(julho, { busca: '', status: 'todos', mes: null })).toBe(true)
  })

  it('"todos os meses" mostra os dois', () => {
    const todos = { busca: '', status: 'todos', mes: TODOS_OS_MESES }
    expect(notaVisivel(julho, todos)).toBe(true)
    expect(notaVisivel(agosto, todos)).toBe(true)
  })
})
