import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DocumentoLido, ItemDocumentoLido, ResultadoLeituraDocumento } from './documentoPdf'

// ─── Simulação mínima do que gravarDocumentoPdf.ts toca ─────────────────────
// Duas dependências externas: `lerDocumentoPdf` (a leitura por IA — nunca
// chamada de verdade aqui) e `supabase` (Storage + duas tabelas). `estado`
// controla o que cada uma devolve; os testes leem `estado.*Inserido(s)`,
// `estado.documentosDeletados` e `estado.documentosMarcadosErro` para
// conferir o que foi gravado/desfeito/marcado.
const { estado, uploadMock, removeMock } = vi.hoisted(() => {
  const estado = {
    lido: null as ResultadoLeituraDocumento | null,
    erroUpload: null as null | { message: string },
    erroInsertDocumento: null as null | { message: string; code?: string },
    // Erro no INSERT EM LOTE de itens_nfe. Sem `code` (ou code !== '23505')
    // é tratado como fatal (ex.: "connection reset"). code === '23505'
    // dispara o fallback item-a-item — nesse caso `chavesDuplicadas` decide
    // qual item individual é recusado durante o fallback.
    erroInsertItens: null as null | { message: string; code?: string },
    // Chave COMPOSTA (fornecedor|numero_documento|descricao|valor_total|
    // ocorrencia_no_documento) — espelha as 5 colunas não-fazenda de
    // idx_itens_nfe_dedupe_item (migration 018, já com a coluna
    // ocorrencia_no_documento do Achado B). Simula "esta linha exata já foi
    // importada antes" quando o fallback item-a-item tentar gravar um
    // payload com esta chave.
    chavesDuplicadas: new Set<string>(),
    // Número de duplicata (numero_documento DO ITEM já resolvido) que deve
    // falhar com um erro GENÉRICO (não-23505) durante o fallback item-a-item
    // — simula uma queda de conexão no meio do processo, para provar que o
    // fallback não engole silenciosamente um erro que não é duplicidade.
    numeroComErroGenerico: null as string | null,
    // Simula o DELETE de documentos_controle falhando por outro motivo que
    // não a FK RESTRICT (ex.: RLS) — usado no caminho "sem itens gravados".
    erroDeleteDocumento: null as null | { message: string },
    documentoInserido: null as any,
    itensInseridos: null as any,
    // Cada item que passou pelo INSERT individual (fallback item-a-item),
    // na ordem em que foi tentado — só populado quando o lote falha com
    // 23505 e o service refaz um a um.
    itensInseridosIndividualmente: [] as any[],
    documentosDeletados: [] as string[],
    // Cada UPDATE de status='erro' feito em documentos_controle (Achado A —
    // caminho "pelo menos 1 item já gravado", onde a FK RESTRICT impede o
    // DELETE e o service marca erro em vez de apagar).
    documentosMarcadosErro: [] as { id: string; status: string; erro_mensagem: string }[],
    // Controla o roteamento de `.eq()` no mock de documentos_controle: a
    // mesma chamada encadeada serve tanto `.delete().eq(...)` quanto
    // `.update(payload).eq(...)` — precisa saber qual das duas está em curso.
    ultimaOperacaoDocumento: null as 'delete' | 'update' | null,
    payloadUpdatePendente: null as any,
  }
  const uploadMock = vi.fn(() => Promise.resolve(
    estado.erroUpload ? { data: null, error: estado.erroUpload } : { data: { path: 'ok' }, error: null },
  ))
  const removeMock = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return { estado, uploadMock, removeMock }
})

vi.mock('./documentoPdf', () => ({
  lerDocumentoPdf: vi.fn(() => Promise.resolve(estado.lido)),
}))

vi.mock('../supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({ upload: uploadMock, remove: removeMock })),
    },
    from: vi.fn((table: string) => {
      if (table === 'documentos_controle') {
        const obj: any = {
          insert: vi.fn((payload: any) => { estado.documentoInserido = payload; return obj }),
          select: vi.fn(() => obj),
          single: vi.fn(() => Promise.resolve(
            estado.erroInsertDocumento
              ? { data: null, error: estado.erroInsertDocumento }
              : { data: { id: 'doc-1' }, error: null },
          )),
          delete: vi.fn(() => { estado.ultimaOperacaoDocumento = 'delete'; return obj }),
          update: vi.fn((payload: any) => {
            estado.ultimaOperacaoDocumento = 'update'
            estado.payloadUpdatePendente = payload
            return obj
          }),
          eq: vi.fn((_col: string, val: string) => {
            if (estado.ultimaOperacaoDocumento === 'update') {
              estado.documentosMarcadosErro.push({ id: val, ...estado.payloadUpdatePendente })
              return Promise.resolve({ data: null, error: null })
            }
            // 'delete' (ou nunca setado — não deveria acontecer, mas cai no
            // mesmo default de sempre ter sido um delete).
            estado.documentosDeletados.push(val)
            return Promise.resolve(
              estado.erroDeleteDocumento ? { data: null, error: estado.erroDeleteDocumento } : { data: null, error: null },
            )
          }),
        }
        return obj
      }
      if (table === 'itens_nfe') {
        return {
          insert: vi.fn((payload: any) => {
            // INSERT EM LOTE (array) — o caminho normal, exercitado por
            // quase todo teste. Cada chamada sobrescreve `itensInseridos`
            // (usado pelos testes de sucesso "simples", que nunca disparam
            // o fallback).
            if (Array.isArray(payload)) {
              estado.itensInseridos = payload
              return Promise.resolve(
                estado.erroInsertItens ? { data: null, error: estado.erroInsertItens } : { data: payload, error: null },
              )
            }
            // INSERT INDIVIDUAL (fallback item-a-item, disparado só quando o
            // lote acima devolve 23505). `chavesDuplicadas` decide, pela
            // chave composta, qual chamada individual é recusada.
            estado.itensInseridosIndividualmente.push(payload)
            if (estado.chavesDuplicadas.has(chaveItem(payload))) {
              return Promise.resolve({
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
                },
              })
            }
            if (payload.numero_documento === estado.numeroComErroGenerico) {
              return Promise.resolve({ data: null, error: { message: 'connection reset' } })
            }
            return Promise.resolve({ data: payload, error: null })
          }),
        }
      }
      throw new Error(`tabela não mockada neste teste: ${table}`)
    }),
  },
}))

import { gravarDocumentoDoPdf } from './gravarDocumentoPdf'

// ─── Fixtures ─────────────────────────────────────────────────────────────

const FORNECEDOR = 'SOLOS SOLUCOES AGRICOLAS'

// Espelha as 5 colunas (menos fazenda_id) de idx_itens_nfe_dedupe_item —
// migration 018, já com ocorrencia_no_documento (Achado B). Usada tanto para
// montar `estado.chavesDuplicadas` quanto, implicitamente, para entender o
// que o mock de INSERT individual está comparando.
function chaveItem(payload: any): string {
  return `${payload.fornecedor}|${payload.numero_documento}|${payload.descricao}|${payload.valor_total}|${payload.ocorrencia_no_documento}`
}

function item(over: Partial<ItemDocumentoLido> = {}): ItemDocumentoLido {
  return {
    descricao: 'ADUBO NPK 04-14-08',
    quantidade: 10,
    unidade: 'SC',
    valorUnitario: 150.5,
    valorTotal: 1505,
    numeroDocumento: '57106',
    data: '2026-07-10',
    ...over,
  }
}

function documento(over: Partial<DocumentoLido> = {}): DocumentoLido {
  return {
    fornecedor: FORNECEDOR,
    dataDocumento: '2026-07-01',
    numeroDocumento: '000786-2026-07-01',
    codigoCliente: '000786',
    valorTotalDocumento: 1505,
    divergenciaTotal: 0,
    itens: [item()],
    itensDescartados: 0,
    ...over,
  }
}

const PDF = Buffer.from('%PDF-1.4 conteudo de teste')
const ARQUIVO = 'extrato-solos.pdf'
const HOJE = '2026-08-17'
const FAZENDA = 'fazenda-1'
const anthropic = {} as any // nunca chamado de verdade — lerDocumentoPdf está mockado

beforeEach(() => {
  estado.lido = null
  estado.erroUpload = null
  estado.erroInsertDocumento = null
  estado.erroInsertItens = null
  estado.chavesDuplicadas = new Set()
  estado.numeroComErroGenerico = null
  estado.erroDeleteDocumento = null
  estado.documentoInserido = null
  estado.itensInseridos = null
  estado.itensInseridosIndividualmente = []
  estado.documentosDeletados = []
  estado.documentosMarcadosErro = []
  estado.ultimaOperacaoDocumento = null
  estado.payloadUpdatePendente = null
  vi.clearAllMocks()
})

describe('gravarDocumentoDoPdf — sucesso completo', () => {
  it('grava o documento e os itens, devolve contagens', async () => {
    estado.lido = { status: 'documento', documento: documento({ itensDescartados: 1 }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({
      status: 'gravado',
      documentoId: 'doc-1',
      itensGravados: 1,
      itensDescartados: 1,
      itensDuplicados: 0,
    })

    // Documento: fornecedor, número, hash e path do Storage foram gravados.
    expect(estado.documentoInserido).toMatchObject({
      fornecedor: 'SOLOS SOLUCOES AGRICOLAS',
      numero_documento: '000786-2026-07-01',
      data_documento: '2026-07-01',
      valor_total: 1505,
      status: 'processado',
      nome_arquivo: ARQUIVO,
      fazenda_id: FAZENDA,
    })
    expect(estado.documentoInserido.arquivo_path).toMatch(new RegExp(`^${FAZENDA}/.+\\.pdf$`))
    expect(typeof estado.documentoInserido.arquivo_hash).toBe('string')
    expect(estado.documentoInserido.arquivo_hash).toHaveLength(64) // sha256 hex

    // Item: amarrado ao documento, conta_como_compra SEMPRE false (Achado 2
    // da revisão do Apolo — evita duplicar o gasto que já veio pela NF-e),
    // sem nota_fiscal_id, primeira ocorrência (0) da sua combinação.
    expect(estado.itensInseridos).toHaveLength(1)
    expect(estado.itensInseridos[0]).toMatchObject({
      nota_fiscal_id: null,
      descricao: 'ADUBO NPK 04-14-08',
      quantidade: 10,
      unidade: 'SC',
      valor_unitario: 150.5,
      valor_total: 1505,
      insumo_id: null,
      fornecedor: 'SOLOS SOLUCOES AGRICOLAS',
      numero_documento: '57106',
      ocorrencia_no_documento: 0,
      documento_controle_id: 'doc-1',
      conta_como_compra: false,
      data_manual: '2026-07-10',
      fazenda_id: FAZENDA,
    })

    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(removeMock).not.toHaveBeenCalled()
  })
})

describe('gravarDocumentoDoPdf — recusa da leitura, nada é gravado', () => {
  it('falha na leitura: repassa o motivo, não toca banco nem Storage', async () => {
    estado.lido = { status: 'falha', motivo: 'resposta truncada (max_tokens)' }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'falha', motivo: 'resposta truncada (max_tokens)' })
    expect(estado.documentoInserido).toBeNull()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('não é documento: repassa o status, não toca banco nem Storage', async () => {
    estado.lido = { status: 'nao-documento' }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'nao-documento' })
    expect(estado.documentoInserido).toBeNull()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('sem itens aproveitáveis: repassa a contagem descartada, não toca banco nem Storage', async () => {
    estado.lido = { status: 'sem-itens-aproveitaveis', itensDescartados: 4 }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'sem-itens-aproveitaveis', itensDescartados: 4 })
    expect(estado.documentoInserido).toBeNull()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('documento reconhecido mas sem fornecedor: sem-identidade, não toca banco nem Storage', async () => {
    estado.lido = { status: 'documento', documento: documento({ fornecedor: null }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'sem-identidade' })
    expect(estado.documentoInserido).toBeNull()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('documento reconhecido mas sem número: sem-identidade, não toca banco nem Storage', async () => {
    estado.lido = { status: 'documento', documento: documento({ numeroDocumento: null }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'sem-identidade' })
    expect(estado.documentoInserido).toBeNull()
    expect(uploadMock).not.toHaveBeenCalled()
  })
})

describe('gravarDocumentoDoPdf — duplicidade (23505), limpa o Storage', () => {
  it('mesmo arquivo (hash) já importado: duplicada-hash, remove o upload', async () => {
    estado.lido = { status: 'documento', documento: documento() }
    estado.erroInsertDocumento = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_doc_controle_hash"',
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'duplicada-hash' })
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledTimes(1)
    // itens nunca são tentados quando o documento não gravou.
    expect(estado.itensInseridos).toBeNull()
  })

  it('mesmo fornecedor+número já existe: duplicada-conteudo, remove o upload', async () => {
    estado.lido = { status: 'documento', documento: documento() }
    estado.erroInsertDocumento = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_doc_controle_dedupe"',
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'duplicada-conteudo' })
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(estado.itensInseridos).toBeNull()
  })
})

describe('gravarDocumentoDoPdf — falha "limpa" ao gravar itens desfaz o documento + Storage', () => {
  it('INSERT em lote falha (não-23505): apaga a linha de documentos_controle e o arquivo do Storage', async () => {
    estado.lido = { status: 'documento', documento: documento() }
    estado.erroInsertItens = { message: 'connection reset' }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'erro', mensagem: 'connection reset' })
    // INSERT em lote é atômico — zero itens deste documento existem em
    // itens_nfe, a FK RESTRICT não tem nada para reter, DELETE é seguro.
    expect(estado.documentosDeletados).toEqual(['doc-1'])
    expect(estado.documentosMarcadosErro).toEqual([])
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('item sem data resolvível (throw antes de qualquer INSERT): desfaz documento + Storage', async () => {
    // `dataManualDoItem` só devolve null se documentoPdf.ts parar de aplicar
    // o fallback pro documento — simulado aqui forçando os dois nulos.
    estado.lido = {
      status: 'documento',
      documento: documento({ dataDocumento: null, itens: [item({ data: null })] }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('erro')
    expect(estado.documentosDeletados).toEqual(['doc-1'])
    expect(estado.documentosMarcadosErro).toEqual([])
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('DELETE do documento falha por outro motivo (ex.: RLS): marca erro em vez de apagar o Storage', async () => {
    estado.lido = { status: 'documento', documento: documento() }
    estado.erroInsertItens = { message: 'connection reset' }
    estado.erroDeleteDocumento = { message: 'permission denied for table documentos_controle' }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'erro', mensagem: 'connection reset' })
    // Tentou o DELETE (documentosDeletados registra a TENTATIVA, que falhou)
    // e, por ter falhado, caiu no fallback de marcar erro — sem isso a linha
    // ficaria com status desatualizado e o PDF seria apagado do Storage
    // mesmo com a linha ainda existindo (mesmo problema estrutural do
    // Achado A, por outra porta).
    expect(estado.documentosDeletados).toEqual(['doc-1'])
    expect(estado.documentosMarcadosErro).toEqual([
      { id: 'doc-1', status: 'erro', erro_mensagem: 'permission denied for table documentos_controle' },
    ])
    expect(removeMock).not.toHaveBeenCalled()
  })
})

describe('gravarDocumentoDoPdf — fallback de numeroDocumento/data do item pro documento', () => {
  it('item sem número próprio herda codigoCliente do documento (Achado C — não o numeroDocumento inteiro)', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        numeroDocumento: '288658-2026-07-01',
        codigoCliente: '288658',
        dataDocumento: '2026-07-01',
        itens: [item({ numeroDocumento: null, data: null })],
      }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('gravado')
    expect(estado.itensInseridos[0]).toMatchObject({
      // codigoCliente, NÃO numeroDocumento inteiro (que embutiria a data de
      // geração do relatório/contrato, instável entre reimportações).
      numero_documento: '288658',
      data_manual: '2026-07-01',
    })
  })

  it('item COM número/data própria usa o seu, não o do documento', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        numeroDocumento: '000786-2026-07-01',
        dataDocumento: '2026-07-01',
        itens: [item({ numeroDocumento: '57107', data: '2026-07-15' })],
      }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('gravado')
    expect(estado.itensInseridos[0]).toMatchObject({
      numero_documento: '57107',
      data_manual: '2026-07-15',
    })
  })
})

// Achado C da revisão do Apolo, rodada 3: um item de CONTRATO (sem número de
// duplicata próprio, ex.: Mosaic) caía no fallback do número do DOCUMENTO
// inteiro — que muda a cada reimportação porque embute a data de GERAÇÃO do
// relatório/contrato relido. `codigoCliente` (metade estável) corrige isso.
describe('gravarDocumentoDoPdf — contrato reimportado com "data" diferente (Achado C)', () => {
  it('mesmo contrato (mesmo codigoCliente), numeroDocumento do documento diferente entre as duas leituras: numero_documento gravado do item é IGUAL nas duas', async () => {
    const itemDoContrato = item({
      numeroDocumento: null,
      descricao: 'KCL GRANULADO',
      valorTotal: 250000,
      data: null,
    })

    estado.lido = {
      status: 'documento',
      documento: documento({
        numeroDocumento: '288658-2026-07-01',
        codigoCliente: '288658',
        dataDocumento: '2026-07-01',
        itens: [itemDoContrato],
      }),
    }
    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    const primeiraLeitura = estado.itensInseridos[0].numero_documento

    // Segunda "leitura" do MESMO contrato, "gerado" (data de geração) num dia
    // diferente — numeroDocumento do documento muda, codigoCliente não.
    estado.lido = {
      status: 'documento',
      documento: documento({
        numeroDocumento: '288658-2026-08-01',
        codigoCliente: '288658',
        dataDocumento: '2026-08-01',
        itens: [itemDoContrato],
      }),
    }
    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    const segundaLeitura = estado.itensInseridos[0].numero_documento

    expect(primeiraLeitura).toBe('288658')
    expect(segundaLeitura).toBe('288658')
    expect(primeiraLeitura).toBe(segundaLeitura)
  })
})

// Achado 1 da revisão do Apolo: um extrato "Contas a Receber" é cumulativo
// por natureza — reimportar o mesmo extrato num mês seguinte, ainda listando
// duplicatas em aberto, é o fluxo NORMAL. O índice de documento (migration
// 017) não pega isso (a chave do DOCUMENTO muda a cada extrato, porque
// embute a data de geração do relatório) — só o índice por ITEM (migration
// 018, idx_itens_nfe_dedupe_item) pega. Estes testes simulam o INSERT em
// lote falhando com 23505 (pelo menos 1 item já existe) e conferem o
// fallback item-a-item do service.
describe('gravarDocumentoDoPdf — reimportação com item já gravado antes (Achado 1)', () => {
  it('1 item já existe (duplicado), o outro é novo: pula só o duplicado, grava o novo, conta os dois', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        itens: [
          item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 }),
          item({ numeroDocumento: '57107', descricao: 'CLORETO DE POTASSIO', valorTotal: 900 }),
        ],
      }),
    }
    // Lote inteiro falha (como acontece de verdade: um único conflito
    // derruba a instrução SQL inteira) — dispara o fallback item-a-item.
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }
    // Só a duplicata 57106 já existia; 57107 é novidade deste extrato.
    estado.chavesDuplicadas = new Set([`${FORNECEDOR}|57106|ADUBO NPK 04-14-08|1505|0`])

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({
      status: 'gravado',
      documentoId: 'doc-1',
      itensGravados: 1,
      itensDescartados: 0,
      itensDuplicados: 1,
    })

    // Fallback tentou os 2 itens, um a um, na ordem da leitura.
    expect(estado.itensInseridosIndividualmente).toHaveLength(2)
    expect(estado.itensInseridosIndividualmente[0]).toMatchObject({ numero_documento: '57106' })
    expect(estado.itensInseridosIndividualmente[1]).toMatchObject({ numero_documento: '57107', valor_total: 900 })

    // O documento (não os itens) segue existindo — não foi desfeito, porque
    // "item já importado" não é falha do documento.
    expect(estado.documentosDeletados).toEqual([])
    expect(estado.documentosMarcadosErro).toEqual([])
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('todos os itens do lote já existem: documento é gravado mesmo assim (conferência válida, zero itens novos)', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        itens: [item({ numeroDocumento: '57106', valorTotal: 1505 })],
      }),
    }
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }
    estado.chavesDuplicadas = new Set([`${FORNECEDOR}|57106|ADUBO NPK 04-14-08|1505|0`])

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({
      status: 'gravado',
      documentoId: 'doc-1',
      itensGravados: 0,
      itensDescartados: 0,
      itensDuplicados: 1,
    })
    expect(estado.documentosDeletados).toEqual([])
    expect(estado.documentosMarcadosErro).toEqual([])
  })
})

// Achado A da revisão do Apolo, rodada 3: `desfazerDocumento` tentava DELETE
// em documentos_controle mesmo depois de itens já terem sido gravados nele.
// `itens_nfe_doc_controle_fk` é `on delete restrict` (017_controle.sql) — o
// DELETE seria recusado (23503) e a linha sobreviveria, MAS o Storage era
// apagado incondicionalmente de qualquer forma, deixando um documento
// "processado" com arquivo_path apontando pra um PDF inexistente, travado
// pra sempre (reenviar bate no índice de hash e é recusado como duplicata,
// sem tela nenhuma pra apagar a linha ruim).
describe('gravarDocumentoDoPdf — erro no meio do fallback item-a-item, com item(ns) já gravado(s) antes (Achado A)', () => {
  it('cenário reproduzido: 3 itens, 1 duplicado (pulado), 1 novo gravado, o 2º novo falha por erro de conexão — marca erro, PRESERVA o Storage, não tenta DELETE', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        itens: [
          // Duplicado — já existia, é pulado.
          item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 }),
          // Novo — grava com sucesso.
          item({ numeroDocumento: '57107', descricao: 'CLORETO DE POTASSIO', valorTotal: 900 }),
          // Novo — mas a conexão cai bem no meio do fallback.
          item({ numeroDocumento: '57108', descricao: 'HERBICIDA X', valorTotal: 300 }),
        ],
      }),
    }
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }
    estado.chavesDuplicadas = new Set([`${FORNECEDOR}|57106|ADUBO NPK 04-14-08|1505|0`])
    estado.numeroComErroGenerico = '57108'

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'erro', mensagem: 'connection reset' })
    // O item 57107 JÁ tinha sido gravado com sucesso antes da queda — a FK
    // RESTRICT impediria o DELETE. O service não tenta: marca erro.
    expect(estado.documentosDeletados).toEqual([])
    expect(estado.documentosMarcadosErro).toEqual([
      { id: 'doc-1', status: 'erro', erro_mensagem: 'connection reset' },
    ])
    // PDF preservado — é a prova do que foi parcialmente importado.
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('erro real (não-23505) já no PRIMEIRO item do fallback (zero gravados): desfaz o documento + Storage normalmente', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        itens: [
          item({ numeroDocumento: '57106', valorTotal: 1505 }),
          item({ numeroDocumento: '57107', valorTotal: 900 }),
        ],
      }),
    }
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }
    // Nenhum duplicado desta vez — o PRIMEIRO item já cai direto no erro
    // genérico, então zero itens chegam a ser gravados antes da queda.
    estado.numeroComErroGenerico = '57106'

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({ status: 'erro', mensagem: 'connection reset' })
    // Zero itens gravados — a FK RESTRICT não tem nada para reter, o
    // caminho "limpo" (DELETE + apagar Storage) é seguro e esperado.
    expect(estado.documentosDeletados).toEqual(['doc-1'])
    expect(estado.documentosMarcadosErro).toEqual([])
    expect(removeMock).toHaveBeenCalledTimes(1)
  })
})

// Achado B da revisão do Apolo, rodada 3: duas linhas LEGÍTIMAS e DISTINTAS
// dentro do MESMO documento (mesmo produto, mesmo valor, mesma duplicata —
// ex.: a mesma duplicata cobrando a mesma quantidade em duas entregas/datas
// diferentes) colidiam ENTRE SI no índice original (sem ocorrencia_no_
// documento) — a segunda virava "já existe, pula" mesmo sendo uma compra
// real e distinta, perdendo o valor na conferência sem aviso nenhum de que
// não era reimportação.
describe('gravarDocumentoDoPdf — linhas repetidas DENTRO do mesmo documento não colidem entre si (Achado B)', () => {
  it('2 linhas idênticas (mesmo fornecedor+numero_documento+descricao+valor) no MESMO documento recebem ocorrencia_no_documento 0 e 1, as DUAS são gravadas', async () => {
    const linhaRepetida = item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 })
    estado.lido = {
      status: 'documento',
      documento: documento({ itens: [linhaRepetida, { ...linhaRepetida }] }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    // Nenhum 23505 disparado no mock (chavesDuplicadas vazio) — o INSERT em
    // lote é aceito direto, sem cair no fallback item-a-item, exatamente
    // porque as duas linhas NÃO colidem mais entre si.
    expect(r).toEqual({
      status: 'gravado',
      documentoId: 'doc-1',
      itensGravados: 2,
      itensDescartados: 0,
      itensDuplicados: 0,
    })
    expect(estado.itensInseridos).toHaveLength(2)
    expect(estado.itensInseridos[0]).toMatchObject({ numero_documento: '57106', valor_total: 1505, ocorrencia_no_documento: 0 })
    expect(estado.itensInseridos[1]).toMatchObject({ numero_documento: '57106', valor_total: 1505, ocorrencia_no_documento: 1 })
  })

  it('3 linhas: 2 idênticas + 1 diferente — a ocorrência conta só dentro do próprio grupo (0, 1, 0)', async () => {
    const linhaA = item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 })
    const linhaB = item({ numeroDocumento: '57107', descricao: 'CLORETO DE POTASSIO', valorTotal: 900 })
    estado.lido = {
      status: 'documento',
      documento: documento({ itens: [{ ...linhaA }, { ...linhaB }, { ...linhaA }] }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('gravado')
    expect(estado.itensInseridos.map((i: any) => i.ocorrencia_no_documento)).toEqual([0, 0, 1])
  })

  it('reimportar o MESMO documento com a MESMA repetição ainda é pego como duplicata de verdade (ocorrencia_no_documento fecha a chave)', async () => {
    const linhaRepetida = item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 })
    estado.lido = {
      status: 'documento',
      documento: documento({ itens: [{ ...linhaRepetida }, { ...linhaRepetida }] }),
    }
    // As DUAS ocorrências (0 e 1) já existem — extrato reimportado igual.
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }
    estado.chavesDuplicadas = new Set([
      `${FORNECEDOR}|57106|ADUBO NPK 04-14-08|1505|0`,
      `${FORNECEDOR}|57106|ADUBO NPK 04-14-08|1505|1`,
    ])

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({
      status: 'gravado',
      documentoId: 'doc-1',
      itensGravados: 0,
      itensDescartados: 0,
      itensDuplicados: 2,
    })
  })
})
