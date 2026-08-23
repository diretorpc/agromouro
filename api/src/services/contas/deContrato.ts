import { competenciaDoMes } from './datas'
import type { DocumentoLido } from '../controle/documentoPdf'

// Transforma um CONTRATO já lido (Mosaic e afins) nas contas a pagar dele.
// Função PURA de propósito — nenhum acesso a banco, para que toda regra de
// dinheiro daqui possa ser provada sem mock. Espelha o par que
// deNotaFiscal.ts (puro) e gravarDeNota.ts (banco) já formam neste projeto;
// a gravação mora em gravarContasDoContrato.ts.
//
// Por que só contrato: o extrato de revenda já tem boleto próprio chegando
// por e-mail (nfeEmail.ts → gravarBoletoDoPdf). Criar conta a pagar a partir
// das duplicatas de um extrato cobraria o dono duas vezes pela mesma dívida.

// Categoria inicial. NÃO é adivinhação de fórmula (o MS15F 09 23 18 tem N, P
// e K juntos e não cabe em fertilizante_n/p/k) — é o balde honesto, e a tela
// deixa trocar em massa. Ver CATEGORIAS_CONTAS_A_PAGAR em web/lib/centro-custo.ts.
//
// Exportada porque `gravarDocumentoPdf.ts` grava o ITEM (itens_nfe.centro_
// custo) desta mesma compra — sem a mesma constante nos dois lugares, a
// conta a pagar e o item do documento discordariam sobre a categoria da
// MESMA compra (fix cosmético, 2026-08-23).
export const CATEGORIA_PADRAO = 'fertilizante_outro'

export type ContaDeContrato = {
  descricao:             string
  fornecedor:            string | null
  categoria:             string
  // NULO = o contrato entrou mas a data de pagamento não pôde ser lida
  // (Critical 2 da revisão final, 23/08/2026). A coluna é NULLABLE desde a
  // migration 006 e a tela já sabe listar conta sem vencimento.
  vencimento:            string | null   // 'YYYY-MM-DD'
  valor:                 number | null   // nulo = contrato não disse quanto; a tela pede
  valor_estimado:        boolean
  status:                'aberta'
  competencia:           string          // 'YYYY-MM-01'
  documento_controle_id: string
}

// 'YYYY-MM-DD' → 'YYYY-MM-01'. Formato já garantido por quem monta
// (`dataSanitizada` em documentoPdf.ts só devolve datas nesse formato).
function competenciaDe(dataISO: string): string {
  const [ano, mes] = dataISO.split('-').map(Number)
  return competenciaDoMes(ano, mes)
}

// "Contrato 280451 — MS15F 09 23 18 S15". O código do contrato vem primeiro
// porque é o que o Matheus procura quando fala com o vendedor.
function descricaoDaConta(documento: DocumentoLido): string {
  const identidade = documento.codigoCliente ?? documento.fornecedor ?? 'sem número'
  const primeiroItem = documento.itens[0]?.descricao
  return primeiroItem ? `Contrato ${identidade} — ${primeiroItem}` : `Contrato ${identidade}`
}

// Divide `total` em `partes` iguais, em centavos, com a sobra na ÚLTIMA.
// Trabalha em centavos inteiros de propósito: dividir reais em ponto
// flutuante e arredondar cada parte independentemente deixa a soma das
// parcelas diferente do total (100 ÷ 3 daria 33,33 × 3 = 99,99 — um centavo
// somem do contrato).
function ratear(total: number, partes: number): number[] {
  const centavosTotal = Math.round(total * 100)
  const base = Math.floor(centavosTotal / partes)
  const valores = Array.from({ length: partes }, () => base)
  valores[partes - 1] = centavosTotal - base * (partes - 1)
  return valores.map(c => c / 100)
}

export function contasDoContrato(documento: DocumentoLido, documentoId: string): ContaDeContrato[] {
  if (documento.tipoDocumento !== 'contrato') return []

  const pagamentos = documento.pagamentos
  const total      = documento.valorTotalDocumento

  // ⚠️ CRITICAL 2 da revisão final (23/08/2026) — CONTRATO SEM DATA DE
  // PAGAMENTO LEGÍVEL CRIA A CONTA ASSIM MESMO, sem vencimento.
  //
  // Antes daqui saía uma lista vazia e a tela dizia "cadastre a conta à
  // mão". Esse conselho era o furo mais caro da branch: conta avulsa nasce
  // SEM `documento_controle_id`, e é justamente esse campo que faz
  // `precisaCriarLancamento` (pagamento.ts) NÃO lançar de novo o gasto que
  // já veio pelos itens do contrato. Seguindo o conselho, o dono pagava a
  // conta e o sistema criava um segundo lançamento: R$ 1,29 mi para uma
  // compra de R$ 648 mil.
  //
  // A conta sem vencimento não é invenção nova: `contas_a_pagar.vencimento`
  // é NULLABLE desde a migration 006 (caso ERCAL, fornecedor que não
  // informou data), a tela de Contas a Pagar filtra "sem vencimento" e o
  // resumo do WhatsApp já tem o balde `semVencimento`. O dono vê a conta na
  // lista, com vínculo ao documento, e digita a data — sem nunca precisar
  // criar uma conta paralela.
  //
  // `valor_estimado: true` sempre: o contrato não amarrou este valor a uma
  // data nenhuma, então nem o valor nem a data estão confirmados.
  if (pagamentos.length === 0) {
    // Sem data de pagamento E sem data de contrato não há competência
    // possível (coluna DATE NOT NULL) — e inventar "hoje" mentiria sobre
    // quando a compra aconteceu. Inalcançável na gravação real: sem
    // `dataDocumento` o documento é recusado antes, com `sem-identidade`.
    if (!documento.dataDocumento) return []

    return [{
      descricao:             descricaoDaConta(documento),
      fornecedor:            documento.fornecedor,
      categoria:             CATEGORIA_PADRAO,
      vencimento:            null,
      valor:                 total,
      valor_estimado:        true,
      status:                'aberta',
      // Mês do CONTRATO — a mesma data em que o gasto entra no Financeiro
      // (`data_manual` do item). Sem vencimento, é a única data verdadeira
      // que o documento tem.
      competencia:           competenciaDe(documento.dataDocumento),
      documento_controle_id: documentoId,
    }]
  }

  // ⚠️ Important 1 da revisão final: com QUALQUER parcela descartada na
  // leitura (data ilegível, ou excedente de MAX_PAGAMENTOS), o total do
  // documento vira INTOCÁVEL. As duas regras que derivam valor a partir dele
  // — "1 pagamento herda o total" e o rateio — pressupõem que as parcelas na
  // mão são TODAS as parcelas do contrato. Com um descarte, essa premissa é
  // falsa: duas parcelas de R$ 323 mil viram uma dívida de R$ 647.986,35
  // marcada como CONFIRMADA, ou o rateio divide o contrato inteiro entre os
  // sobreviventes. Valor IMPRESSO ao lado da data continua valendo — ele foi
  // lido, não derivado.
  const totalConfiavel = documento.pagamentosDescartados > 0 ? null : total

  // QUATRO regras de valor, nesta ordem — e a segunda é a que impede o bug
  // caro:
  //   1. pagamento com valor próprio → usa o dele, valor_estimado = false
  //   2. ALGUM pagamento sem valor, com mais de um pagamento → RATEIA o total
  //      entre TODOS e marca todos como estimado. Herdar o total em cada
  //      parcela transformaria um contrato de R$ 647.986,35 numa dívida de
  //      R$ 1,29 mi. (montarParcelas() de parcelamento.ts NÃO serve aqui: ele
  //      repete o valor cheio em toda parcela DE PROPÓSITO — decisão do
  //      Matheus para conta avulsa parcelada. Reusar dá exatamente o bug.)
  //   3. ÚNICO pagamento sem valor → herda o total inteiro, e isso é FATO,
  //      não estimativa: o contrato só tem aquele vencimento.
  //   4. sem valor e sem total confiável → conta sem valor, estimada; a tela
  //      pede o real.
  const faltaAlgumValor = pagamentos.some(p => p.valor === null)
  const rateado = faltaAlgumValor && pagamentos.length > 1 && totalConfiavel !== null
    ? ratear(totalConfiavel, pagamentos.length)
    : null

  return pagamentos.map((pagamento, i) => {

    // Valor e "estimado" nascem juntos, caso a caso — não dá para derivar
    // valor_estimado só de `pagamento.valor === null`: herdar o total de um
    // ÚNICO pagamento é fato (o contrato só tem aquele vencimento, o total é
    // dele por inteiro), não estimativa. Já o rateio É estimativa (o
    // contrato não disse como dividir, o código está supondo partes iguais).
    let valor: number | null
    let valorEstimado: boolean

    if (pagamento.valor !== null) {
      valor = pagamento.valor
      valorEstimado = false
    } else if (rateado) {
      valor = rateado[i]
      valorEstimado = true
    } else if (pagamentos.length === 1 && totalConfiavel !== null) {
      valor = totalConfiavel
      valorEstimado = false
    } else {
      valor = null
      valorEstimado = true
    }

    return {
      descricao:             descricaoDaConta(documento),
      fornecedor:            documento.fornecedor,
      categoria:             CATEGORIA_PADRAO,
      vencimento:            pagamento.data,
      valor,
      // Estimado = "este número não estava escrito ao lado desta data E o
      // código teve que supor algo para chegar nele". A tela de Contas a
      // Pagar já sabe pedir o valor real de conta estimada.
      valor_estimado:        valorEstimado,
      status:                'aberta',
      competencia:           competenciaDe(pagamento.data),
      documento_controle_id: documentoId,
    }
  })
}
