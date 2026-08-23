import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DocumentoLido, ItemDocumentoLido, ResultadoLeituraDocumento } from './documentoPdf'

// ─── Simulação mínima do que gravarDocumentoPdf.ts toca ─────────────────────
// Duas dependências externas: `lerDocumentoPdf` (a leitura por IA — nunca
// chamada de verdade aqui) e `supabase` (Storage + duas tabelas). `estado`
// controla o que cada uma devolve; os testes leem `estado.*Inserido(s)`,
// `estado.documentosDeletados` e `estado.documentosMarcadosErro` para
// conferir o que foi gravado/desfeito/marcado.
const { estado, uploadMock, removeMock, gravarContasMock } = vi.hoisted(() => {
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
    // Migration 019 — o que `marcarDuplicataConfirmada` (gravarDocumentoPdf.ts)
    // acha ao buscar a linha EXISTENTE que absorveu a duplicata. `null`
    // (padrão) simula o caso defensivo "23505 confirmado pelo banco, mas a
    // busca em código não achou" — a maioria dos testes deste arquivo não se
    // importa com o sinal, só com o comportamento de gravarDocumentoDoPdf em
    // si, então o padrão precisa ser "não quebra nada".
    itemDuplicadoExistente: null as null | { id: string; duplicata_confirmada_vezes: number },
    // Cada UPDATE feito em itens_nfe (fora do INSERT) — usado só pelo teste
    // dedicado da migration 019, abaixo.
    itensAtualizados: [] as { id: string; payload: any }[],
    // Cada UPDATE de status='erro' feito em documentos_controle (Achado A —
    // caminho "pelo menos 1 item já gravado", onde a FK RESTRICT impede o
    // DELETE e o service marca erro em vez de apagar).
    documentosMarcadosErro: [] as { id: string; status: string; erro_mensagem: string }[],
    // Cada INSERT em `alertas` (Important 4 — classificar como 'contrato'
    // liga dinheiro e não pode acontecer calado). `erroInsertAlerta` prova
    // que falhar aqui não derruba a importação.
    alertasInseridos: [] as any[],
    erroInsertAlerta: null as null | { message: string },
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
  // Mock de `gravarContasDoContrato` (Task 5) — padrão "sem conta criada, sem
  // erro" (a maioria dos testes deste arquivo é extrato e nem chama isto).
  const gravarContasMock = vi.fn().mockResolvedValue({ criadas: 0, duplicadas: 0, erro: null })
  return { estado, uploadMock, removeMock, gravarContasMock }
})

vi.mock('./documentoPdf', () => ({
  lerDocumentoPdf: vi.fn(() => Promise.resolve(estado.lido)),
}))

vi.mock('../contas/gravarContasDoContrato', () => ({
  gravarContasDoContrato: (...args: unknown[]) => gravarContasMock(...args),
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
          // Migration 019 — `marcarDuplicataConfirmada` busca a linha
          // existente (.select().eq()...maybeSingle()) e depois grava nela
          // (.update().eq()). Encadeamento simplificado: qualquer sequência
          // de `.eq()` devolve o mesmo objeto, só `maybeSingle()` resolve.
          select: vi.fn(() => {
            const chain: any = {
              eq: vi.fn(() => chain),
              maybeSingle: vi.fn(() => Promise.resolve(
                estado.itemDuplicadoExistente
                  ? { data: estado.itemDuplicadoExistente, error: null }
                  : { data: null, error: null },
              )),
            }
            return chain
          }),
          update: vi.fn((payload: any) => {
            const chain: any = {
              eq: vi.fn((_col: string, val: string) => {
                estado.itensAtualizados.push({ id: val, payload })
                return Promise.resolve({ data: null, error: null })
              }),
            }
            return chain
          }),
        }
      }
      if (table === 'alertas') {
        return {
          insert: vi.fn((payload: any) => {
            estado.alertasInseridos.push(payload)
            return Promise.resolve({ data: null, error: estado.erroInsertAlerta })
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

// Mensagem fixa devolvida em `avisoContas` para todo documento 'extrato' —
// espelha o texto de gravarDocumentoPdf.ts (Step 5b). Todo teste desta
// suíte que grava com sucesso usa `documento()` (padrão 'extrato'), então
// este aviso aparece em praticamente todo `toEqual` de status 'gravado'.
const AVISO_EXTRATO =
  'Isto é um extrato de revenda, não um contrato — os itens entraram na aba Controle e nenhuma conta a pagar foi criada (o boleto do extrato chega por e-mail).'

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
    // Padrão 'extrato': a maioria dos testes deste arquivo foi escrita para
    // o extrato da Solos — mudar o padrão para 'contrato' faria vários deles
    // passarem a testar outra coisa em silêncio (Task 2/3 tornaram os dois
    // campos abaixo obrigatórios em DocumentoLido).
    tipoDocumento: 'extrato',
    valorTotalDocumento: 1505,
    divergenciaTotal: 0,
    itens: [item()],
    itensDescartados: 0,
    pagamentos: [],
    pagamentosDescartados: 0,
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
  estado.itemDuplicadoExistente = null
  estado.itensAtualizados = []
  estado.alertasInseridos = []
  estado.erroInsertAlerta = null
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
      contasCriadas: 0,
      avisoContas: AVISO_EXTRATO,
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
      contasCriadas: 0,
      avisoContas: AVISO_EXTRATO,
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
      contasCriadas: 0,
      avisoContas: AVISO_EXTRATO,
    })
    expect(estado.documentosDeletados).toEqual([])
    expect(estado.documentosMarcadosErro).toEqual([])
  })
})

// Migration 019 + Tarefa 2 do plano de 2026-08-18 (tabela editável estilo
// Excel): a trava de dedupe (migration 018) já bloqueava a reimportação —
// mas nunca deixava rastro na linha EXISTENTE. Estes testes provam que o
// rastro (duplicata_confirmada_em/vezes) é gravado nela, para a tela pintar.
describe('gravarDocumentoDoPdf — persiste sinal de duplicata confirmada na linha existente (migration 019)', () => {
  it('reimportação pega a trava: a linha EXISTENTE ganha duplicata_confirmada_em/vezes atualizados', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        itens: [item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 })],
      }),
    }
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }
    estado.chavesDuplicadas = new Set([`${FORNECEDOR}|57106|ADUBO NPK 04-14-08|1505|0`])
    // A linha existente já tinha sido "reencontrada" 2 vezes antes — esta
    // reimportação precisa levar para 3, não simplesmente gravar 1.
    estado.itemDuplicadoExistente = { id: 'item-existente-1', duplicata_confirmada_vezes: 2 }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({
      status: 'gravado', documentoId: 'doc-1', itensGravados: 0, itensDescartados: 0, itensDuplicados: 1,
      contasCriadas: 0, avisoContas: AVISO_EXTRATO,
    })

    expect(estado.itensAtualizados).toHaveLength(1)
    expect(estado.itensAtualizados[0].id).toBe('item-existente-1')
    expect(estado.itensAtualizados[0].payload.duplicata_confirmada_vezes).toBe(3)
    expect(typeof estado.itensAtualizados[0].payload.duplicata_confirmada_em).toBe('string')
    // Timestamp de verdade, não um valor fixo/placeholder — confirma que o
    // service calcula `now()` em vez de gravar algo estático.
    expect(Number.isNaN(Date.parse(estado.itensAtualizados[0].payload.duplicata_confirmada_em))).toBe(false)
  })

  it('busca da linha existente falha (banco): não derruba a importação, só não marca o sinal', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        itens: [item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 })],
      }),
    }
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }
    estado.chavesDuplicadas = new Set([`${FORNECEDOR}|57106|ADUBO NPK 04-14-08|1505|0`])
    // Sem `itemDuplicadoExistente` configurado (fica null) — simula a busca
    // não achando nada (defensivo). A importação continua "gravado" mesmo
    // assim: o sinal extra nunca pode ser motivo de falha da importação.
    estado.itemDuplicadoExistente = null

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r).toEqual({
      status: 'gravado', documentoId: 'doc-1', itensGravados: 0, itensDescartados: 0, itensDuplicados: 1,
      contasCriadas: 0, avisoContas: AVISO_EXTRATO,
    })
    expect(estado.itensAtualizados).toEqual([])
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
      contasCriadas: 0,
      avisoContas: AVISO_EXTRATO,
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
      contasCriadas: 0,
      avisoContas: AVISO_EXTRATO,
    })
  })
})

// Task 6 do plano `docs/superpowers/sdd/2026-08-23-contrato-adubo-contas-a-
// pagar`: a gravação passa a ramificar por `tipoDocumento`. Extrato precisa
// continuar exatamente como sempre foi (trava dos R$ 2,77 milhões já
// importados em produção — Syagri, Solos, Protec); contrato passa a contar
// como gasto e a gerar conta a pagar via `gravarContasDoContrato` (Task 5).
describe('gravarDocumentoDoPdf — contrato x extrato', () => {
  // A TRAVA DOS R$ 2,77 MILHÕES. Syagri, Solos e Protec já estão no banco
  // como extrato. Se um dia esta asserção virar `true`, o Financeiro passa a
  // somar essas compras de novo quando as NF-e delas chegarem pelo Make.
  it('extrato grava conta_como_compra: false', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'extrato' }) }
    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    expect(estado.itensInseridos[0].conta_como_compra).toBe(false)
  })

  it('contrato grava conta_como_compra: true', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }
    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    expect(estado.itensInseridos[0].conta_como_compra).toBe(true)
  })

  it('grava o tipo em documentos_controle', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }
    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    expect(estado.documentoInserido.tipo).toBe('contrato')
  })

  it('contrato devolve quantas contas foram criadas', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 1, duplicadas: 0, erro: null })
    estado.lido = {
      status: 'documento',
      documento: documento({ tipoDocumento: 'contrato', pagamentos: [{ data: '2026-08-28', valor: 1505 }] }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.contasCriadas).toBe(1)
    expect(r.avisoContas).toBeNull()
  })

  // Important 4 da revisão final (23/08/2026): classificar um documento como
  // 'contrato' é a decisão que LIGA dinheiro (conta_como_compra: true) e é
  // tomada por uma IA. Decisão de dinheiro tomada por IA não pode acontecer
  // em silêncio — vira registro na central de alertas, onde o dono vê.
  it('contrato grava um alerta na central — classificação que liga dinheiro não é silenciosa', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }

    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(estado.alertasInseridos).toHaveLength(1)
    expect(estado.alertasInseridos[0]).toMatchObject({
      tipo: 'documento_classificado_contrato',
      nivel: 'aviso',
      lido: false,
      fazenda_id: FAZENDA,
    })
    expect(estado.alertasInseridos[0].mensagem).toContain(FORNECEDOR)
  })

  it('extrato NÃO gera alerta — é o caminho normal, alertar treinaria a ignorar', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'extrato' }) }

    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(estado.alertasInseridos).toHaveLength(0)
  })

  // O alerta é aviso, não pré-requisito: falhar nele não pode derrubar uma
  // importação já persistida.
  it('falha ao gravar o alerta não derruba a importação', async () => {
    estado.erroInsertAlerta = { message: 'RLS negou' }
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('gravado')
  })

  it('extrato não chama a criação de contas', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'extrato' }) }
    await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)
    expect(gravarContasMock).not.toHaveBeenCalled()
  })

  // Falhar a conta NÃO pode derrubar um documento já gravado com itens: o
  // dono perderia o gasto inteiro por causa de um vencimento.
  it('erro ao criar conta não derruba o documento — vira aviso', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 0, duplicadas: 0, erro: 'RLS negou' })
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('gravado')
    if (r.status !== 'gravado') return
    expect(r.avisoContas).toContain('RLS negou')
    // Critical 2: o aviso NUNCA pode mandar cadastrar a conta à mão — conta
    // avulsa nasce sem `documento_controle_id` e pagá-la lançaria de novo um
    // gasto que já está em itens_nfe.
    expect(r.avisoContas).not.toMatch(/cadastre .*à mão/i)
  })

  // Minor da revisão final: o texto dizia "a conta a pagar não pôde ser
  // criada" mesmo quando algumas parcelas TINHAM sido criadas — o dono lia
  // "nenhuma conta existe" e ia cadastrar à mão, dobrando o dinheiro.
  it('erro DEPOIS de algumas parcelas criadas: o aviso diz que foi parcial', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 2, duplicadas: 0, erro: 'connection reset' })
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toContain('2 conta')
    expect(r.avisoContas).toContain('connection reset')
    expect(r.avisoContas).not.toMatch(/cadastre .*à mão/i)
  })

  // Critical 2: contrato sem data legível AGORA cria a conta sem vencimento
  // (contasDoContrato), e o aviso pede a data em vez de mandar cadastrar
  // uma conta paralela.
  it('contrato sem pagamento avisa que a conta nasceu SEM vencimento', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 1, duplicadas: 0, erro: null })
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato', pagamentos: [] }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toContain('data de pagamento')
    expect(r.avisoContas).toContain('sem vencimento')
    expect(r.avisoContas).not.toMatch(/cadastre .*à mão/i)
  })

  // Important 1: a perda de uma parcela precisa CHEGAR ao dono. O valor da
  // conta sobrevivente fica em aberto por causa disso — sem o aviso, ele vê
  // uma conta sem valor e não sabe por quê.
  it('parcela descartada na leitura vira aviso na tela', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 1, duplicadas: 0, erro: null })
    estado.lido = {
      status: 'documento',
      documento: documento({
        tipoDocumento: 'contrato',
        pagamentos: [{ data: '2026-08-28', valor: null }],
        pagamentosDescartados: 1,
      }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toContain('1 data de pagamento')
  })

  // Important 2: o documento é sempre NOVO quando se chega aqui (reimportação
  // volta antes, como duplicada-hash/duplicada-conteudo). Logo, "duplicada"
  // nesta altura só pode ser duas parcelas colidindo ENTRE SI no mesmo
  // vencimento — e o dono via "1 conta criada" com metade da dívida, calado.
  it('parcela recusada por vencimento repetido vira aviso', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 1, duplicadas: 1, erro: null })
    estado.lido = {
      status: 'documento',
      documento: documento({
        tipoDocumento: 'contrato',
        pagamentos: [{ data: '2026-08-28', valor: 100 }],
      }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toContain('mesma data')
  })

  it('contrato normal, tudo certo: nenhum aviso', async () => {
    gravarContasMock.mockResolvedValue({ criadas: 1, duplicadas: 0, erro: null })
    estado.lido = {
      status: 'documento',
      documento: documento({
        tipoDocumento: 'contrato',
        pagamentos: [{ data: '2026-08-28', valor: 1505 }],
      }),
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toBeNull()
  })

  it('extrato avisa que não gerou conta a pagar', async () => {
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'extrato' }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    if (r.status !== 'gravado') throw new Error('esperava gravado')
    expect(r.avisoContas).toContain('extrato de revenda')
    expect(r.contasCriadas).toBe(0)
  })

  // Achado Important da revisão, round 1: `itensParaGravar` já carrega
  // `conta_como_compra` calculado ANTES de entrar no fallback item-a-item
  // (`inserirItensUmAUm`) — o fallback só repassa o payload pronto, não
  // reconstrói nada. Sem este teste, uma refatoração futura que montasse o
  // payload DENTRO do fallback poderia esquecer o campo sem que nada
  // acusasse — trava contra essa porta lateral, para contrato E extrato.
  it('fallback item-a-item (23505 no lote) também grava conta_como_compra: true para contrato', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        tipoDocumento: 'contrato',
        itens: [
          item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 }),
          item({ numeroDocumento: '57107', descricao: 'CLORETO DE POTASSIO', valorTotal: 900 }),
        ],
      }),
    }
    // Lote inteiro falha (mesmo padrão dos testes do Achado 1, acima) —
    // dispara o fallback. Nenhuma chave marcada como duplicada: os dois
    // itens são gravados individualmente, e é o payload de CADA UM que
    // queremos inspecionar.
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('gravado')
    expect(estado.itensInseridosIndividualmente).toHaveLength(2)
    for (const inserido of estado.itensInseridosIndividualmente) {
      expect(inserido.conta_como_compra).toBe(true)
    }
  })

  // Mesma trava, lado extrato — a restrição dos R$ 2,77 milhões vale em
  // TODO caminho de gravação, inclusive o fallback item-a-item.
  it('fallback item-a-item (23505 no lote) mantém conta_como_compra: false para extrato', async () => {
    estado.lido = {
      status: 'documento',
      documento: documento({
        tipoDocumento: 'extrato',
        itens: [
          item({ numeroDocumento: '57106', descricao: 'ADUBO NPK 04-14-08', valorTotal: 1505 }),
          item({ numeroDocumento: '57107', descricao: 'CLORETO DE POTASSIO', valorTotal: 900 }),
        ],
      }),
    }
    estado.erroInsertItens = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_itens_nfe_dedupe_item"',
    }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('gravado')
    expect(estado.itensInseridosIndividualmente).toHaveLength(2)
    for (const inserido of estado.itensInseridosIndividualmente) {
      expect(inserido.conta_como_compra).toBe(false)
    }
  })

  // Achado Important da revisão, round 1: `gravarContasDoContrato` promete
  // "nunca estoura", mas esse contrato não tinha reforço nenhum aqui — uma
  // exceção real caía no `catch` externo (o mesmo que desfaz documento sem
  // itens), derrubando um documento que JÁ tinha itens gravados. A chamada
  // ganhou seu próprio try/catch (ver gravarDocumentoPdf.ts) exatamente para
  // isto não acontecer — este teste prova o comportamento correto.
  it('gravarContasDoContrato lança exceção: documento continua gravado, vira aviso', async () => {
    gravarContasMock.mockRejectedValue(new Error('timeout de rede'))
    estado.lido = { status: 'documento', documento: documento({ tipoDocumento: 'contrato' }) }

    const r = await gravarDocumentoDoPdf(PDF, ARQUIVO, HOJE, FAZENDA, anthropic)

    expect(r.status).toBe('gravado')
    if (r.status !== 'gravado') return
    expect(r.avisoContas).toContain('timeout de rede')
    // A garantia mais enfatizada pelo brief da Task 6: falha na conta não
    // pode derrubar (nem marcar erro em) um documento já gravado com itens.
    expect(estado.documentosDeletados).toEqual([])
    expect(estado.documentosMarcadosErro).toEqual([])
  })
})
