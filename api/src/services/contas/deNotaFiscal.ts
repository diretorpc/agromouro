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

// Uma parcela da nota que NÃO virou conta — e o motivo. contasDaNota() é pura (não
// loga, não manda WhatsApp), então quem precisa avisar o dono de uma parcela perdida
// no meio de uma nota que, no geral, deu certo, chama esta função à parte.
export type ParcelaDescartada = {
  numero: string   // numero da duplicata na nota, não a posição
  motivo: string
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
// dois casos a entrada precisa começar com 'YYYY-MM-DD' e representar uma data REAL.
// Sem essa checagem, uma nota sem data de emissão (dataEmissao === '') vira competência
// "NaN-undefined-01" sem erro nenhum, e um mês inválido tipo '2026-13-01' passaria
// batido do mesmo jeito — e a coluna `competencia` no banco é DATE NOT NULL, então o
// defeito só apareceria lá na frente, como erro do Postgres que não diz que a causa foi
// uma data ruim vinda da nota.
function mesDe(dataISO: string): string {
  const erro = () => new Error(`Data em formato inválido ao calcular competência da conta: ${JSON.stringify(dataISO)}`)

  if (!/^\d{4}-\d{2}-\d{2}/.test(dataISO)) throw erro()

  const [ano, mes, dia] = dataISO.slice(0, 10).split('-').map(Number)

  // Confere se a data EXISTE de verdade (não só se o formato bate): monta com
  // Date.UTC e checa se os componentes voltam iguais aos que entraram. Mês 13 ou
  // 29 de fevereiro num ano não bissexto "rolam" para o mês seguinte em vez de dar
  // erro — é assim que o padrão já usado em `datas.ts` (diasEntre) detecta isso.
  // Nunca usar `new Date('YYYY-MM-DD')`: esse construtor lê como UTC e derruba 1 dia
  // no fuso do Brasil.
  const comoData = new Date(Date.UTC(ano, mes - 1, dia))
  const dataExiste =
    comoData.getUTCFullYear() === ano &&
    comoData.getUTCMonth() === mes - 1 &&
    comoData.getUTCDate() === dia
  if (!dataExiste) throw erro()

  return competenciaDoMes(ano, mes)
}

// Tenta transformar cada duplicata da nota numa conta, isoladamente. Uma parcela com
// data ruim NÃO pode derrubar as outras: perder 1 parcela é ruim, perder as 3 é muito
// pior — mesmo raciocínio já usado no limite de 24 parcelas do desenho desta fase
// ("truncar seria perder boleto em silêncio").
//
// Mantém a POSIÇÃO original (i + 1) e o TOTAL original (nfe.duplicatas.length) mesmo
// quando uma parcela é descartada: se sobrarem só a 1ª e a 3ª de uma nota de 3, o
// buraco no meio ("1/3", depois "3/3", sem "2/3" nenhuma) é o próprio aviso de que
// algo sumiu. Renumerar para "1/2, 2/2" apagaria esse rastro e pareceria completo.
function tentarContasDasDuplicatas(
  nfe: DadosParaConta,
  fornecedor: string,
): { contas: ContaDeNota[]; descartadas: ParcelaDescartada[] } {
  const total = nfe.duplicatas.length
  const contas: ContaDeNota[] = []
  const descartadas: ParcelaDescartada[] = []

  nfe.duplicatas.forEach((d, i) => {
    try {
      contas.push({
        descricao:      total > 1
                          ? `${fornecedor} — NF ${nfe.numero} (${i + 1}/${total})`
                          : `${fornecedor} — NF ${nfe.numero}`,
        fornecedor,
        vencimento:     d.vencimento,
        // Parcela sem data não tem mês de vencimento: cai no mês da emissão.
        // Calculado só aqui dentro (não antes do laço) para que uma dataEmissao
        // malformada só derrube as parcelas que realmente dependem dela.
        competencia:    d.vencimento ? mesDe(d.vencimento) : mesDe(nfe.dataEmissao),
        valor:          d.valor,
        numero_parcela: i + 1,
        total_parcelas: total,
      })
    } catch (e) {
      descartadas.push({
        numero: d.numero,
        motivo: e instanceof Error ? e.message : String(e),
      })
    }
  })

  return { contas, descartadas }
}

export function contasDaNota(nfe: DadosParaConta): ContaDeNota[] {
  if (motivoSemBoleto(nfe.formaPagamento)) return []

  const fornecedor = nfe.emitenteNome

  // Sem quadro de cobrança: uma conta sem data, com o valor total da nota.
  // Não descartar — é o caso ERCAL, e descartar seria perder R$ 8 mil em silêncio.
  // Aqui não há nada a "salvar parcialmente": é uma conta só, então uma data de
  // emissão ruim estoura direto (não há como isolar um problema de um item único).
  if (nfe.duplicatas.length === 0) {
    return [{
      descricao:      `${fornecedor} — NF ${nfe.numero}`,
      fornecedor,
      vencimento:     null,
      competencia:    mesDe(nfe.dataEmissao),
      valor:          nfe.valorTotal,
      numero_parcela: 1,
      total_parcelas: 1,
    }]
  }

  const { contas, descartadas } = tentarContasDasDuplicatas(nfe, fornecedor)

  // Todas as parcelas malformadas: não sobra conta nenhuma pra salvar. Devolver []
  // aqui seria indistinguível do caso "forma de pagamento não gera boleto" (que
  // também devolve [] de propósito) — o dono nunca saberia que uma nota de R$ 660 mil
  // sumiu por causa de uma data ruim, e não por decisão de negócio. Lançar torna o
  // problema barulhento em vez de invisível — e quem chama (gravarDeNota.ts) já
  // espera e reembrulha exceções desta função com o número da nota.
  if (contas.length === 0 && descartadas.length > 0) {
    throw new Error(
      `Nenhuma das ${descartadas.length} parcela(s) desta nota pôde virar conta: ` +
      descartadas.map(p => `parcela ${p.numero} — ${p.motivo}`).join('; '),
    )
  }

  return contas
}

// Refaz o mesmo cálculo de contasDaNota() para a mesma nota e devolve só as parcelas
// que teriam sido descartadas (pura, sem estado — não reaproveita nada de chamadas
// anteriores). Existe para quem grava as contas (ou avisa o dono) detectar quando uma
// parcela BOA sumiu no meio de uma nota que, no geral, deu certo — contasDaNota()
// sozinha não tem como avisar isso, é função pura e não loga.
export function parcelasDescartadasDaNota(nfe: DadosParaConta): ParcelaDescartada[] {
  if (motivoSemBoleto(nfe.formaPagamento)) return []
  if (nfe.duplicatas.length === 0) return []
  return tentarContasDasDuplicatas(nfe, nfe.emitenteNome).descartadas
}
