import https from 'https'
import { supabase } from '../services/supabase'

// Fonte: indicadores CEPEA/ESALQ republicados pelo Notícias Agrícolas.
// A CEPEA tem proteção forte contra scraping; o Notícias Agrícolas publica os
// mesmos indicadores em HTML estático (latin-1). Praças escolhidas: Paraná.
const FONTE = 'cepea'

// Baixa o HTML de uma página (segue redirect de trailing-slash). A página é
// UTF-8 — decodificar errado quebra os acentos dos títulos dos indicadores
// (ex: "Preço Médio do Trigo"), fazendo o match do indicador falhar.
function httpsGetHtml(url: string, redirecoes = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    }, res => {
      const { statusCode = 0, headers } = res
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume()
        if (redirecoes >= 3) { reject(new Error('redirects demais')); return }
        resolve(httpsGetHtml(new URL(headers.location, url).toString(), redirecoes + 1))
        return
      }
      if (statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// ── Helpers de parsing de HTML ────────────────────────────────────────────────

// Pega o primeiro <table>…</table> que aparece depois do título do indicador.
function tabelaAposTitulo(html: string, tituloRe: RegExp): string | null {
  const m = tituloRe.exec(html)
  if (!m) return null
  const tbl = /<table[\s\S]*?<\/table>/i.exec(html.slice(m.index))
  return tbl ? tbl[0] : null
}

// Extrai as linhas (cada uma como array de células de texto limpo) de uma tabela.
function linhasDaTabela(tabela: string): string[][] {
  const linhas: string[][] = []
  for (const tr of tabela.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const celulas = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    if (celulas.length) linhas.push(celulas)
  }
  return linhas
}

// "1.375,01" → 1375.01 | "125,51" → 125.51
function parseNumBR(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.'))
}

// "10/06/2026" → "2026-06-10"
function dataBRtoISO(s: string): string | null {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

const SACA_POR_TONELADA = 60 / 1000 // CEPEA cota trigo em R$/t; card usa R$/saca

interface IndicadorSpec {
  nome: 'soja' | 'milho' | 'trigo'
  url: string
  tituloRe: RegExp
  // recebe a tabela do indicador e devolve { dataIso, preco } em R$/saca
  extrair: (tabela: string) => { dataIso: string; preco: number } | null
}

// Soja e Milho: 1ª linha da tabela é [data, valor R$/sc, variação]
function primeiraLinhaDataValor(tabela: string): { dataIso: string; preco: number } | null {
  const linha = linhasDaTabela(tabela)[0]
  if (!linha || linha.length < 2) return null
  const dataIso = dataBRtoISO(linha[0])
  const preco = parseNumBR(linha[1])
  return dataIso && preco > 0 ? { dataIso, preco } : null
}

const INDICADORES: IndicadorSpec[] = [
  {
    nome: 'soja',
    url: 'https://www.noticiasagricolas.com.br/cotacoes/soja',
    tituloRe: /Indicador da Soja Cepea\/Esalq/i, // Paraná (distingue do ESALQ/B3 Paranaguá)
    extrair: primeiraLinhaDataValor,
  },
  {
    nome: 'milho',
    url: 'https://www.noticiasagricolas.com.br/cotacoes/milho',
    tituloRe: /Indicador do Milho Esalq\/B3/i,
    extrair: primeiraLinhaDataValor,
  },
  {
    nome: 'trigo',
    url: 'https://www.noticiasagricolas.com.br/cotacoes/trigo',
    tituloRe: /Pre.o M.dio do Trigo Cepea\/Esalq/i, // tabela com Paraná e RS em R$/t
    extrair: (tabela) => {
      // linhas: [data, região, R$/t, variação] — pegar a do Paraná e converter
      const linha = linhasDaTabela(tabela).find(l => l.length >= 3 && /paran/i.test(l[1]))
      if (!linha) return null
      const dataIso = dataBRtoISO(linha[0])
      const precoTon = parseNumBR(linha[2])
      const preco = precoTon * SACA_POR_TONELADA
      return dataIso && preco > 0 ? { dataIso, preco } : null
    },
  },
]

export interface ResultadoCotacoes {
  salvos: number
  erros: string[]
}

export async function buscarCotacoes(): Promise<ResultadoCotacoes> {
  const erros: string[] = []
  let salvos = 0

  for (const spec of INDICADORES) {
    try {
      const html = await httpsGetHtml(spec.url)
      const tabela = tabelaAposTitulo(html, spec.tituloRe)
      if (!tabela) {
        console.warn(`[Cotações] ${spec.nome}: indicador não encontrado na página`)
        erros.push(`${spec.nome}: indicador não encontrado (layout mudou?)`)
        continue
      }

      const dados = spec.extrair(tabela)
      if (!dados) {
        console.warn(`[Cotações] ${spec.nome}: não consegui ler preço/data`)
        erros.push(`${spec.nome}: não consegui ler preço/data`)
        continue
      }

      const { error } = await supabase
        .from('cotacoes_commodities')
        .upsert(
          { commodity: spec.nome, preco_rs: parseFloat(dados.preco.toFixed(2)), data: dados.dataIso, fonte: FONTE },
          { onConflict: 'commodity,data' }
        )

      if (error) {
        console.error(`[Cotações] Erro ao salvar ${spec.nome}:`, error.message)
        erros.push(`${spec.nome}: ${error.message}`)
      } else {
        salvos++
        console.log(`[Cotações] ${spec.nome}: R$ ${dados.preco.toFixed(2)}/sc (CEPEA · ${dados.dataIso})`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Cotações] Erro ao buscar ${spec.nome}:`, msg)
      erros.push(`${spec.nome}: ${msg}`)
    }
  }

  return { salvos, erros }
}
