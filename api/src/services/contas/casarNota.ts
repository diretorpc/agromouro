// Qual nota fiscal JÁ NO SISTEMA este boleto está cobrando?
//
// POR QUE EXISTE (31/08/2026). O caso do Matheus: a nota 4507 da MIKAMI entrou
// em julho, mas naquela época o sistema não puxava boleto — e a conta a pagar
// nunca nasceu. Reimportar a nota duplicaria os itens; importar o boleto solto
// é PIOR, e de um jeito silencioso: `precisaCriarLancamento()` devolve `true`
// quando `nota_fiscal_id` é nulo, então pagar essa conta criaria um lançamento
// no Financeiro EM CIMA do gasto que a nota já lançou.
//
// Este arquivo só SUGERE — quem decide é o dono, na tela. Casamento automático
// foi recusado de propósito: grampear na nota errada some com a despesa do
// Financeiro, e ninguém percebe.
//
// Lógica pura, sem banco e sem IA: quem chama traz as notas candidatas.

import type { BoletoLido } from './boletoPdf'

export type ContaDaNota = {
  id: string
  valor: number | null
  vencimento: string | null
  status: string
}

export type NotaCandidata = {
  id: string
  numero: string
  emitente_nome: string
  valor_total: number
  data_emissao: string
  /** Contas a pagar que esta nota já tem. Vazio = nenhuma. */
  contas: ContaDaNota[]
  /**
   * A nota lançou gasto no Financeiro?
   *
   * Decide se amarrar é SEGURO, e é diferente de "já tem conta". A tabela
   * verdade está escrita em `nfeProcessor.ts` (idDaNotaQueLancouGasto) e custou
   * duas rodadas de revisão para aparecer:
   *
   *   nota lançou gasto  → amarra     → pagar NÃO lança de novo → certo
   *   nota não lançou    → não amarra → pagar lança             → certo
   *   nota não lançou    → amarrasse  → pagar não lança         → GASTO SOME
   *
   * A terceira linha é o caso ERCAL (nota de remessa, CFOP 5116): boleto cheio,
   * gasto zero. Amarrar ali faria o dinheiro sair do banco sem virar despesa em
   * lugar nenhum — pior que dobrado, porque dobrado o dono enxerga.
   */
  lancouGasto: boolean
}

export type MotivoCasamento = 'mesmo fornecedor' | 'mesmo valor' | 'número da nota no boleto'

export type NotaSugerida = NotaCandidata & {
  /** Por que esta nota foi sugerida, em português, para aparecer na tela. */
  motivos: MotivoCasamento[]
}

// Mais que isto não é lista de sugestão, é lista de notas — e uma tela com 40
// opções empurra o dono a clicar na primeira sem ler.
const MAX_SUGESTOES = 10

// Mesma regra de `gravarBoletoPdf.ts`: o beneficiário IMPRESSO no boleto quase
// nunca bate letra por letra com a razão social do emitente da nota ("HIGA
// COMERCIO E DISTRIBUICAO LTDA" vs "Higa Comércio"), mas as DUAS primeiras
// palavras batem.
//
// Duplicada aqui de propósito, e não importada: a de lá decide DUPLICATA (se
// engolir um boleto de verdade) e a daqui decide SUGESTÃO (se oferecer uma
// nota). Se um dia uma precisar afrouxar, a outra não deve afrouxar junto.
//
// O `2` tem teste próprio: com UMA palavra, 'AGRO SANTA MARIA' casaria com
// 'AGRO XYZ LTDA' — e o mutante `slice(0, 1)` passava por toda a suíte antes
// (achado 8 do Apolo). Divergência deliberada exige teste, senão ela vira
// divergência por acidente.
const PALAVRAS_FORNECEDOR = 2

function normalizaFornecedor(s: string): string {
  return s
    // `\u0300-\u036F` por escape, nunca como caractere combinante literal:
    // eles são invisíveis na revisão e somem numa reencodagem do arquivo.
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .toUpperCase().split(/\s+/).filter(Boolean).slice(0, PALAVRAS_FORNECEDOR).join(' ')
}

function mesmoFornecedor(emitente: string, beneficiario: string): boolean {
  const a = normalizaFornecedor(emitente)
  const b = normalizaFornecedor(beneficiario)
  return a !== '' && a === b
}

/** Centavos: 0.1 + 0.2 !== 0.3 em ponto flutuante, e valor decide dinheiro. */
function mesmoValor(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

// O número da nota vem impresso no documento do boleto cercado de zeros e
// separadores ('2 -0004507-001' para a nota 4507).
//
// COMPARA BLOCO INTEIRO, não pedaço. A 1ª versão fazia
// `documento.replace(/\D/g,'').includes(nota)`, e o Apolo mediu o estrago: para
// '2 -0004507-001' (dígitos '20004507001') essa regra aceitava ONZE números de
// nota diferentes — 200, 450, 507, 700, 2000, 4507, 5070, 7001, 20004, 45070,
// 50700. Um certo e dez errados, e o errado chegava PRÉ-SELECIONADO na tela.
//
// Quebrar em blocos pelos separadores e exigir igualdade do bloco (sem zeros à
// esquerda) mantém o caso real — '0004507' vira '4507' — e derruba os dez.
function numeroNoDocumento(numeroNota: string, documento: string | null): boolean {
  if (!documento) return false
  const nota = numeroNota.replace(/\D/g, '').replace(/^0+/, '')
  // Nota de 1 ou 2 dígitos é sinal fraco demais mesmo com bloco inteiro:
  // '1' e '01' aparecem como número de parcela em quase todo boleto.
  if (nota.length < 3) return false

  return documento
    .split(/\D+/)
    .filter(Boolean)
    .some(bloco => bloco.replace(/^0+/, '') === nota)
}

/**
 * Devolve as notas que PODEM ser a origem deste boleto, da mais provável para a
 * menos, com o motivo escrito para a tela mostrar.
 *
 * Nota sem sinal nenhum não entra: oferecer uma nota qualquer é pior que não
 * oferecer nada.
 *
 * Nota que já tem conta ENTRA e NÃO é bloqueada: pode ser a 2ª parcela da mesma
 * nota, que é caso legítimo (o índice único de `006_contas_de_nfe.sql` é por
 * `nota_fiscal_id + numero_parcela`, justamente para permitir várias). Quem
 * decide "é o mesmo boleto ou é outra parcela" é o dono, olhando as contas que
 * a tela mostra.
 */
export function casarNotaComBoleto(
  boleto: BoletoLido,
  candidatas: NotaCandidata[],
): NotaSugerida[] {
  const sugeridas: NotaSugerida[] = []

  for (const nota of candidatas) {
    const motivos: MotivoCasamento[] = []
    if (mesmoFornecedor(nota.emitente_nome, boleto.beneficiario)) motivos.push('mesmo fornecedor')
    if (mesmoValor(nota.valor_total, boleto.valor)) motivos.push('mesmo valor')
    if (numeroNoDocumento(nota.numero, boleto.documento)) motivos.push('número da nota no boleto')

    if (motivos.length > 0) sugeridas.push({ ...nota, motivos })
  }

  // Mais sinais primeiro; empate desfeito pela emissão mais recente, que é a
  // mais provável de ainda estar sendo cobrada.
  return sugeridas
    .sort((a, b) => {
      if (a.motivos.length !== b.motivos.length) return b.motivos.length - a.motivos.length
      return (b.data_emissao ?? '').localeCompare(a.data_emissao ?? '')
    })
    .slice(0, MAX_SUGESTOES)
}

/**
 * Qual sugestão a tela pode deixar JÁ MARCADA — ou `null` para não marcar nada.
 *
 * Mora aqui, e não dentro do JSX, porque é decisão sobre dinheiro e precisa de
 * teste (achado 9 do Apolo). A regra antiga era "2 ou mais motivos", e o Apolo
 * mostrou o buraco: 'mesmo fornecedor' é quase de graça num fornecedor
 * recorrente, então a nota errada chegava marcada com dois motivos escritos em
 * português dando confiança.
 *
 * Agora exige as três coisas:
 *   1. `mesmo valor` entre os motivos — o único sinal que é sobre a COBRANÇA,
 *      não sobre quem cobra;
 *   2. a segunda colocada estritamente mais fraca, senão há empate real e
 *      escolher por ele é chutar;
 *   3. a nota tendo lançado gasto — amarrar numa que não lançou faz o dinheiro
 *      sumir, e isso nunca pode vir pré-marcado.
 *
 * Na dúvida, não marca. Um clique a mais custa um segundo; um grampo errado
 * esconde dezenas de milhares de reais e ninguém percebe.
 */
export function sugestaoParaPreSelecionar(sugestoes: NotaSugerida[]): string | null {
  const [primeira, segunda] = sugestoes
  if (!primeira) return null
  if (!primeira.lancouGasto) return null
  if (!primeira.motivos.includes('mesmo valor')) return null
  if (segunda && segunda.motivos.length >= primeira.motivos.length) return null
  return primeira.id
}
