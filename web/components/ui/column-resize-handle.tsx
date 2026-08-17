'use client'

type Props = {
  onPointerDown: (e: React.PointerEvent) => void
}

// Faixa fina na borda direita de um cabeçalho de coluna — arrastar muda a
// largura (ver web/lib/use-column-widths.ts). Fica sobreposta por cima do
// canto da célula (position: absolute), não disputa clique com o texto nem
// com o botão de ordenar do SortableTableHead porque ocupa só os últimos
// 6px da borda direita.
export function ColumnResizeHandle({ onPointerDown }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Arrastar para redimensionar a coluna"
      onPointerDown={onPointerDown}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40 active:bg-primary/60"
    />
  )
}
