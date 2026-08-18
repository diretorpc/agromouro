'use client'

import { Fragment, useState } from 'react'
import {
  CircleDollarSign, Ban, CheckCircle2, Undo2, ChevronDown, ChevronRight, AlertTriangle, Tag,
} from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { SortableTableHead } from '@/components/ui/sortable-table-head'
import { ENCERRADAS, PREFIXO_CONFERIR, type ContaAPI, type Conta } from './tipos'

// Declarado aqui (não em page.tsx) para não duplicar a mesma verdade em dois
// lugares — page.tsx importa este tipo de volta, mesmo padrão que `fmtBRL`
// já segue neste arquivo.
export type SortColuna = 'fornecedor' | 'descricao' | 'vencimento' | 'valor' | 'categoria'

type Props = {
  contas:          ContaAPI[]
  hoje:            string
  onPagar:         (c: ContaAPI) => void
  onDispensar:     (c: ContaAPI) => void
  onDesfazer:      (c: ContaAPI) => void
  onEditarValor:   (c: ContaAPI) => void
  onEditar:        (c: ContaAPI) => void
  onInformarData:  (c: ContaAPI) => void
  sortColuna:      SortColuna
  sortDirecao:     'asc' | 'desc'
  onSort:          (coluna: SortColuna) => void
}

// ─── Formatação (mesmo padrão do resto do site — ver financeiro/page.tsx) ─────
// fmtBRL é usado tanto aqui quanto nos cartões de KPI de page.tsx: fica definido
// uma vez só, aqui, e page.tsx importa de volta — DRY sem criar um arquivo novo
// de utilitário fora do que o brief da Task 8 pediu.

export function fmtBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function fmtDate(dateStr: string) {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR')
}

const STATUS_LABEL: Record<Conta['status'], string> = {
  aguardando: 'Aguardando',
  aberta:     'Aberta',
  paga:       'Paga',
  dispensada: 'Dispensada',
}

const STATUS_STYLE: Record<Conta['status'], string> = {
  aguardando: 'bg-amber-100 text-amber-700 border-amber-200',
  aberta:     'bg-blue-100 text-blue-700 border-blue-200',
  paga:       'bg-green-100 text-green-700 border-green-200',
  dispensada: 'bg-gray-100 text-gray-600 border-gray-200',
}

export function ListaContas({ contas, onPagar, onDispensar, onDesfazer, onEditarValor, onEditar, onInformarData, sortColuna, sortDirecao, onSort }: Props) {
  const [notasExpandidas, setNotasExpandidas] = useState<Set<string>>(new Set())

  function toggleNota(chave: string) {
    setNotasExpandidas(prev => {
      const novo = new Set(prev)
      if (novo.has(chave)) novo.delete(chave)
      else novo.add(chave)
      return novo
    })
  }

  type GrupoConta = { chave: string; contas: ContaAPI[] }

  // Só agrupa quando MESMA nota + MESMO vencimento + MESMO status — parcela
  // com vencimento diferente (o caso comum) fica de fora de propósito
  // (decisão do Matheus, 10/08/2026): esconder uma data de pagamento
  // diferente atrás de uma linha resumida seria perigoso. Conta sem
  // vencimento nunca agrupa (cai no fallback `conta-${id}`, vira grupo de 1).
  const grupos: GrupoConta[] = []
  const posicaoPorChave = new Map<string, number>()
  for (const conta of contas) {
    const chave = conta.nota_fiscal_id && conta.vencimento
      ? `${conta.nota_fiscal_id}|${conta.vencimento}|${conta.status}`
      : `conta-${conta.id}`
    const posicao = posicaoPorChave.get(chave)
    if (posicao === undefined) {
      posicaoPorChave.set(chave, grupos.length)
      grupos.push({ chave, contas: [conta] })
    } else {
      grupos[posicao].contas.push(conta)
    }
  }

  return (
    <Table className="border-collapse [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border">
      <TableHeader>
        <TableRow>
          <SortableTableHead className="w-[220px]" ativo={sortColuna === 'fornecedor'} direcao={sortDirecao} onClick={() => onSort('fornecedor')}>Fornecedor</SortableTableHead>
          <SortableTableHead ativo={sortColuna === 'descricao'} direcao={sortDirecao} onClick={() => onSort('descricao')}>Descrição</SortableTableHead>
          <SortableTableHead className="w-[110px]" ativo={sortColuna === 'vencimento'} direcao={sortDirecao} onClick={() => onSort('vencimento')}>Vencimento</SortableTableHead>
          <SortableTableHead className="w-[150px] text-right" numeric ativo={sortColuna === 'valor'} direcao={sortDirecao} onClick={() => onSort('valor')}>Valor</SortableTableHead>
          <SortableTableHead className="w-[140px]" ativo={sortColuna === 'categoria'} direcao={sortDirecao} onClick={() => onSort('categoria')}>Categoria</SortableTableHead>
          <TableHead className="w-[110px]">Status</TableHead>
          <TableHead className="w-[60px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {contas.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
              Nenhuma conta para este filtro.
            </TableCell>
          </TableRow>
        ) : grupos.map(grupo => {
          const multiplo = grupo.contas.length > 1

          function renderLinha(conta: ContaAPI) {
            const podeAgir = !ENCERRADAS.has(conta.status)
            // Conta sem vencimento troca o menu de ações por três botões visíveis
            // — para uma pessoa leiga, um problema que precisa de ação não pode
            // ficar escondido atrás de um menu de três pontinhos.
            const semVencimentoAcionavel = !conta.vencimento && podeAgir

            const acoes: ActionMenuItem[] = []
            // Sem gate de status de propósito: conta já paga/dispensada com
            // dado errado (ex: boleto que chegou do email como "Insumos"
            // quando era "Combustível") também precisa de conserto — pedido do
            // Matheus, 18/08/2026.
            acoes.push({
              label: 'Editar',
              icon: <Tag className="h-3.5 w-3.5" aria-hidden="true" />,
              onClick: () => onEditar(conta),
            })
            if (podeAgir && conta.valor_estimado) {
              acoes.push({
                label: 'Registrar valor real',
                icon: <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />,
                onClick: () => onEditarValor(conta),
              })
            }
            if (podeAgir) {
              acoes.push({
                label: 'Marcar como paga',
                icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
                onClick: () => onPagar(conta),
              })
              acoes.push({
                label: 'Dispensar',
                icon: <Ban className="h-3.5 w-3.5" aria-hidden="true" />,
                onClick: () => onDispensar(conta),
                destructive: true,
              })
            }
            // Só conta paga: é a única que tem pagamento para desfazer.
            if (conta.status === 'paga') {
              acoes.push({
                label: 'Desfazer pagamento',
                icon: <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />,
                onClick: () => onDesfazer(conta),
                destructive: true,
              })
            }
            return (
              <TableRow key={conta.id}>
                <TableCell className="text-sm font-medium max-w-[220px] whitespace-normal break-words">
                  {conta.fornecedor ?? '—'}
                </TableCell>
                <TableCell className="text-sm max-w-[280px] whitespace-normal break-words">
                  <p>{conta.descricao}</p>
                  {conta.nota_fiscal_id && conta.notas_fiscais && (
                    <p className="text-xs text-muted-foreground">NF {conta.notas_fiscais.numero}</p>
                  )}
                  {/* Alerta de boleto que nasceu apesar de a nota dizer cartão/dinheiro
                      (ver observacaoDoBoletoContraOCodigo na API). Precisa estar AQUI: a
                      mensagem do WhatsApp passa uma vez, esta linha fica — sem ela o
                      resumo diário cobraria o boleto como urgente sem nunca dizer que ele
                      pode já ter sido pago.
                      Só o texto com ESTE prefixo vira alerta, nunca "tem observação":
                      a coluna é campo livre e já guarda nota de auditoria escrita à mão
                      em produção. Marcar tudo faria a tela gritar à toa. */}
                  {conta.observacao?.startsWith(PREFIXO_CONFERIR) && !ENCERRADAS.has(conta.status) && (
                    <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{conta.observacao}</span>
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {conta.vencimento
                    ? fmtDate(conta.vencimento)
                    : <span className="text-amber-600 font-medium">vencimento não informado</span>}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {conta.valor !== null ? (
                    <div>
                      <p className="font-semibold tabular-nums">{fmtBRL(conta.valor)}</p>
                      {conta.valor_estimado && (
                        <Badge
                          variant="outline"
                          className="text-[10px] mt-0.5 bg-amber-50 text-amber-700 border-amber-200"
                        >
                          estimado
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  <Badge variant="outline" className="text-xs">
                    {conta.categoria ?? 'Sem categoria'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${STATUS_STYLE[conta.status]}`}>
                    {STATUS_LABEL[conta.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {semVencimentoAcionavel ? (
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" onClick={() => onInformarData(conta)}>Informar data</Button>
                      <Button size="sm" variant="outline" onClick={() => onPagar(conta)}>Já foi paga</Button>
                      <Button size="sm" variant="outline" onClick={() => onDispensar(conta)}>Sem boleto</Button>
                      <Button size="sm" variant="outline" onClick={() => onEditar(conta)}>Editar</Button>
                    </div>
                  ) : (
                    acoes.length > 0 && (
                      <ActionMenu label={`Ações — ${conta.descricao}`} items={acoes} />
                    )
                  )}
                </TableCell>
              </TableRow>
            )
          }

          if (!multiplo) {
            return renderLinha(grupo.contas[0])
          }

          const expandido = notasExpandidas.has(grupo.chave)
          const primeira = grupo.contas[0]
          const valorTotalGrupo = grupo.contas.reduce((s, c) => s + (c.valor ?? 0), 0)
          const algumEstimado = grupo.contas.some(c => c.valor_estimado)
          const todosSemValor = grupo.contas.every(c => c.valor === null)
          const algumSemValor = !todosSemValor && grupo.contas.some(c => c.valor === null)
          const categoriasGrupo = Array.from(new Set(grupo.contas.map(c => c.categoria ?? 'Sem categoria')))

          return (
            <Fragment key={grupo.chave}>
              <TableRow className="hover:bg-muted/50">
                <TableCell className="text-sm font-medium max-w-[220px] whitespace-normal break-words">
                  {primeira.fornecedor ?? '—'}
                </TableCell>
                <TableCell className="text-sm max-w-[280px] whitespace-normal break-words">
                  <button
                    type="button"
                    onClick={() => toggleNota(grupo.chave)}
                    aria-expanded={expandido}
                    aria-label={`${expandido ? 'Recolher' : 'Expandir'} os ${grupo.contas.length} boletos desta nota`}
                    className="inline-flex items-center gap-1.5 text-left hover:text-foreground transition-colors"
                  >
                    {expandido
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                    {grupo.contas.length} boletos desta nota
                  </button>
                  {primeira.notas_fiscais && (
                    <p className="text-xs text-muted-foreground">NF {primeira.notas_fiscais.numero}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {primeira.vencimento ? fmtDate(primeira.vencimento) : '—'}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {todosSemValor ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div>
                      <p className="font-semibold tabular-nums">{fmtBRL(valorTotalGrupo)}</p>
                      {algumEstimado && (
                        <Badge variant="outline" className="text-[10px] mt-0.5 bg-amber-50 text-amber-700 border-amber-200">
                          estimado
                        </Badge>
                      )}
                      {algumSemValor && (
                        <Badge variant="outline" className="text-[10px] mt-0.5 bg-slate-100 text-slate-600 border-slate-200">
                          valor incompleto
                        </Badge>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex flex-wrap gap-1">
                    {categoriasGrupo.map(c => (
                      <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${STATUS_STYLE[primeira.status]}`}>
                    {STATUS_LABEL[primeira.status]}
                  </Badge>
                </TableCell>
                <TableCell />
              </TableRow>
              {expandido && grupo.contas.map(conta => renderLinha(conta))}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
