import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Compartilhado entre dialogo-importar.tsx e tabela-documentos.tsx (ambos em
// web/app/(app)/controle) — duas telas de confirmação/resultado que precisam
// da mesma regra de plural em português. Centralizado aqui pra não divergir
// se um dia mudar (ex.: "nenhum item" no lugar de "0 itens").
export function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`
}
