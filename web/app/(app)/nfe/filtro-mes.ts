// Filtro de mês da aba NF-e, em funções puras — mesmo padrão de
// regras-conferencia.ts: a regra fica testável sem montar componente nenhum.
//
// POR QUE ESTE FILTRO EXISTE (25/08/2026): a lista carregava as 135 notas de
// uma vez, ordenadas por data de emissão. Uma nota importada naquele dia, mas
// emitida em 04/07, caiu na posição 69 — o dono importou, não achou, e concluiu
// que o botão de importar PDF estava quebrado. A nota estava lá o tempo todo.
//
// O filtro corta o barulho, mas sozinho ele PIORA aquele mesmo susto: com o mês
// corrente fixo como padrão, uma nota de mês passado nasce fora da vista. Por
// isso duas travas moram aqui: `mesPadraoDaLista` (abre no mês mais recente que
// TEM nota, não no mês do calendário) e, do lado da tela, o salto para o mês da
// nota logo depois de gravar.

import { mesCorrente } from '@/lib/mes'

export const TODOS_OS_MESES = 'todos'

type NotaComData = { data_emissao?: string | null }

// Reexportado porque os testes desta pasta e o Financeiro usam o mesmo helper —
// a implementação mora em lib/mes.ts, com o motivo do fuso escrito lá.
export { mesCorrente }

export function mesDaNota(dataEmissao: string | null | undefined): string | null {
  return dataEmissao ? dataEmissao.slice(0, 7) : null
}

// Nota sem data de emissão aparece em QUALQUER mês. A coluna aceita nulo
// (`data_emissao date,` em api/src/database/schema.sql, sem NOT NULL em
// migration nenhuma) — e mesmo que não aceitasse, esconder uma nota para sempre
// por causa de um campo vazio repetiria o sumiço que este filtro veio consertar.
export function notaNoMes(nota: NotaComData, filtroMes: string): boolean {
  if (filtroMes === TODOS_OS_MESES) return true
  const mes = mesDaNota(nota.data_emissao)
  return mes === null || mes === filtroMes
}

// O mês em que a aba abre: o corrente quando ele tem nota, senão o mais recente
// que tem. Nunca abre vazia.
export function mesPadraoDaLista(notas: readonly NotaComData[], agora: Date = new Date()): string {
  const corrente = mesCorrente(agora)
  const meses    = mesesDisponiveis(notas)
  if (meses.includes(corrente)) return corrente
  return meses[0] ?? corrente
}

// Meses que a lista suspensa oferece, do mais novo para o mais velho. O mês
// selecionado entra mesmo sem nota nenhuma nele — senão o select exibe vazio
// justamente quando o filtro esvaziou a tela.
export function mesesDisponiveis(notas: readonly NotaComData[], selecionado?: string): string[] {
  const meses = new Set<string>()
  if (selecionado && selecionado !== TODOS_OS_MESES) meses.add(selecionado)
  for (const nota of notas) {
    const mes = mesDaNota(nota.data_emissao)
    if (mes) meses.add(mes)
  }
  return [...meses].sort().reverse()
}

// A peneira inteira da lista, num lugar só: busca, status e mês.
//
// A BUSCA DESLIGA O MÊS, de propósito. Digitar o número da nota é exatamente o
// que o dono faz quando acha que uma nota sumiu — foi o que aconteceu em
// 25/08/2026. Com busca e mês em E lógico, a ferramenta de achar nota sumida
// respondia "nada encontrado" para uma nota que estava no banco. Pior no caso
// parcial: buscar um fornecedor que tem nota em dois meses devolvia só a do mês
// filtrado, a lista NÃO ficava vazia, e nada na tela dizia que havia um mês
// ligado (achado [alto] do Apolo, 25/08/2026).
export function notaVisivel(
  nota: NotaComData & { numero?: string | null; emitente_nome?: string | null; emitente_cnpj?: string | null; status?: string | null },
  filtros: { busca: string; status: string; mes: string | null },
): boolean {
  const busca = filtros.busca.trim().toLowerCase()

  if (busca) {
    const casa = [nota.numero, nota.emitente_nome, nota.emitente_cnpj]
      .some(campo => campo?.toLowerCase().includes(busca))
    if (!casa) return false
  }

  if (filtros.status !== 'todos' && nota.status !== filtros.status) return false

  // Só aqui o mês entra — e só quando ninguém está procurando nada.
  if (!busca && filtros.mes && !notaNoMes(nota, filtros.mes)) return false

  return true
}

export function rotuloDoMes(mes: string): string {
  if (mes === TODOS_OS_MESES) return 'Todos os meses'
  const [ano, m] = mes.split('-').map(Number)
  return new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
