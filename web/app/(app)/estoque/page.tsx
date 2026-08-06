'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useEstoqueData } from './hooks/use-estoque-data'
import type { MovimentacaoComFornecedor } from './hooks/use-estoque-data'
import { useFiltrosProdutos } from './hooks/use-filtros-produtos'
import { useFiltrosHistorico } from './hooks/use-filtros-historico'
import { KpisEstoque } from './components/kpis-estoque'
import { TabelaProdutos } from './components/tabela-produtos'
import { TabelaHistorico } from './components/tabela-historico'
import { NovoInsumoDialog } from './components/dialogs/novo-insumo-dialog'
import { AjustarEstoqueDialog } from './components/dialogs/ajustar-estoque-dialog'
import { ConverterUnidadeDialog } from './components/dialogs/converter-unidade-dialog'
import { ExcluirInsumoDialog } from './components/dialogs/excluir-insumo-dialog'
import { EditarMovimentacaoDialog } from './components/dialogs/editar-movimentacao-dialog'
import { ExcluirMovimentacaoDialog } from './components/dialogs/excluir-movimentacao-dialog'
import { getUrlParam, setUrlParam } from './lib/url-params'
import type { Estoque } from '@/lib/types'

export default function EstoquePage() {
  const dados = useEstoqueData()
  const filtrosProdutos = useFiltrosProdutos(dados.estoque)
  const filtrosHistorico = useFiltrosHistorico(dados.movimentacoes)

  const [tab, setTabState] = useState<'produtos' | 'historico'>(
    () => (getUrlParam('tab') === 'historico' ? 'historico' : 'produtos')
  )
  function setTab(v: string) {
    const val = v === 'historico' ? 'historico' : 'produtos'
    setTabState(val)
    setUrlParam('tab', val, 'produtos')
  }

  const [novoDialog, setNovoDialog]       = useState(false)
  const [ajustarItem, setAjustarItem]     = useState<Estoque | null>(null)
  const [converterItem, setConverterItem] = useState<Estoque | null>(null)
  const [excluirItem, setExcluirItem]     = useState<Estoque | null>(null)
  const [editarMov, setEditarMov]         = useState<MovimentacaoComFornecedor | null>(null)
  const [excluirMov, setExcluirMov]       = useState<MovimentacaoComFornecedor | null>(null)

  if (dados.loading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Estoque</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">Insumos cadastrados e histórico de movimentações</p>
        </div>
        <Button size="sm" onClick={() => setNovoDialog(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Novo Insumo
        </Button>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="produtos" className="space-y-6">
          <KpisEstoque estoque={dados.estoque} />
          <TabelaProdutos
            estoque={dados.estoque}
            filtros={filtrosProdutos}
            onNovoInsumo={() => setNovoDialog(true)}
            onAjustar={setAjustarItem}
            onConverter={setConverterItem}
            onExcluir={setExcluirItem}
          />
        </TabsContent>

        <TabsContent value="historico">
          <TabelaHistorico
            filtros={filtrosHistorico}
            onEditar={setEditarMov}
            onExcluir={setExcluirMov}
          />
        </TabsContent>
      </Tabs>

      <NovoInsumoDialog open={novoDialog} onOpenChange={setNovoDialog} onCriar={dados.criarInsumo} />
      <AjustarEstoqueDialog item={ajustarItem} onOpenChange={open => !open && setAjustarItem(null)} onAjustar={dados.ajustarEstoque} />
      <ConverterUnidadeDialog item={converterItem} onOpenChange={open => !open && setConverterItem(null)} onConverter={dados.converterUnidade} />
      <ExcluirInsumoDialog item={excluirItem} onOpenChange={open => !open && setExcluirItem(null)} onExcluir={dados.excluirInsumo} />
      <EditarMovimentacaoDialog mov={editarMov} onOpenChange={open => !open && setEditarMov(null)} onEditar={dados.editarMovimentacao} />
      <ExcluirMovimentacaoDialog mov={excluirMov} onOpenChange={open => !open && setExcluirMov(null)} onExcluir={dados.excluirMovimentacao} />
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-28 bg-muted rounded" />
      <div className="h-64 bg-muted rounded-xl" />
      <div className="h-48 bg-muted rounded-xl" />
    </div>
  )
}
