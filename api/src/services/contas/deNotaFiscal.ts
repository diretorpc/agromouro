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
  items:          { descricao: string }[]   // xProd de cada item — só o texto, não NCM/CFOP/valor
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

// Formas de pagamento que NÃO geram boleto para o Matheus pagar — sozinhas, sem
// duplicata (quadro de cobrança) na nota. A cobrança vem pela fatura do cartão,
// ou o dinheiro já saiu por PIX/transferência.
// ⚠️ Decidido com uma amostra só (31/07/2026): a METAL AGRICOLA usou '05'
// ("crédito loja") para o que o texto livre chama de cartão de crédito.
// Confirmado em produção (06/08/2026): a nota 16246 da USINA UBERABA S/A
// (R$ 88.939,27) usou '18' ("transferência bancária/carteira digital") e,
// como o código não estava mapeado, caiu na regra de segurança abaixo e
// virou boleto fantasma — o dinheiro já tinha sido transferido.
// '17' (PIX dinâmico) e '20' (PIX estático — QR Code fixo que o fornecedor reaproveita
// para vários clientes, ao contrário do '17' que é gerado na hora) foram acrescentados
// por ANALOGIA ao '18': mesma família (PIX), mas sem nota real de amostra confirmando —
// não tratar como confirmado em produção enquanto isso não acontecer.
// tPag descreve o MEIO de pagamento, não o MOMENTO: uma compra pode ser "uma parte
// por PIX agora, o resto por boleto daqui a 3 meses" no mesmo XML. Por isso este mapa
// sozinho NUNCA decide a nota — motivoSemBoletoDaNota() cruza com a duplicata antes de
// decidir de verdade (ver CODIGOS_QUE_CEDEM_A_DUPLICATA logo abaixo).
// Confirmar contra o manual vigente da NF-e antes de acrescentar código novo.
const MOTIVO_SEM_BOLETO: Record<string, string> = {
  '01': 'a nota diz pagamento em dinheiro',
  '03': 'a nota diz cartão de crédito',
  '04': 'a nota diz cartão de débito',
  '05': 'a nota diz crédito da loja',
  '17': 'a nota diz PIX',
  '18': 'a nota diz transferência bancária ou carteira digital',
  '20': 'a nota diz PIX',
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
// '17'/'18'/'20' (PIX e transferência) cedem pelo MESMO motivo: tPag descreve o meio
// de pagamento, não o momento. "Entrada por PIX + saldo em boleto daqui a 3 meses" é
// uma combinação real — se a nota tem duplicata de verdade (data e valor programados),
// a duplicata é o dado mais confiável, mesmo que o código sozinho dissesse "sem boleto".
// Regressão pega pelo Apolo (06/08/2026): nota com tPag '18' e duplicata futura de
// R$ 88.939,27 devolvia [] antes desta correção — o boleto sumia calado.
// Cartão e dinheiro NÃO cedem: ali a cobrança vem pela fatura do cartão ou o
// dinheiro já saiu, e a duplicata do XML é só o espelho da venda. Prova medida em
// 04/08/2026: METAL AGRÍCOLA nota 51843 tem tPag '05' E duplicata preenchida.
// '16'/'19'/'21' não estão nem aqui nem em MOTIVO_SEM_BOLETO (ver comentário lá
// em cima) — de propósito: como não são tratados como "sem boleto" em nenhuma
// circunstância, não existe nada para "ceder" nesses códigos.
const CODIGOS_QUE_CEDEM_A_DUPLICATA = new Set(['17', '18', '20', '90'])

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

// Resume os produtos/serviços da nota em português corrido, para a coluna Descrição
// da tela de Contas a Pagar mostrar o que foi comprado — a coluna Fornecedor já
// mostra o fornecedor, repeti-lo na Descrição não ajuda o dono a reconhecer a
// compra. "Produto A" (1 item), "Produto A e Produto B" (2), "Produto A, Produto B
// e Produto C" (3). A partir de 4 itens, trunca: mostra os 2 primeiros + contagem
// do resto ("Produto A, Produto B e mais 2 itens") — uma nota de defensivos ou
// fertilizantes pode trazer uma dezena de itens, e listar todos estouraria a linha
// da tabela.
// Regressão pega pelo Apolo (06/08/2026): uma nota real de 52 linhas do mesmo
// produto "SOJA EM GRAOS DE TERCEIROS" (lotes/preços diferentes, mesmo nome)
// virava "SOJA EM GRAOS DE TERCEIROS, SOJA EM GRAOS DE TERCEIROS e mais 50
// itens" — a função contava LINHAS da nota, não produtos distintos. trim()
// antes do Set também resolve de graça um item cujo nome é só espaços: ele
// vira string vazia e cai no filter(Boolean) de baixo, em vez de sobreviver
// como célula vazia na lista.
function resumoDosItens(items: { descricao: string }[]): string {
  const descricoes = [...new Set(items.map(i => i.descricao.trim()).filter(Boolean))]

  if (descricoes.length === 0) return ''
  if (descricoes.length === 1) return descricoes[0]
  if (descricoes.length === 2) return `${descricoes[0]} e ${descricoes[1]}`
  if (descricoes.length === 3) return `${descricoes[0]}, ${descricoes[1]} e ${descricoes[2]}`

  // resto nunca é 1 com a lista de 4 pra cima (mínimo é 2, de 4 itens: 2 mostrados +
  // 2 no resto) — o branch de 3 itens acima intercepta o único caso que daria resto
  // 1. Mantido singular/plural explícito mesmo assim: é defensivo contra mudar o
  // "mostra os 2 primeiros" para outro número no futuro sem lembrar desta regra.
  const resto = descricoes.length - 2
  const rotuloResto = resto === 1 ? 'item' : 'itens'
  return `${descricoes[0]}, ${descricoes[1]} e mais ${resto} ${rotuloResto}`
}

// A primeira parte da descrição de uma conta (antes do sufixo de parcela, quando
// houver). Prefere o resumo dos produtos/serviços da nota; cai no formato antigo
// (fornecedor — NF número) só se a nota não trouxer item nenhum — defensivo: na
// prática `items` sempre vem preenchido (parseXmlNFe descarta item sem xProd), mas
// uma descrição em branco na tela seria pior do que repetir o fornecedor.
function descricaoDaConta(nfe: DadosParaConta, fornecedor: string): string {
  return resumoDosItens(nfe.items) || `${fornecedor} — NF ${nfe.numero}`
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
  const base = descricaoDaConta(nfe, fornecedor)

  nfe.duplicatas.forEach((d, i) => {
    try {
      contas.push({
        descricao:      total > 1 ? `${base} (${i + 1}/${total})` : base,
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

// Duplicata "de verdade" tem DATA de vencimento OU VALOR programado — não precisa das
// duas. Um <dup> do XML que só traz o número (sem vencimento nem valor — forma que
// nfeProcessor.ts produz quando o fornecedor não preenche nada) não é uma dívida
// agendada: é um número de controle interno do emitente. Tratar essa duplicata vazia
// como se fosse real geraria uma conta com vencimento e valor ambos null — uma linha
// inútil na tela, sem nada pra pagar.
// Regressão pega pelo Apolo (06/08/2026): a nota 16246 da USINA UBERABA S/A (tPag '18',
// dispensada manualmente) ficava ambígua no banco — sem o XML original (não guardado),
// não dava pra saber se ela tinha 0 duplicatas ou 1 duplicata vazia, porque as duas
// formas produziam o mesmo resultado. Exigir vencimento OU valor faz os dois casos
// convergirem de propósito: nenhum dos dois gera conta.
//
// Regressão SEGUINTE pega pelo Apolo no mesmo dia (06/08/2026): exigir só vencimento
// (sem aceitar valor sozinho) derrubava duplicata REAL com valor preenchido e data
// ausente (<dup><nDup>1</nDup><vDup>5000.00</vDup></dup>, sem <dVenc>) — R$ 5.000 que
// antes viravam boleto sem data (visível e cobrável) passaram a sumir sem rastro
// nenhum, porque '90' ("sem pagamento") cede à duplicata só quando ela é "real".
function duplicataEhReal(d: NFeDuplicata): boolean {
  return !!d.vencimento || d.valor != null
}

// Exportada para nfeProcessor.ts: as DUAS perguntas "esta nota tem cobrança de
// verdade?" que ele fazia sozinho (linha ~331, decide se uma remessa sem itens de
// compra vira gasto; linha ~596, decide a frase de boleto no WhatsApp) usavam
// `duplicatas.length > 0` — um critério ainda MAIS solto que o antigo daqui (aceitava
// até duplicata totalmente vazia). Centralizado para as três perguntas nunca mais
// divergirem entre si.
export function temDuplicataReal(duplicatas: NFeDuplicata[]): boolean {
  return duplicatas.some(duplicataEhReal)
}

export function contasDaNota(nfe: DadosParaConta): ContaDeNota[] {
  if (motivoSemBoletoDaNota(nfe.formaPagamento, temDuplicataReal(nfe.duplicatas))) return []

  const fornecedor = nfe.emitenteNome

  // Sem quadro de cobrança: uma conta sem data, com o valor total da nota.
  // Não descartar — é o caso ERCAL, e descartar seria perder R$ 8 mil em silêncio.
  // Aqui não há nada a "salvar parcialmente": é uma conta só, então uma data de
  // emissão ruim estoura direto (não há como isolar um problema de um item único).
  if (nfe.duplicatas.length === 0) {
    return [{
      descricao:      descricaoDaConta(nfe, fornecedor),
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
  if (motivoSemBoletoDaNota(nfe.formaPagamento, temDuplicataReal(nfe.duplicatas))) return []
  if (nfe.duplicatas.length === 0) return []
  return tentarContasDasDuplicatas(nfe, nfe.emitenteNome).descartadas
}
