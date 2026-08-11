"use client"

import * as React from "react"
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"

import { cn } from "@/lib/utils"

type ComboboxProps = {
  value: string
  onValueChange: (value: string) => void
  items: string[]
  placeholder?: string
  className?: string
}

// Campo de texto livre com sugestões — usado onde o valor não vem de uma
// lista fechada (ex: categoria de conta), mas já existem valores digitados
// antes que valem a pena sugerir de novo.
//
// Sem `openOnInputClick` de propósito (achado do Apolo, 11/08/2026): com ele
// ligado, um simples clique no campo abre a lista de sugestões — e em diálogo
// pequeno (max-w-md) essa lista pode cobrir o botão Salvar. Um clique que o
// usuário mira no botão acerta um item da lista em vez disso: nada é salvo
// (sem erro nenhum), e o clique seguinte salva com a categoria errada, calado.
// Sem este prop, a lista só abre enquanto a pessoa digita.
//
// Comportamento conhecido e aceito, não corrigido: com texto digitado, a
// tecla Esc precisa de 2-3 toques em vez de 1 (a lib limpa o texto no meio do
// caminho antes de fechar o diálogo) — vem de dentro de @base-ui/react, sem
// prop pra desligar.
function Combobox({ value, onValueChange, items, placeholder, className }: ComboboxProps) {
  return (
    <AutocompletePrimitive.Root
      items={items}
      value={value}
      onValueChange={onValueChange}
    >
      <AutocompletePrimitive.Input
        data-slot="combobox-input"
        placeholder={placeholder}
        className={cn(
          "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30",
          className
        )}
      />
      <AutocompletePrimitive.Portal>
        {/* data-empty:hidden — lista sem nenhuma sugestão parecida não abre
            popup nenhum: uma caixa vazia só pra dizer "nada encontrado" fica
            em cima de campo vizinho (ex: Valor) e rouba o clique/toque de
            quem está preenchendo o formulário. */}
        <AutocompletePrimitive.Positioner sideOffset={4} align="start" className="isolate z-50 outline-none data-empty:hidden">
          <AutocompletePrimitive.Popup className="max-h-64 w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <AutocompletePrimitive.List>
              {(item: string) => (
                <AutocompletePrimitive.Item
                  key={item}
                  value={item}
                  className="relative flex w-full cursor-default items-center rounded-md px-2 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  {item}
                </AutocompletePrimitive.Item>
              )}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  )
}

export { Combobox }
