'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { MapPin, Plus, Pencil, Trash2, Layers, Sprout, Upload, CheckCircle2, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KpiCard } from '@/components/ui/kpi-card'
import { supabase } from '@/lib/supabase'
import { useFazenda } from '@/context/fazenda-context'
import { mensagemErroBanco, ehFalhaDeConexao } from '@/lib/erros-supabase'
import { normalizarCultura } from '@/lib/cultura'
import {
  prepararTalhao, mensagemErroSalvar, mensagemErroExcluir, gravouNada,
} from './salvar-talhao'
import type { Talhao } from '@/lib/types'

// Leaflet não funciona com SSR — importação dinâmica obrigatória
const MapaTalhoes = dynamic(() => import('@/components/mapa-talhoes'), { ssr: false })

const STATUS_OPTIONS: Talhao['status'][] = ['ativo', 'pousio', 'colhido']

const STATUS_STYLE: Record<Talhao['status'], { bg: string; color: string }> = {
  ativo:   { bg: '#EDFAF1', color: '#16A34A' },
  pousio:  { bg: '#FFFBEB', color: '#D97706' },
  colhido: { bg: '#F3F4F6', color: '#6B7280' },
}

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

// ─── Parser KMZ ────────────────────────────────────────────
// .kml é XML puro; .kmz é um zip com o .kml dentro. O input aceita os dois,
// e o JSZip morre com mensagem incompreensível se receber um .kml direto.
async function lerKml(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.kml')) return file.text()

  const JSZip = (await import('jszip')).default

  // O JSZip fala inglês de biblioteca ("Can't read the data of 'the loaded zip
  // file'…"). Nunca deixar essa frase chegar na tela do produtor.
  let zip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('O arquivo não é um KMZ válido (ou está corrompido).')
  }

  const kmlEntry = Object.values(zip.files).find(f => f.name.endsWith('.kml'))
  if (!kmlEntry) throw new Error('Arquivo KML não encontrado dentro do KMZ.')

  return kmlEntry.async('string')
}

interface LeituraKMZ {
  poligonos: Record<string, [number, number][]>
  /** Marcações do arquivo que não viraram talhão — o produtor precisa saber. */
  ignoradas: number
}

async function parseKMZ(file: File): Promise<LeituraKMZ> {
  const kmlText = await lerKml(file)
  const doc = new DOMParser().parseFromString(kmlText, 'text/xml')

  // XML malformado NÃO lança: por especificação o DOMParser devolve um
  // documento com <parsererror> dentro. Sem esta checagem o arquivo quebrado
  // vira "nenhum talhão mapeado", sem motivo nenhum na tela.
  if (doc.querySelector('parsererror')) {
    throw new Error('O arquivo não é um KML válido.')
  }

  const poligonos: Record<string, [number, number][]> = {}
  const placemarks = doc.querySelectorAll('Placemark')

  // Contados SEPARADAMENTE porque exigem conselhos opostos: "sem nome" se
  // resolve nomeando no Google Earth; "sem polígono" se resolve desenhando a
  // área. Uma frase só para os dois manda o produtor consertar o que não está
  // quebrado — e diagnóstico errado é pior que diagnóstico ausente.
  let semNome = 0
  let semPoligono = 0

  placemarks.forEach(pm => {
    const nome = pm.querySelector('name')?.textContent?.trim()
    const coordsEl = pm.querySelector('Polygon coordinates') ?? pm.querySelector('coordinates')

    if (!coordsEl) { semPoligono++; return }
    if (!nome) { semNome++; return }

    const coords: [number, number][] = coordsEl.textContent!
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .reduce<[number, number][]>((acc, c) => {
        const parts = c.split(',').map(Number)
        const lat = parts[1], lng = parts[0]
        if (!isNaN(lat) && !isNaN(lng)) acc.push([lat, lng])
        return acc
      }, [])

    if (coords.length > 2) poligonos[nome] = coords
    else semPoligono++
  })

  if (placemarks.length === 0) {
    throw new Error('O arquivo não tem nenhuma marcação.')
  }

  if (Object.keys(poligonos).length === 0) {
    // Frase SOMADA, não escolhida: 5 áreas sem nome + 1 marcador de ponto é
    // exportação realista do Google Earth, e escolher uma causa só diria
    // "nenhuma com contorno" para um arquivo que tem cinco contornos.
    const partes: string[] = []
    if (semNome > 0) {
      partes.push(`${semNome} área${semNome !== 1 ? 's' : ''} sem nome — nomeie cada uma no Google Earth com o nome do talhão`)
    }
    if (semPoligono > 0) {
      partes.push(`${semPoligono} marcaç${semPoligono !== 1 ? 'ões' : 'ão'} sem contorno de área`)
    }
    throw new Error(`Nada pôde ser importado: ${partes.join('; ')}.`)
  }

  return { poligonos, ignoradas: semNome + semPoligono }
}

// ─── Página ────────────────────────────────────────────────
export default function TalhoesPage() {
  const { fazendaAtiva } = useFazenda()
  const [talhoes, setTalhoes] = useState<Talhao[]>([])
  const [loading, setLoading] = useState(true)
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null)
  const [recarregando, setRecarregando] = useState(false)
  const cargaSeq = useRef(0)
  const kmzInputRef = useRef<HTMLInputElement>(null)

  // importar KMZ
  const [importando, setImportando] = useState(false)
  const [importResult, setImportResult] = useState<
    { ok: number; total: number; semMatch: string[]; falhou: string[]; ignoradas: number; erro?: string } | null
  >(null)

  // criar / editar talhão — mesmo dialog: editId null = criar, preenchido = editar
  const [formDialog, setFormDialog] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({
    nome: '', area_ha: '', cultura_atual: '', status: 'ativo' as Talhao['status'],
  })
  const [salvando, setSalvando] = useState(false)
  const [formErro, setFormErro] = useState<string | null>(null)

  // deletar
  const [deleteDialog, setDeleteDialog] = useState<Talhao | null>(null)
  const [deleteErro, setDeleteErro] = useState<string | null>(null)
  const [deletando, setDeletando] = useState(false)

  async function loadData() {
    const seq = ++cargaSeq.current
    setRecarregando(true)

    // `status` desestruturado de propósito: ele mora no ENVELOPE, não dentro do
    // erro, e é o que distingue "sem internet" de "apikey errada" / "sessão
    // vencida". Sem repassá-lo, a tela diagnostica rede em erro de servidor.
    const { data, error, status } = await supabase
      .from('talhoes')
      .select('id, nome, area_ha, cultura_atual, status, coordenadas')
      .order('nome')

    // Resposta atrasada não pode sobrescrever a mais recente. Com sinal ruim o
    // produtor clica "Tentar de novo" duas vezes: a 1ª (lenta, que vai falhar)
    // volta DEPOIS da 2ª (rápida, que deu certo) e traria a faixa de erro de
    // volta por cima de dados frescos, dizendo que são antigos.
    if (seq !== cargaSeq.current) return

    setRecarregando(false)
    setLoading(false)

    // Sem esta guarda, uma falha de rede virava lista vazia + convite a
    // "Cadastrar primeiro talhão" — e o produtor recadastrava o que já existe.
    if (error) {
      setErroCarregamento(mensagemErroBanco({ ...error, status }, 'talhão'))
      return
    }

    setErroCarregamento(null)
    setTalhoes((data ?? []) as Talhao[])
  }

  useEffect(() => { loadData() }, [])

  // ── Importar KMZ ──
  async function handleKMZ(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setImportando(true)
    setImportResult(null)

    try {
      const { poligonos, ignoradas } = await parseKMZ(file)
      const nomes = Object.keys(poligonos)

      let ok = 0
      const semMatch: string[] = []
      const falhou: string[] = []

      for (const nome of nomes) {
        const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')
        const talhao = talhoes.find(t => norm(t.nome) === norm(nome))
        if (!talhao) { semMatch.push(nome); continue }

        // `.select('id')` é obrigatório: sem ele o PostgREST responde 204 e o
        // update que não tocou em linha nenhuma fica indistinguível do que tocou.
        const { data, error, status } = await supabase
          .from('talhoes')
          .update({ coordenadas: poligonos[nome] })
          .eq('id', talhao.id)
          .select('id')

        // Se o que caiu foi o SINAL, abortar. Sem isso: (1) o laço seguia
        // disparando os restantes, cada um com ~7 s de retries do postgrest-js,
        // (2) o banner acusava a fazenda por um problema de rede e (3) o
        // loadData logo abaixo falhava e subia a faixa "sem conexão" — a tela
        // se contradizendo sozinha.
        if (error && ehFalhaDeConexao({ ...error, status })) {
          setImportResult({
            ok, total: nomes.length, semMatch, falhou, ignoradas,
            erro: 'A conexão caiu no meio da importação. Os que faltaram não foram gravados — tente de novo.',
          })
          return
        }

        if (error || gravouNada(error, data)) falhou.push(nome)
        else ok++
      }

      setImportResult({ ok, total: nomes.length, semMatch, falhou, ignoradas })
      await loadData()
    } catch (err) {
      setImportResult({
        ok: 0, total: 0, semMatch: [], falhou: [], ignoradas: 0,
        erro: err instanceof Error ? err.message : 'Não foi possível ler o arquivo.',
      })
    } finally {
      setImportando(false)
    }
  }

  // ── Abrir dialog ──
  function abrirNovo() {
    setEditId(null)
    setForm({ nome: '', area_ha: '', cultura_atual: '', status: 'ativo' })
    setFormErro(null)
    setFormDialog(true)
  }

  function abrirEdicao(t: Talhao) {
    setEditId(t.id)
    setForm({
      nome: t.nome,
      area_ha: String(t.area_ha),
      cultura_atual: t.cultura_atual ?? '',
      status: t.status,
    })
    setFormErro(null)
    setFormDialog(true)
  }

  // ── Criar / editar talhão ──
  async function salvar() {
    setFormErro(null)

    const preparo = prepararTalhao(form, fazendaAtiva?.id ?? null, editId)
    if (!preparo.ok) return setFormErro(preparo.erro)

    setSalvando(true)
    const { data, error, status } = editId
      ? await supabase.from('talhoes').update(preparo.payload).eq('id', editId).select('id')
      : await supabase.from('talhoes').insert(preparo.payload).select('id')
    setSalvando(false)

    if (error) { setFormErro(mensagemErroSalvar({ ...error, status })); return }
    if (gravouNada(error, data)) {
      setFormErro('Não foi possível salvar: nenhum talhão foi alterado. Confira a fazenda selecionada no topo da tela.')
      return
    }

    setFormDialog(false)
    loadData()
  }

  // ── Deletar ──
  async function confirmarDelete() {
    if (!deleteDialog) return
    setDeleteErro(null)
    setDeletando(true)

    const { data, error, status } = await supabase
      .from('talhoes').delete().eq('id', deleteDialog.id).select('id')
    setDeletando(false)

    if (error) { setDeleteErro(mensagemErroExcluir({ ...error, status })); return }
    if (gravouNada(error, data)) {
      setDeleteErro('Não foi possível excluir: nenhum talhão foi removido. Confira a fazenda selecionada no topo da tela.')
      return
    }

    setDeleteDialog(null)
    loadData()
  }

  // ── Métricas ──
  const talhoesAtivos  = talhoes.filter(t => t.status === 'ativo')
  const areaTotal      = talhoes.reduce((s, t) => s + (t.area_ha ?? 0), 0)
  // Normalizado: sem isso o KPI contava "cana" e "Cana" como duas culturas.
  const culturas       = [...new Set(talhoes.map(t => normalizarCultura(t.cultura_atual)).filter(Boolean))]
  const comMapa        = talhoes.filter(t => t.coordenadas && t.coordenadas.length > 2)

  // Erro de carregamento tem DOIS casos com tratamento oposto:
  // - sem nada em mãos  → não inventar número; KPI mostra "—" e a tabela vira erro.
  // - com dados na tela → não esconder o que já existe; erro vira faixa no topo.
  // Sem essa distinção a tela se contradiz sozinha (KPI diz 13, tabela diz que
  // falhou) ou exibe "0 ha" com cara de verdade numa fazenda de 2.107 ha.
  const semDados     = talhoes.length === 0
  const erroSemDados = !!erroCarregamento && semDados
  const erroComDados = !!erroCarregamento && !semDados

  if (loading) return <TalhoesSkeleton />

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Talhões</h1>
        <p className="text-sm text-muted-foreground mt-1 font-medium">
          Gestão das áreas e culturas da fazenda
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Talhões Cadastrados"
          value={erroSemDados ? '—' : talhoes.length}
          sub={erroSemDados ? 'não foi possível carregar' : `${talhoesAtivos.length} ativo${talhoesAtivos.length !== 1 ? 's' : ''}`}
          icon={<MapPin className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          label="Área Total"
          value={erroSemDados ? '—' : `${areaTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha`}
          sub={erroSemDados ? 'não foi possível carregar' : `${talhoes.length} talh${talhoes.length !== 1 ? 'ões' : 'ão'}`}
          icon={<Layers className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          label="Culturas Ativas"
          value={erroSemDados ? '—' : culturas.length}
          sub={erroSemDados ? 'não foi possível carregar' : (culturas.length > 0 ? culturas.join(', ') : 'nenhuma plantada')}
          icon={<Sprout className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
      </div>

      {/* Mapa */}
      {comMapa.length > 0 && (
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Mapa — {comMapa.length} de {talhoes.length} talh{talhoes.length !== 1 ? 'ões' : 'ão'} mapeado{comMapa.length !== 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <MapaTalhoes talhoes={talhoes} />
          </CardContent>
        </Card>
      )}

      {/* Falha ao atualizar, mas com dados já em mãos: avisa SEM esconder a lista */}
      {erroComDados && (
        <div className="flex items-start gap-3 rounded-lg px-4 py-3 text-sm bg-amber-50 text-amber-900">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">
              Não foi possível atualizar a lista — mostrando os dados carregados anteriormente.
            </p>
            <p className="mt-0.5 text-xs opacity-80">{erroCarregamento}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadData()} disabled={recarregando}>
            {recarregando ? 'Atualizando…' : 'Tentar de novo'}
          </Button>
        </div>
      )}

      {/* Feedback importação */}
      {importResult && (
        // Verde SÓ quando nada falhou: "N mapeados com sucesso" em verde com
        // uma lista de falhas logo abaixo é a tela mentindo para o produtor.
        <div className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${importResult.ok > 0 && importResult.falhou.length === 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {importResult.ok > 0 && importResult.falhou.length === 0
            ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">
              {importResult.ok > 0
                ? `${importResult.ok} de ${importResult.total} talh${importResult.total !== 1 ? 'ões' : 'ão'} mapeado${importResult.ok !== 1 ? 's' : ''} com sucesso.`
                : 'Nenhum talhão foi mapeado.'}
            </p>
            {importResult.erro && (
              <p className="mt-0.5 text-xs opacity-80">
                Motivo: {importResult.erro}
              </p>
            )}
            {importResult.semMatch.length > 0 && (
              <p className="mt-0.5 text-xs opacity-80">
                Sem correspondência: {importResult.semMatch.join(', ')}
              </p>
            )}
            {importResult.falhou.length > 0 && (
              <p className="mt-0.5 text-xs opacity-80">
                Não gravou (confira a fazenda selecionada): {importResult.falhou.join(', ')}
              </p>
            )}
            {importResult.ignoradas > 0 && (
              <p className="mt-0.5 text-xs opacity-80">
                {importResult.ignoradas} marcaç{importResult.ignoradas !== 1 ? 'ões' : 'ão'} do
                arquivo sem nome ou sem contorno de área — ignorada{importResult.ignoradas !== 1 ? 's' : ''}.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tabela */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Talhões
            </CardTitle>
            <div className="flex gap-2">
              <input
                ref={kmzInputRef}
                type="file"
                accept=".kmz,.kml"
                className="hidden"
                onChange={handleKMZ}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => kmzInputRef.current?.click()}
                disabled={importando}
              >
                <Upload className="h-4 w-4 mr-1.5" aria-hidden="true" />
                {importando ? 'Importando…' : 'Importar KMZ'}
              </Button>
              <Button size="sm" onClick={abrirNovo}>
                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Novo Talhão
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {erroSemDados ? (
            // Lista com erro NÃO mostra o estado vazio: o convite a "cadastrar
            // o primeiro talhão" numa falha de leitura gera cadastro duplicado.
            // Só entra aqui quando não há NADA em mãos — havendo dados, a faixa
            // no topo avisa e a tabela continua na tela.
            <div className="py-14 flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-10 w-10 text-red-500/40" />
              <p className="text-sm text-red-600 font-medium">Não foi possível carregar os talhões.</p>
              <p className="text-xs text-muted-foreground">{erroCarregamento}</p>
              <Button variant="outline" size="sm" onClick={() => { setLoading(true); loadData() }} disabled={recarregando}>
                {recarregando ? 'Atualizando…' : 'Tentar de novo'}
              </Button>
            </div>
          ) : talhoes.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-3 text-center">
              <MapPin className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground font-medium">Nenhum talhão cadastrado.</p>
              <Button variant="outline" size="sm" onClick={abrirNovo}>
                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Cadastrar primeiro talhão
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Área (ha)</TableHead>
                  <TableHead>Cultura Atual</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mapa</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {talhoes.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-semibold">{t.nome}</TableCell>
                    <TableCell>{t.area_ha.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {t.cultura_atual ?? <span className="text-muted-foreground/50 italic">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={STATUS_STYLE[t.status]}>
                        {t.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {t.coordenadas && t.coordenadas.length > 2
                        ? <span className="text-xs text-green-600 font-semibold">✓ mapeado</span>
                        : <span className="text-xs text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => abrirEdicao(t)}
                          className="p-1.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
                          aria-label="Editar talhão"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => { setDeleteErro(null); setDeleteDialog(t) }}
                          className="p-1.5 rounded text-muted-foreground/50 hover:text-red-600 hover:bg-red-50 transition-colors"
                          aria-label="Excluir talhão"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog — criar / editar talhão */}
      <Dialog open={formDialog} onOpenChange={setFormDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? 'Editar Talhão' : 'Novo Talhão'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input placeholder="ex: Talhão 01" value={form.nome}
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Área (ha) *</Label>
              <Input type="number" min="0" step="0.1" placeholder="ex: 120.5" value={form.area_ha}
                onChange={e => setForm(f => ({ ...f, area_ha: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <select className={SELECT_CLASS} value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as Talhao['status'] }))}>
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Cultura Atual <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Input placeholder="ex: soja" value={form.cultura_atual}
                onChange={e => setForm(f => ({ ...f, cultura_atual: e.target.value }))} />
            </div>
            {formErro && <p className="text-sm text-red-600">{formErro}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialog(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog — confirmar delete */}
      <Dialog open={!!deleteDialog} onOpenChange={v => { if (!v) setDeleteDialog(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir talhão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Tem certeza que deseja excluir <span className="font-semibold text-foreground">{deleteDialog?.nome}</span>?
            Esta ação não pode ser desfeita.
          </p>
          {deleteErro && <p className="text-sm text-red-600">{deleteErro}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarDelete} disabled={deletando}>
              {deletando ? 'Excluindo…' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TalhoesSkeleton() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="h-9 w-36 bg-muted rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
      </div>
      <div className="h-[480px] bg-muted rounded-xl" />
      <div className="h-64 bg-muted rounded-xl" />
    </div>
  )
}
