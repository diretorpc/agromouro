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
      // Erro de VALIDAÇÃO (4xx — campo inválido, conflito de duplicidade)
      // é uma resposta CONCLUÍDA do servidor: a linha que falhou fica
      // marcada (GradeItens cuida disso, achado 7 do mesmo espírito) e as
      // outras edições em andamento na grade continuam intactas.
      // `ehErroDeValidacao` é função pura, exportada de lib/api.ts —
      // testada isolada (ver comando no ESTADO.md/relatório da sessão).
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

  async function excluirItem(id: string): Promise<void> {
    const backup = itens.find(i => i.id === id) ?? null
    substituirItem(id, null) // otimista: some da tela na hora
    try {
      await api.del(`/controle/itens/${id}`)
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : 'Não foi possível excluir o item.')
      // Devolve a linha removida otimisticamente — falha real, o item
      // continua existindo no banco.
      if (backup) setItens(atual => [...atual, backup])
      throw err
    }
  }

  return {
    itens, atualizarLocal, versaoDados,
    totalItens, temMais: paginaCarregada < totalPaginas, carregarMais, carregandoMais,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading,
    primeiraCarga: loading && !jaCarregouUmaVez,
    erroCarregamento, erroAcao, setErroAcao, recarregar,
    editarItem, criarItem, excluirItem, excluirDocumento, abrirPdf, importarDocumento,
  }
}
