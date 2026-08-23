import { supabase } from '../supabase'

// Edita um item de Controle (importado de PDF ou avulso) — nunca um item de
// NF-e. Existe porque o pedido do Matheus (tela editável estilo Excel) exige
// clicar numa célula e digitar; até esta rota, Controle só tinha CRIAR
// (upload de PDF) e APAGAR documento inteiro. Ver desenho completo:
// docs/superpowers/specs/2026-08-18-controle-tabela-editavel-design.md.

export type PatchItemControle = Partial<{
  descricao:        string
  quantidade:       number | null
  unidade:          string
  valor_unitario:   number | null
  valor_total:      number
  data_manual:      string | null
  fornecedor:       string | null
  numero_documento: string | null
}>

export type ItemControleRow = {
  id: string
  descricao: string
  quantidade: number | null
  unidade: string
  valor_unitario: number | null
  valor_total: number
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
}

export type ResultadoEditarItem =
  | { status: 'editado'; item: ItemControleRow }
  | { status: 'nao_encontrado' }
  // Conflito de unicidade (23505, idx_itens_nfe_dedupe_item da migration
  // 018) — deveria ser raro: editar a ponto de bater EXATAMENTE na chave de
  // outro item (fornecedor+número+descrição+valor+ocorrência, os 5+1
  // primeiros) é diferente do "parece igual" que a tela pinta como aviso
  // (Caso 2 do desenho, mais solto). Ainda assim precisa de resposta clara,
  // não um 500 cru.
  | { status: 'conflito' }
  // Achado 8 da revisão do Apolo (18/08/2026): item importado de PDF
  // (`documento_controle_id not null`) é OBRIGADO a ter `data_manual`
  // preenchido — constraint `item_de_documento_completo` da migration 017.
  // Apagar a célula Data na grade manda `data_manual: null` no patch; sem
  // esta checagem ANTES do UPDATE, o Postgres recusa com 23514 e o dono via
  // um 500 cru sem explicação nenhuma.
  | { status: 'data_obrigatoria' }
  | { status: 'erro'; mensagem: string }

const COLUNAS =
  'id, descricao, quantidade, unidade, valor_unitario, valor_total, fornecedor, ' +
  'numero_documento, ocorrencia_no_documento, documento_controle_id, conta_como_compra, ' +
  'data_manual, insumo_id, fazenda_id, duplicata_confirmada_em, duplicata_confirmada_vezes'

export async function editarItemControle(
  itemId: string,
  fazendaId: string,
  patch: PatchItemControle,
): Promise<ResultadoEditarItem> {
  // Busca ANTES de editar — precisa confirmar duas coisas que o `.eq()` do
  // UPDATE sozinho não distingue: (1) o item é desta fazenda (isolamento);
  // (2) o item NÃO é de NF-e (`nota_fiscal_id is null`). Um item de NF-e tem
  // regras de edição próprias (a tela de NF-e/Financeiro, não esta) — editar
  // aqui furaria o constraint `fornecedor_so_sem_nota` (migration 017) na
  // cara do usuário, ou pior, mudaria dado de nota fiscal por uma porta que
  // não deveria conseguir.
  const { data: existente, error: errBusca } = await supabase
    .from('itens_nfe')
    .select('id, documento_controle_id, conta_como_compra')
    .eq('id', itemId)
    .eq('fazenda_id', fazendaId)
    .is('nota_fiscal_id', null)
    .maybeSingle()

  if (errBusca) return { status: 'erro', mensagem: errBusca.message }
  if (!existente) return { status: 'nao_encontrado' }

  // Achado 8: só item AVULSO (sem documento) pode ficar sem data — item de
  // PDF é obrigado (constraint `item_de_documento_completo`, migration 017).
  // `'data_manual' in patch` (não `patch.data_manual === null` sozinho)
  // distingue "o corpo mandou null de propósito" de "o corpo não mandou o
  // campo" — os dois teriam `patch.data_manual === undefined` de qualquer
  // forma em JS, mas só o primeiro caso é uma tentativa real de apagar a
  // data.
  if ('data_manual' in patch && patch.data_manual === null && existente.documento_controle_id !== null) {
    return { status: 'data_obrigatoria' }
  }

  const { data: atualizado, error: errUpdate } = await supabase
    .from('itens_nfe')
    .update({
      ...patch,
      // PRESERVADO do banco, NUNCA lido do corpo da requisição — `patch` já
      // chega aqui sem este campo (fora do schema zod da rota, ver
      // controleItens.ts), mas esta segunda camada garante que mesmo um bug
      // na validação não conseguiria fazer uma edição manual LIGAR o gasto.
      // Ver spec, seção "Trava de conta_como_compra".
      //
      // ⚠️ ERA `false` CRAVADO até 23/08/2026 (Critical 1 da revisão final
      // da branch do contrato de adubo). Aquela linha nasceu em 18/08 sob a
      // premissa "item de Controle NUNCA conta como gasto" — premissa que
      // morreu quando o contrato de fabricante (Mosaic) passou a gravar
      // `conta_como_compra: true` por ser a única fonte daquele gasto (zero
      // NF-e de adubo no banco, medido em 23/08). Com o `false` cravado,
      // digitar em QUALQUER célula da linha do contrato na grade estilo
      // Excel tirava R$ 647.986,35 do Financeiro em silêncio — o dono não
      // via erro nenhum, o número simplesmente encolhia.
      //
      // `=== true` (não `??`, não valor cru) de propósito: só o `true`
      // EXATO vindo do banco preserva o gasto ligado. Coluna ausente do
      // select, `null` de uma linha antiga ou qualquer outro valor cai em
      // `false` — o lado barato, mesma assimetria de `tipoDeDocumento()` em
      // documentoPdf.ts. Extrato de revenda (os R$ 2,77 milhões da Syagri,
      // Solos e Protec) nasce `false` e continua `false` por aqui, sempre.
      conta_como_compra: existente.conta_como_compra === true,
    })
    .eq('id', itemId)
    .eq('fazenda_id', fazendaId)
    .select(COLUNAS)
    .single()

  if (errUpdate) {
    if (errUpdate.code === '23505') return { status: 'conflito' }
    return { status: 'erro', mensagem: errUpdate.message }
  }

  return { status: 'editado', item: atualizado as unknown as ItemControleRow }
}
