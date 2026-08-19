export interface Talhao {
  id: string
  nome: string
  area_ha: number
  cultura_atual: string | null
  status: 'ativo' | 'pousio' | 'colhido'
  coordenadas?: [number, number][] | null
}

export interface Insumo {
  id: string
  nome: string
  tipo: string
  unidade: string
}

export interface Estoque {
  id: string
  insumo_id: string
  quantidade_atual: number
  quantidade_minima_alerta: number
  preco_medio_unitario: number
  created_at: string
  insumos: Insumo
}

export interface MovimentacaoEstoque {
  id: string
  insumo_id: string
  tipo: 'entrada' | 'saida'
  quantidade: number
  data: string
  origem: 'nfe' | 'whatsapp' | 'manual' | 'operacao' | 'correcao_unidade'
  nota_fiscal_id: string | null
  operacao_id: string | null
  insumos: Insumo
  operacoes?: { talhoes?: { nome: string } | null } | null
}

export interface Operacao {
  id: string
  talhao_id: string
  safra_id: string | null
  tipo: string
  data: string
  descricao: string
  fonte: 'whatsapp' | 'manual' | 'jd'
  talhoes?: { nome: string }
}

export interface NotaFiscal {
  id: string
  numero: string
  emitente_nome: string
  emitente_cnpj: string
  data_emissao: string
  valor_total: number
  status: 'recebida' | 'processando' | 'processada' | 'erro'
}

export interface ItemNfe {
  id: string
  nota_fiscal_id: string
  descricao: string
  quantidade: number
  unidade: string
  valor_unitario: number
  valor_total: number
  insumo_id: string | null
  insumos?: Insumo
}

export interface LancamentoFinanceiro {
  id: string
  data: string
  descricao: string
  valor: number
  tipo: 'receita' | 'despesa'
  categoria: string | null
  nota_fiscal_id: string | null
}

export interface Safra {
  id: string
  talhao_id: string
  cultura: string
  data_plantio: string
  data_colheita_prevista: string | null
  status: string
  producao_kg: number | null
  talhoes?: { area_ha: number }
}

export interface Alerta {
  id: string
  tipo: string
  titulo: string
  mensagem: string
  nivel: 'info' | 'aviso' | 'critico'
  lido: boolean
  enviado_whatsapp: boolean
  created_at: string
}

export interface Cotacao {
  commodity: string
  preco_rs: number
  data: string
}

export interface ClimaDay {
  date: string
  tempMin: number
  tempMax: number
  precipitation: number
  precipitationProbability: number
  windspeed: number
}

export interface Cartao {
  id: string
  apelido: string
  bandeira: string | null
  banco: string
  responsavel: string | null
  ativo: boolean
  created_at: string
}

export type ResultadoImportacaoXml =
  | { status: 'criada'; numero: string; emitenteNome: string; valorTotal: number }
  | { status: 'duplicada'; nota: { id: string; numero: string; data_emissao: string; emitente_nome: string } }

export interface ItemDocumentoControle {
  id: string
  descricao: string
  quantidade: number | null
  unidade: string
  valor_unitario: number | null
  valor_total: number
  fornecedor: string | null
  numero_documento: string | null
  ocorrencia_no_documento: number
  documento_controle_id: string
  conta_como_compra: boolean
  data_manual: string | null
  insumo_id: string | null
}

export interface DocumentoControle {
  id: string
  fornecedor: string | null
  numero_documento: string | null
  data_documento: string | null
  valor_total: number | null
  status: 'importado' | 'processando' | 'processado' | 'erro'
  erro_mensagem: string | null
  nome_arquivo: string
  fazenda_id: string
  created_at: string
  itens: ItemDocumentoControle[]
}

export interface ListaDocumentosControle {
  documentos: DocumentoControle[]
  paginaAtual: number
  totalPaginas: number
  totalDocumentos: number
}

export interface FiltrosControle {
  fornecedores: string[]
  status: string[]
}

// Espelha ResultadoGravarDocumento de api/src/services/controle/gravarDocumentoPdf.ts
// — só as 2 variantes que chegam como JSON 200/201 (gravado/duplicada-*). Os outros 5
// status (nao-documento, sem-itens-aproveitaveis, sem-identidade, falha, erro) chegam
// como erro HTTP lançado (422/503/500), tratado no catch — api.ts já lança Error com
// `.message` pronto pra mostrar.
export type ResultadoGravarDocumento =
  | { status: 'gravado'; documentoId: string; itensGravados: number; itensDescartados: number; itensDuplicados: number }
  | { status: 'duplicada-hash' }
  | { status: 'duplicada-conteudo' }

// Item FLAT da grade editável estilo Excel (GET /controle/itens) — espelha
// ItemControleComDuplicata de api/src/services/controle/listarItensControle.ts.
// Diferente de ItemDocumentoControle (que só existe DENTRO de um
// DocumentoControle, na tela antiga agrupada por documento), este tipo
// representa uma linha independente — pode ter documento_controle_id (veio
// de PDF importado) ou não (avulso, digitado direto na grade). Nunca é item
// de NF-e (nota_fiscal_id sempre null aqui — a rota já filtra isso).
export interface ItemControleFlat {
  id: string
  descricao: string
  quantidade: number | null
  unidade: string
  valor_unitario: number | null
  // Nullable aqui de propósito, mesmo o banco quase sempre ter valor
  // (POST /controle/itens exige > 0 pra CRIAR) — a grade permite o usuário
  // LIMPAR a célula transitoriamente enquanto edita (floatColumn da
  // biblioteca sempre aceita null), então o estado local pode passar por
  // null antes de confirmar. Salvar com null vira 400 do backend (zod exige
  // positivo), tratado como erro de validação — ver grade-itens.tsx.
  valor_total: number | null
  fornecedor: string | null
  numero_documento: string | null
  ocorrencia_no_documento: number
  documento_controle_id: string | null
  conta_como_compra: boolean
  data_manual: string | null
  insumo_id: string | null
  fazenda_id: string
  duplicata_confirmada_em: string | null
  duplicata_confirmada_vezes: number
  // Computados na leitura (não gravados como tal) — ver desenho
  // "Duplicatas pintadas", docs/superpowers/specs/2026-08-18-controle-
  // tabela-editavel-design.md.
  duplicado: boolean
  duplicadoMotivo: 'reimportacao' | 'linhas_iguais' | null
}

export interface ListaItensControle {
  itens: ItemControleFlat[]
  paginaAtual: number
  totalPaginas: number
  totalItens: number
}

// Corpo aceito por PATCH/POST /controle/itens(/:id) — espelha
// camposItemEditavel de api/src/routes/controle.ts. `conta_como_compra`
// nunca aparece aqui de propósito (ver spec, "Trava de conta_como_compra").
export type PatchItemControleFlat = Partial<{
  descricao: string
  quantidade: number | null
  unidade: string
  valor_unitario: number | null
  valor_total: number
  data_manual: string | null
  fornecedor: string | null
  numero_documento: string | null
}>
