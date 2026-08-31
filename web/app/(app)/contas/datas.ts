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

// "2026-08" -> "agosto de 2026". Estava só em page.tsx; subiu pra cá quando a
// exportação passou a precisar do mesmo texto dentro da planilha. Mês escrito
// de dois jeitos diferentes na tela e no arquivo faz quem confere duvidar se
// são o mesmo recorte.
export function labelMes(mes: string): string {
  const [y, mo] = mes.split('-')
  return new Date(+y, +mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
