import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Isolamento por fazenda no canal WhatsApp ─────────────────────────────────
// O cliente supabase de services/supabase.ts autentica com SUPABASE_SERVICE_KEY,
// que bypassa RLS por completo (as policies *_tenant dependem de auth.uid(), que
// não existe no backend). O ÚNICO isolamento entre fazendas aqui é o filtro
// .eq('fazenda_id', ...) escrito à mão em cada query — por isso cada função abaixo
// é exportada e testada isoladamente, sem depender do fluxo completo (que exigiria
// mockar a API da Anthropic).
//
// Inclui também a trava de área arrendada (PR #66): buscarTalhao nunca devolve
// um talhão com status='arrendado', mesmo quando o nome bate melhor que os ativos.

const { seed, estadoBanco } = vi.hoisted(() => {
  const seed = {
    talhoes: [
      // Ordem de declaração DE PROPÓSITO não-alfabética (III, II, I): sem
      // .order('nome') no código de produção, o mock devolve os talhões nesta
      // mesma ordem "de banco" — o .limit(1) pegaria "Gogo III" para a busca
      // "Gogo I", que é exatamente o defeito medido em produção (Postgres sem
      // ORDER BY tem ordem indefinida; aqui fixamos numa ordem ERRADA de
      // propósito, em vez de embaralhar aleatoriamente, para o teste nunca
      // ser flaky — o objetivo é provar que o código pede a ordem certa, não
      // simular aleatoriedade de verdade).
      { id: 'talhao-gogo-3', nome: 'Gogo III', area_ha: 76.38, status: 'ativo', fazenda_id: 'fazenda-mg' },
      { id: 'talhao-gogo-2', nome: 'Gogo II', area_ha: 101.07, status: 'ativo', fazenda_id: 'fazenda-mg' },
      { id: 'talhao-gogo-1', nome: 'Gogo I', area_ha: 136.56, status: 'ativo', fazenda_id: 'fazenda-mg' },
      { id: 'talhao-gogo-usina', nome: 'Gogo Usina', area_ha: 80, status: 'arrendado', fazenda_id: 'fazenda-mg' },
      { id: 'talhao-mt-gogo-1', nome: 'Gogo I', area_ha: 30, status: 'ativo', fazenda_id: 'fazenda-mt' },
    ] as any[],
    insumos: [
      { id: 'insumo-glifosato-mg', nome: 'Glifosato', unidade: 'L', fazenda_id: 'fazenda-mg', estoque: [{ id: 'linha-estoque-mg' }] },
      { id: 'insumo-glifosato-mt', nome: 'Glifosato', unidade: 'L', fazenda_id: 'fazenda-mt', estoque: [{ id: 'linha-estoque-mt' }] },
      // Insumo da MG cuja LINHA DE ESTOQUE está rotulada com fazenda_id do MT
      // (ver seed de `estoque` abaixo). É o único dado do projeto capaz de
      // simular rótulo de fazenda corrompido, e é o que sustenta os dois testes
      // COMPORTAMENTAIS de isolamento no fim deste arquivo. Não remova sem
      // remover os testes junto — e não remova os testes: ver o comentário lá.
      { id: 'insumo-corrompido-mg', nome: 'Cloreto', unidade: 'kg', fazenda_id: 'fazenda-mg' },
    ] as any[],
    estoque: [
      { insumo_id: 'insumo-glifosato-mg', fazenda_id: 'fazenda-mg', quantidade_atual: 300, quantidade_minima_alerta: 20 },
      { insumo_id: 'insumo-glifosato-mt', fazenda_id: 'fazenda-mt', quantidade_atual: 50, quantidade_minima_alerta: 5 },
      // Linha "fantasma": existe para o SELECT batch achar (estoqueMap tem a linha),
      // mas _updateNaoEncontra faz o UPDATE simulado não casar nenhuma linha —
      // reproduz o cenário que a Tarefa 3 corrige (Supabase retorna error:null
      // mesmo com 0 linhas afetadas; só contar as linhas do .select() denuncia).
      { insumo_id: 'insumo-fantasma', fazenda_id: 'fazenda-mg', quantidade_atual: 100, quantidade_minima_alerta: 10, _updateNaoEncontra: true },
      // Linha que faz o UPDATE simulado devolver ERROR de verdade (não apenas
      // 0 linhas) — o caminho `if (updErr)` de decrementarEstoque não tinha
      // nenhum teste até o Apolo apontar (Item 3 da rodada de correção).
      { insumo_id: 'insumo-erro-update', fazenda_id: 'fazenda-mg', quantidade_atual: 40, quantidade_minima_alerta: 5, _updateGeraErro: true },
      // Rótulo CORROMPIDO de propósito: o insumo é da MG, mas a linha de estoque
      // diz fazenda-mt. Se alguma query perder o filtro de fazenda, este 999
      // vaza para a resposta da MG — e é isso que M5/M7+M8 vigiam.
      { insumo_id: 'insumo-corrompido-mg', fazenda_id: 'fazenda-mt', quantidade_atual: 999, quantidade_minima_alerta: 1 },
      // MESMO insumo_id com linha nas DUAS fazendas — fixture de mutação, NÃO uma
      // forma garantida do banco: `api/src/database/schema.sql:64` declara
      // `insumo_id ... unique` GLOBAL, e nenhuma migration derruba isso. Se a trava
      // valer em produção, estas duas linhas são impossíveis lá. O teste continua
      // valendo — travar a escrita é defesa em profundidade, e constraint some com
      // um DROP INDEX. Conferir na fonte viva antes de acreditar no repo:
      //   SELECT indexname, indexdef FROM pg_indexes
      //   WHERE tablename IN ('estoque','insumos') ORDER BY tablename, indexname;
      //
      // É o único seed que faz o UPDATE de decrementarEstoque REALMENTE rodar com
      // duas linhas candidatas. Ver o teste no fim do arquivo.
      { insumo_id: 'insumo-gemeo', fazenda_id: 'fazenda-mg', quantidade_atual: 100, quantidade_minima_alerta: 5 },
      { insumo_id: 'insumo-gemeo', fazenda_id: 'fazenda-mt', quantidade_atual: 777, quantidade_minima_alerta: 5 },
    ] as any[],
  }
  return { seed, estadoBanco: JSON.parse(JSON.stringify(seed)) }
})

// Simula supabase-js o suficiente para as funções exportadas de whatsapp.ts:
// select/eq/neq/ilike/in/limit (todas encadeáveis) + single() (execução explícita)
// + thenable (execução implícita via await, quando o código não chama .single()).
vi.mock('../services/supabase', () => {
  function tabelaBuilder(tabela: string) {
    const eqFiltros: Array<[string, any]> = []
    const neqFiltros: Array<[string, any]> = []
    const inFiltros: Array<[string, any[]]> = []
    let ilikeCampo: string | undefined
    let ilikeValor: string | undefined
    let limitN: number | undefined
    let ordenarCampo: string | undefined
    let updatePatch: Record<string, any> | undefined

    const linhasBase = (): any[] => (estadoBanco as any)[tabela] ?? []

    const aplicaFiltros = (linhas: any[]): any[] =>
      linhas.filter((row: any) =>
        eqFiltros.every(([c, v]) => row[c] === v)
        && neqFiltros.every(([c, v]) => row[c] !== v)
        && inFiltros.every(([c, arr]) => arr.includes(row[c]))
        && (!ilikeValor || String(row[ilikeCampo!] ?? '').toLowerCase().includes(ilikeValor)),
      )

    const executaSelect = (): any[] => {
      let linhas = aplicaFiltros(linhasBase())
      // .order() de verdade: se o código chamou, ordena pelo campo pedido. Se
      // NÃO chamou, devolve na ordem "de banco" (a ordem de declaração do
      // seed) — que para os talhões "Gogo" é deliberadamente NÃO-alfabética,
      // então um buscarTalhao sem .order('nome') pega o talhão errado e o
      // teste denuncia. Sem isto o mock antigo sempre devolvia a ordem do
      // seed disfarçada de determinismo, e nenhum teste pegava .order()
      // ausente (achado do Apolo).
      if (ordenarCampo) {
        linhas = [...linhas].sort((a, b) => {
          const va = String(a[ordenarCampo!] ?? '')
          const vb = String(b[ordenarCampo!] ?? '')
          return va < vb ? -1 : va > vb ? 1 : 0
        })
      }
      if (limitN != null) linhas = linhas.slice(0, limitN)
      return linhas
    }

    const executaUpdate = (): any[] => {
      // Linhas com _updateNaoEncontra simulam um UPDATE que não casa nenhuma
      // linha mesmo a linha existindo (cenário de teste da Tarefa 3 — não
      // representa um caminho real do código, só o comportamento que ele
      // precisa tolerar: Supabase retorna error:null mesmo com 0 linhas).
      const linhas = aplicaFiltros(linhasBase()).filter((row: any) => !row._updateNaoEncontra)
      linhas.forEach((row: any) => Object.assign(row, updatePatch))
      return linhas
    }

    // _updateGeraErro simula um UPDATE que devolve error DE VERDADE (rede,
    // constraint, etc.) — diferente de "0 linhas casadas". Cobre o caminho
    // `if (updErr)` de decrementarEstoque, sem teste até a rodada do Apolo.
    const forcaErroDeUpdate = (): boolean =>
      aplicaFiltros(linhasBase()).some((row: any) => row._updateGeraErro)

    const obj: any = {
      select: vi.fn(() => obj),
      eq:     vi.fn((campo: string, valor: any) => { eqFiltros.push([campo, valor]); return obj }),
      neq:    vi.fn((campo: string, valor: any) => { neqFiltros.push([campo, valor]); return obj }),
      in:     vi.fn((campo: string, valores: any[]) => { inFiltros.push([campo, valores]); return obj }),
      ilike:  vi.fn((campo: string, padrao: string) => {
        ilikeCampo = campo
        ilikeValor = padrao.replace(/%/g, '').toLowerCase()
        return obj
      }),
      limit:  vi.fn((n: number) => { limitN = n; return obj }),
      order:  vi.fn((campo: string) => { ordenarCampo = campo; return obj }),
      update: vi.fn((patch: Record<string, any>) => { updatePatch = patch; return obj }),
      single: vi.fn(async () => {
        const linhas = executaSelect()
        return linhas.length > 0
          ? { data: linhas[0], error: null }
          : { data: null, error: { message: 'not found' } }
      }),
      // thenable: cobre os caminhos que fazem `await` direto na cadeia sem .single()
      then: (resolve: any, reject: any) => {
        if (updatePatch !== undefined) {
          if (forcaErroDeUpdate()) {
            return Promise.resolve({ data: null, error: { message: 'erro simulado de conexão' } }).then(resolve, reject)
          }
          return Promise.resolve({ data: executaUpdate(), error: null }).then(resolve, reject)
        }
        return Promise.resolve({ data: executaSelect(), error: null }).then(resolve, reject)
      },
    }
    return obj
  }

  return {
    supabase: { from: vi.fn((tabela: string) => tabelaBuilder(tabela)) },
  }
})

import { buscarTalhao, buscarInsumo, consultarEstoque, decrementarEstoque, formatarSaidas } from './whatsapp'
import { supabase } from '../services/supabase'

// Acha o builder de uma chamada `supabase.from(tabela)` específica pela ORDEM
// em que aconteceu (0 = 1ª vez que a tabela foi consultada, 1 = 2ª, ...) — usado
// pelos testes de mutação abaixo para provar que um .eq(...) específico foi
// chamado de verdade, em vez de inferir isso só pelo dado devolvido (o Apolo
// mostrou que dado devolvido pode ser igual mesmo com o filtro removido, quando
// outro filtro da mesma função "mascara" o mutante).
function builderDaChamada(tabela: string, ocorrencia: number): any {
  const chamadas = (supabase.from as any).mock.calls
    .map((args: any[], i: number) => ({ tabela: args[0], builder: (supabase.from as any).mock.results[i].value }))
    .filter((c: any) => c.tabela === tabela)
  if (!chamadas[ocorrencia]) {
    throw new Error(`supabase.from('${tabela}') não foi chamado ${ocorrencia + 1}x — só ${chamadas.length}x`)
  }
  return chamadas[ocorrencia].builder
}

beforeEach(() => {
  vi.clearAllMocks()
  estadoBanco.talhoes = JSON.parse(JSON.stringify(seed.talhoes))
  estadoBanco.insumos = JSON.parse(JSON.stringify(seed.insumos))
  estadoBanco.estoque = JSON.parse(JSON.stringify(seed.estoque))
})

describe('buscarTalhao', () => {
  it('acha talhão em operação normal pelo nome', async () => {
    const talhao = await buscarTalhao('Gogo I', 'fazenda-mg')
    expect(talhao?.id).toBe('talhao-gogo-1')
  })

  it('NUNCA devolve talhão arrendado, mesmo quando o nome bate melhor', async () => {
    // "Gogo Usina" contém "gogo" e casaria pelo ilike frouxo — a trava tem que
    // excluir esse talhão antes do match de nome, não depois.
    const talhao = await buscarTalhao('Gogo Usina', 'fazenda-mg')
    expect(talhao).toBeNull()
  })

  it('talhão arrendado não aparece nem como match parcial de "gogo"', async () => {
    const talhao = await buscarTalhao('gogo', 'fazenda-mg')
    expect(talhao?.id).toBe('talhao-gogo-1')
    expect(talhao?.id).not.toBe('talhao-gogo-usina')
  })

  it('talhão de OUTRA fazenda com nome idêntico não pode casar', async () => {
    // Duas fazendas têm um talhão "Gogo I". Buscar na fazenda MT tem que devolver
    // o talhão da fazenda MT, nunca o da MG — mesmo que o da MG bata primeiro
    // num banco sem filtro por fazenda_id (esta é a falha que este PR corrige).
    const talhaoMt = await buscarTalhao('Gogo I', 'fazenda-mt')
    expect(talhaoMt?.id).toBe('talhao-mt-gogo-1')
    expect(talhaoMt?.id).not.toBe('talhao-gogo-1')
  })

  // ─── Item 4 — .order('nome') dá determinismo a irmãos de nome parecido ─────
  // Medido em produção (18 talhões): "Alvorada I"/"Alvorada II" e "Gogo
  // I"/"Gogo II"/"Gogo III" colidem por ilike frouxo. Sem ORDER BY, o Postgres
  // tem ordem indefinida — "pulverizei o Gogo I" podia registrar no Gogo III
  // (erro de até 44% na baixa de estoque, calculada sobre a área errada, com
  // "✅ Registrado!" na resposta). O seed acima declara Gogo III, II, I NESSA
  // ordem (não-alfabética) de propósito: sem .order('nome') no código, o mock
  // devolve nessa mesma ordem "de banco" e .limit(1) pega o talhão errado.
  it('buscarTalhao("Gogo I") devolve Gogo I — não II nem III, mesmo com o seed em ordem embaralhada', async () => {
    const talhao = await buscarTalhao('Gogo I', 'fazenda-mg')
    expect(talhao?.id).toBe('talhao-gogo-1')
  })

  it('buscarTalhao("Gogo II") devolve Gogo II — "gogo iii" contém "gogo ii" como substring, caso real', async () => {
    const talhao = await buscarTalhao('Gogo II', 'fazenda-mg')
    expect(talhao?.id).toBe('talhao-gogo-2')
  })
})

describe('buscarInsumo', () => {
  it('acha o insumo da própria fazenda', async () => {
    const insumo = await buscarInsumo('glifosato', 'fazenda-mg')
    expect(insumo?.id).toBe('insumo-glifosato-mg')
  })

  it('saída de estoque não escolhe insumo de outra fazenda', async () => {
    // As duas fazendas têm "Glifosato" cadastrado com IDs diferentes. Sem o
    // filtro de fazenda_id, o .limit(5) sem .order() podia devolver o insumo
    // da fazenda errada e gravar movimentação de estoque cruzada (a falha
    // concreta descrita no contexto do bug).
    const insumoMt = await buscarInsumo('glifosato', 'fazenda-mt')
    expect(insumoMt?.id).toBe('insumo-glifosato-mt')
    expect(insumoMt?.id).not.toBe('insumo-glifosato-mg')
  })
})

describe('consultarEstoque', () => {
  it('consulta do MT não devolve número do MG', async () => {
    const resposta = await consultarEstoque('glifosato', 'fazenda-mt')
    expect(resposta).toContain('50')
    expect(resposta).not.toContain('300')
  })

  it('consulta do MG não devolve número do MT', async () => {
    const resposta = await consultarEstoque('glifosato', 'fazenda-mg')
    expect(resposta).toContain('300')
    expect(resposta).not.toContain('50 L')
  })

  // ─── Item 3 (mutação) — mata o mutante que remove .eq('fazenda_id') de INSUMOS ─
  // Os dois testes acima SOBREVIVEM à remoção desse filtro: como o MT também tem
  // um "Glifosato" cadastrado (com id próprio), o filtro de ESTOQUE (linha ~160)
  // sozinho já filtra o resultado certo — o filtro de INSUMOS fica sem prova
  // própria. Aqui a fazenda MT não tem NENHUM "glifosato" cadastrado (nem
  // insumo, nem estoque) — só a MG tem. Sem o filtro de fazenda_id em insumos,
  // a busca por "glifosato" pedida para MT encontraria o insumo DA MG (ilike
  // não distingue fazenda) e devolveria "sem registro de estoque" em vez de
  // "não encontrei" — mensagem diferente, mutante morre.
  it('MT sem NENHUM "glifosato" cadastrado (só MG tem): devolve "Não encontrei", nunca o número do MG', async () => {
    estadoBanco.insumos = estadoBanco.insumos.filter(i => i.id !== 'insumo-glifosato-mt')
    estadoBanco.estoque = estadoBanco.estoque.filter(e => e.insumo_id !== 'insumo-glifosato-mt')

    const resposta = await consultarEstoque('glifosato', 'fazenda-mt')
    expect(resposta).toContain('Não encontrei')
    expect(resposta).not.toContain('300')
  })

  // ─── Item 3 (mutação) — mata o mutante que remove .eq('fazenda_id') de ESTOQUE ─
  // Prova por INSPEÇÃO DE CHAMADA, não por dado devolvido: dado que o id de
  // insumo já vem filtrado por fazenda (linha ~148), o `.in('insumo_id', ids)`
  // sozinho já restringe ao id certo em qualquer cenário de dado plausível — o
  // filtro de fazenda_id em ESTOQUE só importa como defesa contra uma linha de
  // estoque corrompida (mesmo insumo_id, fazenda_id errado). O seed
  // `insumo-corrompido-mg` simula essa corrupção, então dá para testar dos DOIS
  // jeitos — e os dois são necessários. Ver o comentário do M5, logo abaixo.
  it('a query de ESTOQUE realmente chama .eq(fazenda_id, ...) — não só a de insumos', async () => {
    await consultarEstoque('glifosato', 'fazenda-mt')

    const builderEstoque = builderDaChamada('estoque', 0)
    expect(builderEstoque.eq).toHaveBeenCalledWith('fazenda_id', 'fazenda-mt')
  })

  // ⚠️ NÃO troque este teste pelo espião acima — SOME os dois ou MANTENHA os dois.
  // O espião prova que `.eq` foi CHAMADO, não que o resultado está isolado. Na
  // revisão de 19/09 o Apolo instalou o mutante mais plausível que existe (se a
  // query filtrada volta vazia, repetir SEM o filtro, "para o bot parar de dizer
  // que não tem estoque") e os 3 espiões passaram VERDES. Só este teste, que olha
  // a RESPOSTA, pegou. Espião morre em refactor legítimo: medido em 19/09,
  // refatorar o UPDATE para `.match({ insumo_id, fazenda_id })` — API normal do
  // supabase-js — deixa o espião do UPDATE vermelho com o código CERTO, e M5 e
  // M7+M8 verdes. (O mock deste arquivo ainda não implementa `.match`; quem fizer
  // esse refactor soma 1 linha em `tabelaBuilder` ANTES, senão um punhado de
  // testes cai com `update(...).match is not a function` e a comparação não diz
  // nada. Quantos, hoje: instale o refactor e rode
  // `npx vitest run src/webhooks/whatsapp.test.ts` — o número muda toda vez que
  // alguém soma um teste que chama decrementarEstoque, então não vale escrevê-lo
  // aqui: já apodreceu uma vez neste comentário.)
  it('M5: linha de estoque rotulada com a fazenda ERRADA não pode virar resposta da MG', async () => {
    const resposta = await consultarEstoque('cloreto', 'fazenda-mg')

    expect(resposta).toContain('sem registro de estoque')
    expect(resposta).not.toContain('999')
  })
})

describe('decrementarEstoque + formatarSaidas', () => {
  it('quando o UPDATE não pega nenhuma linha, novaQuantidade fica null e a resposta não mostra "(estoque:"', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-fantasma', nome: 'Glifosato', quantidade: 2, unidade: 'L', dose_por_ha: null },
    ]
    const saidas = await decrementarEstoque(okItems, 'fazenda-mg')
    expect(saidas[0].novaQuantidade).toBeNull()

    const resposta = formatarSaidas(saidas)
    expect(resposta).not.toContain('(estoque:')
  })

  it('quando o UPDATE grava normalmente, a resposta mostra o novo saldo', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-glifosato-mg', nome: 'Glifosato', quantidade: 2, unidade: 'L', dose_por_ha: null },
    ]
    const saidas = await decrementarEstoque(okItems, 'fazenda-mg')
    expect(saidas[0].novaQuantidade).toBe(298) // 300 - 2

    const resposta = formatarSaidas(saidas)
    expect(resposta).toContain('(estoque: 298L)')
  })

  // ─── Item 3 (mutação) — updErr != null nunca foi testado ───────────────────
  // Até aqui só o caminho "UPDATE devolveu 0 linhas" (error: null) tinha teste.
  // O `if (updErr)` — erro de verdade (rede, constraint) — não tinha nenhum.
  it('quando o UPDATE devolve ERROR de verdade (não só 0 linhas), novaQuantidade fica null e loga', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-erro-update', nome: 'ProdutoComErro', quantidade: 3, unidade: 'L', dose_por_ha: null },
    ]
    const saidas = await decrementarEstoque(okItems, 'fazenda-mg')
    expect(saidas[0].novaQuantidade).toBeNull()

    const resposta = formatarSaidas(saidas)
    expect(resposta).not.toContain('(estoque:')
  })

  // ─── Item 3 (mutação) — mata os mutantes que removem .eq('fazenda_id') no ──
  // SELECT batch (linha ~313) e no UPDATE por item (linha ~334). Ambos são
  // descritos no código como "última linha de defesa": com o dado do fixture
  // (cada insumo_id só existe numa fazenda), remover UM dos dois filtros ainda
  // deixa o resultado final (novaQuantidade) correto por acaso, porque o OUTRO
  // filtro (mais o próprio dado ser fazenda-exclusivo) mascara o mutante — é
  // exatamente por isso que o Apolo os achou sobreviventes. Prova por
  // INSPEÇÃO DE CHAMADA, que não depende dessa coincidência de dado.
  it('o SELECT batch realmente chama .eq(fazenda_id, ...)', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-glifosato-mg', nome: 'Glifosato', quantidade: 2, unidade: 'L', dose_por_ha: null },
    ]
    await decrementarEstoque(okItems, 'fazenda-mg')

    const builderSelect = builderDaChamada('estoque', 0) // 1ª chamada = SELECT batch
    expect(builderSelect.eq).toHaveBeenCalledWith('fazenda_id', 'fazenda-mg')
  })

  it('o UPDATE de cada item realmente chama .eq(fazenda_id, ...)', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-glifosato-mg', nome: 'Glifosato', quantidade: 2, unidade: 'L', dose_por_ha: null },
    ]
    await decrementarEstoque(okItems, 'fazenda-mg')

    const builderUpdate = builderDaChamada('estoque', 1) // 2ª chamada = UPDATE do item
    expect(builderUpdate.eq).toHaveBeenCalledWith('fazenda_id', 'fazenda-mg')
  })

  // ⚠️ Par comportamental dos dois espiões acima — mesma regra: os dois ou nenhum.
  //
  // Este teste só acende quando as DUAS pontas cedem JUNTAS: o SELECT vaza a linha
  // da outra fazenda E o UPDATE grava nela. Sozinha, nenhuma das duas o acorda —
  // e isso é medido, não suposto (mutantes instalados e revertidos em 19/09):
  //
  //   UPDATE perde `.eq('fazenda_id')`  → este VERDE; quem grita é o espião do UPDATE
  //   SELECT perde `.eq('fazenda_id')`  → este VERDE; quem grita é o espião do SELECT
  //                                        e o teste `insumo-gemeo` abaixo
  //   as duas juntas                     → este VERMELHO (`expected 994 to be null`)
  //
  // Na execução limpa ele nem chega no UPDATE: o SELECT filtrado volta vazio,
  // `estoqueMap` fica sem a chave, e a função retorna em `if (!linha)`. Os 999
  // continuam 999 porque ninguém encostou neles. Veja o log da rodada:
  // `[WhatsApp] Sem linha em estoque para Cloreto`.
  //
  // Ou seja: ele tem ZERO mortes exclusivas contra mutante de uma ponta só. Isso
  // NÃO é motivo para apagá-lo — é seguro barato contra regressão comportamental,
  // e é o único que pega a falha combinada. É motivo para NÃO apagar os espiões
  // achando que este cobre o que eles cobrem. Ele não cobre.
  it('M7+M8: linha de outra fazenda não vira saldo nem gravação (as duas pontas juntas)', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-corrompido-mg', nome: 'Cloreto', quantidade: 5, unidade: 'kg', dose_por_ha: null },
    ]
    const saidas = await decrementarEstoque(okItems, 'fazenda-mg')

    expect(saidas[0].novaQuantidade).toBeNull()
    const linha = estadoBanco.estoque.find((e: any) => e.insumo_id === 'insumo-corrompido-mg')
    expect(linha.quantidade_atual).toBe(999)
  })

  // O teste mais LARGO deste arquivo — o buraco que a revisão de 19/09 achou.
  // Aqui o UPDATE roda de verdade, com DUAS linhas candidatas para o mesmo
  // insumo_id, então ele observa leitura e escrita de uma vez. Medido:
  //
  //   UPDATE perde `.eq('fazenda_id')`  → VERMELHO (`expected 90 to be 777`),
  //                                        junto com o espião do UPDATE; os
  //                                        outros 2 espiões seguem verdes
  //   SELECT perde `.eq('fazenda_id')`  → VERMELHO (`expected 767 to be 90`)
  //   as duas juntas                     → VERMELHO
  //   refactor legítimo para `.match()`  → VERDE, e só o espião do UPDATE cai
  //
  // Essa última linha é a prova viva do argumento lá em cima, no comentário do
  // M5: comportamento sobrevive a refactor, espião não.
  it('decrementar a MG não pode encostar na linha do MT com o mesmo insumo_id', async () => {
    const okItems = [
      { ok: true as const, insumo_id: 'insumo-gemeo', nome: 'Gêmeo', quantidade: 10, unidade: 'L', dose_por_ha: null },
    ]
    const saidas = await decrementarEstoque(okItems, 'fazenda-mg')

    expect(saidas[0].novaQuantidade).toBe(90)
    const linhas = estadoBanco.estoque.filter((e: any) => e.insumo_id === 'insumo-gemeo')
    expect(linhas.find((e: any) => e.fazenda_id === 'fazenda-mg').quantidade_atual).toBe(90)
    expect(linhas.find((e: any) => e.fazenda_id === 'fazenda-mt').quantidade_atual).toBe(777)
  })
})
