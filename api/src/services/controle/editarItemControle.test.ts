import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Banco fake ─────────────────────────────────────────────────────────────
// Cada `.from('itens_nfe')` do service cria um builder NOVO (mesmo padrão de
// excluirDocumentoControle.test.ts) — a rota faz duas chamadas independentes
// (busca, depois update), então dois builders separados, sem interferência
// de filtro entre eles.
const { estadoBanco, chamadasUpdate } = vi.hoisted(() => ({
  estadoBanco: {
    itemSelect: { data: null as any, error: null as any },
    itemUpdate: { data: null as any, error: null as any },
  },
  chamadasUpdate: [] as { payload: any; filtros: Record<string, any> }[],
}))

vi.mock('../supabase', () => {
  function builder() {
    const filtros: Record<string, any> = {}
    let modo: 'select' | 'update' | null = null
    let payloadUpdate: any = null
    const obj: any = {
      select: vi.fn(() => { if (modo !== 'update') modo = 'select'; return obj }),
      update: vi.fn((payload: any) => { modo = 'update'; payloadUpdate = payload; return obj }),
      eq: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      is: vi.fn((campo: string, valor: any) => { filtros[campo] = valor; return obj }),
      maybeSingle: vi.fn(() => Promise.resolve(estadoBanco.itemSelect)),
      single: vi.fn(() => {
        chamadasUpdate.push({ payload: payloadUpdate, filtros: { ...filtros } })
        return Promise.resolve(estadoBanco.itemUpdate)
      }),
    }
    return obj
  }

  return { supabase: { from: vi.fn(() => builder()) } }
})

import { editarItemControle } from './editarItemControle'

const FAZENDA_A = 'fazenda-aaa'

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.itemSelect = { data: null, error: null }
  estadoBanco.itemUpdate = { data: null, error: null }
  chamadasUpdate.length = 0
})

describe('editarItemControle', () => {
  it('item não encontrado (id errado, outra fazenda, ou é item de NF-e): nao_encontrado, não tenta UPDATE', async () => {
    estadoBanco.itemSelect = { data: null, error: null }

    const r = await editarItemControle('item-x', FAZENDA_A, { descricao: 'novo' })

    expect(r).toEqual({ status: 'nao_encontrado' })
    expect(chamadasUpdate).toHaveLength(0)
  })

  it('falha ao BUSCAR o item: status erro com a mensagem, não tenta UPDATE', async () => {
    estadoBanco.itemSelect = { data: null, error: { message: 'timeout de conexão' } }

    const r = await editarItemControle('item-1', FAZENDA_A, { descricao: 'novo' })

    expect(r).toEqual({ status: 'erro', mensagem: 'timeout de conexão' })
    expect(chamadasUpdate).toHaveLength(0)
  })

  it('sucesso: edita e devolve o item atualizado', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1' }, error: null }
    const itemAtualizado = { id: 'item-1', descricao: 'ADUBO CORRIGIDO', valor_total: 1600, conta_como_compra: false }
    estadoBanco.itemUpdate = { data: itemAtualizado, error: null }

    const r = await editarItemControle('item-1', FAZENDA_A, { descricao: 'ADUBO CORRIGIDO', valor_total: 1600 })

    expect(r).toEqual({ status: 'editado', item: itemAtualizado })
    expect(chamadasUpdate).toHaveLength(1)
    expect(chamadasUpdate[0].filtros).toEqual({ id: 'item-1', fazenda_id: FAZENDA_A })
  })

  // TRAVA DE DINHEIRO — item de Controle nunca pode virar gasto duplicado no
  // Financeiro (Controle é conferência; o gasto real vem só da NF-e). Mesmo
  // que um bug de validação a montante deixasse `conta_como_compra: true`
  // passar no corpo da requisição, o UPDATE precisa gravar `false` de
  // qualquer forma — cinto e suspensório.
  it('conta_como_compra: true no patch é IGNORADO — o UPDATE grava false de qualquer forma', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1' }, error: null }
    estadoBanco.itemUpdate = { data: { id: 'item-1', conta_como_compra: false }, error: null }

    await editarItemControle('item-1', FAZENDA_A, { descricao: 'x', conta_como_compra: true } as any)

    expect(chamadasUpdate).toHaveLength(1)
    expect(chamadasUpdate[0].payload.conta_como_compra).toBe(false)
  })

  it('conflito de unicidade (23505, idx_itens_nfe_dedupe_item): status conflito, não 500 cru', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1' }, error: null }
    estadoBanco.itemUpdate = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"' },
    }

    const r = await editarItemControle('item-1', FAZENDA_A, { descricao: 'x', valor_total: 100 })

    expect(r).toEqual({ status: 'conflito' })
  })

  it('erro genérico no UPDATE: status erro com a mensagem', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1' }, error: null }
    estadoBanco.itemUpdate = { data: null, error: { message: 'connection reset' } }

    const r = await editarItemControle('item-1', FAZENDA_A, { descricao: 'x' })

    expect(r).toEqual({ status: 'erro', mensagem: 'connection reset' })
  })

  // Achado 8 da revisão do Apolo (18/08/2026): apagar a célula Data de um
  // item importado de PDF mandava `data_manual: null` direto pro UPDATE, que
  // batia na constraint `item_de_documento_completo` (migration 017) e virava
  // 500 cru. A checagem tem que acontecer ANTES do UPDATE, usando o
  // `documento_controle_id` já lido na busca.
  it('item de PDF (documento_controle_id preenchido) com data_manual: null: status data_obrigatoria, NÃO tenta UPDATE', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: 'doc-1' }, error: null }

    const r = await editarItemControle('item-1', FAZENDA_A, { data_manual: null })

    expect(r).toEqual({ status: 'data_obrigatoria' })
    expect(chamadasUpdate).toHaveLength(0)
  })

  it('item AVULSO (documento_controle_id null) com data_manual: null: segue normalmente pro UPDATE', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: null }, error: null }
    estadoBanco.itemUpdate = { data: { id: 'item-1', data_manual: null }, error: null }

    const r = await editarItemControle('item-1', FAZENDA_A, { data_manual: null })

    expect(r).toEqual({ status: 'editado', item: { id: 'item-1', data_manual: null } })
    expect(chamadasUpdate).toHaveLength(1)
  })

  it('patch SEM o campo data_manual (não mexe na data): não dispara a checagem, mesmo em item de PDF', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: 'doc-1' }, error: null }
    estadoBanco.itemUpdate = { data: { id: 'item-1', descricao: 'x' }, error: null }

    const r = await editarItemControle('item-1', FAZENDA_A, { descricao: 'x' })

    expect(r.status).toBe('editado')
    expect(chamadasUpdate).toHaveLength(1)
  })

  // Bug relatado pelo Matheus, 18/08/2026: apertar Delete numa célula de
  // Produto (descrição) fazia "a página recarregar e o produto voltar".
  // Decisão dele, confirmada explicitamente com o risco na mão: SIM, pode
  // ficar vazio ("máxima liberdade, igual Excel"). `descricao text not
  // null` no banco (schema.sql:100, migration 017 nunca mexe nisso) —
  // string vazia satisfaz, `null` não satisfaria (por isso o service segue
  // exigindo a CHAVE presente e do tipo string, só não mais `.min(1)` — ver
  // controleItens.ts, `camposItemEditavel`).
  it('descricao vazia ("") é aceita e persistida — pedido explícito do Matheus, "máxima liberdade"', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: 'doc-1' }, error: null }
    const itemAtualizado = { id: 'item-1', descricao: '', conta_como_compra: false }
    estadoBanco.itemUpdate = { data: itemAtualizado, error: null }

    const r = await editarItemControle('item-1', FAZENDA_A, { descricao: '' })

    expect(r).toEqual({ status: 'editado', item: itemAtualizado })
    expect(chamadasUpdate).toHaveLength(1)
    expect(chamadasUpdate[0].payload.descricao).toBe('')
  })

  it('unidade vazia ("") também é aceita e persistida — mesmo tratamento de descricao', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-1', documento_controle_id: 'doc-1' }, error: null }
    estadoBanco.itemUpdate = { data: { id: 'item-1', unidade: '' }, error: null }

    const r = await editarItemControle('item-1', FAZENDA_A, { unidade: '' })

    expect(r.status).toBe('editado')
    expect(chamadasUpdate[0].payload.unidade).toBe('')
  })

  // Risco explícito que o Apolo pediu pra "verificar de verdade" (não só
  // assumir): a chave do índice de dedupe (idx_itens_nfe_dedupe_item,
  // migration 018) inclui `descricao`. Esvaziar a descrição de DUAS linhas
  // do MESMO documento que já compartilhem fornecedor+número+valor+
  // ocorrência faz as duas colidirem entre si (as duas ficam com a MESMA
  // chave: descricao=''). Confirma que esse 23505 específico — nascido de
  // uma EDIÇÃO que esvaziou o campo, não de uma reimportação — cai no MESMO
  // caminho 'conflito' já provado acima, não em 'erro' (500 cru). O
  // mecanismo é genérico (qualquer 23505 vira 'conflito'), mas este teste
  // documenta e prova ESTE gatilho específico, que é novo por causa da
  // decisão de aceitar campo vazio.
  it('esvaziar a descrição colide com outra linha do MESMO documento (mesma chave de dedupe): conflito, não 500 cru', async () => {
    estadoBanco.itemSelect = { data: { id: 'item-2', documento_controle_id: 'doc-1' }, error: null }
    estadoBanco.itemUpdate = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"' },
    }

    // item-2 e item-1 (já existente) têm mesmo fornecedor/numero_documento/
    // valor_total/ocorrencia — só a descrição os distinguia antes de os dois
    // ficarem vazios.
    const r = await editarItemControle('item-2', FAZENDA_A, { descricao: '' })

    expect(r).toEqual({ status: 'conflito' })
  })
})
