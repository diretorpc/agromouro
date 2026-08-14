import { diasEntre } from './datas'
import { APP_URL, reais, ddmm } from './formato'
import { PREFIXO_CONFERIR } from './deNotaFiscal'

// As colunas que montarResumo() precisa ler. Exportada (em vez de escrita direto no
// job) porque o `.select()` do Supabase é string: esquecer uma coluna aqui não quebra
// nada — o campo chega `undefined` e a informação some calada. Com a lista aqui, o
// teste desta camada prova que ela traz o que a regra usa. Achado [médio-alto] do
// Apolo: `observacao` sumir do select deixava a suíte inteira verde.
export const COLUNAS_CONTA_RESUMO =
  'descricao, fornecedor, vencimento, valor, status, observacao, created_at, contas_recorrentes(avisar_dias_antes)'

// Dias sem resposta a partir dos quais a conta sem data sobe de tom.
// Motivo do escalonamento: conta sem vencimento NUNCA pode ficar "atrasada",
// porque não há data para comparar — o boleto vence no mundo real e o sistema
// não tem como saber. É o único ponto cego, então ele grita em vez de calar.
const DIAS_PARA_ESCALAR = 5

export type ContaResumo = {
  descricao:         string
  fornecedor:        string | null
  vencimento:        string | null   // vazio = o fornecedor não informou
  valor:             number | null
  status:            string
  avisar_dias_antes: number
  criada_em:         string          // 'YYYY-MM-DD' — base do escalonamento
  // Preenchida hoje num caso só: o boleto nasceu apesar de a nota dizer
  // cartão/dinheiro/PIX (observacaoDoBoletoContraOCodigo, em deNotaFiscal.ts).
  // Opcional para não quebrar quem monta ContaResumo sem ela.
  observacao?:       string | null
}

export type Resumo = {
  atrasadas:            ContaResumo[]
  vencendo:             ContaResumo[]
  naoChegaram:          ContaResumo[]
  semVencimento:        ContaResumo[]
  semVencimentoAntigas: ContaResumo[]
}

const ENCERRADAS = new Set(['paga', 'dispensada'])

export function montarResumo(contas: ContaResumo[], hojeISO: string): Resumo {
  const r: Resumo = {
    atrasadas: [], vencendo: [], naoChegaram: [],
    semVencimento: [], semVencimentoAntigas: [],
  }

  for (const c of contas) {
    if (ENCERRADAS.has(c.status)) continue

    // Sem data não dá para calcular atraso. Vai para o grupo próprio, e sobe
    // de tom conforme envelhece sem resposta.
    if (!c.vencimento) {
      const esperando = diasEntre(c.criada_em, hojeISO)
      if (esperando > DIAS_PARA_ESCALAR) r.semVencimentoAntigas.push(c)
      else                                r.semVencimento.push(c)
      continue
    }

    const dias = diasEntre(hojeISO, c.vencimento)

    // Uma conta aguardando (não chegou) que venceu já deve ser alertada como atrasada,
    // pois "atrasada" é a situação mais urgente — o fornecedor não apenas esqueceu,
    // mas agora deveria ter chegado.
    if (dias < 0) { r.atrasadas.push(c); continue }
    if (dias > c.avisar_dias_antes) continue

    if (c.status === 'aguardando') r.naoChegaram.push(c)
    else                           r.vencendo.push(c)
  }
  return r
}

export function resumoVazio(r: Resumo): boolean {
  return r.atrasadas.length === 0 && r.vencendo.length === 0 &&
         r.naoChegaram.length === 0 && r.semVencimento.length === 0 &&
         r.semVencimentoAntigas.length === 0
}

// Descrição da conta com o fornecedor na frente, quando houver. Desde que a
// Descrição passou a mostrar os produtos/serviços da nota (e não mais
// "fornecedor — NF número"), o aviso diário precisa reencaixar o fornecedor
// na frente — senão a mensagem vira "DIESEL S10 — venceu ..." sem dizer de
// quem é o boleto, e o Matheus não tem como decidir o que pagar.
// As 4 contas antigas do banco (do formato velho, com o fornecedor já
// embutido na descrição) ficam com o fornecedor repetido — não é grave.
function linhaDescricao(c: ContaResumo): string {
  return c.fornecedor ? `${c.fornecedor} — ${c.descricao}` : c.descricao
}

// Marca curta para a conta que pede conferência antes do pagamento — hoje só o
// boleto que nasceu contra o código de pagamento da nota (ver `observacao` acima).
// Achado [alto] do Apolo em 14/08/2026: sem isto, este resumo cobra esse boleto
// como "🔴 urgente" todo dia, sem uma palavra de ressalva, e o dono paga uma
// segunda vez algo que a fatura do cartão já cobrou. O texto completo fica na
// tela de Contas; aqui só o suficiente para ele parar antes de pagar.
// `startsWith(PREFIXO_CONFERIR)`, NUNCA "tem observação": a coluna é campo livre e já
// guarda nota de auditoria escrita à mão em produção ("Dispensada em 04/08: cobrança
// duplicada..."). Marcar qualquer observação faria o resumo pedir conferência sem
// motivo — e aviso que aparece à toa é aviso que se aprende a ignorar, justamente
// quando o de verdade chegar. Achado [médio] do Apolo.
function marcaConferir(c: ContaResumo): string {
  return c.observacao?.startsWith(PREFIXO_CONFERIR) ? '  👀 confira antes de pagar' : ''
}

// Uma linha de conta do resumo. Existe para que a marca de conferência acima não
// dependa de ser lembrada em cada um dos cinco grupos — esquecer num grupo faria
// justamente o urgente sair sem ressalva, que é o defeito que ela conserta.
function item(c: ContaResumo, corpo: string): string {
  return `• ${linhaDescricao(c)} — ${corpo}${marcaConferir(c)}`
}

// Alguma conta da mensagem pede conferência? Decide se o resumo leva link para a tela.
// Varre os cinco grupos a partir do próprio Resumo, em vez de receber a lista original:
// assim não há como o link discordar das linhas que realmente saíram na mensagem.
function algumPedeConferencia(r: Resumo): boolean {
  return [
    ...r.atrasadas, ...r.vencendo, ...r.naoChegaram,
    ...r.semVencimento, ...r.semVencimentoAntigas,
  ].some(c => marcaConferir(c) !== '')
}

export function textoResumo(r: Resumo, hojeISO: string): string {
  const linhas: string[] = [`📋 *Contas — ${ddmm(hojeISO)}*`]

  const criticas = r.atrasadas.length + r.semVencimentoAntigas.length
  if (criticas > 0) {
    linhas.push(`\n🔴 ${criticas} urgente${criticas > 1 ? 's' : ''}:`)
    for (const c of r.atrasadas) {
      linhas.push(item(c, `venceu ${ddmm(c.vencimento!)}, ${reais(c.valor)}`))
    }
    for (const c of r.semVencimentoAntigas) {
      const dias = diasEntre(c.criada_em, hojeISO)
      linhas.push(item(c, `${reais(c.valor)}, há ${dias} dias sem vencimento informado`))
    }
  }
  if (r.vencendo.length) {
    linhas.push(`\n🟡 ${r.vencendo.length} vencendo:`)
    for (const c of r.vencendo) linhas.push(item(c, `dia ${ddmm(c.vencimento!)}, ${reais(c.valor)}`))
  }
  if (r.naoChegaram.length) {
    const n = r.naoChegaram.length
    linhas.push(`\n⏳ ${n} ainda ${n > 1 ? 'não chegaram' : 'não chegou'}:`)
    for (const c of r.naoChegaram) linhas.push(item(c, `esperada dia ${ddmm(c.vencimento!)}`))
  }
  if (r.semVencimento.length) {
    linhas.push(`\n❓ ${r.semVencimento.length} sem vencimento:`)
    for (const c of r.semVencimento) linhas.push(item(c, reais(c.valor)))
  }
  if (r.semVencimento.length || r.semVencimentoAntigas.length) {
    linhas.push(`👉 ${APP_URL}/contas?filtro=sem-vencimento`)
  } else if (algumPedeConferencia(r)) {
    // Só quando o link de sem-vencimento não entrou: dois links seguidos numa
    // mensagem de WhatsApp fazem o dono não clicar em nenhum. O de sem-vencimento
    // é mais específico (já abre filtrado), então ele ganha quando os dois cabem.
    // Sem nenhum link, "confira antes de pagar" manda conferir sem dizer onde —
    // e o motivo ficou na mensagem da nota, dias atrás. Achado [baixo] do Apolo.
    linhas.push(`👉 ${APP_URL}/contas`)
  }
  return linhas.join('\n')
}
