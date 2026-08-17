'use client'

import { useEffect, useRef, useState } from 'react'
import { Filter } from 'lucide-react'
import { cn } from '@/lib/utils'

type FiltroColunaProps = {
  label: string
  valores: string[]
  selecionados: string[]
  onChange: (novos: string[]) => void
}

// Menu de filtro por coluna, estilo Excel/planilha: busca + checkbox de valores
// únicos. Implementação própria (não usa um Popover de biblioteca) — o projeto usa
// @base-ui/react, mas nenhum componente de popover posicionado está em uso em
// nenhuma outra tela hoje; um `useEffect` de "clicar fora fecha" é suficiente e
// evita introduzir uma dependência nova pra uma peça pequena.
export function FiltroColuna({ label, valores, selecionados, onChange }: FiltroColunaProps) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [])

  const valoresFiltrados = valores.filter(v => v.toLowerCase().includes(busca.toLowerCase()))
  const ativo = selecionados.length > 0

  function alternar(valor: string) {
    onChange(
      selecionados.includes(valor)
        ? selecionados.filter(v => v !== valor)
        : [...selecionados, valor],
    )
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium rounded px-1 py-0.5 hover:bg-muted',
          ativo && 'text-primary',
        )}
        aria-label={`Filtrar por ${label}`}
      >
        {label}
        <Filter className={cn('h-3 w-3', ativo && 'fill-current')} aria-hidden="true" />
      </button>

      {aberto && (
        <div className="absolute top-full left-0 z-20 mt-1 w-56 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
          {valores.length > 8 && (
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar..."
              className="mb-2 w-full rounded border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {valoresFiltrados.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-1">Nenhum valor encontrado.</p>
            )}
            {valoresFiltrados.map(valor => (
              <label key={valor} className="flex items-center gap-2 px-1 py-1 text-xs rounded hover:bg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={selecionados.includes(valor)}
                  onChange={() => alternar(valor)}
                  className="h-3.5 w-3.5"
                />
                <span className="truncate">{valor}</span>
              </label>
            ))}
          </div>
          {ativo && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 w-full text-left text-xs text-muted-foreground hover:text-foreground"
            >
              Limpar filtro
            </button>
          )}
        </div>
      )}
    </div>
  )
}
