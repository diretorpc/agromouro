// Geração de arquivo .xlsx no navegador, sem biblioteca de planilha.
//
// POR QUE NA UNHA. Um .xlsx é um ZIP com uns poucos arquivos XML dentro — e o
// `jszip` já é dependência do `web/` (usado em `app/(app)/talhoes/page.tsx`
// pra abrir KMZ). As alternativas prontas custam caro pelo que entregam:
// `SheetJS` na versão publicada no npm carrega CVE-2023-30533 (prototype
// pollution) e a versão corrigida só existe fora do registro; `exceljs` (que
// a API já usa no servidor) leva ~2 MB pro bundle do navegador. Escrever os
// cinco XMLs mínimos custa este arquivo, e ele é coberto por `xlsx.test.ts`.
//
// O QUE ISTO NÃO FAZ: fórmula, aba múltipla, cor de célula, imagem. Se um dia
// precisar de qualquer um desses, é hora de reconsiderar a biblioteca — não
// de esticar este arquivo.

/** `null` vira célula VAZIA (não a palavra "null" nem zero). */
export type CelulaXlsx = string | number | Date | null

export type ColunaXlsx<T> = {
  header: string
  valor: (linha: T) => CelulaXlsx
  /** Largura em caracteres. Sem isto o Excel abre tudo no padrão estreito. */
  largura?: number
}

// ─── Escapes ──────────────────────────────────────────────────────────────────

// XML 1.0 PROÍBE quase todo caractere de controle — e não existe escape que os
// salve: `&#1;` é igualmente inválido. Um único deles no arquivo faz o Excel
// recusar a planilha inteira com "formato não reconhecido", sem dizer onde.
// Descrição de extrato de banco chega com lixo assim mais vezes do que parece,
// então some com eles ANTES de escapar o resto. TAB (09), LF (0A) e CR (0D)
// são os únicos permitidos e ficam.
//
// Tres familias, todas escritas por CODIGO e nunca como caractere literal
// (caractere invisivel some numa copia -- licao do NBSP em `lib/numeros-br.ts`):
//   1. os controles C0;
//   2. U+FFFE e U+FFFF, que a producao `Char` do XML 1.0 tambem exclui;
//   3. surrogate SOLTO (metade de um par). Este e o mais traicoeiro: no
//      navegador o jszip codifica com o `string2buf` do pako, que transforma
//      surrogate solto em CESU-8 -- bytes que NAO sao UTF-8 valido, e o
//      arquivo deixa de abrir em parser estrito. Em Node o jszip desvia pro
//      `Buffer`, que troca por U+FFFD e passa batido: por isso o teste do
//      caminho do navegador forca `support.nodebuffer = false`.
//
// SEM lookbehind, de proposito. A 1a versao usava `(?<!...)` e a revisao do
// Apolo (25/08/2026) provou o estrago: o JavaScriptCore so entende lookbehind
// a partir do Safari 16.4, e regex e SINTAXE -- em engine mais velha o modulo
// nem carrega. Como `xlsx.ts` e import estatico do `page.tsx` e os dois caem no
// MESMO pedaco do bundle (conferido no `.next/`), um iPhone parado no iOS 15
// nao perderia o botao: perderia a tela de Cartoes inteira, em branco.
//
// O truque que dispensa a assercao: casar o PAR VALIDO antes do surrogate
// solto. Quem casa com 2 code units fica; quem casa com 1 sai.
const CONTROLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g

/** Par de surrogates valido (2 code units) fica; qualquer outro casamento sai. */
function limpar(trecho: string): string {
  return trecho.length === 2 ? trecho : ''
}

function esc(texto: string): string {
  return texto
    .replace(CONTROLE, limpar)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // A aspa dupla é a única que quebra SINTAXE, porque este mesmo `esc` é
    // usado dentro de atributo (`<sheet name="...">`). Em conteúdo de
    // elemento o escape é inofensivo, então uma função só serve aos dois.
    .replace(/"/g, '&quot;')
}

// ─── Endereço de célula ───────────────────────────────────────────────────────

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function letraColuna(indice: number): string {
  let n = indice + 1
  let saida = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    saida = String.fromCharCode(65 + resto) + saida
    n = Math.floor((n - 1) / 26)
  }
  return saida
}

// ─── Data → número de série do Excel ──────────────────────────────────────────

// O Excel conta dias desde 1899-12-30 (não 01-01: a contagem dele inclui um
// 29/02/1900 que nunca existiu, e a época deslocada compensa isso).
//
// Lê ANO/MÊS/DIA no fuso LOCAL de propósito. Usar `getTime()` direto jogaria a
// data pra trás no Brasil (UTC-3) e o dia 1º viraria o último dia do mês
// anterior — o mesmo bug de fuso que já apareceu no Financeiro em junho/2026.
//
// LIMITE CONHECIDO E ACEITO: antes de 01/03/1900 o serial fica 1 dia à frente
// do que o Excel mostra (a época deslocada compensa um 29/02/1900 que só
// "existe" a partir de março), e antes de 30/12/1899 ele fica NEGATIVO, que o
// Excel não sabe exibir como data — a célula vira `########`. Nenhum dos dois
// é alcançável por lançamento de cartão. Se este helper for reusado para dado
// histórico de verdade, é aqui que se mexe.
const EPOCA_EXCEL = Date.UTC(1899, 11, 30)

export function dataParaSerial(d: Date): number {
  const meiaNoiteLocal = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((meiaNoiteLocal - EPOCA_EXCEL) / 86_400_000)
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

// Índices de `cellXfs` referenciados pelo atributo `s` das células.
const ESTILO_PADRAO = 0
const ESTILO_CABECALHO = 1
const ESTILO_DATA = 2
const ESTILO_VALOR = 3
// Negrito + moeda, só para o total do rodapé. Sem um xf próprio seria preciso
// escolher entre negrito (perdendo as duas casas decimais) e moeda (perdendo o
// destaque) — e um total que não parece total passa batido em relatório.
const ESTILO_VALOR_NEGRITO = 4

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
// Os dois `fill` acima não são decoração: o Excel exige que os índices 0
// (`none`) e 1 (`gray125`) existam e recusa o arquivo se faltarem.
// A data usa formato PRÓPRIO (`dd/mm/yyyy`, id 165) em vez do embutido id 14.
// O id 14 é a "data curta" do sistema: quem abrir num Excel configurado em
// inglês lê 06-15-26 no lugar de 15/06/2026 — e um relatório de gasto com
// data ambígua é pior que sem data. Cravado, sai igual em qualquer máquina.

// ─── Nome da aba ──────────────────────────────────────────────────────────────

// O Excel recusa aba com mais de 31 caracteres ou com `: \ / ? * [ ]`.
function nomeAbaSeguro(bruto: string): string {
  const limpo = bruto.replace(/[:\\/?*[\]]/g, '-').trim()
  return (limpo || 'Planilha').slice(0, 31)
}

// ─── Limites do Excel ─────────────────────────────────────────────────────────

// Passar destes números não dá erro na geração: o Excel abre o arquivo, avisa
// que precisou "reparar" e descarta conteúdo por conta própria. Cortar aqui é
// perder o excesso de forma previsível em vez de perder o arquivo.
const MAX_CARACTERES_CELULA = 32_767
const MAX_LARGURA_COLUNA = 255

// ─── Geração ──────────────────────────────────────────────────────────────────

function celula(ref: string, valor: CelulaXlsx, negrito = false): string {
  if (valor === null || valor === undefined) return ''

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return ''
    return `<c r="${ref}" s="${ESTILO_DATA}"><v>${dataParaSerial(valor)}</v></c>`
  }

  if (typeof valor === 'number') {
    // NaN/Infinity não têm representação em XML de planilha — vira vazio em
    // vez de corromper o arquivo.
    if (!Number.isFinite(valor)) return ''
    return `<c r="${ref}" s="${negrito ? ESTILO_VALOR_NEGRITO : ESTILO_VALOR}"><v>${valor}</v></c>`
  }

  // `inlineStr` em vez de `sharedStrings`: dispensa um XML inteiro e a tabela
  // de índices. Custa alguns bytes a mais no arquivo — irrelevante nesta
  // escala, e o arquivo ainda passa pelo DEFLATE do zip.
  //
  // Nunca emite `<f>`: descrição de extrato que começa com `=`, `+`, `-` ou
  // `@` entra como TEXTO, não como fórmula.
  // Corta ANTES de escapar. Na ordem inversa, o corte cairia no meio de uma
  // entidade (`&amp;` virando `&am`) e o XML quebraria — e o limite do Excel
  // é de CARACTERES do texto, não de bytes do XML, então esta é a medida certa.
  const texto = esc(valor.slice(0, MAX_CARACTERES_CELULA))

  // Vazio é célula AUSENTE, igual ao `null`. E o teste vem DEPOIS do escape de
  // propósito: uma descrição feita só de caracteres de controle chega aqui
  // não-vazia e sai vazia. Uma célula com string vazia não é "em branco" pro
  // Excel — `ÉCÉL.VAZIA()` responde FALSO e `CONT.VALORES` conta a linha.
  if (texto === '') return ''

  return `<c r="${ref}" t="inlineStr" s="${negrito ? ESTILO_CABECALHO : ESTILO_PADRAO}"><is><t xml:space="preserve">${texto}</t></is></c>`
}

function montarPlanilha<T>(colunas: ColunaXlsx<T>[], linhas: T[], rodape: CelulaXlsx[][]): string {
  const ultimaColuna = letraColuna(colunas.length - 1)
  // Última linha de DADOS — o rodapé fica de fora de propósito (ver o comentário
  // do autoFilter lá embaixo).
  const ultimaLinha = linhas.length + 1

  const cols = colunas
    .map((c, i) => {
      const w = Math.min(MAX_LARGURA_COLUNA, Math.max(1, c.largura ?? 18))
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
    })
    .join('')

  const cabecalho =
    `<row r="1">` +
    colunas
      .map((c, i) => `<c r="${letraColuna(i)}1" t="inlineStr" s="${ESTILO_CABECALHO}"><is><t>${esc(c.header)}</t></is></c>`)
      .join('') +
    `</row>`

  const corpo = linhas
    .map((linha, iLinha) => {
      const r = iLinha + 2 // linha 1 é o cabeçalho
      const celulas = colunas.map((c, iCol) => celula(`${letraColuna(iCol)}${r}`, c.valor(linha))).join('')
      return `<row r="${r}">${celulas}</row>`
    })
    .join('')

  // O rodapé (total) entra DEPOIS dos dados e nunca vira linha de dado: quem
  // chama passa as células já prontas, incluindo a linha em branco que separa.
  // Linha mais curta que o número de colunas é normal — o total ocupa duas ou
  // três células, não a largura toda.
  const rodapeXml = rodape
    .map((celulasDaLinha, iLinha) => {
      const r = linhas.length + 2 + iLinha
      const celulas = celulasDaLinha
        .slice(0, colunas.length)
        .map((v, iCol) => celula(`${letraColuna(iCol)}${r}`, v, true))
        .join('')
      return `<row r="${r}">${celulas}</row>`
    })
    .join('')

  // A ordem das tags abaixo NÃO é livre — o schema do OOXML exige
  // sheetViews → cols → sheetData → autoFilter, nesta sequência. Fora de
  // ordem, o Excel recusa o arquivo.
  // `pane` congela a linha 1: rolando 400 lançamentos, o cabeçalho fica.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${cabecalho}${corpo}${rodapeXml}</sheetData>
<autoFilter ref="A1:${ultimaColuna}${ultimaLinha}"/>
</worksheet>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const RELS_RAIZ = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const RELS_WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

export const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Monta um .xlsx de uma aba só.
 *
 * Valor numérico sai como NÚMERO e data sai como DATA — o Excel soma, ordena e
 * filtra sem ninguém precisar converter coluna na mão do outro lado.
 */
export async function gerarXlsx<T>(
  colunas: ColunaXlsx<T>[],
  linhas: T[],
  nomeAba = 'Planilha',
  /**
   * Linhas soltas depois dos dados (total, assinatura, aviso). Ficam FORA do
   * autoFilter: dentro dele, ordenar a planilha jogaria o total pro meio dos
   * lançamentos e o número deixaria de bater com a coluna que ele soma.
   * Não são calculadas aqui — quem chama já manda o número pronto.
   */
  rodape: CelulaXlsx[][] = [],
): Promise<Blob> {
  if (colunas.length === 0) throw new Error('gerarXlsx: nenhuma coluna informada.')

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.folder('_rels')!.file('.rels', RELS_RAIZ)
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(nomeAbaSeguro(nomeAba))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  )
  zip.file('xl/_rels/workbook.xml.rels', RELS_WORKBOOK)
  zip.file('xl/styles.xml', STYLES_XML)
  zip.file('xl/worksheets/sheet1.xml', montarPlanilha(colunas, linhas, rodape))

  // `uint8array` e não `blob`: o `blob` do jszip só existe no navegador, e o
  // teste roda em Node. Envelopar num Blob depois funciona nos dois.
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return new Blob([bytes as unknown as BlobPart], { type: MIME_XLSX })
}

/** Dispara o download no navegador. */
export function baixarBlob(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Sem o revoke, o blob fica preso na memória da aba até dar F5. Adiado
  // porque o Firefox cancela o download se a URL morre no mesmo tique.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
