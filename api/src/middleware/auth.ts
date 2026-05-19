import { Request, Response, NextFunction } from 'express'
import { User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'

// Extensão do tipo Request para carregar o usuário autenticado
declare global {
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

/**
 * Middleware de autenticação via token JWT do Supabase.
 * O frontend envia: Authorization: Bearer <access_token>
 * Usa o service client existente para validar — sem criar novo cliente por request.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não informado' })
  }

  const token = authHeader.split(' ')[1]

  // Proteção básica: token vazio ou muito curto
  if (!token || token.length < 20) {
    return res.status(401).json({ error: 'Token inválido' })
  }

  try {
    // Reutiliza o service client — não cria novo cliente a cada request
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido ou expirado' })
    }

    req.user = user
    next()
  } catch {
    res.status(401).json({ error: 'Falha na autenticação' })
  }
}
