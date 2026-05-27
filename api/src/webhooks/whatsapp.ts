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

INFERÊNCIA DE dose_tipo (CRÍTICO — agricultor raramente digita "/ha"):

Convenção brasileira de agricultura: em pulverização, dose é SEMPRE por hectare
implícita. Combustível é SEMPRE total. Aplique esta lógica de inferência:

- operacao_tipo = "pulverizacao" → dose_tipo = "por_ha" (mesmo sem "/ha" no texto)
- operacao_tipo = "adubacao"     → dose_tipo = "por_ha" (padrão)
- operacao_tipo = "calagem"      → dose_tipo = "por_ha"
- operacao_tipo = "plantio"      → dose_tipo = "por_ha"
- insumo é combustível (diesel, óleo diesel, gasolina) → dose_tipo = "total"
- usuário diz "/ha" explícito → dose_tipo = "por_ha" (override absoluto)
- usuário diz "no total", "ao todo", "ao final" → dose_tipo = "total" (override absoluto)

REGRAS PARA EXTRAIR DOSE:
- "2L de primóleo"        em pulverização   → dose_valor: 2,   dose_unidade: "L",  dose_tipo: "por_ha"
- "1,5 kg de glifosato"   em pulverização   → dose_valor: 1.5, dose_unidade: "kg", dose_tipo: "por_ha"
- "300ml de adjuvante"    em pulverização   → dose_valor: 300, dose_unidade: "ml", dose_tipo: "por_ha"
- "2L/ha de Score"        explícito         → dose_valor: 2,   dose_unidade: "L",  dose_tipo: "por_ha"
- "50L de diesel"         (combustível)     → dose_valor: 50,  dose_unidade: "L",  dose_tipo: "total"
- "100L no total"         override          → dose_valor: 100, dose_unidade: "L",  dose_tipo: "total"

MÚLTIPLOS INSUMOS NA MESMA OPERAÇÃO (caso mais comum em pulverização):
Entrada: "pulverizei talhão lagoa, 2l de primóleo, 1,5 kg de glifosato, 1 litro de adjuvante"
Saída (note: dose_tipo "por_ha" inferido porque operacao_tipo é pulverizacao):
{
  "tipo": "OPERACAO",
  "dados": {
    "talhao": "lagoa",
    "operacao_tipo": "pulverizacao",
    "data": null,
    "insumos": [
      { "nome": "primóleo",  "dose_valor": 2,   "dose_unidade": "L",  "dose_tipo": "por_ha" },
      { "nome": "glifosato", "dose_valor": 1.5, "dose_unidade": "kg", "dose_tipo": "por_ha" },
      { "nome": "adjuvante", "dose_valor": 1,   "dose_unidade": "L",  "dose_tipo": "por_ha" }
    ]
  }
}

OPERAÇÃO SEM INSUMOS (ex: colheita, plantio sem semente especificada):
- insumos: []  (array vazio)

CONSULTA DE ESTOQUE:
- "quanto tem de glifosato?"              → insumos: [{ "nome": "glifosato", "dose_valor": null, "dose_unidade": null, "dose_tipo": null }]
- "quanto tem de glifosato e ureia?"      → insumos: [{ "nome": "glifosato", ... }, { "nome": "ureia", ... }]

Responda SOMENTE em JSON válido, sem texto extra:
{
  "tipo": "OPERACAO" | "APLICACAO_INSUMO" | "CONSULTA_ESTOQUE" | "CONSULTA_GERAL" | "DESCONHECIDO",
  "dados": {
    "talhao": "nome ou número do talhão mencionado (ou null)",
    "operacao_tipo": "plantio|pulverizacao|adubacao|colheita|calagem|outro (ou null)",
    "insumos": [
      {
        "nome": "nome do produto",
        "dose_valor": número da dose (ou null),
        "dose_unidade": "L|ml|kg|g|sc|cx|un (ou null)",
        "dose_tipo": "por_ha|total (ou null)"
      }
    ],
    "data": "use a data de hoje se disser hoje, ontem se disser ontem, formato YYYY-MM-DD (ou null)",
    "cultura": "nome da cultura mencionada (ou null)"
  }
}`,
    messages: [{ role: 'user', content: texto }],
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Resposta inesperada da IA')

  // Haiku às vezes envolve o JSON em ```json ... ``` mesmo instruído a não.
  // Estratégia robusta: tentar parse direto; se falhar, remover wrapper de markdown
  // e/ou extrair entre o primeiro { e o último } do texto.
  const raw = content.text.trim()
  try {
    return JSON.parse(raw)
  } catch {
    console.warn('[WhatsApp DEBUG] Haiku JSON parse falhou — raw:', raw.slice(0, 400))
  }

  // Tentativa 2: remover ```json ... ``` ou ``` ... ```
  const semWrapper = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(semWrapper)
  } catch {/* segue para tentativa 3 */}

  // Tentativa 3: extrair entre primeiro { e último }
  const inicio = raw.indexOf('{')
  const fim    = raw.lastIndexOf('}')
  if (inicio >= 0 && fim > inicio) {
    try {
      return JSON.parse(raw.slice(inicio, fim + 1))
    } catch {/* desiste */}
  }

  return { tipo: 'DESCONHECIDO', dados: {} }
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

// ─── Buscar insumo por nome ──────────────────────────────────────────────────
// Decisão MVP: sem auto-criação. Se não achar, retorna null e o chamador avisa
// o agricultor no WA. Fuzzy match + confirmação ficam para pós-MVP.
//
// IMPORTANTE: preferimos insumos que tenham linha em estoque. Caso existam
// duplicatas no banco (mesmo nome, IDs diferentes — origem comum: importação
// repetida de NF-e), o `.limit(1)` puro escolheria um aleatório, podendo
// pegar um órfão sem estoque e falhar silenciosamente no UPDATE.
async function buscarInsumo(nome: string) {
  const nomeSanitizado = nome.trim().slice(0, 100)
  if (!nomeSanitizado) return null

  const { data } = await supabase
    .from('insumos')
    .select('id, nome, unidade, estoque(id)')
    .ilike('nome', `%${nomeSanitizado}%`)
    .limit(5)

  if (!data || data.length === 0) return null

  // Prefere o primeiro insumo que tenha pelo menos uma linha em estoque
  type Row = { id: string; nome: string; unidade: string; estoque: { id: string }[] | null }
  const rows      = data as unknown as Row[]
  const comEstoque = rows.find(r => Array.isArray(r.estoque) && r.estoque.length > 0)
  const escolhido  = comEstoque ?? rows[0]

  return { id: escolhido.id, nome: escolhido.nome, unidade: escolhido.unidade }
}

// ─── Resolver insumos: nome textual → dados prontos para o banco ─────────────
type InsumoBruto = {
  nome: string
  dose_valor: number | null
  dose_unidade: string | null
  dose_tipo: string | null   // 'por_ha' | 'total' | null
}

type InsumoResolvido =
  | { ok: true;  insumo_id: string; nome: string; quantidade: number; unidade: string; dose_por_ha: number | null }
  | { ok: false; nome: string; erro: string }

async function resolverInsumos(
  insumos: InsumoBruto[],
  talhao: { area_ha: number } | null,
): Promise<InsumoResolvido[]> {
  return Promise.all(insumos.map(async (item): Promise<InsumoResolvido> => {
    const insumo = await buscarInsumo(item.nome)
    if (!insumo) {
      return { ok: false, nome: item.nome, erro: 'insumo não encontrado no banco' }
    }

    if (item.dose_valor == null || !item.dose_tipo) {
      return { ok: false, nome: item.nome, erro: 'dose não extraída' }
    }

    let quantidade: number
    let dosePorHa: number | null = null
    if (item.dose_tipo === 'total') {
      quantidade = item.dose_valor
    } else if (item.dose_tipo === 'por_ha') {
      if (!talhao?.area_ha) {
        return { ok: false, nome: item.nome, erro: 'dose por hectare mas talhão sem área' }
      }
      quantidade = item.dose_valor * talhao.area_ha
      dosePorHa  = item.dose_valor
    } else {
      return { ok: false, nome: item.nome, erro: `dose_tipo desconhecido: ${item.dose_tipo}` }
    }

    return {
      ok:          true,
      insumo_id:   insumo.id,
      nome:        insumo.nome,
      quantidade,
      unidade:     item.dose_unidade || insumo.unidade,
      dose_por_ha: dosePorHa,
    }
  }))
}

// ─── Processar mensagem recebida ──────────────────────────────────────────────
async function processarMensagem(telefone: string, texto: string) {
  try {
    const classificacao = await classificarMensagem(texto)
    const { tipo, dados } = classificacao
    let resposta = ''

    // DEBUG TEMPORÁRIO: revelar o que o Haiku classificou
    console.log('[WhatsApp DEBUG] Haiku tipo:', tipo, '| dados:', JSON.stringify(dados))

    const insumos: Array<{ nome: string; dose_valor: number | null; dose_unidade: string | null; dose_tipo: string | null }> =
      Array.isArray(dados.insumos) ? dados.insumos : []

    if (tipo === 'CONSULTA_ESTOQUE' && insumos.length > 0) {
      const respostas = await Promise.all(insumos.map(i => consultarEstoque(i.nome)))
      resposta = respostas.join('\n')

    } else if (tipo === 'OPERACAO' || tipo === 'APLICACAO_INSUMO') {
      const talhao = dados.talhao ? await buscarTalhao(dados.talhao) : null
      const dataOp = dados.data || new Date().toISOString().split('T')[0]

      // Insert da operação capturando o id gerado
      const { data: operacao, error: opErr } = await supabase
        .from('operacoes')
        .insert({
          talhao_id: talhao?.id || null,
          tipo:      dados.operacao_tipo || 'outro',
          data:      dataOp,
          descricao: texto.slice(0, 500),
          fonte:     'whatsapp',
        })
        .select('id')
        .single()

      if (opErr || !operacao) throw opErr ?? new Error('Falha ao criar operação')
      const operacaoId = operacao.id

      // Resolve insumos (busca id no banco, calcula quantidade total)
      const resolvidos = await resolverInsumos(insumos, talhao)
      const okItems   = resolvidos.filter((i): i is Extract<InsumoResolvido, { ok: true }>  => i.ok === true)
      const failItems = resolvidos.filter((i): i is Extract<InsumoResolvido, { ok: false }> => i.ok === false)

      type SaidaProcessada = {
        nome: string
        quantidade: number
        unidade: string
        novaQuantidade: number | null   // null = sem linha em estoque
        minimo: number | null
      }
      let saidasProcessadas: SaidaProcessada[] = []

      if (okItems.length > 0) {
        // Batch insert em itens_operacao (alimenta /custos e /operacoes)
        // descricao=null quando há insumo_id (espelha o form web: descricao é só para entradas manuais sem cadastro)
        const { error: itensErr } = await supabase.from('itens_operacao').insert(
          okItems.map(item => ({
            operacao_id: operacaoId,
            insumo_id:   item.insumo_id,
            descricao:   null,
            quantidade:  item.quantidade,
            dose_por_ha: item.dose_por_ha,
            unidade:     item.unidade,
          })),
        )
        if (itensErr) {
          console.error('[WhatsApp] Erro ao inserir itens_operacao:', itensErr.message)
        }

        // Batch insert em movimentacoes_estoque (alimenta o histórico em /estoque)
        const { error: movErr } = await supabase.from('movimentacoes_estoque').insert(
          okItems.map(item => ({
            insumo_id:   item.insumo_id,
            tipo:        'saida' as const,
            quantidade:  item.quantidade,
            data:        dataOp,
            origem:      'operacao' as const,
            operacao_id: operacaoId,
          })),
        )
        if (movErr) {
          console.error('[WhatsApp] Erro ao inserir movimentacoes_estoque:', movErr.message)
        }

        // Decrementar quantidade_atual em estoque (Passo 6)
        // 1 SELECT batch pega todos os atuais + mínimos; N UPDATEs em paralelo
        const insumoIds = okItems.map(i => i.insumo_id)
        const { data: estoqueAtual } = await supabase
          .from('estoque')
          .select('insumo_id, quantidade_atual, quantidade_minima_alerta')
          .in('insumo_id', insumoIds)

        const estoqueMap = new Map(
          (estoqueAtual ?? []).map(e => [
            e.insumo_id,
            { atual: Number(e.quantidade_atual ?? 0), minimo: Number(e.quantidade_minima_alerta ?? 0) },
          ]),
        )

        saidasProcessadas = await Promise.all(okItems.map(async (item): Promise<SaidaProcessada> => {
          const linha = estoqueMap.get(item.insumo_id)
          if (!linha) {
            console.warn(`[WhatsApp] Sem linha em estoque para ${item.nome} (insumo_id ${item.insumo_id})`)
            return { nome: item.nome, quantidade: item.quantidade, unidade: item.unidade, novaQuantidade: null, minimo: null }
          }
          const nova = linha.atual - item.quantidade
          const { error: updErr } = await supabase
            .from('estoque')
            .update({ quantidade_atual: nova })
            .eq('insumo_id', item.insumo_id)
          if (updErr) {
            console.error(`[WhatsApp] Falha ao decrementar estoque de ${item.nome}:`, updErr.message)
          }
          return { nome: item.nome, quantidade: item.quantidade, unidade: item.unidade, novaQuantidade: nova, minimo: linha.minimo }
        }))
      }

      // Compor resposta no WhatsApp
      const nomeLocal = talhao ? `Talhão ${talhao.nome} (${talhao.area_ha}ha)` : 'talhão não identificado'
      const linhasOk = saidasProcessadas.map(s => {
        const restante  = s.novaQuantidade != null ? ` (estoque: ${s.novaQuantidade}${s.unidade})` : ''
        const abaixoMin = s.novaQuantidade != null && s.minimo != null && s.minimo > 0 && s.novaQuantidade <= s.minimo
        const aviso     = abaixoMin ? ` ⚠️ abaixo do mín. (${s.minimo}${s.unidade})` : ''
        return `📦 ${s.nome}: ${s.quantidade}${s.unidade}${restante}${aviso}`
      }).join('\n')
      const linhasFail = failItems.map(f => `❌ ${f.nome}: ${f.erro}`).join('\n')

      resposta = `✅ Registrado!\n📍 ${nomeLocal}\n🔧 ${dados.operacao_tipo || 'Operação'}\n📅 ${dados.data || 'hoje'}`
      if (linhasOk)   resposta += `\n\n${linhasOk}`
      if (linhasFail) resposta += `\n\n⚠️ Não processados:\n${linhasFail}`

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

// ─── Proteção: whitelist de números autorizados ───────────────────────────────
function isAuthorized(phone: string): boolean {
  const raw = process.env.WHATSAPP_AUTHORIZED_PHONES || ''
  if (!raw.trim()) return true // sem whitelist configurada → permite tudo (retrocompat)
  const authorized = raw.split(',').map(p => normalizarPhone(p.trim())).filter(Boolean)
  return authorized.includes(normalizarPhone(phone))
}

// ─── Rota do webhook ──────────────────────────────────────────────────────────
whatsappWebhook.post('/', async (req, res) => {
  // DEBUG TEMPORÁRIO: snapshot do payload bruto (recortado para evitar spam de log)
  const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : []
  console.log('[WhatsApp DEBUG] body keys:', bodyKeys.join(', '),
    '| phone:', JSON.stringify(req.body?.phone),
    '| text:', JSON.stringify(req.body?.text)?.slice(0, 200),
    '| message:', JSON.stringify(req.body?.message)?.slice(0, 200))

  const parsed = zapiPayloadSchema.safeParse(req.body)
  if (!parsed.success) {
    console.warn('[WhatsApp DEBUG] schema falhou:', parsed.error.issues.slice(0, 3))
    return res.status(200).json({ ok: true })
  }

  const { phone, text } = parsed.data

  if (!text?.message?.trim()) {
    console.warn('[WhatsApp DEBUG] sem text.message — phone:', phone)
    return res.status(200).json({ ok: true })
  }

  // Prefixo de ativação — calculado antes da proteção anti-loop porque mensagens
  // do próprio número COM o prefixo são propositais (uso single-tenant), não loop
  const prefix     = (process.env.WHATSAPP_TRIGGER_PREFIX || '').trim().toLowerCase()
  const rawMessage = text.message.trim()
  const hasExplicitTrigger = prefix.length > 0 && rawMessage.toLowerCase().startsWith(prefix)

  console.log('[WhatsApp DEBUG] phone:', phone, '| msg:', rawMessage.slice(0, 80),
    '| hasExplicitTrigger:', hasExplicitTrigger, '| prefix:', prefix)

  // Anti-loop: ignorar mensagens do próprio bot SALVO quando começam com o prefixo
  // (no setup single-tenant o agricultor manda pra própria conta com "!agro …")
  const botPhone = normalizarPhone(process.env.ZAPI_PHONE || '')
  if (normalizarPhone(phone) === botPhone && !hasExplicitTrigger) {
    console.warn('[WhatsApp DEBUG] rejeitado por anti-loop (phone===botPhone, sem prefixo)')
    return res.status(200).json({ ok: true })
  }

  // Passo 0 — Whitelist: só números autorizados acionam o bot
  if (!isAuthorized(phone)) {
    console.warn('[WhatsApp DEBUG] rejeitado por whitelist — phone normalizado:', normalizarPhone(phone))
    return res.status(200).json({ ok: true })
  }

  // Passo 0 — Prefixo obrigatório (quando configurado)
  if (prefix && !hasExplicitTrigger) {
    console.warn('[WhatsApp DEBUG] rejeitado por falta de prefixo')
    return res.status(200).json({ ok: true })
  }

  // Strip do prefixo antes de passar ao Claude
  const texto = (prefix ? rawMessage.slice(prefix.length).trim() : rawMessage).slice(0, 1000)
  if (!texto) {
    console.warn('[WhatsApp DEBUG] texto vazio após strip do prefixo')
    return res.status(200).json({ ok: true })
  }

  console.log('[WhatsApp DEBUG] vai processar — texto:', texto)

  processarMensagem(phone, texto).catch((err) =>
    console.error('[WhatsApp] Erro inesperado em background:', err instanceof Error ? err.message : err)
  )

  res.status(200).json({ ok: true })
})
