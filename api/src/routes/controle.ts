import { Router } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../services/supabase'
import { gravarDocumentoDoPdf } from '../services/controle/gravarDocumentoPdf'
import { hojeSaoPauloISO } from '../services/contas/formato'

export const controleRoutes = Router()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Bucket privado (Storage do Supabase) onde os PDFs importados ficam — ver
// cabeçalho da migration 017_controle.sql. Mesmo nome usado em gravarDocumentoPdf.ts.
const BUCKET = 'controle-documentos'

// Mesmo padrão de nfe.ts/cartoes.ts: a fazenda vem SEMPRE do usuário
// autenticado (token JWT validado por requireAuth), nunca do corpo do
// pedido. A API usa a chave de serviço do Supabase, que desliga o RLS — sem
// esta checagem, um fazenda_id enviado no corpo gravaria/leria documento da
// fazenda errada.
function fazendaDe(req: any): string | undefined {
  return req.user?.app_metadata?.fazenda_ativa_id as string | undefined
}

// Espelha EXATAMENTE a coluna gerada `documentos_controle.fornecedor_normalizado`
// da migration 017: `upper(btrim(regexp_replace(fornecedor, '\s+', ' ', 'g')))`.
// Precisa ser a mesma conta dos dois lados — o filtro compara o valor que chega
// da tela contra o que o Postgres calculou e gravou. Se as duas contas
// divergirem (ex.: só `toUpperCase().trim()`, sem colapsar espaço duplo), o
// filtro de "SOLOS  SOLUÇÕES" não acha nada e a tela fica vazia sem explicação.
function normalizarFornecedor(valor: string): string {
  return valor.replace(/\s+/g, ' ').trim().toUpperCase()
}

const uploadSchema = z.object({
  arquivo:     z.string().min(1),
  nomeArquivo: z.string().min(1),
})

const listarSchema = z.object({
  pagina:     z.coerce.number().int().min(1).default(1),
  porPagina:  z.coerce.number().int().min(1).max(100).default(20),
  fornecedor: z.union([z.string(), z.array(z.string())]).optional()
    .transform(v => v === undefined ? [] : Array.isArray(v) ? v : [v]),
  status:     z.union([z.string(), z.array(z.string())]).optional()
    .transform(v => v === undefined ? [] : Array.isArray(v) ? v : [v]),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// POST /controle/documentos — upload do PDF (extrato de fornecedor ou
// contrato de compra). Lê com IA, grava documento + itens, devolve o status
// da gravação. 'duplicada-hash' e 'duplicada-conteudo' voltam como 200
// (mesmo padrão de nfe.ts: reenviar o mesmo arquivo/conteúdo é uma resposta
// válida do pedido, não erro de requisição). Três motivos de recusa sobre o
// CONTEÚDO do PDF (nao-documento, sem-itens-aproveitaveis, sem-identidade)
// viram 422 — conclusão real, o arquivo em si não deu pra aproveitar. 'falha'
// é diferente: é problema de INFRA da chamada à IA (rede, sobrecarga, chave
// inválida — ver comentário de `gravarDocumentoPdf.ts`), não do PDF; por isso
// vira 503, não 422 — sinaliza "tente de novo", não "seu arquivo é inválido".
// Todos os quatro (achado 1 da revisão do Apolo) mandam `error` em português
// no corpo: sem esse campo o front (web/lib/api.ts) cai no fallback genérico
// "API error: {status}" e a razão real da recusa nunca chega na tela. Só
// falha real de banco/Storage vira 500.
controleRoutes.post('/', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = uploadSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const pdf = Buffer.from(parsed.data.arquivo, 'base64')
    const hojeISO = hojeSaoPauloISO()
    const resultado = await gravarDocumentoDoPdf(pdf, parsed.data.nomeArquivo, hojeISO, fazendaId, anthropic)

    switch (resultado.status) {
      case 'gravado':
        res.status(201).json(resultado)
        return
      case 'duplicada-hash':
      case 'duplicada-conteudo':
        res.status(200).json(resultado)
        return
      case 'nao-documento':
        res.status(422).json({ error: 'O arquivo enviado não parece ser um documento de fornecedor (extrato ou contrato).', ...resultado })
        return
      case 'sem-itens-aproveitaveis':
        res.status(422).json({ error: 'Nenhum item aproveitável foi encontrado neste documento.', ...resultado })
        return
      case 'sem-identidade':
        res.status(422).json({ error: 'Não foi possível identificar o fornecedor ou o número do documento.', ...resultado })
        return
      case 'falha':
        res.status(503).json({ error: 'O leitor de documentos está indisponível agora. Tente de novo em alguns minutos.', ...resultado })
        return
      case 'erro':
        res.status(500).json({ error: 'Erro ao processar o documento.', detalhe: resultado.mensagem })
        return
    }
  } catch (err) {
    next(err)
  }
})

// GET /controle/documentos/filtros — valores disponíveis pra popular os menus de
// filtro por coluna da tela (Epic 2.4). `fornecedores` vem de TODOS os documentos
// da fazenda, não só da página carregada — um filtro que só oferece os fornecedores
// da primeira página seria enganoso. `status` é fixo (mesmo enum do CHECK da
// migration 017), não precisa consultar o banco.
//
// Lê `fornecedor_normalizado`, NUNCA `fornecedor` cru: a mesma loja lida pela IA
// em dois PDFs diferentes sai grafada diferente ("Solos Soluções" x "SOLOS
// SOLUÇÕES  ") e viraria duas opções separadas no menu, cada uma trazendo metade
// dos documentos. O valor normalizado também é o que o GET / usa pra filtrar —
// os dois lados precisam falar a MESMA língua, senão o filtro não acha nada.
controleRoutes.get('/filtros', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  try {
    const { data, error } = await supabase
      .from('documentos_controle')
      .select('fornecedor_normalizado')
      .eq('fazenda_id', fazendaId)

    if (error) throw error

    const fornecedores = [...new Set(
      (data ?? []).map(d => d.fornecedor_normalizado).filter((f): f is string => !!f),
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'))

    res.json({
      fornecedores,
      status: ['importado', 'processando', 'processado', 'erro'],
    })
  } catch (err) {
    next(err)
  }
})

// GET /controle/documentos — lista os documentos da fazenda ativa, mais recentes
// primeiro, já COM os itens vinculados (decisão do Matheus, 17/08/2026: mais peso
// na resposta, mas a tela nasce com tudo numa chamada só). Busca os itens de TODOS
// os documentos da PÁGINA com um único IN() e agrupa em memória — evita 1 query
// por documento (N+1).
//
// Filtro e paginação (Epic 2.4) acontecem no BANCO, não em memória: a lista pode
// crescer bastante ao longo dos anos, e um filtro que só operasse sobre a página já
// carregada seria incapaz de achar documento fora dela.
//
// arquivo_path nunca sai daqui: é o caminho interno do bucket privado, sem
// utilidade pro front (que usa a rota /:id/arquivo pra abrir o PDF via signed URL
// de vida curta) — devolver o path cru só exporia a convenção interna de Storage
// sem dar acesso real a nada (o bucket é privado).
controleRoutes.get('/', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = listarSchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Parâmetros de busca inválidos.', detalhe: parsed.error.flatten() })
    return
  }
  const { pagina, porPagina, fornecedor, status, dataInicio, dataFim } = parsed.data

  try {
    let query = supabase
      .from('documentos_controle')
      .select(
        'id, fornecedor, numero_documento, data_documento, valor_total, status, erro_mensagem, nome_arquivo, fazenda_id, created_at',
        { count: 'exact' },
      )
      .eq('fazenda_id', fazendaId)

    // Filtra pela coluna NORMALIZADA (migration 017), não por `fornecedor` cru:
    // duas grafias do mesmo fornecedor compartilham um único
    // fornecedor_normalizado, então marcar essa opção no menu traz os documentos
    // das duas. Normaliza também o que chega da tela — o front manda o valor que
    // veio de GET /filtros (já normalizado), mas normalizar de novo é idempotente
    // e protege contra chamada manual/URL colada à mão com a grafia original.
    if (fornecedor.length > 0) {
      query = query.in('fornecedor_normalizado', fornecedor.map(normalizarFornecedor))
    }
    if (status.length > 0) query = query.in('status', status)
    if (dataInicio) query = query.gte('data_documento', dataInicio)
    if (dataFim) query = query.lte('data_documento', dataFim)

    const offset = (pagina - 1) * porPagina
    const { data: documentos, error: errDocumentos, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + porPagina - 1)

    if (errDocumentos) throw errDocumentos

    const totalDocumentos = count ?? 0
    const totalPaginas = Math.max(1, Math.ceil(totalDocumentos / porPagina))

    if (!documentos || documentos.length === 0) {
      res.json({ documentos: [], paginaAtual: pagina, totalPaginas, totalDocumentos })
      return
    }

    const documentoIds = documentos.map(d => d.id)

    // Filtro por fazenda_id junto com o IN() de documento_controle_id fecha, na
    // mesma query, tanto a mistura entre fazendas quanto o caso (que não deveria
    // acontecer, mas por defesa) de um item apontar pra documento de outra fazenda.
    //
    // ORDEM: sem `.order()` o Postgres pode devolver os itens em qualquer ordem
    // (e a ordem MUDA entre chamadas quando o plano de execução muda), fazendo as
    // linhas de um mesmo documento dançarem na tela a cada recarga.
    // `ocorrencia_no_documento` é o critério pedido; como ele só distingue linhas
    // REPETIDAS (é 0 pra quase todo item — ver gravarDocumentoPdf.ts), sozinho ele
    // não desempata nada. `id` entra como segundo critério só pra fechar o empate
    // de forma determinística: arbitrário, mas ESTÁVEL — a mesma página recarregada
    // devolve sempre a mesma ordem.
    // ⚠️ Dívida conhecida: a ordem ORIGINAL das linhas do PDF não é guardada em
    // coluna nenhuma hoje; recuperá-la exigiria migration nova (fora do escopo).
    const { data: itens, error: errItens } = await supabase
      .from('itens_nfe')
      .select('id, descricao, quantidade, unidade, valor_unitario, valor_total, fornecedor, numero_documento, ocorrencia_no_documento, documento_controle_id, conta_como_compra, data_manual, insumo_id')
      .in('documento_controle_id', documentoIds)
      .eq('fazenda_id', fazendaId)
      .order('ocorrencia_no_documento', { ascending: true })
      .order('id', { ascending: true })

    if (errItens) throw errItens

    const itensPorDocumento = new Map<string, typeof itens>()
    for (const item of itens ?? []) {
      const lista = itensPorDocumento.get(item.documento_controle_id) ?? []
      lista.push(item)
      itensPorDocumento.set(item.documento_controle_id, lista)
    }

    const resposta = documentos.map(doc => ({
      ...doc,
      itens: itensPorDocumento.get(doc.id) ?? [],
    }))

    res.json({ documentos: resposta, paginaAtual: pagina, totalPaginas, totalDocumentos })
  } catch (err) {
    next(err)
  }
})

// GET /controle/documentos/:id/arquivo — visualizar/baixar o PDF original.
// Devolve { url } com uma signed URL de vida curta (60s — só pra abrir na
// hora do clique, não pra guardar link permanente) em vez de um redirect
// 302: o front decide como usar a URL (nova aba, iframe, botão de download),
// e a resposta em JSON é mais fácil de tratar erro (404/500) do lado do
// cliente do que interpretar o status de um redirect.
//
// IMPORTANTE: o bucket é privado e a signed URL NÃO passa pela RLS do
// Postgres — RLS protege linha de TABELA, não objeto de Storage. Sem
// confirmar aqui, no código, que o documento pertence à fazenda ativa ANTES
// de gerar a URL, um :id de outra fazenda ganharia um link válido pro PDF
// alheio. Mesmo cuidado que fazendaDe() já dá nas outras rotas, por outra porta.
controleRoutes.get('/:id/arquivo', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  try {
    const { data: documento, error: errDocumento } = await supabase
      .from('documentos_controle')
      .select('arquivo_path')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .single()

    if (errDocumento || !documento) {
      res.status(404).json({ error: 'Documento não encontrado.' })
      return
    }

    const { data: assinado, error: errAssinado } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(documento.arquivo_path, 60)

    if (errAssinado || !assinado) {
      console.error('[Controle] Falha ao gerar signed URL:', errAssinado?.message)
      res.status(500).json({ error: 'Erro ao gerar link do arquivo.' })
      return
    }

    res.json({ url: assinado.signedUrl })
  } catch (err) {
    next(err)
  }
})
