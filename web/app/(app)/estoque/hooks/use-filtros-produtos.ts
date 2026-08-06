'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Estoque } from '@/lib/types'
import { formatTipoInsumo } from '@/lib/insumos'
import { getUrlParam, setUrlParam, limparUrlParams } from '../lib/url-params'

export type OrdenacaoProdutos = 'recentes' | 'nome' | 'tipo' | 'quantidade' | 'preco' | 'situacao'
export type Direcao = 'asc' | 'desc'
export type FiltroStatus = 'todos' | 'ok' | 'critico' | 'negativo'

const DIRECAO_PADRAO: Record<OrdenacaoProdutos, Direcao> = {
  recentes: 'desc', nome: 'asc', tipo: 'asc', quantidade: 'desc', preco: 'desc', situacao: 'asc',
}

function situacaoRank(item: Estoque): number {
  if (item.quantidade_atual < 0) return 0
  if (item.quantidade_atual <= item.quantidade_minima_alerta) return 1
  return 2
}

function compararPorCampo(a: Estoque, b: Estoque, campo: OrdenacaoProdutos): number {
  switch (campo) {
    case 'nome':       return a.insumos.nome.localeCompare(b.insumos.nome, 'pt-BR')
    case 'tipo':       return formatTipoInsumo(a.insumos.tipo).localeCompare(formatTipoInsumo(b.insumos.tipo), 'pt-BR')
    case 'quantidade': return a.quantidade_atual - b.quantidade_atual
    case 'preco':      return a.preco_medio_unitario - b.preco_medio_unitario
    case 'situacao':   return situacaoRank(a) - situacaoRank(b)
    case 'recentes':
    default:           return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  }
}

export function useFiltrosProdutos(estoque: Estoque[]) {
  const [busca, setBuscaState]             = useState('')
  const [filtroTipo, setFiltroTipoState]   = useState('todos')
  const [filtroStatus, setFiltroStatusState] = useState<FiltroStatus>('todos')
  const [ordenacao, setOrdenacaoState]     = useState<OrdenacaoProdutos>('recentes')
  const [direcao, setDirecaoState]         = useState<Direcao>('desc')

  useEffect(() => {
    setBuscaState(getUrlParam('q') ?? '')
    setFiltroTipoState(getUrlParam('tipo') ?? 'todos')
    setFiltroStatusState((getUrlParam('status') as FiltroStatus) ?? 'todos')
    const campoUrl = (getUrlParam('ordenar') as OrdenacaoProdutos) ?? 'recentes'
    setOrdenacaoState(campoUrl)
    setDirecaoState((getUrlParam('dir') as Direcao) ?? DIRECAO_PADRAO[campoUrl])
  }, [])

  function setBusca(v: string)               { setBuscaState(v); setUrlParam('q', v, '') }
  function setFiltroTipo(v: string)          { setFiltroTipoState(v); setUrlParam('tipo', v) }
  function setFiltroStatus(v: FiltroStatus)  { setFiltroStatusState(v); setUrlParam('status', v) }

  function setOrdenacao(v: OrdenacaoProdutos) {
    setOrdenacaoState(v)
    setDirecaoState(DIRECAO_PADRAO[v])
    setUrlParam('ordenar', v, 'recentes')
    setUrlParam('dir', DIRECAO_PADRAO[v], 'desc')
  }

  function toggleSort(campo: OrdenacaoProdutos) {
    if (campo === ordenacao) {
      const nova = direcao === 'asc' ? 'desc' : 'asc'
      setDirecaoState(nova)
      setUrlParam('dir', nova, 'desc')
    } else {
      setOrdenacao(campo)
    }
  }

  function limpar() {
    setBuscaState(''); setFiltroTipoState('todos'); setFiltroStatusState('todos')
    limparUrlParams(['q', 'tipo', 'status'])
  }

  const estoqueFiltrado = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase()
    const filtrado = estoque.filter(item => {
      if (buscaLower && !item.insumos.nome.toLowerCase().includes(buscaLower)) return false
      if (filtroTipo !== 'todos' && item.insumos.tipo !== filtroTipo) return false
      if (filtroStatus !== 'todos') {
        const negativo = item.quantidade_atual < 0
        const critico  = !negativo && item.quantidade_atual <= item.quantidade_minima_alerta
        const ok       = !negativo && !critico
        if (filtroStatus === 'negativo' && !negativo) return false
        if (filtroStatus === 'critico'  && !critico)  return false
        if (filtroStatus === 'ok'       && !ok)       return false
      }
      return true
    })
    return [...filtrado].sort((a, b) => {
      const cmp = compararPorCampo(a, b, ordenacao)
      return direcao === 'asc' ? cmp : -cmp
    })
  }, [estoque, busca, filtroTipo, filtroStatus, ordenacao, direcao])

  const filtroAtivo = busca.trim() !== '' || filtroTipo !== 'todos' || filtroStatus !== 'todos'

  return {
    busca, setBusca, filtroTipo, setFiltroTipo, filtroStatus, setFiltroStatus,
    ordenacao, setOrdenacao, direcao, toggleSort, estoqueFiltrado, filtroAtivo, limpar,
  }
}
