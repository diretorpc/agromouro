'use client'

import {
  createContext, useContext, useState, useEffect,
  useCallback, ReactNode
} from 'react'
import { supabase } from '@/lib/supabase'

interface Fazenda {
  id: string
  nome: string
  codigo: string
  estado: string
  municipio?: string | null
}

interface FazendaContextType {
  fazendaAtiva: Fazenda | null
  fazendas: Fazenda[]
  switchFazenda: (fazendaId: string) => Promise<void>
  loading: boolean
}

const FazendaContext = createContext<FazendaContextType | null>(null)

export function FazendaProvider({ children }: { children: ReactNode }) {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaAtiva, setFazendaAtiva] = useState<Fazenda | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setLoading(false); return }

      const fazendaAtivaId: string | undefined =
        session.user.app_metadata?.fazenda_ativa_id

      const { data } = await supabase
        .from('fazendas')
        .select('id, nome, codigo, estado, municipio')
        .order('estado')

      if (!data || data.length === 0) { setLoading(false); return }

      setFazendas(data)

      const ativa = data.find(f => f.id === fazendaAtivaId) ?? data[0]
      setFazendaAtiva(ativa)

      // Primeiro login: inicializar fazenda_ativa_id no JWT
      if (!fazendaAtivaId) {
        await supabase.functions.invoke('switch-farm', {
          body: { fazenda_id: ativa.id }
        })
        await supabase.auth.refreshSession()
      }

      setLoading(false)
    }
    init()
  }, [])

  const switchFazenda = useCallback(async (fazendaId: string) => {
    const { error } = await supabase.functions.invoke('switch-farm', {
      body: { fazenda_id: fazendaId }
    })
    if (error) throw error

    // Atualizar JWT local com novo fazenda_ativa_id
    await supabase.auth.refreshSession()

    const fazenda = fazendas.find(f => f.id === fazendaId) ?? null
    setFazendaAtiva(fazenda)

    // Forçar remount das páginas para refazer queries com o novo JWT
    window.location.reload()
  }, [fazendas])

  return (
    <FazendaContext.Provider value={{ fazendaAtiva, fazendas, switchFazenda, loading }}>
      {children}
    </FazendaContext.Provider>
  )
}

export function useFazenda() {
  const ctx = useContext(FazendaContext)
  if (!ctx) throw new Error('useFazenda must be used inside FazendaProvider')
  return ctx
}
