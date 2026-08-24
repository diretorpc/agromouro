import Anthropic from '@anthropic-ai/sdk'
import { dataExiste, diasEntre } from '../contas/datas'
import type { NFeData, NFeItem, NFeDuplicata } from '../nfeProcessor'

// Lê o DANFE (ou a NFS-e) em PDF que o fornecedor mandou e devolve os campos
// de uma nota fiscal — sem XML nenhum. Esta é só a LEITURA e a VALIDAÇÃO;
// gravar é `gravarNotaDoPdf.ts`, que entrega o resultado daqui ao MESMO
// `processarNFe` que o XML usa (estoque, financeiro, boleto e WhatsApp saem
// pelo cano que já existe).
//
// Regra que manda em tudo aqui: RECUSAR em vez de adivinhar. O PDF é a IA
// lendo papel, e um dígito errado no número ou no CNPJ fura o índice único da
// nota — quando a mesma nota chegar depois pelo Make, estoque e gasto contam
// duas vezes, calados (memória "nfe-corrida-duas-portas", corrida de 11 ms
// medida em produção).

// Mesma regra ETC de documentoPdf.ts/boletoPdf.ts: o modelo vem do ambiente,
// nunca cravado. Sem `effort: 'low'` — uma DANFE tem tabela de produtos com
// NCM e CFOP por linha, e errar uma linha é estoque ou dinheiro errado.
const MODELO = process.env.ANTHROPIC_MODEL_NOTA_PDF ?? 'claude-opus-5'

// Mesmo teto do bucket "notas-pdf" (10 MB, configurado no painel). Aceitar em
// código mais do que o bucket aceita faria a leitura passar e o upload falhar
// depois — gastando uma chamada de IA para nada.
const LIMITE_MB = 10

// Tetos de sanidade de NEGÓCIO, não de banco. A maior nota já vista no projeto
// é a da SYAGRI, R$ 1,06 mi (ver VALOR_MAX em contas/boletoPdf.ts). Acima
// disso é leitura errada, não compra real.
const VALOR_MAX_NOTA     = 5_000_000
const VALOR_MAX_ITEM     = 2_000_000
const VALOR_MAX_UNITARIO = 50_000_000
const QUANTIDADE_MAX     = 1_000_000_000

// 200 é o MESMO corte que processarNFe aplica (`itensSeguros`). Cortar aqui, e
// não só lá, é o que permite CONTAR o excedente e avisar na tela — lá o
// excedente some calado.
const MAX_ITENS      = 200
const MAX_DUPLICATAS = 24

// Janela da data de EMISSÃO: nota velha existe (importação de histórico), nota
// emitida no futuro não. 30 dias de folga cobrem fuso e relógio torto.
const DIAS_PASSADO_MAX = 5 * 365
const DIAS_FUTURO_MAX  = 30

// Janela do VENCIMENTO das duplicatas: bem mais larga no futuro — defensivo é
// pago em duas datas fixas por ano, e contrato de adubo passa de 12 meses.
const DIAS_VENCIMENTO_FUTURO_MAX = 730

export type ItemNotaLido = {
  descricao:      string
  quantidade:     number
  unidade:        string
  valorUnitario:  number
  valorTotal:     number
  quantidadeTrib: number
  unidadeTrib:    string
  ncm:            string   // '' quando ilegível — a cascata de processarNFe trata
  cfop:           string   // '' quando ilegível
}

export type DuplicataLida = {
  numero:     string
  vencimento: string | null
  valor:      number | null
}

export type NotaLidaDoPdf = {
  modelo:         'nfe' | 'nfse'
  numero:         string
  emitenteNome:   string
  emitenteCnpj:   string
  dataEmissao:    string
  valorTotal:     number
  formaPagamento: string | null
  duplicatas:     DuplicataLida[]
  itens:          ItemNotaLido[]
}

export type ValidacaoNota =
  | { status: 'nota'; nota: NotaLidaDoPdf; itensDescartados: number; duplicatasDescartadas: number }
  // Número ou CNPJ ilegível. É recusa dura: sem os dois, a trava de
  // duplicidade do banco não tem chave, e a nota entraria sem defesa nenhuma.
  | { status: 'sem-identidade' }
  | { status: 'dados-invalidos'; campo: 'dataEmissao' | 'valorTotal' }
  // Nota sem nenhum item aproveitável NÃO vira NFeData vazio: em processarNFe,
  // `every` de lista vazia é `true`, então ela cairia em "tudo é compra" e
  // lançaria o valor cheio no Financeiro sem um único item que justifique.
  | { status: 'sem-itens' }

export type ResultadoLeituraNota =
  | ValidacaoNota
  | { status: 'nao-nota' }
  | { status: 'grande-demais' }
  // "falha" é INFRA (rede, sobrecarga, chave inválida, resposta truncada) —
  // vira 503 "tente de novo", nunca 422 "seu arquivo é inválido".
  | { status: 'falha'; motivo: string }

export const SCHEMA = {
  type: 'object',
  properties: {
    ehNotaFiscal: {
      type: 'boolean',
      description:
        'true SOMENTE se o documento for uma nota fiscal: DANFE (Documento Auxiliar da Nota Fiscal Eletrônica, ' +
        'com quadro EMITENTE, DESTINATÁRIO e tabela DADOS DO PRODUTO/SERVIÇO) ou nota fiscal de serviço (NFS-e) ' +
        'de uma prefeitura. Boleto bancário, extrato de "contas a receber", contrato de compra e venda, ' +
        'comprovante de pagamento, propaganda ou orçamento = false.',
    },
    // ⚠️ NÃO troque `type: 'string'` por `type: ['string','null']` aqui — a API
    // da Anthropic RECUSA a requisição inteira com HTTP 400 quando uma
    // propriedade combina `enum` com `type` em array, mesmo que o enum liste
    // null: "Invalid schema: Enum value 'nfe' does not match declared type
    // '['string','null']'". Medido em runtime em 23/08/2026 no schema irmão
    // (documentoPdf.ts), fora dos testes — a suíte mocka a IA e nunca manda o
    // schema pra API de verdade. Guarda contra recaída: teste de invariante em
    // notaPdf.test.ts. `null` não faz falta: quem não for 'nfse' vira 'nfe'.
    modelo: {
      type: 'string',
      enum: ['nfe', 'nfse'],
      description:
        '"nfe" para nota de PRODUTO (DANFE, com CFOP e NCM por item). "nfse" para nota de SERVIÇO ' +
        '(NFS-e municipal, sem CFOP/NCM, com ISS e descrição de serviço prestado). Na dúvida, "nfe".',
    },
    numero: {
      type: ['string', 'null'],
      description:
        'Número da nota, como impresso, só os dígitos (ex.: "Nº 000.058.717" → "58717"). ' +
        'NÃO é a chave de acesso de 44 dígitos e NÃO é a série. null se ilegível.',
    },
    emitenteNome: {
      type: ['string', 'null'],
      description:
        'Razão social de quem EMITIU a nota (o fornecedor/vendedor, quadro "EMITENTE"). ' +
        'NUNCA o DESTINATÁRIO/REMETENTE (que é o dono da fazenda) nem a transportadora. null se ilegível.',
    },
    emitenteCnpj: {
      type: ['string', 'null'],
      description:
        'CNPJ do EMITENTE, só dígitos, sem ponto/barra/traço (14 dígitos; 11 se for CPF de produtor rural). ' +
        'NUNCA o CNPJ do destinatário nem o da transportadora. null se ilegível.',
    },
    dataEmissao: {
      type: ['string', 'null'],
      description:
        'Data de EMISSÃO da nota, formato AAAA-MM-DD. Não é a data de saída/entrada nem a de vencimento. ' +
        'null se ilegível.',
    },
    valorTotal: {
      type: ['number', 'null'],
      description:
        'VALOR TOTAL DA NOTA (campo "V. TOTAL DA NOTA" no quadro CÁLCULO DO IMPOSTO) — o valor cheio, com ' +
        'frete e impostos, NÃO o "valor total dos produtos". Use ponto decimal. null se ilegível.',
    },
    formaPagamento: {
      type: ['string', 'null'],
      description:
        'Código tPag impresso no quadro de pagamento, quando houver (ex.: "15" boleto, "01" dinheiro, ' +
        '"03" cartão de crédito, "90" sem pagamento). Só o código, sem descrição. null se não impresso.',
    },
    duplicatas: {
      type: 'array',
      description:
        'Quadro FATURA/DUPLICATA da nota — uma entrada por parcela/boleto. Lista VAZIA quando a nota não ' +
        'traz quadro de cobrança (é o caso das notas de remessa de entrega futura).',
      items: {
        type: 'object',
        properties: {
          numero:     { type: ['string', 'null'], description: 'Número da duplicata/parcela, como impresso (ex.: "001", "58717/1"). null se não houver.' },
          vencimento: { type: ['string', 'null'], description: 'Data de vencimento desta parcela, formato AAAA-MM-DD. null se não impressa.' },
          valor:      { type: ['number', 'null'], description: 'Valor desta parcela. Use ponto decimal. null se não impresso.' },
        },
        required: ['numero', 'vencimento', 'valor'],
        additionalProperties: false,
      },
    },
    itens: {
      type: 'array',
      description:
        'Uma entrada por LINHA da tabela DADOS DO PRODUTO/SERVIÇO. Não agrupe linhas parecidas, não invente ' +
        'linha que não está impressa, e não pule linha que continua na página seguinte.',
      items: {
        type: 'object',
        properties: {
          descricao:     { type: ['string', 'null'], description: 'DESCRIÇÃO DO PRODUTO/SERVIÇO, como impressa. null se ilegível.' },
          quantidade:    { type: ['number', 'null'], description: 'Coluna QUANT. (quantidade comercial). Use ponto decimal. null se ilegível.' },
          unidade:       { type: ['string', 'null'], description: 'Coluna UN (unidade comercial: "UN", "KG", "L", "BD", "SC"...). null se ilegível.' },
          valorUnitario: { type: ['number', 'null'], description: 'Coluna V. UNIT. (preço unitário). Use ponto decimal. null se ilegível.' },
          valorTotal:    { type: ['number', 'null'], description: 'Coluna V. TOTAL da linha (quantidade × unitário). Use ponto decimal. null se ilegível.' },
          ncm: {
            type: ['string', 'null'],
            description:
              'Coluna NCM/SH — exatamente 8 dígitos, só números (ex.: "38089329"). É o código que decide se o ' +
              'produto entra no estoque. NÃO invente, NÃO complete com zeros e NÃO deduza pelo nome do ' +
              'produto: null quando a coluna não estiver legível.',
          },
          cfop: {
            type: ['string', 'null'],
            description:
              'Coluna CFOP — exatamente 4 dígitos (ex.: "5102", "5117", "5910"). É o código que decide se a ' +
              'nota é compra, remessa de entrega futura ou bonificação. NÃO invente e NÃO repita o CFOP de ' +
              'outra linha: cada linha tem o seu, e "compre 20, leve 2" vem com códigos diferentes na mesma ' +
              'nota. null quando a coluna não estiver legível.',
          },
        },
        required: ['descricao', 'quantidade', 'unidade', 'valorUnitario', 'valorTotal', 'ncm', 'cfop'],
        additionalProperties: false,
      },
    },
  },
  required: ['ehNotaFiscal', 'modelo', 'numero', 'emitenteNome', 'emitenteCnpj', 'dataEmissao', 'valorTotal', 'formaPagamento', 'duplicatas', 'itens'],
  additionalProperties: false,
} as const

const INSTRUCAO =
  'Você está lendo uma nota fiscal de compra de insumo agrícola, em PDF — um DANFE (nota de produto) ou uma ' +
  'NFS-e (nota de serviço). Extraia os campos exatamente como impressos. ' +
  'NÃO calcule, NÃO estime e NÃO complete o que estiver ilegível: devolva null no campo. ' +
  'O EMITENTE é o fornecedor que vendeu; o DESTINATÁRIO é a fazenda que comprou — nunca troque os dois, e ' +
  'nunca use os dados da transportadora. ' +
  'Na tabela DADOS DO PRODUTO/SERVIÇO, uma linha impressa = um item, inclusive quando a tabela continua na ' +
  'página seguinte. As colunas NCM/SH e CFOP são as mais importantes de todas: elas decidem se o produto ' +
  'entra no estoque e se a nota é compra, remessa de entrega futura ou bonificação. Cada linha tem o SEU ' +
  'CFOP — uma nota de "compre 20, leve 2" traz códigos diferentes na mesma tabela. Se a coluna estiver ' +
  'ilegível, devolva null: um código inventado vale menos que nenhum código. ' +
  'O valor total é o "V. TOTAL DA NOTA" do quadro CÁLCULO DO IMPOSTO, não o "valor total dos produtos". ' +
  'O quadro FATURA/DUPLICATA vira a lista de duplicatas, uma entrada por parcela; nota sem esse quadro tem ' +
  'lista vazia. ' +
  'Se o arquivo não for nota fiscal (boleto, extrato de contas a receber, contrato, comprovante, propaganda), ' +
  'responda ehNotaFiscal = false e deixe o resto em null ou lista vazia.'

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function numeroFinito(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Só dígitos: o DANFE imprime "04.063.805/0001-35" e o dado fiscal é o número
// puro. 11 (CPF de produtor rural) ou 14 (CNPJ) — qualquer outro tamanho é
// leitura errada, e leitura errada de CNPJ é o que fura a trava de duplicidade.
function cnpjLimpo(v: unknown): string | null {
  const digitos = String(v ?? '').replace(/\D/g, '')
  return digitos.length === 11 || digitos.length === 14 ? digitos : null
}

// O DANFE imprime "Nº 000.058.717"; o parser de XML lê <nNF> como NÚMERO e
// grava "58717". Os dois caminhos PRECISAM produzir o mesmo texto: a trava de
// duplicidade é (numero, emitente_cnpj, fazenda_id, modelo) comparada como
// string — "000058717" e "58717" seriam duas notas diferentes para o banco, e
// a compra entraria duas vezes quando o XML chegasse pelo Make.
function numeroDaNota(v: unknown): string | null {
  const digitos = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '')
  return digitos.length > 0 ? digitos : null
}

function dataNaJanela(v: unknown, hojeISO: string, diasPassado: number, diasFuturo: number): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !dataExiste(v)) return null
  const dias = diasEntre(hojeISO, v)
  return dias >= -diasPassado && dias <= diasFuturo ? v : null
}

function codigoDeNDigitos(v: unknown, n: number): string {
  const digitos = String(v ?? '').replace(/\D/g, '')
  return digitos.length === n ? digitos : ''
}

// Exportada só para teste: é a única parte desta leitura que dá para provar sem
// gastar uma chamada de IA, e é onde mora a decisão de aceitar ou recusar. Roda
// DUAS vezes no fluxo real — na leitura (passo 1) e de novo quando o dono
// confirma o que editou na tela (passo 2), para não existirem duas réguas
// diferentes para a mesma nota.
export function validarNotaLida(bruto: unknown, hojeISO: string): ValidacaoNota {
  const b = (bruto ?? {}) as Record<string, unknown>

  // 1. Identidade — sem ela a nota não tem chave de duplicidade.
  const numero = numeroDaNota(b.numero)
  const cnpj   = cnpjLimpo(b.emitenteCnpj)
  if (!numero || !cnpj) return { status: 'sem-identidade' }

  // 2. Data e valor — recusa dura, não descarte de linha.
  const dataEmissao = dataNaJanela(b.dataEmissao, hojeISO, DIAS_PASSADO_MAX, DIAS_FUTURO_MAX)
  if (!dataEmissao) return { status: 'dados-invalidos', campo: 'dataEmissao' }

  const valorTotal = numeroFinito(b.valorTotal)
  if (valorTotal === null || valorTotal <= 0 || valorTotal > VALOR_MAX_NOTA) {
    return { status: 'dados-invalidos', campo: 'valorTotal' }
  }

  // 3. Itens — a unidade de recusa aqui é a LINHA, nunca a nota. Uma nota com
  //    20 itens e 1 ilegível não pode perder os outros 19.
  const itensBrutos = Array.isArray(b.itens) ? b.itens : []
  let itensDescartados = 0
  if (itensBrutos.length > MAX_ITENS) {
    itensDescartados += itensBrutos.length - MAX_ITENS
    console.warn(`[NotaPDF] ${itensBrutos.length} itens lidos — cortando em ${MAX_ITENS}.`)
  }

  const itens: ItemNotaLido[] = []
  for (const cru of itensBrutos.slice(0, MAX_ITENS)) {
    const i = (cru ?? {}) as Record<string, unknown>
    const descricao  = texto(i.descricao)
    const quantidade = numeroFinito(i.quantidade)
    const total      = numeroFinito(i.valorTotal)

    if (!descricao
      || quantidade === null || quantidade <= 0 || quantidade >= QUANTIDADE_MAX
      || total === null || total < 0 || total > VALOR_MAX_ITEM) {
      itensDescartados++
      continue
    }

    const unitarioLido = numeroFinito(i.valorUnitario)
    const unidade      = texto(i.unidade) ?? 'un'

    itens.push({
      descricao,
      quantidade,
      unidade,
      // Unitário absurdo vira 0 em vez de derrubar a linha: o que soma no
      // Financeiro é o valor TOTAL, e perder a linha custaria mais.
      valorUnitario: unitarioLido !== null && unitarioLido >= 0 && unitarioLido <= VALOR_MAX_UNITARIO ? unitarioLido : 0,
      valorTotal:    total,
      // O DANFE imprime uma quantidade só — não existe qTrib/uTrib no papel.
      // Espelhar as comerciais faz processarNFe pular a conversão de unidade
      // comercial (ele exige uTrib DIFERENTE de uCom para converter).
      quantidadeTrib: quantidade,
      unidadeTrib:    unidade,
      ncm:  codigoDeNDigitos(i.ncm, 8),
      cfop: codigoDeNDigitos(i.cfop, 4),
    })
  }

  if (itens.length === 0) return { status: 'sem-itens' }

  // 4. Duplicatas — nunca derrubam a nota. Vencimento ilegível vira null (caso
  //    ERCAL, medido em 31/07/2026): duplicataEhReal já sabe tratar isso, e
  //    sumir com a linha esconderia uma cobrança real.
  const dupsBrutas = Array.isArray(b.duplicatas) ? b.duplicatas : []
  let duplicatasDescartadas = 0
  if (dupsBrutas.length > MAX_DUPLICATAS) {
    duplicatasDescartadas += dupsBrutas.length - MAX_DUPLICATAS
    console.warn(`[NotaPDF] ${dupsBrutas.length} duplicatas lidas — cortando em ${MAX_DUPLICATAS}.`)
  }

  const duplicatas: DuplicataLida[] = dupsBrutas.slice(0, MAX_DUPLICATAS).map(cru => {
    const d = (cru ?? {}) as Record<string, unknown>
    const valor = numeroFinito(d.valor)
    return {
      numero:     texto(d.numero) ?? '',
      vencimento: dataNaJanela(d.vencimento, hojeISO, DIAS_PASSADO_MAX, DIAS_VENCIMENTO_FUTURO_MAX),
      valor:      valor !== null && valor > 0 && valor <= VALOR_MAX_NOTA ? valor : null,
    }
  })

  const modelo: 'nfe' | 'nfse' = b.modelo === 'nfse' ? 'nfse' : 'nfe'

  return {
    status: 'nota',
    nota: {
      modelo,
      numero,
      // Nome ilegível não derruba a nota: quem identifica é o CNPJ. Recusar
      // por causa do nome seria perder uma nota real por detalhe cosmético.
      emitenteNome: texto(b.emitenteNome) ?? 'Fornecedor não identificado',
      emitenteCnpj: cnpj,
      dataEmissao,
      valorTotal,
      formaPagamento: texto(b.formaPagamento),
      duplicatas,
      itens,
    },
    itensDescartados,
    duplicatasDescartadas,
  }
}

// Tradução pura para o formato que processarNFe consome. Sem I/O, sem banco —
// é o ponto exato onde o mundo do PDF encontra o mundo do XML.
export function converterParaNFeData(nota: NotaLidaDoPdf): NFeData {
  const items: NFeItem[] = nota.itens.map(i => ({
    description:  i.descricao,
    quantity:     i.quantidade,
    unit:         i.unidade,
    unitValue:    i.valorUnitario,
    totalValue:   i.valorTotal,
    quantityTrib: i.quantidadeTrib,
    unitTrib:     i.unidadeTrib,
    ncm:          i.ncm,
    cfop:         i.cfop,
    // `servico: true` vence a cascata de estoque sem consultar a IA de
    // categorização — mesma trava que parseXmlNFSe usa. Serviço nunca é
    // estocável, ponto final.
    ...(nota.modelo === 'nfse' ? { servico: true } : {}),
  }))

  const duplicatas: NFeDuplicata[] = nota.duplicatas.map(d => ({
    numero:     d.numero,
    vencimento: d.vencimento,
    valor:      d.valor,
  }))

  return {
    numero:         nota.numero,
    dataEmissao:    nota.dataEmissao,
    emitenteNome:   nota.emitenteNome,
    emitenteCnpj:   nota.emitenteCnpj,
    valorTotal:     nota.valorTotal,
    items,
    duplicatas,
    formaPagamento: nota.formaPagamento,
    modelo:         nota.modelo,
  }
}

export async function lerNotaPdf(
  pdf: Buffer,
  nomeArquivo: string,
  hojeISO: string,
  anthropic: Anthropic,
): Promise<ResultadoLeituraNota> {
  if (pdf.length > LIMITE_MB * 1024 * 1024) {
    console.log(`[NotaPDF] "${nomeArquivo}" tem ${(pdf.length / 1024 / 1024).toFixed(1)} MB — acima do limite.`)
    return { status: 'grande-demais' }
  }

  try {
    // `.stream().finalMessage()` e não `.create()`: com max_tokens alto o SDK
    // RECUSA rodar sem streaming e lança antes mesmo da chamada de rede
    // ("Streaming is required for operations that may take longer than 10
    // minutes") — medido ao vivo em 18/08/2026 no leitor irmão, fora dos
    // testes, porque a suíte mocka a IA. 200 itens × ~180 bytes de JSON por
    // linha ≈ 36.000 caracteres: 32.000 tokens dão folga.
    const resposta = await anthropic.messages.stream({
      model:      MODELO,
      max_tokens: 32000,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
          { type: 'text', text: INSTRUCAO },
        ],
      }],
    }).finalMessage()

    if (resposta.stop_reason === 'max_tokens') {
      return { status: 'falha', motivo: 'resposta truncada (max_tokens)' }
    }

    const bloco = resposta.content.find(b => b.type === 'text')
    if (!bloco || bloco.type !== 'text') {
      return { status: 'falha', motivo: 'resposta sem bloco de texto' }
    }

    let bruto: unknown
    try {
      bruto = JSON.parse(bloco.text)
    } catch {
      return { status: 'falha', motivo: 'resposta não é JSON válido' }
    }

    // `ehNotaFiscal` é conclusão sobre o ARQUIVO, não sobre os dados — por isso
    // é decidida aqui e não dentro de validarNotaLida, que só cuida do conteúdo
    // e é reusada no passo 2, quando o dono confirma o que editou.
    if ((bruto as Record<string, unknown>)?.ehNotaFiscal !== true) {
      return { status: 'nao-nota' }
    }

    return validarNotaLida(bruto, hojeISO)
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'erro desconhecido'
    console.error(`[NotaPDF] Falha ao ler "${nomeArquivo}":`, motivo)
    return { status: 'falha', motivo }
  }
}
