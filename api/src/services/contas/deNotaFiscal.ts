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
  // 'nfe' (produto) ou 'nfse' (serviço) — a mesma distinção de NFeData
  // (nfeProcessor.ts). Alimenta observacaoDeServicoSemRecorrenciaConferida()
  // logo abaixo: NFS-e nunca traz vencimento de boleto, e uma conta sem
  // vencimento nascida de serviço é indistinguível, pro sistema, de uma conta
  // RECORRENTE já cadastrada pro mesmo fornecedor no mesmo mês. Achado [alto]
  // do Apolo, 2ª rodada, 17/08/2026.
  modelo:         'nfe' | 'nfse'
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
// decidir de verdade, e desde 14/08/2026 a duplicata real vence qualquer código daqui
// (ver o bloco logo abaixo). Este mapa só decide notas SEM quadro de cobrança.
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

// A DUPLICATA REAL VENCE QUALQUER tPag. Não há mais lista de exceções.
//
// Até 14/08/2026 só '17'/'18'/'20'/'90' (PIX, transferência, "sem pagamento")
// cediam à duplicata; cartão e dinheiro não cediam, com base numa amostra só —
// METAL AGRÍCOLA nota 51843 (04/08/2026), que usou '05' ("crédito da loja") para
// o que o texto livre chamava de cartão de crédito.
//
// Prova que derrubou essa regra (14/08/2026): HIGA COMÉRCIO nota 76593, tPag '05',
// duplicata 001 com dVenc 2026-09-02 e vDup 642,22, e o próprio XML dizendo
// "Cnd.Pag:A PRAZO" no campo livre. Boleto de verdade, com data e valor
// programados, que o sistema jogou fora calado — o WhatsApp saiu dizendo
// "Sem boleto — a nota diz crédito da loja", uma conclusão errada que parecia
// certa. O dono só descobriu 11 dias depois, ao achar o PDF do boleto no e-mail.
//
// A raiz: tPag descreve o MEIO de pagamento, não o MOMENTO, e cada fornecedor
// preenche do seu jeito ('05' = cartão para um, = carnê a prazo para outro). Uma
// duplicata com data e valor, não. Ela é um compromisso programado — o dado mais
// confiável do XML sobre "vai ter algo para pagar". Escolha do dono, 14/08/2026:
// quando a nota traz esse compromisso, ele manda, e nenhum código o cancela.
//
// O risco assumido: fornecedor que espelha a venda no cartão como duplicata gera
// boleto fantasma. É o risco mais barato — pagar a conta não cria lançamento novo
// (`precisaCriarLancamento` em pagamento.ts), então dispensar ou pagar não mexe no
// gasto já lançado pela nota. ATENÇÃO ao limite dessa garantia: ela cobre o
// Financeiro, NÃO o dinheiro. Se o boleto fantasma for pago, o dinheiro sai do
// banco duas vezes (aqui e na fatura do cartão) e o sistema não tem como perceber.
// O risco caro continua sendo o outro: boleto de verdade que vence sem ninguém saber.
//
// Por isso o aviso não é enfeite. motivoVencidoPelaDuplicata() abaixo alimenta
// TRÊS lugares, de propósito: a mensagem do WhatsApp (avisoBoleto.ts), a coluna
// `observacao` da própria conta (gravarDeNota.ts) e a marca do resumo diário
// (resumo.ts). A mensagem passa uma vez e pode nem ser entregue; a observação fica.

// Decide se a nota gera boleto levando em conta a duplicata — é esta função,
// não motivoSemBoleto() sozinha, que contasDaNota() e parcelasDescartadasDaNota()
// devem usar: as duas precisam concordar sobre a mesma nota.
export function motivoSemBoletoDaNota(
  formaPagamento: string | null,
  temDuplicata: boolean,
): string | null {
  if (temDuplicata) return null
  return motivoSemBoleto(formaPagamento)
}

// O motivo que a duplicata DERRUBOU — não é recusa, é o contrário: o boleto foi
// criado apesar de o código de pagamento dizer que não haveria cobrança.
// Devolve null quando não há conflito nenhum (o caso comum).
//
// Existe porque a decisão de 14/08/2026 troca um erro caro (boleto perdido) por um
// erro barato (boleto a mais) — e um erro barato só continua barato se o dono for
// avisado na hora. Sem esta linha, o boleto fantasma de uma compra no cartão vira
// uma cobrança silenciosa na lista de contas, e o dono pode pagar o que a fatura
// do cartão já vai cobrar.
// Códigos em que a duplicata JÁ mandava antes de 14/08/2026 — e que por isso NÃO
// geram o aviso de conferência. Achado [alto] do Apolo na 2ª rodada do mesmo dia.
//
// PIX, transferência e "sem pagamento" cedem à duplicata desde 06/08. Ali a duplicata
// sempre foi lida como cobrança de verdade — é o caso da revenda que embute o boleto na
// nota de remessa. Avisar "pode já ter sido pago, dispense" nessas notas seria empurrar
// o dono a dispensar justamente o boleto real e caro: a SYAGRI de R$ 1.060.000 é tPag
// '90'. Não existe fatura de cartão para uma remessa.
//
// O aviso serve só para o que a mudança de 14/08 destravou de novo: dinheiro e cartão
// ('01', '03', '04', '05') — onde a cobrança pode mesmo já ter saído por outro caminho.
const CODIGOS_QUE_JA_CEDIAM_ANTES = new Set(['17', '18', '20', '90'])

export function motivoVencidoPelaDuplicata(
  formaPagamento: string | null,
  temDuplicata: boolean,
): string | null {
  if (!temDuplicata) return null
  if (CODIGOS_QUE_JA_CEDIAM_ANTES.has(formaPagamento ?? '')) return null
  return motivoSemBoleto(formaPagamento)
}

// O mesmo aviso, gravado NA CONTA (coluna `observacao`) em vez de só na mensagem
// do WhatsApp — achado [alto] do Apolo em 14/08/2026, no mesmo dia da mudança.
//
// A mensagem de NF-e processada é enviada uma vez, para um número só, e a falha de
// envio é engolida (nfeProcessor.ts). O resumo diário, esse sim, cobra a conta como
// "🔴 urgente" todo santo dia — e sem esta observação ele não teria como saber que
// aquele boleto pode já ter sido pago no cartão. O dono levaria a cobrança a sério,
// pagaria, e o pagamento em duplicidade não apareceria em lugar nenhum do sistema:
// só no extrato do banco (precisaCriarLancamento não cria lançamento para conta de
// nota, então o Financeiro continuaria batendo).
//
// Prova do caso real: METAL AGRÍCOLA nota 51843, tPag '05', duplicata com dVenc
// 2026-08-01 — nota de cartão de verdade ("Cnd.Pag:A VISTA;PAGAMENTO CARTAO
// CREDITO" no campo livre) que hoje gera boleto e nasce VENCIDA, indo direto para
// o balde de urgentes do aviso diário.
// O começo do texto é uma CONSTANTE, não enfeite: a coluna `observacao` é campo livre
// (o PATCH de /contas aceita qualquer texto, e já existe conta com nota de auditoria
// escrita à mão lá dentro). Quem exibe o alerta — a tela de Contas e o resumo diário —
// reconhece este prefixo em vez de tratar QUALQUER observação como boleto suspeito.
// Sem isso, o dia em que alguém anotar qualquer coisa numa conta aberta, ela ganharia
// triângulo âmbar e "confira antes de pagar" sem motivo nenhum. Achado [médio] do Apolo.
export const PREFIXO_CONFERIR = 'Conferir antes de pagar:'

export function observacaoDoBoletoContraOCodigo(motivoVencido: string | null): string | null {
  if (!motivoVencido) return null
  return `${PREFIXO_CONFERIR} ${motivoVencido}, mas veio com cobrança marcada. ` +
    `Pode já ter sido pago (ou vir na fatura do cartão) — nesse caso, dispense esta conta.`
}

// A MESMA tarja de cima (mesma coluna `observacao`, mesmo prefixo
// PREFIXO_CONFERIR), para um risco diferente: NFS-e (nota de serviço) nunca
// traz vencimento de boleto no XML — nenhum bloco <cobr><dup> no layout
// nacional (ver o comentário de parseXmlNFSe em nfeProcessor.ts). Toda NFS-e
// cai, sem exceção, no caminho "sem duplicata" de contasDaNota() (o mesmo
// caminho do caso ERCAL: uma conta sem vencimento, pelo valor total).
//
// Isso torna a conta indistinguível, pro sistema, de uma conta RECORRENTE já
// cadastrada pro mesmo fornecedor no mesmo mês — o caso real que motivou este
// aviso: SITRACK (rastreador de frota, R$124/mês), com uma conta recorrente já
// em `contas_a_pagar` (`recorrente_id` preenchido, `nota_fiscal_id` nulo).
// Reenviar a NFS-e da SITRACK criaria uma SEGUNDA conta pro mesmo mês/
// fornecedor/valor — e como a recorrente não tem `nota_fiscal_id`, ela CRIA
// lançamento financeiro ao ser paga (`precisaCriarLancamento` em
// contas/pagamento.ts): pagar as duas duplica o GASTO de verdade, não só o
// boleto. Achado [alto] do Apolo, 2ª rodada, 17/08/2026 — probe em produção
// confirmou a conta recorrente da SITRACK já existente.
//
// Esta função NÃO resolve a duplicidade — o sistema não tem hoje como casar
// com segurança uma conta recorrente com a NFS-e que acabou de chegar (nome
// do fornecedor pode divergir entre as duas, e casar só pelo valor é frágil).
// Só garante que o dono seja avisado ANTES de pagar as duas.
export function observacaoDeServicoSemRecorrenciaConferida(
  modelo: 'nfe' | 'nfse',
  vencimento: string | null,
): string | null {
  if (modelo !== 'nfse') return null
  if (vencimento !== null) return null
  // Nomeia a AÇÃO CERTA, não só o risco: a tarja irmã (avisoBoleto.ts,
  // linhaBoletoContraOCodigo) termina com "dispense esta conta" — copiar esse
  // padrão aprendido faria o dono dispensar a conta NOVA (a da nota, que já
  // lançou o gasto certo) e manter a RECORRENTE (que cria outro lançamento ao
  // ser paga, sem nota_fiscal_id). Achado do Apolo, 3ª rodada, 17/08/2026.
  return `${PREFIXO_CONFERIR} Serviço — o gasto já foi lançado por esta nota. Se você tem conta ` +
    `recorrente deste fornecedor neste mês, dispense A RECORRENTE (não esta), senão o gasto conta duas vezes.`
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
export function resumoDosItens(items: { descricao: string }[]): string {
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
  if (motivoSemBoletoDaNota(nfe.formaPagamento, nfe.duplicatas.some(duplicataEhReal))) return []
  if (!nfe.duplicatas.some(duplicataEhReal)) return []
  return tentarContasDasDuplicatas(nfe, nfe.emitenteNome).descartadas
}
