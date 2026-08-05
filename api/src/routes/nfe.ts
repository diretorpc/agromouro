import { Router } from 'express'
import { z } from 'zod'
import { importarXmlManual, excluirNotaManual } from '../services/nfeManual'

export const nfeRoutes = Router()

const importarSchema = z.object({
  xml: z.string().min(50),
})

// ACHADO 6 (revisão do Apolo, 05/08/2026): a fazenda vem do usuário
// autenticado, nunca do corpo do pedido. A API usa a chave de serviço do
// Supabase, que desliga o RLS (a regra do banco que isola fazenda) — sem
// esta checagem, um fazenda_id errado no corpo gravaria ou apagaria nota
// na fazenda errada. Mesmo padrão de api/src/routes/contas.ts e cartoes.ts.
function fazendaDe(req: any): string | undefined {
  return req.user?.app_metadata?.fazenda_ativa_id as string | undefined
}

// POST /nfe/importar-xml — upload manual de XML pela tela, processado pelo
// mesmo caminho do e-mail automático (CFOP, estoque, boleto, WhatsApp).
// 'criada' e 'duplicada' voltam como 200: as duas são respostas válidas do
// pedido, não erro de requisição. Só XML inválido (422) e falha de
// processamento (500) viram erro HTTP de verdade.
nfeRoutes.post('/importar-xml', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = importarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const resultado = await importarXmlManual(parsed.data.xml, fazendaId)

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

// DELETE /nfe/:id — apaga a nota e desfaz o que ela criou (estoque e boleto),
// numa transação só (migration 009_excluir_nota_fiscal.sql).
nfeRoutes.delete('/:id', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  try {
    const resultado = await excluirNotaManual(req.params.id, fazendaId)

    switch (resultado.status) {
      case 'excluida':
        res.status(204).send()
        return
      case 'nao_encontrada':
        res.status(404).json({ error: 'Nota não encontrada.' })
        return
      case 'em_processamento':
        res.status(409).json({ error: 'Esta nota está sendo processada agora pelo e-mail automático. Tente excluir de novo em alguns segundos.' })
        return
      case 'boleto_pago':
        res.status(409).json({ error: 'Esta nota tem um boleto já marcado como pago. Desmarque o pagamento em Contas a Pagar antes de excluir.' })
        return
      case 'erro':
        res.status(500).json({ error: 'Erro ao excluir a nota.', detalhe: resultado.mensagem })
        return
    }
  } catch (err) {
    next(err)
  }
})
