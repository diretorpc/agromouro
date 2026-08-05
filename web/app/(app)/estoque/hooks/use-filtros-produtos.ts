'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Estoque } from '@/lib/types'
import { getUrlParam, setUrlParam, limparUrlParams } from '../lib/url-params'

export type OrdenacaoProdutos = 'recentes' | 'nome'
export type FiltroStatus = 'todos' | 'ok' | 'critico' | 'negativo'

export function useFiltrosProdutos(estoque: Estoque[]) {
  const [busca, setBuscaState]             = useState('')
  const [filtroTipo, setFiltroTipoState]   = useState('todos')
  const [filtroStatus, setFiltroStatusState] = useState<FiltroStatus>('todos')
  const [ordenacao, setOrdenacaoState]     = useState<OrdenacaoProdutos>('recentes')

  useEffect(() => {
    setBuscaState(getUrlParam('q') ?? '')
    setFiltroTipoState(getUrlParam('tipo') ?? 'todos')
    setFiltroStatusState((getUrlParam('status') as FiltroStatus) ?? 'todos')
    setOrdenacaoState((getUrlParam('ordenar') as OrdenacaoProdutos) ?? 'recentes')
  }, [])

  function setBusca(v: string)               { setBuscaState(v); setUrlParam('q', v, '') }
  function setFiltroTipo(v: string)          { setFiltroTipoState(v); setUrlParam('tipo', v) }
  function setFiltroStatus(v: FiltroStatus)  { setFiltroStatusState(v); setUrlParam('status', v) }
  function setOrdenacao(v: OrdenacaoProdutos) { setOrdenacaoState(v); setUrlParam('ordenar', v, 'recentes') }

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
    const ordenado = [...filtrado]
    if (ordenacao === 'nome') {
      ordenado.sort((a, b) => a.insumos.nome.localeCompare(b.insumos.nome, 'pt-BR'))
    } else {
      ordenado.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    return ordenado
  }, [estoque, busca, filtroTipo, filtroStatus, ordenacao])

  const filtroAtivo = busca.trim() !== '' || filtroTipo !== 'todos' || filtroStatus !== 'todos'

  return {
    busca, setBusca, filtroTipo, setFiltroTipo, filtroStatus, setFiltroStatus,
    ordenacao, setOrdenacao, estoqueFiltrado, filtroAtivo, limpar,
  }
}
