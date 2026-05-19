import { Router } from 'express'
import { supabase } from '../services/supabase'

export const alertaRoutes = Router()

// GET /alertas — alertas ativos (não lidos primeiro)
alertaRoutes.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('alertas')
      .select('*')
      .order('lido', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// PATCH /alertas/:id/lida — marcar alerta como lido
alertaRoutes.patch('/:id/lida', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('alertas')
      .update({ lido: true })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})
