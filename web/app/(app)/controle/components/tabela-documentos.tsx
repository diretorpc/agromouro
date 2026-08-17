'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FiltroColuna } from './filtro-coluna'
import type { DocumentoControle, FiltrosControle } from '@/lib/types'
import type { FiltrosSelecionados } from '../hooks/use-controle-data'

const STATUS_STYLE: Record<string, string> = {
  importado:   'bg-blue-100 text-blue-700 border-blue-200',
  processando: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  processado:  'bg-green-100 text-green-700 border-green-200',
  erro:        'bg-red-100 text-red-700 border-red-200',
}

type TabelaDocumentosProps = {
  documentos: DocumentoControle[]
  filtrosDisponiveis: FiltrosControle
  filtros: FiltrosSelecionados
  onFiltrosChange: (novos: FiltrosSelecionados) => void
  pagina: number
  totalPaginas: number
  onPaginaChange: (pagina: number) => void
  onAbrirPdf: (documentoId: string) => void
}

function formatarValor(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(d: string | null): string {
  return d ? d.slice(0, 10).split('-').reverse().join('/') : '—'
}

export function TabelaDocumentos({
  documentos, filtrosDisponiveis, filtros, onFiltrosChange,
  pagina, totalPaginas, onPaginaChange, onAbrirPdf,
}: TabelaDocumentosProps) {
  const [dataInicioLocal, setDataInicioLocal] = useState(filtros.dataInicio)
  const [dataFimLocal, setDataFimLocal] = useState(filtros.dataFim)

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <FiltroColuna
                label="Fornecedor"
                valores={filtrosDisponiveis.fornecedores}
                selecionados={filtros.fornecedores}
                onChange={fornecedores => onFiltrosChange({ ...filtros, fornecedores })}
              />
            </TableHead>
            <TableHead>
              <div className="flex items-center gap-1 text-xs">
                Data
                <input
                  type="date"
                  value={dataInicioLocal}
                  onChange={e => { setDataInicioLocal(e.target.value); onFiltrosChange({ ...filtros, dataInicio: e.target.value }) }}
                  className="w-28 rounded border px-1 py-0.5 text-xs"
                  aria-label="Data inicial"
                />
                <span>–</span>
                <input
                  type="date"
                  value={dataFimLocal}
                  onChange={e => { setDataFimLocal(e.target.value); onFiltrosChange({ ...filtros, dataFim: e.target.value }) }}
                  className="w-28 rounded border px-1 py-0.5 text-xs"
                  aria-label="Data final"
                />
              </div>
            </TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>
              <FiltroColuna
                label="Status"
                valores={filtrosDisponiveis.status}
                selecionados={filtros.status}
                onChange={status => onFiltrosChange({ ...filtros, status })}
              />
            </TableHead>
            <TableHead className="text-center">PDF</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documentos.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                Nenhum documento importado ainda.
              </TableCell>
            </TableRow>
          )}
          {documentos.map(doc => {
            // Documento sem item algum (reimportação onde tudo já existia — ver
            // migration 018) ainda precisa de UMA linha, com explicação — sem isso
            // ele fica invisível ou parece que a gravação falhou (achado do Apolo).
            const linhas = doc.itens.length > 0 ? doc.itens : [null]
            return linhas.map((item, i) => (
              <TableRow key={item ? item.id : `${doc.id}-vazio`}>
                {i === 0 && <TableCell rowSpan={linhas.length}>{doc.fornecedor ?? '—'}</TableCell>}
                {i === 0 && <TableCell rowSpan={linhas.length}>{formatarData(doc.data_documento)}</TableCell>}
                <TableCell>
                  {item ? item.descricao : (
                    <span className="italic text-muted-foreground">
                      (nenhum item novo — documento já importado antes)
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {item ? formatarValor(item.valor_total) : formatarValor(doc.valor_total)}
                </TableCell>
                {i === 0 && (
                  <TableCell rowSpan={linhas.length}>
                    <Badge variant="outline" className={STATUS_STYLE[doc.status] ?? ''}>
                      {doc.status}
                    </Badge>
                  </TableCell>
                )}
                {i === 0 && (
                  <TableCell rowSpan={linhas.length} className="text-center">
                    <button
                      type="button"
                      onClick={() => onAbrirPdf(doc.id)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Abrir PDF de ${doc.fornecedor ?? doc.nome_arquivo}`}
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))
          })}
        </TableBody>
      </Table>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-2 py-4">
          {Array.from({ length: totalPaginas }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => onPaginaChange(p)}
              className={cn(
                'h-7 w-7 rounded text-xs',
                p === pagina ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
