import { TIPOS_INSUMO } from '@/lib/insumos'

export const TIPOS: [string, string][] = Object.entries(TIPOS_INSUMO)

export const UNIDADES      = ['L', 'KG', 'ml', 't', 'sc', 'un']
export const UNIDADES_BASE = new Set(['L', 'KG', 'kg', 'ml', 'ML', 'g', 't', 'sc', 'un', 'UN', 'ha'])

export const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

export const ORIGENS: [string, string][] = [
  ['nfe',              'NF-e'],
  ['operacao',         'Operação'],
  ['whatsapp',         'WhatsApp'],
  ['manual',           'Manual'],
  ['correcao_unidade', 'Correção de unidade'],
]
