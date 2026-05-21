'use client'

import { useEffect, useState } from 'react'
import { Bell, CheckCheck, Filter } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import type { Alerta } from '@/lib/types'

const NIVEL_STYLE: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700 border-blue-200',
  aviso: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  critico: 'bg-red-100 text-red-700 border-red-200',
}

export default function AlertasPage() {
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroNivel, setFiltroNivel] = useState('todos')
  const [filtroLido, setFiltroLido] = useState('nao_lido')
  const [marcando, setMarcando] = useState<string | null>(null)

  async function loadAlertas() {
    const data = await api.get<Alerta[]>('/alertas').catch(() => [] as Alerta[])
    setAlertas(data)
    setLoading(false)
  }

  useEffect(() => { loadAlertas() }, [])

  async function marcarLido(id: string) {
    setMarcando(id)
    await api.patch(`/alertas/${id}/lida`).catch(() => null)
    setAlertas(prev => prev.map(a => a.id === id ? { ...a, lido: true } : a))
    setMarcando(null)
  }

  async function marcarTodosLidos() {
    const naoLidos = alertas.filter(a => !a.lido)
    await Promise.all(naoLidos.map(a => api.patch(`/alertas/${a.id}/lida`).catch(() => null)))
    setAlertas(prev => prev.map(a => ({ ...a, lido: true })))
  }

  const filtrados = alertas.filter(a => {
    const passaNivel = filtroNivel === 'todos' || a.nivel === filtroNivel
    const passaLido = filtroLido === 'todos' || (filtroLido === 'nao_lido' && !a.lido) || (filtroLido === 'lido' && a.lido)
    return passaNivel && passaLido
  })

  const naoLidosCount = alertas.filter(a => !a.lido).length

  if (loading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Alertas</h1>
          {naoLidosCount > 0 && (
            <Badge className="bg-orange-500 hover:bg-orange-500 text-white">
              {naoLidosCount} não {naoLidosCount === 1 ? 'lido' : 'lidos'}
            </Badge>
          )}
        </div>
        {naoLidosCount > 0 && (
          <Button size="sm" variant="outline" onClick={marcarTodosLidos}>
            <CheckCheck className="h-4 w-4 mr-1.5" />
            Marcar todos como lidos
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

        <Select value={filtroNivel} onValueChange={v => setFiltroNivel(v ?? 'todos')}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os níveis</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="aviso">Aviso</SelectItem>
            <SelectItem value="critico">Crítico</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filtroLido} onValueChange={v => setFiltroLido(v ?? 'nao_lido')}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nao_lido">Não lidos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="lido">Lidos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {filtrados.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Bell className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum alerta encontrado.</p>
            </CardContent>
          </Card>
        ) : filtrados.map(alerta => (
          <Card
            key={alerta.id}
            className={`transition-opacity ${alerta.lido ? 'opacity-60' : ''} ${alerta.nivel === 'critico' ? 'border-red-200' : alerta.nivel === 'aviso' ? 'border-yellow-200' : ''}`}
          >
            <CardContent className="flex items-start gap-4 py-4">
              <div className="mt-0.5 shrink-0">
                <Badge variant="outline" className={NIVEL_STYLE[alerta.nivel] ?? ''}>
                  {alerta.nivel}
                </Badge>
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{alerta.titulo}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{alerta.mensagem}</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {new Date(alerta.created_at).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {alerta.enviado_whatsapp && (
                    <span className="ml-2 text-green-600">· enviado via WhatsApp</span>
                  )}
                </p>
              </div>

              {!alerta.lido && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={marcando === alerta.id}
                  onClick={() => marcarLido(alerta.id)}
                  className="shrink-0"
                >
                  {marcando === alerta.id ? '...' : 'Marcar lido'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-24 bg-muted rounded" />
      <div className="flex gap-3">
        <div className="h-10 w-36 bg-muted rounded" />
        <div className="h-10 w-36 bg-muted rounded" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-muted rounded-xl" />
        ))}
      </div>
    </div>
  )
}
