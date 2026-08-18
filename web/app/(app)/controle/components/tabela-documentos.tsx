'use client'

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
  /** Página que o SERVIDOR confirmou ter devolvido — não a que foi pedida. */
  paginaAtual: number
  totalPaginas: number
  onPaginaChange: (pagina: number) => void
  onAbrirPdf: (documentoId: string) => void
  /** Há erro de carregamento na tela? Muda o que a tabela vazia pode afirmar. */
  comErro: boolean
}

function formatarValor(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(d: string | null): string {
  return d ? d.slice(0, 10).split('-').reverse().join('/') : '—'
}

export function TabelaDocumentos({
  documentos, filtrosDisponiveis, filtros, onFiltrosChange,
  paginaAtual, totalPaginas, onPaginaChange, onAbrirPdf, comErro,
}: TabelaDocumentosProps) {
  const temFiltroAtivo =
    filtros.fornecedores.length > 0 || filtros.status.length > 0 ||
    filtros.dataInicio !== '' || filtros.dataFim !== ''

  // Lista vazia quer dizer coisas DIFERENTES em cada caso, e a frase precisa
  // acompanhar: com erro de carregamento a lista não está vazia — ela não chegou
  // (a mensagem de erro já está acima; afirmar "nenhum documento importado" ali
  // embaixo seria uma segunda informação, contraditória). Com filtro ativo, o
  // acervo pode estar cheio: o que não existe é resultado PARA ESSE FILTRO.
  const mensagemVazia = comErro
    ? null
    : temFiltroAtivo
      ? 'Nenhum documento encontrado com esses filtros.'
      : 'Nenhum documento importado ainda.'

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
                {/* `value` sai DIRETO de `filtros` — sem cópia em useState local.
                    A cópia local só ficava sincronizada porque a tabela era
                    desmontada a cada troca de filtro; com a tabela permanente,
                    qualquer reset de `filtros` vindo de fora (o upload já faz
                    isso) deixaria a caixa de data mostrando a data antiga com o
                    filtro real já limpo. `type="date"` só dispara onChange na
                    data completa, então não há motivo pra estado local aqui. */}
                <input
                  type="date"
                  value={filtros.dataInicio}
                  onChange={e => onFiltrosChange({ ...filtros, dataInicio: e.target.value })}
                  className="w-28 rounded border px-1 py-0.5 text-xs"
                  aria-label="Data inicial"
                />
                <span>–</span>
                <input
                  type="date"
                  value={filtros.dataFim}
                  onChange={e => onFiltrosChange({ ...filtros, dataFim: e.target.value })}
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
          {documentos.length === 0 && mensagemVazia && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                {mensagemVazia}
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
                {i === 0 && (
                  <TableCell rowSpan={linhas.length} className="align-top">
                    <div>{doc.fornecedor ?? '—'}</div>
                    {/* Total do documento SEMPRE visível, não só quando o
                        documento veio sem item novo. Reimportar um extrato
                        cumulativo é o fluxo normal: a maioria das linhas já
                        consta e só entram algumas — sem este total, a soma das
                        linhas visíveis parece ser o valor do PDF, e o Matheus
                        conferiria contra um número que não é o do papel. A
                        migration 017 guarda `valor_total` exatamente pra essa
                        conferência. */}
                    <div className="text-xs text-muted-foreground">
                      Total do PDF: {formatarValor(doc.valor_total)}
                    </div>
                  </TableCell>
                )}
                {i === 0 && (
                  <TableCell rowSpan={linhas.length} className="align-top">
                    {formatarData(doc.data_documento)}
                  </TableCell>
                )}
                <TableCell>
                  {item ? item.descricao : (
                    <span className="italic text-muted-foreground">
                      (nenhum item novo — documento já importado antes)
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {/* Só valor de ITEM entra nesta coluna. Na linha "nenhum item
                      novo" ficava o total do documento, o que lia como se aquela
                      linha valesse esse dinheiro; o total agora tem lugar próprio
                      na célula do fornecedor. */}
                  {item ? formatarValor(item.valor_total) : '—'}
                </TableCell>
                {i === 0 && (
                  <TableCell rowSpan={linhas.length} className="align-top">
                    <Badge variant="outline" className={STATUS_STYLE[doc.status] ?? ''}>
                      {doc.status}
                    </Badge>
                  </TableCell>
                )}
                {i === 0 && (
                  <TableCell rowSpan={linhas.length} className="text-center align-top">
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
              // Destaca a página que o servidor CONFIRMOU ter devolvido. Destacar
              // a pedida faz o número novo acender antes de a lista trocar — e
              // ficar aceso mesmo se a busca falhar, mostrando a lista da página
              // anterior com o número da nova em destaque.
              aria-current={p === paginaAtual ? 'page' : undefined}
              className={cn(
                'h-7 w-7 rounded text-xs',
                p === paginaAtual ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
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
