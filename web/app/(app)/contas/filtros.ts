// Quem entra e quem não entra na lista de Contas a Pagar.
//
// Saiu de `page.tsx` em 31/08/2026 por um motivo concreto: a exportação para
// Excel precisa DESCREVER este recorte por escrito dentro do arquivo, e a
// primeira versão dessa descrição foi copiada à mão daqui — já nascendo errada
// em 2 dos 7 filtros (achado 2 da rodada 2 do Apolo). Cópia à mão de regra que
// mora em outro arquivo diverge; era só questão de quando.
//
// Aqui não há React nem JSX, então `filtros.test.ts` exercita as funções DE
// VERDADE — e o mesmo teste confere que as ressalvas escritas em
// `exportar.ts` correspondem ao que estas funções realmente deixam passar.

import { diasEntre } from './datas'
import { ENCERRADAS, type ContaAPI } from './tipos'

export type FiltroStatus = 'todas' | 'sem-vencimento' | 'aguardando' | 'aberta' | 'atrasada' | 'paga' | 'dispensada'
export type FiltroTipo   = 'todos' | 'fixas' | 'nota'

export const FILTROS: { value: FiltroStatus; label: string }[] = [
  { value: 'todas',          label: 'Todas' },
  { value: 'sem-vencimento', label: 'Falta vencimento' },
  { value: 'aguardando',     label: 'Aguardando' },
  { value: 'aberta',         label: 'Abertas' },
  { value: 'atrasada',       label: 'Atrasadas' },
  { value: 'paga',           label: 'Pagas' },
  { value: 'dispensada',     label: 'Dispensadas' },
]

// Conta fixa veio de uma regra recorrente; boleto veio de uma nota fiscal.
// Nenhuma coluna nova no banco: a informação já existe nas duas chaves.
export const FILTROS_TIPO: { value: FiltroTipo; label: string }[] = [
  { value: 'todos', label: 'Todas' },
  { value: 'fixas', label: 'Contas fixas' },
  { value: 'nota',  label: 'Boletos de nota' },
]

export function contaBateTipo(c: ContaAPI, filtroTipo: FiltroTipo): boolean {
  if (filtroTipo === 'todos') return true
  if (filtroTipo === 'fixas') return c.nota_fiscal_id === null
  return c.nota_fiscal_id !== null
}

// "Todas" esconde dispensada sempre, e paga com mais de 30 dias (pedido de
// 10/08/2026): a aba deixa de ser um histórico infinito e vira "o que ainda
// pede atenção ou foi resolvido recentemente". Quem quiser o histórico
// completo de pagamento usa a aba "Pagas" — essa continua sem limite de data.
export function contaBateFiltro(c: ContaAPI, filtro: FiltroStatus, hoje: string): boolean {
  if (filtro === 'todas') {
    if (c.status === 'dispensada') return false
    if (c.status === 'paga')       return diasEntre(c.data_pagamento ?? hoje, hoje) <= 30
    return true
  }
  if (filtro === 'sem-vencimento') return !ENCERRADAS.has(c.status) && !c.vencimento
  if (filtro === 'atrasada')       return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
  return c.status === filtro
}

/**
 * De que MÊS esta conta é, no formato 'AAAA-MM'. `null` = não dá para dizer.
 *
 * Uma verdade só, usada pelo filtro de mês E pelo seletor de meses da tela.
 * Nasceu separada e quase custou caro: `contaBateMes` passou a jogar a conta
 * encerrada sem vencimento no mês do PAGAMENTO, mas o seletor continuou sendo
 * montado só a partir de `vencimento` — um boleto pago em março podia não ter
 * março na lista de meses e ficar inalcançável, visível só em "Todos os meses"
 * e sem nada avisando (achado 1 da rodada 3 do Apolo).
 *
 * Conta ENCERRADA cai na data do pagamento; conta em aberto, não. Encerrada não
 * pede ação nenhuma, e é o mesmo critério do card "Total de contas pagas"
 * (`vencimento ?? data_pagamento`) — antes disso, card e planilha mostravam
 * números diferentes para o mesmo recorte.
 */
export function mesDaConta(c: ContaAPI): string | null {
  if (c.vencimento) return c.vencimento.slice(0, 7)
  if (ENCERRADAS.has(c.status) && c.data_pagamento) return c.data_pagamento.slice(0, 7)
  return null
}

// Contas atrasadas e sem vencimento pedem ação urgente, então sempre aparecem —
// nunca somem por causa do filtro de mês (pedido do Matheus, 10/08/2026): esconder
// dívida ativa atrás de um filtro de data seria perigoso. Conta sem data nenhuma
// (nem vencimento, nem pagamento) também nunca some: sumir calada é pior.
export function contaBateMes(c: ContaAPI, filtroMes: string, hoje: string): boolean {
  if (filtroMes === 'todos') return true
  const mes = mesDaConta(c)
  if (!mes) return true
  if (!c.vencimento) return mes === filtroMes
  if (!ENCERRADAS.has(c.status) && diasEntre(hoje, c.vencimento) < 0) return true
  return mes === filtroMes
}

// ─── Propriedades do recorte (o que a planilha precisa DIZER) ─────────────────
//
// As três respostas abaixo são lidas por `exportar.ts` para montar a frase que
// descreve o arquivo. Moram aqui, coladas nas funções que decidem de verdade, e
// `filtros.test.ts` confere cada uma contra o comportamento REAL das funções
// acima — para a frase nunca mais prometer o que o filtro não entrega.

/**
 * O filtro de mês tem algum efeito neste recorte?
 *
 * Em `atrasada` e `sem-vencimento`, NÃO: `contaBateMes` devolve `true` para
 * toda conta que passa por esses filtros (atrasada não encerrada, ou sem
 * vencimento), então o arquivo é "de qualquer época" mesmo com um mês escolhido.
 * Escrever "vencimento em agosto de 2026" nesse caso é falso.
 */
export function filtroDeMesSeAplica(filtro: FiltroStatus): boolean {
  return filtro !== 'atrasada' && filtro !== 'sem-vencimento'
}

/** `atrasada` exige `!!c.vencimento` — conta sem data nunca entra. */
export function podeTerContaSemVencimento(filtro: FiltroStatus): boolean {
  return filtro !== 'atrasada'
}

/**
 * Atrasada de mês anterior só entra de carona quando a conta NÃO está encerrada
 * (`contaBateMes`) — em `paga` e `dispensada` todas estão. E `sem-vencimento`
 * exige `!c.vencimento`: conta atrasada tem vencimento por definição, então
 * também é impossível ali (achado 4 da rodada 3).
 */
export function podeTerAtrasadaDeOutroMes(filtro: FiltroStatus): boolean {
  return filtro !== 'paga' && filtro !== 'dispensada' && filtro !== 'sem-vencimento'
}

/**
 * Recorte que só devolve conta encerrada. A planilha usa para dizer QUE data
 * fez a conta entrar: em `paga`/`dispensada`, a conta sem vencimento entra pelo
 * mês do PAGAMENTO, não "sempre" (achado 7 da rodada 3).
 */
export function soTrazEncerradas(filtro: FiltroStatus): boolean {
  return filtro === 'paga' || filtro === 'dispensada'
}
