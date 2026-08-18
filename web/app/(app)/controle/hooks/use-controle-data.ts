'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type {
  DocumentoControle, FiltrosControle, ListaDocumentosControle, ResultadoGravarDocumento,
} from '@/lib/types'

export type FiltrosSelecionados = {
  fornecedores: string[]
  status: string[]
  dataInicio: string
  dataFim: string
}

const FILTROS_VAZIOS: FiltrosSelecionados = { fornecedores: [], status: [], dataInicio: '', dataFim: '' }
const POR_PAGINA = 20

// O que a próxima busca deve pedir. Página e filtros moram JUNTOS num estado só
// (em vez de dois `useState` separados) porque toda mudança de filtro também zera
// a página: em dois estados isso são duas atualizações, e o efeito de busca
// dispararia duas vezes — uma delas com a combinação inválida (filtro novo +
// página velha). `recarga` é um contador que só existe pra forçar uma busca nova
// quando página e filtros NÃO mudaram (caso do upload de um documento estando na
// página 1 sem filtro: sem o contador, nada no estado muda e a lista nunca
// recarregaria).
type Consulta = {
  pagina: number
  filtros: FiltrosSelecionados
  recarga: number
}

const CONSULTA_INICIAL: Consulta = { pagina: 1, filtros: FILTROS_VAZIOS, recarga: 0 }

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

export function useControleData() {
  const [documentos, setDocumentos] = useState<DocumentoControle[]>([])
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [totalDocumentos, setTotalDocumentos] = useState(0)
  const [consulta, setConsulta] = useState<Consulta>(CONSULTA_INICIAL)
  const [filtrosDisponiveis, setFiltrosDisponiveis] = useState<FiltrosControle>({ fornecedores: [], status: [] })
  const [loading, setLoading] = useState(true)
  // Separado de `loading`: a tela precisa distinguir "ainda não mostrei nada"
  // (aí um "Carregando..." no lugar da tabela é honesto) de "estou atualizando o
  // que já está na tela" (aí trocar a tabela por um texto DESMONTA o menu de
  // filtro aberto e torna a seleção múltipla impossível na prática).
  // Deliberadamente NÃO derivado de `documentos.length === 0`: um filtro que não
  // acha nada também deixa a lista vazia, e aí a tabela voltaria a desmontar a
  // cada clique — exatamente o bug que estamos consertando.
  const [jaCarregouUmaVez, setJaCarregouUmaVez] = useState(false)
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null)
  // Erro de AÇÃO do usuário (hoje só abrir PDF), separado do erro de carregamento
  // da lista: são coisas independentes e uma não deve apagar a outra.
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  // Só pra saber SE `consulta.filtros` mudou de identidade desde a última vez
  // que o efeito abaixo rodou — não o valor em si (comparar o array por
  // dentro não é necessário: `setPagina`/`recarregar`/upload/exclusão sempre
  // espalham `{ ...atual, campo }` preservando a MESMA referência de
  // `filtros` quando não é filtro que mudou; só `aplicarFiltros` e o reset
  // pós-upload criam um objeto novo). Inicializado com o valor do primeiro
  // render pra não contar a MONTAGEM como "filtro mudou".
  const filtrosAnteriores = useRef(consulta.filtros)

  useEffect(() => {
    // Guarda contra resposta atrasada: clicar dois filtros rápido dispara duas
    // buscas, e nada garante que a primeira responda primeiro. Sem esta trava, a
    // resposta velha chegaria por último e sobrescreveria a nova — a tela
    // mostraria o resultado de um filtro que o usuário já trocou.
    let cancelado = false
    setLoading(true)
    // Lista nova = contexto novo. A mensagem de "não deu pra abrir o PDF do
    // documento X" não faz mais sentido depois que o usuário troca o filtro (o
    // documento X pode nem estar mais na tela) — sem isto ela ficaria pendurada
    // no topo pra sempre.
    setErroAcao(null)

    // Achado do Apolo: o debounce abaixo estava se aplicando a QUALQUER
    // mudança de `consulta` — montagem, clique de página, upload, exclusão —
    // não só à seleção de filtro que motivou ele. Só clique de checkbox em
    // sequência (FiltroColuna) ou os campos de data precisam de 300ms de
    // espera; paginar ou recarregar depois de uma ação já são eventos
    // isolados (um clique = uma busca), atrasá-los sem motivo só deixa a
    // tela mais lenta pra abrir a próxima página ou confirmar um upload.
    const filtrosMudaram = filtrosAnteriores.current !== consulta.filtros
    filtrosAnteriores.current = consulta.filtros
    const espera = filtrosMudaram ? 300 : 0

    const timer = setTimeout(() => {
      if (cancelado) return
      api.get<ListaDocumentosControle>(`/controle/documentos?${montarQuery(consulta.pagina, consulta.filtros)}`)
        .then(resposta => {
          if (cancelado) return
          setDocumentos(resposta.documentos)
          setPaginaAtual(resposta.paginaAtual)
          setTotalPaginas(resposta.totalPaginas)
          setTotalDocumentos(resposta.totalDocumentos)
          setErroCarregamento(null)
        })
        .catch(() => {
          if (cancelado) return
          setErroCarregamento('Não foi possível carregar os documentos agora. Tente recarregar a página em instantes.')
        })
        .finally(() => {
          if (cancelado) return
          setJaCarregouUmaVez(true)
          setLoading(false)
        })
    }, espera)

    return () => { cancelado = true; clearTimeout(timer) }
  }, [consulta])

  // Valores de filtro (fornecedores/status) só precisam recarregar depois de um
  // upload novo — não a cada troca de página/filtro. Busca separada da lista.
  const recarregarFiltrosDisponiveis = useCallback(async () => {
    try {
      const resposta = await api.get<FiltrosControle>('/controle/documentos/filtros')
      setFiltrosDisponiveis(resposta)
    } catch {
      // Silencioso: sem os valores disponíveis, o menu de filtro fica sem opção
      // pra marcar — não impede o resto da tela de funcionar.
    }
  }, [])

  useEffect(() => { recarregarFiltrosDisponiveis() }, [recarregarFiltrosDisponiveis])

  const setPagina = useCallback((novaPagina: number) => {
    setConsulta(atual => ({ ...atual, pagina: novaPagina }))
  }, [])

  // Ao trocar qualquer filtro, volta pra página 1 — senão o usuário pode ficar
  // numa página que não existe mais dentro do resultado filtrado.
  const aplicarFiltros = useCallback((novos: FiltrosSelecionados) => {
    setConsulta(atual => ({ ...atual, filtros: novos, pagina: 1 }))
  }, [])

  const recarregar = useCallback(() => {
    setConsulta(atual => ({ ...atual, recarga: atual.recarga + 1 }))
  }, [])

  async function importarDocumento(pdf: File): Promise<ResultadoGravarDocumento> {
    const arquivo = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const resultado = reader.result as string
        // readAsDataURL devolve "data:application/pdf;base64,XXXX" — a API espera
        // só o base64 puro.
        resolve(resultado.split(',')[1] ?? '')
      }
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
      reader.readAsDataURL(pdf)
    })

    const resultado = await api.post<ResultadoGravarDocumento>('/controle/documentos', {
      arquivo,
      nomeArquivo: pdf.name,
    })

    if (resultado.status === 'gravado') {
      // LIMPA os filtros e volta pra página 1 antes de recarregar. Recarregar com
      // o filtro/página que estavam valendo faria o documento recém-importado não
      // aparecer em lugar nenhum (fornecedor fora do filtro ativo, ou o mais
      // recente indo pro topo da página 1 enquanto o usuário está na 3) — o
      // upload "daria certo" e a tela não mostraria nada, sem aviso. `recarga`
      // garante a busca nova mesmo quando já estávamos na página 1 sem filtro.
      setConsulta(atual => ({ pagina: 1, filtros: FILTROS_VAZIOS, recarga: atual.recarga + 1 }))
      await recarregarFiltrosDisponiveis()
    }
    return resultado
  }

  async function abrirPdf(documentoId: string) {
    setErroAcao(null)
    // window.open PRECISA acontecer de forma síncrona, dentro do gesto de clique —
    // se esperar a signed URL (await) pra só então abrir a aba, o Safari (e outros)
    // trata como pop-up fora de interação do usuário e bloqueia em silêncio, sem
    // erro nenhum. Por isso abre uma aba em branco JÁ e só depois navega ela pra
    // URL real. NÃO passar 'noopener'/'noreferrer' pro window.open: qualquer um dos
    // dois faz o método devolver null (é o próprio navegador cortando a referência
    // de volta), e sem a referência não tem como navegar a aba depois. Em vez disso,
    // zera `aba.opener` na própria referência logo em seguida — property gravável,
    // funciona fora do parâmetro noopener — e consegue as duas coisas ao mesmo
    // tempo: aba com referência utilizável E sem o vínculo de volta pra esta janela
    // (evita a aba nova conseguir redirecionar esta página via window.opener).
    const aba = window.open('', '_blank')
    if (aba) aba.opener = null
    try {
      const { url } = await api.get<{ url: string }>(`/controle/documentos/${documentoId}/arquivo`)
      if (aba) aba.location.href = url
    } catch (err) {
      // Fecha a aba em branco e conta o motivo NA TELA. Antes isto relançava o
      // erro: quem chamava não tratava a Promise, a aba piscava e sumia, e o
      // usuário ficava sem nenhuma pista (404 de documento apagado, 500 do
      // Storage, queda de rede — tudo virava "não aconteceu nada").
      // `err.message` já vem em português: web/lib/api.ts repassa o campo `error`
      // que a API manda.
      aba?.close()
      setErroAcao(err instanceof Error ? err.message : 'Não foi possível abrir o PDF agora.')
    }
  }

  // Lança em vez de devolver um resultado tipado (como `importarDocumento`):
  // quem chama é o diálogo de confirmação em TabelaDocumentos, que precisa
  // ficar ABERTO mostrando o motivo se der erro (mesmo padrão do
  // confirmarDeleteOp de operacoes/page.tsx) — um catch local resolve isso
  // sem precisar de mais um par de estado aqui no hook.
  async function excluirDocumento(documentoId: string): Promise<void> {
    try {
      await api.del(`/controle/documentos/${documentoId}`)
    } catch (err) {
      // Achado do Apolo: falha parcial no servidor pode ter apagado os ITENS
      // mesmo com o DELETE inteiro devolvendo erro (o documento sobrevive
      // marcado 'erro' — ver excluirDocumentoControle.ts). Sem recarregar
      // aqui, a tabela continuaria mostrando itens que já não existem mais no
      // banco. Recarrega a MESMA página (sem o ajuste de "página ficou
      // vazia" do caminho de sucesso, abaixo — não se aplica aqui: o
      // documento não sumiu, só entrou em erro) e relança pro diálogo de
      // confirmação (TabelaDocumentos) mostrar o motivo.
      setConsulta(atual => ({ ...atual, recarga: atual.recarga + 1 }))
      throw err
    }

    // Página atual pode ter ficado sem nenhum documento (era o último item
    // dela) — sem este ajuste, recarregar com a mesma página mostraria
    // "nenhum documento encontrado" de forma enganosa quando na verdade
    // existem documentos, só não NESTA página. Só recua se não for a
    // primeira página (a primeira pode legitimamente ficar vazia).
    setConsulta(atual => ({
      ...atual,
      pagina: documentos.length === 1 && atual.pagina > 1 ? atual.pagina - 1 : atual.pagina,
      recarga: atual.recarga + 1,
    }))
    // Documento excluído pode ter sido o ÚLTIMO daquele fornecedor — sem
    // recarregar os filtros disponíveis, o menu continuaria oferecendo uma
    // opção que não acha mais nada.
    await recarregarFiltrosDisponiveis()
  }

  return {
    documentos, paginaAtual, totalPaginas, totalDocumentos,
    pagina: consulta.pagina, setPagina,
    filtros: consulta.filtros, aplicarFiltros, filtrosDisponiveis,
    loading,
    // "Ainda não mostrei nada" — único caso em que vale trocar a tabela por um
    // texto de carregamento.
    primeiraCarga: loading && !jaCarregouUmaVez,
    erroCarregamento, erroAcao, setErroAcao, recarregar,
    importarDocumento, abrirPdf, excluirDocumento,
  }
}
