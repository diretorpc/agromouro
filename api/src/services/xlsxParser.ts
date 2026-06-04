import ExcelJS from 'exceljs'
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
 * Linha 1 é cabeçalho (ExcelJS é 1-indexed); dados começam na linha 2.
 */
export async function parseXLSX(buffer: Buffer): Promise<TransacaoExtrato[]> {
  const wb = new ExcelJS.Workbook()
  // Cast necessário: @types/node define Buffer<ArrayBufferLike> mas ExcelJS espera Buffer sem generic
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])

  const ws = wb.worksheets[0]
  if (!ws) return []

  const resultado: TransacaoExtrato[] = []

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // pular cabeçalho

    // ExcelJS row.values é 1-indexed; posição 0 é sempre undefined
    const vals = row.values as (string | number | null | undefined)[]

    const titular   = String(vals[1] ?? '').trim()
    const dia       = Number(vals[3])
    const mes       = Number(vals[4])
    const ano       = Number(vals[5])
    const descricao = String(vals[6] ?? '').trim()
    const valor     = Number(vals[8])

    // Pular linhas inválidas ou totalizadoras
    if (!titular || !descricao || isNaN(valor) || isNaN(dia) || isNaN(mes) || isNaN(ano)) return
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return

    const date = new Date(ano, mes - 1, dia)
    const data = date.toISOString().split('T')[0]

    const dedupHash = createHash('sha256')
      .update(`${titular}|${data}|${valor}|${descricao.toLowerCase()}|row${rowNumber}`)
      .digest('hex')

    resultado.push({ titular, data, descricao, valor: Math.abs(valor), dedupHash })
  })

  return resultado
}
