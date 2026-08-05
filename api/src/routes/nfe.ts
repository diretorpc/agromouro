import { Router } from 'express'
import { z } from 'zod'
import { importarXmlManual } from '../services/nfeManual'

export const nfeRoutes = Router()

const importarSchema = z.object({
  xml:        z.string().min(50),
  fazenda_id: z.string().uuid(),
})

// POST /nfe/importar-xml — upload manual de XML pela tela, processado pelo
// mesmo caminho do e-mail automático (CFOP, estoque, boleto, WhatsApp).
// 'criada' e 'duplicada' voltam como 200: as duas são respostas válidas do
// pedido, não erro de requisição. Só XML inválido (422) e falha de
// processamento (500) viram erro HTTP de verdade.
nfeRoutes.post('/importar-xml', async (req, res, next) => {
  const parsed = importarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const resultado = await importarXmlManual(parsed.data.xml, parsed.data.fazenda_id)

    if (resultado.status === 'invalida') {
      res.status(422).json({ error: 'Arquivo XML inválido ou formato não reconhecido.' })
      return
    }
    if (resultado.status === 'erro') {
      res.status(500).json({ error: 'Erro ao processar a nota fiscal.', detalhe: resultado.mensagem })
      return
    }

    res.status(200).json(resultado)
  } catch (err) {
    next(err)
  }
})
