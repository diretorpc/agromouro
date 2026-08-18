'use client'

import { Fragment } from 'react'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FiltroColuna } from './filtro-coluna'
import type { DocumentoControle, FiltrosControle, ItemDocumentoControle } from '@/lib/types'
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

// Data de UM item, não do documento inteiro (achado real: extrato da SYAGRI
// com 28 itens em 5 datas diferentes — a coluna Data não pode mais mostrar a
// mesma data do documento pra tudo). `data_manual` é o nome real da coluna no
// banco (migration 017: "data_manual = documentos_controle.data_documento" na
// gravação — mas cada item herda a SUA data lida do PDF antes desse fallback,
// ver documentoPdf.ts `data: dataSanitizada(item.data, hojeISO) ?? dataDocumento`
// — só cai na data do documento quando o PDF não trouxe data própria da linha).
// Aqui repetimos o mesmo fallback: item sem data_manual (nulo por algum motivo
// além da gravação normal) cai na data do documento; os dois nulos, "—".
function formatarDataItem(item: ItemDocumentoControle, doc: DocumentoControle): string {
  return formatarData(item.data_manual ?? doc.data_documento)
}

// Fallback pro número do documento repete a mesma regra que o backend já aplica
// na gravação (item sem número próprio herda o do documento) — aqui é só exibição.
function formatarNf(item: ItemDocumentoControle | null, doc: DocumentoControle): string {
  return (item?.numero_documento ?? doc.numero_documento) ?? '—'
}

function formatarQuantidade(item: ItemDocumentoControle | null): string {
  if (!item || item.quantidade === null) return '—'
  return `${item.quantidade} ${item.unidade}`
}

// Rótulos de coluna repetem por documento (referência: prints de extrato real
// que o Matheus mandou — a faixa do fornecedor vem ANTES dos nomes de coluna,
// e cada documento tem o seu próprio bloco título+colunas+itens). Extraído
// numa função em vez de deixar o JSX duplicado a cada `.map`, pra não
// dessincronizar o texto das colunas entre os grupos.
function CabecalhoColunas({ groupKey }: { groupKey: string }) {
  return (
    <TableRow key={`${groupKey}-cabecalho`}>
      <TableHead>Data</TableHead>
      <TableHead>NF</TableHead>
      <TableHead>Produto</TableHead>
      <TableHead className="text-right">Quant.</TableHead>
      <TableHead className="text-right">V.Unit.</TableHead>
      <TableHead className="text-right">V.Total</TableHead>
      <TableHead className="text-center">PDF</TableHead>
    </TableRow>
  )
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
      {/* Fornecedor e Período moraram dentro do cabeçalho da tabela enquanto
          Fornecedor era uma coluna própria. Agora Fornecedor virou título de
          seção por documento (achado 2) e Data mostra a data REAL de cada item
          (achado 1) — nenhum dos dois cabeçalhos de coluna é mais o lugar
          natural pro filtro morar. A LÓGICA não mudou: mesmas props, mesmo
          estado (`filtros`), mesma comunicação com o hook — só a UI subiu pra
          cima da tabela. */}
      <div className="mb-2 flex flex-wrap items-center gap-6">
        <FiltroColuna
          label="Fornecedor"
          valores={filtrosDisponiveis.fornecedores}
          selecionados={filtros.fornecedores}
          onChange={fornecedores => onFiltrosChange({ ...filtros, fornecedores })}
        />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Período:</span>
          {/* `value` sai DIRETO de `filtros` — sem cópia em useState local.
              A cópia local só ficava sincronizada porque a tabela era
              desmontada a cada troca de filtro; com a tabela permanente,
              qualquer reset de `filtros` vindo de fora (o upload já faz isso)
              deixaria a caixa de data mostrando a data antiga com o filtro
              real já limpo. `type="date"` só dispara onChange na data
              completa, então não há motivo pra estado local aqui. */}
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
      </div>

      <Table className="border-collapse [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border">
        <TableBody>
          {documentos.length === 0 && mensagemVazia && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                {mensagemVazia}
              </TableCell>
            </TableRow>
          )}
          {documentos.map(doc => (
            <Fragment key={doc.id}>
              {/* Cabeçalho de grupo: uma faixa de título por documento, largura
                  inteira da tabela — não mais uma coluna estreita de Fornecedor
                  ao lado de cada linha (referência: prints de extrato real que
                  o Matheus mandou). `bg-muted/40` é o mesmo tom de destaque
                  sutil já usado em financeiro/page.tsx (`bg-muted/20`,
                  `bg-muted/50`) pra linha que precisa se distinguir do resto
                  sem virar uma cor nova. */}
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={7} className="py-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{doc.fornecedor ?? '—'}</span>
                      {/* Coluna Status foi removida — mas documento com erro
                          continua precisando ser visível sem abrir cada linha.
                          `processado` é o caso normal e não ganha selo. */}
                      {doc.status === 'erro' && (
                        <Badge variant="outline" className={STATUS_STYLE.erro}>
                          erro
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Total do documento SEMPRE visível, não só quando o
                          documento veio sem item novo. Reimportar um extrato
                          cumulativo é o fluxo normal: a maioria das linhas já
                          consta e só entram algumas — sem este total, a soma
                          das linhas visíveis parece ser o valor do PDF, e o
                          Matheus conferiria contra um número que não é o do
                          papel. A migration 017 guarda `valor_total`
                          exatamente pra essa conferência. */}
                      <span className="text-xs text-muted-foreground">
                        Total do PDF: {formatarValor(doc.valor_total)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onAbrirPdf(doc.id)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Abrir PDF de ${doc.fornecedor ?? doc.nome_arquivo}`}
                      >
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>

              {/* Rótulos de coluna vêm LOGO ABAIXO do título do fornecedor —
                  não mais um <thead> fixo pra tabela inteira, já que agora
                  cada documento é o seu próprio bloco completo. */}
              <CabecalhoColunas groupKey={doc.id} />

              {doc.itens.length === 0 ? (
                // Documento sem item algum (reimportação onde tudo já existia
                // — ver migration 018) ainda precisa de UMA linha, com
                // explicação — sem isso ele fica invisível ou parece que a
                // gravação falhou (achado do Apolo).
                <TableRow>
                  <TableCell colSpan={7} className="py-2 pl-4 italic text-muted-foreground">
                    (nenhum item novo — documento já importado antes)
                  </TableCell>
                </TableRow>
              ) : (
                doc.itens.map(item => (
                  <TableRow key={item.id}>
                    <TableCell>{formatarDataItem(item, doc)}</TableCell>
                    <TableCell>{formatarNf(item, doc)}</TableCell>
                    <TableCell>{item.descricao}</TableCell>
                    <TableCell className="text-right">{formatarQuantidade(item)}</TableCell>
                    <TableCell className="text-right">{formatarValor(item.valor_unitario)}</TableCell>
                    <TableCell className="text-right">{formatarValor(item.valor_total)}</TableCell>
                    {/* PDF subiu pro cabeçalho do grupo — célula vazia aqui só
                        pra manter 7 <td> por linha, igual ao colSpan={7} da
                        linha de cabeçalho (mesma contagem de coluna em toda a
                        tabela, bordas incluídas). */}
                    <TableCell />
                  </TableRow>
                ))
              )}
            </Fragment>
          ))}
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
