// Importar SÓ o boleto de uma nota que já está no sistema.
//
// O CASO QUE CRIOU ISTO (31/08/2026). A nota 4507 da MIKAMI entrou em julho,
// quando o sistema ainda não puxava boleto. A conta a pagar nunca nasceu, e o
// vencimento de 03/11 ficaria no silêncio. Reimportar a nota duplicaria os
// itens; importar o boleto SOLTO é pior e mais silencioso: com `nota_fiscal_id`
// nulo, `precisaCriarLancamento()` devolve true e pagar a conta criaria um
// lançamento no Financeiro EM CIMA do gasto da nota.
//
// Em DOIS PASSOS: ler e sugerir, depois gravar o que o dono confirmou.
// Casamento automático foi recusado de propósito — grampear na nota errada faz
// a despesa sumir do Financeiro, e ninguém percebe.
//
// O PDF é lido UMA VEZ. Na confirmação os números voltam do navegador e passam
// de novo por `validarBoletoLido` — as mesmas travas de teto, janela de data e
// data existente que a leitura aplica. Reler o PDF seria a alternativa, mas a
// IA pode ler diferente na segunda vez, e aí seria gravado um número que o dono
// NÃO aprovou. Entre "o número pode ter vindo adulterado do navegador" e "o
// número gravado pode não ser o que ele viu", o primeiro risco é coberto por
// revalidação e o segundo não é coberto por nada.

import type Anthropic from '@anthropic-ai/sdk'
import { lerBoletoDoPdf, validarBoletoLido, type BoletoLido } from './boletoPdf'
import { casarNotaComBoleto, type NotaCandidata, type NotaSugerida } from './casarNota'
import {
  adotarContaNaNota, buscarContasSoltas, buscarNotaDaFazenda, buscarNotasCandidatas,
  type ContaSolta,
} from './notasCandidatas'
import { gravarBoletoDoPdf, type ResultadoBoletoPdf } from './gravarBoletoPdf'

export type PreviewBoleto =
  | { status: 'lido'; boleto: BoletoLido; sugestoes: NotaSugerida[] }
  | { status: 'nao-boleto' }
  | { status: 'falha'; motivo: string }

/**
 * Passo 1: lê o PDF e procura as notas que podem tê-lo originado. NÃO GRAVA
 * NADA — se gravasse, o dono perderia a chance de escolher a nota, que é o
 * ponto inteiro desta feature.
 */
export async function lerBoletoEProcurarNotas(
  pdf: Buffer,
  nomeArquivo: string,
  hojeISO: string,
  fazendaId: string,
  anthropic: Anthropic,
): Promise<PreviewBoleto> {
  const leitura = await lerBoletoDoPdf(pdf, nomeArquivo, hojeISO, anthropic)

  // 'nao-boleto' é conclusão, 'falha' é ausência de conclusão (IA fora do ar).
  // A tela precisa dizer coisas diferentes: "este arquivo não é boleto" contra
  // "tente de novo em alguns minutos".
  if (leitura.status !== 'boleto') return leitura

  const candidatas = await buscarNotasCandidatas(fazendaId)
  return {
    status: 'lido',
    boleto: leitura.boleto,
    sugestoes: casarNotaComBoleto(leitura.boleto, candidatas),
  }
}

export type PedidoGravarBoleto = {
  boleto: BoletoLido
  nomeArquivo: string
  /** `null` = o dono afirmou que esta cobrança não tem nota no sistema. */
  notaFiscalId: string | null
}

export type ResultadoImportarBoleto =
  | ResultadoBoletoPdf
  // A conta já existia SOLTA e foi amarrada na nota agora. Não é erro nem
  // duplicata: é o conserto do gasto que ia contar duas vezes.
  | { status: 'adotada'; id: string }
  | { status: 'boleto-invalido' }
  | { status: 'nota-invalida' }
  // A nota existe, mas NÃO lançou gasto no Financeiro. Amarrar faria o dinheiro
  // sumir (ver a tabela verdade em casarNota.ts).
  | { status: 'nota-sem-gasto' }
  // Já existe conta DESTA NOTA com o mesmo valor e vencimento: é o mesmo boleto,
  // não outra parcela.
  | { status: 'parcela-repetida'; contaId: string }
  // Existe conta solta com este valor e vencimento, mas ela está PAGA,
  // DISPENSADA, é recorrente ou veio de contrato. Adotar qualquer uma delas
  // faz estrago: dispensada some da lista (o boleto nunca aparece para pagar),
  // paga mantém o lançamento duplicado de pé, e recorrente perde a despesa no
  // Financeiro ao ser paga. Medido em 31/08/2026: 25 das 28 contas soltas da
  // produção são desse tipo. Achado 1 da rodada 2 do Apolo.
  | { status: 'conta-encerrada'; contaId: string; statusConta: string }

function revalidar(boleto: BoletoLido, hojeISO: string): BoletoLido | null {
  return validarBoletoLido(
    {
      ehBoleto: true,
      valor: boleto.valor,
      vencimento: boleto.vencimento,
      // `validarBoletoLido` deriva `beneficiario` de `beneficiarioFinal ?? beneficiario`
      // e `cobradoPor` da diferença entre os dois. Desfazer a derivação aqui é o
      // que mantém o nome do banco/fundo (o que aparece no extrato) vivo na ida
      // e volta pelo navegador.
      beneficiario: boleto.cobradoPor ?? boleto.beneficiario,
      beneficiarioFinal: boleto.beneficiario,
      documento: boleto.documento,
      totalDeCobrancas: boleto.totalDeCobrancas,
    },
    hojeISO,
  )
}

/** Mesma regra de duas palavras usada no resto do módulo. */
function pareceMesmoFornecedor(a: string | null, b: string): boolean {
  const n = (s: string) => s
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .toUpperCase().split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
  if (!a) return false
  return n(a) === n(b)
}

/**
 * Já existe conta DESTA nota cobrando o mesmo valor no mesmo dia?
 *
 * Só isso é "boleto repetido". A 1ª versão recusava qualquer nota que já
 * tivesse UMA conta, e isso proibia o caso legítimo: nota parcelada em 3, o
 * dono importa o 2º boleto e leva um 409 dizendo que criaria cobrança
 * repetida. Pior — a tela então empurrava para "nenhuma nota", que é o caminho
 * do gasto dobrado (achado 3 do Apolo). O banco sempre permitiu várias contas
 * por nota: o índice único de `006_contas_de_nfe.sql` é por
 * `nota_fiscal_id + numero_parcela`.
 */
function contaIgualDaNota(nota: NotaCandidata, boleto: BoletoLido) {
  return nota.contas.find(
    c => c.vencimento === boleto.vencimento
      && c.valor !== null
      && Math.round(c.valor * 100) === Math.round(boleto.valor * 100),
  )
}

/**
 * Esta conta solta pode ser amarrada na nota?
 *
 * NÃO basta estar sem nota. Cada exclusão abaixo é um estrago diferente,
 * medido na produção em 31/08/2026 (25 das 28 contas soltas caíam em alguma):
 *
 * - `paga` — o lançamento dela já existe; amarrar deixa a duplicidade de pé e
 *   a tela ainda diria "pagar não vai lançar de novo";
 * - `dispensada` — some da lista da tela (ver `filtros.ts`), então o boleto
 *   recém-importado NUNCA apareceria para pagar. É o silêncio que esta feature
 *   existe para acabar, e o caminho até ele é natural: importar sem nota, se
 *   assustar com o aviso vermelho, dispensar e reimportar com a nota;
 * - `recorrente_id` — conta de luz/arrendamento amarrada numa NF-e para de
 *   lançar despesa quando for paga;
 * - `documento_controle_id` — o gasto já entrou pelo contrato.
 */
function podeSerAdotada(c: ContaSolta): boolean {
  return (c.status === 'aberta' || c.status === 'aguardando')
    && !c.recorrente_id
    && !c.documento_controle_id
}

export async function gravarBoletoConfirmado(
  pedido: PedidoGravarBoleto,
  hojeISO: string,
  fazendaId: string,
): Promise<ResultadoImportarBoleto> {
  const boleto = revalidar(pedido.boleto, hojeISO)
  if (!boleto) return { status: 'boleto-invalido' }

  if (pedido.notaFiscalId) {
    // O backend usa service key e IGNORA o RLS: sem esta consulta filtrada por
    // fazenda, um id de outra propriedade amarraria o boleto lá dentro.
    const nota = await buscarNotaDaFazenda(pedido.notaFiscalId, fazendaId)
    if (!nota) return { status: 'nota-invalida' }

    // A trava que o Apolo achou faltando (achado 1) e que já existia do outro
    // lado do sistema, em `idDaNotaQueLancouGasto`. Amarrar numa nota que não
    // lançou gasto faz o dinheiro sair do banco sem virar despesa em tela
    // nenhuma — pior que dobrado, porque dobrado o dono enxerga.
    if (!nota.lancouGasto) return { status: 'nota-sem-gasto' }

    const igual = contaIgualDaNota(nota, boleto)
    if (igual) return { status: 'parcela-repetida', contaId: igual.id }

    // A conta pode já existir SOLTA — o dono importou este mesmo boleto antes
    // escolhendo "nenhuma nota", ou o robô do e-mail a criou quando o XML ainda
    // não tinha chegado. Recusar com "já existe" e deixá-la solta seria a
    // resposta que parece tranquila e mantém o gasto dobrado de pé (achado 4).
    const soltas = await buscarContasSoltas(boleto.valor, boleto.vencimento, fazendaId)
    const mesma = soltas.find(c => pareceMesmoFornecedor(c.fornecedor, boleto.beneficiario))
    if (mesma) {
      if (!podeSerAdotada(mesma)) {
        return { status: 'conta-encerrada', contaId: mesma.id, statusConta: mesma.status }
      }
      const ok = await adotarContaNaNota(mesma.id, pedido.notaFiscalId, fazendaId)
      // `false` = outra aba amarrou ou pagou primeiro. Não é erro nem adoção: a
      // conta já mudou de estado, e insistir criaria a segunda.
      return ok ? { status: 'adotada', id: mesma.id } : { status: 'duplicada' }
    }
  }

  return gravarBoletoDoPdf(boleto, pedido.nomeArquivo, fazendaId, pedido.notaFiscalId)
}
