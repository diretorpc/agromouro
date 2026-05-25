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

// ─── Parsear resposta de confirmação posicional ou explícita ─────────────────
// Suporta: "20\n20\nok" | "20 20 ok" | "1=20, 2=20, 3=ok"
function parsearRespostaConfirmacao(texto: string, total: number): (number | 'ok')[] | null {
  const textoLimpo = texto.trim()

  // Formato explícito: "1=20, 2=ok" ou "1=20 2=ok"
  if (/\d+=/.test(textoLimpo)) {
    const mapa: Record<number, number | 'ok'> = {}
    const matches = [...textoLimpo.matchAll(/(\d+)\s*=\s*([^\s,]+)/g)]

    for (const match of matches) {
      const idx   = parseInt(match[1], 10)
      const valor = match[2].toLowerCase()
      mapa[idx]   = valor === 'ok' ? 'ok' : parseFloat(valor)
      if (typeof mapa[idx] === 'number' && isNaN(mapa[idx] as number)) return null
    }

    const resultado: (number | 'ok')[] = []
    for (let i = 1; i <= total; i++) {
      if (mapa[i] === undefined) return null
      resultado.push(mapa[i])
    }
    return resultado
  }

  // Formato posicional: um valor por linha ou separado por espaço
  const partes = textoLimpo.includes('\n')
    ? textoLimpo.split('\n').map(s => s.trim()).filter(Boolean)
    : textoLimpo.split(/\s+/)

  if (partes.length !== total) return null

  const resultado: (number | 'ok')[] = []
  for (const parte of partes) {
    if (parte.toLowerCase() === 'ok') {
      resultado.push('ok')
    } else {
      const num = parseFloat(parte.replace(',', '.'))
      if (isNaN(num) || num <= 0) return null
      resultado.push(num)
    }
  }

  return resultado
}

// ─── Processar resposta de confirmação de unidades comerciais ─────────────────
async function processarConfirmacoes(telefone: string, texto: string): Promise<boolean> {
  const agora           = new Date().toISOString()
  const telefoneLimpo   = normalizarPhone(telefone)

  console.log(`[WhatsApp] processarConfirmacoes — telefone="${telefoneLimpo}" texto="${texto.slice(0, 50)}"`)

  // Sistema single-tenant: busca todas as pendências em aberto (não filtra por telefone
  // porque ZAPI_PHONE pode diferir do número que chega no webhook dependendo da configuração Z-API)
  const { data: pendentes } = await supabase
    .from('confirmacoes_pendentes')
    .select('*')
    .eq('enviado', true)
    .eq('respondido', false)
    .gt('expires_at', agora)
    .order('ordem', { ascending: true })

  console.log(`[WhatsApp] Pendentes encontradas: ${pendentes?.length ?? 0}${pendentes?.[0] ? ` (telefone armazenado: ${pendentes[0].telefone})` : ''}`)

  if (!pendentes || pendentes.length === 0) return false

  const fatores = parsearRespostaConfirmacao(texto, pendentes.length)

  if (!fatores) {
    // Formato não reconhecido — lembrar o usuário das pendências
    const exemplo = pendentes.map((p, i) => {
      const payload = p.payload as any
      return p.fator_sugerido
        ? `${i + 1}) ${payload.insumo_nome}: ok`
        : `${i + 1}) ${payload.insumo_nome}: [número]`
    }).join('\n')

    await enviarMensagem(telefone,
      `⚠️ Ainda aguardo confirmação de ${pendentes.length} item(s).\n\n` +
      `Responda um valor por linha:\n${exemplo}`
    )
    return true
  }

  // Aplicar fatores e atualizar estoque
  const nfeIds = new Set<string>()

  for (let i = 0; i < pendentes.length; i++) {
    const confirmacao = pendentes[i]
    const payload     = confirmacao.payload as any
    const resposta    = fatores[i]

    let fator: number | null = null
    if (resposta === 'ok') {
      if (!confirmacao.fator_sugerido) {
        await enviarMensagem(telefone,
          `❌ Item ${i + 1} (${payload.insumo_nome}) não tem fator detectado automaticamente.\n` +
          `Informe o número de ${payload.unidade_base} por ${payload.unidade_comercial}.`
        )
        return true
      }
      fator = Number(confirmacao.fator_sugerido)
    } else {
      fator = resposta as number
    }

    const quantidadeBase     = parseFloat((payload.quantidade_comercial * fator).toFixed(3))
    const precoUnitarioBase  = parseFloat((payload.valor_unitario_comercial / fator).toFixed(4))

    // Registrar movimentação com dados de conversão rastreados por transação
    await supabase.from('movimentacoes_estoque').insert({
      insumo_id:            payload.insumo_id,
      tipo:                 'entrada',
      quantidade:           quantidadeBase,
      data:                 payload.data,
      origem:               'nfe',
      nota_fiscal_id:       payload.nfe_id,
      unidade_comercial:    payload.unidade_comercial,
      quantidade_comercial: payload.quantidade_comercial,
      fator_conversao:      fator,
    })

    await supabase.rpc('incrementar_estoque', {
      p_insumo_id:  payload.insumo_id,
      p_quantidade: quantidadeBase,
    })

    if (precoUnitarioBase > 0) {
      await supabase.from('estoque')
        .update({ preco_medio_unitario: precoUnitarioBase })
        .eq('insumo_id', payload.insumo_id)
    }

    await supabase.from('confirmacoes_pendentes')
      .update({ respondido: true, fator_usado: fator })
      .eq('id', confirmacao.id)

    nfeIds.add(payload.nfe_id)

    console.log(
      `[WhatsApp] Conversão confirmada: ${payload.insumo_nome} — ` +
      `${payload.quantidade_comercial} ${payload.unidade_comercial} × ${fator} = ${quantidadeBase} ${payload.unidade_base}`
    )
  }

  // Verificar se todas as confirmações de cada NF-e foram respondidas
  for (const nfeId of nfeIds) {
    const { count } = await supabase
      .from('confirmacoes_pendentes')
      .select('*', { count: 'exact', head: true })
      .eq('payload->>nfe_id', nfeId)
      .eq('respondido', false)

    if (count === 0) {
      await supabase.from('notas_fiscais')
        .update({ status: 'processada' })
        .eq('id', nfeId)

      const { data: nfe } = await supabase
        .from('notas_fiscais')
        .select('numero, emitente_nome, valor_total')
        .eq('id', nfeId)
        .single()

      if (nfe) {
        await enviarMensagem(telefone,
          `✅ *NF-e processada*\n` +
          `👤 ${nfe.emitente_nome}\n` +
          `💰 R$ ${Number(nfe.valor_total).toFixed(2)}\n` +
          `📦 Estoque atualizado com conversão confirmada.`
        )
      }
    }
  }

  return true
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
    // Antes do Haiku: interceptar respostas de confirmação de unidades comerciais
    const foiConfirmacao = await processarConfirmacoes(telefone, texto)
    if (foiConfirmacao) return

    // Fluxo normal via Haiku
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
