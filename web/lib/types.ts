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
