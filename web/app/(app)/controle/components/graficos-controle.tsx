'use client'

import { useEffect, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { GraficosControlePayload, FatiaGrafico } from '@/lib/types'
import {
  agruparTopMaisOutros, separarSemProduto, preencherMesesVazios,
  fmtBRL, fmtBRLCurto, fmtPrecoCurto, fmtPct, rotuloMes,
  ROTULO_OUTROS, ROTULO_SEM_PRODUTO,
} from './graficos-dados'

// Os gráficos da aba Controle. Desenho:
// docs/superpowers/specs/2026-08-19-controle-graficos-design.md
//
// QUATRO gráficos: fornecedor, produto, mês e preço no tempo. O quinto do
// desenho (preço do mesmo produto ENTRE fornecedores) tem SQL e rota prontos,
// mas nenhuma tela — só faz sentido com o mesmo produto comprado de duas lojas
// diferentes, e hoje `produtosComparaveis` é 0. O rodapé diz isso em voz alta
// em vez de simplesmente não existir.
//
// ⚠️ NADA É SOMADO AQUI. Todo total vem pronto da função `controle_graficos`
// (migration 020), que agrega no Postgres sobre a fazenda inteira. A grade
// carrega 500 itens por vez — somar o que está na tela mostraria o pedaço
// parecendo o todo. `agruparTopMaisOutros` só reorganiza, e tem teste (provado
// por mutação) de que a soma não muda.

// Estado aberto/fechado sobrevive ao F5 — decisão nº 5 do desenho: a grade
// continua sendo o centro da tela, o gráfico é apoio.
const CHAVE_ABERTO = 'controle:graficos:aberto'
const TOP_BARRAS = 10
const SEM_LIMITE = Number.MAX_SAFE_INTEGER

// ⚠️ A cor vem da POSIÇÃO NO RANKING, então ela MUDA quando o ranking muda
// (filtrar tirando o produto do topo desloca todo mundo uma cor). Quem
// identifica a barra é o rótulo no eixo, não a cor — o comentário anterior
// prometia "estável sob filtro", que é o contrário do que o código faz
// (achado 13 da revisão do Apolo: comentário errado é o que faz o próximo
// leitor não consertar).
const CORES = [
  '#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2',
  '#ca8a04', '#dc2626', '#4f46e5', '#059669', '#db2777',
]
const COR_OUTROS = '#94a3b8'
const COR_SEM_NOME = '#d97706'

function corDaBarra(rotulo: string, i: number): string {
  if (rotulo === ROTULO_OUTROS) return COR_OUTROS
  if (rotulo === ROTULO_SEM_PRODUTO) return COR_SEM_NOME
  return CORES[i % CORES.length]
}

function Secao({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-medium text-foreground">{titulo}</h3>
      <p className="text-xs text-muted-foreground mb-2">{ajuda}</p>
      {children}
    </section>
  )
}

function CaixaTooltip({ titulo, linhas }: { titulo: string; linhas: string[] }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-sm">
      <p className="font-medium text-foreground mb-1">{titulo}</p>
      {linhas.map(l => <p key={l} className="tabular-nums text-muted-foreground">{l}</p>)}
    </div>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

// Barra horizontal — mesma forma para "gasto por fornecedor" e "gasto por
// produto". Extraído porque eram dois blocos de ~35 linhas idênticos, e
// qualquer conserto num deles esqueceria o outro.
function BarrasHorizontais({
  barras, totalGeral, palavraItem,
}: {
  barras: FatiaGrafico[]
  totalGeral: number
  palavraItem: [string, string]
}) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 360 }}>
        <ResponsiveContainer width="100%" height={barras.length * 34 + 24}>
          <BarChart data={barras} layout="vertical" margin={{ top: 0, right: 96, bottom: 0, left: 8 }} barSize={18}>
            <XAxis type="number" hide />
            <YAxis
              type="category" dataKey="rotulo" width={190}
              tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false}
            />
            <RechartsTooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const f = payload[0].payload as FatiaGrafico
                return (
                  <CaixaTooltip
                    titulo={f.rotulo}
                    linhas={[
                      fmtBRL(f.total),
                      `${fmtPct(f.total, totalGeral)}% do total`,
                      `${f.itens} ${f.itens === 1 ? palavraItem[0] : palavraItem[1]}`,
                    ]}
                  />
                )
              }}
            />
            <Bar dataKey="total" radius={[0, 4, 4, 0]}>
              {barras.map((b, i) => <Cell key={b.rotulo} fill={corDaBarra(b.rotulo, i)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function GraficosControle({
  dados, loading, erro, desatualizado,
}: {
  dados: GraficosControlePayload | null
  loading: boolean
  erro: string | null
  // A última busca falhou e o que está desenhado é do filtro ANTERIOR.
  desatualizado: boolean
}) {
  const [aberto, setAberto] = useState(true)
  const [verTodosProdutos, setVerTodosProdutos] = useState(false)
  const [verTodosFornecedores, setVerTodosFornecedores] = useState(false)

  // localStorage só existe no navegador — ler dentro do efeito evita
  // divergência entre o HTML do servidor e o do cliente (hydration).
  //
  // ⚠️ try/catch nos DOIS acessos, mesmo padrão de `lib/use-column-widths.ts`
  // (achado 8): com armazenamento bloqueado para o site, `getItem` lança
  // SecurityError — e como o app não tem error boundary (`error.tsx` não
  // existe em lugar nenhum), a rota /controle INTEIRA cairia na tela de erro
  // do Next, levando a grade junto, por causa de uma preferência de UI.
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(CHAVE_ABERTO)
      if (salvo !== null) setAberto(salvo === '1')
    } catch { /* preferência não persiste; a tela segue funcionando */ }
  }, [])

  function alternar() {
    setAberto(atual => {
      const novo = !atual
      try {
        window.localStorage.setItem(CHAVE_ABERTO, novo ? '1' : '0')
      } catch { /* idem — não persistir é aceitável, quebrar a tela não */ }
      return novo
    })
  }

  const meta = dados?.meta

  // "Atualizando" é diferente de "ainda não mostrei nada" — mesmo raciocínio
  // que a grade já usa em page.tsx. Achado 3: sem isto, durante a rebusca
  // (1 s de debounce após uma edição, 300 ms após troca de filtro, mais o
  // tempo de rede) a tela mostrava o número ANTIGO em opacidade cheia, sem
  // nada indicando transição, enquanto a tabela ao lado já tinha mudado.
  const atualizando = loading && !!dados

  // ── Fornecedor ───────────────────────────────────────────────────────────
  const fornecedores = agruparTopMaisOutros(
    dados?.porFornecedor ?? [],
    verTodosFornecedores ? SEM_LIMITE : TOP_BARRAS,
  )

  // ── Produto ──────────────────────────────────────────────────────────────
  // O balde 'Sem produto' sai do RANKING e volta como última barra fixa
  // (achado 2): com mais de 10 produtos ele caía dentro de "Outros", e a tela
  // mandava procurar uma barra que não existia. Ele precisa ficar visível — é
  // justamente a barra que manda o Matheus ir preencher as linhas.
  const { comNome, semProduto } = separarSemProduto(dados?.porProduto ?? [])
  const produtos = agruparTopMaisOutros(comNome, verTodosProdutos ? SEM_LIMITE : TOP_BARRAS)
  const barrasProduto = semProduto ? [...produtos.barras, semProduto] : produtos.barras

  // Achado 14: a tela AFIRMA que "a soma das barras continua R$ X". Isso
  // depende de `porProduto` vir completo do SQL — invariante que mora inteira
  // na migration 020. No dia em que alguém puser um `limit` lá (já existe um
  // em `top_produtos`, no mesmo arquivo), a frase continuaria sendo impressa,
  // agora falsa, sem erro nenhum. Conferir custa 3 linhas.
  const somaBarrasProduto = barrasProduto.reduce((s, b) => s + b.total, 0)
  const barrasNaoFecham = !!meta && Math.abs(somaBarrasProduto - meta.totalGeral) > 0.01

  // ── Mês ──────────────────────────────────────────────────────────────────
  // Achado 12: `porMes` só traz mês COM compra, então jan/mar/jul apareciam
  // colados e igualmente espaçados — lidos como três meses seguidos de gasto.
  const meses = preencherMesesVazios(dados?.porMes ?? []).map(m => ({ ...m, rotulo: rotuloMes(m.mes) }))

  // ── Preço no tempo ───────────────────────────────────────────────────────
  // Só produto com 2+ pontos vira LINHA — um ponto solto não mostra tendência
  // e polui a legenda. Quantos ficaram de fora aparece abaixo, nunca some.
  const series = (dados?.precoNoTempo ?? []).filter(s => s.pontos.length > 1)
  const seriesDeUmPonto = (dados?.precoNoTempo ?? []).length - series.length

  // Recharts precisa de uma linha por eixo X com uma coluna por série.
  const mesesDasSeries = [...new Set(series.flatMap(s => s.pontos.map(p => p.data)))].sort()
  const dadosPreco = mesesDasSeries.map(mes => {
    const linha: Record<string, string | number | null> = { mes, rotulo: rotuloMes(mes) }
    for (const s of series) linha[s.produto] = s.pontos.find(p => p.data === mes)?.precoMedio ?? null
    return linha
  })

  // Unidade misturada dentro do MESMO produto: a média está somando régua
  // diferente (ex.: "KG" num mês e "L" noutro). Avisar é obrigação — o degrau
  // na linha pareceria variação de preço.
  const seriesComUnidadeMisturada = series
    .filter(s => new Set(s.pontos.flatMap(p => p.unidades ?? [])).size > 1)
    .map(s => s.produto)

  // Achado 4: o gráfico de preço descarta item sem quantidade E item sem data
  // (o SQL filtra os dois), e a seção não dizia nada. Os dois números já vêm
  // no payload e nunca eram lidos.
  const itensForaDoPreco = (meta?.itensSemQuantidade ?? 0) + (meta?.itensSemData ?? 0)
  const valorForaDoPreco = (meta?.valorSemQuantidade ?? 0) + (meta?.valorSemData ?? 0)

  return (
    <Card>
      <CardHeader className="py-3">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          className="flex w-full items-center gap-2 text-left"
        >
          {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="text-base font-semibold">Gráficos</span>
          {meta && (
            <span className={cn('ml-auto text-sm tabular-nums', desatualizado ? 'text-amber-700' : 'text-muted-foreground')}>
              {fmtBRL(meta.totalGeral)} · {meta.totalItens} {meta.totalItens === 1 ? 'item' : 'itens'}
              {desatualizado && ' (desatualizado)'}
            </span>
          )}
        </button>
      </CardHeader>

      {/* ⚠️ FORA do `{aberto && ...}` de propósito (achado 1): com os gráficos
          RECOLHIDOS, o CardContent inteiro não renderiza — então o alerta e a
          opacidade sumiam, e o que sobrava na tela era o total do filtro
          ANTERIOR no cabeçalho, em opacidade cheia, ao lado de uma tabela já
          filtrada. O aviso tem que sobreviver ao estado recolhido. */}
      {erro && (
        <div className="px-6 pb-3">
          <p role="alert" className="text-sm text-destructive bg-red-50 border border-red-200 rounded px-3 py-2">
            {erro}
            {desatualizado && dados && (
              <>
                {' '}
                <strong>
                  Os números acima são da última busca que deu certo e NÃO conferem com a
                  tabela — não use para decidir nada até recarregar a página.
                </strong>
              </>
            )}
          </p>
        </div>
      )}

      {aberto && (
        <CardContent className="pt-0 space-y-8">
          {loading && !dados && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-56 w-full" />
            </div>
          )}

          {dados && meta && meta.totalItens === 0 && !erro && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhum item no filtro atual — os gráficos aparecem quando houver o que somar.
            </p>
          )}

          {dados && meta && meta.totalItens > 0 && (
            <div
              className={cn(
                'space-y-8 transition-opacity',
                (desatualizado || atualizando) && 'opacity-50',
              )}
            >
              <span className="sr-only" role="status">
                {atualizando ? 'Atualizando os gráficos.' : ''}
              </span>

              {/* ── 1. Gasto por fornecedor ──────────────────────────── */}
              <Secao
                titulo="Gasto por fornecedor"
                ajuda="Quanto você deixou em cada loja, somando todas as compras do período."
              >
                <BarrasHorizontais
                  barras={fornecedores.barras}
                  totalGeral={meta.totalGeral}
                  palavraItem={['item', 'itens']}
                />
                {fornecedores.ocultos > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    &quot;Outros&quot; agrupa {fornecedores.ocultos} fornecedores, {fmtBRL(fornecedores.valorOcultos)}.{' '}
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setVerTodosFornecedores(true)}>
                      ver todos
                    </Button>
                  </p>
                )}
                {verTodosFornecedores && fornecedores.barras.length > TOP_BARRAS && (
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setVerTodosFornecedores(false)}>
                    mostrar só os {TOP_BARRAS} maiores
                  </Button>
                )}
                {/* Uma barra sozinha não é erro — é o retrato de quem compra
                    numa loja só. Dizer isso evita a pergunta "quebrou?". */}
                {meta.fornecedoresDistintos === 1 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Todo o gasto do filtro atual está em um fornecedor só — por isso a barra única.
                    Ao importar extrato de outra loja, elas aparecem lado a lado aqui.
                  </p>
                )}
              </Secao>

              {/* ── 2. Gasto por produto ─────────────────────────────── */}
              <Secao
                titulo="Gasto por produto"
                ajuda="Qual insumo consumiu mais dinheiro, somando todas as compras do período."
              >
                <BarrasHorizontais
                  barras={barrasProduto}
                  totalGeral={meta.totalGeral}
                  palavraItem={['compra', 'compras']}
                />

                {produtos.ocultos > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    &quot;Outros&quot; agrupa {produtos.ocultos} produtos, {fmtBRL(produtos.valorOcultos)} —
                    nada foi descartado.{' '}
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setVerTodosProdutos(true)}>
                      ver todos
                    </Button>
                  </p>
                )}
                {verTodosProdutos && produtos.barras.length > TOP_BARRAS && (
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setVerTodosProdutos(false)}>
                    mostrar só os {TOP_BARRAS} maiores
                  </Button>
                )}

                {/* A conferência do achado 14: em vez de AFIRMAR que fecha,
                    a tela confere e avisa quando não fechar. */}
                {barrasNaoFecham ? (
                  <Aviso>
                    As barras somam {fmtBRL(somaBarrasProduto)}, mas o total do período é{' '}
                    {fmtBRL(meta.totalGeral)}. Alguma coisa ficou de fora do gráfico — não use
                    estes números até isso ser explicado.
                  </Aviso>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    A soma das barras fecha com o total do período: {fmtBRL(meta.totalGeral)}.
                  </p>
                )}

                {/* `valorSemProduto` está DENTRO deste gráfico, na barra
                    laranja — dizer "fora do gráfico" aqui seria falso. */}
                {meta.itensSemProduto > 0 && (
                  <Aviso>
                    {meta.itensSemProduto} {meta.itensSemProduto === 1 ? 'item está' : 'itens estão'} sem
                    nome de produto ({fmtBRL(meta.valorSemProduto)}) — é a barra laranja
                    &quot;{ROTULO_SEM_PRODUTO}&quot;. Preencha na tabela abaixo para eles entrarem
                    no gráfico de preço.
                  </Aviso>
                )}
              </Secao>

              {/* ── 3. Gasto por mês ─────────────────────────────────── */}
              <Secao
                titulo="Gasto por mês"
                ajuda="Quando o dinheiro saiu, pela data do documento. Mês sem compra aparece zerado, para a distância no eixo ser real."
              >
                <div className="overflow-x-auto">
                  <div style={{ minWidth: 360 }}>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={meses} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="rotulo" tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={fmtBRLCurto} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={60} />
                        <RechartsTooltip
                          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const m = payload[0].payload as { rotulo: string; total: number; itens: number }
                            return <CaixaTooltip titulo={m.rotulo} linhas={[fmtBRL(m.total), `${m.itens} ${m.itens === 1 ? 'item' : 'itens'}`]} />
                          }}
                        />
                        <Bar dataKey="total" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {meta.itensSemData > 0 && (
                  <Aviso>
                    {meta.itensSemData} {meta.itensSemData === 1 ? 'item' : 'itens'} sem data
                    ({fmtBRL(meta.valorSemData)}) <strong>fora deste gráfico</strong> — as barras somam
                    menos que o total do topo.
                  </Aviso>
                )}
              </Secao>

              {/* ── 4. Preço unitário no tempo ───────────────────────── */}
              <Secao
                titulo="Preço por unidade ao longo do tempo"
                ajuda="Média ponderada pela quantidade em cada mês — uma compra de 500 pesa mais que uma de 1. Só produtos comprados em 2 ou mais meses."
              >
                {series.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    Nenhum produto foi comprado em dois meses diferentes ainda — sem duas datas não há
                    linha de preço para desenhar.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <div style={{ minWidth: 420 }}>
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={dadosPreco} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="rotulo" tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                          {/* Eixo de PREÇO usa formatador próprio: com
                              `fmtBRLCurto`, produto de R$ 3,20 → R$ 3,80 tinha
                              ticks "0 1 2 3" e a subida de 19% sumia. */}
                          <YAxis tickFormatter={fmtPrecoCurto} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={64} />
                          <RechartsTooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null
                              const linhas = payload
                                .filter(p => p.value !== null && p.value !== undefined)
                                .map(p => `${p.name}: ${fmtBRL(Number(p.value))} /un`)
                              if (linhas.length === 0) return null
                              return <CaixaTooltip titulo={String(label)} linhas={linhas} />
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {series.map((s, i) => (
                            <Line
                              key={s.produto}
                              type="monotone"
                              dataKey={s.produto}
                              name={s.produto}
                              stroke={CORES[i % CORES.length]}
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              // Mês sem compra daquele produto fica NULO e a
                              // linha pula o buraco. `connectNulls` ligaria os
                              // pontos como se houvesse preço no meio — seria
                              // inventar dado.
                              connectNulls={false}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {seriesComUnidadeMisturada.length > 0 && (
                  <Aviso>
                    Unidade misturada em {seriesComUnidadeMisturada.join(', ')} — a média está
                    somando medidas diferentes, e o degrau na linha pode ser troca de unidade, não
                    mudança de preço.
                  </Aviso>
                )}

                {/* Achado 4: as duas peneiras do SQL (sem data / sem
                    quantidade) ficavam invisíveis aqui. */}
                {itensForaDoPreco > 0 && (
                  <Aviso>
                    {itensForaDoPreco} {itensForaDoPreco === 1 ? 'item' : 'itens'} ({fmtBRL(valorForaDoPreco)})
                    <strong> fora deste gráfico</strong> por não ter quantidade ou data — a linha de
                    preço não é o histórico completo do produto.
                  </Aviso>
                )}

                {/* Achado 5: a frase antiga dizia "mostrando os N de maior
                    gasto" mesmo quando ZERO linhas eram desenhadas, e
                    contradizia a linha logo acima. Agora as DUAS peneiras
                    aparecem numa frase só. */}
                <p className="text-xs text-muted-foreground mt-1">
                  Dos {meta.produtosDistintos} produtos do período, {meta.produtosNoPrecoTempo} entraram
                  na seleção de maior gasto e {series.length}{' '}
                  {series.length === 1 ? 'tem dois ou mais meses' : 'têm dois ou mais meses'} para desenhar linha
                  {seriesDeUmPonto > 0 && ` (${seriesDeUmPonto} ${seriesDeUmPonto === 1 ? 'ficou' : 'ficaram'} de fora por ter um mês só)`}.
                </p>
              </Secao>

              {/* O quinto gráfico do desenho. O texto diz a verdade de HOJE:
                  o backend está pronto, a TELA é que não existe (achado 7 —
                  a frase anterior prometia que ele "aparece" sozinho quando
                  houvesse dado, e nada apareceria). */}
              <p className="text-xs text-muted-foreground border-t pt-3">
                {meta.produtosComparaveis === 0
                  ? 'Falta o gráfico de preço do mesmo produto entre fornecedores: nenhum produto do período foi comprado de mais de uma loja, então não há o que comparar.'
                  : `${meta.produtosComparaveis} ${meta.produtosComparaveis === 1 ? 'produto foi comprado' : 'produtos foram comprados'} de mais de um fornecedor — dá para comparar preço entre lojas. O cálculo já existe na API; a tela desse gráfico ainda não foi construída.`}
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
