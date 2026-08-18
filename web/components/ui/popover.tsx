"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverPortal({ ...props }: PopoverPrimitive.Portal.Props) {
  return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

/**
 * Conteúdo do popover. Compõe Portal + Positioner + Popup aqui dentro, do mesmo
 * jeito que `DialogContent` compõe Portal + Backdrop + Popup — quem usa só
 * escreve `<Popover><PopoverTrigger/><PopoverContent/></Popover>`.
 *
 * O PORTAL é o motivo de este arquivo existir: ele tira o popup da árvore do
 * componente que o abriu e ancora no `<body>`. Um menu aberto de dentro de um
 * contêiner com `overflow` (o `<Table>` embrulha a tabela num `div
 * overflow-x-auto`) fica RECORTADO se for um `div absolute` local; portado, não.
 *
 * Sem backdrop de propósito: popover não é modal (`modal` padrão = false), a
 * página continua interativa e clicar fora fecha por conta do base-ui.
 */
function PopoverContent({
  className,
  align = "start",
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <PopoverPortal>
      <PopoverPrimitive.Positioner
        data-slot="popover-positioner"
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-56 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPortal>
  )
}

export { Popover, PopoverClose, PopoverContent, PopoverPortal, PopoverTrigger }
