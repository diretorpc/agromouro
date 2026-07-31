import { competenciaDoMes } from './datas'
import type { NFeDuplicata } from '../nfeProcessor'

// O que esta regra precisa saber de uma NF-e. Só isto — não recebe a nota inteira,
// para que o teste não precise montar item, NCM e imposto que não influenciam nada.
export type DadosParaConta = {
  numero:         string
  emitenteNome:   string
  dataEmissao:    string          // 'YYYY-MM-DD' ou ISO completo
  valorTotal:     number
  formaPagamento: string | null
  duplicatas:     NFeDuplicata[]
}

export type ContaDeNota = {
  descricao:      string
  fornecedor:     string
  vencimento:     string | null   // 'YYYY-MM-DD' — vazio quando o fornecedor não informou
  competencia:    string          // 'YYYY-MM-01'
  valor:          number | null
  numero_parcela: number
  total_parcelas: number
}

// Formas de pagamento que NÃO geram boleto para o Matheus pagar.
// A cobrança vem pela fatura do cartão, ou o dinheiro já saiu.
// ⚠️ Decidido com uma amostra só (31/07/2026): a METAL AGRICOLA usou '05'
// ("crédito loja") para o que o texto livre chama de cartão de crédito.
// Confirmar contra o manual vigente da NF-e antes de acrescentar código novo.
const MOTIVO_SEM_BOLETO: Record<string, string> = {
  '01': 'a nota diz pagamento em dinheiro',
  '03': 'a nota diz cartão de crédito',
  '04': 'a nota diz cartão de débito',
  '05': 'a nota diz crédito da loja',
}

// Devolve o motivo em português quando a nota NÃO deve gerar boleto, ou null quando deve.
// Na dúvida (código desconhecido ou ausente), GERA: um boleto a mais é dispensado
// num toque; um boleto a menos vence sem ninguém avisar.
export function motivoSemBoleto(formaPagamento: string | null): string | null {
  if (!formaPagamento) return null
  return MOTIVO_SEM_BOLETO[formaPagamento] ?? null
}

// Mês de uma data 'YYYY-MM-DD' (ou ISO completo) como primeiro dia do mês.
// Usada tanto para a data de emissão quanto para o vencimento de uma parcela — nos
// dois casos a entrada precisa começar com 'YYYY-MM-DD'. Sem essa checagem, uma nota
// sem data de emissão (dataEmissao === '') vira competência "NaN-undefined-01" sem
// erro nenhum — e a coluna `competencia` no banco é DATE NOT NULL, então o defeito só
// aparece lá na frente, como erro do Postgres que não diz que a causa foi a nota sem data.
function mesDe(dataISO: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dataISO)) {
    throw new Error(`Data em formato inválido ao calcular competência da conta: ${JSON.stringify(dataISO)}`)
  }
  const [ano, mes] = dataISO.slice(0, 10).split('-').map(Number)
  return competenciaDoMes(ano, mes)
}

export function contasDaNota(nfe: DadosParaConta): ContaDeNota[] {
  if (motivoSemBoleto(nfe.formaPagamento)) return []

  const fornecedor = nfe.emitenteNome
  const mesEmissao = mesDe(nfe.dataEmissao)

  // Sem quadro de cobrança: uma conta sem data, com o valor total da nota.
  // Não descartar — é o caso ERCAL, e descartar seria perder R$ 8 mil em silêncio.
  if (nfe.duplicatas.length === 0) {
    return [{
      descricao:      `${fornecedor} — NF ${nfe.numero}`,
      fornecedor,
      vencimento:     null,
      competencia:    mesEmissao,
      valor:          nfe.valorTotal,
      numero_parcela: 1,
      total_parcelas: 1,
    }]
  }

  const total = nfe.duplicatas.length

  return nfe.duplicatas.map((d, i) => ({
    descricao:      total > 1
                      ? `${fornecedor} — NF ${nfe.numero} (${i + 1}/${total})`
                      : `${fornecedor} — NF ${nfe.numero}`,
    fornecedor,
    vencimento:     d.vencimento,
    // Parcela sem data não tem mês de vencimento: cai no mês da emissão.
    competencia:    d.vencimento ? mesDe(d.vencimento) : mesEmissao,
    valor:          d.valor,
    numero_parcela: i + 1,
    total_parcelas: total,
  }))
}
