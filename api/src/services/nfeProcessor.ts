import Anthropic from '@anthropic-ai/sdk'
import { XMLParser } from 'fast-xml-parser'
import { supabase } from './supabase'
import { enviarMensagem } from './zapi'
import { efeitoDoCfop } from './contas/cfop'
import { gravarContasDaNota } from './contas/gravarDeNota'
import { motivoSemBoletoDaNota, motivoVencidoPelaDuplicata, duplicataEhReal, type ContaDeNota, type ParcelaDescartada } from './contas/deNotaFiscal'
import { linhaBoleto } from './contas/avisoBoleto'
import { hojeSaoPauloISO, reais } from './contas/formato'

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
  cfop:         string   // código da operação, 4 dígitos. '' quando o item não traz
  // true SÓ para o item sintético que parseXmlNFSe monta. Sem isto, um item de
  // NFS-e com cfop/ncm vazios cai na MESMA cascata de uma NF-e com CFOP/NCM
  // ausente — que assume "compra normal, estocável até prova em contrário" — e
  // quem decide "prova em contrário" vira só a IA (categorizarItem), sem
  // nenhuma trava determinística por trás dela. Achado do Apolo em 17/08/2026,
  // provado rodando processarNFe de verdade: uma NFS-e virou insumo fantasma
  // e somou estoque. Serviço nunca é estocável — ponto final, não cascata.
  servico?:     boolean
  // Centro de custo escolhido pelo DONO na conferência do PDF (aba Notas →
  // "Upload PDF"). Só o caminho do PDF preenche; XML, e-mail e webhook deixam
  // undefined, e a coluna fica nula como sempre ficou.
  //
  // POR QUE existe: a tela Financeiro lê `itens_nfe.centro_custo ?? insumos.tipo
  // ?? 'outro'`. Item não-estocável (peça, frete, serviço, material de
  // construção) entra com `insumo_id` nulo — então, sem esta escolha, TODA nota
  // desse tipo cai em "Outro" e o dono tem que reclassificar item por item
  // depois, na outra tela. Pedido do Matheus na primeira importação real
  // (24/08/2026), com nota da ZAMPIERI ROCHA (material de construção).
  //
  // Texto livre de propósito, igual à coluna (migration 013 de
  // api/src/database/migrations): o dropdown mistura categoria agrícola com
  // categoria de cartão, e um CHECK aqui recriaria o bug de "não salva em
  // silêncio".
  centroCusto?: string
}

// Uma parcela do quadro de cobrança da NF-e (bloco <cobr><dup>).
// vencimento é null quando o fornecedor não preencheu — caso ERCAL, medido em 31/07/2026.
export interface NFeDuplicata {
  numero:     string
  vencimento: string | null   // 'YYYY-MM-DD'
  valor:      number | null
}

export interface NFeData {
  numero:       string
  dataEmissao:  string
  emitenteNome: string
  emitenteCnpj: string
  valorTotal:   number
  items:        NFeItem[]
  duplicatas:     NFeDuplicata[]
  formaPagamento: string | null   // tPag: '15' boleto, '03' cartão crédito, '05' crédito loja...
  // 'nfe' (produto) ou 'nfse' (serviço). Número de NF-e e de NFS-e são
  // sequências INDEPENDENTES do mesmo emitente — sem isto na chave de
  // duplicidade, a NF-e nº 500 e a NFS-e nº 500 do mesmo fornecedor colidem e
  // a segunda é descartada como "já processada". Achado do Apolo, 17/08/2026
  // (migração 011_notas_fiscais_modelo.sql). Campo OBRIGATÓRIO de propósito —
  // ninguém pode esquecer de preencher e cair no default do banco por acaso.
  modelo: 'nfe' | 'nfse'
}

// ─── Parser de XML NF-e SEFAZ ────────────────────────────────────────────────
export function parseXmlNFe(xmlStr: string): NFeData | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes:    false,
      attributeNamePrefix: '@_',
      parseTagValue:       true,
      // Sem isto, CNPJ/CPF com zero à esquerda ("04063805000135") é lido como
      // NÚMERO e perde o zero ("4063805000135") — bug antigo, achado do Apolo
      // em 17/08/2026 ao revisar o parser irmão (parseXmlNFSe). Dado fiscal
      // errado gravado, exportado pro contador (exportarXML no front) e busca
      // por CNPJ na tela não encontrando a nota. Reparo dos dados JÁ salvos
      // fica em script à parte (não é responsabilidade do parser corrigir o
      // passado, só parar de piorar o presente).
      numberParseOptions:  { leadingZeros: false, hex: false },
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
        ncm:          String(prod.NCM ?? '').replace(/\D/g, ''),
        cfop:         String(prod.CFOP ?? '').replace(/\D/g, ''),
      }
    }).filter((i: NFeItem) => i.description)

    // ─── Quadro de cobrança (os boletos) ─────────────────────────────────────
    // ARMADILHA: o leitor devolve OBJETO quando existe uma única <dup> e LISTA
    // quando existem várias — exatamente como já acontece com <det> acima.
    // As três amostras reais de 31/07/2026 têm uma parcela só, então o caminho
    // de várias parcelas não tem prova em produção. Tratar os dois casos.
    const dupRaw = inf.cobr?.dup ?? []
    const dups   = Array.isArray(dupRaw) ? dupRaw : [dupRaw]

    const duplicatas: NFeDuplicata[] = dups
      .filter((d: any) => d && typeof d === 'object')
      .map((d: any, i: number) => ({
        numero:     String(d.nDup ?? i + 1),
        // slice(0,10) porque há fornecedor que manda data com horário junto.
        vencimento: d.dVenc ? String(d.dVenc).slice(0, 10) : null,
        valor:      d.vDup != null ? parseFloat(String(d.vDup)) : null,
      }))

    // ─── Forma de pagamento ──────────────────────────────────────────────────
    // Só tPag. indPag ("à vista"/"a prazo") NÃO é confiável: nas amostras reais
    // a ERCAL marcou "à vista" e boleto ao mesmo tempo, e a Triângulo Diesel nem
    // preencheu. padStart porque o leitor transforma "05" no número 5.
    const detPagRaw = inf.pag?.detPag ?? []
    const detPags   = Array.isArray(detPagRaw) ? detPagRaw : [detPagRaw]
    const primeiroPag = detPags.find((p: any) => p && typeof p === 'object' && p.tPag != null)
    const formaPagamento = primeiroPag ? String(primeiroPag.tPag).padStart(2, '0') : null

    if (!numero || !emitenteNome || items.length === 0) return null

    return { numero, dataEmissao, emitenteNome, emitenteCnpj, valorTotal, items, duplicatas, formaPagamento, modelo: 'nfe' }
  } catch (err) {
    console.error('[NFeProcessor] Erro ao parsear XML:', err instanceof Error ? err.message : err)
    return null
  }
}

// Lê um campo monetário/numérico com segurança: `??` sozinho NÃO pega tag
// presente e vazia ("<vLiq></vLiq>" vira string '', não null/undefined), e
// `parseFloat('')` é NaN — que passaria direto por um `valorTotal <= 0` sem
// nunca ser pego (NaN não é <= 0 nem > 0). Achado do Apolo em 17/08/2026,
// provado: fornecedor que manda a tag vazia geraria conta sem valor E sem
// vencimento, uma cobrança invisível. Devolve null (não 0) para quem chama
// poder tentar o próximo campo de fallback em vez de aceitar um zero falso.
function paraNumeroOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

// ─── Parser de XML NFS-e (nota de serviço, padrão NACIONAL) ──────────────────
// Estrutura bem diferente da NF-e: raiz <NFSe>, sem <det>/CFOP/NCM (não há
// mercadoria circulando) e sem <cobr><dup> (nota de serviço não carrega
// vencimento de boleto — a única exceção do padrão nacional é aluguel de
// imóvel, campo dVencOrig, fora do escopo daqui). Devolve o MESMO formato
// NFeData que parseXmlNFe, com um item sintético só (o serviço inteiro) —
// assim processarNFe() não precisa saber a diferença entre as duas.
//
// ESCOPO: só o layout NACIONAL (raiz NFSe/infNFSe). Município que ainda emite
// no layout antigo ABRASF (CompNfse/Nfse/InfNfse) continua sendo recusado —
// não é bug, é fronteira não coberta ainda. Amostra até 17/08/2026: 1 nota
// (SITRACK). Não sabemos que layout os outros prestadores do Matheus usam.
export function parseXmlNFSe(xmlStr: string): NFeData | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes:    false,
      attributeNamePrefix: '@_',
      parseTagValue:       true,
      // Sem isto, o parser lê CNPJ/CPF com zero à esquerda ("04063805000135")
      // como NÚMERO e engole o zero ("4063805000135") — medido em 17/08/2026
      // com a nota real da SITRACK. O CNPJ mutilado não quebra a trava de
      // duplicata sozinho (grava e lê o mesmo valor errado, consistente) —
      // dói em três lugares mais sutis: CNPJ fiscal errado exportado pro
      // contador, busca por CNPJ na tela não encontra a nota, e se o MESMO
      // fornecedor também mandar NF-e (parser antigo, sem este ajuste), o
      // CNPJ dele fica gravado de duas formas diferentes no banco.
      numberParseOptions:  { leadingZeros: false, hex: false },
    })
    const doc = parser.parse(xmlStr)

    const inf = doc?.NFSe?.infNFSe
    if (!inf) return null

    const dps     = inf.DPS?.infDPS ?? {}
    const emit    = inf.emit ?? {}
    const valores = inf.valores ?? {}

    const numero       = String(inf.nNFSe ?? '')
    const dataEmissao  = String(dps.dhEmi ?? inf.dhProc ?? '')
    const emitenteNome = String(emit.xNome ?? '')
    const emitenteCnpj = String(emit.CNPJ ?? emit.CPF ?? '')
    // vLiq (valores do bloco infNFSe) é o valor líquido já com ISS retido
    // descontado quando houver; vServ (dentro do DPS) é o valor bruto do
    // serviço declarado pelo prestador — fallback se vLiq faltar OU vier
    // vazio. LIMITE CONHECIDO: quando existe retenção de ISS de verdade
    // (tomador substituto tributário), vLiq é o que se PAGA ao prestador,
    // não o custo total do serviço — usar vLiq como gasto subdimensiona em
    // silêncio nesse caso. Não é o caso da SITRACK (ISS embutido no preço,
    // tomador é CPF) nem foi implementado tratamento — registrar para quando
    // aparecer o primeiro prestador que retém.
    const valorTotal = paraNumeroOuNull(valores.vLiq) ?? paraNumeroOuNull(dps.valores?.vServPrest?.vServ) ?? 0

    if (!numero || !emitenteNome || !Number.isFinite(valorTotal) || valorTotal <= 0) return null

    // O `|| 'Serviço'` fica DEPOIS do trim, não dentro do `??` — descrição só
    // com espaços (" ") passa no `??` (não é null/undefined) e viraria uma
    // string vazia depois do trim. Item sem nome que caísse no caminho
    // estocável (não deveria mais, com o `servico: true` abaixo, mas é
    // defesa em profundidade) casaria com QUALQUER insumo existente — o
    // `.ilike('nome', '%%')` de vincularOuCriarInsumo casa com tudo. Achado
    // do Apolo em 17/08/2026.
    const descricao = (String(dps.serv?.cServ?.xDescServ ?? '').trim() || 'Serviço').slice(0, 500)

    // Item único representando o serviço inteiro: quantidade 1, valor
    // unitário = valor total. cfop e ncm ficam vazios de propósito — não
    // existe para serviço, e fronteiraPorNCM()/efeitoDoCfop() já tratam
    // ausência como "cascata para o Haiku" / "compra normal" respectivamente.
    const item: NFeItem = {
      description:  descricao,
      quantity:     1,
      unit:         'un',
      unitValue:    valorTotal,
      totalValue:   valorTotal,
      quantityTrib: 1,
      unitTrib:     'un',
      ncm:          '',
      cfop:         '',
      servico:      true,
    }

    return {
      numero, dataEmissao, emitenteNome, emitenteCnpj, valorTotal,
      items: [item], duplicatas: [], formaPagamento: null, modelo: 'nfse',
    }
  } catch (err) {
    console.error('[NFeProcessor] Erro ao parsear XML NFS-e:', err instanceof Error ? err.message : err)
    return null
  }
}

// Tenta os dois formatos conhecidos de nota fiscal: NF-e (produto, raiz <NFe>)
// primeiro, NFS-e (serviço, raiz <NFSe>) como segundo palpite. As duas raízes
// nunca coexistem no mesmo arquivo — a ordem não troca nota nenhuma, só evita
// repetir esta tentativa em cada lugar que lê nota fiscal (upload manual,
// e-mail via Make, e-mail via IMAP direto).
export function parseXmlNota(xmlStr: string): NFeData | null {
  return parseXmlNFe(xmlStr) ?? parseXmlNFSe(xmlStr)
}

// ─── Verificar duplicata ──────────────────────────────────────────────────────
// A chave inclui o CNPJ do emitente porque o número da NF-e é sequencial POR
// FORNECEDOR — não é único no mundo. Sem o CNPJ, a nota 4516 de um fornecedor
// faz o sistema descartar em silêncio a nota 4516 de outro: some a compra,
// some o gasto e, na Fase 2, some o boleto.
//
// `modelo` entrou na chave em 17/08/2026 (migração 011): número de NF-e e de
// NFS-e são sequências INDEPENDENTES do mesmo emitente — sem isto, a NF-e
// nº 500 e a NFS-e nº 500 do mesmo fornecedor colidiam e a segunda a chegar
// era descartada como "já processada". Achado do Apolo.
export async function nfeJaProcessada(
  numero: string,
  emitenteCnpj: string,
  fazenda_id: string,
  modelo: 'nfe' | 'nfse',
): Promise<boolean> {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('id')
    .eq('numero', numero)
    .eq('emitente_cnpj', emitenteCnpj)
    .eq('fazenda_id', fazenda_id)
    .eq('modelo', modelo)
    .limit(1)
    .maybeSingle()

  // Falha de banco NÃO pode virar "não é duplicata" — senão a nota é gravada
  // de novo, e o estoque e o gasto são contados em dobro, em silêncio.
  // Mesmo padrão de `jobs/contas.ts`: erro de consulta é relançado, nunca engolido.
  if (error) throw error

  return !!data
}

// O id da nota SOMENTE quando ela lançou gasto no Financeiro. Devolve null
// quando a nota não existe OU quando existe mas não lançou nada.
//
// As duas condições são igualmente importantes, e a segunda custou duas rodadas
// de revisão para aparecer (Apolo, 14/08/2026). O boleto lido de PDF usa isto
// para decidir se amarra numa nota, e amarrar decide quem lança o gasto quando
// ele for pago (`precisaCriarLancamento` em contas/pagamento.ts):
//
//   nota lançou gasto  → amarra   → pagar NÃO lança de novo  → certo
//   nota não lançou    → não amarra → pagar lança             → certo
//   nota não lançou    → amarrasse → pagar não lança          → GASTO SOME
//
// A terceira linha é o caso ERCAL, e é real: nota de remessa (CFOP 5116/5117)
// gera boleto cheio e `valorCompra` zero, então `processarNFe` não cria
// lançamento nenhum (ver a escada do valorCompra mais abaixo neste arquivo).
// Amarrar ali faria R$ 8 mil sair do banco sem aparecer como despesa em lugar
// nenhum — pior que a duplicidade que a amarração existe para evitar, porque
// dinheiro dobrado o dono enxerga na tela e dinheiro sumido não.
//
// Erro de consulta é relançado, nunca engolido: um null por falha de banco
// significaria "não há nota" e mandaria o boleto para o caminho errado.
export async function idDaNotaQueLancouGasto(
  numero: string,
  emitenteCnpj: string,
  fazenda_id: string,
  modelo: 'nfe' | 'nfse',
): Promise<string | null> {
  const { data: nota, error } = await supabase
    .from('notas_fiscais')
    .select('id')
    .eq('numero', numero)
    .eq('emitente_cnpj', emitenteCnpj)
    .eq('fazenda_id', fazenda_id)
    .eq('modelo', modelo)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!nota) return null

  const { data: lancamento, error: erroLanc } = await supabase
    .from('lancamentos_financeiros')
    .select('id')
    .eq('nota_fiscal_id', nota.id)
    .limit(1)
    .maybeSingle()

  if (erroLanc) throw erroLanc

  return lancamento ? nota.id : null
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

// Junta uma lista de motivos em português corrido, para a mensagem do WhatsApp:
// "a", "a e b", "a, b e c". Usado com os `rotulo` de efeitoDoCfop — nunca
// mexe no objeto EfeitoItem em si (ele vem congelado, ver contas/cfop.ts).
function listaEmPortugues(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? ''
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

// Achado CRÍTICO da revisão final (03/08/2026): o boleto (`contas`, decidido
// pelos campos de pagamento da nota) e o gasto (`valorCompra`, decidido pelo
// CFOP de cada item) são calculados por regras INDEPENDENTES — de propósito,
// porque perder um boleto de verdade é o erro mais caro que existe (ver
// contas/cfop.ts). Isso abre uma brecha: uma nota de remessa pode gerar um
// boleto cheio enquanto lança pouco ou nenhum gasto. Caso medido: ERCAL nota
// 82398 — CFOP 5116, tPag 15, zero duplicata → boleto de R$ 8.258,40, gasto
// R$ 0,00.
//
// O problema não para no WhatsApp: `precisaCriarLancamento` (contas/pagamento.ts)
// assume que toda conta vinda de NF-e JÁ tem lançamento — então quando o dono
// marcar esse boleto como pago, nenhum lançamento é criado e aquele dinheiro
// nunca aparece como despesa em lugar nenhum (ver comentário no topo daquele
// arquivo). Esta função não conserta essa lacuna — ela só garante que o dono
// SAIBA, na hora, que a nota vai cobrar mais do que lançou como gasto, para
// que ele possa ir atrás da nota de faturamento que provavelmente já contou
// esse valor.
function linhaCobrancaMaiorQueGasto(contas: ContaDeNota[], valorCompra: number): string {
  const totalBoletos = contas.reduce((soma, c) => soma + (c.valor ?? 0), 0)
  const diferenca     = totalBoletos - valorCompra

  // Tolerância de 1 centavo: arredondamento de ponto flutuante não pode disparar
  // um aviso sobre uma diferença que não existe de verdade.
  if (diferenca <= 0.01) return ''

  const descricaoBoleto = contas.length > 1
    ? `boletos somando ${reais(totalBoletos)}`
    : `um boleto de ${reais(totalBoletos)}`

  if (valorCompra <= 0) {
    return `\n\n⚠️ *Atenção:* esta nota vai gerar ${descricaoBoleto}, mas esse valor não entrou como gasto porque já foi cobrado em outra nota. Se você não achar essa outra nota, me avise.`
  }

  return `\n\n⚠️ *Atenção:* esta nota vai gerar ${descricaoBoleto}, mas só ${reais(valorCompra)} entrou como gasto — ${reais(diferenca)} pode já ter sido cobrado em outra nota. Se você não achar essa outra nota, me avise.`
}

// ─── Processador principal ────────────────────────────────────────────────────
// `arquivo` só chega pelo caminho do PDF (services/nfe/gravarNotaDoPdf.ts).
// Entra no MESMO insert da nota, e não num update depois, porque o índice
// único idx_nfe_arquivo_hash (migration 013) só protege se o hash estiver no
// banco ANTES de o estoque mexer — senão a trava dispara com a mercadoria já
// somada, e desfazer isso vira rollback manual.
//
// O retorno virou o id da nota (era void até 24/08/2026): quem grava pelo PDF
// precisa dele para não reconsultar a nota que acabou de criar — e uma segunda
// consulta por (numero, cnpj, fazenda, modelo) pode achar a nota do OUTRO
// caminho de entrada numa corrida (ver "nfe-corrida-duas-portas").
export async function processarNFe(
  nfe: NFeData,
  origem: 'webhook' | 'email' | 'manual' = 'webhook',
  fazenda_id: string,
  arquivo?: { pdfPath: string; hash: string },
): Promise<string> {
  const { numero, dataEmissao, emitenteNome, emitenteCnpj, valorTotal, items, duplicatas, formaPagamento, modelo } = nfe

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
        forma_pagamento: formaPagamento,
        modelo,
        arquivo_pdf:  arquivo?.pdfPath ?? null,
        arquivo_hash: arquivo?.hash    ?? null,
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
    // Um `contaComoCompraDoItem(index)` por item de `itensNaoEstocados`, na mesma
    // ordem — usado só para decidir a legenda "(só financeiro)" da mensagem do
    // WhatsApp (seção 4, abaixo). Família 'remessa sem compra' (ex.: CFOP 5912)
    // não estoca E não conta como gasto — rotular esses itens de "só financeiro"
    // seria mentira (achado da revisão final).
    const itensNaoEstocadosContam: boolean[] = []

    // Quais itens contam como gasto na tela Financeiro. Segue a MESMA escada do
    // valorCompra lá embaixo — se divergir, a tela e o Dashboard mostram totais
    // diferentes para a mesma nota.
    //
    // Quando ALGUM item é compra, vale a regra de cada item. Quando NENHUM é (nota
    // de entrega pura), a nota inteira só conta se houver duplicata de verdade —
    // é a revenda que embute a cobrança na própria remessa.
    //
    // duplicatas.some(duplicataEhReal), NUNCA duplicatas.length > 0: achado da 4ª
    // revisão do Apolo (06/08/2026), provado com a nota real da SYAGRI (CFOP 5117,
    // tPag '90', duplicata só com número de controle — sem vencimento nem valor,
    // valorTotal R$ 1.060.000). Com `.length > 0`, essa duplicata vazia contava
    // como prova de cobrança real e `temCobrancaReal` virava `true`, gerando um
    // lançamento de R$ 1.060.000 em `lancamentos_financeiros` para uma nota que não
    // cobra nada — o mesmo gasto fantasma que motivou o conserto do lado do boleto
    // (ver duplicataEhReal em contas/deNotaFiscal.ts e o comentário perto da
    // linha ~606 abaixo, onde a mesma troca já tinha sido feita para a mensagem do
    // WhatsApp).
    const efeitosDosItens = itensSeguros.map(i => efeitoDoCfop(i.cfop))
    const todosSaoCompra  = efeitosDosItens.every(e => e.contaComoCompra)
    const algumECompra    = efeitosDosItens.some(e => e.contaComoCompra)
    const temCobrancaReal = duplicatas.some(duplicataEhReal)
    const contaComoCompraDoItem = (n: number): boolean =>
      algumECompra ? efeitosDosItens[n].contaComoCompra : temCobrancaReal

    for (const [index, item] of itensSeguros.entries()) {
      // item.servico vence a cascata inteira, sem perguntar pro Haiku: serviço
      // (NFS-e) nunca é estocável, e essa certeza vem do PARSER (soube que leu
      // <NFSe>, não <NFe>), não de uma classificação por texto que pode errar.
      // Cascata normal (NF-e): NCM decide a fronteira; o Haiku só desempata
      // quando o NCM é mudo.
      const vereditoNCM = fronteiraPorNCM(item.ncm)
      const tipo        = item.servico ? 'servico' : await categorizarItem(item.description)  // ainda alimenta insumos.tipo
      const estocavel   = item.servico ? false : (vereditoNCM !== null ? vereditoNCM : TIPOS_ESTOCAVEIS.has(tipo))

      // O CFOP manda: ele diz se houve circulação física de mercadoria e se a
      // nota é a compra ou só a entrega de algo já faturado. Ver contas/cfop.ts.
      const efeito = efeitosDosItens[index]

      // Não entra no estoque quando o NCM/tipo diz que não é estocável OU quando o
      // CFOP diz que não houve compra de mercadoria para o galpão (ex.: faturamento
      // de entrega futura — a mercadoria ainda não saiu do fornecedor).
      if (!estocavel || !efeito.entraNoEstoque) {
        await supabase.from('itens_nfe').insert({
          nota_fiscal_id:     nfeId,
          descricao:          item.description.slice(0, 500),
          quantidade:         item.quantity,
          unidade:            item.unit,
          valor_unitario:     item.unitValue,
          valor_total:        item.totalValue,
          insumo_id:          null,
          cfop:               item.cfop || null,
          conta_como_compra:  contaComoCompraDoItem(index),
          // Só o caminho do PDF manda; XML/e-mail/webhook gravam null como sempre.
          centro_custo:       item.centroCusto ?? null,
          fazenda_id,
        })
        itensNaoEstocados.push(`• ${item.quantity}${item.unit} ${item.description.trim().slice(0, 60)}`)
        itensNaoEstocadosContam.push(contaComoCompraDoItem(index))
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
        nota_fiscal_id:     nfeId,
        descricao:          item.description.slice(0, 500),
        quantidade:         item.quantity,
        unidade:            item.unit,
        valor_unitario:     item.unitValue,
        valor_total:        item.totalValue,
        insumo_id:          insumo.id,
        cfop:               item.cfop || null,
        conta_como_compra:  contaComoCompraDoItem(index),
        centro_custo:       item.centroCusto ?? null,
        fazenda_id,
      })

      // custoZero (bonificação, amostra grátis): o produto entra no galpão, mas
      // sem custo — gravar o preço médio estragaria o custo do insumo com um
      // valor que ninguém pagou (STJ, Súmula 457).
      if (precoUnitario > 0 && !efeito.custoZero) {
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

    // Rótulos (em português já pronto) dos itens que a regra NÃO considerou compra.
    // Calculado uma vez só e reaproveitado em três lugares: o log de "sem valor de
    // compra" (seção 3), a linha "Não entrou como gasto" e a frase da nota de
    // faturamento (seção 4, abaixo) — antes eram duas contas iguais escritas em
    // separado (achado da revisão final), risco de divergir se alguém mexer numa
    // e esquecer a outra. Nunca mexe no objeto congelado que efeitoDoCfop()
    // devolve, só lê o campo `rotulo`.
    const rotulosNaoCompra = [...new Set(
      efeitosDosItens.filter(e => !e.contaComoCompra).map(e => e.rotulo),
    )]

    // 3. Lançamento financeiro — só o que é compra de verdade.
    //
    // O CFOP de cada item manda no gasto. Ver contas/cfop.ts.
    //
    // Nota normal (tudo é compra) usa o valor total da nota, NÃO a soma dos itens:
    // o total traz frete, seguro e impostos que não aparecem em nenhum item. Trocar
    // por soma de itens faria o gasto sair menor que o real, em silêncio.
    //
    // Nota misturada (parte compra, parte bonificação) soma só os itens de compra.
    //
    // A EXCEÇÃO que salva boleto: se nenhum item conta como compra MAS a nota traz
    // quadro de duplicatas, ela está cobrando de verdade — existe revenda que pula
    // o passo do faturamento e embute a cobrança na própria remessa. Só a duplicata
    // prova isso: o tPag da nota de remessa é herdado da venda e não prova nada
    // (ERCAL 82398: CFOP 5116 de entrega, com tPag 15 e zero duplicata).
    //
    // efeitosDosItens / todosSaoCompra / algumECompra / temCobrancaReal já foram
    // calculados ANTES do loop (seção 2) — contaComoCompraDoItem() precisa deles
    // por item, dentro do loop. Aqui só reaproveita, sem recalcular nada.
    const valorCompra =
        todosSaoCompra  ? valorTotal
      : algumECompra    ? itensSeguros
                            .filter((_, n) => efeitosDosItens[n].contaComoCompra)
                            .reduce((soma, i) => soma + (i.totalValue || 0), 0)
      : temCobrancaReal ? valorTotal
      :                   0

    // Nota sem itens: `every` numa lista vazia é `true`, então cai em
    // `todosSaoCompra` e usa valorTotal — é o comportamento de sempre, mantido
    // de propósito (nunca houve item para decidir o contrário).
    if (valorCompra > 0) {
      await supabase.from('lancamentos_financeiros').insert({
        data:           dataFormatada,
        descricao:      `NF-e ${numero} — ${emitenteNome}`,
        valor:          valorCompra,
        tipo:           'despesa',
        categoria:      'insumos',
        nota_fiscal_id: nfeId,
        fazenda_id,
      })
    } else {
      // Mesmo filtro da linha do WhatsApp (`rotulosNaoCompra` acima): só os
      // rótulos de quem NÃO é compra. Usar todos os itens aqui já produziu log
      // contraditório — "sem valor de compra (compra, bonificação...)" — numa
      // nota mista cujos itens de compra somaram zero.
      //
      // Quando `rotulosNaoCompra` vem vazio (nota 100% compra, mas com valor
      // total zero — ex.: nota de amostra sem preço nenhum), NÃO monta o
      // parêntese: "sem valor de compra () — ..." é log quebrado e engana quem lê
      // achando que há um motivo que não existe (achado da revisão final).
      const motivos = rotulosNaoCompra.length > 0 ? ` (${rotulosNaoCompra.join(', ')})` : ''
      console.log(`[NFeProcessor] NF-e ${numero}: sem valor de compra${motivos} — nenhum lançamento criado.`)
    }

    await supabase.from('notas_fiscais').update({ status: 'processada' }).eq('id', nfeId)

    // 4. Boletos da nota (Fase 2) — PARAFUSADO POR FORA, NUNCA PRÉ-REQUISITO.
    //
    // Este try/catch protege contra ERRO LANÇADO na criação de boletos (arquivo
    // estranho, upsert rejeitado, parcela em formato novo) — a nota TEM que
    // continuar entrando mesmo assim. Um boleto perdido custa um aviso; uma nota
    // perdida custa estoque e financeiro errados por semanas.
    //
    // O QUE ELE NÃO PROTEGE: demora. O cliente do Supabase não tem timeout
    // configurado (o fetch do Node só desiste sozinho depois de ~300s), então se
    // o banco aceitar a conexão e simplesmente não responder, este bloco fica
    // parado do mesmo jeito — try/catch não pega travamento, só exceção. É por
    // isso que ele roda AQUI, DEPOIS de marcar a nota como 'processada' e antes
    // da mensagem: se travar, a nota já está processada e o estoque/financeiro já
    // foram gravados — só o boleto e o aviso do WhatsApp ficam pendentes, nunca a
    // nota inteira presa em 'processando' para sempre.
    let contasCriadas: ContaDeNota[] = []
    let parcelasPerdidas: ParcelaDescartada[] = []
    let erroContas = false
    try {
      // nfeId já foi atribuído logo após o insert, no início da função. A guarda
      // é só para o compilador: `notaFiscal.id` vem de um cliente Supabase sem
      // tipos de banco, então TypeScript enxerga `nfeId` como `string | null`
      // mesmo depois da atribuição — e gravarContasDaNota exige `string`.
      if (!nfeId) throw new Error('id da nota indisponível para gravar boletos')
      const resultado = await gravarContasDaNota(
        {
          numero, emitenteNome, dataEmissao, valorTotal, formaPagamento, duplicatas, modelo,
          // itensSeguros (cortado em 200, calculado na seção 1) — não `items` cru:
          // a descrição da conta não pode falar de itens que nem entraram no
          // processamento de estoque/financeiro logo acima.
          items: itensSeguros.map(i => ({ descricao: i.description })),
        },
        nfeId,
        fazenda_id,
      )
      contasCriadas    = resultado.contas
      parcelasPerdidas = resultado.descartadas
    } catch (err) {
      erroContas = true
      console.error(
        `[NFeProcessor] NF-e ${numero}: falha ao criar boletos (a nota foi processada assim mesmo):`,
        err instanceof Error ? err.message : err,
      )
    }

    const icone = origem === 'email' ? '📧' : origem === 'manual' ? '💻' : '📄'
    // reais() — a mesma função usada na linha do boleto duas seções abaixo, na
    // MESMA mensagem. Antes este cabeçalho escrevia `R$ ${valorTotal.toFixed(2)}`
    // à mão ("R$ 1000.00", sem separador de milhar nem vírgula brasileira) e o
    // boleto usava reais() ("R$ 1.000,00") — duas grafias do mesmo valor na
    // mesma mensagem de WhatsApp.
    let mensagem = `${icone} *NF-e processada*\n👤 ${emitenteNome}\n💰 ${reais(valorTotal)}\n\n`

    if (itensAtualizados.length > 0)
      mensagem += `✅ *Estoque atualizado:*\n${itensAtualizados.join('\n')}`
    if (itensAutoCriados.length > 0) {
      if (itensAtualizados.length > 0) mensagem += '\n\n'
      mensagem += `🆕 *Novos insumos:*\n${itensAutoCriados.join('\n')}`
    }
    if (itensNaoEstocados.length > 0) {
      if (itensAtualizados.length > 0 || itensAutoCriados.length > 0) mensagem += '\n\n'
      // "(só financeiro)" só é verdade quando TODOS estes itens de fato contam
      // como gasto — para a família 'remessa sem compra' (ex.: CFOP 5912) o item
      // não estoca E não conta como gasto, então dizer "só financeiro" seria
      // mentira (achado da revisão final). Nota mista (parte conta, parte não)
      // usa uma legenda neutra em vez de escolher um dos dois lados errado.
      const todosContam  = itensNaoEstocadosContam.every(c => c)
      const algumContam  = itensNaoEstocadosContam.some(c => c)
      const legenda = todosContam ? ' (só financeiro)'
        : algumContam ? ' (só parte é financeiro)'
        : ' (nem estoque, nem financeiro)'
      mensagem += `📦 *Não estocados*${legenda}:\n${itensNaoEstocados.join('\n')}`
    }

    // O cabeçalho já mostrou o valor de FACE da nota (reais(valorTotal)). Sem esta
    // linha, o dono vê um número grande e acha que gastou aquilo — quando o CFOP
    // (código que diz o tipo da operação, explicado em contas/cfop.ts) apontou que
    // não é bem assim. `rotulosNaoCompra` (calculado logo no início da seção 3,
    // acima) vem dos `rotulo` (texto em português já pronto) dos itens que a
    // regra não considerou compra — nunca mexe no objeto congelado que
    // efeitoDoCfop() devolve, só lê o campo. Usado nos dois ramos abaixo
    // (valorCompra === 0 e valorCompra parcial).
    const motivosNaoCompra = listaEmPortugues(rotulosNaoCompra)

    // A frase "o custo já foi lançado na nota de faturamento" só é verdade quando
    // existe de fato uma nota de faturamento em algum lugar — ou seja, quando o
    // motivo é 'entrega de pedido já faturado' (CFOP 5116/5117). Para bonificação,
    // amostra grátis, remessa sem compra ou consignação NÃO existe nota de
    // faturamento nenhuma — mandar o dono "avisar se ela não chegou" o colocaria
    // atrás de um documento que nunca vai existir.
    const temNotaDeFaturamento = rotulosNaoCompra.includes('entrega de pedido já faturado')
    const fraseFaturamento = temNotaDeFaturamento
      ? ' O custo já foi lançado na nota de faturamento. Se essa nota de faturamento nunca chegou, me avise.'
      : ''

    if (valorCompra === 0) {
      // Nota 100% compra (todosSaoCompra) mas com valorTotal zero (ex.: amostra
      // sem preço algum) cai aqui com `rotulosNaoCompra` vazio — não existe
      // motivo nenhum porque nenhum item foi excluído pela regra, só o valor
      // deu zero. Sem esta guarda a frase saía quebrada: "— motivo: ." (achado
      // da revisão final).
      const motivo = motivosNaoCompra ? ` — motivo: ${motivosNaoCompra}.` : '.'
      mensagem += `\n\n💰 *Esta nota não entrou como gasto*${motivo}${fraseFaturamento}`
    } else if (valorCompra < valorTotal) {
      mensagem += `\n\n💰 *Só parte da nota virou gasto:* ${reais(valorCompra)} contou como despesa, ${reais(valorTotal - valorCompra)} não contou (motivo: ${motivosNaoCompra}).`
    }

    // hojeSaoPauloISO(), NUNCA dataFormatada (data de EMISSÃO da nota): o "em N
    // dias"/"venceu há N dias" da mensagem compara o vencimento contra HOJE, não
    // contra uma data congelada no passado. Bug medido em 31/07/2026 — ver
    // conserto 1 da revisão final da Fase 2 (nota processada em atraso mostrava
    // "vence em 1 dia" para um boleto que já tinha vencido há 2).
    //
    // duplicatas.some(duplicataEhReal), NUNCA duplicatas.length > 0: achado da 2ª
    // revisão do Apolo (06/08/2026) — com `.length > 0`, uma nota tPag '90' com
    // duplicata completamente vazia fazia este trecho concordar com o motivo
    // "sem boleto" ERRADO (achava que a duplicata vazia cedia o código '90'), então
    // `motivoSemBoletoDaNota` devolvia null igual a uma nota com boleto real — e
    // como contasCriadas já vinha vazio (contasDaNota, corrigido, corretamente não
    // gera nada), linhaBoleto() caía no ramo "contas.length === 0" com motivo nulo
    // e a mensagem do WhatsApp saía MUDA sobre boleto, quebrando a promessa de
    // avisoBoleto.ts de que "o sistema SEMPRE diz o que concluiu".
    //
    // O 6º argumento é o inverso do 2º: quando a duplicata VENCE um código que dizia
    // "sem cobrança" (mudança de 14/08/2026, ver deNotaFiscal.ts), o boleto é criado
    // e a mensagem pede conferência em vez de calar. `temDuplicata` é calculado uma
    // vez e passado para as duas funções de propósito — se cada uma recalculasse por
    // conta própria, uma futura divergência entre elas faria a mensagem afirmar duas
    // coisas opostas sobre a mesma nota.
    const temDuplicataReal = duplicatas.some(duplicataEhReal)

    mensagem += linhaBoleto(
      contasCriadas,
      motivoSemBoletoDaNota(formaPagamento, temDuplicataReal),
      hojeSaoPauloISO(),
      erroContas,
      parcelasPerdidas,
      motivoVencidoPelaDuplicata(formaPagamento, temDuplicataReal),
      modelo,
    )

    // Finding 1b (revisão final) — avisa quando o boleto que ACABOU de ser criado
    // vale mais do que a nota lançou como gasto. Ver comentário de
    // linhaCobrancaMaiorQueGasto() acima e contas/pagamento.ts:1-10 para a lacuna
    // que este aviso existe para compensar (precisaCriarLancamento não cria
    // lançamento nenhum quando o dono pagar este boleto). Usa `contasCriadas`
    // (o que REALMENTE foi gravado), não `duplicatas` cru — se o bloco de
    // boletos acima falhar (erroContas), `contasCriadas` fica vazio e este
    // aviso não dispara por engano sobre um boleto que nem foi criado.
    mensagem += linhaCobrancaMaiorQueGasto(contasCriadas, valorCompra)

    // ACHADO 1 (segunda revisão do Apolo, 05/08/2026): este envio ficava FORA
    // de qualquer try/catch próprio — se o Z-API caísse na rede ou estourasse
    // o timeout de 15s (zapi.ts rejeita a promessa nesses dois casos), o erro
    // subia até o catch de baixo, que marca a nota inteira como 'erro' e
    // relança. Depois que o upload manual passou a limpar a nota quando
    // processarNFe falha (para não envenenar o caminho automático), isso virou
    // grave: uma importação 100% certa — estoque, gasto e boleto já gravados —
    // era APAGADA inteira só porque o aviso do WhatsApp não saiu. Mesmo
    // princípio do bloco de boletos logo acima: um aviso perdido custa um
    // aviso; a nota já está processada e não pode ser derrubada por causa dele.
    try {
      await enviarMensagem(phone, mensagem)
    } catch (errZapi) {
      console.error(
        `[NFeProcessor] NF-e ${numero}: nota processada, mas o aviso do WhatsApp falhou:`,
        errZapi instanceof Error ? errZapi.message : errZapi,
      )
    }

    // A guarda é só para o compilador, mesmo motivo do `if (!nfeId)` do bloco
    // de boletos acima: `notaFiscal.id` vem de um cliente Supabase sem tipos de
    // banco, então TypeScript enxerga `nfeId` como `string | null` mesmo depois
    // da atribuição feita logo após o insert.
    if (!nfeId) throw new Error('id da nota indisponível após o insert')
    return nfeId

  } catch (err) {
    console.error(`[NFeProcessor] Erro ao processar NF-e ${numero}:`, err instanceof Error ? err.message : err)
    if (nfeId) {
      await supabase.from('notas_fiscais').update({ status: 'erro' }).eq('id', nfeId)
    }
    throw err
  }
}
