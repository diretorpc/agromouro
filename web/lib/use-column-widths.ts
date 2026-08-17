'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ColunaLargura = { id: string; padrao: number }

const LARGURA_MINIMA = 60

function chaveStorage(tableId: string) {
  return `agromouro:larguras:${tableId}`
}

function lerSalvo(tableId: string): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const bruto = window.localStorage.getItem(chaveStorage(tableId))
    if (!bruto) return {}
    const json: unknown = JSON.parse(bruto)
    if (json && typeof json === 'object') return json as Record<string, number>
    return {}
  } catch {
    return {}
  }
}

// Largura de cada coluna de uma tabela, arrastável pela borda e salva no
// navegador (localStorage, não banco — ver design 2026-08-17). `tableId`
// isola a largura salva de uma tela pra não vazar pra outra tabela.
export function useColumnWidths(tableId: string, colunas: ColunaLargura[]) {
  const padraoPorId = useRef(new Map(colunas.map(c => [c.id, c.padrao])))

  const [larguras, setLarguras] = useState<Record<string, number>>(() => {
    const salvo = lerSalvo(tableId)
    const inicial: Record<string, number> = {}
    for (const c of colunas) inicial[c.id] = salvo[c.id] ?? c.padrao
    return inicial
  })

  const arrastoRef = useRef<{ id: string; xInicial: number; larguraInicial: number } | null>(null)

  useEffect(() => {
    function mover(e: PointerEvent) {
      const a = arrastoRef.current
      if (!a) return
      const delta = e.clientX - a.xInicial
      const nova = Math.max(LARGURA_MINIMA, a.larguraInicial + delta)
      setLarguras(prev => (prev[a.id] === nova ? prev : { ...prev, [a.id]: nova }))
    }
    function soltar() {
      if (!arrastoRef.current) return
      arrastoRef.current = null
      setLarguras(prev => {
        try {
          window.localStorage.setItem(chaveStorage(tableId), JSON.stringify(prev))
        } catch {
          // localStorage indisponível (modo privado, cota cheia) — a largura só
          // não persiste; a tabela continua funcionando normalmente na sessão.
        }
        return prev
      })
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
    }
  }, [tableId])

  const iniciarArrasto = useCallback((id: string, larguraAtual: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    arrastoRef.current = { id, xInicial: e.clientX, larguraInicial: larguraAtual }
  }, [])

  const largura = useCallback(
    (id: string) => larguras[id] ?? padraoPorId.current.get(id) ?? LARGURA_MINIMA,
    [larguras]
  )

  return { largura, iniciarArrasto }
}
