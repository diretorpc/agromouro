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
  '90': 'a nota diz que não há pagamento',
}

// '16' (depósito bancário), '19' (cashback/crédito virtual) e '21' (crédito em
// loja) foram AVALIADOS e propositalmente NÃO entraram na tabela acima — decisão
// registrada em 06/08/2026, depois de revisão do Apolo. Numa nota SEM quadro de
// cobrança (sem `<cobr>`), não há como distinguir "esses créditos já cobriram a
// nota inteira" de "cobrança real que o fornecedor só não detalhou" — é
// exatamente o caso ERCAL (nfeProcessor.ts:249, nota 82398: tPag 15, zero
// duplicata, boleto real de R$ 8.258,40 mesmo sem duplicata nenhuma no XML).
// Tratar esses 3 códigos como "sem boleto" arriscaria perder boleto de verdade
// pela mesma brecha. Resolver direito exige ler `vPag` (o valor efetivamente
// pago, campo do XML que o parser hoje não lê) e comparar com o total da nota —
// isso é trabalho futuro, não feito aqui. Até lá, '16'/'19'/'21' seguem o
// caminho padrão desta função: código não mapeado = "na dúvida, GERA" boleto.

// Devolve o motivo em português quando a nota NÃO deve gerar boleto, ou null quando deve.
// Na dúvida (código desconhecido ou ausente), GERA: um boleto a mais é dispensado
// num toque; um boleto a menos vence sem ninguém avisar.
//
// Responde só "o que este código sozinho significa" — não sabe nada sobre
// duplicata. Continua exportada porque outro código depende desta pergunta
// isolada; quem decide se a nota gera boleto de verdade é motivoSemBoletoDaNota
// logo abaixo.
export function motivoSemBoleto(formaPagamento: string | null): string | null {
  if (!formaPagamento) return null
  return MOTIVO_SEM_BOLETO[formaPagamento] ?? null
}

// Códigos que CEDEM à duplicata preenchida.
// '90' ("sem pagamento") é a nota declarando que não há cobrança. Mas se ela vem
// com quadro de duplicatas, o boleto é real e vence o código: existe revenda que
// pula o passo do faturamento e embute a cobrança na própria nota de remessa —
// perder esse boleto é o erro mais caro possível.
// Cartão e dinheiro NÃO cedem: ali a cobrança vem pela fatura do cartão ou o
// dinheiro já saiu, e a duplicata do XML é só o espelho da venda. Prova medida em
// 04/08/2026: METAL AGRÍCOLA nota 51843 tem tPag '05' E duplicata preenchida.
// '16'/'19'/'21' não estão nem aqui nem em MOTIVO_SEM_BOLETO (ver comentário lá
// em cima) — de propósito: como não são tratados como "sem boleto" em nenhuma
// circunstância, não existe nada para "ceder" nesses códigos.
const CODIGOS_QUE_CEDEM_A_DUPLICATA = new Set(['90'])

// Decide se a nota gera boleto levando em conta a duplicata — é esta função,
// não motivoSemBoleto() sozinha, que contasDaNota() e parcelasDescartadasDaNota()
// devem usar: as duas precisam concordar sobre a mesma nota.
export function motivoSemBoletoDaNota(
  formaPagamento: string | null,
  temDuplicata: boolean,
): string | null {
  const motivo = motivoSemBoleto(formaPagamento)
  if (!motivo) return null
  if (temDuplicata && CODIGOS_QUE_CEDEM_A_DUPLICATA.has(formaPagamento ?? '')) return null
  return motivo
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

// Uma duplicata sem NENHUMA informação útil (nem vencimento, nem valor — só o número
// de controle) não é diferente, pra quem vai pagar, de a nota não ter vindo com quadro
// de cobrança nenhum. contasDaNota() usa isto para colapsar esse caso no mesmo caminho
// de "sem duplicata" (valor TOTAL da nota), em vez de gerar uma conta sem vencimento E
// sem valor — perdendo um valor conhecido por um nulo à toa.
//
// Também é a resposta usada por motivoSemBoletoDaNota() (código '90') para decidir se
// a duplicata é prova real de cobrança — achado do Apolo em 06/08/2026: usar
// `duplicatas.length > 0` ali, em vez desta função, deixava a nota "90" com duplicata
// vazia gerar um boleto FANTASMA do valor TOTAL da nota (pior que o defeito original:
// um número que parece real, provado com a nota da SYAGRI de R$ 1.060.000).
//
// `Number.isFinite(d.valor) && d.valor > 0` rejeita `NaN`, `0`, negativo E `Infinity`
// de uma vez só: fornecedor que manda `<vDup></vDup>` (tag presente, vazia) vira `NaN`
// no parser (`parseFloat('')`), um boleto de R$ 0,00 sem vencimento não é cobrança
// nenhuma, um valor negativo (nunca visto numa nota real até hoje, 06/08/2026) não pode
// virar boleto de valor negativo por acaso, e um valor infinito (hipotético, XML com
// algo tipo `1e999`) passaria em `d.valor > 0` sozinho e depois viraria `null` ao salvar
// no banco — perdendo o valor total conhecido da nota, o mesmo defeito que esta função
// existe para evitar. Simplificação sugerida pela 2ª revisão do Apolo; checagem de
// `Infinity` acrescentada na 3ª.
export function duplicataEhReal(d: NFeDuplicata): boolean {
  return d.vencimento !== null || (d.valor !== null && Number.isFinite(d.valor) && d.valor > 0)
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
  if (motivoSemBoletoDaNota(nfe.formaPagamento, nfe.duplicatas.some(duplicataEhReal))) return []

  const fornecedor = nfe.emitenteNome

  // Sem quadro de cobrança ÚTIL — nem duplicata nenhuma, nem uma duplicata sequer com
  // vencimento OU valor preenchidos: uma conta sem data, com o valor total da nota.
  // Não descartar — é o caso ERCAL, e descartar seria perder R$ 8 mil em silêncio.
  // Duplicata(s) completamente vazia(s) (só o número de controle) caem aqui também:
  // sem isto, cada uma viraria uma conta sem vencimento E sem valor — trocando um
  // valor conhecido (o total da nota) por um nulo à toa.
  // Aqui não há nada a "salvar parcialmente": é uma conta só, então uma data de
  // emissão ruim estoura direto (não há como isolar um problema de um item único).
  if (!nfe.duplicatas.some(duplicataEhReal)) {
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
  if (motivoSemBoletoDaNota(nfe.formaPagamento, nfe.duplicatas.some(duplicataEhReal))) return []
  if (!nfe.duplicatas.some(duplicataEhReal)) return []
  return tentarContasDasDuplicatas(nfe, nfe.emitenteNome).descartadas
}
