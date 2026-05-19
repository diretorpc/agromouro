import { Request, Response, NextFunction } from 'express'

const isProd = process.env.NODE_ENV === 'production'

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Em produção: loga sem stack trace (pode conter dados sensíveis)
  // Em dev: loga tudo para facilitar o debug
  if (isProd) {
    console.error(`[ERRO] ${req.method} ${req.path} — ${err.message}`)
  } else {
    console.error(`[ERRO] ${req.method} ${req.path}`, err)
  }

  // Nunca enviar stack trace para o cliente
  res.status(500).json({
    error: 'Erro interno do servidor',
    // Mensagem detalhada apenas em desenvolvimento
    ...(isProd ? {} : { detalhe: err.message }),
  })
}
