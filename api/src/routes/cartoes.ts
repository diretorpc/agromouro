import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../services/supabase'
import { parseXLSX } from '../services/xlsxParser'

export const cartaoRoutes = Router()

// ─── Schema de validação ──────────────────────────────────────────────────────

const cartaoSchema = z.object({
  apelido:         z.string().min(1),
  ultimos_digitos: z.string().length(4).regex(/^\d{4}$/).optional(),
  banco:           z.string().default('Banco do Brasil'),
  responsavel:     z.string().optional(),
})

// ─── GET /cartoes — listar cartões da fazenda ─────────────────────────────────
cartaoRoutes.get('/', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('cartoes')
      .select('*')
      .eq('fazenda_id', fazendaId)
      .eq('ativo', true)
      .order('apelido', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// ─── POST /cartoes — cadastrar cartão ────────────────────────────────────────
cartaoRoutes.post('/', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = cartaoSchema.parse(req.body)

    const { data, error } = await supabase
      .from('cartoes')
      .insert({ ...body, fazenda_id: fazendaId })
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

// ─── PUT /cartoes/:id — atualizar cartão ─────────────────────────────────────
cartaoRoutes.put('/:id', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = cartaoSchema.partial().parse(req.body)

    const { data, error } = await supabase
      .from('cartoes')
      .update(body)
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Cartão não encontrado' })
    res.json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── DELETE /cartoes/:id — desativar cartão (soft delete) ────────────────────
cartaoRoutes.delete('/:id', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { error } = await supabase
      .from('cartoes')
      .update({ ativo: false })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)

    if (error) throw error
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ─── POST /cartoes/importar-preview — parseia XLSX, retorna prévia ────────────
// Body: { arquivo: string (base64 do .xlsx) }
cartaoRoutes.post('/importar-preview', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { arquivo } = req.body as { arquivo?: string }
    if (!arquivo) return res.status(400).json({ error: 'Campo arquivo (base64) obrigatório' })

    const buffer = Buffer.from(arquivo, 'base64')
    const transacoes = parseXLSX(buffer)

    if (transacoes.length === 0) {
      return res.status(400).json({ error: 'Nenhuma transação encontrada no arquivo' })
    }

    // Buscar cartões cadastrados para a fazenda (match por apelido)
    const { data: cartoes, error: errCartoes } = await supabase
      .from('cartoes')
      .select('id, apelido')
      .eq('fazenda_id', fazendaId)
      .eq('ativo', true)

    if (errCartoes) throw errCartoes

    const cartaoMap = new Map<string, string>(
      (cartoes ?? []).map(c => [c.apelido.toLowerCase(), c.id])
    )

    // Buscar hashes já importados para detectar duplicatas
    const hashesDoArquivo = transacoes.map(t => t.dedupHash)
    const { data: jaImportados } = await supabase
      .from('lancamentos_financeiros')
      .select('dedup_hash')
      .in('dedup_hash', hashesDoArquivo)
      .eq('fazenda_id', fazendaId)

    const hashesImportados = new Set((jaImportados ?? []).map(r => r.dedup_hash))

    // Montar resposta agrupada por titular
    const grupos: Record<string, {
      cartao_id:  string | null
      transacoes: Array<{
        dedupHash:    string
        data:         string
        descricao:    string
        valor:        number
        categoria:    string
        incluir:      boolean
        ja_importado: boolean
      }>
    }> = {}

    for (const t of transacoes) {
      const titular = t.titular
      if (!grupos[titular]) {
        grupos[titular] = {
          cartao_id: cartaoMap.get(titular.toLowerCase()) ?? null,
          transacoes: [],
        }
      }
      grupos[titular].transacoes.push({
        dedupHash:    t.dedupHash,
        data:         t.data,
        descricao:    t.descricao,
        valor:        t.valor,
        categoria:    'outros',
        incluir:      !hashesImportados.has(t.dedupHash),
        ja_importado: hashesImportados.has(t.dedupHash),
      })
    }

    res.json({
      total:         transacoes.length,
      ja_importados: hashesImportados.size,
      grupos,
    })
  } catch (err) {
    next(err)
  }
})

// ─── POST /cartoes/confirmar-importacao — salvar transações confirmadas ───────
const confirmarSchema = z.array(z.object({
  dedupHash: z.string(),
  cartao_id: z.string().uuid(),
  data:      z.string(),
  descricao: z.string(),
  valor:     z.number().positive(),
  categoria: z.string(),
  incluir:   z.boolean(),
}))

cartaoRoutes.post('/confirmar-importacao', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const itens = confirmarSchema.parse(req.body)
    const selecionados = itens.filter(i => i.incluir)

    if (selecionados.length === 0) {
      return res.status(400).json({ error: 'Nenhuma transação selecionada para importar' })
    }

    const registros = selecionados.map(i => ({
      data:       i.data,
      descricao:  i.descricao,
      valor:      i.valor,
      tipo:       'despesa' as const,
      categoria:  i.categoria,
      origem:     'cartao' as const,
      cartao_id:  i.cartao_id,
      dedup_hash: i.dedupHash,
      fazenda_id: fazendaId,
    }))

    const { data, error } = await supabase
      .from('lancamentos_financeiros')
      .upsert(registros, { onConflict: 'cartao_id,dedup_hash', ignoreDuplicates: true })
      .select()

    if (error) throw error
    res.status(201).json({ importados: data?.length ?? 0 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /cartoes/lancamento — lançamento manual avulso ─────────────────────
const lancamentoManualSchema = z.object({
  data:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descricao: z.string().min(1),
  valor:     z.number().positive(),
  categoria: z.enum(['peca_maquina', 'manutencao', 'alimentacao', 'combustivel', 'servico', 'outros']),
  cartao_id: z.string().uuid(),
})

cartaoRoutes.post('/lancamento', async (req, res, next) => {
  try {
    const fazendaId = req.user?.app_metadata?.fazenda_ativa_id as string | undefined
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = lancamentoManualSchema.parse(req.body)

    const { data, error } = await supabase
      .from('lancamentos_financeiros')
      .insert({
        ...body,
        tipo:       'despesa',
        origem:     'manual',
        dedup_hash: null,
        fazenda_id: fazendaId,
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
