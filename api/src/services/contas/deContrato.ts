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
const CATEGORIA_PADRAO = 'fertilizante_outro'

export type ContaDeContrato = {
  descricao:             string
  fornecedor:            string | null
  categoria:             string
  vencimento:            string          // 'YYYY-MM-DD'
  valor:                 number | null   // nulo = contrato não disse quanto; a tela pede
  valor_estimado:        boolean
  status:                'aberta'
  competencia:           string          // 'YYYY-MM-01'
  documento_controle_id: string
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
  if (documento.pagamentos.length === 0) return []

  const pagamentos = documento.pagamentos
  const total      = documento.valorTotalDocumento

  // Três regras de valor, nesta ordem — e a do meio é a que impede o bug caro:
  //   1. pagamento com valor próprio → usa o dele, valor_estimado = false
  //   2. ALGUM pagamento sem valor, com mais de um pagamento → RATEIA o total
  //      entre TODOS e marca todos como estimado. Herdar o total em cada
  //      parcela transformaria um contrato de R$ 647.986,35 numa dívida de
  //      R$ 1,29 mi. (montarParcelas() de parcelamento.ts NÃO serve aqui: ele
  //      repete o valor cheio em toda parcela DE PROPÓSITO — decisão do
  //      Matheus para conta avulsa parcelada. Reusar dá exatamente o bug.)
  //   3. sem valor e sem total → conta sem valor, estimada; a tela pede o real.
  const faltaAlgumValor = pagamentos.some(p => p.valor === null)
  const rateado = faltaAlgumValor && pagamentos.length > 1 && total !== null
    ? ratear(total, pagamentos.length)
    : null

  return pagamentos.map((pagamento, i) => {
    const [ano, mes] = pagamento.data.split('-').map(Number)

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
    } else if (pagamentos.length === 1 && total !== null) {
      valor = total
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
      competencia:           competenciaDoMes(ano, mes),
      documento_controle_id: documentoId,
    }
  })
}
