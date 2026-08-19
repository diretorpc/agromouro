import { supabase } from '../supabase'
import { normalizarFornecedor } from './normalizarFornecedor'

// Alimenta os 5 gráficos da aba Controle (GET /controle/graficos).
// Desenho: docs/superpowers/specs/2026-08-19-controle-graficos-design.md
//
// ⚠️ A SOMA NÃO ACONTECE AQUI, e isso é a decisão central do desenho. A grade
// carrega 500 itens por vez e o PostgREST corta em 1000 linhas — um gráfico
// somado em cima do que veio na página mostra o pedaço e parece o todo, sem
// erro nenhum na tela. Toda a agregação mora na função `controle_graficos`
// (migration 020_controle_agregacoes.sql), que faz GROUP BY sobre a fazenda
// inteira. Este arquivo é só a casca: valida a fazenda, traduz filtro e
// devolve o payload.
//
// ⚠️ SE FOR ADICIONAR CÁLCULO, ADICIONE NO SQL, NÃO AQUI. Somar/filtrar neste
// arquivo reintroduz exatamente o defeito que a migration existe pra impedir.

export type FiltroGraficosControle = {
  fornecedor: string[]
  status:     string[]
  dataInicio?: string
  dataFim?:    string
  // Corta os gráficos 4 e 5 (uma série POR PRODUTO — não dá pra desenhar 300
  // linhas). Os gráficos 1-3 vêm completos; o "top 10 + outros" é do
  // frontend, que é onde o botão "ver todos" existe.
  top?: number
}

export type FatiaGrafico    = { rotulo: string; total: number; itens: number }
export type FatiaMesGrafico = { mes: string;    total: number; itens: number }

export type PontoPreco = {
  data: string
  precoMedio: number
  quantidade: number
  // Mais de uma unidade no mesmo ponto ("LT" e "L", ou pior "KG" e "L")
  // significa que a média está misturando régua — a tela precisa avisar,
  // não escolher uma e calar.
  unidades: string[] | null
}
export type SerieProduto = { produto: string; pontos: PontoPreco[] }

export type BarraFornecedor = {
  fornecedor: string
  precoMedio: number
  precoMin:   number
  precoMax:   number
  itens:      number
  unidades:   string[] | null
}
export type ComparacaoProduto = { produto: string; barras: BarraFornecedor[] }

// O que ficou de FORA de cada gráfico, em itens E em reais — num gráfico cujo
// eixo é dinheiro, "3 itens sem data" não conta que faltam R$ 180 mil nas
// barras.
//
// ⚠️ Os três `valorSem*` NÃO significam a mesma coisa (ver o comentário do
// bloco `meta` na migration 020): `valorSemProduto` APARECE no gráfico 2,
// como a barra 'Sem produto' — só é descarte dos gráficos 4 e 5. Somar os
// três como "fora do gráfico" numa legenda é mentira.
export type MetaGraficos = {
  totalGeral: number
  totalItens: number
  itensSemData: number
  valorSemData: number
  itensSemProduto: number
  valorSemProduto: number
  itensSemQuantidade: number
  valorSemQuantidade: number
  fornecedoresDistintos: number
  produtosDistintos: number
  produtosNoPrecoTempo: number
  produtosComparaveis: number
  produtosNoPrecoPorFornecedor: number
  topAplicado: number
  mediaPonderadaPor: string
}

export type GraficosControle = {
  porFornecedor:      FatiaGrafico[]
  porProduto:         FatiaGrafico[]
  porMes:             FatiaMesGrafico[]
  precoNoTempo:       SerieProduto[]
  precoPorFornecedor: ComparacaoProduto[]
  meta:               MetaGraficos
}

const TOP_PADRAO = 10

export async function agregarControle(
  fazendaId: string,
  filtro: FiltroGraficosControle,
): Promise<GraficosControle> {
  // A API usa SUPABASE_SERVICE_KEY, que bypassa RLS: `p_fazenda_id` é a única
  // barreira entre as fazendas. Falhar alto aqui, antes de tocar no banco, é
  // melhor que mandar `undefined` e receber um payload vazio — vazio parece
  // "essa fazenda não tem gasto", e esconde um bug de autenticação atrás de
  // uma tela em branco.
  if (!fazendaId) throw new Error('Fazenda não identificada para agregar os gráficos de Controle.')

  const { data, error } = await supabase.rpc('controle_graficos', {
    p_fazenda_id: fazendaId,
    // Array vazio vira null de propósito: é o valor que a função trata como
    // "sem filtro". Mandar `[]` funciona igual (a função checa
    // `cardinality = 0`), mas null é o contrato declarado no default.
    //
    // A normalização espelha `listarItensControle` — a grade filtra por
    // `fornecedor_normalizado`. Nome cru aqui faria a grade achar linhas e o
    // gráfico não achar nenhuma, com os dois na mesma tela.
    p_fornecedor:  filtro.fornecedor.length > 0 ? filtro.fornecedor.map(normalizarFornecedor) : null,
    p_data_inicio: filtro.dataInicio ?? null,
    p_data_fim:    filtro.dataFim ?? null,
    p_status:      filtro.status.length > 0 ? filtro.status : null,
    p_top:         filtro.top ?? TOP_PADRAO,
  })

  if (error) {
    // Migration 020 não aplicada em produção cai aqui ("function
    // controle_graficos does not exist") — foi exatamente o que aconteceu com
    // a 019. Deixar virar 500 é de propósito: engolir e devolver listas
    // vazias faria a tela dizer "sem dados" quando o problema é deploy.
    console.error('[Controle] Falha ao agregar gráficos:', error.message)
    throw new Error(error.message)
  }

  // `data` nulo sem erro não deveria acontecer (a função sempre devolve um
  // objeto), mas tratar como "sem dados" seria a mesma mentira de cima.
  if (!data) throw new Error('A função controle_graficos não devolveu resultado.')

  return data as GraficosControle
}
