import { Router } from 'express'
import { supabase } from '../services/supabase'

export const estoqueRoutes = Router()

// GET /estoque — estoque atual de todos os insumos
estoqueRoutes.get('/', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('estoque')
      .select('*, insumos(nome, tipo, unidade)')
      .eq('fazenda_id', fazendaId)
      // Supabase não suporta .order() em colunas de tabela relacionada.
      // "Mais recente primeiro" é a ordem padrão da tela; o frontend
      // reordena por nome quando o usuário pedir.
      .order('created_at', { ascending: false })

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
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    // Filtrar por fazenda_id junto com insumo_id fecha, na mesma query, tanto a
    // mistura de dados entre fazendas quanto o IDOR (trocar o insumo_id na URL
    // para ler histórico de outra fazenda): a combinação só bate se o registro
    // for da fazenda do usuário. fazenda_id é NOT NULL (migração 001) — uma
    // gravação sem ele é RECUSADA pelo banco, não fica órfã sem fazenda_id.
    // O cadastro manual em web/app/(app)/estoque/hooks/use-estoque-data.ts não
    // envia fazenda_id nas gravações de movimentação e não confere o erro:
    // a movimentação é recusada em silêncio enquanto o saldo (update separado,
    // que não exige fazenda_id) é atualizado — saldo muda, histórico não.
    const { data, error } = await supabase
      .from('movimentacoes_estoque')
      .select('*')
      .eq('insumo_id', req.params.insumo_id)
      .eq('fazenda_id', fazendaId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})
