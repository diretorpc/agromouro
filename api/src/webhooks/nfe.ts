import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../services/supabase'
import { enviarMensagem } from '../services/zapi'

export const nfeWebhook = Router()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TIPOS_VALIDOS = [
  'herbicida', 'fungicida', 'inseticida', 'biologico',
  'fertilizante_n', 'fertilizante_p', 'fertilizante_k', 'fertilizante_outro', 'calcario',
  'semente', 'combustivel', 'lubrificante', 'peca_maquina',
  'servico', 'frete', 'operacional', 'rh', 'outro',
] as const

type TipoInsumo = typeof TIPOS_VALIDOS[number]

// ─── Categorizar item da NF-e com Claude Haiku ────────────────────────────────
async function categorizarItem(descricao: string): Promise<TipoInsumo> {
  const descSanitizada = descricao.trim().slice(0, 200)

  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 50,
    system:     'Classifique itens de nota fiscal agrícola. Responda SOMENTE com a categoria, sem texto extra.',
    messages:   [{
      role:    'user',
      content: `Item: "${descSanitizada}"\nCategorias: herbicida, fungicida, inseticida, biologico, fertilizante_n, fertilizante_p, fertilizante_k, fertilizante_outro, calcario, semente, combustivel, lubrificante, peca_maquina, servico, frete, operacional, rh, outro`,
    }],
  })

  const content = response.content[0]
  const tipo = content.type === 'text' ? content.text.trim().toLowerCase() : 'outro'
  return TIPOS_VALIDOS.includes(tipo as TipoInsumo) ? (tipo as TipoInsumo) : 'outro'
}

// ─── Buscar insumo existente por similaridade de nome ────────────────────────
async function buscarInsumo(descricao: string) {
  const primeirasPalavras = descricao.trim().split(' ').slice(0, 2).join(' ')

  const { data } = await supabase
    .from('insumos')
    .select('id, nome, unidade')
    .ilike('nome', `%${primeirasPalavras}%`)
    .limit(1)
    .single()

  return data || null
}

// ─── Buscar ou criar insumo automaticamente ───────────────────────────────────
async function vincularOuCriarInsumo(
  descricao: string,
  tipo: TipoInsumo,
  unidadeNfe: string,
): Promise<{ id: string; nome: string; unidade: string; autoCreated: boolean }> {
  const existente = await buscarInsumo(descricao)
  if (existente) return { ...existente, autoCreated: false }

  const nome = descricao.trim().slice(0, 200)
  const unidade = unidadeNfe?.trim().slice(0, 20) || 'un'

  const { data: novoInsumo, error: errInsumo } = await supabase
    .from('insumos')
    .insert({ nome, tipo, unidade })
    .select('id, nome, unidade')
    .single()

  if (errInsumo || !novoInsumo) throw new Error(`Falha ao criar insumo: ${errInsumo?.message}`)

  await supabase
    .from('estoque')
    .insert({ insumo_id: novoInsumo.id, quantidade_atual: 0, quantidade_minima_alerta: 0 })

  return { ...novoInsumo, autoCreated: true }
}

// ─── Processar NF-e recebida ──────────────────────────────────────────────────
nfeWebhook.post('/', async (req, res) => {
  res.status(200).json({ ok: true }) // Responder 200 imediatamente

  const payload = req.body
  let nfeId: string | null = null

  try {
    const {
      number:      numero,
      issuedOn:    dataEmissao,
      issuerName:  emitenteNome,
      issuerCnpj:  emitenteCnpj,
      grandTotal:  valorTotal,
      items = [],
    } = payload

    const itensSeguros = (items as any[]).slice(0, 200)

    // 1. Salvar NF-e no banco
    const { data: nfe, error: nfeError } = await supabase
      .from('notas_fiscais')
      .insert({
        numero,
        emitente_nome:  emitenteNome,
        emitente_cnpj:  emitenteCnpj,
        data_emissao:   dataEmissao,
        valor_total:    valorTotal,
        status:         'processando',
        xml_raw:        JSON.stringify(payload),
      })
      .select('id')
      .single()

    if (nfeError) throw nfeError
    nfeId = nfe.id

    // 2. Processar cada item
    const itensAtualizados:  string[] = []
    const itensAutoCriados:  string[] = []

    for (const item of itensSeguros) {
      const tipo   = await categorizarItem(item.description || '')
      const insumo = await vincularOuCriarInsumo(item.description || '', tipo, item.unit || 'un')

      await supabase.from('itens_nfe').insert({
        nota_fiscal_id: nfeId,
        descricao:      (item.description || '').slice(0, 500),
        quantidade:     item.quantity,
        unidade:        item.unit,
        valor_unitario: item.unitValue,
        valor_total:    item.totalValue,
        insumo_id:      insumo.id,
      })

      await supabase.from('movimentacoes_estoque').insert({
        insumo_id:      insumo.id,
        tipo:           'entrada',
        quantidade:     item.quantity,
        data:           dataEmissao?.split('T')[0] || new Date().toISOString().split('T')[0],
        origem:         'nfe',
        nota_fiscal_id: nfeId,
      })

      await supabase.rpc('incrementar_estoque', {
        p_insumo_id:  insumo.id,
        p_quantidade: item.quantity,
      })

      const linha = `• ${item.quantity}${item.unit} ${insumo.nome}`
      if (insumo.autoCreated) itensAutoCriados.push(linha)
      else                    itensAtualizados.push(linha)
    }

    // 3. Lançamento financeiro automático
    await supabase.from('lancamentos_financeiros').insert({
      data:           dataEmissao?.split('T')[0] || new Date().toISOString().split('T')[0],
      descricao:      `NF-e ${numero || ''} — ${emitenteNome}`,
      valor:          valorTotal,
      tipo:           'despesa',
      categoria:      'insumos',
      nota_fiscal_id: nfeId,
    })

    // 4. Marcar NF-e como processada
    await supabase
      .from('notas_fiscais')
      .update({ status: 'processada' })
      .eq('id', nfeId)

    // 5. Notificar no WhatsApp
    const phone  = process.env.ZAPI_PHONE!
    let mensagem = `📄 *NF-e processada*\n👤 ${emitenteNome}\n💰 R$ ${Number(valorTotal).toFixed(2)}\n\n`

    if (itensAtualizados.length > 0) {
      mensagem += `✅ *Estoque atualizado:*\n${itensAtualizados.join('\n')}`
    }
    if (itensAutoCriados.length > 0) {
      if (itensAtualizados.length > 0) mensagem += '\n\n'
      mensagem += `🆕 *Novos insumos cadastrados automaticamente:*\n${itensAutoCriados.join('\n')}`
    }

    await enviarMensagem(phone, mensagem)

  } catch (err) {
    console.error('[NFe] Erro ao processar:', err instanceof Error ? err.message : err)

    if (nfeId) {
      await supabase
        .from('notas_fiscais')
        .update({ status: 'erro' })
        .eq('id', nfeId)
    }
  }
})
