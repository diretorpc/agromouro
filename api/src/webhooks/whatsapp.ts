import { Router } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../services/supabase'
import { enviarMensagem } from '../services/zapi'

export const whatsappWebhook = Router()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Schema de validação do payload Z-API ─────────────────────────────────────
const zapiPayloadSchema = z.object({
  phone: z.string().min(8).max(20),
  text:  z.object({ message: z.string().max(2000) }).optional(),
}).passthrough()

function normalizarPhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

// ─── Classificação da mensagem com Claude Haiku ───────────────────────────────
// SEGURANÇA: mensagem do usuário em role:user — nunca interpolada no system prompt.
async function classificarMensagem(texto: string) {
  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 512,
    system: `Você é um assistente de gestão agrícola brasileiro.
Classifique a mensagem do agricultor em uma categoria e extraia dados relevantes.

CATEGORIAS:
- OPERACAO: plantio, pulverização, adubação, colheita, calagem
- APLICACAO_INSUMO: uso de produto com dose/quantidade
- CONSULTA_ESTOQUE: pergunta sobre quantidade de algum produto em estoque
- CONSULTA_GERAL: outra pergunta sobre a fazenda
- DESCONHECIDO: não foi possível classificar

Responda SOMENTE em JSON válido, sem texto extra:
{
  "tipo": "OPERACAO" | "APLICACAO_INSUMO" | "CONSULTA_ESTOQUE" | "CONSULTA_GERAL" | "DESCONHECIDO",
  "dados": {
    "talhao": "nome ou número do talhão mencionado (ou null)",
    "operacao_tipo": "plantio|pulverizacao|adubacao|colheita|outro (ou null)",
    "insumo": "nome do produto mencionado (ou null)",
    "quantidade": "quantidade com unidade (ou null)",
    "data": "use a data de hoje se disser hoje, ontem se disser ontem (ou null)",
    "cultura": "nome da cultura mencionada (ou null)"
  }
}`,
    messages: [{ role: 'user', content: texto }],
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Resposta inesperada da IA')

  try {
    return JSON.parse(content.text)
  } catch {
    return { tipo: 'DESCONHECIDO', dados: {} }
  }
}

// ─── Consultar estoque de um insumo ──────────────────────────────────────────
async function consultarEstoque(nomeInsumo: string): Promise<string> {
  const nomeSanitizado = nomeInsumo.trim().slice(0, 100)

  const { data: insumos } = await supabase
    .from('insumos')
    .select('id, nome, unidade')
    .ilike('nome', `%${nomeSanitizado}%`)
    .limit(3)

  if (!insumos || insumos.length === 0) {
    return `Não encontrei "${nomeSanitizado}" no estoque. Verifique o nome do produto.`
  }

  const ids = insumos.map((i: any) => i.id)
  const { data: estoques } = await supabase
    .from('estoque')
    .select('insumo_id, quantidade_atual, quantidade_minima_alerta')
    .in('insumo_id', ids)

  if (!estoques || estoques.length === 0) {
    return `Produto encontrado mas sem registro de estoque ainda.`
  }

  return estoques.map((e: any) => {
    const insumo = insumos.find((i: any) => i.id === e.insumo_id)
    const alerta = e.quantidade_atual <= e.quantidade_minima_alerta ? ' ⚠️ ABAIXO DO MÍNIMO' : ''
    return `📦 ${insumo?.nome}: ${e.quantidade_atual} ${insumo?.unidade}${alerta}`
  }).join('\n')
}

// ─── Buscar talhão por nome/número ───────────────────────────────────────────
async function buscarTalhao(nomeTalhao: string) {
  const nomeSanitizado = nomeTalhao.trim().slice(0, 100)

  const { data } = await supabase
    .from('talhoes')
    .select('id, nome, area_ha')
    .ilike('nome', `%${nomeSanitizado}%`)
    .limit(1)
    .single()

  return data
}

// ─── Processar mensagem recebida ──────────────────────────────────────────────
async function processarMensagem(telefone: string, texto: string) {
  try {
    const classificacao = await classificarMensagem(texto)
    const { tipo, dados } = classificacao
    let resposta = ''

    if (tipo === 'CONSULTA_ESTOQUE' && dados.insumo) {
      resposta = await consultarEstoque(dados.insumo)

    } else if (tipo === 'OPERACAO' || tipo === 'APLICACAO_INSUMO') {
      const talhao = dados.talhao ? await buscarTalhao(dados.talhao) : null

      const { error } = await supabase.from('operacoes').insert({
        talhao_id: talhao?.id || null,
        tipo:      dados.operacao_tipo || 'outro',
        data:      dados.data || new Date().toISOString().split('T')[0],
        descricao: texto.slice(0, 500),
        fonte:     'whatsapp',
      })

      if (error) throw error

      const nomeLocal  = talhao ? `Talhão ${talhao.nome} (${talhao.area_ha}ha)` : 'talhão não identificado'
      const insumoInfo = dados.insumo ? ` — ${dados.quantidade || ''} ${dados.insumo}` : ''

      resposta = `✅ Registrado!\n📍 ${nomeLocal}\n🔧 ${dados.operacao_tipo || 'Operação'}${insumoInfo}\n📅 ${dados.data || 'hoje'}`

      if (!talhao && dados.talhao) {
        resposta += `\n\n⚠️ Não encontrei o talhão "${dados.talhao}". Verifique o nome.`
      }

    } else {
      resposta =
        `Não entendi bem. Tente assim:\n\n` +
        `• "Pulverizei o talhão 3 hoje com 2L/ha de Score"\n` +
        `• "Plantei soja no talhão 5 ontem"\n` +
        `• "Quanto tem de glifosato no estoque?"`
    }

    await enviarMensagem(telefone, resposta)

  } catch (err) {
    console.error('[WhatsApp] Erro ao processar mensagem:', err instanceof Error ? err.message : err)
    await enviarMensagem(telefone, `Tive um problema ao processar sua mensagem. Tente novamente em instantes.`)
  }
}

// ─── Rota do webhook ──────────────────────────────────────────────────────────
whatsappWebhook.post('/', async (req, res) => {
  const parsed = zapiPayloadSchema.safeParse(req.body)
  if (!parsed.success) return res.status(200).json({ ok: true })

  const { phone, text } = parsed.data

  if (!text?.message?.trim()) return res.status(200).json({ ok: true })

  const botPhone = normalizarPhone(process.env.ZAPI_PHONE || '')
  if (normalizarPhone(phone) === botPhone) return res.status(200).json({ ok: true })

  const texto = text.message.trim().slice(0, 1000)

  processarMensagem(phone, texto).catch((err) =>
    console.error('[WhatsApp] Erro inesperado em background:', err instanceof Error ? err.message : err)
  )

  res.status(200).json({ ok: true })
})
