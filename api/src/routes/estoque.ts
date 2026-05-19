import { Router } from 'express'
import { supabase } from '../services/supabase'

export const estoqueRoutes = Router()

// GET /estoque — estoque atual de todos os insumos
estoqueRoutes.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('estoque')
      .select('*, insumos(nome, tipo, unidade)')
      // Supabase não suporta .order() em colunas de tabela relacionada.
      // Ordenamos pelo campo local e deixamos o frontend ordenar por nome se precisar.
      .order('quantidade_atual', { ascending: false })

    if (error) throw error

    // Marcar itens abaixo do mínimo
    const comAlerta = data.map((item: any) => ({
      ...item,
      abaixo_do_minimo: item.quantidade_atual <= item.quantidade_minima_alerta,
    }))

    res.json(comAlerta)
  } catch (err) {
    next(err)
  }
})

// GET /estoque/:insumo_id/movimentacoes — histórico de entradas e saídas
estoqueRoutes.get('/:insumo_id/movimentacoes', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('movimentacoes_estoque')
      .select('*')
      .eq('insumo_id', req.params.insumo_id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})
