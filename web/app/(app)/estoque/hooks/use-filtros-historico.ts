'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MovimentacaoComFornecedor } from './use-estoque-data'
import { getUrlParam, setUrlParam, limparUrlParams } from '../lib/url-params'

export type FiltroOrigem = 'todos' | 'nfe' | 'operacao' | 'whatsapp' | 'manual' | 'correcao_unidade'

export function useFiltrosHistorico(movimentacoes: MovimentacaoComFornecedor[]) {
  const [busca, setBuscaState]             = useState('')
  const [filtroOrigem, setFiltroOrigemState] = useState<FiltroOrigem>('todos')

  useEffect(() => {
    setBuscaState(getUrlParam('hq') ?? '')
    setFiltroOrigemState((getUrlParam('origem') as FiltroOrigem) ?? 'todos')
  }, [])

  function setBusca(v: string)             { setBuscaState(v); setUrlParam('hq', v, '') }
  function setFiltroOrigem(v: FiltroOrigem) { setFiltroOrigemState(v); setUrlParam('origem', v, 'todos') }

  function limpar() {
    setBuscaState(''); setFiltroOrigemState('todos')
    limparUrlParams(['hq', 'origem'])
  }

  const movimentacoesFiltradas = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase()
    return movimentacoes.filter(m => {
      if (buscaLower && !m.insumos.nome.toLowerCase().includes(buscaLower)) return false
      if (filtroOrigem !== 'todos' && m.origem !== filtroOrigem) return false
      return true
    })
  }, [movimentacoes, busca, filtroOrigem])

  const filtroAtivo = busca.trim() !== '' || filtroOrigem !== 'todos'

  return { busca, setBusca, filtroOrigem, setFiltroOrigem, movimentacoesFiltradas, filtroAtivo, limpar }
}
