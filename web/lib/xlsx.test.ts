import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { gerarXlsx, letraColuna, dataParaSerial, MIME_XLSX, type ColunaXlsx } from '@/lib/xlsx'

// O .xlsx é montado na unha (ver o cabeçalho de `xlsx.ts`): um caractere de
// controle ou uma tag fora de ordem faz o Excel recusar o arquivo INTEIRO com
// "formato não reconhecido", sem dizer onde. Não dá pra revisar isso a olho —
// daí estes testes abrirem o zip e conferirem o XML de dentro.

type Linha = { data: Date | null; texto: string; valor: number | null }

const COLUNAS: ColunaXlsx<Linha>[] = [
  { header: 'Data',  valor: l => l.data },
  { header: 'Texto', valor: l => l.texto },
  { header: 'Valor', valor: l => l.valor },
]

async function abrirPlanilha(linhas: Linha[]): Promise<string> {
  const blob = await gerarXlsx(COLUNAS, linhas, 'Lançamentos')
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const sheet = zip.file('xl/worksheets/sheet1.xml')
  expect(sheet).not.toBeNull()
  return sheet!.async('string')
}

describe('letraColuna', () => {
  it('vai de A a Z e continua em AA', () => {
    expect(letraColuna(0)).toBe('A')
    expect(letraColuna(25)).toBe('Z')
    expect(letraColuna(26)).toBe('AA')
    expect(letraColuna(27)).toBe('AB')
    expect(letraColuna(51)).toBe('AZ')
    expect(letraColuna(52)).toBe('BA')
  })
})

describe('dataParaSerial', () => {
  // 45292 é o número de série conhecido de 01/01/2024 no calendário do Excel.
  it('converte para o número de série do Excel', () => {
    expect(dataParaSerial(new Date(2024, 0, 1, 12, 0, 0))).toBe(45292)
  })

  // O bug de fuso que já apareceu no Financeiro: com UTC-3, ler a data pelo
  // timestamp joga o dia 1º pro último dia do mês anterior.
  it('não escorrega um dia por causa do fuso', () => {
    expect(dataParaSerial(new Date(2024, 0, 1, 0, 0, 0))).toBe(45292)
    expect(dataParaSerial(new Date(2024, 0, 1, 23, 59, 59))).toBe(45292)
  })
})

describe('gerarXlsx — estrutura do pacote', () => {
  it('gera um zip com todas as peças que o Excel exige', async () => {
    const blob = await gerarXlsx(COLUNAS, [], 'Teste')
    expect(blob.type).toBe(MIME_XLSX)

    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    for (const parte of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(zip.file(parte), `faltou ${parte}`).not.toBeNull()
    }
  })

  // Sem isto, quem abrir num Excel em inglês lê 06-15-26 no lugar de
  // 15/06/2026 — data ambígua num relatório de gasto é pior que data nenhuma.
  it('crava dd/mm/yyyy na coluna de data em vez do formato do sistema', async () => {
    const blob = await gerarXlsx(COLUNAS, [], 'Teste')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const estilos = await zip.file('xl/styles.xml')!.async('string')
    expect(estilos).toContain('numFmtId="165" formatCode="dd/mm/yyyy"')
    expect(estilos).toContain('<xf numFmtId="165"')
    expect(estilos).not.toContain('numFmtId="14"')
  })

  it('recusa planilha sem coluna nenhuma', async () => {
    await expect(gerarXlsx([], [])).rejects.toThrow(/nenhuma coluna/)
  })

  it('respeita a ordem que o schema do OOXML exige', async () => {
    const xml = await abrirPlanilha([])
    const ordem = ['<sheetViews', '<cols>', '<sheetData>', '<autoFilter']
    const posicoes = ordem.map(t => xml.indexOf(t))
    expect(posicoes.every(p => p >= 0)).toBe(true)
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes)
  })

  it('encurta e limpa nome de aba que o Excel recusaria', async () => {
    const blob = await gerarXlsx(COLUNAS, [], 'Aba: com / caracteres * proibidos e nome comprido demais')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const wb = await zip.file('xl/workbook.xml')!.async('string')
    const nome = /name="([^"]*)"/.exec(wb)?.[1] ?? ''
    expect(nome.length).toBeLessThanOrEqual(31)
    expect(nome).not.toMatch(/[:\\/?*[\]]/)
  })
})

describe('gerarXlsx — células', () => {
  const UMA: Linha = { data: new Date(2024, 0, 1, 12), texto: 'Posto Shell', valor: 1234.56 }

  it('grava número como NÚMERO, não como texto', async () => {
    const xml = await abrirPlanilha([UMA])
    expect(xml).toContain('<c r="C2" s="3"><v>1234.56</v></c>')
    expect(xml).not.toContain('<t xml:space="preserve">1234.56</t>')
  })

  it('grava data como DATA, não como texto', async () => {
    const xml = await abrirPlanilha([UMA])
    expect(xml).toContain('<c r="A2" s="2"><v>45292</v></c>')
  })

  it('grava texto como inlineStr', async () => {
    const xml = await abrirPlanilha([UMA])
    expect(xml).toContain('<t xml:space="preserve">Posto Shell</t>')
  })

  it('numera as linhas a partir da 2 (a 1 é o cabeçalho)', async () => {
    const xml = await abrirPlanilha([UMA, UMA])
    expect(xml).toContain('<row r="1">')
    expect(xml).toContain('<row r="2">')
    expect(xml).toContain('<row r="3">')
    expect(xml).toContain('<c r="A1" t="inlineStr" s="1">')
  })

  it('o autoFilter cobre exatamente o intervalo preenchido', async () => {
    const xml = await abrirPlanilha([UMA, UMA, UMA])
    expect(xml).toContain('<autoFilter ref="A1:C4"/>')
  })
})

// Lacuna descoberta na revisão (25/08/2026): o `jszip` tem DOIS caminhos de
// codificação de texto — `Buffer.from()` em Node e o `string2buf` do pako no
// navegador. Como o vitest roda em `node`, todos os testes acima exercitam o
// caminho que a PRODUÇÃO NÃO USA: o `Buffer` conserta entrada estranha
// sozinho (troca por U+FFFD) e esconde defeito que no navegador corromperia o
// arquivo. Este bloco desliga o desvio e força o caminho real.
describe('gerarXlsx — caminho de codificação do NAVEGADOR', () => {
  it('gera UTF-8 válido mesmo com entrada estranha', async () => {
    // @ts-expect-error o jszip não publica tipos para seus módulos internos
    const support = (await import('jszip/lib/support.js')).default as { nodebuffer: boolean }
    const original = support.nodebuffer
    support.nodebuffer = false
    try {
      const blob = await gerarXlsx(
        COLUNAS,
        [{ data: null, texto: 'PAGTO ' + String.fromCharCode(0xd83d) + ' 🚜 M&M', valor: 1 }],
        'Teste',
      )
      const zip = await JSZip.loadAsync(await blob.arrayBuffer())
      const bytes = await zip.file('xl/worksheets/sheet1.xml')!.async('uint8array')
      // `fatal: true` recusa qualquer byte que não seja UTF-8 legítimo — é o
      // que um parser XML estrito faria.
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      expect(xml).toContain('PAGTO  🚜 M&amp;M')
    } finally {
      support.nodebuffer = original
    }
  })
})

describe('gerarXlsx — entrada suja não corrompe o arquivo', () => {
  it('escapa & < > e aspa no texto', async () => {
    const xml = await abrirPlanilha([
      { data: null, texto: 'M&M <Peças> "Ltda"', valor: null },
    ])
    expect(xml).toContain('M&amp;M &lt;Peças&gt; &quot;Ltda&quot;')
    expect(xml).not.toContain('<Peças>')
  })

  it('remove caracteres de controle, que o XML 1.0 proíbe', async () => {
    const sujo = 'AB' + String.fromCharCode(0) + 'CD' + String.fromCharCode(7) + 'EF'
    const xml = await abrirPlanilha([{ data: null, texto: sujo, valor: null }])
    expect(xml).toContain('<t xml:space="preserve">ABCDEF</t>')
    expect([...xml].some(c => c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c))).toBe(false)
  })

  // A aspa é a única que quebra SINTAXE, porque o nome da aba é interpolado
  // dentro de um atributo. Sem escape, o XML fica malformado e o Excel recusa
  // a planilha inteira.
  it('escapa aspa dupla no nome da aba', async () => {
    const blob = await gerarXlsx(COLUNAS, [], 'Cartão "Ivan"')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const wb = await zip.file('xl/workbook.xml')!.async('string')
    expect(wb).toContain('name="Cartão &quot;Ivan&quot;"')
    // O que quebrava antes: a aspa crua fechava o atributo cedo demais e
    // sobrava lixo solto dentro da tag.
    expect(wb).not.toContain('name="Cartão "Ivan""')
  })

  it('remove U+FFFE e U+FFFF, que o XML 1.0 também proíbe', async () => {
    const xml = await abrirPlanilha([
      { data: null, texto: 'A' + String.fromCharCode(0xfffe) + 'B' + String.fromCharCode(0xffff) + 'C', valor: null },
    ])
    expect(xml).toContain('<t xml:space="preserve">ABC</t>')
  })

  // Surrogate solto (metade de um par) vira CESU-8 no navegador — bytes que
  // não são UTF-8 válido — e o arquivo deixa de abrir.
  it('remove surrogate solto', async () => {
    const xml = await abrirPlanilha([
      { data: null, texto: 'PAGTO ' + String.fromCharCode(0xd83d) + ' LTDA', valor: null },
    ])
    expect(xml).toContain('<t xml:space="preserve">PAGTO  LTDA</t>')
    expect([...xml].some(c => c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)).toBe(false)
  })

  it('mantém emoji inteiro (par de surrogates válido)', async () => {
    const xml = await abrirPlanilha([{ data: null, texto: 'OK 🚜', valor: null }])
    expect(xml).toContain('OK 🚜')
  })

  // O caso que a versão com lookbehind existia para resolver e que a versão
  // sem lookbehind precisa resolver igual: high solto ENCOSTADO num par válido.
  it('separa surrogate solto grudado num par válido', async () => {
    const alto = String.fromCharCode(0xd83d)
    const xml = await abrirPlanilha([{ data: null, texto: 'X' + alto + '🚜Y', valor: null }])
    expect(xml).toContain('<t xml:space="preserve">X🚜Y</t>')
  })

  it('remove surrogate baixo solto que vem depois de um par válido', async () => {
    const baixo = String.fromCharCode(0xdc00)
    const xml = await abrirPlanilha([{ data: null, texto: '🚜' + baixo + 'Z', valor: null }])
    expect(xml).toContain('<t xml:space="preserve">🚜Z</t>')
  })

  // A regex é SINTAXE: se voltar a usar lookbehind, o módulo nem carrega em
  // Safari < 16.4 — e como `xlsx.ts` cai no mesmo pedaço do bundle que a
  // página, a tela de Cartões inteira some, não só o botão.
  // Este lê o FONTE, não o comportamento, e é de propósito: lookbehind é
  // sintaxe. Numa engine que não entende (Safari < 16.4, iPhone parado no iOS
  // 15) o módulo não chega a executar — e como `xlsx.ts` cai no mesmo pedaço
  // do bundle que a página, some a tela de Cartões inteira, não só o botão.
  // Nenhum teste de comportamento pega isso: em Node sempre passa.
  it('o fonte não contém lookbehind, que quebra Safari antigo', async () => {
    const { readFileSync } = await import('node:fs')
    const fonte = readFileSync(new URL('./xlsx.ts', import.meta.url), 'utf8')
    const codigo = fonte
      .split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
    expect(codigo).not.toContain('(?<')
  })

  it('texto só de caracteres de controle vira célula ausente', async () => {
    const soLixo = String.fromCharCode(0) + String.fromCharCode(7) + String.fromCharCode(0xffff)
    const xml = await abrirPlanilha([{ data: null, texto: soLixo, valor: 5 }])
    expect(xml).not.toContain('r="B2"')
    expect(xml).not.toContain('<t xml:space="preserve"></t>')
    expect(xml).toContain('<c r="C2" s="3"><v>5</v></c>')
  })

  it('corta texto no teto do Excel sem partir uma entidade no meio', async () => {
    const gigante = '&'.repeat(40_000)
    const xml = await abrirPlanilha([{ data: null, texto: gigante, valor: null }])
    const conteudo = /<c r="B2"[^>]*><is><t[^>]*>([^<]*)</.exec(xml)?.[1] ?? ''
    expect(conteudo).toBe('&amp;'.repeat(32_767))
    expect(conteudo.endsWith('&amp;')).toBe(true)
  })

  it('limita a largura da coluna ao teto do Excel', async () => {
    const blob = await gerarXlsx([{ header: 'X', valor: () => 'x', largura: 400 }], [])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('width="255"')
  })

  it('texto vazio vira célula ausente, para ÉCÉL.VAZIA responder VERDADEIRO', async () => {
    const xml = await abrirPlanilha([{ data: null, texto: '', valor: 10 }])
    expect(xml).not.toContain('r="B2"')
    expect(xml).toContain('<c r="C2" s="3"><v>10</v></c>')
  })

  it('valor nulo vira célula VAZIA — não zero, não a palavra "null"', async () => {
    const xml = await abrirPlanilha([{ data: null, texto: 'só texto', valor: null }])
    expect(xml).toContain('<row r="2">')
    expect(xml).not.toContain('r="A2"')
    expect(xml).not.toContain('r="C2"')
    expect(xml).not.toContain('null')
  })

  it('NaN e data inválida viram célula vazia em vez de arquivo quebrado', async () => {
    const xml = await abrirPlanilha([
      { data: new Date('nada disso'), texto: 'x', valor: Number.NaN },
    ])
    expect(xml).not.toContain('NaN')
    expect(xml).not.toContain('r="A2"')
    expect(xml).not.toContain('r="C2"')
  })
})
