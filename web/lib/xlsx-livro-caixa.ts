// Geração do .xlsx no formato do LIVRO CAIXA — o modelo que o Matheus mandou
// em 01/09/2026 e pediu para copiar "IDÊNTICO".
//
// POR QUE NÃO ESTICAR `lib/xlsx.ts`. Aquele arquivo diz na cara, na linha 13,
// que não faz fórmula, cor de célula nem borda — e é usado TAMBÉM pela
// exportação de Cartões. Trocar os estilos dele mudaria a planilha de Cartões
// de tabela sem ninguém ter pedido. Este módulo é irmão, não substituto.
//
// DE ONDE VÊM OS ESTILOS. Não foram desenhados aqui: o `xl/styles.xml` abaixo é
// cópia do modelo, com duas trocas (ver o comentário do XML). Os índices `s=`
// de cada coluna foram LIDOS das linhas 1 a 6 do modelo. É a diferença entre
// "parecido" e "idêntico" — desenhar fonte, borda e formato contábil na mão
// acerta o visual de longe e erra nos detalhes que o contador percebe.
//
// O modelo está guardado no repositório, ao lado do spec:
//   docs/superpowers/specs/2026-09-01-modelo-extrato-livro-caixa.xlsx
// Para reconferir qualquer número deste arquivo contra ele, descompacte o
// .xlsx (é um zip) e leia `xl/styles.xml` e `xl/worksheets/sheet1.xml`.

import { esc, letraColuna, MIME_XLSX } from './xlsx'

// ─── Uma linha do livro caixa ─────────────────────────────────────────────────

/**
 * Os campos espelham as 18 colunas do modelo, na ordem dele.
 *
 * TODOS opcionais porque 7 das 18 colunas não têm fonte de dado no sistema
 * (BANCO, AG, CC, DEPENDÊNCIA ORIGEM, TERCEIRO, IMÓVEL, INSCRIÇÃO IMÓVEL) — o
 * próprio modelo traz as três últimas vazias. Quando um desses dados existir,
 * é só preencher aqui: nada neste arquivo precisa mudar.
 */
export type LinhaLivroCaixa = {
  banco?: string | null
  agencia?: string | null
  contaCorrente?: string | null
  /** Vira DIA, MÊS e ANO — três colunas, uma data só. */
  data?: Date | null
  dependenciaOrigem?: string | null
  historico?: string | null
  /** 'Custo' ou 'Receita'. */
  custoOuReceita?: string | null
  transacao?: string | null
  numeroDocumento?: string | number | null
  /** NEGATIVO para custo, positivo para receita — é assim que a coluna C/D calcula. */
  valor?: number | null
  centroCusto?: string | null
  observacao?: string | null
  terceiro?: string | null
  imovel?: string | null
  inscricaoImovel?: string | null
}

// ─── Estilos, copiados do modelo ──────────────────────────────────────────────

// Cópia do `xl/styles.xml` do modelo, com TRÊS trocas e nada mais — as três
// travadas por teste em `xlsx-livro-caixa.test.ts`, que lê o modelo do disco:
//
//   1. `<color theme="1"/>`         → `<color rgb="FF000000"/>`
//   2. `<scheme val="minor"/>`      → removido
//   3. `x14ac:knownFonts="1"`       → removido
//
// As duas primeiras apontavam para o `xl/theme/theme1.xml` (8,7 KB de
// definição de tema do Office). Sem elas o arquivo fica autocontido e o
// resultado na tela é o mesmo: o tema 1 do Office É preto, e `scheme` só diz de
// qual fonte do tema o nome saiu — o `<name val="Aptos Narrow"/>` já resolve
// isso sozinho.
//
// A terceira é dica de otimização do Excel num namespace (`x14ac`) que também
// não declaramos. Mantê-la SEM a declaração faria o XML inválido — o Excel
// recusaria o arquivo inteiro. Removida ela, nada muda no que se vê.
//
// Também saíram `dxfs`, `tableStyles` e `extLst`: nenhum é referenciado por
// célula nenhuma, e o `tableStyle` do modelo carrega um GUID de sessão do Excel
// de outra pessoa.
//
// A ORDEM DE `cellXfs` É INTOCÁVEL. O atributo `s=` de cada célula é um índice
// nesta lista — inserir uma entrada no meio repinta a planilha inteira em
// silêncio. Acrescentar no FIM é seguro. Os índices 12, 13 e 14 não são usados
// por nenhuma coluna nossa (ver COLUNAS): ficam porque removê-los moveria o
// 15, que é usado.
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="44" formatCode="_-&quot;R$&quot;\\ * #,##0.00_-;\\-&quot;R$&quot;\\ * #,##0.00_-;_-&quot;R$&quot;\\ * &quot;-&quot;??_-;_-@_-"/></numFmts>
<fonts count="5"><font><sz val="11"/><color rgb="FF000000"/><name val="Aptos Narrow"/><family val="2"/></font><font><sz val="11"/><color rgb="FF000000"/><name val="Aptos Narrow"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Aptos Narrow"/><family val="2"/></font><font><sz val="11"/><color rgb="FF0000FF"/><name val="Aptos Narrow"/><family val="2"/></font><font><sz val="11"/><color rgb="FF990000"/><name val="Aptos Narrow"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="44" fontId="1" fillId="0" borderId="0" applyFont="0" applyFill="0" applyBorder="0" applyAlignment="0" applyProtection="0"/></cellStyleXfs>
<cellXfs count="16"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="44" fontId="2" fillId="0" borderId="1" xfId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="44" fontId="3" fillId="0" borderId="1" xfId="1" applyFont="1" applyBorder="1"/><xf numFmtId="44" fontId="4" fillId="0" borderId="1" xfId="1" applyFont="1" applyBorder="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="44" fontId="4" fillId="0" borderId="1" xfId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs>
<cellStyles count="2"><cellStyle name="Currency" xfId="1" builtinId="4"/><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

// Índice em `cellXfs` da célula de VALOR conforme o SINAL. É padrão observado
// no modelo, não invenção: as duas linhas de Receita (positivas) usam `s=9`,
// fonte 3, azul; as duas de Custo (negativas) usam fonte 4, vinho — `s=14` na
// linha 4 e `s=10` na 5. Fica o `s=10`, que é também o da linha 6 (a regra
// geral desta lista) e não arrasta o alinhamento próprio do `s=14`.
const ESTILO_VALOR_POSITIVO = 9  // fonte 3, azul  — Receita
const ESTILO_VALOR_NEGATIVO = 10 // fonte 4, vinho — Custo

// ─── As 18 colunas ────────────────────────────────────────────────────────────

type Tipo = 'texto' | 'numero' | 'valor' | 'formulaCD'

type ColunaLivroCaixa = {
  /** Texto EXATO do modelo. 'BANCO ' tem espaço no fim de propósito — está assim lá. */
  header: string
  /** Índice em `cellXfs` do cabeçalho (linha 1 do modelo). */
  sHeader: number
  /** Índice em `cellXfs` das células de dado. `valor` decide sozinho, pelo sinal. */
  sDado: number
  tipo: Tipo
  /** O que sai da linha. `null` vira célula vazia — mas COM borda (ver `celula`). */
  extrair: (l: LinhaLivroCaixa) => string | number | null
}

// A REGRA: os índices abaixo são os das LINHAS VAZIAS FORMATADAS do modelo —
// as linhas 6 a 9, que compartilham o mesmo padrão. Precisando de estilo para
// uma coluna nova, é delas que se copia.
//
// NÃO é "o majoritário". Uma primeira versão deste comentário dizia isso, e a
// revisão do Apolo (01/09/2026, achado 4) mediu e desmentiu. Contagem real das
// 229 linhas, refeita aqui:
//     221 linhas (10 a 230) → `s=7` nas 18 colunas: grade vazia, sem formatação
//       4 linhas (6 a 9)    → o padrão que este arquivo copia
//       4 linhas (2 a 5)    → os exemplos preenchidos, e nem eles concordam
// Seguir "majoritário" levaria a próxima pessoa a `s=7` para tudo — que não tem
// cor, nem formato contábil, nem alinhamento —, repintando a planilha em
// silêncio.
//
// As 4 linhas de exemplo também não concordam entre si: DIA aparece com `s=7`
// nas linhas 2, 3 e 5 e com `s=11` na 4; HISTÓRICO com `s=7` em três e `s=13`
// na outra. As linhas 6-9 desempatam. Nenhum índice foi inventado.
//
// UMA EXCEÇÃO DECLARADA: DIA/MÊS/ANO usam `s=11`, e não o `s=7` das linhas 6-9.
// As três são a MESMA data partida em três colunas, e copiar a inconsistência
// do modelo faria uma delas alinhar diferente das irmãs. `s=11` é o que MÊS e
// ANO usam nas linhas 2 e 3 (na 5, MÊS volta a `s=7` — o modelo é assim mesmo).
// Visualmente as duas são equivalentes aqui: `numFmtId=1` e General exibem 2026
// igual, sem separador de milhar. A escolha é por uniformidade, não por
// formatação.
const COLUNAS: ColunaLivroCaixa[] = [
  { header: 'BANCO ',             sHeader: 1, sDado: 5,  tipo: 'texto',     extrair: l => l.banco ?? null },
  { header: 'AG',                 sHeader: 1, sDado: 6,  tipo: 'texto',     extrair: l => l.agencia ?? null },
  { header: 'CC',                 sHeader: 1, sDado: 6,  tipo: 'texto',     extrair: l => l.contaCorrente ?? null },
  { header: 'DIA',                sHeader: 2, sDado: 11, tipo: 'numero',    extrair: l => l.data?.getDate() ?? null },
  // getMonth() é 0-based: agosto volta 7. O modelo grava 8.
  { header: 'MÊS',                sHeader: 2, sDado: 11, tipo: 'numero',    extrair: l => (l.data ? l.data.getMonth() + 1 : null) },
  { header: 'ANO',                sHeader: 2, sDado: 11, tipo: 'numero',    extrair: l => l.data?.getFullYear() ?? null },
  { header: 'DEPENDÊNCIA ORIGEM', sHeader: 2, sDado: 8,  tipo: 'texto',     extrair: l => l.dependenciaOrigem ?? null },
  { header: 'HISTÓRICO',          sHeader: 2, sDado: 7,  tipo: 'texto',     extrair: l => l.historico ?? null },
  { header: 'CUSTO/RECEITA',      sHeader: 3, sDado: 6,  tipo: 'texto',     extrair: l => l.custoOuReceita ?? null },
  { header: 'TRANSAÇÃO',          sHeader: 3, sDado: 6,  tipo: 'texto',     extrair: l => l.transacao ?? null },
  { header: 'Nº DOCUMENTO',       sHeader: 2, sDado: 6,  tipo: 'texto',     extrair: l => l.numeroDocumento ?? null },
  { header: 'VALOR',              sHeader: 4, sDado: 10, tipo: 'valor',     extrair: l => l.valor ?? null },
  { header: 'C/D',                sHeader: 1, sDado: 6,  tipo: 'formulaCD', extrair: l => l.valor ?? null },
  { header: 'CC',                 sHeader: 1, sDado: 15, tipo: 'texto',     extrair: l => l.centroCusto ?? null },
  { header: 'OBS',                sHeader: 1, sDado: 7,  tipo: 'texto',     extrair: l => l.observacao ?? null },
  { header: 'TERCEIRO',           sHeader: 1, sDado: 7,  tipo: 'texto',     extrair: l => l.terceiro ?? null },
  { header: 'IMÓVEL',             sHeader: 1, sDado: 7,  tipo: 'texto',     extrair: l => l.imovel ?? null },
  { header: 'INSCRIÇÃO IMÓVEL',   sHeader: 2, sDado: 7,  tipo: 'texto',     extrair: l => l.inscricaoImovel ?? null },
]

/** Os cabeçalhos, na ordem. Exportado para o teste não redigitar os 18. */
export const HEADERS_LIVRO_CAIXA = COLUNAS.map(c => c.header)

/** Letra da coluna VALOR ('L'), de onde a fórmula da C/D depende. */
const LETRA_VALOR = letraColuna(COLUNAS.findIndex(c => c.tipo === 'valor'))

// Limite do Excel. Passar dele não dá erro na geração: o Excel abre, avisa que
// "reparou" o arquivo e descarta conteúdo por conta própria.
const MAX_CARACTERES_CELULA = 32_767

// ─── Células ──────────────────────────────────────────────────────────────────

/**
 * Uma célula.
 *
 * DIFERENÇA CRÍTICA para `lib/xlsx.ts`: célula vazia sai como `<c r=".." s=".."/>`
 * e NUNCA é omitida. No modelo a borda vem do estilo da célula — omitir a célula
 * vazia (que é o que o outro gerador faz, para economizar bytes) abriria buracos
 * brancos no meio da grade toda vez que uma conta não tivesse fornecedor ou
 * observação. É a coisa que mais salta aos olhos num "idêntico" que não é.
 */
function celula(
  ref: string,
  s: number,
  tipo: Tipo,
  valor: string | number | null,
  linhaExcel: number,
): string {
  const vazia = `<c r="${ref}" s="${s}"/>`

  if (tipo === 'formulaCD') {
    // A ÚNICA fórmula que este gerador emite, e ela não toca em dado do banco:
    // é literal, montada a partir do número da linha. Histórico de nota que
    // começa com '=' continua entrando como TEXTO — ver o ramo de string abaixo.
    //
    // O `<v>` é o valor em cache: sem ele a coluna aparece em branco até o
    // Excel recalcular, e quem abre no visualizador do celular ou do Drive
    // (que não recalcula) nunca veria nada. Célula sem valor na L conta como
    // "não maior que zero" → 'D', igual ao que o Excel calcularia.
    const cache = typeof valor === 'number' && valor > 0 ? 'C' : 'D'
    return `<c r="${ref}" s="${s}" t="str"><f>IF(${LETRA_VALOR}${linhaExcel}&gt;0,"C","D")</f><v>${cache}</v></c>`
  }

  if (valor === null || valor === undefined) return vazia

  if (tipo === 'numero' || tipo === 'valor') {
    // NaN e Infinity não têm representação em XML de planilha — viram vazio em
    // vez de corromper o arquivo.
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return vazia
    // A coluna VALOR troca de estilo pelo SINAL — azul receita, vinho custo.
    // É o padrão das 4 linhas de exemplo do modelo, não invenção.
    const estilo = tipo === 'valor'
      ? (valor > 0 ? ESTILO_VALOR_POSITIVO : ESTILO_VALOR_NEGATIVO)
      : s
    return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`
  }

  // Nº DOCUMENTO sai como TEXTO mesmo quando é número: nota fiscal com zero à
  // esquerda perderia o zero virando número.
  // Corta ANTES de escapar — na ordem inversa o corte cairia no meio de uma
  // entidade ('&amp;' virando '&am') e o XML quebraria.
  const texto = esc(String(valor).slice(0, MAX_CARACTERES_CELULA))
  // Vazio DEPOIS do escape é vazio de verdade: um texto feito só de caractere
  // de controle chega aqui não-vazio e sai vazio.
  if (texto === '') return vazia

  // `inlineStr` dispensa o `sharedStrings.xml` inteiro. E NUNCA emite `<f>`
  // aqui: histórico que começa com '=', '+', '-' ou '@' é texto.
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`
}

// ─── Planilha ─────────────────────────────────────────────────────────────────

// Larguras copiadas do modelo: só 7 colunas têm largura própria lá (G, H, I, J,
// K, L e O). As outras 11 ficam no padrão do Excel — mexer nelas seria desvio.
const COLS_XML =
  '<col min="7" max="7" width="12.88671875" customWidth="1"/>' +
  '<col min="8" max="8" width="70" customWidth="1"/>' +
  '<col min="9" max="9" width="14.44140625" bestFit="1" customWidth="1"/>' +
  '<col min="10" max="10" width="12.88671875" bestFit="1" customWidth="1"/>' +
  '<col min="11" max="11" width="14.6640625" bestFit="1" customWidth="1"/>' +
  '<col min="12" max="12" width="12.88671875" bestFit="1" customWidth="1"/>' +
  '<col min="15" max="15" width="18.44140625" bestFit="1" customWidth="1"/>'

function montarPlanilha(linhas: LinhaLivroCaixa[]): string {
  const ultimaColuna = letraColuna(COLUNAS.length - 1)
  const ultimaLinha = linhas.length + 1

  const cabecalho =
    '<row r="1" spans="1:18">' +
    COLUNAS.map(
      (c, i) =>
        `<c r="${letraColuna(i)}1" s="${c.sHeader}" t="inlineStr"><is><t xml:space="preserve">${esc(c.header)}</t></is></c>`,
    ).join('') +
    '</row>'

  const corpo = linhas
    .map((linha, iLinha) => {
      const r = iLinha + 2 // linha 1 é o cabeçalho
      const celulas = COLUNAS.map((c, iCol) =>
        celula(`${letraColuna(iCol)}${r}`, c.sDado, c.tipo, c.extrair(linha), r),
      ).join('')
      return `<row r="${r}" spans="1:18">${celulas}</row>`
    })
    .join('')

  // SEM `<pane>` e SEM `<autoFilter>`, ao contrário de `lib/xlsx.ts`: o modelo
  // não tem nenhum dos dois. O cabeçalho congelado é perda real ao rolar 200
  // linhas — é uma linha para devolver, se o dono pedir.
  //
  // A ordem das tags NÃO é livre: o schema do OOXML exige
  // dimension → sheetViews → sheetFormatPr → cols → sheetData → pageMargins.
  // Fora de ordem, o Excel recusa o arquivo.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${ultimaColuna}${ultimaLinha}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="14.4"/>
<cols>${COLS_XML}</cols>
<sheetData>${cabecalho}${corpo}</sheetData>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
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

// O modelo chama a aba de "Sheet1". Feio, e de propósito: o pedido foi
// "IDÊNTICO", e o nome da aba aparece na tela de quem abre o arquivo.
const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

/**
 * Monta o .xlsx no formato do livro caixa.
 *
 * ESTOURA quando a lista vem vazia, em vez de gerar um arquivo só com
 * cabeçalho: chegar aqui com zero linhas significa que quem chamou não checou,
 * e uma planilha vazia baixada em silêncio é pior que uma mensagem de erro —
 * ela vai anexada num e-mail antes de alguém reparar.
 */
export async function gerarLivroCaixa(linhas: LinhaLivroCaixa[]): Promise<Blob> {
  if (linhas.length === 0) {
    throw new Error('xlsx-livro-caixa.ts: nenhuma linha para exportar.')
  }

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.folder('_rels')!.file('.rels', RELS_RAIZ)
  zip.file('xl/workbook.xml', WORKBOOK_XML)
  zip.file('xl/_rels/workbook.xml.rels', RELS_WORKBOOK)
  zip.file('xl/styles.xml', STYLES_XML)
  zip.file('xl/worksheets/sheet1.xml', montarPlanilha(linhas))

  // `uint8array` e não `blob`: o `blob` do jszip só existe no navegador, e o
  // teste roda em Node. Envelopar num Blob depois funciona nos dois.
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return new Blob([bytes as unknown as BlobPart], { type: MIME_XLSX })
}
