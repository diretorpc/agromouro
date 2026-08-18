import { supabase } from '../supabase'
import { normalizarFornecedor } from './normalizarFornecedor'
import type { ItemControleRow } from './editarItemControle'

// Lista item a item (não mais agrupado por documento) para a grade editável
// estilo Excel — GET /controle/documentos (Epic 2.4, PR #61) continua
// existindo sem mudança, mas essa rota nova é quem alimenta a tela nova.
// Ver desenho completo: docs/superpowers/specs/2026-08-18-controle-tabela-
// editavel-design.md.
//
// Inclui item importado de PDF (documento_controle_id not null) E item
// avulso (documento_controle_id null) — os dois têm em comum
// `nota_fiscal_id is null`. Item de NF-e NUNCA aparece aqui: é outra fonte
// de dado, com regras de edição diferentes (tela de NF-e/Financeiro).

export type FiltroItensControle = {
  pagina:     number
  porPagina:  number
  fornecedor: string[]
  status:     string[]
  dataInicio?: string
  dataFim?:    string
}

export type ItemControleComDuplicata = ItemControleRow & {
  duplicado: boolean
  duplicadoMotivo: 'reimportacao' | 'linhas_iguais' | null
}

export type ResultadoListarItens = {
  itens: ItemControleComDuplicata[]
  paginaAtual: number
  totalPaginas: number
  totalItens: number
}

const COLUNAS =
  'id, descricao, quantidade, unidade, valor_unitario, valor_total, fornecedor, ' +
  'numero_documento, ocorrencia_no_documento, documento_controle_id, conta_como_compra, ' +
  'data_manual, insumo_id, fazenda_id, duplicata_confirmada_em, duplicata_confirmada_vezes'

// Caso 2 do desenho ("a trava não pegou porque a edição manual mudou a
// chave"): grupo mais SOLTO que o índice de dedupe da migration 018 (não
// exige descrição idêntica nem ocorrência igual) — o objetivo aqui é avisar
// "provavelmente a mesma compra", não impedir gravação. Roda sobre a
// FAZENDA INTEIRA, não só a página pedida: duas linhas duplicadas em
// páginas diferentes do "carregar mais" precisam se pintar juntas mesmo
// assim. Custo aceito e documentado no spec (agregação sobre índice
// existente — barato na escala atual do projeto).
async function idsComLinhaIgual(fazendaId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('itens_nfe')
    .select('id, fornecedor, numero_documento, valor_total')
    .eq('fazenda_id', fazendaId)
    .is('nota_fiscal_id', null)

  if (error) throw error

  const grupos = new Map<string, string[]>()
  for (const item of data ?? []) {
    const fornecedorNorm = typeof item.fornecedor === 'string' ? normalizarFornecedor(item.fornecedor) : null
    // Sem fornecedor OU sem número não entra na comparação — "parecido"
    // exige pelo menos essas duas pistas; senão qualquer item sem os dois
    // campos colidiria com qualquer outro na mesma situação.
    if (!fornecedorNorm || !item.numero_documento) continue
    const chave = `${fornecedorNorm}||${item.numero_documento}||${item.valor_total}`
    const lista = grupos.get(chave) ?? []
    lista.push(item.id)
    grupos.set(chave, lista)
  }

  const marcados = new Set<string>()
  for (const ids of grupos.values()) {
    if (ids.length > 1) ids.forEach(id => marcados.add(id))
  }
  return marcados
}

export async function listarItensControle(
  fazendaId: string,
  filtro: FiltroItensControle,
): Promise<ResultadoListarItens> {
  const { pagina, porPagina, fornecedor, status, dataInicio, dataFim } = filtro

  // Filtro de status pertence ao DOCUMENTO (documentos_controle.status), não
  // ao item — resolve os ids dos documentos que batem PRIMEIRO, pra montar
  // um filtro OR que preserva item AVULSO (sem documento, sem status) sempre
  // visível mesmo com um filtro de status ativo. Decisão do spec: filtro de
  // status nunca esconde item avulso — ele simplesmente não tem status para
  // filtrar por.
  let idsDocumentosComStatus: string[] | null = null
  if (status.length > 0) {
    const { data, error } = await supabase
      .from('documentos_controle')
      .select('id')
      .eq('fazenda_id', fazendaId)
      .in('status', status)
    if (error) throw error
    idsDocumentosComStatus = (data ?? []).map(d => d.id)
  }

  let query = supabase
    .from('itens_nfe')
    .select(COLUNAS, { count: 'exact' })
    .eq('fazenda_id', fazendaId)
    .is('nota_fiscal_id', null)

  if (fornecedor.length > 0) {
    query = query.in('fornecedor_normalizado', fornecedor.map(normalizarFornecedor))
  }
  if (dataInicio) query = query.gte('data_manual', dataInicio)
  if (dataFim) query = query.lte('data_manual', dataFim)
  if (idsDocumentosComStatus !== null) {
    // `.or()` com sintaxe crua do PostgREST — precisa da lista entre
    // parênteses, mesmo vazia ("in.()" é válido e não acha nada). Item sem
    // documento (avulso) sempre passa pela primeira cláusula.
    const listaIds = idsDocumentosComStatus.join(',')
    query = query.or(`documento_controle_id.is.null,documento_controle_id.in.(${listaIds})`)
  }

  const offset = (pagina - 1) * porPagina
  const { data: itens, error: errItens, count } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + porPagina - 1)

  if (errItens) throw errItens

  const totalItens = count ?? 0
  const totalPaginas = Math.max(1, Math.ceil(totalItens / porPagina))

  const idsComLinhaIgualNaFazenda = (itens ?? []).length > 0 ? await idsComLinhaIgual(fazendaId) : new Set<string>()

  const itensComDuplicata: ItemControleComDuplicata[] = (itens ?? []).map(item => {
    const row = item as unknown as ItemControleRow
    const reimportado = row.duplicata_confirmada_em !== null
    const linhaIgual = idsComLinhaIgualNaFazenda.has(row.id)
    return {
      ...row,
      duplicado: reimportado || linhaIgual,
      // Reimportação prevalece na explicação quando os dois sinais batem
      // juntos — é o motivo mais específico e mais fácil de confirmar
      // olhando `duplicata_confirmada_vezes`.
      duplicadoMotivo: reimportado ? 'reimportacao' : linhaIgual ? 'linhas_iguais' : null,
    }
  })

  return { itens: itensComDuplicata, paginaAtual: pagina, totalPaginas, totalItens }
}
