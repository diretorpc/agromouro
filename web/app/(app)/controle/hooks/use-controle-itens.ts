'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ehErroDeValidacao } from '@/lib/api'
import type {
  ItemControleFlat, FiltrosControle, ListaItensControle, PatchItemControleFlat, ResultadoGravarDocumento,
} from '@/lib/types'

// Hook da GRADE editável estilo Excel (decisão do Matheus, 18/08/2026) —
// substitui `use-controle-data.ts` (que continua no repo, sem uso, até
// decisão de limpar). Diferenças de propósito em relação ao antigo:
// (1) lista FLAT (item a item, não agrupada por documento) — consome
// GET /controle/itens, não GET /controle/documentos; (2) sem paginação por
// clique — "carregar mais" cresce a lista carregada, a grade virtualizada
// mostra tudo de uma vez; (3) ganha editarItem/criarItem/excluirItem, que o
// hook antigo nunca precisou ter.
// Ver desenho completo: docs/superpowers/specs/2026-08-18-controle-tabela-
// editavel-design.md.

export type FiltrosSelecionados = {
  fornecedores: string[]
  status: string[]
  dataInicio: string
  dataFim: string
}

const FILTROS_VAZIOS: FiltrosSelecionados = { fornecedores: [], status: [], dataInicio: '', dataFim: '' }
const POR_PAGINA = 500

// Janela de "Desfazer" antes do DELETE de item sair de verdade — decisão do
// Matheus, 18/08/2026 (achado 4 da revisão do Apolo, 5ª rodada): Delete de
// linha inteira virou 1 tecla só (ver grade-itens.tsx/deletar-linha.ts) e a
// biblioteca não tem undo nenhum — sem essa rede, apagar sem querer é
// definitivo na hora.
const EXCLUSAO_JANELA_MS = 7000

// Uma exclusão de ITEM ainda dentro da janela de desfazer. `indiceOriginal`
// existe pra devolver a linha no MESMO lugar se o Matheus clicar
// "Desfazer" ou se o DELETE falhar depois da janela expirar (achado 6 da
// mesma revisão — antes a linha reaparecia jogada no rodapé da grade).
type ExclusaoPendente = { id: string; item: ItemControleFlat; indiceOriginal: number }

function montarQuery(pagina: number, filtros: FiltrosSelecionados): string {
  const params = new URLSearchParams()
  params.set('pagina', String(pagina))
  params.set('porPagina', String(POR_PAGINA))
  filtros.fornecedores.forEach(f => params.append('fornecedor', f))
  filtros.status.forEach(s => params.append('status', s))
  if (filtros.dataInicio) params.set('dataInicio', filtros.dataInicio)
  if (filtros.dataFim) params.set('dataFim', filtros.dataFim)
  return params.toString()
}

export function useControleItens() {
  const [itens, setItens] = useState<ItemControleFlat[]>([])
  const [paginaCarregada, setPaginaCarregada] = useState(0)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [totalItens, setTotalItens] = useState(0)
  const [filtros, setFiltros] = useState<FiltrosSelecionados>(FILTROS_VAZIOS)
  const [filtrosDisponiveis, setFiltrosDisponiveis] = useState<FiltrosControle>({ fornecedores: [], status: [] })
  const [loading, setLoading] = useState(true)
  const [carregandoMais, setCarregandoMais] = useState(false)
  // Mesmo motivo de use-controle-data.ts: "ainda não mostrei nada" (troca a
  // grade por um texto) é diferente de "atualizando o que já está na tela"
  // (a grade fica montada — trocar por texto perderia célula em edição,
  // seleção, e o menu de filtro aberto).
  const [jaCarregouUmaVez, setJaCarregouUmaVez] = useState(false)
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null)
  // Erro de AÇÃO (editar/criar/excluir/abrir PDF) — separado do erro de
  // carregamento da lista, mesmo padrão do hook antigo.
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  // Exclusões de ITEM ainda dentro da janela de desfazer (~7s) — array
  // (não Map) de propósito: precisa de ORDEM estável pra o banner de
  // "Desfazer" empilhar de forma previsível quando o Matheus apaga 2+
  // linhas seguidas (a fila aguenta qualquer quantidade — cada entrada tem
  // seu próprio timer independente, ver `timersExclusaoRef`).
  const [exclusoesPendentes, setExclusoesPendentes] = useState<ExclusaoPendente[]>([])
  const timersExclusaoRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Avisa ANTES de sair da página enquanto existe exclusão pendente — o
  // temporizador do "Desfazer" é só estado do navegador (setTimeout);
  // fechar a aba/recarregar com o prazo correndo CANCELA a exclusão
  // (comportamento decidido, ver `excluirItem`) sem apagar nada, mas o
  // Matheus pode não esperar isso. Só assina o listener enquanto há pelo
  // menos 1 pendente — barato, e o navegador ignora `beforeunload` sem
  // gesto de usuário prévio na aba de qualquer forma (comportamento padrão,
  // nada a fazer aqui).
  useEffect(() => {
    if (exclusoesPendentes.length === 0) return
    function avisarAntesDeSair(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avisarAntesDeSair)
    return () => window.removeEventListener('beforeunload', avisarAntesDeSair)
  }, [exclusoesPendentes.length])

  // Navegação INTERNA do Next (clicar noutro item do menu) desmonta este hook
  // sem passar por `beforeunload` — numa SPA o `setTimeout` sobreviveria ao
  // desmonte e o DELETE sairia depois, contrariando o que o comentário acima
  // promete. Pior: voltando pra /controle dentro do prazo, a nova instância
  // busca do servidor, a linha ainda existe e aparece na tela — e então o
  // timer órfão da instância antiga a apaga no banco. A tela passa a mostrar
  // linha que não existe mais, e editá-la devolve 404 (que não é erro de
  // validação, então dispara `recarregar()` e ela some sem explicação).
  // Limpar no desmonte alinha código e comentário no lado seguro: na dúvida,
  // NÃO apaga. Achado [médio] da 5ª revisão do Apolo.
  useEffect(() => {
    const timers = timersExclusaoRef.current
    return () => {
      for (const timerPendente of timers.values()) clearTimeout(timerPendente)
      timers.clear()
    }
  }, [])

  const filtrosAnteriores = useRef(filtros)
  const [recarga, setRecarga] = useState(0)
  // Sobe a cada carga NOVA e completa da página 1 (mudança de filtro, ou
  // `recarga` forçada) — nunca em "carregar mais" (que só ACRESCENTA linhas,
  // sem descartar edição local em andamento). `GradeItens` usa isto como
  // `key` (page.tsx) pra se REMONTAR inteira toda vez que os dados vêm
  // frescos do servidor — descarta de propósito qualquer timer de
  // autosave/patch acumulado/baseline de diff que a grade tivesse em voo,
  // porque nesse momento o servidor É a verdade nova. Ver achado 2 da
  // revisão do Apolo (18/08/2026): sem um jeito de invalidar esse estado
  // interno em bloco, a grade podia comparar contra uma baseline velha
  // depois de um recarregamento silencioso.
  const [versaoDados, setVersaoDados] = useState(0)

  useEffect(() => {
    let cancelado = false
    setLoading(true)
    setErroAcao(null)

    // Mesmo cuidado do hook antigo (achado do Apolo, 18/08): debounce só
    // quando o FILTRO muda de identidade — recarga forçada (upload,
    // exclusão) dispara na hora.
    const filtrosMudaram = filtrosAnteriores.current !== filtros
    filtrosAnteriores.current = filtros
    const espera = filtrosMudaram ? 300 : 0

    const timer = setTimeout(() => {
      if (cancelado) return
      api.get<ListaItensControle>(`/controle/itens?${montarQuery(1, filtros)}`)
        .then(resposta => {
          if (cancelado) return
          // Cancela qualquer exclusão de ITEM ainda pendente (dentro da
          // janela de "Desfazer") — um reload COMPLETO como este já traz a
          // verdade fresca do servidor, que ainda TEM a linha (o DELETE de
          // verdade só sai quando o temporizador vence, ver `excluirItem`).
          // Sem isto, o temporizador continuaria correndo sozinho e
          // apagaria uma linha que acabou de REAPARECER na tela sem o
          // Matheus ter feito nada — o mesmo raciocínio de "servidor É a
          // verdade nova" que já vale pra `versaoDados` (achado 2 da
          // revisão anterior), aplicado à fila de exclusão.
          for (const timerPendente of timersExclusaoRef.current.values()) clearTimeout(timerPendente)
          timersExclusaoRef.current.clear()
          setExclusoesPendentes([])
          setItens(resposta.itens)
          setPaginaCarregada(resposta.paginaAtual)
          setTotalPaginas(resposta.totalPaginas)
          setTotalItens(resposta.totalItens)
          setErroCarregamento(null)
          setVersaoDados(v => v + 1)
        })
        .catch(() => {
          if (cancelado) return
          setErroCarregamento('Não foi possível carregar os itens agora. Tente recarregar a página em instantes.')
        })
        .finally(() => {
          if (cancelado) return
          setJaCarregouUmaVez(true)
          setLoading(false)
        })
    }, espera)

    return () => { cancelado = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros, recarga])

  const recarregarFiltrosDisponiveis = useCallback(async () => {
    try {
      const resposta = await api.get<FiltrosControle>('/controle/documentos/filtros')
      setFiltrosDisponiveis(resposta)
    } catch {
      // Silencioso — mesmo motivo do hook antigo: sem os valores, o menu
      // fica sem opção pra marcar, não impede o resto da tela.
    }
  }, [])

  useEffect(() => { recarregarFiltrosDisponiveis() }, [recarregarFiltrosDisponiveis])

  const aplicarFiltros = useCallback((novos: FiltrosSelecionados) => {
    setFiltros(novos)
  }, [])

  const recarregar = useCallback(() => { setRecarga(r => r + 1) }, [])

  // "Carregar mais" — decisão de desenho: Excel não pagina por clique, mas o
  // BACKEND ainda entrega em lotes (porPagina=500, teto do PostgREST). Busca
  // a próxima página e ACRESCENTA ao que já está na tela (não substitui) —
  // ver spec, "Decisão nova 3".
  const carregarMais = useCallback(async () => {
    if (carregandoMais || paginaCarregada >= totalPaginas) return
    setCarregandoMais(true)
    try {
      const resposta = await api.get<ListaItensControle>(`/controle/itens?${montarQuery(paginaCarregada + 1, filtros)}`)
      setItens(atual => [...atual, ...resposta.itens])
      setPaginaCarregada(resposta.paginaAtual)
      setTotalPaginas(resposta.totalPaginas)
      setTotalItens(resposta.totalItens)
    } catch {
      setErroAcao('Não foi possível carregar mais itens agora. Role a grade de novo para tentar.')
    } finally {
      setCarregandoMais(false)
    }
  }, [carregandoMais, paginaCarregada, totalPaginas, filtros])

  // Substitui um item no estado local — usado por editarItem/criarItem
  // (sucesso) e pelas reversões otimistas (falha). Fonte única, pra não
  // duplicar a lógica de "achar pelo id e trocar" em 3 lugares.
  const substituirItem = useCallback((id: string, novo: ItemControleFlat | null) => {
    setItens(atual => novo ? atual.map(i => (i.id === id ? novo : i)) : atual.filter(i => i.id !== id))
  }, [])

  // Atualiza o estado local IMEDIATAMENTE (otimista, decisão nº 4 — "salva
  // sozinho") — chamado pela grade a cada onChange, antes de qualquer
  // chamada de rede. `editarItem`/`criarItem`/`excluirItem` (abaixo) tratam
  // só a PERSISTÊNCIA — a grade já mostrou a mudança.
  const atualizarLocal = useCallback((novos: ItemControleFlat[]) => {
    setItens(novos)
  }, [])

  // Devolve o item ATUALIZADO (não `void`) — achado 2 da revisão do Apolo:
  // `GradeItens` precisa do valor que o SERVIDOR confirmou pra reancorar a
  // baseline de diff daquela linha (sem isso, a próxima edição comparava
  // contra o estado local já otimista, e uma edição feita enquanto o PATCH
  // anterior ainda estava em voo desaparecia do próximo diff).
  async function editarItem(id: string, patch: PatchItemControleFlat): Promise<ItemControleFlat> {
    try {
      const atualizado = await api.patch<ItemControleFlat>(`/controle/itens/${id}`, patch)
      substituirItem(id, atualizado)
      // Achado 4 da revisão do Apolo (18/08/2026, 3ª rodada): sem isto, uma
      // mensagem de erro de uma tentativa ANTERIOR (numa linha diferente ou
      // na mesma, já corrigida) ficava pendurada no topo da tela pra
      // sempre — antes o `recarregar()` limpava por tabela (o efeito de
      // carga zera `erroAcao` no início); agora que ele não dispara mais
      // pra todo erro, o sucesso precisa limpar por conta própria.
      setErroAcao(null)
      return atualizado
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : 'Não foi possível salvar a edição.')

      // Bug relatado pelo Matheus, 18/08/2026: apagar a descrição de uma
      // célula (Delete) mandava `PATCH {descricao: null}`, o zod recusava
      // (400), e este `catch` chamava `recarregar()` incondicionalmente —
      // que remonta a grade INTEIRA (key ligada a `versaoDados`) e desfaz
      // TUDO que estivesse sendo digitado em qualquer outra célula, não só
      // a que falhou. Parecia a tela "travando e voltando sozinha".
      //
      // Correção: só recarrega em falha de REDE ou erro do SERVIDOR (5xx) —
      // aí sim o estado local pode estar mentindo (a grade já mostrou a
      // edição otimista, sem confirmação nenhuma de que o banco recebeu).
      // Erro de VALIDAÇÃO — hoje só 400 (corpo recusado pelo zod) e 409
      // (conflito de duplicidade); `ehErroDeValidacao` restringiu a essa
      // dupla na revisão seguinte (401/403/404 recarregam, não são "campo
      // inválido, tente de novo") — é uma resposta CONCLUÍDA do servidor:
      // `GradeItens` REVERTE a linha que falhou pro último valor
      // confirmado E marca ela (achado 2 da revisão do Apolo, 18/08/2026,
      // 4ª rodada — reverter sem marcar deixava a tela sem explicação
      // nenhuma do que aconteceu) — as outras edições em andamento na
      // grade continuam intactas. `ehErroDeValidacao` é função pura,
      // exportada de lib/api.ts, testada em `lib/api.test.ts`.
      if (!ehErroDeValidacao(err)) {
        // `recarregar()` também bate `versaoDados`, que remonta a grade
        // inteira — qualquer timer/patch pendente que ainda existisse é
        // descartado junto (correto aqui: a falha é de infraestrutura, não
        // sabemos mais o que o banco realmente tem).
        recarregar()
      }
      throw err
    }
  }

  async function criarItem(
    dados: PatchItemControleFlat & { descricao: string; valor_total: number },
    idTemporario: string,
  ): Promise<ItemControleFlat> {
    try {
      const criado = await api.post<ItemControleFlat>('/controle/itens', dados)
      substituirItem(idTemporario, criado)
      return criado
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : 'Não foi possível criar a linha.')
      // Achado 7 da revisão do Apolo: NÃO apaga a linha otimista mais —
      // sumir sem aviso é pior que ficar visível marcada com erro (o
      // Matheus perdia o que tinha digitado, sem saber que perdeu). A linha
      // continua no estado local, ainda com id temporário; `GradeItens`
      // marca visualmente ("rascunho com erro") e tenta de novo na próxima
      // edição daquela linha, ou o Matheus apaga manualmente.
      throw err
    }
  }

  // Traz de volta a exclusão de DOCUMENTO inteiro — achado 3 da revisão do
  // Apolo (regressão): a tela nova (grade flat) nunca ganhou um jeito de
  // apagar um documento importado errado. Sem isso, `idx_doc_controle_dedupe`/
  // `idx_doc_controle_hash` (migration 017) continuam bloqueando pra sempre
  // e reimportar o MESMO extrato fica impossível. Mesmo endpoint de sempre
  // (`DELETE /controle/documentos/:id`) — só o "depois" muda: em vez de
  // recuar página, força recarga completa (a grade é flat agora, não há
  // "página" no sentido antigo).
  async function excluirDocumento(documentoId: string): Promise<void> {
    try {
      await api.del(`/controle/documentos/${documentoId}`)
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : 'Não foi possível excluir o documento agora.')
      // Falha parcial no servidor pode ter apagado ITENS mesmo com o DELETE
      // inteiro devolvendo erro (o documento sobrevive marcado 'erro' — ver
      // excluirDocumentoControle.ts) — recarrega pra não deixar a grade
      // mostrando item que já não existe mais no banco.
      recarregar()
      throw err
    }
    recarregar()
    // Documento excluído pode ter sido o ÚLTIMO daquele fornecedor/status —
    // sem recarregar os filtros disponíveis, o menu continuaria oferecendo
    // uma opção que não acha mais nada.
    await recarregarFiltrosDisponiveis()
  }

  // Upload de PDF continua igual ao hook antigo (mesmo endpoint, mesmo
  // componente `DialogoImportar` — o pedido de tabela editável não mudou
  // COMO o documento entra no sistema, só como o item já gravado é EDITADO
  // depois). Limpa filtro + força recarga da página 1: reaproveita o mesmo
  // raciocínio do hook antigo (documento novo pode ficar escondido atrás de
  // um filtro ativo ou fora da primeira leva carregada).
  async function importarDocumento(pdf: File): Promise<ResultadoGravarDocumento> {
    const arquivo = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
      reader.readAsDataURL(pdf)
    })

    const resultado = await api.post<ResultadoGravarDocumento>('/controle/documentos', {
      arquivo,
      nomeArquivo: pdf.name,
    })

    if (resultado.status === 'gravado') {
      setFiltros(FILTROS_VAZIOS)
      setRecarga(r => r + 1)
      await recarregarFiltrosDisponiveis()
    }
    return resultado
  }

  // Mesmo mecanismo de use-controle-data.ts (`abrirPdf`) — reaproveitado
  // aqui porque o botão "PDF" da grade continua abrindo o documento de
  // ORIGEM (não existe mais um "Total do PDF" por bloco, ver spec, mas o
  // link pro PDF original continua). Comentário completo do porquê do
  // `window.open('', '_blank')` síncrono está no hook antigo — não repetido
  // aqui, mesma lógica, char por char.
  async function abrirPdf(documentoId: string) {
    setErroAcao(null)
    const aba = window.open('', '_blank')
    if (aba) aba.opener = null
    try {
      const { url } = await api.get<{ url: string }>(`/controle/documentos/${documentoId}/arquivo`)
      if (aba) aba.location.href = url
    } catch (err) {
      aba?.close()
      setErroAcao(err instanceof Error ? err.message : 'Não foi possível abrir o PDF agora.')
    }
  }

  // Devolve a linha removida na posição ORIGINAL, não no fim da lista —
  // achado 6 da revisão do Apolo (18/08/2026, 5ª rodada): `[...atual,
  // backup]` (antes) sempre jogava a linha reaparecida pro RODAPÉ da
  // grade, fora de ordem. `Math.min(indice, copia.length)` cobre o caso
  // (raro, mas possível) de a lista ter ficado mais curta que o índice
  // original enquanto a linha estava fora (outra exclusão no meio) — sem
  // isso, `splice` num índice além do fim simplesmente anexaria no fim de
  // qualquer forma, mas o `Math.min` deixa a intenção explícita.
  function reinserirNaPosicao(item: ItemControleFlat, indiceOriginal: number) {
    setItens(atual => {
      const copia = [...atual]
      copia.splice(Math.min(indiceOriginal, copia.length), 0, item)
      return copia
    })
  }

  async function excluirItem(id: string): Promise<void> {
    const indiceOriginal = itens.findIndex(i => i.id === id)
    const item = indiceOriginal >= 0 ? itens[indiceOriginal] : undefined
    if (!item) return

    substituirItem(id, null) // otimista: some da tela na hora, como sempre

    // Achado 4 da revisão do Apolo (18/08/2026, 5ª rodada) — decisão do
    // Matheus, tomada com o risco na mão: exclusão de ITEM ganha janela de
    // ~7s pra desfazer. Diferente de antes (DELETE saía na hora), o
    // `api.del` só é chamado quando o temporizador vence — se o Matheus
    // clicar "Desfazer" antes disso, a linha volta pro lugar e NENHUM
    // DELETE chega a sair da rede.
    //
    // Comportamento decidido pra "sair da página/recarregar com o prazo
    // correndo" (pergunta explícita do Apolo): o temporizador é estado só
    // do NAVEGADOR (setTimeout) — fechar a aba ou dar F5 o mata sem
    // rodar. Resultado: a exclusão é CANCELADA automaticamente, a linha
    // sobrevive no banco e REAPARECE no próximo carregamento. É a direção
    // SEGURA por padrão (falhar fechado — perder o estado do timer nunca
    // apaga dado, só cancela a exclusão); a alternativa (persistir
    // "exclusão pendente" em localStorage pra sobreviver a um F5) foi
    // considerada e descartada por complexidade desproporcional ao risco
    // — o aviso de `beforeunload` abaixo avisa ANTES de sair, então a
    // perda de INTENÇÃO (não a perda de DADO) é o único custo, e fica
    // visível pro usuário antes de acontecer.
    setExclusoesPendentes(atual => [...atual, { id, item, indiceOriginal }])

    const timer = setTimeout(() => {
      timersExclusaoRef.current.delete(id)
      setExclusoesPendentes(atual => atual.filter(p => p.id !== id))
      api.del(`/controle/itens/${id}`).catch(err => {
        setErroAcao(err instanceof Error ? err.message : 'Não foi possível excluir o item.')
        // Falha de rede/servidor DEPOIS da janela expirar — devolve a
        // linha, mesma posição de origem.
        reinserirNaPosicao(item, indiceOriginal)
      })
    }, EXCLUSAO_JANELA_MS)
    timersExclusaoRef.current.set(id, timer)
  }

  // Cancela o DELETE agendado (se ainda não tiver saído) e devolve a linha
  // pra posição original. Chamado pelo clique em "Desfazer" — ver
  // `exclusoesPendentes`/o banner em page.tsx.
  function desfazerExclusao(id: string) {
    const timer = timersExclusaoRef.current.get(id)
    if (!timer) return // já expirou (DELETE já saiu) ou já foi desfeita antes
    clearTimeout(timer)
    timersExclusaoRef.current.delete(id)

    const pendente = exclusoesPendentes.find(p => p.id === id)
    setExclusoesPendentes(atual => atual.filter(p => p.id !== id))
    if (pendente) reinserirNaPosicao(pendente.item, pendente.indiceOriginal)
  }

  return {
    itens, atualizarLocal, versaoDados,
    totalItens, temMais: paginaCarregada < totalPaginas, carregarMais, carregandoMais,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading,
    primeiraCarga: loading && !jaCarregouUmaVez,
    erroCarregamento, erroAcao, setErroAcao, recarregar,
    editarItem, criarItem, excluirItem, excluirDocumento, abrirPdf, importarDocumento,
    // Exposto pra GradeItens conseguir REVERTER uma linha específica pro
    // último valor confirmado, sem remontar a grade inteira — achado 1 da
    // revisão do Apolo (18/08/2026, 3ª rodada). Ver `dispararSalvar` em
    // grade-itens.tsx.
    substituirItem,
    // Janela de "Desfazer" da exclusão de item — achado 4 da revisão do
    // Apolo (18/08/2026, 5ª rodada). `page.tsx` desenha o banner em cima
    // disto.
    exclusoesPendentes, desfazerExclusao,
  }
}
