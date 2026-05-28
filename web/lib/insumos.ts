export const TIPOS_INSUMO: Record<string, string> = {
  herbicida:       'Herbicida',
  fungicida:       'Fungicida',
  inseticida:      'Inseticida',
  fertilizante_n:  'Fertilizante N',
  fertilizante_p:  'Fertilizante P',
  fertilizante_k:  'Fertilizante K',
  semente:         'Semente',
  combustivel:     'Combustível',
  outro:           'Outro',
}

export function formatTipoInsumo(tipo: string): string {
  if (TIPOS_INSUMO[tipo]) return TIPOS_INSUMO[tipo]
  return tipo
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
