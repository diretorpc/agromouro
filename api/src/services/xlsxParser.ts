import * as XLSX from 'xlsx'
import { createHash } from 'crypto'

export interface TransacaoExtrato {
  titular:   string
  data:      string   // "YYYY-MM-DD"
  descricao: string
  valor:     number   // sempre positivo
  dedupHash: string   // SHA-256 para deduplicação
}

/**
 * Parseia o relatório XLSX do Banco do Brasil.
 * Formato esperado: Titular|Bandeira|Dia|Mês|Ano|Descrição|Moeda|Valor
 * Linha 0 é cabeçalho, dados começam na linha 1.
 */
export function parseXLSX(buffer: Buffer): TransacaoExtrato[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })

  const resultado: TransacaoExtrato[] = []

  // Linha 0 é cabeçalho — pular
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]

    const titular   = String(row[0] ?? '').trim()
    const dia       = Number(row[2])
    const mes       = Number(row[3])
    const ano       = Number(row[4])
    const descricao = String(row[5] ?? '').trim()
    const valor     = Number(row[7])

    // Pular linhas inválidas ou totalizadoras
    if (!titular || !descricao || isNaN(valor) || isNaN(dia) || isNaN(mes) || isNaN(ano)) {
      continue
    }

    // Reconstruir data ISO a partir das 3 colunas numéricas
    const date = new Date(ano, mes - 1, dia)
    const data = date.toISOString().split('T')[0]

    const dedupHash = createHash('sha256')
      .update(`${titular}|${data}|${valor}|${descricao.toLowerCase()}`)
      .digest('hex')

    resultado.push({ titular, data, descricao, valor: Math.abs(valor), dedupHash })
  }

  return resultado
}
