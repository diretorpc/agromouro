import { normalizarCultura } from '@/lib/cultura'
import type { Talhao } from '@/lib/types'

/**
 * Talhão arrendado entra numa fatia PRÓPRIA, não na cultura dele.
 *
 * Por que fatia e não exclusão: o gráfico calcula a porcentagem sobre a soma das
 * próprias fatias, e o "ha total" logo acima soma TODOS os talhões. Excluir os
 * arrendados faria as duas coisas discordarem na mesma tela. A fatia nomeada
 * mantém a soma correta E impede confundir a cana da usina com a nossa.
 *
 * Comparado por STATUS, nunca pelo texto da cultura — uma cultura chamada
 * "arrendado" não pode sequestrar a fatia.
 */
export const FATIA_ARRENDADO = 'Arrendado'

export function agruparCulturasPorArea(
  talhoes: Talhao[],
): { name: string; value: number }[] {
  const porChave = talhoes.reduce<Record<string, number>>((acc, t) => {
    const chave = t.status === 'arrendado'
      ? FATIA_ARRENDADO
      : normalizarCultura(t.cultura_atual) ?? 'Sem cultura'
    acc[chave] = (acc[chave] ?? 0) + (t.area_ha ?? 0)
    return acc
  }, {})

  return Object.entries(porChave)
    .map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }))
    .sort((a, b) => b.value - a.value)
}
