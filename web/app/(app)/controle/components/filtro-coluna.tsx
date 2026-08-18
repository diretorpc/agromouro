'use client'

import { useState } from 'react'
import { Filter } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type FiltroColunaProps = {
  label: string
  valores: string[]
  selecionados: string[]
  onChange: (novos: string[]) => void
}

// Menu de filtro por coluna, estilo Excel/planilha: busca + checkbox de valores
// únicos, com seleção MÚLTIPLA (marcar um valor não fecha o menu — marcar dois
// fornecedores seguidos é o caso de uso que motivou o filtro combinado, decisão
// #8 do design).
//
// Usa o Popover de @base-ui/react (mesmo pacote de onde vem o Dialog do projeto)
// por um motivo concreto, não por gosto: ele renderiza o menu num PORTAL, fora da
// árvore do `<div class="relative w-full overflow-x-auto">` que o componente
// `<Table>` cria. A versão anterior era um `<div absolute>` dentro do
// `<TableHead>` e ficava recortada por esse overflow sempre que a tabela tinha
// poucas linhas — o menu abria "dentro" da tabela e sumia atrás da borda/barra de
// rolagem. De brinde vêm Esc para fechar, `aria-haspopup`/`aria-expanded`/
// `aria-controls` no botão e devolução do foco ao gatilho quando fecha.
export function FiltroColuna({ label, valores, selecionados, onChange }: FiltroColunaProps) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')

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
    <Popover
      open={aberto}
      // Controlado só pra zerar a busca ao fechar: o componente NÃO desmonta
      // entre trocas de filtro (a tela mantém a tabela montada de propósito), e
      // sem isso o texto digitado na busca sobreviveria até a próxima abertura.
      onOpenChange={proximo => { setAberto(proximo); if (!proximo) setBusca('') }}
    >
      <PopoverTrigger
        className={cn(
          'inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium hover:bg-muted',
          ativo && 'text-primary',
        )}
        aria-label={`Filtrar por ${label}`}
      >
        {label}
        <Filter className={cn('h-3 w-3', ativo && 'fill-current')} aria-hidden="true" />
      </PopoverTrigger>

      <PopoverContent>
        {valores.length > 8 && (
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="mb-2 w-full rounded border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Buscar em ${label}`}
          />
        )}
        <div className="max-h-52 space-y-0.5 overflow-y-auto">
          {valoresFiltrados.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">Nenhum valor encontrado.</p>
          )}
          {valoresFiltrados.map(valor => (
            <label key={valor} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
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
      </PopoverContent>
    </Popover>
  )
}
