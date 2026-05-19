import { Router } from 'express'
import { supabase } from '../services/supabase'

export const talhaoRoutes = Router()

// GET /talhoes — listar todos os talhões com cultura atual
talhaoRoutes.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('talhoes')
      .select('*, safras(cultura, status, data_plantio)')
      .order('nome')

    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// GET /talhoes/:id — detalhe de um talhão
talhaoRoutes.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('talhoes')
      .select('*, safras(*), operacoes(id, tipo, data, descricao, fonte)')
      .eq('id', req.params.id)
      .order('data', { referencedTable: 'operacoes', ascending: false })
      .limit(20, { referencedTable: 'operacoes' })
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Talhão não encontrado' })
    res.json(data)
  } catch (err) {
    next(err)
  }
})
