'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MovimentacaoComFornecedor } from './use-estoque-data'
import { ORIGENS } from '../constants'
import { getUrlParam, setUrlParam, limparUrlParams } from '../lib/url-params'

export type FiltroOrigem = 'todos' | 'nfe' | 'operacao' | 'whatsapp' | 'manual' | 'correcao_unidade'
export type OrdenacaoHistorico = 'data' | 'insumo' | 'tipo' | 'quantidade' | 'origem'
export type Direcao = 'asc' | 'desc'

const CAMPOS_VALIDOS: OrdenacaoHistorico[] = ['data', 'insumo', 'tipo', 'quantidade', 'origem']

const DIRECAO_PADRAO: Record<OrdenacaoHistorico, Direcao> = {
  data: 'desc', insumo: 'asc', tipo: 'asc', quantidade: 'desc', origem: 'asc',
}

const LABEL_ORIGEM = new Map(ORIGENS)

function compararPorCampo(a: MovimentacaoComFornecedor, b: MovimentacaoComFornecedor, campo: OrdenacaoHistorico): number {
  switch (campo) {
    case 'insumo':     return a.insumos.nome.localeCompare(b.insumos.nome, 'pt-BR')
    case 'tipo':       return a.tipo.localeCompare(b.tipo, 'pt-BR')
    case 'quantidade': return a.quantidade - b.quantidade
    case 'origem':     return (LABEL_ORIGEM.get(a.origem) ?? a.origem).localeCompare(LABEL_ORIGEM.get(b.origem) ?? b.origem, 'pt-BR')
    case 'data':
    default:           return new Date(a.data).getTime() - new Date(b.data).getTime()
  }
}

export function useFiltrosHistorico(movimentacoes: MovimentacaoComFornecedor[]) {
  const [busca, setBuscaState]             = useState('')
  const [filtroOrigem, setFiltroOrigemState] = useState<FiltroOrigem>('todos')
  const [ordenacao, setOrdenacaoState]     = useState<OrdenacaoHistorico | null>(null)
  const [direcao, setDirecaoState]         = useState<Direcao>('desc')

  useEffect(() => {
    setBuscaState(getUrlParam('hq') ?? '')
    setFiltroOrigemState((getUrlParam('origem') as FiltroOrigem) ?? 'todos')
    const campoUrl = getUrlParam('hordenar') as OrdenacaoHistorico | null
    const campoValido = campoUrl && CAMPOS_VALIDOS.includes(campoUrl) ? campoUrl : null
    setOrdenacaoState(campoValido)
    setDirecaoState((getUrlParam('hdir') as Direcao) ?? (campoValido ? DIRECAO_PADRAO[campoValido] : 'desc'))
  }, [])

  function setBusca(v: string)             { setBuscaState(v); setUrlParam('hq', v, '') }
  function setFiltroOrigem(v: FiltroOrigem) { setFiltroOrigemState(v); setUrlParam('origem', v, 'todos') }

  function toggleSort(campo: OrdenacaoHistorico) {
    if (campo === ordenacao) {
      const nova = direcao === 'asc' ? 'desc' : 'asc'
      setDirecaoState(nova)
      setUrlParam('hdir', nova, 'desc')
    } else {
      setOrdenacaoState(campo)
      setDirecaoState(DIRECAO_PADRAO[campo])
      setUrlParam('hordenar', campo, '')
      setUrlParam('hdir', DIRECAO_PADRAO[campo], 'desc')
    }
  }

  function limpar() {
    setBuscaState(''); setFiltroOrigemState('todos')
    limparUrlParams(['hq', 'origem'])
  }

  const movimentacoesFiltradas = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase()
    const filtradas = movimentacoes.filter(m => {
      if (buscaLower && !m.insumos.nome.toLowerCase().includes(buscaLower)) return false
      if (filtroOrigem !== 'todos' && m.origem !== filtroOrigem) return false
      return true
    })
    if (!ordenacao) return filtradas
    return [...filtradas].sort((a, b) => {
      const cmp = compararPorCampo(a, b, ordenacao)
      return direcao === 'asc' ? cmp : -cmp
    })
  }, [movimentacoes, busca, filtroOrigem, ordenacao, direcao])

  const filtroAtivo = busca.trim() !== '' || filtroOrigem !== 'todos'

  return {
    busca, setBusca, filtroOrigem, setFiltroOrigem, ordenacao, direcao, toggleSort,
    movimentacoesFiltradas, filtroAtivo, limpar,
  }
}
