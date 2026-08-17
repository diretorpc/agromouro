'use client'

import { useCallback, useEffect, useState } from 'react'
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
  const [pagina, setPagina] = useState(1)
  const [filtros, setFiltros] = useState<FiltrosSelecionados>(FILTROS_VAZIOS)
  const [filtrosDisponiveis, setFiltrosDisponiveis] = useState<FiltrosControle>({ fornecedores: [], status: [] })
  const [loading, setLoading] = useState(true)
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null)

  const recarregar = useCallback(async () => {
    setLoading(true)
    try {
      const resposta = await api.get<ListaDocumentosControle>(`/controle/documentos?${montarQuery(pagina, filtros)}`)
      setDocumentos(resposta.documentos)
      setPaginaAtual(resposta.paginaAtual)
      setTotalPaginas(resposta.totalPaginas)
      setTotalDocumentos(resposta.totalDocumentos)
      setErroCarregamento(null)
    } catch {
      setErroCarregamento('Não foi possível carregar os documentos agora. Tente recarregar a página em instantes.')
    } finally {
      setLoading(false)
    }
  }, [pagina, filtros])

  useEffect(() => { recarregar() }, [recarregar])

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

  // Ao trocar qualquer filtro, volta pra página 1 — senão o usuário pode ficar
  // numa página que não existe mais dentro do resultado filtrado.
  function aplicarFiltros(novos: FiltrosSelecionados) {
    setFiltros(novos)
    setPagina(1)
  }

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
      await Promise.all([recarregar(), recarregarFiltrosDisponiveis()])
    }
    return resultado
  }

  async function abrirPdf(documentoId: string) {
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
      aba?.close()
      throw err
    }
  }

  return {
    documentos, paginaAtual, totalPaginas, totalDocumentos, pagina, setPagina,
    filtros, aplicarFiltros, filtrosDisponiveis,
    loading, erroCarregamento, recarregar,
    importarDocumento, abrirPdf,
  }
}
