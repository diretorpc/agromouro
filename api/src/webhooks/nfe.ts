import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../services/supabase'
import { enviarMensagem } from '../services/zapi'

export const nfeWebhook = Router()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Categorizar item da NF-e com Claude Haiku ────────────────────────────────
async function categorizarItem(descricao: string): Promise<string> {
  const descSanitizada = descricao.trim().slice(0, 200)

  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 50,
    system:     'Classifique itens de nota fiscal agrícola. Responda SOMENTE com a categoria, sem texto extra.',
    messages:   [{
      role:    'user',
      content: `Item: "${descSanitizada}"\nCategorias: herbicida, fungicida, inseticida, fertilizante_n, fertilizante_p, fertilizante_k, fertilizante_outro, semente, combustivel, lubrificante, peca_maquina, servico, outro`,
    }],
  })

  const content = response.content[0]
  return content.type === 'text' ? content.text.trim().toLowerCase() : 'outro'
}

// ─── Tentar vincular item ao insumo cadastrado ────────────────────────────────
async function vincularInsumo(descricao: string) {
  const primeirasPalavras = descricao.trim().split(' ').slice(0, 2).join(' ')

  const { data } = await supabase
    .from('insumos')
    .select('id, nome, unidade')
    .ilike('nome', `%${primeirasPalavras}%`)
    .limit(1)
    .single()

  return data || null
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

    // Proteção: no máximo 200 itens por NF-e
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
        xml_raw:        JSON.stringify(payload), // guardar para reprocessamento
      })
      .select('id')
      .single()

    if (nfeError) throw nfeError
    nfeId = nfe.id

    // 2. Processar cada item
    const itensProcessados: string[] = []
    const itensSemVinculo: string[]  = []

    for (const item of itensSeguros) {
      const categoria = await categorizarItem(item.description || '')
      const insumo    = await vincularInsumo(item.description || '')

      await supabase.from('itens_nfe').insert({
        nota_fiscal_id: nfeId,
        descricao:      (item.description || '').slice(0, 500),
        quantidade:     item.quantity,
        unidade:        item.unit,
        valor_unitario: item.unitValue,
        valor_total:    item.totalValue,
        insumo_id:      insumo?.id || null,
      })

      if (insumo) {
        await supabase.from('movimentacoes_estoque').insert({
          insumo_id:      insumo.id,
          tipo:           'entrada',
          quantidade:     item.quantity,
          data:           dataEmissao?.split('T')[0] || new Date().toISOString().split('T')[0],
          origem:         'nfe',
          nota_fiscal_id: nfeId,
        })

        // FIX #2 — atualização atômica via RPC para evitar race condition.
        // A função incrementar_estoque(insumo_id, quantidade) faz o UPDATE
        // diretamente no banco sem ler o valor antes — operação thread-safe.
        await supabase.rpc('incrementar_estoque', {
          p_insumo_id:  insumo.id,
          p_quantidade: item.quantity,
        })

        itensProcessados.push(`• ${item.quantity}${item.unit} ${insumo.nome} → estoque atualizado`)
      } else {
        itensSemVinculo.push(`• ${item.description} (${item.quantity}${item.unit})`)
      }
    }

    // 3. Criar lançamento financeiro (despesa) automático
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
      .eq('id', nfeId) // FIX #3 — por ID, não por status

    // 5. Notificar no WhatsApp
    const phone   = process.env.ZAPI_PHONE!
    let mensagem  = `📄 *NF-e processada*\n👤 ${emitenteNome}\n💰 R$ ${Number(valorTotal).toFixed(2)}\n\n`

    if (itensProcessados.length > 0) {
      mensagem += `✅ *Estoque atualizado:*\n${itensProcessados.join('\n')}`
    }
    if (itensSemVinculo.length > 0) {
      mensagem += `\n\n⚠️ *Não reconhecidos (revisar no dashboard):*\n${itensSemVinculo.join('\n')}`
    }

    await enviarMensagem(phone, mensagem)

  } catch (err) {
    console.error('[NFe] Erro ao processar:', err instanceof Error ? err.message : err)

    // FIX #3 — marca SOMENTE esta NF-e como erro, não todas as que estão processando
    if (nfeId) {
      await supabase
        .from('notas_fiscais')
        .update({ status: 'erro' })
        .eq('id', nfeId)
    }
  }
})
