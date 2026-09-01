// Acesso ao banco para o casamento boleto ↔ nota fiscal.
//
// Fica separado de `casarNota.ts` (lógica pura, com teste de unidade) e de
// `importarBoleto.ts` (orquestração): aqui mora só SQL.
//
// ⚠️ O backend usa a service key e IGNORA o RLS — o isolamento por fazenda só
// existe se o `.eq('fazenda_id', ...)` estiver escrito na query. Está, em todas
// as consultas abaixo, e `notasCandidatas.test.ts` prova cada uma: remover UMA
// dessas linhas passava por 763 testes sem ninguém reclamar (achado 5 do Apolo).

import { supabase } from '../supabase'
import type { ContaDaNota, NotaCandidata } from './casarNota'

// Teto de sanidade da varredura. Uma nota de dois anos atrás não está sendo
// cobrada por um boleto que chega hoje (o leitor recusa vencimento acima de
// +730 dias). Medido em 31/08/2026: a fazenda tem 142 notas no total.
const MAX_NOTAS = 500

// Colunas conferidas na tabela REAL em 31/08/2026 — `notas_fiscais` não tem
// `chave_acesso` (o schema.sql da raiz está desatualizado). Medido, não lido
// do documento.
const CAMPOS = 'id, numero, emitente_nome, valor_total, data_emissao'

type Contexto = {
  /** notaId → contas a pagar que ela já tem. */
  contas: Map<string, ContaDaNota[]>
  /** notaIds que TÊM lançamento no Financeiro. */
  lancaram: Set<string>
}

// Varre as contas e os lançamentos DA FAZENDA inteira, em vez de perguntar por
// uma lista de ids.
//
// Não é só estilo: `.in('nota_fiscal_id', [...N uuids])` cresce a URL com o
// número de notas, e gateway com buffer de cabeçalho padrão (8 KB) passa a
// recusar em algumas centenas — a tela mostraria "Erro interno do servidor"
// sem o dono ter feito nada errado. Assim a URL tem tamanho fixo.
//
// Era defeito LATENTE quando foi trocado, não ativo (o Apolo se retratou do
// enquadramento na rodada 2). Para saber o tamanho de hoje, meça em vez de
// confiar nesta linha:
//   select count(*) from contas_a_pagar where nota_fiscal_id is not null;
//   select count(*) from lancamentos_financeiros where nota_fiscal_id is not null;
async function contextoDaFazenda(fazendaId: string): Promise<Contexto> {
  const [contasRes, lancRes] = await Promise.all([
    supabase
      .from('contas_a_pagar')
      .select('id, nota_fiscal_id, valor, vencimento, status')
      .eq('fazenda_id', fazendaId)
      .not('nota_fiscal_id', 'is', null),
    supabase
      .from('lancamentos_financeiros')
      .select('nota_fiscal_id')
      .eq('fazenda_id', fazendaId)
      .not('nota_fiscal_id', 'is', null),
  ])

  // Erro de banco NUNCA vira "nenhuma tem conta" nem "nenhuma lançou": os dois
  // apagariam justamente as travas que impedem cobrança repetida e gasto
  // sumido. Estoura para quem chama tratar como falha, não como permissão.
  if (contasRes.error) throw new Error(`falha ao ler contas da fazenda: ${contasRes.error.message}`)
  if (lancRes.error) throw new Error(`falha ao ler lançamentos da fazenda: ${lancRes.error.message}`)

  const contas = new Map<string, ContaDaNota[]>()
  for (const c of contasRes.data ?? []) {
    const chave = c.nota_fiscal_id as string
    const lista = contas.get(chave) ?? []
    lista.push({
      id: c.id,
      valor: c.valor === null ? null : Number(c.valor),
      vencimento: c.vencimento ?? null,
      status: c.status,
    })
    contas.set(chave, lista)
  }

  return {
    contas,
    lancaram: new Set((lancRes.data ?? []).map(l => l.nota_fiscal_id as string)),
  }
}

function montar(nota: any, ctx: Contexto): NotaCandidata {
  return {
    id: nota.id,
    numero: String(nota.numero ?? ''),
    emitente_nome: nota.emitente_nome ?? '',
    valor_total: Number(nota.valor_total ?? 0),
    data_emissao: nota.data_emissao ?? '',
    contas: ctx.contas.get(nota.id) ?? [],
    lancouGasto: ctx.lancaram.has(nota.id),
  }
}

/** Notas da fazenda que podem ser a origem de um boleto, mais recentes primeiro. */
export async function buscarNotasCandidatas(fazendaId: string): Promise<NotaCandidata[]> {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select(CAMPOS)
    .eq('fazenda_id', fazendaId)
    // `nullsFirst: false` porque o padrão do Postgres em DESC é NULLS FIRST:
    // nota sem data de emissão ocuparia as primeiras vagas da janela de 500 e
    // empurraria nota real para fora. Hoje são 0 (medido), mas a coluna aceita
    // nulo e o defeito só apareceria depois que já tivesse acontecido.
    .order('data_emissao', { ascending: false, nullsFirst: false })
    .limit(MAX_NOTAS)

  if (error) throw new Error(`falha ao buscar notas: ${error.message}`)

  const ctx = await contextoDaFazenda(fazendaId)
  return (data ?? []).map(n => montar(n, ctx))
}

/**
 * Uma nota específica, SÓ se for da fazenda ativa. `null` quando não existe ou
 * é de outra propriedade — a checagem que o RLS não faz por nós aqui.
 */
export async function buscarNotaDaFazenda(
  notaId: string,
  fazendaId: string,
): Promise<NotaCandidata | null> {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select(CAMPOS)
    .eq('id', notaId)
    .eq('fazenda_id', fazendaId)
    .maybeSingle()

  if (error) throw new Error(`falha ao buscar a nota: ${error.message}`)
  if (!data) return null

  return montar(data, await contextoDaFazenda(fazendaId))
}

/**
 * Contas SOLTAS (sem nota) com este valor e vencimento nesta fazenda.
 *
 * É o que permite ADOTAR em vez de recusar: o dono pode ter importado o mesmo
 * boleto antes escolhendo "nenhuma nota", ou o robô do e-mail pode ter criado a
 * conta solta quando o XML ainda não tinha chegado. Recusar com "já existe" e
 * deixar a conta solta lá é a resposta que parece tranquila e mantém o gasto
 * dobrado de pé.
 *
 * Devolve TODAS as que casam, com o estado de cada uma — o filtro de "pode
 * adotar" é decidido em `importarBoleto.ts`, não aqui. A diferença importa: se
 * a consulta já escondesse as não-adotáveis, o serviço não teria como dizer ao
 * dono que existe uma conta paga com esse valor, e responderia "criada" ao lado
 * de uma duplicidade.
 */
export type ContaSolta = {
  id: string
  fornecedor: string | null
  status: string
  recorrente_id: string | null
  documento_controle_id: string | null
}

export async function buscarContasSoltas(
  valor: number,
  vencimento: string,
  fazendaId: string,
): Promise<ContaSolta[]> {
  const { data, error } = await supabase
    .from('contas_a_pagar')
    .select('id, fornecedor, status, recorrente_id, documento_controle_id')
    .eq('fazenda_id', fazendaId)
    .eq('vencimento', vencimento)
    .eq('valor', valor)
    .is('nota_fiscal_id', null)

  if (error) throw new Error(`falha ao procurar conta solta: ${error.message}`)
  return (data ?? []) as ContaSolta[]
}

/**
 * Amarra uma conta que já existe na nota.
 *
 * As quatro condições do WHERE repetem, no próprio UPDATE, o que
 * `importarBoleto.ts` já checou. Não é redundância boba: entre a leitura e a
 * escrita o dono pode ter pago a conta noutra aba, e amarrar uma conta PAGA
 * deixa o lançamento dela de pé em cima do gasto da nota. Se nada casar, o
 * update não acha linha e devolve `false` — nunca sobrescreve a decisão da
 * outra aba.
 */
export async function adotarContaNaNota(
  contaId: string,
  notaFiscalId: string,
  fazendaId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('contas_a_pagar')
    .update({ nota_fiscal_id: notaFiscalId })
    .eq('id', contaId)
    .eq('fazenda_id', fazendaId)
    .is('nota_fiscal_id', null)
    .in('status', ['aberta', 'aguardando'])
    .is('recorrente_id', null)
    .is('documento_controle_id', null)
    .select('id')

  if (error) throw new Error(`falha ao amarrar a conta na nota: ${error.message}`)
  return (data ?? []).length > 0
}
