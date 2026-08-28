'use client'

import { patchDoItemEditado, previaDoTotal, dataEhEditavel, type ItemOriginal } from './salvar-item'
import { Fragment, useEffect, useState } from 'react'

function setUrlParam(key: string, value: string, dflt = 'todos') {
  const p = new URLSearchParams(window.location.search)
  if (!value || value === dflt) p.delete(key)
  else p.set(key, value)
  window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname)
}
import { DollarSign, TrendingDown, Package, Filter, Plus, Pencil, Trash2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SortableTableHead } from '@/components/ui/sortable-table-head'
import { supabase } from '@/lib/supabase'
import { useFazenda } from '@/context/fazenda-context'
import { CATEGORIAS_FINANCEIRAS, normalizarCategoria, categoriaLabel } from '@/lib/centro-custo'
import { useColumnWidths } from '@/lib/use-column-widths'
import { mesCorrente } from '@/lib/mes'
import { ColumnResizeHandle } from '@/components/ui/column-resize-handle'

type ItemFinanceiro = {
  id: string
  source_table: 'itens_nfe' | 'lancamentos_financeiros'
  // Chave da nota fiscal (só existe pra itens que vieram de NF-e vinculada a
  // uma nota real — item manual ou lançamento de cartão/manual/conta fica
  // null). Usada só pra AGRUPAR linhas da mesma nota na tabela — nunca entra
  // em cálculo de dinheiro.
  nota_fiscal_id: string | null
  descricao: string
  quantidade: number
  unidade: string
  valor_unitario: number
  valor_total: number
  centro_custo: string
  insumo_id: string | null
  nota_numero: string | null
  emitente_nome: string
  data_emissao: string
  is_manual: boolean
  // 'conta' = gasto que veio de uma conta a pagar marcada como paga.
  origem: 'nfe' | 'cartao' | 'manual' | 'conta' | null
  cartao_apelido: string | null
  // Gravado pelo processador da NF-e (migration 008), a partir de 04/08/2026.
  // NULO = item de antes da coluna existir, ou lançamento manual/cartão — conta
  // como gasto igual sempre contou. Só `false` explícito tira o item da soma.
  conta_como_compra: boolean | null
}

type FormData = {
  descricao: string
  quantidade: string
  unidade: string
  valor_unitario: string
  centro_custo: string
  data: string
}

const FORM_VAZIO: FormData = {
  descricao: '', quantidade: '1', unidade: 'UN',
  valor_unitario: '', centro_custo: 'outro', data: new Date().toISOString().slice(0, 10),
}

// Edição de lançamento de conta paga: sem quantidade/unidade (lancamentos_financeiros
// tem só um valor por linha, não item×preço como itens_nfe) — pedido do Matheus,
// 18/08/2026 (editar TUDO: fornecedor, descrição, categoria, valor, data). Fornecedor
// vem separado da descrição na tela (ver separarFornecedorDaConta) e os dois voltam a
// virar um texto só, no mesmo formato "FORNECEDOR — resto", na hora de salvar — ver
// handleEditarConta.
type ContaEditForm = { fornecedor: string; descricao: string; categoria: string; valor: string; data: string }
const CONTA_EDIT_FORM_VAZIO: ContaEditForm = { fornecedor: '', descricao: '', categoria: 'outro', valor: '', data: '' }

const TIPOS = CATEGORIAS_FINANCEIRAS

const CENTRO_CUSTO_STYLE: Record<string, string> = {
  herbicida:          'bg-red-100 text-red-700 border-red-200',
  fungicida:          'bg-purple-100 text-purple-700 border-purple-200',
  inseticida:         'bg-orange-100 text-orange-700 border-orange-200',
  adjuvante:          'bg-cyan-100 text-cyan-700 border-cyan-200',
  biologico:          'bg-teal-100 text-teal-700 border-teal-200',
  fertilizante_n:     'bg-green-100 text-green-700 border-green-200',
  fertilizante_p:     'bg-green-100 text-green-700 border-green-200',
  fertilizante_k:     'bg-green-100 text-green-700 border-green-200',
  fertilizante_outro: 'bg-green-100 text-green-700 border-green-200',
  foliar:             'bg-lime-100 text-lime-700 border-lime-200',
  calcario:           'bg-stone-100 text-stone-700 border-stone-200',
  semente:            'bg-yellow-100 text-yellow-700 border-yellow-200',
  combustivel:        'bg-blue-100 text-blue-700 border-blue-200',
  lubrificante:       'bg-blue-100 text-blue-700 border-blue-200',
  peca_maquina:       'bg-indigo-100 text-indigo-700 border-indigo-200',
  servico:            'bg-pink-100 text-pink-700 border-pink-200',
  frete:              'bg-slate-100 text-slate-700 border-slate-200',
  operacional:        'bg-gray-100 text-gray-600 border-gray-200',
  rh:                 'bg-rose-100 text-rose-700 border-rose-200',
  royalties:          'bg-emerald-100 text-emerald-700 border-emerald-200',
  tejuco:             'bg-lime-100 text-lime-700 border-lime-200',
  outro:              'bg-gray-100 text-gray-700 border-gray-200',
}

const CENTRO_CUSTO_COLOR: Record<string, string> = {
  // ── Insumos agrícolas ─────────────────────────────────────
  herbicida:          '#C2410C',  // laranja-terra (orange-700)
  fungicida:          '#7C3AED',  // violeta (violet-600)
  inseticida:         '#DC2626',  // vermelho (red-600)
  adjuvante:          '#0891B2',  // ciano (cyan-600)
  biologico:          '#059669',  // esmeralda (emerald-600)
  fertilizante_n:     '#15803D',  // verde (green-700)
  fertilizante_p:     '#4D7C0F',  // lima escuro (lime-700)
  fertilizante_k:     '#B45309',  // âmbar (amber-700)
  fertilizante_outro: '#713F12',  // marrom (amber-900)
  foliar:             '#65A30D',  // lima (lime-600)
  calcario:           '#57534E',  // pedra (stone-600)
  semente:            '#CA8A04',  // mostarda (yellow-600)
  // ── Operacional ───────────────────────────────────────────
  combustivel:        '#2563EB',  // azul (blue-600)
  lubrificante:       '#0F766E',  // verde-petróleo (teal-700)
  peca_maquina:       '#4338CA',  // índigo (indigo-700)
  servico:            '#C026D3',  // fúcsia (fuchsia-600)
  frete:              '#0284C7',  // azul-céu (sky-600)
  operacional:        '#D97706',  // laranja-queimado (amber-600)
  rh:                 '#E11D48',  // rosa-carmim (rose-600)
  royalties:          '#9333EA',  // roxo (purple-600)
  tejuco:             '#65A30D',  // lima escuro (lime-600) — vizinho do tejuco_gado
  outro:              '#94A3B8',  // slate suave
  // ── Categorias de cartão ──────────────────────────────────
  manutencao:         '#DB2777',  // pink (pink-600)
  alimentacao:        '#EA580C',  // laranja (orange-600)
  mercado:            '#16A34A',  // verde (green-600)
  veterinario:        '#0D9488',  // teal (teal-600)
  farmacia:           '#EF4444',  // vermelho (red-500)
  predial:            '#EAB308',  // amarelo (yellow-500)
  ferragens:          '#6366F1',  // índigo-claro (indigo-500)
  tejuco_gado:        '#84CC16',  // lima (lime-500)
  pedagio:            '#06B6D4',  // ciano (cyan-500)
  outros:             '#94A3B8',  // slate suave
}

// `null | undefined` no tipo NÃO é paranoia: `itens_nfe.quantidade`,
// `.valor_unitario` e `.valor_total` são NULLABLE no schema, e o importador de
// documentos de Controle grava nulo DE PROPÓSITO (`documentoPdf.ts`:
// "valorUnitario negativo/zero, mantido null"; extrato de contas a receber
// frequentemente não traz quantidade nenhuma). `value.toLocaleString` num nulo
// lança, e como `web/app` não tem NENHUM error.tsx, a exceção no render mata a
// ROTA INTEIRA — "Application error: a client-side exception has occurred".
//
// Achado [alto] do Apolo (28/08/2026). Medido no banco no mesmo dia: 0 linhas
// nulas hoje, então é bomba armada e não incêndio. Medir de novo:
//   select count(*) from itens_nfe
//   where quantidade is null or valor_unitario is null or valor_total is null;
function fmtBRL(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtBRLKpi(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function fmtDate(dateStr: string) {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR')
}

// Lançamento de conta paga (contas_a_pagar) chega aqui com o fornecedor já
// embutido no texto — "FORNECEDOR — descrição" (ver montarLancamento em
// api/src/services/contas/pagamento.ts). Separa os dois pra exibir o
// fornecedor na coluna Origem, igual nota fiscal, em vez de repetir tudo
// junto em Produto/Serviço. Sem essa separação o texto vem inteiro e a
// coluna Origem só mostra o crachá genérico "Conta paga".
//
// ⚠️ Risco aceito (achado do Apolo, 18/08/2026, decisão do Matheus): isto
// detecta o SEPARADOR, não o fornecedor de verdade. Uma conta SEM fornecedor
// cuja descrição digitada à mão contenha " — " é partida errada — um pedaço
// vira "fornecedor" inventado na coluna Origem. Chance baixa (exige o dono
// digitar esse traço exato numa conta sem fornecedor). Conserto definitivo
// exigiria coluna própria de fornecedor em lancamentos_financeiros (migration);
// decidido não fazer agora.
//
// ATUALIZAÇÃO 18/08/2026 (2ª rodada): este campo agora é EDITÁVEL (dialog de
// "Editar lançamento" no Financeiro) — deixou de ser só apresentação. Sem
// cuidado, um dono que abre o dialog e limpa um "Fornecedor" que na verdade é
// pedaço da descrição (mis-split acima) perderia esse texto ao salvar.
// handleEditarConta detecta esse caso específico (fornecedor vazio + descrição
// não tocada) e preserva o texto original em vez de descartar — ver ali.
function separarFornecedorDaConta(descricao: string): { fornecedor: string | null; resto: string } {
  const separador = ' — '
  const indice = descricao.indexOf(separador)
  if (indice === -1) return { fornecedor: null, resto: descricao }
  const resto = descricao.slice(indice + separador.length).trim()
  const fornecedor = descricao.slice(0, indice).trim()
  // Conta com descrição "FORNECEDOR — " (nada depois do separador) ou
  // " — resto" (nada antes) não pode virar célula muda nem fornecedor em
  // branco na coluna Origem — cai pro texto completo, igual ao caso "não
  // achou separador" (achado do Apolo, 18/08/2026, 2ª rodada).
  if (!resto || !fornecedor) return { fornecedor: null, resto: descricao }
  return { fornecedor, resto }
}

// Fonte única do texto exibido em Produto/Serviço — usada tanto na ordenação
// quanto no JSX. Antes da separação por fornecedor os dois liam o mesmo
// `item.descricao`; separar só na renderização quebrou a ordenação (a coluna
// ordenava pelo texto com fornecedor, mas mostrava só o resto) — achado do
// Apolo, 18/08/2026.
function textoDescricaoExibido(item: ItemFinanceiro): string {
  return item.origem === 'conta' ? separarFornecedorDaConta(item.descricao).resto : item.descricao
}

// Célula "Origem" para item vindo de itens_nfe (origem já filtrada para
// 'nfe' antes de chegar aqui — cartão/conta/manual são tratados fora desta
// função). A checagem de FORNECEDOR vem ANTES da de is_manual de propósito:
// item de contrato/extrato em PDF não tem nota vinculada, então is_manual já
// nasce true (`!row.notas_fiscais`) mesmo tendo fornecedor conhecido
// (itens_nfe.fornecedor, migration 017). Se a ordem virar — checar is_manual
// primeiro — o fornecedor some da tela de novo e cai em "Manual" genérico,
// como aconteceu com o contrato Mosaic de R$ 647.986,35 (achado do Matheus
// em conferência ao vivo, 23/08/2026). "Manual" fica só para quem realmente
// não tem fornecedor nenhum.
function OrigemNfeCell({ item }: { item: ItemFinanceiro }) {
  if (item.is_manual && item.emitente_nome) {
    return (
      <div>
        <p className="font-medium text-sm whitespace-normal break-words">{item.emitente_nome}</p>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">PDF</Badge>
      </div>
    )
  }
  if (item.is_manual) {
    return <span className="text-xs text-muted-foreground italic">Manual</span>
  }
  return (
    <div>
      <p className="font-medium text-sm whitespace-normal break-words">{item.emitente_nome}</p>
      <p className="text-xs text-muted-foreground">NF {item.nota_numero}</p>
    </div>
  )
}

// Mesma função de web/lib/centro-custo.ts (categoriaLabel) — nome local
// mantido porque os 9 lugares que chamam já esperam "tipoLabel".
const tipoLabel = categoriaLabel

// Decide se um item entra nas somas de dinheiro da tela (Total de Despesas,
// gráfico por categoria, etc). Gravado pelo processador da NF-e a partir de
// 04/08/2026 (migration 008) — o CFOP de cada item já decidiu isso lá, esta
// tela só lê a resposta.
//
// NULO/ausente PRECISA continuar contando: é como toda nota gravada antes
// desta coluna existir aparece, e é o histórico inteiro de gasto do dono.
// Só um `false` explícito — item já cobrado em outra nota, recebido sem
// custo (bonificação/amostra), ou mercadoria de passagem que nunca virou
// compra — tira o item da soma.
function contaComoGasto(item: Pick<ItemFinanceiro, 'conta_como_compra'>): boolean {
  return item.conta_como_compra !== false
}

type SortColunaFinanceiro = 'descricao' | 'quantidade' | 'valor_unitario' | 'valor_total' | 'centro_custo' | 'origem' | 'data_emissao'

function compararItensPorColuna(a: ItemFinanceiro, b: ItemFinanceiro, coluna: SortColunaFinanceiro, direcao: 'asc' | 'desc'): number {
  let cmp = 0
  switch (coluna) {
    case 'descricao':      cmp = textoDescricaoExibido(a).localeCompare(textoDescricaoExibido(b)); break
    case 'quantidade':     cmp = a.quantidade - b.quantidade; break
    case 'valor_unitario': cmp = a.valor_unitario - b.valor_unitario; break
    case 'valor_total':    cmp = a.valor_total - b.valor_total; break
    case 'centro_custo':   cmp = tipoLabel(a.centro_custo).localeCompare(tipoLabel(b.centro_custo)); break
    // origem nulo conta como NF-e pro resto da tela (ver okOrigem no filtro,
    // mais abaixo neste mesmo arquivo) — mantém a mesma regra aqui.
    case 'origem':         cmp = (a.origem ?? 'nfe').localeCompare(b.origem ?? 'nfe'); break
    case 'data_emissao':   cmp = (a.data_emissao ?? '').localeCompare(b.data_emissao ?? ''); break
  }
  return direcao === 'asc' ? cmp : -cmp
}

// `original` só existe na EDIÇÃO. Com ele, o rodapé para de mostrar o produto
// `qtd × unit` (que não é o total gravado quando os dois não batem) e passa a
// mostrar o total que VAI SER GRAVADO — e, quando ele muda, o de antes junto.
// Medido em 28/08/2026: 31 das 368 linhas de `itens_nfe` têm
// `quantidade × valor_unitario ≠ valor_total`, e o diálogo nunca mostrava o
// total atual, então um valor prestes a cair de R$ 119 mil para zero não
// aparecia em lugar nenhum.
function FormFields({ form, setForm, original }: {
  form: FormData
  setForm: React.Dispatch<React.SetStateAction<FormData>>
  original?: ItemOriginal
}) {
  const previa = original ? previaDoTotal(original, form) : null
  // Na ADIÇÃO (`original` ausente) a data sempre vale. Na EDIÇÃO, só vale em
  // item sem nota fiscal — ver `dataEhEditavel`. Mostrar um campo que não faz
  // nada é pior que não mostrar campo nenhum.
  const mostrarData = !original || dataEhEditavel(original)
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Descrição</Label>
        <Input
          placeholder="Ex: Roundup 20L, Frete colheita, Peça bomba…"
          value={form.descricao}
          onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Quantidade</Label>
          <Input
            type="number" min="0" step="any"
            value={form.quantidade}
            onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Unidade</Label>
          <Input
            placeholder="L, KG, UN, SC…"
            value={form.unidade}
            onChange={e => setForm(f => ({ ...f, unidade: e.target.value }))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Valor Unitário (R$)</Label>
          <Input
            type="number" min="0" step="0.01"
            placeholder="0,00"
            value={form.valor_unitario}
            onChange={e => setForm(f => ({ ...f, valor_unitario: e.target.value }))}
          />
        </div>
        {mostrarData ? (
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input
              type="date"
              value={form.data}
              onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Data</Label>
            <p className="text-sm text-muted-foreground pt-2">
              Vem da nota fiscal — para mudar, corrija a nota na aba NF-e.
            </p>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Centro de Custo</Label>
        <Select value={form.centro_custo} onValueChange={v => setForm(f => ({ ...f, centro_custo: v ?? 'outro' }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {previa ? (
        <p className={`text-sm text-right ${previa.vaiMudar ? 'text-amber-700' : 'text-muted-foreground'}`}>
          {previa.vaiMudar && (
            <>De <span className="line-through">{fmtBRL(previa.totalAtual)}</span> para{' '}</>
          )}
          {!previa.vaiMudar && 'Total: '}
          <span className="font-semibold text-foreground">{fmtBRL(previa.totalNovo)}</span>
          {previa.vaiMudar && (
            <span className="block text-xs">
              Você mexeu na quantidade ou no valor unitário, então o total é recalculado.
            </span>
          )}
        </p>
      ) : form.quantidade && form.valor_unitario ? (
        <p className="text-sm text-muted-foreground text-right">
          Total: <span className="font-semibold text-foreground">
            {fmtBRL((parseFloat(form.quantidade) || 0) * (parseFloat(form.valor_unitario) || 0))}
          </span>
        </p>
      ) : null}
    </div>
  )
}

// Padrão do filtro de mês: mês atual — a tela abre já filtrada, sem mostrar
// o histórico inteiro. Diferente de 'todos' (opção explícita "ver tudo"),
// que continua sendo um valor à parte, escolhido pelo usuário. Achado da
// revisão final do branch: confundir os dois fazia "Limpar" jogar a tela
// pro histórico inteiro, e "Todos os meses" não sobrevivia a um F5.
//
// `mesCorrente()` e não `toISOString().slice(0,7)`: o segundo converte para UTC,
// e das 21h do dia 31 até a virada ele já devolve o mês SEGUINTE — a tela do
// dinheiro abria num mês vazio nas últimas 3 horas de todo mês (achado [médio]
// do Apolo, 25/08/2026, na revisão do filtro de mês da aba NF-e).
const MES_PADRAO = mesCorrente()

// Larguras de partida das colunas redimensionáveis — os mesmos valores que já
// existiam fixos em `w-[Npx]` antes desta mudança (Task 4 do plano de
// 2026-08-17). Coluna de ações e de checkbox não entram aqui: não são
// redimensionáveis (ver design).
const COLUNAS_FINANCEIRO = [
  { id: 'origem', padrao: 180 },
  { id: 'descricao', padrao: 220 },
  { id: 'quantidade', padrao: 70 },
  { id: 'valor_unitario', padrao: 110 },
  { id: 'valor_total', padrao: 120 },
  { id: 'centro_custo', padrao: 140 },
  { id: 'data_emissao', padrao: 90 },
]

export default function FinanceiroPage() {
  const [itens, setItens] = useState<ItemFinanceiro[]>([])
  const [loading, setLoading] = useState(true)
  // Achado da revisão: uma falha de carregamento (ex.: migration 008 não
  // rodou ainda no banco, e o select de conta_como_compra quebra a query
  // inteira) deixava `itens` em [] e a tela renderizava "R$ 0,00" e "Nenhum
  // lançamento encontrado" — silêncio indistinguível de "não há gasto". Este
  // estado garante que uma falha de banco SEMPRE aparece como falha, nunca
  // como tela vazia.
  const [erroCarregamento, setErroCarregamento] = useState(false)
  const [filtroCentro, setFiltroCentro] = useState('todos')
  const [filtroMes, setFiltroMes] = useState(MES_PADRAO)
  const [filtroOrigem, setFiltroOrigem] = useState<'todos' | 'nfe' | 'cartao' | 'manual' | 'conta'>('todos')
  const [sortColuna, setSortColuna]   = useState<SortColunaFinanceiro>('data_emissao')
  const [sortDirecao, setSortDirecao] = useState<'asc' | 'desc'>('desc')
  const [verTodasCategorias, setVerTodasCategorias] = useState(false)
  const [visivelCount, setVisivelCount] = useState(20)
  const [notasExpandidas, setNotasExpandidas] = useState<Set<string>>(new Set())
  const { fazendaAtiva } = useFazenda()
  const { largura, iniciarArrasto } = useColumnWidths('financeiro', COLUNAS_FINANCEIRO)

  function toggleNota(chave: string) {
    setNotasExpandidas(prev => {
      const novo = new Set(prev)
      if (novo.has(chave)) novo.delete(chave)
      else novo.add(chave)
      return novo
    })
  }

  // ─── Seleção em massa (trocar centro de custo de vários itens de uma vez) ──
  // Só itens_nfe têm centro_custo editável nesta tela (mesma regra do lápis de
  // edição individual, ver handleEdit) — lançamento de cartão/manual/conta não
  // entra na seleção. Guarda o `id` de itens_nfe, não o objeto inteiro: mais
  // barato de comparar e sobrevive a um `load()` que troca a referência do item.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [centroEmMassa, setCentroEmMassa] = useState('')
  const [aplicandoEmMassa, setAplicandoEmMassa] = useState(false)
  const [erroEmMassa, setErroEmMassa] = useState<string | null>(null)

  // Conta paga entra na seleção desde 18/08/2026 (pedido do Matheus): seu
  // centro de custo mora em `lancamentos_financeiros.categoria`, não em
  // `itens_nfe.centro_custo` — ver aplicarCentroEmMassa, que separa os ids por
  // tabela na hora de salvar. Cartão/manual continuam de fora: ninguém pediu.
  function itemSelecionavel(item: ItemFinanceiro): boolean {
    return item.source_table === 'itens_nfe' || item.origem === 'conta'
  }

  function toggleSelecionado(id: string) {
    setSelecionados(prev => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  // Marca/desmarca TODOS os itens de uma nota agrupada de uma vez — resolve o
  // caso de pedido: "tem uma nota aqui com vários itens, quero trocar o
  // centro de custo de todos sem abrir um por um". Todo item de um grupo com
  // mais de 1 linha é sempre itens_nfe (só quem tem nota_fiscal_id agrupa —
  // ver `grupos` mais abaixo), então não precisa filtrar por selecionável aqui.
  function toggleGrupoSelecionado(ids: string[]) {
    setSelecionados(prev => {
      const todosMarcados = ids.every(id => prev.has(id))
      const novo = new Set(prev)
      if (todosMarcados) ids.forEach(id => novo.delete(id))
      else ids.forEach(id => novo.add(id))
      return novo
    })
  }

  function limparSelecao() {
    setSelecionados(new Set())
    setCentroEmMassa('')
    setErroEmMassa(null)
  }

  async function aplicarCentroEmMassa() {
    if (selecionados.size === 0 || !centroEmMassa) return
    setAplicandoEmMassa(true)
    setErroEmMassa(null)

    const idsAlvo = Array.from(selecionados)
    // Conta paga guarda centro de custo em lancamentos_financeiros.categoria,
    // não em itens_nfe.centro_custo (ver itemSelecionavel) — separa os ids por
    // tabela antes de salvar. Ids nunca colidem entre as duas (uuid), então dá
    // pra decidir só olhando `itens` (fonte de verdade de quem é quem).
    const idsConta = new Set(itens.filter(i => i.origem === 'conta').map(i => i.id))
    const idsItensNfe = idsAlvo.filter(id => !idsConta.has(id))
    const idsLancamentos = idsAlvo.filter(id => idsConta.has(id))

    const [resNfe, resLanc] = await Promise.all([
      idsItensNfe.length > 0
        ? supabase.from('itens_nfe').update({ centro_custo: centroEmMassa }).in('id', idsItensNfe).select('id')
        : Promise.resolve({ data: [] as { id: string }[], error: null }),
      idsLancamentos.length > 0
        ? supabase.from('lancamentos_financeiros').update({ categoria: centroEmMassa }).in('id', idsLancamentos).select('id')
        : Promise.resolve({ data: [] as { id: string }[], error: null }),
    ])

    setAplicandoEmMassa(false)

    const erro = resNfe.error ?? resLanc.error
    if (erro) {
      console.error('[Financeiro] Erro ao trocar centro de custo em massa:', erro)
      setErroEmMassa(`Erro ao salvar: ${erro.message}`)
      return
    }

    // Mesmo padrão de handleEdit (edição de 1 item só, logo acima): um UPDATE
    // sem erro NÃO garante que toda linha foi gravada — RLS filtra silenciosamente
    // (ver memória do projeto "rls-escrita-silenciosa"). Sem esta checagem, trocar
    // o centro de custo de 3 itens e só 2 passarem pela RLS pareceria sucesso total.
    const idsAtualizados = new Set([...(resNfe.data ?? []), ...(resLanc.data ?? [])].map(r => r.id))
    const idsFalhos = idsAlvo.filter(id => !idsAtualizados.has(id))
    if (idsFalhos.length > 0) {
      console.error('[Financeiro] Trocar centro de custo em massa: update não afetou todas as linhas — possível política RLS.', idsFalhos)
      setErroEmMassa(
        idsFalhos.length === idsAlvo.length
          ? 'Sem permissão para editar estes itens. Verifique as políticas do banco.'
          : `${idsAtualizados.size} de ${idsAlvo.length} itens foram atualizados — os demais não tinham permissão. Verifique as políticas do banco.`
      )
      load()
      return
    }

    limparSelecao()
    load()
  }

  function handleSort(coluna: SortColunaFinanceiro) {
    if (coluna === sortColuna) {
      setSortDirecao(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColuna(coluna)
      setSortDirecao('asc')
    }
  }

  const [addDialog, setAddDialog] = useState(false)
  const [addErro, setAddErro] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<ItemFinanceiro | null>(null)
  const [editErro, setEditErro] = useState<string | null>(null)
  // Conta paga não edita pelo formulário grande (quantidade/valor unitário não
  // fazem sentido pra um lançamento de valor único) — dialog próprio, com
  // fornecedor/descrição separados. Pedido do Matheus, 18/08/2026.
  const [editContaItem, setEditContaItem] = useState<ItemFinanceiro | null>(null)
  const [editContaForm, setEditContaForm] = useState<ContaEditForm>(CONTA_EDIT_FORM_VAZIO)
  const [editContaErro, setEditContaErro] = useState<string | null>(null)
  const [deleteItem, setDeleteItem] = useState<ItemFinanceiro | null>(null)
  const [deleteErro, setDeleteErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState<FormData>(FORM_VAZIO)

  async function load() {
    setLoading(true)
    setErroCarregamento(false)
    const [nfeResult, lancResult] = await Promise.all([
      supabase
        .from('itens_nfe')
        .select('id, descricao, quantidade, unidade, valor_unitario, valor_total, centro_custo, insumo_id, conta_como_compra, data_manual, nota_fiscal_id, fornecedor, insumos(tipo), notas_fiscais(numero, emitente_nome, data_emissao)')
        .order('id', { ascending: false }),
      supabase
        .from('lancamentos_financeiros')
        .select('id, data, descricao, valor, categoria, origem, cartao_id, cartoes(apelido)')
        // 'conta' = pagamento de conta a pagar. O IN do SQL nunca casa com nulo,
        // então toda origem nova PRECISA entrar aqui — senão o gasto some desta
        // tela e continua contando no Dashboard, que lê a tabela inteira.
        .in('origem', ['cartao', 'manual', 'conta'])
        .order('data', { ascending: false }),
    ])

    if (nfeResult.error || lancResult.error) {
      console.error('[Financeiro] Erro ao carregar:', nfeResult.error ?? lancResult.error)
      setErroCarregamento(true)
      setLoading(false)
      return
    }

    const nfeItems: ItemFinanceiro[] = (nfeResult.data ?? []).map((row: any) => ({
      id: row.id,
      source_table: 'itens_nfe' as const,
      nota_fiscal_id: row.nota_fiscal_id,
      descricao: row.descricao,
      quantidade: row.quantidade,
      unidade: row.unidade,
      valor_unitario: row.valor_unitario,
      valor_total: row.valor_total,
      centro_custo: row.centro_custo ?? row.insumos?.tipo ?? 'outro',
      insumo_id: row.insumo_id,
      nota_numero: row.notas_fiscais?.numero ?? null,
      // Item de PDF (contrato/extrato) não tem nota vinculada, então
      // `notas_fiscais.emitente_nome` vem vazio e a coluna Origem saía em
      // branco — o dono via R$ 647.986,35 sem saber de quem era. A coluna
      // `fornecedor` de itens_nfe (migration 017) é quem guarda esse nome.
      emitente_nome: row.notas_fiscais?.emitente_nome ?? row.fornecedor ?? '',
      // Prioridade para a data da NF-e quando existir; lançamento manual
      // (sem nota vinculada) usa data_manual — a data escolhida pelo usuário
      // no formulário (migration 015). Sem este fallback o lançamento manual
      // fica com data vazia: some do filtro de mês e do Total de Despesas.
      data_emissao: row.notas_fiscais?.data_emissao ?? row.data_manual ?? '',
      is_manual: !row.notas_fiscais,
      origem: 'nfe' as const,
      cartao_apelido: null,
      conta_como_compra: row.conta_como_compra ?? null,
    }))

    const lancItems: ItemFinanceiro[] = (lancResult.data ?? []).map((row: any) => ({
      id: row.id,
      source_table: 'lancamentos_financeiros' as const,
      nota_fiscal_id: null, // lançamento de cartão/manual/conta nunca tem nota — nunca agrupa
      descricao: row.descricao,
      quantidade: 1,
      unidade: '',
      valor_unitario: row.valor,
      valor_total: row.valor,
      // Só o lançamento de CONTA vem de texto digitado à mão
      // (contas_a_pagar.categoria) — normalizarCategoria casa "Manutenção" com
      // o value oficial 'manutencao' pra não abrir barra nova no gráfico só
      // por causa de acento/maiúscula. Cartão e manual já nascem com o value
      // oficial (categorizador.ts / form ligado a TIPOS) — normalizar de novo
      // não muda o valor, mas troca 'farmacia'/'tejuco_gado' etc (categorias
      // de cartão fora da lista oficial, ver comentário no topo de
      // centro-custo.ts) por versão capitalizada que não bate com nenhuma cor
      // do gráfico, apagando a cor própria delas (achado do Apolo, 11/08/2026).
      // Conta sem categoria (campo é opcional) cai em 'outro' — nunca em
      // 'outros', que o rótulo já avisa ser "(cartão)": um boleto pago não é
      // gasto de cartão.
      centro_custo: row.origem === 'conta'
        ? normalizarCategoria(row.categoria)
        : (row.categoria ?? 'outros'),
      insumo_id: null,
      nota_numero: null,
      emitente_nome: '',
      data_emissao: row.data ?? '',
      is_manual: row.origem === 'manual',
      origem: row.origem as 'cartao' | 'manual' | 'conta',
      cartao_apelido: row.cartoes?.apelido ?? null,
      // lancamentos_financeiros não tem CFOP — não existe razão para excluir
      // um lançamento de cartão/manual/conta do total. Conta como sempre contou.
      conta_como_compra: null,
    }))

    setItens([...nfeItems, ...lancItems])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mes = params.get('mes')
    const centro = params.get('centro')
    const origem = params.get('origem') as 'todos' | 'nfe' | 'cartao' | 'manual' | 'conta' | null
    if (mes !== null && (mes === 'todos' || /^\d{4}-\d{2}$/.test(mes))) setFiltroMes(mes)
    if (centro !== null) setFiltroCentro(centro)
    if (origem && ['todos', 'nfe', 'cartao', 'manual', 'conta'].includes(origem)) setFiltroOrigem(origem)
  }, [])

  useEffect(() => { setVisivelCount(20) }, [filtroMes, filtroCentro, filtroOrigem])

  async function handleAdd() {
    // Sem fazenda ativa não há como preencher fazenda_id (NOT NULL + RLS
    // nas duas tabelas abaixo) — o insert seria recusado pelo banco e o
    // usuário não veria nada. Barra antes de tentar.
    if (!fazendaAtiva) {
      setAddErro('Nenhuma fazenda ativa selecionada. Recarregue a página e tente de novo.')
      return
    }

    setSalvando(true)
    setAddErro(null)
    const qtd = parseFloat(form.quantidade) || 1
    const vUnit = parseFloat(form.valor_unitario) || 0

    try {
      let insumoId: string | null = null
      const { data: existente } = await supabase
        .from('insumos')
        .select('id')
        .ilike('nome', form.descricao.trim())
        .maybeSingle()

      if (existente) {
        insumoId = existente.id
      } else {
        const { data: novo, error: errInsumo } = await supabase
          .from('insumos')
          .insert({ nome: form.descricao.trim(), tipo: form.centro_custo, unidade: form.unidade, fazenda_id: fazendaAtiva.id })
          .select('id')
          .single()
        if (errInsumo) throw errInsumo
        insumoId = novo?.id ?? null
      }

      const { error: errItem } = await supabase.from('itens_nfe').insert({
        nota_fiscal_id: null,
        descricao: form.descricao.trim(),
        quantidade: qtd,
        unidade: form.unidade,
        valor_unitario: vUnit,
        valor_total: qtd * vUnit,
        insumo_id: insumoId,
        data_manual: form.data,
        fazenda_id: fazendaAtiva.id,
        centro_custo: form.centro_custo,
      })
      if (errItem) throw errItem

      setAddDialog(false)
      setForm(FORM_VAZIO)
      load()
    } catch (err) {
      console.error('[Financeiro] Erro ao adicionar lançamento:', err)
      const msg = (err as { message?: string })?.message ?? 'Erro desconhecido ao salvar'
      setAddErro(`Erro ao salvar: ${msg}`)
    } finally {
      setSalvando(false)
    }
  }

  function abrirEdicao(item: ItemFinanceiro) {
    setForm({
      descricao: item.descricao,
      quantidade: String(item.quantidade),
      unidade: item.unidade,
      valor_unitario: String(item.valor_unitario),
      centro_custo: item.centro_custo,
      data: item.data_emissao ? item.data_emissao.slice(0, 10) : new Date().toISOString().slice(0, 10),
    })
    setEditErro(null)
    setEditItem(item)
  }

  async function handleEdit() {
    if (!editItem || editItem.source_table !== 'itens_nfe') return
    setSalvando(true)

    // Centro de custo é gravado por lançamento na própria itens_nfe (independente
    // do insumo/estoque) — itens não-estocáveis (peça, frete) não têm insumo_id.
    //
    // O patch sai INTEIRO de `patchDoItemEditado` (função pura, testada): esta
    // linha gravava `valor_total: quantidade × valor_unitario`, recalculando o
    // total em vez de preservar o que veio da nota. Como o diálogo existe
    // principalmente para trocar o centro de custo, salvar essa troca era o
    // bastante para o gasto mudar sozinho — R$ 413.495,52 expostos em 31 linhas,
    // medidos no banco em 28/08/2026.
    const { data: updated, error } = await supabase.from('itens_nfe')
      .update(patchDoItemEditado(editItem, form))
      .eq('id', editItem.id).select('id')

    setSalvando(false)

    if (error) {
      console.error('[Financeiro] Erro ao editar lançamento:', error)
      setEditErro(`Erro ao salvar: ${error.message}`)
      return
    }
    if (!updated || updated.length === 0) {
      console.error('[Financeiro] Update não afetou nenhuma linha — possível política RLS')
      setEditErro('Sem permissão para editar este item. Verifique as políticas do banco.')
      return
    }

    setEditItem(null)
    setForm(FORM_VAZIO)
    load()
  }

  function abrirEditarConta(item: ItemFinanceiro) {
    const { fornecedor, resto } = separarFornecedorDaConta(item.descricao)
    setEditContaForm({
      fornecedor: fornecedor ?? '',
      descricao:  resto,
      categoria:  item.centro_custo,
      valor:      String(item.valor_total),
      data:       item.data_emissao ? item.data_emissao.slice(0, 10) : new Date().toISOString().slice(0, 10),
    })
    setEditContaErro(null)
    setEditContaItem(item)
  }

  async function handleEditarConta() {
    if (!editContaItem) return
    if (!editContaForm.descricao.trim()) { setEditContaErro('A descrição não pode ficar vazia.'); return }
    const valorNum = parseFloat(editContaForm.valor)
    if (isNaN(valorNum) || valorNum < 0) { setEditContaErro('Informe um valor válido.'); return }
    if (!editContaForm.data) { setEditContaErro('Informe a data.'); return }

    setSalvando(true)
    setEditContaErro(null)

    // Mesmo formato que o backend grava no pagamento (ver montarLancamento em
    // api/src/services/contas/pagamento.ts) — precisa continuar assim pra
    // separarFornecedorDaConta seguir lendo o fornecedor de volta depois.
    const fornecedor = editContaForm.fornecedor.trim()
    const original = separarFornecedorDaConta(editContaItem.descricao)
    // Achado do Apolo, 18/08/2026: o campo Fornecedor pode vir preenchido por um
    // SPLIT AUTOMÁTICO da descrição (risco aceito, ver separarFornecedorDaConta),
    // não por um fornecedor de verdade gravado. Se o dono só apaga esse campo sem
    // tocar na descrição, salvar `descricao` sozinha jogaria fora um pedaço do
    // texto original pra sempre. Detecta esse caso específico e preserva o texto
    // original inteiro em vez de descartar.
    const descricao = (!fornecedor && original.fornecedor && editContaForm.descricao.trim() === original.resto)
      ? editContaItem.descricao
      : (fornecedor ? `${fornecedor} — ${editContaForm.descricao.trim()}` : editContaForm.descricao.trim())

    const { data: updated, error } = await supabase
      .from('lancamentos_financeiros')
      .update({
        descricao,
        valor: valorNum,
        categoria: editContaForm.categoria,
        data: editContaForm.data,
      })
      .eq('id', editContaItem.id)
      .select('id')

    setSalvando(false)

    if (error) {
      console.error('[Financeiro] Erro ao editar lançamento de conta paga:', error)
      setEditContaErro(`Erro ao salvar: ${error.message}`)
      return
    }
    if (!updated || updated.length === 0) {
      console.error('[Financeiro] Update não afetou nenhuma linha — possível política RLS')
      setEditContaErro('Sem permissão para editar este item. Verifique as políticas do banco.')
      return
    }

    setEditContaItem(null)
    load()
  }

  async function handleDelete() {
    if (!deleteItem) return
    setSalvando(true)
    setDeleteErro(null)

    const { data: deleted, error } = await supabase
      .from(deleteItem.source_table)
      .delete()
      .eq('id', deleteItem.id)
      .select('id')

    setSalvando(false)

    if (error) {
      console.error('[Financeiro] Erro ao excluir item:', error)
      setDeleteErro(`Erro: ${error.message}`)
      return
    }

    if (!deleted || deleted.length === 0) {
      console.error('[Financeiro] Delete não afetou nenhuma linha — possível política RLS')
      setDeleteErro('Sem permissão para excluir este item. Verifique as políticas do banco.')
      return
    }

    setDeleteItem(null)
    load()
  }

  const meses = Array.from(
    new Set([
      MES_PADRAO, // garante que o mês corrente aparece sempre, mesmo sem dados
      ...itens.filter(i => i.data_emissao).map(i => i.data_emissao.slice(0, 7)),
    ])
  ).sort((a, b) => b.localeCompare(a))

  const itensFiltrados = itens
    .filter(i => {
      const okCentro = filtroCentro === 'todos' || i.centro_custo === filtroCentro
      // `?? ''` é cinto de segurança, não conserto: `data_emissao` já chega
      // coalescido da origem (`?? row.data_manual ?? ''`, na montagem da lista),
      // então nulo não chega até aqui hoje.
      //
      // O que continua ABERTO e não é resolvido por esta linha: item com data
      // VAZIA some de todos os meses e fica fora do total — enquanto a aba NF-e
      // decidiu o contrário para a mesma pergunta ("nota sem data aparece em
      // qualquer mês", ver filtro-mes.ts). As duas telas discordam; alinhar é
      // decisão a tomar, não conserto para fazer de passagem (achado [baixo] do
      // Apolo, 25/08/2026). Latente: a coluna é `date` e recusaria string vazia.
      const okMes    = filtroMes === 'todos' || (i.data_emissao ?? '').startsWith(filtroMes)
      const okOrigem = filtroOrigem === 'todos' || i.origem === filtroOrigem || (filtroOrigem === 'nfe' && (i.origem === 'nfe' || i.origem === null))
      return okCentro && okMes && okOrigem
    })
    .sort((a, b) => compararItensPorColuna(a, b, sortColuna, sortDirecao))

  // Só os itens que CONTAM como gasto entram nas somas de dinheiro — um item
  // com conta_como_compra === false (já cobrado em outra nota, bonificação,
  // etc.) continua na lista abaixo, com o crachá explicando por quê, mas não
  // soma no Total de Despesas nem no gráfico por categoria.
  const itensQueContam = itensFiltrados.filter(contaComoGasto)

  type GrupoItem = { chave: string; itens: ItemFinanceiro[] }

  // Agrupa por nota fiscal, mantendo a ordem em que cada nota apareceu
  // primeiro na lista já filtrada/ordenada — não reordena nada, só junta.
  const grupos: GrupoItem[] = []
  const posicaoPorChave = new Map<string, number>()
  for (const item of itensFiltrados) {
    const chave = item.nota_fiscal_id ?? `item-${item.id}`
    const posicao = posicaoPorChave.get(chave)
    if (posicao === undefined) {
      posicaoPorChave.set(chave, grupos.length)
      grupos.push({ chave, itens: [item] })
    } else {
      grupos[posicao].itens.push(item)
    }
  }

  const gruposExibidos = grupos.slice(0, visivelCount)

  // Ids selecionáveis visíveis agora (respeita filtro + paginação) — usado só
  // pelo checkbox "marcar tudo" do cabeçalho da tabela.
  const idsSelecionaveisVisiveis = gruposExibidos.flatMap(g => g.itens.filter(itemSelecionavel).map(i => i.id))
  const todosVisiveisSelecionados = idsSelecionaveisVisiveis.length > 0 && idsSelecionaveisVisiveis.every(id => selecionados.has(id))

  const totalGeral = itensQueContam.reduce((s, i) => s + i.valor_total, 0)
  const porCategoria = itensQueContam.reduce<Record<string, number>>((acc, i) => {
    acc[i.centro_custo] = (acc[i.centro_custo] ?? 0) + i.valor_total
    return acc
  }, {})
  const maiorCategoria = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0]

  const chartData = Object.entries(porCategoria)
    .map(([key, value]) => ({ key, label: tipoLabel(key), value }))
    .sort((a, b) => b.value - a.value)
  const chartDataExibido = verTodasCategorias ? chartData : chartData.slice(0, 5)

  if (loading) return <PageSkeleton />
  // Precisa vir ANTES de qualquer render de conteúdo — inclusive antes do
  // "Nenhum lançamento encontrado" que o array vazio geraria mais abaixo.
  // Uma falha de carregamento nunca pode se parecer com "não há gasto".
  if (erroCarregamento) return <ErroCarregamento onRetry={load} />

  const filtroAtivo = filtroMes !== MES_PADRAO || filtroCentro !== 'todos' || filtroOrigem !== 'todos'
  const filtroMesLabel = filtroMes === 'todos'
    ? 'Todos os meses'
    : (() => { const [y, mo] = filtroMes.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })()
  const filtroCentroLabel = filtroCentro === 'todos' ? 'Todos os tipos' : tipoLabel(filtroCentro)

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">Despesas e lançamentos da fazenda</p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => { setForm(FORM_VAZIO); setAddErro(null); setAddDialog(true) }}>
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Adicionar
        </Button>
      </div>

      <div className="space-y-4">
        <p className="text-sm font-semibold text-muted-foreground">Resumo do mês</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />Total de Despesas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtBRLKpi(totalGeral)}</p>
            {/* itensQueContam, não itensFiltrados: esta contagem descreve o
                que está somado no valor acima — contar item que não entrou
                na soma contradiria o próprio número ao lado. */}
            <p className="text-xs text-muted-foreground mt-1">{itensQueContam.length} item(ns) no período</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />Maior Gasto
            </CardTitle>
          </CardHeader>
          <CardContent>
            {maiorCategoria ? (
              <>
                <p className="text-2xl font-bold">{fmtBRLKpi(maiorCategoria[1])}</p>
                <p className="text-xs text-muted-foreground mt-1">{tipoLabel(maiorCategoria[0])}</p>
              </>
            ) : <p className="text-muted-foreground text-sm">—</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />Categorias com Gasto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{Object.keys(porCategoria).length}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {Object.keys(porCategoria).map(tipoLabel).join(', ') || '—'}
            </p>
          </CardContent>
        </Card>
        </div>

        {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Gastos por Categoria</CardTitle>
              <span className="text-sm text-muted-foreground tabular-nums">{fmtBRL(totalGeral)}</span>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto pt-2">
            <div style={{ minWidth: 360 }}>
              <ResponsiveContainer width="100%" height={chartDataExibido.length * 52 + 16}>
                <BarChart
                  data={chartDataExibido}
                  layout="vertical"
                  margin={{ top: 0, right: 180, bottom: 0, left: 8 }}
                  barSize={22}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={150}
                    tick={{ fontSize: 15, fill: '#374151' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <RechartsTooltip
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const { label, value } = payload[0].payload as { label: string; value: number }
                      const pct = totalGeral > 0 ? (value / totalGeral * 100).toFixed(1) : '0.0'
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-sm">
                          <p className="font-medium text-foreground mb-1">{label}</p>
                          <p className="tabular-nums text-foreground">{fmtBRL(value)}</p>
                          <p className="text-muted-foreground">{pct}% do total</p>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 5, 5, 0]}>
                    {chartDataExibido.map(entry => (
                      <Cell key={entry.key} fill={CENTRO_CUSTO_COLOR[entry.key] ?? '#94a3b8'} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      content={(props) => {
                        const { x, y, width, height, value } = props as { x: number; y: number; width: number; height: number; value: unknown }
                        const val = Number(value ?? 0)
                        const pct = totalGeral > 0 ? (val / totalGeral * 100).toFixed(1) : '0.0'
                        const cx = x + width + 8
                        const cy = y + height / 2 + 5
                        return (
                          <text x={cx} y={cy} fill="#6b7280" fontSize={14}>
                            <tspan>{fmtBRL(val)}</tspan>
                            <tspan dx={32}>{pct}%</tspan>
                          </text>
                        )
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {chartData.length > 5 && (
                <div className="text-center mt-2">
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setVerTodasCategorias(v => !v)}
                  >
                    {verTodasCategorias ? 'Ver só as 5 maiores' : `Ver todas as ${chartData.length} categorias`}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        )}
      </div>

      <Separator />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">
              Lançamentos por Item
              {filtroAtivo && (
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  {itensFiltrados.length} de {itens.length}
                </span>
              )}
            </CardTitle>
          </div>
          {selecionados.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-sm font-medium">
                {selecionados.size} {selecionados.size === 1 ? 'selecionado' : 'selecionados'}
              </span>
              <Select value={centroEmMassa} onValueChange={v => setCentroEmMassa(v ?? '')}>
                <SelectTrigger className="w-52 h-9 text-sm bg-background">
                  <SelectValue placeholder="Trocar centro de custo para…" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!centroEmMassa || aplicandoEmMassa}
                onClick={aplicarCentroEmMassa}
              >
                {aplicandoEmMassa ? 'Aplicando…' : 'Aplicar'}
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={limparSelecao}>
                Cancelar seleção
              </Button>
              {erroEmMassa && (
                <span className="text-sm text-red-600">{erroEmMassa}</span>
              )}
              {/* Mesmo aviso do dialog de edição individual (achado do Apolo,
                  18/08/2026) — a troca em massa também grava direto em
                  lancamentos_financeiros.categoria quando a seleção inclui
                  conta paga, e "Desfazer pagamento" também apaga isso. */}
              {itens.some(i => selecionados.has(i.id) && i.origem === 'conta') && (
                <span className="text-xs text-amber-700 basis-full">
                  A seleção inclui lançamento de conta paga — a troca não muda a conta
                  original em Contas a Pagar, e some se aquele pagamento for desfeito.
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filtroOrigem}
              onValueChange={v => {
                const val = (v ?? 'todos') as typeof filtroOrigem
                setFiltroOrigem(val)
                setUrlParam('origem', val)
              }}
            >
              <SelectTrigger className="w-40 h-9 text-sm">
                <SelectValue>
                  {{ todos: 'Todos', nfe: 'NF-e', cartao: 'Cartão', manual: 'Manual', conta: 'Conta paga' }[filtroOrigem]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="nfe">NF-e</SelectItem>
                <SelectItem value="cartao">Cartão</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="conta">Conta paga</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filtroMes} onValueChange={v => { const val = v ?? 'todos'; setFiltroMes(val); setUrlParam('mes', val, MES_PADRAO) }}>
              <SelectTrigger className="w-44 h-9 text-sm"><SelectValue>{filtroMesLabel}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os meses</SelectItem>
                {meses.map(m => (
                  <SelectItem key={m} value={m}>
                    {(() => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroCentro} onValueChange={v => { const val = v ?? 'todos'; setFiltroCentro(val); setUrlParam('centro', val) }}>
              <SelectTrigger className="w-44 h-9 text-sm"><SelectValue>{filtroCentroLabel}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {filtroAtivo && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground"
                onClick={() => { setFiltroMes(MES_PADRAO); setFiltroCentro('todos'); setFiltroOrigem('todos'); window.history.replaceState(null, '', window.location.pathname) }}
              >
                Limpar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="border-collapse w-max [&_th]:border [&_th]:border-border [&_th]:overflow-hidden [&_td]:border [&_td]:border-border [&_td]:overflow-hidden" style={{ tableLayout: 'fixed' }}>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  style={{ width: largura('origem') }}
                  ativo={sortColuna === 'origem'} direcao={sortDirecao} onClick={() => handleSort('origem')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('origem', largura('origem'))} />}
                >Origem</SortableTableHead>
                <SortableTableHead
                  style={{ width: largura('descricao') }}
                  ativo={sortColuna === 'descricao'} direcao={sortDirecao} onClick={() => handleSort('descricao')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('descricao', largura('descricao'))} />}
                >Produto / Serviço</SortableTableHead>
                <SortableTableHead
                  className="text-right" style={{ width: largura('quantidade') }} numeric
                  ativo={sortColuna === 'quantidade'} direcao={sortDirecao} onClick={() => handleSort('quantidade')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('quantidade', largura('quantidade'))} />}
                >Qtd.</SortableTableHead>
                <SortableTableHead
                  className="text-right" style={{ width: largura('valor_unitario') }} numeric
                  ativo={sortColuna === 'valor_unitario'} direcao={sortDirecao} onClick={() => handleSort('valor_unitario')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('valor_unitario', largura('valor_unitario'))} />}
                >Valor Unit.</SortableTableHead>
                <SortableTableHead
                  className="text-right" style={{ width: largura('valor_total') }} numeric
                  ativo={sortColuna === 'valor_total'} direcao={sortDirecao} onClick={() => handleSort('valor_total')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('valor_total', largura('valor_total'))} />}
                >Valor Total</SortableTableHead>
                <SortableTableHead
                  style={{ width: largura('centro_custo') }}
                  ativo={sortColuna === 'centro_custo'} direcao={sortDirecao} onClick={() => handleSort('centro_custo')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('centro_custo', largura('centro_custo'))} />}
                >Centro de Custo</SortableTableHead>
                <SortableTableHead
                  style={{ width: largura('data_emissao') }}
                  ativo={sortColuna === 'data_emissao'} direcao={sortDirecao} onClick={() => handleSort('data_emissao')}
                  resizeHandle={<ColumnResizeHandle onPointerDown={iniciarArrasto('data_emissao', largura('data_emissao'))} />}
                >Data</SortableTableHead>
                <TableHead className="w-[72px]" />
                <TableHead className="w-[36px]">
                  <input
                    type="checkbox"
                    aria-label={todosVisiveisSelecionados ? 'Desmarcar todos os itens visíveis' : 'Marcar todos os itens visíveis'}
                    className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    checked={todosVisiveisSelecionados}
                    disabled={idsSelecionaveisVisiveis.length === 0}
                    onChange={() => setSelecionados(prev => {
                      if (todosVisiveisSelecionados) {
                        const novo = new Set(prev)
                        idsSelecionaveisVisiveis.forEach(id => novo.delete(id))
                        return novo
                      }
                      return new Set([...prev, ...idsSelecionaveisVisiveis])
                    })}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itensFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                    <p>Nenhum lançamento encontrado{filtroMes !== 'todos' ? ' neste mês' : ''}.</p>
                    {filtroMes !== 'todos' && (
                      <Button
                        variant="link"
                        size="sm"
                        className="mt-1"
                        onClick={() => { setFiltroMes('todos'); setUrlParam('mes', 'todos', MES_PADRAO) }}
                      >
                        Ver todos os meses
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : gruposExibidos.map(grupo => {
                const multiplo = grupo.itens.length > 1

                if (!multiplo) {
                  const item = grupo.itens[0]
                  const fornecedorConta = item.origem === 'conta' ? separarFornecedorDaConta(item.descricao).fornecedor : null
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm w-[160px]">
                        {item.origem === 'cartao' ? (
                          <Badge variant="secondary" className="text-xs">
                            {item.cartao_apelido ?? 'Cartão'}
                          </Badge>
                        ) : item.origem === 'conta' && fornecedorConta ? (
                          <div>
                            <p className="font-medium text-sm whitespace-normal break-words">{fornecedorConta}</p>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-50 text-emerald-700 border-emerald-200">
                              Conta paga
                            </Badge>
                          </div>
                        ) : item.origem === 'conta' ? (
                          <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                            Conta paga
                          </Badge>
                        ) : item.origem === 'manual' ? (
                          <span className="text-xs text-muted-foreground italic">Manual</span>
                        ) : (
                          <OrigemNfeCell item={item} />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-sm whitespace-normal break-words">
                        {textoDescricaoExibido(item)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {item.quantidade} {item.unidade}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmtBRL(item.valor_unitario)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">{fmtBRL(item.valor_total)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge
                            variant="outline"
                            className={`capitalize text-xs ${CENTRO_CUSTO_STYLE[item.centro_custo] ?? CENTRO_CUSTO_STYLE.outro}`}
                          >
                            {tipoLabel(item.centro_custo)}
                          </Badge>
                          {/* conta_como_compra === false: o item fica na lista (o
                              dono precisa continuar vendo que ele existe), mas não
                              soma no Total de Despesas nem no gráfico — este crachá
                              explica por quê, em português simples, sem código fiscal. */}
                          {item.conta_como_compra === false && (
                            <Tooltip>
                              <TooltipTrigger className="cursor-default bg-transparent border-0 p-0">
                                <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 border-slate-200">
                                  Não conta como gasto
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                Este item não entra no total porque o valor já foi cobrado em
                                outra nota, foi recebido sem custo (bonificação/amostra), ou é
                                mercadoria que só passou pela fazenda sem virar compra.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {item.data_emissao ? fmtDate(item.data_emissao) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          {item.source_table === 'itens_nfe' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Editar lançamento"
                              className="hover:bg-blue-50 hover:text-blue-600"
                              onClick={() => abrirEdicao(item)}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                          {item.origem === 'conta' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Editar lançamento"
                              className="hover:bg-blue-50 hover:text-blue-600"
                              onClick={() => abrirEditarConta(item)}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Excluir lançamento"
                            className="hover:bg-red-50 hover:text-red-600 text-red-400"
                            onClick={() => setDeleteItem(item)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        {itemSelecionavel(item) && (
                          <input
                            type="checkbox"
                            aria-label="Selecionar este lançamento"
                            className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                            checked={selecionados.has(item.id)}
                            onChange={() => toggleSelecionado(item.id)}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                }

                const expandido = notasExpandidas.has(grupo.chave)
                const primeiro = grupo.itens[0]
                const valorTotalGrupo = grupo.itens.reduce((s, i) => s + i.valor_total, 0)
                const categoriasGrupo = Array.from(new Set(grupo.itens.map(i => i.centro_custo)))
                const temItemQueNaoConta = grupo.itens.some(i => i.conta_como_compra === false)

                const idsDoGrupo = grupo.itens.map(i => i.id)
                const grupoTodoSelecionado = idsDoGrupo.every(id => selecionados.has(id))

                return (
                  <Fragment key={grupo.chave}>
                    <TableRow className="bg-sky-100/70 has-aria-expanded:bg-sky-100/70 hover:bg-sky-200/70 has-aria-expanded:hover:bg-sky-200/70">
                      <TableCell className="text-sm w-[180px]">
                        <div>
                          <p className="font-medium text-sm whitespace-normal break-words">{primeiro.emitente_nome}</p>
                          <p className="text-xs text-muted-foreground">NF {primeiro.nota_numero}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        <button
                          type="button"
                          onClick={() => toggleNota(grupo.chave)}
                          aria-expanded={expandido}
                          aria-label={`${expandido ? 'Recolher' : 'Expandir'} os ${grupo.itens.length} itens desta nota`}
                          className="inline-flex items-center gap-1.5 text-left hover:text-foreground transition-colors"
                        >
                          {expandido
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                          {grupo.itens.length} itens desta nota
                        </button>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">{fmtBRL(valorTotalGrupo)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {categoriasGrupo.map(c => (
                            <Badge
                              key={c}
                              variant="outline"
                              className={`capitalize text-xs ${CENTRO_CUSTO_STYLE[c] ?? CENTRO_CUSTO_STYLE.outro}`}
                            >
                              {tipoLabel(c)}
                            </Badge>
                          ))}
                          {temItemQueNaoConta && (
                            <Tooltip>
                              <TooltipTrigger className="cursor-default bg-transparent border-0 p-0">
                                <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 border-slate-200">
                                  Inclui item que não conta como gasto
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                Um ou mais itens desta nota não entram no Total de Despesas — o valor
                                já foi cobrado em outra nota, foi recebido sem custo (bonificação/amostra),
                                ou é mercadoria que só passou pela fazenda sem virar compra. Expanda a
                                nota pra ver qual item é.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {primeiro.data_emissao ? fmtDate(primeiro.data_emissao) : '—'}
                      </TableCell>
                      <TableCell />
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={grupoTodoSelecionado ? 'Desmarcar todos os itens desta nota' : 'Marcar todos os itens desta nota'}
                          className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                          checked={grupoTodoSelecionado}
                          onChange={() => toggleGrupoSelecionado(idsDoGrupo)}
                        />
                      </TableCell>
                    </TableRow>
                    {expandido && grupo.itens.map(item => (
                      <TableRow key={item.id} className="bg-sky-100 hover:bg-sky-200/70">
                        <TableCell className="text-sm w-[160px]">
                          {item.origem === 'cartao' ? (
                            <Badge variant="secondary" className="text-xs">
                              {item.cartao_apelido ?? 'Cartão'}
                            </Badge>
                          ) : item.origem === 'conta' ? (
                            <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                              Conta paga
                            </Badge>
                          ) : item.origem === 'manual' ? (
                            <span className="text-xs text-muted-foreground italic">Manual</span>
                          ) : (
                            <OrigemNfeCell item={item} />
                          )}
                        </TableCell>
                        <TableCell className="font-medium text-sm whitespace-normal break-words">
                          {item.descricao}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {item.quantidade} {item.unidade}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{fmtBRL(item.valor_unitario)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">{fmtBRL(item.valor_total)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <Badge
                              variant="outline"
                              className={`capitalize text-xs ${CENTRO_CUSTO_STYLE[item.centro_custo] ?? CENTRO_CUSTO_STYLE.outro}`}
                            >
                              {tipoLabel(item.centro_custo)}
                            </Badge>
                            {/* conta_como_compra === false: o item fica na lista (o
                                dono precisa continuar vendo que ele existe), mas não
                                soma no Total de Despesas nem no gráfico — este crachá
                                explica por quê, em português simples, sem código fiscal. */}
                            {item.conta_como_compra === false && (
                              <Tooltip>
                                <TooltipTrigger className="cursor-default bg-transparent border-0 p-0">
                                  <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 border-slate-200">
                                    Não conta como gasto
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs text-xs">
                                  Este item não entra no total porque o valor já foi cobrado em
                                  outra nota, foi recebido sem custo (bonificação/amostra), ou é
                                  mercadoria que só passou pela fazenda sem virar compra.
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {item.data_emissao ? fmtDate(item.data_emissao) : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-0.5">
                            {item.source_table === 'itens_nfe' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Editar lançamento"
                                className="hover:bg-blue-50 hover:text-blue-600"
                                onClick={() => abrirEdicao(item)}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Excluir lançamento"
                              className="hover:bg-red-50 hover:text-red-600 text-red-400"
                              onClick={() => setDeleteItem(item)}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          {itemSelecionavel(item) && (
                            <input
                              type="checkbox"
                              aria-label="Selecionar este item"
                              className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                              checked={selecionados.has(item.id)}
                              onChange={() => toggleSelecionado(item.id)}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                )
              })}
            </TableBody>
            {itensFiltrados.length > 0 && (
              <TableFooter>
                <TableRow>
                  {/* itensQueContam, mesma razão do KPI lá em cima: o total em
                      dinheiro é a soma só dos itens que contam como gasto —
                      contar a lista inteira aqui diria um número que o valor
                      ao lado não sustenta. */}
                  <TableCell colSpan={4} className="text-right text-sm font-semibold text-muted-foreground py-3">
                    Total ({itensQueContam.length} {itensQueContam.length === 1 ? 'item' : 'itens'})
                  </TableCell>
                  <TableCell className="text-right text-sm font-bold py-3 tabular-nums">
                    {fmtBRL(totalGeral)}
                  </TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
          {grupos.length > visivelCount && (
            <div className="text-center py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisivelCount(c => c + 20)}
              >
                Carregar mais {Math.min(20, grupos.length - visivelCount)}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addDialog} onOpenChange={open => { if (!open) { setAddDialog(false); setAddErro(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar Lançamento</DialogTitle></DialogHeader>
          <FormFields form={form} setForm={setForm} />
          {addErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {addErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialog(false); setAddErro(null) }}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={salvando || !form.descricao || !form.valor_unitario}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={open => { if (!open) { setEditItem(null); setEditErro(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Lançamento</DialogTitle></DialogHeader>
          {/* `original={editItem}` é o que faz o rodapé mostrar o total GRAVADO
              em vez do produto `qtd × unit` — e avisar quando ele vai mudar. */}
          <FormFields form={form} setForm={setForm} original={editItem ?? undefined} />
          {editErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {editErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={salvando || !form.descricao || !form.valor_unitario}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conta paga: sem quantidade/unidade aqui (lancamentos_financeiros tem só
          um valor por linha, não item×preço como itens_nfe) — ver
          handleEditarConta. Diálogo separado do "Editar Lançamento" de
          propósito, pra não confundir com campos que não se aplicam. */}
      <Dialog open={!!editContaItem} onOpenChange={open => { if (!open) { setEditContaItem(null); setEditContaErro(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar lançamento (conta paga)</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input
              value={editContaForm.descricao}
              onChange={e => setEditContaForm(f => ({ ...f, descricao: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fornecedor</Label>
            <Input
              placeholder="Opcional"
              value={editContaForm.fornecedor}
              onChange={e => setEditContaForm(f => ({ ...f, fornecedor: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Valor (R$)</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0,00"
                value={editContaForm.valor}
                onChange={e => setEditContaForm(f => ({ ...f, valor: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input
                type="date"
                value={editContaForm.data}
                onChange={e => setEditContaForm(f => ({ ...f, data: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Centro de Custo</Label>
              <Select value={editContaForm.categoria} onValueChange={v => setEditContaForm(f => ({ ...f, categoria: v ?? 'outro' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* Este lançamento veio de uma conta paga em Contas a Pagar — editar
              aqui NÃO muda a conta original lá (são gravados separados desde o
              pagamento). Mesmo aviso, na direção oposta do dialog de Contas. */}
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Este gasto veio de uma conta marcada como paga em Contas a Pagar. Editar aqui
            não muda a conta original por lá — são registros separados. Se depois você
            usar &quot;Desfazer pagamento&quot; naquela conta, esta correção se perde: o
            lançamento é apagado e, ao pagar de novo, nasce com os dados de lá.
          </p>
          {editContaErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {editContaErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditContaItem(null)}>Cancelar</Button>
            <Button onClick={handleEditarConta} disabled={salvando || !editContaForm.descricao.trim()}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteItem} onOpenChange={open => { if (!open) { setDeleteItem(null); setDeleteErro(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir lançamento?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deleteItem?.descricao}</span> será removido permanentemente.
            {/* Só item de nota fiscal mesmo. A condição antiga era só
                `!is_manual`, e caía também em lançamento de cartão — e agora
                cairia em conta paga — avisando de uma NF-e que não existe. */}
            {deleteItem?.source_table === 'itens_nfe' && !deleteItem?.is_manual && (
              <span className="block mt-1 text-yellow-600">
                Este item veio de uma NF-e. A nota em si não será excluída.
              </span>
            )}
            {deleteItem?.origem === 'conta' && (
              <span className="block mt-1 text-yellow-600">
                Este gasto veio de uma conta marcada como paga em Contas a Pagar.
                A conta continuará aparecendo como paga por lá — para desfazer de
                verdade, use &quot;Desfazer pagamento&quot; na tela de contas.
              </span>
            )}
          </p>
          {deleteErro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {deleteErro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteItem(null); setDeleteErro(null) }}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={salvando}>
              {salvando ? 'Excluindo…' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-40 bg-muted rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
      </div>
      <div className="h-72 bg-muted rounded-xl" />
    </div>
  )
}

// Renderizado no lugar da tela inteira quando o carregamento falha — nunca
// junto dos cartões de KPI, para não deixar "R$ 0,00" aparecer ao lado do
// aviso. Um dado incerto sobre dinheiro é pior que nenhum dado.
function ErroCarregamento({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="p-6">
      <Card className="border-amber-200">
        <CardContent className="flex flex-col items-center text-center gap-3 py-12">
          <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Não foi possível carregar o Financeiro</p>
            <p className="text-sm text-muted-foreground max-w-md">
              Os lançamentos não carregaram agora. Nenhum valor desta tela pode ser
              considerado correto até carregar de novo — não é que não há gastos.
            </p>
          </div>
          <Button size="sm" onClick={onRetry}>Tentar novamente</Button>
        </CardContent>
      </Card>
    </div>
  )
}
