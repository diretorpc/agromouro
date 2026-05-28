'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { MapPin, Plus, Trash2, Layers, Sprout, Upload, CheckCircle2, AlertCircle } from 'lucide-react'
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
async function parseKMZ(file: File): Promise<Record<string, [number, number][]>> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(file)

  const kmlEntry = Object.values(zip.files).find(f => f.name.endsWith('.kml'))
  if (!kmlEntry) throw new Error('Arquivo KML não encontrado dentro do KMZ.')

  const kmlText = await kmlEntry.async('string')
  const doc = new DOMParser().parseFromString(kmlText, 'text/xml')

  const result: Record<string, [number, number][]> = {}

  doc.querySelectorAll('Placemark').forEach(pm => {
    const nome = pm.querySelector('name')?.textContent?.trim()
    const coordsEl = pm.querySelector('Polygon coordinates') ?? pm.querySelector('coordinates')
    if (!nome || !coordsEl) return

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

    if (coords.length > 2) result[nome] = coords
  })

  return result
}

// ─── Página ────────────────────────────────────────────────
export default function TalhoesPage() {
  const [talhoes, setTalhoes] = useState<Talhao[]>([])
  const [loading, setLoading] = useState(true)
  const kmzInputRef = useRef<HTMLInputElement>(null)

  // importar KMZ
  const [importando, setImportando] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: number; total: number; semMatch: string[] } | null>(null)

  // novo talhão
  const [novoDialog, setNovoDialog] = useState(false)
  const [novoForm, setNovoForm] = useState({
    nome: '', area_ha: '', cultura_atual: '', status: 'ativo' as Talhao['status'],
  })
  const [salvando, setSalvando] = useState(false)
  const [novoErro, setNovoErro] = useState<string | null>(null)

  // deletar
  const [deleteDialog, setDeleteDialog] = useState<Talhao | null>(null)
  const [deleteErro, setDeleteErro] = useState<string | null>(null)
  const [deletando, setDeletando] = useState(false)

  async function loadData() {
    const { data } = await supabase
      .from('talhoes')
      .select('id, nome, area_ha, cultura_atual, status, coordenadas')
      .order('nome')
    setTalhoes((data ?? []) as Talhao[])
    setLoading(false)
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
      const poligonos = await parseKMZ(file)
      const nomes = Object.keys(poligonos)

      let ok = 0
      const semMatch: string[] = []

      for (const nome of nomes) {
        const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')
        const talhao = talhoes.find(t => norm(t.nome) === norm(nome))
        if (!talhao) { semMatch.push(nome); continue }

        const { error } = await supabase
          .from('talhoes')
          .update({ coordenadas: poligonos[nome] })
          .eq('id', talhao.id)

        if (!error) ok++
      }

      setImportResult({ ok, total: nomes.length, semMatch })
      await loadData()
    } catch (err) {
      setImportResult({ ok: 0, total: 0, semMatch: [], })
    } finally {
      setImportando(false)
    }
  }

  // ── Novo talhão ──
  async function salvarNovo() {
    setNovoErro(null)
    const nome = novoForm.nome.trim()
    const area = parseFloat(novoForm.area_ha)

    if (!nome) return setNovoErro('Nome é obrigatório.')
    if (isNaN(area) || area <= 0) return setNovoErro('Área deve ser um número positivo.')

    setSalvando(true)
    const { error } = await supabase.from('talhoes').insert({
      nome,
      area_ha: area,
      status: novoForm.status,
      cultura_atual: novoForm.cultura_atual.trim() || null,
    })
    setSalvando(false)

    if (error) { setNovoErro('Erro ao salvar. Tente novamente.'); return }

    setNovoDialog(false)
    setNovoForm({ nome: '', area_ha: '', cultura_atual: '', status: 'ativo' })
    loadData()
  }

  // ── Deletar ──
  async function confirmarDelete() {
    if (!deleteDialog) return
    setDeleteErro(null)
    setDeletando(true)

    const { error } = await supabase.from('talhoes').delete().eq('id', deleteDialog.id)
    setDeletando(false)

    if (error) {
      setDeleteErro(error.code === '23503'
        ? 'Este talhão possui operações vinculadas e não pode ser excluído.'
        : 'Erro ao excluir. Tente novamente.')
      return
    }

    setDeleteDialog(null)
    loadData()
  }

  // ── Métricas ──
  const talhoesAtivos  = talhoes.filter(t => t.status === 'ativo')
  const areaTotal      = talhoes.reduce((s, t) => s + (t.area_ha ?? 0), 0)
  const culturas       = [...new Set(talhoes.map(t => t.cultura_atual).filter(Boolean))]
  const comMapa        = talhoes.filter(t => t.coordenadas && t.coordenadas.length > 2)

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
          value={talhoes.length}
          sub={`${talhoesAtivos.length} ativo${talhoesAtivos.length !== 1 ? 's' : ''}`}
          icon={<MapPin className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          label="Área Total"
          value={`${areaTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha`}
          sub={`${talhoes.length} talhão${talhoes.length !== 1 ? 'ões' : ''}`}
          icon={<Layers className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
        <KpiCard
          label="Culturas Ativas"
          value={culturas.length}
          sub={culturas.length > 0 ? culturas.join(', ') : 'nenhuma plantada'}
          icon={<Sprout className="h-5 w-5" />}
          iconBg="#EEF5E5" iconColor="#5B8C2A"
        />
      </div>

      {/* Mapa */}
      {comMapa.length > 0 && (
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Mapa — {comMapa.length} de {talhoes.length} talhão{talhoes.length !== 1 ? 'ões' : ''} mapeado{comMapa.length !== 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <MapaTalhoes talhoes={talhoes} />
          </CardContent>
        </Card>
      )}

      {/* Feedback importação */}
      {importResult && (
        <div className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${importResult.ok > 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {importResult.ok > 0
            ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">
              {importResult.ok > 0
                ? `${importResult.ok} de ${importResult.total} talhão${importResult.total !== 1 ? 'ões' : ''} mapeado${importResult.ok !== 1 ? 's' : ''} com sucesso.`
                : 'Nenhum talhão foi mapeado.'}
            </p>
            {importResult.semMatch.length > 0 && (
              <p className="mt-0.5 text-xs opacity-80">
                Sem correspondência: {importResult.semMatch.join(', ')}
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
                <Upload className="h-4 w-4 mr-1.5" />
                {importando ? 'Importando…' : 'Importar KMZ'}
              </Button>
              <Button size="sm" onClick={() => { setNovoErro(null); setNovoDialog(true) }}>
                <Plus className="h-4 w-4 mr-1.5" />
                Novo Talhão
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {talhoes.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-3 text-center">
              <MapPin className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground font-medium">Nenhum talhão cadastrado.</p>
              <Button variant="outline" size="sm" onClick={() => setNovoDialog(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
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
                  <TableHead className="w-14" />
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
                      <button
                        onClick={() => { setDeleteErro(null); setDeleteDialog(t) }}
                        className="p-1.5 rounded text-muted-foreground/50 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Excluir talhão"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog — novo talhão */}
      <Dialog open={novoDialog} onOpenChange={setNovoDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Talhão</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input placeholder="ex: Talhão 01" value={novoForm.nome}
                onChange={e => setNovoForm(f => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Área (ha) *</Label>
              <Input type="number" min="0" step="0.1" placeholder="ex: 120.5" value={novoForm.area_ha}
                onChange={e => setNovoForm(f => ({ ...f, area_ha: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <select className={SELECT_CLASS} value={novoForm.status}
                onChange={e => setNovoForm(f => ({ ...f, status: e.target.value as Talhao['status'] }))}>
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Cultura Atual <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Input placeholder="ex: soja" value={novoForm.cultura_atual}
                onChange={e => setNovoForm(f => ({ ...f, cultura_atual: e.target.value }))} />
            </div>
            {novoErro && <p className="text-sm text-red-600">{novoErro}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoDialog(false)}>Cancelar</Button>
            <Button onClick={salvarNovo} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
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
