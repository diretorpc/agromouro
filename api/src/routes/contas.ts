import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../services/supabase'
import { sincronizarOcorrencias } from '../services/contas/sincronizar'
import { precisaCriarLancamento, montarLancamento } from '../services/contas/pagamento'

export const contaRoutes = Router()

const ISO = /^\d{4}-\d{2}-\d{2}$/

// Schema base separado do .refine(): ZodEffects (o tipo que .refine() devolve)
// não tem .partial() no zod 3.x — o PATCH abaixo precisa da forma "objeto puro"
// para aceitar edição parcial.
const recorrenteBase = z.object({
  descricao:         z.string().min(1),
  fornecedor:        z.string().min(1),
  categoria:         z.string().min(1),
  periodicidade:     z.enum(['mensal', 'bimestral', 'trimestral', 'semestral', 'anual']),
  dia_vencimento:    z.number().int().min(1).max(31),
  mes_primeira:      z.number().int().min(1).max(12).nullable().optional(),
  valor_referencia:  z.number().nonnegative().nullable().optional(),
  avisar_dias_antes: z.number().int().min(0).max(30).default(3),
})

const recorrenteSchema = recorrenteBase.refine(r => r.periodicidade === 'mensal' || r.mes_primeira != null, {
  message: 'Conta que não é mensal precisa do mês da primeira ocorrência',
  path: ['mes_primeira'],
})

const avulsaSchema = z.object({
  descricao:  z.string().min(1),
  fornecedor: z.string().nullable().optional(),
  categoria:  z.string().nullable().optional(),
  vencimento: z.string().regex(ISO),
  valor:      z.number().nonnegative(),
})

const edicaoSchema = z.object({
  valor:      z.number().nonnegative().optional(),
  vencimento: z.string().regex(ISO).optional(),
  categoria:  z.string().nullable().optional(),
  observacao: z.string().nullable().optional(),
})

const pagamentoSchema = z.object({
  data_pagamento: z.string().regex(ISO),
  valor_pago:     z.number().nonnegative(),
})

function fazendaDe(req: any): string | undefined {
  return req.user?.app_metadata?.fazenda_ativa_id as string | undefined
}

// ─── GET /contas ──────────────────────────────────────────────────────────────
contaRoutes.get('/', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .select('*, contas_recorrentes(avisar_dias_antes, periodicidade)')
      .eq('fazenda_id', fazendaId)
      .order('vencimento', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) { next(err) }
})

// ─── GET /contas/recorrentes ──────────────────────────────────────────────────
contaRoutes.get('/recorrentes', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .select('*')
      .eq('fazenda_id', fazendaId)
      .order('descricao', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) { next(err) }
})

// ─── POST /contas/recorrentes ─────────────────────────────────────────────────
contaRoutes.post('/recorrentes', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = recorrenteSchema.parse(req.body)

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .insert({ ...body, fazenda_id: fazendaId })
      .select()
      .single()

    if (error) throw error

    // Já cria as ocorrências da janela para a conta aparecer na hora,
    // sem esperar a tarefa das 07:00 do dia seguinte.
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    await sincronizarOcorrencias(fazendaId, hoje)

    res.status(201).json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── PATCH /contas/recorrentes/:id ────────────────────────────────────────────
contaRoutes.patch('/recorrentes/:id', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = recorrenteBase.partial().parse(req.body)

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .update(body)
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta fixa não encontrada' })
    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /contas — conta avulsa ──────────────────────────────────────────────
contaRoutes.post('/', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = avulsaSchema.parse(req.body)

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .insert({
        ...body,
        competencia:    `${body.vencimento.slice(0, 7)}-01`,
        valor_estimado: false,
        status:         'aberta',
        fazenda_id:     fazendaId,
      })
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

// ─── PATCH /contas/:id — registrar o valor real ───────────────────────────────
contaRoutes.patch('/:id', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = edicaoSchema.parse(req.body)

    // Informar o valor confirma a conta: deixa de ser estimativa e passa a 'aberta'.
    const patch: Record<string, unknown> = { ...body }
    if (body.valor !== undefined) {
      patch.valor_estimado = false
      patch.status = 'aberta'
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update(patch)
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /contas/:id/pagar ───────────────────────────────────────────────────
contaRoutes.post('/:id/pagar', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = pagamentoSchema.parse(req.body)

    const { data: conta, error: erroBusca } = await supabase
      .from('contas_a_pagar')
      .select('*')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (erroBusca) throw erroBusca
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' })
    if (conta.status === 'paga') return res.status(409).json({ error: 'Esta conta já está paga' })

    let lancamentoId: string | null = null

    if (precisaCriarLancamento(conta)) {
      const { data: lanc, error: erroLanc } = await supabase
        .from('lancamentos_financeiros')
        .insert(montarLancamento(conta, body.data_pagamento, body.valor_pago))
        .select('id')
        .single()

      if (erroLanc) throw erroLanc
      lancamentoId = lanc.id
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({
        status:         'paga',
        data_pagamento: body.data_pagamento,
        valor_pago:     body.valor_pago,
        lancamento_id:  lancamentoId,
      })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /contas/:id/desfazer-pagamento ──────────────────────────────────────
contaRoutes.post('/:id/desfazer-pagamento', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data: conta, error: erroBusca } = await supabase
      .from('contas_a_pagar')
      .select('id, lancamento_id')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (erroBusca) throw erroBusca
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' })

    // Só apaga o lançamento que ESTA conta criou.
    if (conta.lancamento_id) {
      const { error: erroDelete } = await supabase
        .from('lancamentos_financeiros')
        .delete()
        .eq('id', conta.lancamento_id)
        .eq('fazenda_id', fazendaId)

      if (erroDelete) throw erroDelete
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({ status: 'aberta', data_pagamento: null, valor_pago: null, lancamento_id: null })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) { next(err) }
})

// ─── POST /contas/:id/dispensar ───────────────────────────────────────────────
contaRoutes.post('/:id/dispensar', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({ status: 'dispensada' })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) { next(err) }
})
