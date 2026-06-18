import Anthropic from '@anthropic-ai/sdk'
import { XMLParser } from 'fast-xml-parser'
import { supabase } from './supabase'
import { enviarMensagem } from './zapi'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TIPOS_VALIDOS = [
  'herbicida', 'fungicida', 'inseticida', 'biologico', 'adjuvante',
  'fertilizante_n', 'fertilizante_p', 'fertilizante_k', 'fertilizante_outro', 'calcario',
  'semente', 'combustivel', 'lubrificante', 'peca_maquina',
  'servico', 'frete', 'operacional', 'rh', 'outro',
] as const

type TipoInsumo = typeof TIPOS_VALIDOS[number]

// Categorias que alimentam o ESTOQUE (insumos de campo consumíveis).
// Tipos fora desta lista (peça, serviço, frete, combustível, RH, etc.) são
// registrados apenas na nota e no financeiro — sem poluir o estoque.
const TIPOS_ESTOCAVEIS = new Set<TipoInsumo>([
  'herbicida', 'fungicida', 'inseticida', 'biologico', 'adjuvante',
  'fertilizante_n', 'fertilizante_p', 'fertilizante_k', 'fertilizante_outro', 'calcario',
  'semente',
])

// Unidades comerciais de embalagem — quando uCom ≠ uTrib, usa qTrib e uTrib como quantidade base
const UNIDADES_COMERCIAIS = new Set([
  'BD', 'PAC', 'CX', 'FR', 'BAG', 'BALDE', 'CAIXA', 'PACOTE', 'DOSE',
  'bag', 'cx', 'fr', 'bd', 'pac',
])

export interface NFeItem {
  description:  string
  quantity:     number   // qCom — quantidade na unidade comercial
  unit:         string   // uCom — unidade comercial (ex: BD, L, kg)
  unitValue:    number   // vUnCom — preço por unidade comercial
  totalValue:   number
  quantityTrib: number   // qTrib — quantidade em unidade tributável (ex: litros)
  unitTrib:     string   // uTrib — unidade tributável (ex: L, kg)
  ncm:          string   // ← NOVO: código NCM (8 dígitos), ex: "38089329"
}

export interface NFeData {
  numero:       string
  dataEmissao:  string
  emitenteNome: string
  emitenteCnpj: string
  valorTotal:   number
  items:        NFeItem[]
}

// ─── Parser de XML NF-e SEFAZ ────────────────────────────────────────────────
export function parseXmlNFe(xmlStr: string): NFeData | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes:    false,
      attributeNamePrefix: '@_',
      parseTagValue:       true,
    })
    const doc = parser.parse(xmlStr)

    const nfe = doc?.nfeProc?.NFe ?? doc?.NFe
    if (!nfe) return null

    const inf = nfe.infNFe
    if (!inf) return null

    const ide  = inf.ide  ?? {}
    const emit = inf.emit ?? {}
    const tot  = inf.total?.ICMSTot ?? {}

    const numero       = String(ide.nNF ?? '')
    const dataEmissao  = String(ide.dhEmi ?? ide.dEmi ?? '')
    const emitenteNome = String(emit.xNome ?? '')
    const emitenteCnpj = String(emit.CNPJ ?? emit.CPF ?? '')
    const valorTotal   = parseFloat(String(tot.vNF ?? 0))

    const detRaw = inf.det ?? []
    const dets   = Array.isArray(detRaw) ? detRaw : [detRaw]

    const items: NFeItem[] = dets.map((det: any) => {
      const prod = det?.prod ?? {}
      return {
        description:  String(prod.xProd ?? ''),
        quantity:     parseFloat(String(prod.qCom  ?? 0)),
        unit:         String(prod.uCom  ?? 'un'),
        unitValue:    parseFloat(String(prod.vUnCom ?? 0)),
        totalValue:   parseFloat(String(prod.vProd  ?? 0)),
        quantityTrib: parseFloat(String(prod.qTrib  ?? prod.qCom ?? 0)),
        unitTrib:     String(prod.uTrib ?? prod.uCom ?? 'un'),
        ncm:          String(prod.NCM ?? '').replace(/\D/g, ''),  // ← NOVO: só dígitos
      }
    }).filter((i: NFeItem) => i.description)

    if (!numero || !emitenteNome || items.length === 0) return null

    return { numero, dataEmissao, emitenteNome, emitenteCnpj, valorTotal, items }
  } catch (err) {
    console.error('[NFeProcessor] Erro ao parsear XML:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── Verificar duplicata ──────────────────────────────────────────────────────
export async function nfeJaProcessada(numero: string, fazenda_id: string): Promise<boolean> {
  const { data } = await supabase
    .from('notas_fiscais')
    .select('id')
    .eq('numero', numero)
    .eq('fazenda_id', fazenda_id)
    .limit(1)
    .single()
  return !!data
}

// Decide estoque/não-estoque pelo NCM (determinístico).
// Retorna null quando o NCM não é conclusivo → cai pro Haiku como fallback.
function fronteiraPorNCM(ncm: string): boolean | null {
  if (!ncm || ncm.length < 4) return null      // NCM ausente/inválido → fallback

  if (ncm.startsWith('3808')) return true       // defensivos
  if (ncm.startsWith('31'))   return true        // adubos/fertilizantes (cap. 31)
  if (ncm.startsWith('1209')) return true        // sementes para semeadura
  if (ncm.startsWith('2710')) return false       // combustível/lubrificante
  if (ncm.startsWith('84') || ncm.startsWith('87')) return false  // peças/máquinas

  return null                                    // desconhecido → Haiku decide
}

// ─── Categorizar item com Claude Haiku ───────────────────────────────────────
async function categorizarItem(descricao: string): Promise<TipoInsumo> {
  const descSanitizada = descricao.trim().slice(0, 200)
  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 50,
    system:     'Classifique itens de nota fiscal agrícola. Responda SOMENTE com a categoria, sem texto extra.',
    messages:   [{ role: 'user', content: `Item: "${descSanitizada}"\nCategorias: herbicida, fungicida, inseticida, biologico, adjuvante, fertilizante_n, fertilizante_p, fertilizante_k, fertilizante_outro, calcario, semente, combustivel, lubrificante, peca_maquina, servico, frete, operacional, rh, outro\nDica: adjuvante = espalhante, óleo mineral/vegetal, surfactante, regulador de pH, antiespumante` }],
  })
  const content = response.content[0]
  const tipo    = content.type === 'text' ? content.text.trim().toLowerCase() : 'outro'
  return TIPOS_VALIDOS.includes(tipo as TipoInsumo) ? (tipo as TipoInsumo) : 'outro'
}

// ─── Buscar ou criar insumo ───────────────────────────────────────────────────
async function vincularOuCriarInsumo(
  descricao: string, tipo: TipoInsumo, unidadeBase: string, fazenda_id: string,
): Promise<{ id: string; nome: string; unidade: string; autoCreated: boolean }> {
  const primeirasPalavras = descricao.trim().split(' ').slice(0, 2).join(' ')
  const { data: existente } = await supabase
    .from('insumos')
    .select('id, nome, unidade')
    .ilike('nome', `%${primeirasPalavras}%`)
    .eq('fazenda_id', fazenda_id)
    .limit(1)
    .single()

  if (existente) return { ...existente, autoCreated: false }

  const nome    = descricao.trim().slice(0, 200)
  const unidade = unidadeBase?.trim().slice(0, 20) || 'un'

  const { data: novoInsumo, error } = await supabase
    .from('insumos')
    .insert({ nome, tipo, unidade, fazenda_id })
    .select('id, nome, unidade')
    .single()

  if (error || !novoInsumo) throw new Error(`Falha ao criar insumo: ${error?.message}`)

  await supabase.from('estoque').insert({
    insumo_id: novoInsumo.id, quantidade_atual: 0, quantidade_minima_alerta: 0, fazenda_id,
  })

  return { ...novoInsumo, autoCreated: true }
}

// ─── Processador principal ────────────────────────────────────────────────────
export async function processarNFe(nfe: NFeData, origem: 'webhook' | 'email' = 'webhook', fazenda_id: string): Promise<void> {
  const { numero, dataEmissao, emitenteNome, emitenteCnpj, valorTotal, items } = nfe

  const itensSeguros  = items.slice(0, 200)
  const dataFormatada = dataEmissao?.split('T')[0] || new Date().toISOString().split('T')[0]
  // Normalizar para garantir match com o telefone que chega no webhook (só dígitos)
  const phone         = (process.env.ZAPI_PHONE || '').replace(/\D/g, '')

  let nfeId: string | null = null

  try {
    // 1. Salvar NF-e
    const { data: notaFiscal, error: nfeError } = await supabase
      .from('notas_fiscais')
      .insert({
        numero,
        emitente_nome: emitenteNome,
        emitente_cnpj: emitenteCnpj,
        data_emissao:  dataEmissao,
        valor_total:   valorTotal,
        status:        'processando',
        fazenda_id,
      })
      .select('id')
      .single()

    if (nfeError) throw nfeError
    nfeId = notaFiscal.id

    // 2. Processar todos os itens imediatamente (sem fluxo de confirmação)
    const itensAtualizados:  string[] = []
    const itensAutoCriados:  string[] = []
    const itensNaoEstocados: string[] = []

    for (const item of itensSeguros) {
      // Cascata: NCM decide a fronteira; o Haiku só desempata quando o NCM é mudo.
      const vereditoNCM = fronteiraPorNCM(item.ncm)
      const tipo        = await categorizarItem(item.description)  // ainda alimenta insumos.tipo
      const estocavel   = vereditoNCM !== null ? vereditoNCM : TIPOS_ESTOCAVEIS.has(tipo)

      // Itens não-estocáveis (peça, serviço, frete, combustível, RH, etc.):
      // registra só na nota — sem criar insumo, estoque ou movimentação.
      if (!estocavel) {
        await supabase.from('itens_nfe').insert({
          nota_fiscal_id: nfeId,
          descricao:      item.description.slice(0, 500),
          quantidade:     item.quantity,
          unidade:        item.unit,
          valor_unitario: item.unitValue,
          valor_total:    item.totalValue,
          insumo_id:      null,
          fazenda_id,
        })
        itensNaoEstocados.push(`• ${item.quantity}${item.unit} ${item.description.trim().slice(0, 60)}`)
        continue
      }

      // Se for unidade comercial com qTrib disponível, usa qTrib/uTrib como quantidade base
      const isComercial  = UNIDADES_COMERCIAIS.has(item.unit) && item.unitTrib && item.unitTrib !== item.unit
      const quantidade   = isComercial ? item.quantityTrib : item.quantity
      const unidadeBase  = isComercial ? item.unitTrib     : item.unit
      // Preço unitário na unidade base (vUnCom é por embalagem; divide pelo fator se comercial)
      const fator        = isComercial && item.quantity > 0 ? item.quantityTrib / item.quantity : 1
      const precoUnitario = fator > 0 ? item.unitValue / fator : item.unitValue

      const insumo = await vincularOuCriarInsumo(item.description, tipo, unidadeBase, fazenda_id)

      await supabase.from('itens_nfe').insert({
        nota_fiscal_id: nfeId,
        descricao:      item.description.slice(0, 500),
        quantidade:     item.quantity,
        unidade:        item.unit,
        valor_unitario: item.unitValue,
        valor_total:    item.totalValue,
        insumo_id:      insumo.id,
        fazenda_id,
      })

      if (precoUnitario > 0) {
        await supabase.from('estoque')
          .update({ preco_medio_unitario: parseFloat(precoUnitario.toFixed(4)) })
          .eq('insumo_id', insumo.id)
      }

      await supabase.from('movimentacoes_estoque').insert({
        insumo_id:            insumo.id,
        tipo:                 'entrada',
        quantidade:           quantidade,
        data:                 dataFormatada,
        origem:               'nfe',
        nota_fiscal_id:       nfeId,
        unidade_comercial:    isComercial ? item.unit            : null,
        quantidade_comercial: isComercial ? item.quantity        : null,
        fator_conversao:      isComercial ? parseFloat(fator.toFixed(4)) : null,
        fazenda_id,
      })

      await supabase.rpc('incrementar_estoque', {
        p_insumo_id:  insumo.id,
        p_quantidade: quantidade,
      })

      const linha = `• ${quantidade}${unidadeBase} ${insumo.nome}`
      if (insumo.autoCreated) itensAutoCriados.push(linha)
      else                    itensAtualizados.push(linha)
    }

    // 3. Lançamento financeiro
    await supabase.from('lancamentos_financeiros').insert({
      data:           dataFormatada,
      descricao:      `NF-e ${numero} — ${emitenteNome}`,
      valor:          valorTotal,
      tipo:           'despesa',
      categoria:      'insumos',
      nota_fiscal_id: nfeId,
      fazenda_id,
    })

    await supabase.from('notas_fiscais').update({ status: 'processada' }).eq('id', nfeId)

    const icone = origem === 'email' ? '📧' : '📄'
    let mensagem = `${icone} *NF-e processada*\n👤 ${emitenteNome}\n💰 R$ ${valorTotal.toFixed(2)}\n\n`

    if (itensAtualizados.length > 0)
      mensagem += `✅ *Estoque atualizado:*\n${itensAtualizados.join('\n')}`
    if (itensAutoCriados.length > 0) {
      if (itensAtualizados.length > 0) mensagem += '\n\n'
      mensagem += `🆕 *Novos insumos:*\n${itensAutoCriados.join('\n')}`
    }
    if (itensNaoEstocados.length > 0) {
      if (itensAtualizados.length > 0 || itensAutoCriados.length > 0) mensagem += '\n\n'
      mensagem += `📦 *Não estocados* (só financeiro):\n${itensNaoEstocados.join('\n')}`
    }

    await enviarMensagem(phone, mensagem)

  } catch (err) {
    console.error(`[NFeProcessor] Erro ao processar NF-e ${numero}:`, err instanceof Error ? err.message : err)
    if (nfeId) {
      await supabase.from('notas_fiscais').update({ status: 'erro' }).eq('id', nfeId)
    }
    throw err
  }
}
