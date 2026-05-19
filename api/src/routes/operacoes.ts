import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../services/supabase'

export const operacaoRoutes = Router()

// GET /operacoes — listar operações (filtros: talhao_id, limit)
operacaoRoutes.get('/', async (req, res, next) => {
  try {
    let query = supabase
      .from('operacoes')
      .select('*, talhoes(nome)')
      .order('data', { ascending: false })
      .limit(50)

    // Validar UUID antes de usar como filtro
    const talhaoId = req.query.talhao_id as string | undefined
    if (talhaoId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(talhaoId)) {
        return res.status(400).json({ error: 'talhao_id inválido' })
      }
      query = query.eq('talhao_id', talhaoId)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// POST /operacoes — registrar operação manualmente
const operacaoSchema = z.object({
  talhao_id:   z.string().uuid(),
  safra_id:    z.string().uuid().optional(),
  tipo:        z.enum(['plantio', 'pulverizacao', 'adubacao', 'colheita', 'outro']),
  data:        z.string(), // ISO date string
  descricao:   z.string().min(3),
  fonte:       z.enum(['whatsapp', 'manual', 'jd']).default('manual'),
})

operacaoRoutes.post('/', async (req, res, next) => {
  try {
    const body = operacaoSchema.parse(req.body)

    const { data, error } = await supabase
      .from('operacoes')
      .insert(body)
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})
