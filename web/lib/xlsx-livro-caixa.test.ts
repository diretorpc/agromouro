import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  gerarLivroCaixa, HEADERS_LIVRO_CAIXA, type LinhaLivroCaixa,
} from '@/lib/xlsx-livro-caixa'

// O pedido foi "IDÊNTICO ao modelo". Testar que o arquivo "abre" não prova
// nada disso — daí metade destes testes comparar o que GERAMOS contra o
// MODELO DE VERDADE, lido do disco. O modelo está versionado justamente para
// este arquivo poder abri-lo:
//   docs/superpowers/specs/2026-09-01-modelo-extrato-livro-caixa.xlsx
//
// Se alguém trocar um estilo "para ficar mais bonito", é aqui que estoura.

const CAMINHO_MODELO = fileURLToPath(
  new URL('../../docs/superpowers/specs/2026-09-01-modelo-extrato-livro-caixa.xlsx', import.meta.url),
)

async function partesDoModelo(): Promise<{ styles: string; sheet: string; shared: string[] }> {
  const zip = await JSZip.loadAsync(readFileSync(CAMINHO_MODELO))
  const styles = await zip.file('xl/styles.xml')!.async('string')
  const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  const brutoShared = await zip.file('xl/sharedStrings.xml')!.async('string')
  const shared = [...brutoShared.matchAll(/<si><t[^>]*>(.*?)<\/t><\/si>/g)].map(m => m[1])
  return { styles, sheet, shared }
}

async function gerar(linhas: LinhaLivroCaixa[]): Promise<{ styles: string; sheet: string }> {
  const blob = await gerarLivroCaixa(linhas)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  return {
    styles: await zip.file('xl/styles.xml')!.async('string'),
    sheet: await zip.file('xl/worksheets/sheet1.xml')!.async('string'),
  }
}

/** Tira quebra de linha e espaço ENTRE tags, para comparar estrutura e não formatação. */
function normalizar(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim()
}

/** Recorta um bloco `<tag ...>...</tag>` (ou `<tag .../>`) do XML. */
function bloco(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*?/>|<${tag}[^>]*>[\\s\\S]*?</${tag}>`))
  expect(m, `bloco <${tag}> não encontrado`).not.toBeNull()
  return normalizar(m![0])
}

/** Os `s=` de uma linha, na ordem das colunas. */
function estilosDaLinha(sheet: string, r: number): number[] {
  const linha = sheet.match(new RegExp(`<row r="${r}"[^>]*>[\\s\\S]*?</row>`))
  expect(linha, `linha ${r} não encontrada`).not.toBeNull()
  return [...linha![0].matchAll(/<c r="[A-Z]+\d+" s="(\d+)"/g)].map(m => Number(m[1]))
}

/** Uma célula específica, com tudo dentro. */
function celula(sheet: string, ref: string): string {
  const m = sheet.match(new RegExp(`<c r="${ref}"[^>]*?/>|<c r="${ref}"[^>]*>[\\s\\S]*?</c>`))
  expect(m, `célula ${ref} não encontrada`).not.toBeNull()
  return m![0]
}

const LINHA_BASE: LinhaLivroCaixa = {
  data: new Date(2026, 7, 14, 12, 0, 0), // 14/08/2026
  historico: 'MIKAMI - Adubo',
  custoOuReceita: 'Custo',
  transacao: 'Fertilizante',
  numeroDocumento: '004521',
  valor: -37644,
  centroCusto: 'MG',
  observacao: 'Contrato 2026',
}

// ─── Fidelidade ao modelo ─────────────────────────────────────────────────────

describe('estilos copiados do modelo', () => {
  // `cellXfs` é a lista que o atributo `s=` de cada célula indexa. Se ela
  // divergir do modelo em UMA entrada, a planilha inteira repinta em silêncio:
  // nenhum erro, nenhum aviso, só um arquivo que não é mais idêntico.
  it('cellXfs é igual, entrada por entrada, ao do modelo', async () => {
    const { styles } = await gerar([LINHA_BASE])
    const modelo = await partesDoModelo()
    expect(bloco(styles, 'cellXfs')).toBe(bloco(modelo.styles, 'cellXfs'))
  })

  it('numFmts, fills, borders, cellStyleXfs e cellStyles são iguais aos do modelo', async () => {
    const { styles } = await gerar([LINHA_BASE])
    const modelo = await partesDoModelo()
    for (const tag of ['numFmts', 'fills', 'borders', 'cellStyleXfs', 'cellStyles']) {
      expect(bloco(styles, tag), `bloco <${tag}> divergiu do modelo`)
        .toBe(bloco(modelo.styles, tag))
    }
  })

  // As TRÊS únicas trocas permitidas, documentadas no cabeçalho do STYLES_XML:
  // a cor de tema vira preto literal, o `scheme` sai e a dica `x14ac:knownFonts`
  // sai (o namespace dela não é declarado, e mantê-la invalidaria o XML). Este
  // teste prova que são as ÚNICAS — aplica as três no modelo e exige igualdade.
  // Qualquer quarta diferença, mesmo cosmética, estoura aqui.
  it('fonts é o do modelo com as três trocas documentadas, e só elas', async () => {
    const { styles } = await gerar([LINHA_BASE])
    const modelo = await partesDoModelo()
    const esperado = bloco(modelo.styles, 'fonts')
      .replace(/<color theme="1"\/>/g, '<color rgb="FF000000"/>')
      .replace(/<scheme val="minor"\/>/g, '')
      .replace(/ x14ac:knownFonts="1"/g, '')
    expect(bloco(styles, 'fonts')).toBe(esperado)
  })

  // Sem isto o arquivo depende do `xl/theme/theme1.xml`, que NÃO empacotamos —
  // e o Excel abriria pedindo reparo.
  it('não sobrou referência a tema em lugar nenhum', async () => {
    const { styles } = await gerar([LINHA_BASE])
    expect(styles).not.toContain('theme=')
    expect(styles).not.toContain('<scheme')
  })
})

describe('cabeçalho igual ao do modelo', () => {
  it('os 18 títulos são os mesmos, na mesma ordem', async () => {
    const modelo = await partesDoModelo()
    const linha1 = modelo.sheet.match(/<row r="1"[^>]*>[\s\S]*?<\/row>/)![0]
    const doModelo = [...linha1.matchAll(/<c r="[A-Z]+1" s="\d+" t="s"><v>(\d+)<\/v><\/c>/g)]
      .map(m => modelo.shared[Number(m[1])])
    expect(doModelo).toHaveLength(18)
    // Inclui o espaço no fim de 'BANCO ' — está assim no modelo.
    expect(HEADERS_LIVRO_CAIXA).toEqual(doModelo)
  })

  it('os estilos do cabeçalho são os mesmos do modelo, coluna por coluna', async () => {
    const { sheet } = await gerar([LINHA_BASE])
    const modelo = await partesDoModelo()
    expect(estilosDaLinha(sheet, 1)).toEqual(estilosDaLinha(modelo.sheet, 1))
  })

  it('o amarelo (fillId 2, estilo 1 ou 3) cai nas 10 colunas de preencher à mão', async () => {
    const { sheet } = await gerar([LINHA_BASE])
    const amarelas = estilosDaLinha(sheet, 1)
      .map((s, i) => (s === 1 || s === 3 ? HEADERS_LIVRO_CAIXA[i] : null))
      .filter(Boolean)
    expect(amarelas).toEqual([
      'BANCO ', 'AG', 'CC', 'CUSTO/RECEITA', 'TRANSAÇÃO',
      'C/D', 'CC', 'OBS', 'TERCEIRO', 'IMÓVEL',
    ])
  })
})

describe('estilos do corpo', () => {
  // Lê a LINHA 6 DO MODELO do disco, em vez de comparar com uma lista digitada
  // à mão. É a regra que o código diz seguir (ver o comentário de COLUNAS), e
  // aqui ela vira contrato: trocar o modelo versionado quebra este teste em vez
  // de deixá-lo verde mentindo. Achado 5 do Apolo — o teste do cabeçalho ao
  // lado já lia o disco; o do corpo era o único que não.
  const COLUNAS_DE_DATA = [3, 4, 5] // D, E, F — a exceção declarada, ver abaixo

  it('cada coluna usa o estilo da linha 6 do modelo', async () => {
    const { sheet } = await gerar([LINHA_BASE])
    const modelo = await partesDoModelo()
    const doModelo = estilosDaLinha(modelo.sheet, 6)
    const nosso = estilosDaLinha(sheet, 2)
    const semAsDatas = (lista: number[]) => lista.filter((_, i) => !COLUNAS_DE_DATA.includes(i))
    expect(semAsDatas(nosso)).toEqual(semAsDatas(doModelo))
  })

  // A ÚNICA divergência permitida contra a linha 6. As três são a mesma data
  // partida em três colunas: copiar a inconsistência do modelo (que usa `s=7`
  // em DIA e `s=11` em MÊS/ANO nas linhas de dado) faria uma alinhar diferente
  // das irmãs. Ambos os índices existem no modelo e exibem 2026 igual.
  it('DIA, MÊS e ANO usam s=11 nas três — a exceção declarada', async () => {
    const { sheet } = await gerar([LINHA_BASE])
    const nosso = estilosDaLinha(sheet, 2)
    expect(COLUNAS_DE_DATA.map(i => nosso[i])).toEqual([11, 11, 11])
    // E o s=11 tem que existir no modelo — a exceção é escolher outro índice
    // DELE, nunca inventar um.
    const modelo = await partesDoModelo()
    expect(estilosDaLinha(modelo.sheet, 4)).toContain(11)
  })

  it('VALOR negativo usa o estilo vinho da linha 6 do modelo', async () => {
    const { sheet } = await gerar([{ valor: -1 }])
    const modelo = await partesDoModelo()
    expect(estilosDaLinha(sheet, 2)[11]).toBe(estilosDaLinha(modelo.sheet, 6)[11])
  })

  // Todo índice usado tem que EXISTIR no modelo — é a diferença entre copiar e
  // inventar. `cellXfs` do modelo tem 16 entradas (0 a 15).
  it('nenhum índice usado foi inventado', async () => {
    const { sheet } = await gerar([LINHA_BASE, { valor: 10 }])
    const modelo = await partesDoModelo()
    const quantos = Number(bloco(modelo.styles, 'cellXfs').match(/count="(\d+)"/)![1])
    const usados = [...estilosDaLinha(sheet, 1), ...estilosDaLinha(sheet, 2), ...estilosDaLinha(sheet, 3)]
    expect(Math.max(...usados)).toBeLessThan(quantos)
  })
})

describe('larguras de coluna copiadas do modelo', () => {
  it('o bloco <cols> é idêntico', async () => {
    const { sheet } = await gerar([LINHA_BASE])
    const modelo = await partesDoModelo()
    expect(bloco(sheet, 'cols')).toBe(bloco(modelo.sheet, 'cols'))
  })
})

describe('o que o modelo NÃO tem', () => {
  it('não põe painel congelado nem autofiltro', async () => {
    const { sheet } = await gerar([LINHA_BASE])
    const modelo = await partesDoModelo()
    // Confirma primeiro que o modelo realmente não tem — o teste vale pelo
    // motivo, não pelo texto.
    expect(modelo.sheet).not.toContain('<pane')
    expect(modelo.sheet).not.toContain('<autoFilter')
    expect(sheet).not.toContain('<pane')
    expect(sheet).not.toContain('<autoFilter')
  })
})

// ─── Comportamento das células ────────────────────────────────────────────────

describe('células vazias', () => {
  // A borda da grade vem do ESTILO da célula. `lib/xlsx.ts` omite célula vazia
  // para economizar bytes; aqui isso abriria buracos brancos no meio da grade
  // toda vez que uma conta não tivesse observação.
  it('saem com o estilo, e não omitidas', async () => {
    const { sheet } = await gerar([{ valor: -100 }])
    expect(celula(sheet, 'A2')).toBe('<c r="A2" s="5"/>')
    expect(celula(sheet, 'O2')).toBe('<c r="O2" s="7"/>')
    // As 18 colunas presentes, mesmo numa linha quase toda vazia.
    expect(estilosDaLinha(sheet, 2)).toHaveLength(18)
  })

  // Escrito por ESCAPE e nunca como caractere literal — controle invisível some
  // numa cópia, e o teste ficaria verde sem exercitar a limpeza. Mesma lição do
  // NBSP em `lib/numeros-br.ts`. Achado 7 do Apolo.
  it('texto feito só de caractere de controle vira célula vazia com estilo', async () => {
    const { sheet } = await gerar([{ historico: '\u0001\u0002', valor: -1 }])
    expect(celula(sheet, 'H2')).toBe('<c r="H2" s="7"/>')
  })

  // O caso MISTURADO é o único que distingue "limpou os controles" de "a string
  // já era vazia" — sem ele o teste acima passa igual com `historico: ''`.
  it('caractere de controle no MEIO do texto some, e o resto fica', async () => {
    const { sheet } = await gerar([{ historico: 'A\u0001B', valor: -1 }])
    const h2 = celula(sheet, 'H2')
    expect(h2).toContain('>AB<')
    expect(h2).not.toContain('\u0001')
  })
})

describe('coluna C/D', () => {
  it('é fórmula de verdade, apontando para a linha certa da coluna L', async () => {
    const { sheet } = await gerar([LINHA_BASE, LINHA_BASE])
    expect(celula(sheet, 'M2')).toContain('<f>IF(L2&gt;0,"C","D")</f>')
    expect(celula(sheet, 'M3')).toContain('<f>IF(L3&gt;0,"C","D")</f>')
  })

  it('traz o valor em cache — D para custo, C para receita', async () => {
    const { sheet } = await gerar([{ valor: -720.15 }, { valor: 7944.1 }])
    expect(celula(sheet, 'M2')).toContain('<v>D</v>')
    expect(celula(sheet, 'M3')).toContain('<v>C</v>')
  })

  // Sem valor a célula L fica vazia, e vazio não é maior que zero: o Excel
  // calcularia "D". O cache tem que dizer a mesma coisa.
  it('sem valor, o cache é D — igual ao que o Excel calcularia', async () => {
    const { sheet } = await gerar([{ valor: null }])
    expect(celula(sheet, 'M2')).toContain('<v>D</v>')
    expect(celula(sheet, 'L2')).toBe('<c r="L2" s="10"/>')
  })
})

describe('coluna VALOR', () => {
  it('troca de estilo pelo sinal — vinho no custo, azul na receita', async () => {
    const { sheet } = await gerar([{ valor: -720.15 }, { valor: 7944.1 }])
    expect(celula(sheet, 'L2')).toBe('<c r="L2" s="10"><v>-720.15</v></c>')
    expect(celula(sheet, 'L3')).toBe('<c r="L3" s="9"><v>7944.1</v></c>')
  })

  it('NaN e Infinity viram célula vazia em vez de corromper o XML', async () => {
    const { sheet } = await gerar([{ valor: Number.NaN }, { valor: Number.POSITIVE_INFINITY }])
    expect(celula(sheet, 'L2')).toBe('<c r="L2" s="10"/>')
    expect(celula(sheet, 'L3')).toBe('<c r="L3" s="10"/>')
  })
})

describe('DIA / MÊS / ANO', () => {
  it('saem como três números, com o mês em base 1', async () => {
    const { sheet } = await gerar([{ data: new Date(2026, 7, 14, 12, 0, 0), valor: -1 }])
    expect(celula(sheet, 'D2')).toBe('<c r="D2" s="11"><v>14</v></c>')
    expect(celula(sheet, 'E2')).toBe('<c r="E2" s="11"><v>8</v></c>') // agosto, não 7
    expect(celula(sheet, 'F2')).toBe('<c r="F2" s="11"><v>2026</v></c>')
  })

  it('sem data, as três saem vazias mas com borda', async () => {
    const { sheet } = await gerar([{ valor: -1 }])
    expect(celula(sheet, 'D2')).toBe('<c r="D2" s="11"/>')
    expect(celula(sheet, 'E2')).toBe('<c r="E2" s="11"/>')
    expect(celula(sheet, 'F2')).toBe('<c r="F2" s="11"/>')
  })
})

describe('texto', () => {
  // A ÚNICA fórmula deste gerador é a da coluna C/D, montada por ele mesmo.
  // Texto vindo do banco é sempre texto: nome de fornecedor que começa com '='
  // viraria fórmula quebrada — ou pior, fórmula que roda.
  it('histórico começando com = entra como texto, não como fórmula', async () => {
    const { sheet } = await gerar([{ historico: '=SOMA(A1:A9)', valor: -1 }])
    const h2 = celula(sheet, 'H2')
    expect(h2).toContain('t="inlineStr"')
    expect(h2).toContain('=SOMA(A1:A9)')
    expect(h2).not.toContain('<f>')
  })

  it('Nº documento continua texto, preservando zero à esquerda', async () => {
    const { sheet } = await gerar([{ numeroDocumento: '004521', valor: -1 }])
    expect(celula(sheet, 'K2')).toContain('>004521<')
    expect(celula(sheet, 'K2')).toContain('t="inlineStr"')
  })

  it('escapa & < > e some com surrogate solto', async () => {
    const { sheet } = await gerar([{ historico: 'A & B <c> \uD800', valor: -1 }])
    const h2 = celula(sheet, 'H2')
    expect(h2).toContain('A &amp; B &lt;c&gt;')
    expect(h2).not.toContain('\uD800')
  })
})

describe('estrutura da planilha', () => {
  it('a dimensão cobre as 18 colunas e todas as linhas', async () => {
    const { sheet } = await gerar([LINHA_BASE, LINHA_BASE, LINHA_BASE])
    expect(sheet).toContain('<dimension ref="A1:R4"/>')
  })

  it('a aba se chama Sheet1, como no modelo', async () => {
    const blob = await gerarLivroCaixa([LINHA_BASE])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const wb = await zip.file('xl/workbook.xml')!.async('string')
    expect(wb).toContain('name="Sheet1"')
  })

  it('não empacota theme1.xml nem sharedStrings — o arquivo é autocontido', async () => {
    const blob = await gerarLivroCaixa([LINHA_BASE])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('xl/theme/theme1.xml')).toBeNull()
    expect(zip.file('xl/sharedStrings.xml')).toBeNull()
  })

  // Planilha só com cabeçalho baixada em silêncio é pior que erro na tela —
  // ela vai anexada num e-mail antes de alguém reparar.
  it('estoura com lista vazia em vez de gerar arquivo só com cabeçalho', async () => {
    await expect(gerarLivroCaixa([])).rejects.toThrow('xlsx-livro-caixa.ts')
  })
})
