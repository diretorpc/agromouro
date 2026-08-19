'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { GraficosControlePayload } from '@/lib/types'
import type { FiltrosSelecionados } from './use-controle-itens'

// Hook dos gráficos da aba Controle — consome GET /controle/graficos.
// Desenho: docs/superpowers/specs/2026-08-19-controle-graficos-design.md
//
// ⚠️ RECEBE os filtros por parâmetro, NÃO tem estado de filtro próprio.
// É a regra que impede o defeito mais feio possível nesta tela: gráfico em
// cima, grade embaixo, mesmo painel de filtro, números diferentes. Um
// segundo `useState` de filtro aqui divergiria do da grade em algum caminho
// (ordem de render, debounce, recarga forçada) e ninguém saberia qual metade
// da tela está certa. A grade é dona do filtro; o gráfico só obedece.
//
// ⚠️ TAMBÉM NÃO SOMA NADA. Todo total vem pronto do banco (função
// `controle_graficos`, migration 020) — a grade tem só 500 itens carregados,
// e somar isso no navegador mostraria o pedaço parecendo o todo.

// Mesmo debounce da grade (`use-controle-itens.ts`): 300 ms SÓ quando o
// filtro muda de identidade. Montagem e recarga forçada disparam na hora.
// Sem isto, digitar uma data faria os dois hooks dispararem rajadas
// independentes de chamada — chamada repetida em filtro já foi bug real
// nesta tela (PR #61).
const DEBOUNCE_FILTRO_MS = 300

// Espera MAIOR depois de uma edição confirmada. A grade tem autosave: corrigir
// uma linha inteira célula a célula confirma vários PATCHes seguidos, e cada
// um bate o contador. Sem esta folga, sairia uma agregação por célula — e
// agregação aqui é `GROUP BY` sobre a fazenda inteira, não sobre a página.
// O cleanup do efeito cancela o timer anterior, então uma sequência de
// edições rápidas colapsa numa chamada só, ~1 s depois da última.
const DEBOUNCE_MUTACAO_MS = 1000

// Quantos produtos as séries de preço (gráficos 4 e 5) trazem. O servidor
// recusa acima de 50; `meta.produtosDistintos` diz quantos existem ao todo,
// pra legenda poder dizer "10 de 37" em vez de fingir que cobriu tudo.
const TOP_PRODUTOS = 10

function montarQuery(filtros: FiltrosSelecionados): string {
  const params = new URLSearchParams()
  filtros.fornecedores.forEach(f => params.append('fornecedor', f))
  filtros.status.forEach(s => params.append('status', s))
  if (filtros.dataInicio) params.set('dataInicio', filtros.dataInicio)
  if (filtros.dataFim) params.set('dataFim', filtros.dataFim)
  params.set('top', String(TOP_PRODUTOS))
  return params.toString()
}

// ⚠️ O segundo parâmetro é `versaoNumeros` (contador de MUTAÇÃO CONFIRMADA),
// NÃO `versaoDados`. A diferença é o conserto de 19/08/2026, decisão "b" do
// Matheus depois de o Apolo classificar como CRÍTICO:
//   - `versaoDados` sobe na carga da página 1 (montagem, filtro, recarga) e
//     NÃO sobe em edição de célula → o gráfico ficava mostrando número velho
//     ao lado da tabela já corrigida, indefinidamente.
//   - `versaoNumeros` sobe SÓ quando o servidor confirma uma mudança de dado
//     (editar, criar, excluir item, excluir/importar documento) → o gráfico
//     segue a tabela, e uma troca de filtro dispara UMA agregação, não duas
//     (era o achado 5 da revisão).
export function useControleGraficos(filtros: FiltrosSelecionados, versaoNumeros: number) {
  const [dados, setDados] = useState<GraficosControlePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // Achado 4 da revisão do Apolo: quando a busca falha, os dados ANTIGOS
  // continuam na tela de propósito (piscar pra vazio é pior) — mas então eles
  // não correspondem mais ao filtro que a grade está mostrando. Sem este
  // sinal, a tela exibe "R$ 1.406.915,25" ao lado de uma tabela filtrada em
  // julho, com uma faixa de erro em cima que não diz que os números são de
  // outro filtro.
  const [desatualizado, setDesatualizado] = useState(false)
  // Achado 6: `useRef(filtros)`, NÃO `useRef(null)`. A grade
  // (`use-controle-itens.ts`) inicializa com o filtro atual, então na
  // primeira execução ela calcula `filtrosMudaram = false` e dispara na hora.
  // Com `null`, este hook calculava `true` e esperava 300 ms — os dois
  // deixavam de estar em fase logo na abertura da tela.
  const filtrosAnteriores = useRef<FiltrosSelecionados>(filtros)
  const versaoAnterior = useRef(versaoNumeros)

  useEffect(() => {
    let cancelado = false
    setLoading(true)

    // Na MONTAGEM os dois refs já nascem com os valores atuais, então nada
    // "mudou" e a espera é 0 — o gráfico aparece junto com a grade, sem
    // atraso artificial. Uma chamada por abertura de tela (medido com
    // `performance.getEntriesByType`).
    const filtrosMudaram = filtrosAnteriores.current !== filtros
    const houveMutacao   = versaoAnterior.current !== versaoNumeros
    filtrosAnteriores.current = filtros
    versaoAnterior.current = versaoNumeros

    // Mutação tem precedência sobre filtro: editar em rajada é o caso que
    // mais precisa de folga, e o cleanup abaixo cancela o timer pendente, de
    // modo que N edições seguidas viram UMA agregação.
    const espera = houveMutacao ? DEBOUNCE_MUTACAO_MS
      : filtrosMudaram ? DEBOUNCE_FILTRO_MS
      : 0

    const timer = setTimeout(() => {
      if (cancelado) return
      api.get<GraficosControlePayload>(`/controle/graficos?${montarQuery(filtros)}`)
        .then(resposta => {
          if (cancelado) return
          setDados(resposta)
          setErro(null)
          setDesatualizado(false)
        })
        .catch(() => {
          if (cancelado) return
          // NÃO zera `dados`: manter o gráfico anterior na tela enquanto o
          // erro aparece é melhor que piscar pra vazio. Mas o erro TEM que
          // aparecer — 500 aqui é migration 020 não aplicada, e um gráfico
          // vazio silencioso pareceria "não tenho gasto".
          //
          // E `desatualizado` é obrigatório junto: sem ele, o número que
          // ficou na tela é de OUTRO filtro e nada diz isso. O componente usa
          // este sinal pra escrever, em letras, que os números não conferem
          // com a tabela abaixo.
          setErro('Não foi possível carregar os gráficos agora.')
          setDesatualizado(true)
        })
        .finally(() => {
          if (cancelado) return
          setLoading(false)
        })
    }, espera)

    return () => { cancelado = true; clearTimeout(timer) }
  }, [filtros, versaoNumeros])

  return { dados, loading, erro, desatualizado, primeiraCarga: loading && dados === null }
}
