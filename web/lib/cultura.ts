// `talhoes.cultura_atual` é texto livre, sem enum nem constraint no banco. Sem
// normalizar, "Cana" e "cana" viram DUAS culturas — e como a tela exibe com
// `capitalize` e a cor é escolhida por nome normalizado, as duas aparecem com o
// mesmo rótulo e a mesma cor. Medido em 24/08/2026: o Dashboard mostrou duas
// fatias "Cana" (578,8 ha e 80,5 ha) e o KPI de Talhões contou 5 culturas
// existindo 4.
//
// Normaliza nos DOIS lados de propósito:
// - na gravação, para o banco parar de acumular divergência;
// - na leitura, porque o banco também é editado pelo SQL Editor e um dia o
//   WhatsApp pode gravar cultura.

/** Devolve a forma canônica (minúscula, aparada) ou null quando não há cultura. */
export function normalizarCultura(bruto: string | null | undefined): string | null {
  const limpo = bruto?.trim().toLowerCase()
  return limpo || null
}
