import { describe, it, expect } from 'vitest'
import {
  agruparTopMaisOutros, fmtBRL, fmtBRLCurto, fmtPrecoCurto, fmtPct, rotuloMes,
  separarSemProduto, preencherMesesVazios, ROTULO_SEM_PRODUTO,
} from './graficos-dados'

// Funções PURAS dos gráficos de Controle. Ficam num arquivo próprio (sem
// React, sem Recharts) pelo mesmo motivo de `deletar-linha.ts`: o projeto
// `web/` roda vitest sem jsdom de propósito, então lógica testável não pode
// morar dentro do componente.

describe('agruparTopMaisOutros', () => {
  const fatia = (rotulo: string, total: number, itens = 1) => ({ rotulo, total, itens })

  it('lista menor que o limite passa inteira, sem barra "Outros"', () => {
    const r = agruparTopMaisOutros([fatia('A', 10), fatia('B', 5)], 10)
    expect(r.barras).toEqual([fatia('A', 10), fatia('B', 5)])
    expect(r.ocultos).toBe(0)
    expect(r.valorOcultos).toBe(0)
  })

  it('lista igual ao limite NÃO cria "Outros" — o limite é inclusivo', () => {
    const entrada = Array.from({ length: 10 }, (_, i) => fatia(`P${i}`, 10 - i))
    const r = agruparTopMaisOutros(entrada, 10)
    expect(r.barras).toHaveLength(10)
    expect(r.ocultos).toBe(0)
  })

  it('acima do limite: mantém o top N e soma o resto em "Outros"', () => {
    // ⚠️ As fatias que CAEM em "Outros" têm contagens diferentes de 1 de
    // propósito. Na 1ª versão deste teste elas tinham `itens = 1` cada, então
    // "soma dos itens" e "número de fatias" davam o mesmo 2 — e a mutação
    // `itens: resto.length` passava nos 18 testes (achado 6 do Apolo,
    // executado). Com 3 e 2, o valor certo é 5 e a mutação daria 2.
    const entrada = [fatia('A', 100, 9), fatia('B', 50, 7), fatia('C', 30, 3), fatia('D', 20, 2)]
    const r = agruparTopMaisOutros(entrada, 2)

    expect(r.barras.map(b => b.rotulo)).toEqual(['A', 'B', 'Outros'])
    expect(r.barras[2].total).toBe(50)   // 30 + 20
    expect(r.barras[2].itens).toBe(5)    // 3 + 2 — soma de ITENS, não de fatias
    expect(r.ocultos).toBe(2)            // 2 FATIAS dobradas — grandeza diferente
    expect(r.valorOcultos).toBe(50)
  })

  it('NÃO muta o array recebido — ele é estado do React', () => {
    // Mutação `[...fatias].sort` → `fatias.sort` sobrevivia aos 18 testes.
    // `dados.porProduto` vem do estado do hook; ordenar no lugar mexe no
    // objeto que o React guarda. Hoje não dá sintoma só porque o SQL já
    // entrega ordenado — é sorte, não desenho.
    const entrada = [fatia('pequeno', 1), fatia('grande', 100), fatia('medio', 50)]
    agruparTopMaisOutros(entrada, 10)
    expect(entrada.map(f => f.rotulo)).toEqual(['pequeno', 'grande', 'medio'])
  })

  it('lista MENOR que o limite também sai ordenada por total', () => {
    // O ramo `length <= teto` devolve cedo; as três entradas que o exercitavam
    // já vinham ordenadas, então trocar por `return fatias` cru passava.
    const r = agruparTopMaisOutros([fatia('B', 5), fatia('A', 10)], 10)
    expect(r.barras.map(b => b.rotulo)).toEqual(['A', 'B'])
  })

  it('a soma das barras exibidas é IGUAL à soma da entrada — nada evapora', () => {
    // Este é o teste que importa: "top 10 + outros" existe pra caber na
    // tela, NUNCA pra esconder dinheiro. Se a soma mudar, a legenda passa a
    // mentir sobre o total.
    const entrada = [fatia('A', 1060000), fatia('B', 105930), fatia('C', 82800), fatia('D', 40376), fatia('E', 33600)]
    const r = agruparTopMaisOutros(entrada, 3)

    const somaEntrada = entrada.reduce((s, f) => s + f.total, 0)
    const somaBarras = r.barras.reduce((s, f) => s + f.total, 0)
    expect(somaBarras).toBeCloseTo(somaEntrada, 2)
  })

  it('ordena por total decrescente antes de cortar — a entrada pode vir fora de ordem', () => {
    const r = agruparTopMaisOutros([fatia('pequeno', 1), fatia('grande', 100), fatia('medio', 50)], 2)
    expect(r.barras.map(b => b.rotulo)).toEqual(['grande', 'medio', 'Outros'])
  })

  it('lista vazia devolve vazio, sem barra fantasma', () => {
    const r = agruparTopMaisOutros([], 10)
    expect(r.barras).toEqual([])
    expect(r.ocultos).toBe(0)
  })

  it('limite zero ou negativo não quebra nem devolve lista vazia sem aviso', () => {
    for (const limite of [0, -1, -3]) {
      // O NEGATIVO estava só no nome do teste — sem `Math.max(0, limite)`,
      // `slice(0, -1)` devolve [A] e a soma some. Mutação sobrevivente.
      const r = agruparTopMaisOutros([fatia('A', 10), fatia('B', 5)], limite)
      expect(r.barras).toHaveLength(1)
      expect(r.barras[0].rotulo).toBe('Outros')
      expect(r.barras[0].total).toBe(15)
      expect(r.ocultos).toBe(2)
    }
  })
})

describe('separarSemProduto', () => {
  const fatia = (rotulo: string, total: number, itens = 1) => ({ rotulo, total, itens })

  it('tira o balde do ranking e devolve à parte', () => {
    const r = separarSemProduto([fatia('A', 10), fatia(ROTULO_SEM_PRODUTO, 3), fatia('B', 5)])
    expect(r.comNome.map(f => f.rotulo)).toEqual(['A', 'B'])
    expect(r.semProduto?.total).toBe(3)
  })

  it('sem balde nenhum devolve null — não inventa barra de R$ 0,00', () => {
    const r = separarSemProduto([fatia('A', 10)])
    expect(r.comNome).toHaveLength(1)
    expect(r.semProduto).toBeNull()
  })

  it('o balde nunca entra no top-N junto com os produtos de verdade', () => {
    // O defeito real (achado 2, provado por execução): com 12 produtos e o
    // balde pequeno, ele caía dentro de "Outros" — e a tela mandava procurar
    // uma barra "Sem produto" que não existia.
    const muitos = Array.from({ length: 12 }, (_, i) => fatia(`P${i}`, 1000 - i))
    const r = separarSemProduto([...muitos, fatia(ROTULO_SEM_PRODUTO, 1)])
    const top = agruparTopMaisOutros(r.comNome, 10)
    expect(top.barras.map(b => b.rotulo)).not.toContain(ROTULO_SEM_PRODUTO)
    expect(r.semProduto?.total).toBe(1)
  })
})

describe('preencherMesesVazios', () => {
  const m = (mes: string, total: number, itens = 1) => ({ mes, total, itens })

  it('preenche o buraco entre meses com compra', () => {
    const r = preencherMesesVazios([m('2026-01', 100), m('2026-04', 400)])
    expect(r.map(x => x.mes)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(r[1]).toEqual({ mes: '2026-02', total: 0, itens: 0 })
  })

  it('atravessa a virada do ano sem quebrar', () => {
    const r = preencherMesesVazios([m('2025-11', 10), m('2026-02', 20)])
    expect(r.map(x => x.mes)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('não inventa mês antes do primeiro nem depois do último', () => {
    const r = preencherMesesVazios([m('2026-03', 10), m('2026-05', 20)])
    expect(r[0].mes).toBe('2026-03')
    expect(r[r.length - 1].mes).toBe('2026-05')
  })

  it('um mês só, ou nenhum, passa direto', () => {
    expect(preencherMesesVazios([m('2026-03', 10)]).map(x => x.mes)).toEqual(['2026-03'])
    expect(preencherMesesVazios([])).toEqual([])
  })

  it('a soma do dinheiro não muda — só entram meses com zero', () => {
    const entrada = [m('2026-01', 100), m('2026-06', 250)]
    const soma = (l: { total: number }[]) => l.reduce((s, x) => s + x.total, 0)
    expect(soma(preencherMesesVazios(entrada))).toBe(soma(entrada))
  })
})

describe('fmtBRL — locale pt-BR SEMPRE explícito', () => {
  // ⚠️ Sem o locale, `toLocaleString()` usa o do navegador: em en-US,
  // R$ 1.234,56 vira "R$ 1,234.56" — foi assim que 1.234,56 virou 1,23
  // nesta mesma tela. O teste trava o formato brasileiro.
  //
  // O `Intl` separa o "R$" do número com espaço NÃO-QUEBRÁVEL (U+00A0, e em
  // versões mais novas do ICU U+202F). Qual dos dois é detalhe de biblioteca,
  // não contrato — comparar com espaço comum faria este teste quebrar numa
  // atualização de Node sem nada ter piorado de verdade. Normalizamos só o
  // espaço; ponto de milhar e vírgula decimal continuam comparados ao pé da
  // letra, que é o que realmente importa aqui.
  const semNbsp = (s: string) => s.replace(/[  ]/g, ' ')

  it('formata milhar com ponto e decimal com vírgula', () => {
    expect(semNbsp(fmtBRL(1234.56))).toBe('R$ 1.234,56')
  })

  it('formata o valor grande de verdade da fazenda', () => {
    expect(semNbsp(fmtBRL(1406915.25))).toBe('R$ 1.406.915,25')
  })

  it('zero e negativo não quebram', () => {
    expect(semNbsp(fmtBRL(0))).toBe('R$ 0,00')
    expect(fmtBRL(-10.5)).toContain('10,50')
  })

  it('valor ausente vira traço, não "R$ NaN"', () => {
    expect(fmtBRL(null)).toBe('—')
    expect(fmtBRL(undefined)).toBe('—')
    expect(fmtBRL(Number.NaN)).toBe('—')
  })
})

describe('fmtBRLCurto — rótulo de eixo', () => {
  it('milhão vira "1,4 mi"', () => {
    expect(fmtBRLCurto(1406915.25)).toBe('1,4 mi')
  })

  it('milhar vira "105,9 mil"', () => {
    expect(fmtBRLCurto(105930)).toBe('105,9 mil')
  })

  it('abaixo de mil mantém o número inteiro', () => {
    expect(fmtBRLCurto(884)).toBe('884')
  })

  it('zero vira "0"', () => {
    expect(fmtBRLCurto(0)).toBe('0')
  })

  it('exatamente 1 milhão vira "1 mi", não "1.000 mil"', () => {
    // Mutação sobrevivente: trocar `>= 1_000_000` por `>` fazia R$ 1.000.000,00
    // virar "1.000 mil" no eixo.
    expect(fmtBRLCurto(1_000_000)).toBe('1 mi')
    expect(fmtBRLCurto(1_000)).toBe('1 mil')
  })

  it('negativo usa a mesma escala do positivo', () => {
    // Mutação sobrevivente: `Math.abs(valor)` → `valor` imprimia "-1.406.915"
    // no eixo em vez de "-1,4 mi".
    expect(fmtBRLCurto(-1406915.25)).toBe('-1,4 mi')
  })
})

describe('fmtPrecoCurto — eixo de PREÇO, não de gasto', () => {
  it('preço pequeno mantém os centavos', () => {
    // Achado 11: com `fmtBRLCurto`, 3,20 e 3,80 viravam "3" e "4" — a subida
    // de 19% ficava ilegível no eixo.
    expect(fmtPrecoCurto(3.2)).toBe('3,20')
    expect(fmtPrecoCurto(3.8)).toBe('3,80')
  })

  it('preço grande usa a escala curta, igual ao eixo de dinheiro', () => {
    expect(fmtPrecoCurto(2650)).toBe('2,7 mil')
    expect(fmtPrecoCurto(122.5)).toBe('123')
  })

  it('zero vira "0", não "0,00" — ele convive com ticks inteiros no mesmo eixo', () => {
    expect(fmtPrecoCurto(0)).toBe('0')
  })

  it('ausente vira traço', () => {
    expect(fmtPrecoCurto(null)).toBe('—')
  })
})

describe('fmtPct — porcentagem em pt-BR', () => {
  it('usa VÍRGULA decimal, não ponto', () => {
    // Achado 9: `toFixed(1)` devolvia "75.0" e o fallback ao lado usava
    // vírgula — dois formatos na mesma tela.
    expect(fmtPct(1055186.44, 1406915.25)).toBe('75,0')
  })

  it('total zero não vira NaN nem divisão por zero', () => {
    expect(fmtPct(10, 0)).toBe('0,0')
  })
})

describe('rotuloMes', () => {
  it('YYYY-MM vira mes/ano curto em português', () => {
    expect(rotuloMes('2026-03')).toBe('mar/26')
    expect(rotuloMes('2026-12')).toBe('dez/26')
  })

  it('janeiro não vira dezembro do ano anterior (bug clássico de fuso)', () => {
    // Montar Date com '2026-01-01' e ler o mês local pode voltar um dia no
    // Brasil (UTC-3) e virar dez/25. Este teste trava isso.
    expect(rotuloMes('2026-01')).toBe('jan/26')
  })

  it('entrada estranha volta como veio em vez de "Invalid Date"', () => {
    expect(rotuloMes('')).toBe('')
    expect(rotuloMes('xxxx')).toBe('xxxx')
  })

  it('mês fora da faixa volta como veio, nunca "undefined/26"', () => {
    // Mutação sobrevivente: remover o `if (!nome) return mes`.
    expect(rotuloMes('2026-13')).toBe('2026-13')
    expect(rotuloMes('2026-00')).toBe('2026-00')
  })

  it('o casamento é ancorado — texto em volta não passa', () => {
    // Mutação sobrevivente: tirar `^`/`$` do regex fazia 'lixo 2026-03 lixo'
    // virar 'mar/26'.
    expect(rotuloMes('lixo 2026-03 lixo')).toBe('lixo 2026-03 lixo')
    expect(rotuloMes('2026-3')).toBe('2026-3')
  })
})
