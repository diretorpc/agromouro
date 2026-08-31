// Regras da exportação da tabela de Contas a Pagar para Excel.
//
// Mora FORA do `page.tsx` pelo mesmo motivo de `cartoes/exportar.ts`: aqui é
// lógica pura (que coluna sai, com que rótulo, com que nome de arquivo) e dá
// pra testar sem montar componente nenhum. O `page.tsx` só chama.
//
// PARA QUE SERVE: o relatório mensal que o Matheus manda de "contas que
// paguei" (pedido de 31/08/2026). Por isso este arquivo leva DATA DO PAGAMENTO
// e um TOTAL no rodapé — a tela não mostra nenhum dos dois, e sem eles o
// arquivo não prova nada pra quem recebe.
//
// O ARQUIVO SAI DA MÁQUINA. É a diferença entre este módulo e a tela: na tela
// o Matheus vê os chips de filtro e o crachá âmbar de "estimado" ao lado de
// cada linha, e lê o número com esse contexto na frente. No anexo de e-mail
// não há chip nem crachá — só um TOTAL em negrito. Tudo que a tela diz POR
// FORA da tabela precisa estar DENTRO do arquivo, ou o arquivo mente.
// (Achados 1 e 2 da revisão do Apolo, 31/08/2026.)

import type { CelulaXlsx, ColunaXlsx } from '@/lib/xlsx'
import { categoriaLabel } from '@/lib/centro-custo'
import { labelMes } from './datas'
import {
  comoEntraContaSemVencimento, filtroDeMesSeAplica, podeTerAtrasadaDeOutroMes,
  type FiltroStatus, type FiltroTipo,
} from './filtros'
import { STATUS_LABEL, type ContaAPI } from './tipos'

// A data no banco é 'AAAA-MM-DD' (só o dia, sem hora). Virar Date às 12h
// LOCAIS de propósito: `new Date('2026-08-01')` é meia-noite UTC, que no
// Brasil (UTC-3) é 31/07 às 21h — o dia 1º sairia como último dia do mês
// anterior na planilha. Mesmo cuidado do `fmtDate` da tela.
function dataDoBanco(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

// A tela tem só DOIS filtros de tipo ("Contas fixas" = tudo que não veio de
// nota, e "Boletos de nota"), e por isso chama de fixa uma conta avulsa que
// nunca foi fixa. No relatório os três aparecem separados: quem recebe o
// arquivo não tem o filtro da tela na frente pra saber o que "fixa" quis dizer.
function tipoDaConta(c: ContaAPI): string {
  if (c.nota_fiscal_id) return 'Boleto de nota'
  return c.contas_recorrentes ? 'Conta fixa' : 'Avulsa'
}

/** Cabeçalho da coluna que o rodapé soma. Um lugar só — ver `indiceDaColunaValor`. */
export const HEADER_VALOR = 'Valor (R$)'

/**
 * As colunas exportadas espelham a tabela da tela, na mesma ordem, e depois
 * acrescentam o que a tela não mostra mas o relatório precisa.
 *
 * NÃO existe coluna "Valor pago": ao marcar uma conta como paga a API
 * sobrescreve `valor` com `valor_pago` (ver POST /contas/:id/pagar em
 * api/src/routes/contas.ts) — numa conta paga os dois campos são o MESMO
 * número, e duas colunas idênticas só atrapalham quem lê.
 *
 * EXISTE coluna "Estimado", que na tela é o crachá âmbar. Sem ela, uma conta
 * fixa de R$ 380.000 chutada a partir do último pagamento vira, no arquivo,
 * um número tão duro quanto um boleto conferido.
 */
export function colunasExport(): ColunaXlsx<ContaAPI>[] {
  return [
    { header: 'Vencimento',        largura: 12, valor: c => dataDoBanco(c.vencimento) },
    { header: 'Fornecedor',        largura: 28, valor: c => c.fornecedor },
    { header: 'Descrição',         largura: 44, valor: c => c.descricao },
    { header: 'Categoria',         largura: 20, valor: c => (c.categoria ? categoriaLabel(c.categoria) : null) },
    { header: 'Status',            largura: 14, valor: c => STATUS_LABEL[c.status] },
    // Valor vai como NÚMERO puro — o "R$" fica só no cabeçalho. Com o símbolo
    // dentro da célula viraria texto e o Excel não somaria a coluna.
    { header: HEADER_VALOR,        largura: 14, valor: c => c.valor },
    // Vazio em vez de "Não": a coluna precisa saltar aos olhos quando tem
    // conteúdo, e uma coluna cheia de "Não" some da vista igual a uma vazia.
    { header: 'Estimado',          largura: 10, valor: c => (c.valor_estimado ? 'SIM' : null) },
    { header: 'Data do pagamento', largura: 17, valor: c => dataDoBanco(c.data_pagamento) },
    { header: 'Nº da nota',        largura: 14, valor: c => c.notas_fiscais?.numero ?? null },
    { header: 'Tipo',              largura: 16, valor: tipoDaConta },
    { header: 'Parcela',           largura: 10, valor: c => (c.numero_parcela && c.total_parcelas ? `${c.numero_parcela}/${c.total_parcelas}` : null) },
    { header: 'Observação',        largura: 40, valor: c => c.observacao },
  ]
}

/**
 * Onde o total do rodapé cai. Calculado a partir da lista de colunas, e não
 * cravado como número: mexer na ordem das colunas sem mexer aqui jogaria a
 * soma embaixo de outra coluna sem nenhum teste reclamar.
 *
 * ESTOURA quando não acha, em vez de devolver -1. Com -1, `linha[-1] = total`
 * grava uma propriedade que o gerador nunca percorre: a planilha sairia com a
 * palavra TOTAL e NENHUM número ao lado, sem erro em lugar nenhum (achado 5
 * do Apolo). Renomear um cabeçalho é a edição mais provável neste arquivo.
 *
 * Recebe as colunas por PARÂMETRO, e não lê a lista sozinha, por dois motivos:
 * o caso de erro ganha teste, e o estouro acontece DENTRO da chamada do botão
 * — onde o try/catch vira mensagem vermelha —, nunca no carregamento do
 * módulo, onde derrubaria a tela de Contas inteira em branco. Essa é a lição
 * do lookbehind já registrada em `lib/xlsx.ts`.
 */
export function indiceDaColunaValor(colunas: ColunaXlsx<ContaAPI>[]): number {
  const i = colunas.findIndex(c => c.header === HEADER_VALOR)
  if (i < 0) {
    throw new Error(
      `exportar.ts: coluna "${HEADER_VALOR}" não existe mais — o rodapé de total sairia sem número.`,
    )
  }
  return i
}

/** Centavos, sem a sujeira do ponto flutuante (0.1 + 0.2 = 0.30000000000000004). */
function emCentavos(n: number): number {
  return Math.round(n * 100) / 100
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

/**
 * Linhas de total, uma por natureza do número.
 *
 * NUNCA soma estimativa com valor confirmado num número só — regra escrita à
 * mão em `calcularTotais` (page.tsx), que até agora valia só para a tela: a
 * primeira versão deste rodapé somava os dois e apresentava o resultado em
 * negrito. Numa exportação filtrada por "Contas fixas" esse total seria 100%
 * palpite, porque toda ocorrência recorrente nasce estimada
 * (api/src/services/contas/sincronizar.ts).
 *
 * A linha de estimado só aparece quando existe estimativa: um
 * "TOTAL ESTIMADO · 0 contas" em todo relatório de contas pagas seria ruído,
 * e ruído treina o leitor a ignorar o rodapé inteiro.
 */
export function linhasDeTotal(contas: ContaAPI[], indiceValor: number): CelulaXlsx[][] {
  const confirmadas = contas.filter(c => !c.valor_estimado)
  const estimadas   = contas.filter(c => c.valor_estimado)

  const linha = (rotulo: string, valor: number): CelulaXlsx[] => {
    const celulas: CelulaXlsx[] = new Array(indiceValor + 1).fill(null)
    celulas[0] = rotulo
    celulas[indiceValor] = valor
    return celulas
  }

  const soma = (lista: ContaAPI[]) => emCentavos(lista.reduce((s, c) => s + (c.valor ?? 0), 0))

  // "3 contas" com uma célula de valor em branco no meio deixa quem confere
  // sem saber se é dado faltando ou zero (achado 6 do Apolo). Boleto de nota
  // sem valor existe em produção.
  const semValor = (lista: ContaAPI[]) => {
    const n = lista.filter(c => c.valor === null).length
    return n === 0 ? '' : ` · ${n} sem valor informado`
  }

  const saida = [
    linha(
      `TOTAL CONFIRMADO · ${plural(confirmadas.length, 'conta', 'contas')}${semValor(confirmadas)}`,
      soma(confirmadas),
    ),
  ]
  if (estimadas.length > 0) {
    saida.push(
      linha(
        `TOTAL ESTIMADO · ${plural(estimadas.length, 'conta', 'contas')}${semValor(estimadas)}`,
        soma(estimadas),
      ),
    )
  }
  return saida
}

// ─── Descrição do recorte ─────────────────────────────────────────────────────

const TEXTO_STATUS: Record<string, string> = {
  todas:            'todas as contas, exceto dispensadas e pagas há mais de 30 dias',
  'sem-vencimento': 'somente contas sem vencimento informado',
  aguardando:       'somente contas aguardando',
  aberta:           'somente contas abertas',
  atrasada:         'somente contas atrasadas',
  paga:             'somente contas pagas',
  dispensada:       'somente contas dispensadas',
}

const TEXTO_TIPO: Record<string, string> = {
  fixas: 'somente contas que não vieram de nota fiscal',
  nota:  'somente boletos de nota fiscal',
}

/** '2026-08-31' → '31/08/2026'. Sem `Date`, pra não escorregar de fuso. */
function dataBR(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

/**
 * Uma frase dizendo QUE RECORTE este arquivo é.
 *
 * Existe porque o nome do arquivo mente por omissão (achado 2 do Apolo).
 * `contas-mg-todas-2026-08.xlsx` promete "todas de agosto", mas a tela — de
 * propósito, e por bom motivo — também mostra atrasadas de meses anteriores e
 * contas sem vencimento, e esconde dispensadas e pagas antigas. Quem recebe o
 * anexo não tem como saber disso. Uma linha de texto resolve; um nome de
 * arquivo mais comprido, não.
 */
export function descricaoDoFiltro(ctx: ContextoNome): string {
  const partes: string[] = []
  partes.push(TEXTO_STATUS[ctx.filtroStatus] ?? `filtro "${ctx.filtroStatus}"`)

  const tipo = TEXTO_TIPO[ctx.filtroTipo]
  if (tipo) partes.push(tipo)

  if (ctx.filtroMes === 'todos') {
    partes.push('todos os meses')
  } else if (!filtroDeMesSeAplica(ctx.filtroStatus)) {
    // "Atrasadas" e "Falta vencimento" passam por `contaBateMes` sempre —
    // escolher um mês não muda nada. Dizer "vencimento em agosto de 2026" num
    // arquivo que traz atrasada de qualquer época seria falso, e o nome do
    // arquivo já carrega o mês escolhido.
    partes.push(`de qualquer mês — o filtro de ${labelMes(ctx.filtroMes)} não altera este recorte`)
  } else {
    partes.push(`vencimento em ${labelMes(ctx.filtroMes)}`)
    // Conta sem vencimento entra de três jeitos diferentes, e o leitor do
    // arquivo não tem como adivinhar qual. Uma frase por jeito.
    const semVenc = comoEntraContaSemVencimento(ctx.filtroStatus)
    if (semVenc === 'sempre') {
      partes.push('inclui contas sem vencimento informado')
    } else if (semVenc === 'pelo-pagamento') {
      partes.push('inclui contas sem vencimento, pelo mês do pagamento')
    } else if (semVenc === 'ambos') {
      partes.push('inclui contas sem vencimento informado — as já pagas, pelo mês do pagamento')
    }
    if (podeTerAtrasadaDeOutroMes(ctx.filtroStatus)) {
      partes.push('inclui contas atrasadas de meses anteriores')
    }
  }

  // Maiúsculo: `codigo` vem minúsculo do banco, e "fazenda mg" num relatório
  // que vai por e-mail parece descuido. É código de propriedade, não nome.
  if (ctx.fazenda) partes.push(`fazenda ${ctx.fazenda.toUpperCase()}`)
  partes.push(`gerado em ${dataBR(ctx.geradoEm)}`)

  const frase = `Filtro: ${partes.join(' · ')}`
  // O aviso de lista incompleta vem GRUDADO na descrição, e não numa linha
  // separada, porque linha separada é a primeira coisa que some quando alguém
  // copia só o intervalo dos dados pra outra planilha.
  // Sem "confira antes de enviar": DENTRO do arquivo quem lê é o destinatário,
  // que não tem o que conferir — e o teto real da consulta nunca foi medido,
  // então nem o remetente tem. O aviso sozinho já diz tudo que é verdade.
  return ctx.parcial
    ? `${frase} · ATENÇÃO: a lista pode estar incompleta`
    : frase
}

/**
 * O rodapé inteiro: linha em branco, a descrição do recorte, outra em branco e
 * os totais. Fica FORA do autoFilter (ver `rodape` em lib/xlsx.ts) — dentro
 * dele, ordenar a planilha jogaria o total pro meio dos lançamentos.
 */
export function montarRodape(
  contas: ContaAPI[],
  ctx: ContextoNome,
  /**
   * As MESMAS colunas passadas ao `gerarXlsx`. Recebidas em vez de recalculadas
   * porque o total precisa cair embaixo da coluna que o arquivo realmente tem:
   * se um dia alguém exportar uma lista enxuta ou reordenada, uma segunda
   * chamada a `colunasExport()` aqui dentro poria a soma embaixo de outra
   * coluna, em silêncio. É o achado 5 reaparecendo na costura seguinte.
   */
  colunas: ColunaXlsx<ContaAPI>[],
): CelulaXlsx[][] {
  if (contas.length === 0) return []
  const indiceValor = indiceDaColunaValor(colunas)
  return [
    [],
    [descricaoDoFiltro(ctx)],
    [],
    ...linhasDeTotal(contas, indiceValor),
  ]
}

// ─── Truncamento ──────────────────────────────────────────────────────────────

// GET /contas não tem `.limit()`, mas o PostgREST do Supabase pode ter um teto
// próprio (`db-max-rows`) que corta a resposta SEM avisar — nenhum erro,
// nenhum campo de "tem mais". A única pista disponível hoje é o total voltar
// num número redondo suspeito.
//
// ISTO É SUSPEITA, NÃO FATO. Uma medição parcial existe desde 31/08/2026: uma
// consulta a `lancamentos_financeiros` devolveu 594 de 594 linhas
// (`Content-Range: 0-593/594`), então o teto real é **pelo menos 594** — a
// hipótese "pode ser 500" morreu. Onde ele está de verdade continua sem
// resposta, e 1.000 segue sendo palpite.
//
// Para medir você mesmo, sem depender desta linha:
//   curl -sI -H "Range: 0-" "$SUPABASE_URL/rest/v1/<tabela>?select=id" //     -H "apikey: $SUPABASE_SERVICE_KEY" | grep -i content-range
//
// O conserto de verdade é a rota devolver `count: 'exact'`, como a tela de
// Cartões já faz consultando o Supabase direto (cartoes/page.tsx). Até lá, o
// mínimo honesto é: marcar o nome do arquivo, avisar na tela, e dizer
// "pode estar" em vez de "está".
const TETOS_SUSPEITOS = new Set([1000, 10000])

export function pareceTruncado(total: number): boolean {
  return TETOS_SUSPEITOS.has(total)
}

// ─── Nome do arquivo ──────────────────────────────────────────────────────────

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    // Faixa das marcas de acento que o NFD separa da letra. Declarada por
    // CODIGO e nunca como caractere literal: acento solto e invisivel na
    // revisao e some numa copia -- mesma licao do NBSP em `lib/numeros-br.ts`
    // (por isso este comentario esta sem acento nenhum).
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Rótulo curto de cada filtro no nome do arquivo. "paga" vira "pagas" porque o
// arquivo tem várias contas, não uma. Filtro desconhecido cai no próprio nome
// em vez de sumir — nome estranho é melhor que dois arquivos diferentes com o
// mesmo nome.
const SLUG_STATUS: Record<string, string> = {
  todas: 'todas',
  'sem-vencimento': 'sem-vencimento',
  aguardando: 'aguardando',
  aberta: 'abertas',
  atrasada: 'atrasadas',
  paga: 'pagas',
  dispensada: 'dispensadas',
}

const SLUG_TIPO: Record<string, string> = {
  fixas: 'fixas',
  nota: 'boletos',
}

export type ContextoNome = {
  filtroStatus: FiltroStatus
  filtroTipo: FiltroTipo
  filtroMes: string
  /** Código da fazenda ativa. Dimensão que mais muda os números. */
  fazenda: string | null
  /** Dia da geração, 'AAAA-MM-DD'. Entra por parâmetro para o teste ser fixo. */
  geradoEm: string
  /** `true` quando a lista carregada PODE ser só um pedaço — ver `pareceTruncado`. */
  parcial: boolean
}

/**
 * Nome do arquivo baixado. Carrega fazenda, filtros e o aviso de parcial,
 * senão três exports seguidos viram `contas.xlsx`, `contas (1).xlsx`,
 * `contas (2).xlsx` na pasta de Downloads e ninguém sabe qual é qual depois.
 *
 * A fazenda entra PRIMEIRO: em multi-fazenda, exportar sem filtro na MG e
 * depois na Tejuco daria dois arquivos de nome idêntico e conteúdo
 * completamente diferente. Ela é omitida quando `fazenda` vem nulo — quem
 * chama é responsável por só exportar com a fazenda já carregada, e a tela
 * faz isso mantendo o botão desabilitado até lá.
 *
 * O nome NÃO conta o recorte inteiro, e nunca vai contar: ele cabe em poucas
 * palavras e some quando o cliente de e-mail renomeia o anexo. Quem conta a
 * história toda é `descricaoDoFiltro`, DENTRO da planilha.
 */
export function nomeArquivoExport(ctx: ContextoNome): string {
  const partes = ['contas']
  const fazenda = ctx.fazenda ? semAcento(ctx.fazenda) : ''
  if (fazenda) partes.push(fazenda)
  if (ctx.parcial) partes.push('parcial')
  partes.push(SLUG_STATUS[ctx.filtroStatus] ?? semAcento(ctx.filtroStatus))
  const tipo = SLUG_TIPO[ctx.filtroTipo]
  if (tipo) partes.push(tipo)
  partes.push(ctx.filtroMes === 'todos' ? 'tudo' : ctx.filtroMes)
  return partes.join('-') + '.xlsx'
}
