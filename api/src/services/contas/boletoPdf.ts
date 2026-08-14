import Anthropic from '@anthropic-ai/sdk'
import { diasEntre } from './datas'

// Lê um boleto em PDF e devolve o que dá para pagar com ele: valor, vencimento
// e quem está cobrando. Existe porque o XML da NF-e nem sempre chega.
//
// O caso que criou este arquivo (14/08/2026): chega o e-mail do fornecedor com a
// nota em PDF e o boleto em PDF, sem XML nenhum. Hoje o sistema ignora esse
// e-mail inteiro — não entra gasto, não entra estoque, não nasce boleto, e
// NINGUÉM é avisado. O boleto vence no silêncio. Ler o PDF não substitui o XML
// (que é o documento fiscal, assinado); resolve só a parte que dói: a data.
//
// Por que só o boleto, e não a nota inteira: um boleto tem quatro números
// grandes e padronizados, e um erro de leitura aparece na tela antes de alguém
// pagar. A nota tem dezenas de linhas, e um "6" lido como "8" numa quantidade
// entraria no estoque calado. A nota continua exigindo XML, de propósito.

// Quem manda no nome do modelo é a Anthropic, no tempo dela — então ele vem do
// ambiente, não cravado aqui (regra ETC do CLAUDE.md). O padrão é o modelo bom:
// ler valor e data de um boleto é decisão sobre dinheiro, e economizar no
// modelo para errar um dígito seria economia cara.
const MODELO = process.env.ANTHROPIC_MODEL_BOLETO ?? 'claude-opus-5'

// Uma nota escaneada inteira não cabe no orçamento de um boleto — e um PDF
// gigante quase nunca é boleto. Anexo acima disto é ignorado sem chamar a IA.
const LIMITE_MB = 8

// Teto de sanidade para o valor. A coluna do banco é NUMERIC(12,2): um valor
// acima disso faz o INSERT estourar, e o boleto se perde num erro de banco em
// vez de virar conta. R$ 5 milhões fica bem acima da maior nota já vista aqui
// (SYAGRI, R$ 1,06 mi) e bem abaixo do limite da coluna. Achado do Apolo.
const VALOR_MAX = 5_000_000

// Vencimento fora desta janela é leitura errada, não boleto excêntrico: ninguém
// manda por e-mail um boleto que venceu há mais de meio ano, nem um que vence
// depois de dois anos. Sem esta trava, um "2026" lido como "2062" viraria uma
// conta que some no fim da lista e nunca mais é cobrada.
const DIAS_PASSADO_MAX = 180
const DIAS_FUTURO_MAX  = 730

export type BoletoLido = {
  valor:       number
  vencimento:  string          // 'YYYY-MM-DD'
  beneficiario: string
  // Número do documento/nota impresso no boleto, quando houver. Só serve para o
  // dono reconhecer a compra na tela — NÃO é usado para casar com a NF-e:
  // o mesmo número existe em fornecedores diferentes (ver a trava de duplicata
  // por número+CNPJ em nfeProcessor.ts).
  documento:   string | null
  // Quantas cobranças o documento traz. > 1 é carnê ou nota parcelada: só a
  // primeira parcela vira conta, e quem chama PRECISA avisar o dono das outras.
  // Sem este campo, um carnê de 12 parcelas virava 1 conta e 11 sumiam sem log,
  // sem aviso e sem nada na tela indicando a perda (achado do Apolo).
  totalDeCobrancas: number
}

// O resultado da leitura, com a distinção que decide se o e-mail pode ser
// marcado como lido: "não é boleto" é uma conclusão (o e-mail já foi tratado),
// "falha" é a ausência de conclusão (precisa voltar no próximo ciclo).
//
// Antes as duas devolviam `null` e o e-mail era marcado como lido de qualquer
// jeito — então uma instabilidade da API (529, resposta truncada) apagava o
// boleto para sempre, em silêncio. O caminho do XML nunca teve esse buraco:
// lá a exceção sobe e pula o messageFlagsAdd. Achado [alto] do Apolo.
export type ResultadoLeitura =
  | { status: 'boleto'; boleto: BoletoLido }
  | { status: 'nao-boleto' }
  | { status: 'falha'; motivo: string }

// O que a IA responde. `ehBoleto` vem PRIMEIRO de propósito: sem essa pergunta
// explícita, um PDF de nota (ou de propaganda do fornecedor) era respondido com
// números inventados para preencher o formato. Com ela, o modelo tem para onde
// dizer "isto não é boleto" em vez de chutar.
const SCHEMA = {
  type: 'object',
  properties: {
    ehBoleto: {
      type: 'boolean',
      description: 'true SOMENTE se o documento for um boleto bancário ou carnê de cobrança com valor e vencimento impressos. Nota fiscal (DANFE), recibo, propaganda ou comprovante de pagamento = false.',
    },
    valor: {
      type: ['number', 'null'],
      description: 'Valor do documento em reais, o que o pagador deve pagar. Use ponto decimal (1234.56). null se não for boleto ou o valor não estiver legível.',
    },
    vencimento: {
      type: ['string', 'null'],
      description: 'Data de vencimento no formato AAAA-MM-DD. Atenção: no boleto ela vem como DD/MM/AAAA. null se não for boleto ou a data não estiver legível.',
    },
    beneficiario: {
      type: ['string', 'null'],
      description: 'Nome de quem recebe (beneficiário/cedente), como está impresso. null se não for boleto.',
    },
    documento: {
      type: ['string', 'null'],
      description: 'Número do documento ou da nota fiscal impresso no boleto, se houver. null quando não houver.',
    },
    totalDeCobrancas: {
      type: ['integer', 'null'],
      description: 'Quantas cobranças distintas (parcelas) este documento contém no total. 1 para um boleto comum. Em carnê ou nota parcelada, o número total de parcelas impressas. Se for 1 ou não der para contar, responda 1. Os campos valor e vencimento devem ser sempre os da PRIMEIRA cobrança a vencer.',
    },
  },
  required: ['ehBoleto', 'valor', 'vencimento', 'beneficiario', 'documento', 'totalDeCobrancas'],
  additionalProperties: false,
} as const

const INSTRUCAO =
  'Você está lendo um anexo de e-mail de um fornecedor agrícola. ' +
  'Diga se é um boleto de cobrança e, se for, extraia valor, vencimento e beneficiário exatamente como impressos. ' +
  'Não calcule, não estime e não complete o que estiver ilegível — devolva null no campo. ' +
  'Se houver mais de um valor, use o valor do documento (o que o pagador deve pagar), não juros, multa ou desconto.'

// O formato bater NÃO prova que a data existe: '2026-02-31' passa no regex, e
// `Date.UTC` não reclama — ele ROLA para 3 de março. Sem esta checagem, um dia
// mal lido no boleto viraria silenciosamente um vencimento em outro mês, e a
// conta apareceria com a data errada sem nada indicando o problema. Mesmo
// padrão de `mesDe()` em deNotaFiscal.ts: monta a data e confere se os
// componentes voltaram iguais aos que entraram.
function dataExiste(iso: string): boolean {
  const [ano, mes, dia] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

// Recusa em vez de adivinhar. Um campo faltando aqui vira `null` no fim: quem
// chama trata como "não é boleto" e o anexo é ignorado, que é o resultado certo
// — um boleto pela metade seria pior que nenhum, porque pareceria completo.
// Exportada só para teste: é a única parte desta leitura que dá para provar sem
// gastar uma chamada de IA por asserção — e é justamente onde mora a decisão de
// aceitar ou recusar um boleto.
export function validarBoletoLido(bruto: any, hojeISO: string): BoletoLido | null {
  // `=== true`, não apenas verdadeiro: com a string 'false' — que é verdadeira
  // em JavaScript — a checagem frouxa aceitaria como boleto um documento que o
  // modelo acabou de dizer que NÃO é.
  if (bruto?.ehBoleto !== true) return null

  const { valor, vencimento, beneficiario } = bruto

  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return null
  if (valor > VALOR_MAX) return null
  if (typeof vencimento !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return null
  if (!dataExiste(vencimento)) return null

  const dias = diasEntre(hojeISO, vencimento)
  if (!(dias >= -DIAS_PASSADO_MAX && dias <= DIAS_FUTURO_MAX)) return null

  return {
    // Arredondado aqui, não no banco: a coluna é NUMERIC(12,2) e arredondaria
    // 642.226 para 642,23 por conta própria — um centavo de diferença entre o
    // que o log diz que foi lido e o que a tela mostra, que ninguém explicaria.
    valor: Math.round(valor * 100) / 100,
    vencimento,
    beneficiario: typeof beneficiario === 'string' && beneficiario.trim()
      ? beneficiario.trim()
      : 'Fornecedor não identificado',
    documento: typeof bruto.documento === 'string' && bruto.documento.trim()
      ? bruto.documento.trim()
      : null,
    // Na dúvida, 1 — um número de parcelas mal lido não pode recusar um boleto
    // que tem valor e data válidos. O aviso de "tem mais parcelas" é um extra;
    // a conta em si é o que não pode se perder.
    totalDeCobrancas: Number.isInteger(bruto.totalDeCobrancas) && bruto.totalDeCobrancas > 1
      ? bruto.totalDeCobrancas
      : 1,
  }
}

// NUNCA estoura: quem chama está dentro do laço de e-mails, e um PDF estranho
// não pode derrubar o processamento dos outros anexos. Mas a diferença entre
// "concluí que não é boleto" e "não consegui concluir" vai no `status` — quem
// chama usa isso para decidir se o e-mail já pode ser marcado como lido.
export async function lerBoletoDoPdf(
  pdf: Buffer,
  nomeArquivo: string,
  hojeISO: string,
  anthropic: Anthropic,
): Promise<ResultadoLeitura> {
  if (pdf.length > LIMITE_MB * 1024 * 1024) {
    // Conclusão, não falha: um anexo desse tamanho não é boleto, e reprocessar
    // o e-mail para chegar à mesma conclusão amanhã não ajudaria ninguém.
    console.log(`[BoletoPDF] "${nomeArquivo}" tem ${(pdf.length / 1024 / 1024).toFixed(1)} MB — acima do limite, ignorado.`)
    return { status: 'nao-boleto' }
  }

  try {
    const resposta = await anthropic.messages.create({
      model:      MODELO,
      max_tokens: 1024,
      // A leitura é curta e o formato é fechado pelo schema; pensar mais não
      // melhora nada aqui e só custa tempo e token em cima de cada anexo.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          // O documento vem ANTES do texto: é a ordem recomendada pela API para
          // PDF, e o pedido lido depois do documento gera menos alucinação.
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
          { type: 'text', text: INSTRUCAO },
        ],
      }],
    })

    // Uma recusa por política devolve 200 com stop_reason 'refusal' e conteúdo
    // vazio — ler content[0] direto quebraria. Não é erro: é anexo que não vamos
    // conseguir ler, mesmo caminho de "não é boleto".
    if (resposta.stop_reason === 'refusal') {
      // Conclusão: reler amanhã dá a mesma recusa.
      console.warn(`[BoletoPDF] Leitura de "${nomeArquivo}" recusada pelo modelo — ignorado.`)
      return { status: 'nao-boleto' }
    }

    // Resposta cortada no meio: o JSON vem truncado e a leitura é inútil. É
    // FALHA, não conclusão — o e-mail precisa voltar.
    if (resposta.stop_reason === 'max_tokens') {
      return { status: 'falha', motivo: 'resposta truncada (max_tokens)' }
    }

    const texto = resposta.content.find(b => b.type === 'text')
    if (!texto || texto.type !== 'text') {
      return { status: 'falha', motivo: 'resposta sem texto' }
    }

    const lido = validarBoletoLido(JSON.parse(texto.text), hojeISO)

    if (!lido) {
      console.log(`[BoletoPDF] "${nomeArquivo}" não é boleto (ou está ilegível) — ignorado.`)
      return { status: 'nao-boleto' }
    }

    return { status: 'boleto', boleto: lido }

  } catch (err) {
    // Não estoura (o laço de e-mails continua), mas devolve FALHA: erro de rede,
    // 529, chave inválida ou nome de modelo errado caem todos aqui. Marcado como
    // falha, o e-mail não vira lido e o boleto tem nova chance em 30 minutos.
    // Um nome de modelo errado, por exemplo, dá 404 em produção sem quebrar
    // nenhum teste — a suíte usa mock. Este caminho é a única rede.
    const motivo = err instanceof Error ? err.message : String(err)
    console.error(`[BoletoPDF] Falha ao ler "${nomeArquivo}":`, motivo)
    return { status: 'falha', motivo }
  }
}
