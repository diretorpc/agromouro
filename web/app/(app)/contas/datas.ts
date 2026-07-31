// Datas do módulo de Contas a Pagar — compartilhado entre page.tsx e
// dialogo-vencimento.tsx. Nasceram duplicadas nos dois arquivos: se um mudasse
// a regra do fuso e o outro não, "atrasada" na lista podia discordar do aviso
// de "essa data já passou" no diálogo de informar vencimento.

// Hoje no fuso de São Paulo, como 'YYYY-MM-DD'.
// NÃO usar toISOString(): devolve UTC e vira o dia seguinte depois das 21h —
// defeito que este projeto já teve no Financeiro.
export function hojeISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export function diasEntre(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number)
  const [by, bm, bd] = bISO.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}
