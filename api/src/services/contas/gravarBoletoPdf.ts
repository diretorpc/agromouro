import { supabase } from '../supabase'
import { competenciaDoMes } from './datas'
import { PREFIXO_CONFERIR } from './deNotaFiscal'
import type { BoletoLido } from './boletoPdf'

export type ResultadoBoletoPdf =
  | { status: 'criada'; id: string }
  | { status: 'duplicada' }
  | { status: 'erro'; mensagem: string }

// A observação que vai na conta. Reusa o MESMO prefixo do boleto que nasce
// contra o código de pagamento da NF-e (PREFIXO_CONFERIR), porque a tela e o
// resumo diário reconhecem esse prefixo para mostrar a tarja âmbar — um prefixo
// próprio aqui exigiria mexer nos dois lados de novo e poderia divergir.
// O texto é diferente do da NF-e de propósito: o motivo de conferir é outro.
function observacaoDoPdf(b: BoletoLido, arquivo: string): string {
  const doc = b.documento ? ` (documento ${b.documento})` : ''
  return `${PREFIXO_CONFERIR} este boleto foi lido de um PDF${doc}, não do XML da nota. ` +
    `Confira valor e vencimento contra o papel antes de pagar. Arquivo: ${arquivo}`
}

// Já existe conta com este mesmo valor e vencimento nesta fazenda?
//
// É a trava que impede o boleto do PDF de virar par do boleto que a NF-e já
// criou — o caso comum é o fornecedor mandar XML e PDF no MESMO e-mail, e como
// o XML é processado primeiro, a conta dele já está no banco quando o PDF
// chega aqui. Casa por valor + vencimento porque é o que os dois caminhos têm
// em comum: o nome do beneficiário impresso no boleto quase nunca bate, letra
// por letra, com a razão social do emitente da nota.
//
// Cobre também o reprocessamento do mesmo e-mail (o job só marca como lido no
// fim; se cair antes disso, o e-mail volta no ciclo seguinte).
//
// ⚠️ NÃO cobre o caminho inverso: se o PDF chegar hoje e o XML da mesma nota
// chegar semana que vem, gravarContasDaNota() não consulta esta função e vai
// criar a conta dela do mesmo jeito — ficam duas. É por isso que a conta do PDF
// nasce com a tarja de conferência: as duas aparecem juntas na tela, com o
// aviso, e o dono dispensa a repetida num clique.
type Existente = { id: string; fornecedor: string | null }

async function contaExistente(
  valor: number,
  vencimento: string,
  fazendaId: string,
): Promise<Existente[] | 'erro'> {
  const { data, error } = await supabase
    .from('contas_a_pagar')
    .select('id, fornecedor')
    .eq('fazenda_id', fazendaId)
    .eq('vencimento', vencimento)
    .eq('valor', valor)

  // Erro de banco NÃO vira "não existe": isso criaria a conta repetida
  // justamente quando o banco está ruim.
  if (error) {
    console.error('[BoletoPDF] Erro ao checar duplicata:', error.message)
    return 'erro'
  }

  return data ?? []
}

// Dois nomes que se referem ao mesmo fornecedor? Compara só as duas primeiras
// palavras, sem acento e sem maiúscula: o beneficiário IMPRESSO no boleto quase
// nunca bate letra por letra com a razão social do emitente da nota ("HIGA
// COMERCIO E DISTRIBUICAO LTDA" vs "Higa Comércio"), mas o começo bate.
function pareceMesmoFornecedor(a: string | null, b: string): boolean {
  const normaliza = (s: string) => s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().split(/\s+/).filter(Boolean).slice(0, 2).join(' ')

  if (!a) return false
  return normaliza(a) === normaliza(b)
}

export async function gravarBoletoDoPdf(
  boleto: BoletoLido,
  arquivo: string,
  fazendaId: string,
  // Id da NF-e que chegou NO MESMO E-MAIL, quando houve exatamente uma.
  //
  // Isto é o que impede o gasto de ser contado duas vezes (achado [crítico] do
  // Apolo, 14/08/2026). A nota, ao ser processada, JÁ lançou o gasto no
  // Financeiro. Se o boleto do PDF nascesse solto (`nota_fiscal_id: null`),
  // `precisaCriarLancamento` devolveria true e o pagamento criaria um SEGUNDO
  // lançamento — dobrando o valor no Dashboard e no Financeiro, calado.
  //
  // O dedupe por valor+vencimento sozinho NÃO cobre isso: a nota pode ter criado
  // conta sem vencimento (caso ERCAL) ou não ter criado conta nenhuma (tPag sem
  // duplicata), e aí não há nada com que casar.
  notaDoEmail: string | null = null,
): Promise<ResultadoBoletoPdf> {
  const existentes = await contaExistente(boleto.valor, boleto.vencimento, fazendaId)

  if (existentes === 'erro') return { status: 'duplicada' }

  // Só trata como repetida quando o fornecedor também bate. Valor e data iguais
  // por acaso acontecem (duas parcelas redondas de fornecedores diferentes
  // vencendo no mesmo dia) — e engolir um boleto de verdade é o erro caro;
  // conta a mais o dono dispensa num toque. Mesma lógica do tPag.
  const mesma = existentes.find(c => pareceMesmoFornecedor(c.fornecedor, boleto.beneficiario))
  if (mesma) {
    console.log(
      `[BoletoPDF] Ignorado: ${boleto.beneficiario} R$ ${boleto.valor} vencendo ` +
      `${boleto.vencimento} já existe na conta ${mesma.id}.`,
    )
    return { status: 'duplicada' }
  }

  if (existentes.length > 0) {
    console.log(
      `[BoletoPDF] ${existentes.length} conta(s) com mesmo valor e data, mas de outro ` +
      `fornecedor — gravando "${boleto.beneficiario}" assim mesmo.`,
    )
  }

  const { data, error } = await supabase
    .from('contas_a_pagar')
    .insert({
      descricao:      boleto.documento ? `Boleto ${boleto.documento}` : 'Boleto recebido por e-mail',
      fornecedor:     boleto.beneficiario,
      // Sem categoria: nada no boleto diz o que foi comprado, e chutar
      // 'insumos' sujaria o relatório por categoria. O dono escolhe na tela.
      categoria:      null,
      competencia:    competenciaDoMes(
        Number(boleto.vencimento.slice(0, 4)),
        Number(boleto.vencimento.slice(5, 7)),
      ),
      vencimento:     boleto.vencimento,
      valor:          boleto.valor,
      // false: é o valor impresso no boleto, não estimativa de conta fixa.
      valor_estimado: false,
      status:         'aberta',
      // Com nota (veio no mesmo e-mail): amarra, e pagar NÃO cria lançamento —
      // o gasto já foi lançado pela nota. Sem nota (o caso que motivou a
      // feature): fica nulo, e pagar cria o lançamento, porque não há gasto
      // lançado em lugar nenhum. As duas pontas de `precisaCriarLancamento`.
      nota_fiscal_id: notaDoEmail,
      observacao:     observacaoDoPdf(boleto, arquivo),
      fazenda_id:     fazendaId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[BoletoPDF] Erro ao gravar boleto:', error.message)
    return { status: 'erro', mensagem: error.message }
  }

  console.log(`[BoletoPDF] Boleto de R$ ${boleto.valor} vencendo ${boleto.vencimento} gravado.`)
  return { status: 'criada', id: data.id }
}
