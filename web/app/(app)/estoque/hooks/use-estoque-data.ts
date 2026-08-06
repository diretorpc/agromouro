'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useFazenda } from '@/context/fazenda-context'
import type { Estoque, MovimentacaoEstoque } from '@/lib/types'

export type MovimentacaoComFornecedor = MovimentacaoEstoque & {
  fornecedor_nome?: string
  talhao_nome?: string
}

type ResultadoExclusao = { ok: true } | { ok: false; erro: string }

// Traduz o erro cru do Postgres (em inglês, cheio de termos técnicos) para uma
// mensagem que um produtor rural sem vocabulário técnico consegue entender.
function mensagemErro(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Já existe um produto com esse nome.'
  if (error.code === '23502') return 'Faltou informar a fazenda. Recarregue a página.'
  return `Erro: ${error.message}`
}

// Lê o saldo atual do banco (não confia em estado do React que pode estar
// desatualizado), soma o delta e nunca deixa passar de zero pra negativo por
// engano de arredondamento. Usado em editarMovimentacao (quando delta ≠ 0) e
// excluirMovimentacao (sem guarda).
async function ajustarSaldoPorDelta(insumoId: string, delta: number) {
  const { data: row } = await supabase
    .from('estoque').select('id, quantidade_atual').eq('insumo_id', insumoId).single()
  if (!row) return
  await supabase.from('estoque')
    .update({ quantidade_atual: Math.max(0, row.quantidade_atual + delta) })
    .eq('id', row.id)
}

export function useEstoqueData() {
  const { fazendaAtiva } = useFazenda()
  const [estoque, setEstoque] = useState<Estoque[]>([])
  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoComFornecedor[]>([])
  const [loading, setLoading] = useState(true)
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null)

  const recarregar = useCallback(async () => {
    const [e, movs] = await Promise.all([
      api.get<Estoque[]>('/estoque')
        .then(data => { setErroCarregamento(null); return data })
        .catch(() => {
          setErroCarregamento('Não foi possível carregar o estoque agora. Tente recarregar a página em instantes.')
          return [] as Estoque[]
        }),
      supabase
        .from('movimentacoes_estoque')
        .select('*, insumos(nome, unidade), operacoes(talhoes(nome))')
        .order('created_at', { ascending: false })
        .limit(100)
        .then(({ data }) => (data ?? []) as MovimentacaoEstoque[]),
    ])

    const nfeIds = [...new Set(movs.filter(m => m.nota_fiscal_id).map(m => m.nota_fiscal_id!))]
    let fornecedorMap: Record<string, string> = {}
    if (nfeIds.length > 0) {
      const { data: notas } = await supabase
        .from('notas_fiscais').select('id, emitente_nome').in('id', nfeIds)
      fornecedorMap = Object.fromEntries((notas ?? []).map(n => [n.id, n.emitente_nome]))
    }

    setEstoque(e)
    setMovimentacoes(movs.map(m => ({
      ...m,
      fornecedor_nome: m.nota_fiscal_id ? fornecedorMap[m.nota_fiscal_id] : undefined,
      talhao_nome: m.operacoes?.talhoes?.nome ?? undefined,
    })))
    setLoading(false)
  }, [])

  useEffect(() => { recarregar() }, [recarregar])

  async function ajustarEstoque(
    item: Estoque, novaQuantidade: number, novoPreco: number | null,
  ): Promise<ResultadoExclusao> {
    if (!fazendaAtiva) return { ok: false, erro: 'Nenhuma fazenda ativa selecionada' }

    const diff = novaQuantidade - item.quantidade_atual
    const tipo = diff >= 0 ? 'entrada' : 'saida'
    const { data: mov, error: movError } = await supabase.from('movimentacoes_estoque').insert({
      insumo_id: item.insumo_id,
      tipo,
      quantidade: Math.abs(diff),
      data: new Date().toISOString(),
      origem: 'manual',
      fazenda_id: fazendaAtiva.id,
    }).select('id').single()
    if (movError) return { ok: false, erro: mensagemErro(movError) }
    if (!mov) return { ok: false, erro: 'Não foi possível registrar a movimentação.' }

    const updatePayload: Record<string, unknown> = { quantidade_atual: novaQuantidade }
    if (novoPreco !== null && novoPreco >= 0) updatePayload.preco_medio_unitario = novoPreco
    const { data: updated, error: updateError } = await supabase
      .from('estoque').update(updatePayload).eq('id', item.id).select('id')

    if (updateError || !updated || updated.length === 0) {
      // Update do saldo falhou (ou RLS barrou em silêncio) — desfaz a movimentação
      // que já tinha sido gravada, pra não sobrar histórico sem saldo batendo.
      await supabase.from('movimentacoes_estoque').delete().eq('id', mov.id)
      return {
        ok: false,
        erro: updateError
          ? mensagemErro(updateError)
          : 'Sem permissão para alterar. Verifique as políticas do banco.',
      }
    }

    await recarregar()
    return { ok: true }
  }

  async function editarMovimentacao(
    mov: MovimentacaoComFornecedor,
    novoTipo: 'entrada' | 'saida',
    novaQuantidade: number,
    novaData: string,
  ) {
    let delta = mov.tipo === 'entrada' ? -mov.quantidade : mov.quantidade
    delta += novoTipo === 'entrada' ? novaQuantidade : -novaQuantidade

    await supabase.from('movimentacoes_estoque').update({
      tipo: novoTipo,
      quantidade: novaQuantidade,
      data: novaData,
    }).eq('id', mov.id)

    // Só mexe no saldo se delta ≠ 0, replica comportamento original handleEditMov
    if (delta !== 0) {
      await ajustarSaldoPorDelta(mov.insumo_id, delta)
    }
    await recarregar()
  }

  async function excluirMovimentacao(mov: MovimentacaoComFornecedor): Promise<ResultadoExclusao> {
    const { data: deleted, error } = await supabase
      .from('movimentacoes_estoque').delete().eq('id', mov.id).select('id')

    if (error) return { ok: false, erro: mensagemErro(error) }
    if (!deleted || deleted.length === 0) {
      return { ok: false, erro: 'Sem permissão para excluir. Verifique as políticas do banco.' }
    }

    // Sempre calcula e aplica delta sem guarda, replica comportamento original handleDeleteMov
    const delta = mov.tipo === 'entrada' ? -mov.quantidade : mov.quantidade
    await ajustarSaldoPorDelta(mov.insumo_id, delta)
    await recarregar()
    return { ok: true }
  }

  async function criarInsumo(form: {
    nome: string; tipo: string; unidade: string
    quantidade: number; minimo: number; preco: number
  }): Promise<ResultadoExclusao> {
    if (!fazendaAtiva) return { ok: false, erro: 'Nenhuma fazenda ativa selecionada' }

    const { data: insumo, error: insumoError } = await supabase
      .from('insumos')
      .insert({ nome: form.nome.trim(), tipo: form.tipo, unidade: form.unidade, fazenda_id: fazendaAtiva.id })
      .select()
      .single()
    if (insumoError) return { ok: false, erro: mensagemErro(insumoError) }
    if (!insumo) return { ok: false, erro: 'Não foi possível criar o insumo.' }

    const { error: estoqueError } = await supabase.from('estoque').insert({
      insumo_id: insumo.id,
      quantidade_atual: form.quantidade,
      quantidade_minima_alerta: form.minimo,
      preco_medio_unitario: form.preco,
      fazenda_id: fazendaAtiva.id,
    })
    if (estoqueError) {
      // Sem linha de estoque o insumo fica órfão, e o nome (índice único) trava
      // qualquer nova tentativa de cadastro — apaga o insumo recém-criado.
      await supabase.from('insumos').delete().eq('id', insumo.id)
      return { ok: false, erro: mensagemErro(estoqueError) }
    }

    if (form.quantidade > 0) {
      const { error: movError } = await supabase.from('movimentacoes_estoque').insert({
        insumo_id: insumo.id,
        tipo: 'entrada',
        quantidade: form.quantidade,
        data: new Date().toISOString(),
        origem: 'manual',
        fazenda_id: fazendaAtiva.id,
      })
      if (movError) {
        // O insumo e o estoque já foram salvos de verdade — só o histórico falhou.
        // Atualiza a tela com o que já está no banco pra não fazer o produtor achar
        // que nada foi salvo e tentar cadastrar de novo (o nome tem índice único).
        await recarregar()
        return { ok: false, erro: 'O produto foi salvo, mas o histórico da entrada não foi registrado. NÃO cadastre de novo — confira o estoque antes de repetir.' }
      }
    }

    await recarregar()
    return { ok: true }
  }

  async function excluirInsumo(item: Estoque): Promise<ResultadoExclusao> {
    const { error } = await supabase.from('insumos').delete().eq('id', item.insumo_id)
    if (error) return { ok: false, erro: mensagemErro(error) }
    await recarregar()
    return { ok: true }
  }

  async function converterUnidade(item: Estoque, novaUnidade: string, fator: number): Promise<ResultadoExclusao> {
    if (!fazendaAtiva) return { ok: false, erro: 'Nenhuma fazenda ativa selecionada' }

    const novaQtd   = parseFloat((item.quantidade_atual * fator).toFixed(3))
    const novoPreco = item.preco_medio_unitario > 0
      ? parseFloat((item.preco_medio_unitario / fator).toFixed(4))
      : 0

    const { data: insumoUpdated, error: insumoError } = await supabase
      .from('insumos').update({ unidade: novaUnidade }).eq('id', item.insumo_id).select('id')
    if (insumoError) return { ok: false, erro: mensagemErro(insumoError) }
    if (!insumoUpdated || insumoUpdated.length === 0) {
      return { ok: false, erro: 'Sem permissão para alterar. Verifique as políticas do banco.' }
    }

    const { data: estoqueUpdated, error: estoqueError } = await supabase.from('estoque').update({
      quantidade_atual: novaQtd,
      ...(novoPreco > 0 ? { preco_medio_unitario: novoPreco } : {}),
    }).eq('id', item.id).select('id')

    if (estoqueError || !estoqueUpdated || estoqueUpdated.length === 0) {
      // Update da quantidade falhou (ou RLS barrou em silêncio) — desfaz a
      // unidade pra não deixar o produto com unidade nova e quantidade na
      // unidade antiga (ex.: 20 caixas viram "20 L", 20x subavaliado).
      await supabase.from('insumos').update({ unidade: item.insumos.unidade }).eq('id', item.insumo_id)
      const detalhe = estoqueError
        ? estoqueError.message
        : 'sem permissão para alterar. Verifique as políticas do banco.'
      return {
        ok: false,
        erro: `Erro ao atualizar a quantidade — nenhuma alteração foi salva: ${detalhe}`,
      }
    }

    const { error: movError } = await supabase.from('movimentacoes_estoque').insert({
      insumo_id: item.insumo_id,
      tipo:      'entrada',
      quantidade: novaQtd,
      data:      new Date().toISOString().split('T')[0],
      origem:    'correcao_unidade',
      fazenda_id: fazendaAtiva.id,
    })
    if (movError) {
      // A unidade e a quantidade já foram convertidas de verdade no banco — só o
      // histórico falhou. Atualiza a tela com o valor novo pra não deixar o produtor
      // achar que a conversão não aconteceu e repetir (aplicaria o fator duas vezes).
      await recarregar()
      return { ok: false, erro: 'A conversão foi salva, mas o histórico não foi registrado. NÃO converta de novo — confira o estoque antes de repetir.' }
    }

    await recarregar()
    return { ok: true }
  }

  return {
    estoque, movimentacoes, loading, erroCarregamento, recarregar,
    ajustarEstoque, editarMovimentacao, excluirMovimentacao,
    criarInsumo, excluirInsumo, converterUnidade,
  }
}
