// Regras da exportação da tabela de cartões para Excel.
//
// Mora FORA do `page.tsx` pelo mesmo motivo de `nfe/regras-conferencia.ts`:
// aqui é lógica pura (que coluna sai, com que rótulo, com que nome de
// arquivo) e dá pra testar sem montar componente nenhum. O `page.tsx` só
// chama.

import type { ColunaXlsx } from '@/lib/xlsx'

export type LancamentoCartao = {
  id: string
  data: string
  descricao: string
  valor: number
  categoria: string | null
  origem: 'cartao' | 'manual'
  cartao_id: string | null
  cartoes: { apelido: string } | null
}

// A data no banco é 'AAAA-MM-DD' (só o dia, sem hora). Virar Date às 12h
// LOCAIS de propósito: `new Date('2026-06-01')` é meia-noite UTC, que no
// Brasil (UTC-3) é 31/05 às 21h — o dia 1º sairia como último dia do mês
// anterior na planilha. Mesmo cuidado do `fmtDate` da tela.
function dataDoBanco(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * As colunas exportadas espelham a tabela da tela, na mesma ordem — só a
 * coluna de ações fica de fora (botão não vira célula).
 *
 * `rotuloCategoria` entra por parâmetro em vez de importado: o mapa de
 * rótulos mora junto das cores e dos badges no `page.tsx`, e arrastar só
 * metade dele pra cá deixaria constantes irmãs em arquivos diferentes.
 */
export function colunasExport(
  rotuloCategoria: (cat: string) => string,
): ColunaXlsx<LancamentoCartao>[] {
  return [
    { header: 'Data',            largura: 12, valor: l => dataDoBanco(l.data) },
    { header: 'Estabelecimento', largura: 44, valor: l => l.descricao },
    { header: 'Categoria',       largura: 20, valor: l => (l.categoria ? rotuloCategoria(l.categoria) : null) },
    { header: 'Cartão',          largura: 20, valor: l => l.cartoes?.apelido ?? null },
    { header: 'Tipo',            largura: 12, valor: l => (l.origem === 'manual' ? 'Manual' : 'Importado') },
    // Valor vai como NÚMERO puro — o "R$" fica só no cabeçalho. Com o
    // símbolo dentro da célula viraria texto e o Excel não somaria a coluna.
    { header: 'Valor (R$)',      largura: 14, valor: l => l.valor },
  ]
}

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

export type ContextoNome = {
  filtroMes: string
  apelidoCartao: string | null
  /** Código da fazenda ativa. Dimensão que mais muda os números. */
  fazenda: string | null
  /**
   * A tela carrega no máximo 1000 lançamentos. Passando disso, o que está
   * na tela — e portanto o arquivo — é só um PEDAÇO (os mais recentes).
   */
  parcial: boolean
}

/**
 * Nome do arquivo baixado. Carrega fazenda, filtros e o aviso de parcial,
 * senão três exports seguidos viram `cartoes.xlsx`, `cartoes (1).xlsx`,
 * `cartoes (2).xlsx` na pasta de Downloads e ninguém sabe qual é qual depois.
 *
 * A fazenda entra PRIMEIRO: em multi-fazenda, exportar sem filtro na MG e
 * depois na Tejuco daria dois arquivos de nome idêntico e conteúdo
 * completamente diferente. Ela é omitida quando `fazenda` vem nulo — quem
 * chama é responsável por só exportar com a fazenda já carregada, e a tela de
 * cartões faz isso mantendo o botão desabilitado até lá.
 *
 * `parcial` no nome não é enfeite: um arquivo chamado "tudo" que não é tudo
 * é pior que arquivo nenhum, porque ninguém desconfia dele.
 */
export function nomeArquivoExport(ctx: ContextoNome): string {
  const partes = ['cartoes']
  const fazenda = ctx.fazenda ? semAcento(ctx.fazenda) : ''
  if (fazenda) partes.push(fazenda)
  if (ctx.parcial) partes.push('parcial')
  partes.push(ctx.filtroMes === 'todos' ? 'tudo' : ctx.filtroMes)
  const cartao = ctx.apelidoCartao ? semAcento(ctx.apelidoCartao) : ''
  if (cartao) partes.push(cartao)
  return partes.join('-') + '.xlsx'
}
