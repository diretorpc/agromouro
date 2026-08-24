import { Router } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../services/supabase'
import { enviarMensagem, getAuthorizedPhones } from '../services/zapi'

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
    console.warn('[WhatsApp] Haiku JSON parse falhou — tentando fallbacks. Raw:', raw.slice(0, 400))
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
// export: exercitado direto por whatsapp.test.ts (isolamento entre fazendas).
// fazendaId é obrigatório: o cliente supabase daqui usa SERVICE_KEY (bypassa RLS
// por completo — as policies dependem de auth.uid(), que não existe no backend).
// Sem este filtro escrito à mão, a consulta do MT devolveria o número do MG.
export async function consultarEstoque(nomeInsumo: string, fazendaId: string): Promise<string> {
  const nomeSanitizado = nomeInsumo.trim().slice(0, 100)

  const { data: insumos } = await supabase
    .from('insumos')
    .select('id, nome, unidade')
    .eq('fazenda_id', fazendaId)
    .ilike('nome', `%${nomeSanitizado}%`)
    .limit(3)

  if (!insumos || insumos.length === 0) {
    return `Não encontrei "${nomeSanitizado}" no estoque. Verifique o nome do produto.`
  }

  const ids = insumos.map((i: any) => i.id)
  const { data: estoques } = await supabase
    .from('estoque')
    .select('insumo_id, quantidade_atual, quantidade_minima_alerta')
    .eq('fazenda_id', fazendaId)
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
// export: exercitado direto por whatsapp.test.ts (trava de área arrendada e
// isolamento entre fazendas).
// fazendaId é obrigatório: o cliente supabase daqui usa SERVICE_KEY (bypassa RLS
// por completo — as policies dependem de auth.uid(), que não existe no backend).
// Sem .eq('fazenda_id', ...), "talhão 5" da fazenda A podia casar com um talhão
// de nome idêntico na fazenda B (ilike frouxo, sem .order() = ordem indefinida).
export async function buscarTalhao(nomeTalhao: string, fazendaId: string) {
  const nomeSanitizado = nomeTalhao.trim().slice(0, 100)

  const { data } = await supabase
    .from('talhoes')
    .select('id, nome, area_ha')
    .eq('fazenda_id', fazendaId)
    // Área arrendada é operada pela Usina Uberaba, não pela família — não pode
    // receber operação por NENHUMA porta (WhatsApp, form web, API direta).
    // Sem este filtro, "apliquei glifosato no Gogo" podia casar com um talhão
    // arrendado de nome parecido (ilike frouxo, sem .order() = ordem indefinida).
    .neq('status', 'arrendado')
    .ilike('nome', `%${nomeSanitizado}%`)
    .limit(1)
    .single()

  return data
}

// ─── Buscar insumo por nome ──────────────────────────────────────────────────
// export: exercitado direto por whatsapp.test.ts (isolamento entre fazendas).
// Decisão MVP: sem auto-criação. Se não achar, retorna null e o chamador avisa
// o agricultor no WA. Fuzzy match + confirmação ficam para pós-MVP.
//
// IMPORTANTE: preferimos insumos que tenham linha em estoque. Caso existam
// duplicatas no banco (mesmo nome, IDs diferentes — origem comum: importação
// repetida de NF-e), o `.limit(1)` puro escolheria um aleatório, podendo
// pegar um órfão sem estoque e falhar silenciosamente no UPDATE.
//
// fazendaId é obrigatório: o cliente supabase daqui usa SERVICE_KEY (bypassa RLS
// por completo). Sem .eq('fazenda_id', ...), "glifosato" da fazenda A podia casar
// com o glifosato da fazenda B e gravar movimentação de estoque cruzada.
export async function buscarInsumo(nome: string, fazendaId: string) {
  const nomeSanitizado = nome.trim().slice(0, 100)
  if (!nomeSanitizado) return null

  const { data } = await supabase
    .from('insumos')
    .select('id, nome, unidade, estoque(id)')
    .eq('fazenda_id', fazendaId)
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

type SaidaProcessada = {
  nome: string
  quantidade: number
  unidade: string
  novaQuantidade: number | null   // null = sem linha em estoque OU UPDATE que não gravou nenhuma linha
  minimo: number | null
}

async function resolverInsumos(
  insumos: InsumoBruto[],
  talhao: { area_ha: number } | null,
  fazendaId: string,
): Promise<InsumoResolvido[]> {
  return Promise.all(insumos.map(async (item): Promise<InsumoResolvido> => {
    const insumo = await buscarInsumo(item.nome, fazendaId)
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

// ─── Decrementar estoque após operação com insumos ───────────────────────────
// export: exercitado direto por whatsapp.test.ts (UPDATE mudo de estoque).
//
// 1 SELECT batch pega todos os atuais + mínimos; N UPDATEs em paralelo, cada um
// filtrado por fazenda_id (última linha de defesa contra insumo_id vazando de
// outra fazenda — não deveria acontecer após o filtro em buscarInsumo, mas é
// barato garantir de novo aqui). O Supabase retorna error:null mesmo quando o
// .eq() não casa NENHUMA linha — por isso o UPDATE usa .select() e conta as
// linhas retornadas para saber se realmente gravou. Sem essa checagem, a
// resposta do WhatsApp afirmava um saldo que nunca chegou a ser escrito no banco.
export async function decrementarEstoque(
  okItems: Extract<InsumoResolvido, { ok: true }>[],
  fazendaId: string,
): Promise<SaidaProcessada[]> {
  const insumoIds = okItems.map(i => i.insumo_id)
  const { data: estoqueAtual } = await supabase
    .from('estoque')
    .select('insumo_id, quantidade_atual, quantidade_minima_alerta')
    .eq('fazenda_id', fazendaId)
    .in('insumo_id', insumoIds)

  const estoqueMap = new Map(
    (estoqueAtual ?? []).map(e => [
      e.insumo_id,
      { atual: Number(e.quantidade_atual ?? 0), minimo: Number(e.quantidade_minima_alerta ?? 0) },
    ]),
  )

  return Promise.all(okItems.map(async (item): Promise<SaidaProcessada> => {
    const linha = estoqueMap.get(item.insumo_id)
    if (!linha) {
      console.warn(`[WhatsApp] Sem linha em estoque para ${item.nome} (insumo_id ${item.insumo_id})`)
      return { nome: item.nome, quantidade: item.quantidade, unidade: item.unidade, novaQuantidade: null, minimo: null }
    }
    const nova = linha.atual - item.quantidade
    const { data: linhasAtualizadas, error: updErr } = await supabase
      .from('estoque')
      .update({ quantidade_atual: nova })
      .eq('insumo_id', item.insumo_id)
      .eq('fazenda_id', fazendaId)
      .select('insumo_id')
    if (updErr) {
      console.error(`[WhatsApp] Falha ao decrementar estoque de ${item.nome}:`, updErr.message)
      return { nome: item.nome, quantidade: item.quantidade, unidade: item.unidade, novaQuantidade: null, minimo: linha.minimo }
    }
    if (!linhasAtualizadas || linhasAtualizadas.length === 0) {
      console.error(
        `[WhatsApp] UPDATE de estoque não casou nenhuma linha — saldo NÃO foi gravado.`,
        { nome: item.nome, insumo_id: item.insumo_id, fazenda_id: fazendaId },
      )
      return { nome: item.nome, quantidade: item.quantidade, unidade: item.unidade, novaQuantidade: null, minimo: linha.minimo }
    }
    return { nome: item.nome, quantidade: item.quantidade, unidade: item.unidade, novaQuantidade: nova, minimo: linha.minimo }
  }))
}

// ─── Formatar linhas de saída processada para a resposta do WhatsApp ────────
// export: exercitado direto por whatsapp.test.ts. novaQuantidade: null (sem
// linha em estoque OU UPDATE que não gravou) nunca pode virar "(estoque: ...)"
// na mensagem — seria afirmar um saldo que não existe no banco.
export function formatarSaidas(saidas: SaidaProcessada[]): string {
  return saidas.map(s => {
    const restante  = s.novaQuantidade != null ? ` (estoque: ${s.novaQuantidade}${s.unidade})` : ''
    const abaixoMin = s.novaQuantidade != null && s.minimo != null && s.minimo > 0 && s.novaQuantidade <= s.minimo
    const aviso     = abaixoMin ? ` ⚠️ abaixo do mín. (${s.minimo}${s.unidade})` : ''
    return `📦 ${s.nome}: ${s.quantidade}${s.unidade}${restante}${aviso}`
  }).join('\n')
}

// ─── Processar mensagem recebida ──────────────────────────────────────────────
async function processarMensagem(telefone: string, texto: string, fazenda_codigo: string = 'mg', fazenda_id?: string) {
  try {
    // Sem fazenda_id não há como filtrar buscarTalhao por tenant — o cliente
    // supabase daqui usa SERVICE_KEY e bypassa RLS por completo. Processar mesmo
    // assim repetiria o bug desta correção. Na prática isso nunca acontece: a
    // rota resolve a fazenda antes de chamar processarMensagem e retorna cedo se
    // não encontrar. O guard existe para falhar alto se essa garantia quebrar.
    if (!fazenda_id) {
      console.error('[WhatsApp] processarMensagem chamado sem fazenda_id — mensagem recusada por segurança', { telefone, fazenda_codigo })
      await enviarMensagem(telefone, `Tive um problema ao processar sua mensagem. Tente novamente em instantes.`, fazenda_codigo)
      return
    }

    const classificacao = await classificarMensagem(texto)
    const { tipo, dados } = classificacao
    let resposta = ''

    const insumos: Array<{ nome: string; dose_valor: number | null; dose_unidade: string | null; dose_tipo: string | null }> =
      Array.isArray(dados.insumos) ? dados.insumos : []

    if (tipo === 'CONSULTA_ESTOQUE' && insumos.length > 0) {
      const respostas = await Promise.all(insumos.map(i => consultarEstoque(i.nome, fazenda_id)))
      resposta = respostas.join('\n')

    } else if (tipo === 'OPERACAO' || tipo === 'APLICACAO_INSUMO') {
      const talhao = dados.talhao ? await buscarTalhao(dados.talhao, fazenda_id) : null
      const dataOp = dados.data || new Date().toISOString().split('T')[0]

      // Insert da operação capturando o id gerado
      const { data: operacao, error: opErr } = await supabase
        .from('operacoes')
        .insert({
          talhao_id:  talhao?.id || null,
          tipo:       dados.operacao_tipo || 'outro',
          data:       dataOp,
          descricao:  texto.slice(0, 500),
          fonte:      'whatsapp',
          fazenda_id: fazenda_id ?? null,
        })
        .select('id')
        .single()

      if (opErr || !operacao) throw opErr ?? new Error('Falha ao criar operação')
      const operacaoId = operacao.id

      // Resolve insumos (busca id no banco, calcula quantidade total)
      const resolvidos = await resolverInsumos(insumos, talhao, fazenda_id)
      const okItems   = resolvidos.filter((i): i is Extract<InsumoResolvido, { ok: true }>  => i.ok === true)
      const failItems = resolvidos.filter((i): i is Extract<InsumoResolvido, { ok: false }> => i.ok === false)

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
            fazenda_id:  fazenda_id ?? null,
          })),
        )
        if (movErr) {
          console.error('[WhatsApp] Erro ao inserir movimentacoes_estoque:', movErr.message)
        }

        // Decrementar quantidade_atual em estoque (Passo 6)
        saidasProcessadas = await decrementarEstoque(okItems, fazenda_id)
      }

      // Compor resposta no WhatsApp
      const nomeLocal = talhao ? `Talhão ${talhao.nome} (${talhao.area_ha}ha)` : 'talhão não identificado'
      const linhasOk = formatarSaidas(saidasProcessadas)
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

    await enviarMensagem(telefone, resposta, fazenda_codigo)

  } catch (err) {
    console.error('[WhatsApp] Erro ao processar mensagem:', err instanceof Error ? err.message : err)
    await enviarMensagem(telefone, `Tive um problema ao processar sua mensagem. Tente novamente em instantes.`, fazenda_codigo)
  }
}

// ─── Proteção: whitelist de números autorizados ───────────────────────────────
function isAuthorized(phone: string, authorizedPhones: string[]): boolean {
  if (authorizedPhones.length === 0) return true // sem whitelist configurada → permite tudo (retrocompat)
  return authorizedPhones.map(p => normalizarPhone(p)).includes(normalizarPhone(phone))
}

// ─── Rota do webhook ──────────────────────────────────────────────────────────
whatsappWebhook.post('/', async (req, res) => {
  const parsed = zapiPayloadSchema.safeParse(req.body)
  if (!parsed.success) return res.status(200).json({ ok: true })

  const { phone, text } = parsed.data

  if (!text?.message?.trim()) return res.status(200).json({ ok: true })

  res.status(200).json({ ok: true })

  // Tudo a partir daqui roda DEPOIS do res.status(200).json() já ter saído —
  // o handler é async e o Express 4 não captura rejeição de promise de
  // handler (não existe process.on('unhandledRejection') em api/src). Sem
  // este try/catch, qualquer throw aqui dentro (inclusive erro de rede no
  // .single() de fazendas, pré-existente) derruba o PROCESSO INTEIRO, não só
  // a mensagem. Foi exatamente assim que req.query.fazenda como array
  // (?fazenda=mg&fazenda=mt, que o `qs` do Express produz de verdade) crashou
  // o serviço num round anterior desta correção.
  try {
    // Fallback 'mg' proposital, NÃO remover às cegas: hoje existem 3 fazendas
    // (mg, tejuco, mt) e todo o dado de produção está em mg (18 talhões, 56
    // insumos, 55 linhas de estoque — tejuco e mt vazias). Se a URL do webhook
    // configurada na Z-API não passar ?fazenda=, qualquer mensagem de qualquer
    // fazenda cairia sempre em mg, e cairia CERTA por coincidência (é o único
    // banco com dado) — não daria pra perceber pelo comportamento do bot. Ainda
    // não sabemos se a URL configurada passa o parâmetro (o .env local não tem
    // ZAPI_CLIENT_TOKEN para consultar a config em produção). O fallback continua
    // ligado por segurança (não pode derrubar o bot), mas grita em log toda vez
    // que precisar adivinhar. Sai assim que o log confirmar que a URL passa
    // ?fazenda= de verdade.
    //
    // req.query.fazenda NÃO é sempre string — Express 4 usa `qs` com extended
    // por padrão: "fazenda=mg&fazenda=mt" vira ["mg","mt"], "fazenda[]=mg" vira
    // ["mg"], "fazenda[a]=1" vira {a:"1"}. Só o caso `typeof === 'string'` é
    // válido; qualquer outra forma cai no fallback em vez de chamar .trim() num
    // array/objeto.
    const rawFazenda = req.query.fazenda
    const fazendaQuery = typeof rawFazenda === 'string' ? rawFazenda.trim() : undefined
    if (!fazendaQuery) {
      console.error(
        `[WhatsApp] assumindo fazenda 'mg' por falta (ou formato inválido) do parâmetro ?fazenda= na URL do webhook`,
        { telefone: `...${normalizarPhone(phone).slice(-4)}`, valorRecebido: rawFazenda },
      )
    }
    const fazenda_codigo = fazendaQuery || 'mg'

    const { data: fazenda } = await supabase
      .from('fazendas')
      .select('id, codigo')
      .eq('codigo', fazenda_codigo)
      .single()

    if (!fazenda) {
      console.warn(`[WA] Fazenda não encontrada: ${fazenda_codigo}`)
      return
    }

    // Prefixo de ativação — calculado antes da proteção anti-loop porque mensagens
    // do próprio número COM o prefixo são propositais (uso single-tenant), não loop
    const prefix     = (process.env.WHATSAPP_TRIGGER_PREFIX || '').trim().toLowerCase()
    const rawMessage = text.message.trim()
    const hasExplicitTrigger = prefix.length > 0 && rawMessage.toLowerCase().startsWith(prefix)

    // Anti-loop: ignorar mensagens do próprio bot SALVO quando começam com o prefixo
    // (no setup single-tenant o agricultor manda pra própria conta com "!agro …")
    const botPhone = normalizarPhone(process.env[`ZAPI_PHONE_${fazenda_codigo.toUpperCase()}`] ?? process.env.ZAPI_PHONE ?? '')
    if (normalizarPhone(phone) === botPhone && !hasExplicitTrigger) {
      return
    }

    const authorizedPhones = getAuthorizedPhones(fazenda_codigo)

    // Whitelist: só números autorizados acionam o bot
    if (!isAuthorized(phone, authorizedPhones)) return

    // Prefixo obrigatório (quando configurado)
    if (prefix && !hasExplicitTrigger) return

    // Strip do prefixo antes de passar ao Claude
    const texto = (prefix ? rawMessage.slice(prefix.length).trim() : rawMessage).slice(0, 1000)
    if (!texto) return

    processarMensagem(phone, texto, fazenda_codigo, fazenda.id).catch((err) =>
      console.error('[WhatsApp] Erro inesperado em background:', err instanceof Error ? err.message : err)
    )
  } catch (err) {
    console.error('[WhatsApp] Erro inesperado no handler do webhook:', err instanceof Error ? err.message : err)
  }
})
