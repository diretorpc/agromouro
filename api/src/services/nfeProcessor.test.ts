import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Simulação da borda com Supabase, Z-API e Claude Haiku ──────────────────
// Usada só pelo describe "processarNFe — isolamento do bloco de boletos"
// no fim deste arquivo. As suítes de `parseXmlNFe` acima não tocam nenhuma
// destas (são funções puras), então a simulação não muda o comportamento delas.
//
// vi.hoisted: vi.mock() é hoisted para o topo do arquivo pelo Vitest, então a
// fábrica do mock não pode referenciar variável comum declarada abaixo dela —
// só o que vier de vi.hoisted (executado antes de qualquer vi.mock).
const { chamadas, estadoBanco } = vi.hoisted(() => ({
  chamadas: [] as { table: string; method: string; payload?: any }[],
  // Controla se o upsert de 'contas_a_pagar' devolve erro — ligado/desligado
  // por teste em vi.hoisted porque a fábrica do mock precisa enxergar o valor.
  estadoBanco: { falharUpsertContas: false },
}))

vi.mock('./supabase', () => {
  function builder(table: string): any {
    // Estado por CADEIA (por chamada de .from()) — não vaza entre chamadas.
    let ultimoInsert: any = null
    let resultadoPendente: { data: any; error: any } = { data: null, error: null }

    const obj: any = {
      insert: vi.fn((payload: any) => {
        ultimoInsert = payload
        chamadas.push({ table, method: 'insert', payload })
        return obj
      }),
      update: vi.fn((payload: any) => {
        chamadas.push({ table, method: 'update', payload })
        return obj
      }),
      upsert: vi.fn((payload: any) => {
        chamadas.push({ table, method: 'upsert', payload })
        if (table === 'contas_a_pagar' && estadoBanco.falharUpsertContas) {
          resultadoPendente = {
            data:  null,
            error: { message: 'column "numero_parcela" of relation "contas_a_pagar" does not exist', code: '42703' },
          }
        }
        return obj
      }),
      select:      vi.fn(() => obj),
      ilike:       vi.fn(() => obj),
      eq:          vi.fn(() => obj),
      limit:       vi.fn(() => obj),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      single:      vi.fn(() => {
        if (table === 'notas_fiscais') return Promise.resolve({ data: { id: 'nfe-id-fake' }, error: null })
        // 'insumos': se veio de um .insert() nesta mesma cadeia, é o "criar e
        // devolver"; sem insert antes, é a busca por insumo existente — este
        // mock sempre responde "não existe" para forçar o caminho de auto-criação.
        if (table === 'insumos' && ultimoInsert) {
          return Promise.resolve({
            data:  { id: 'insumo-id-fake', nome: ultimoInsert.nome, unidade: ultimoInsert.unidade },
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      }),
      // Awaited sem .single() (ex.: .update().eq(), .insert() puro, ou o
      // .upsert().select() de contas_a_pagar): o builder precisa ser "thenable"
      // para o `await` resolver com o resultado combinado nesta cadeia.
      then: (resolve: any) => resolve(resultadoPendente),
    }
    return obj
  }

  return {
    supabase: {
      from: vi.fn((table: string) => builder(table)),
      // `incrementar_estoque` é quem de fato move o SALDO do estoque — a
      // gravação em movimentacoes_estoque é só o registro histórico. Sem
      // registrar esta chamada em `chamadas`, apagar o rpc() do código
      // manteria o teste verde dizendo "estoque protegido" sem provar nada
      // sobre o saldo.
      rpc: vi.fn((fn: string, args: any) => {
        chamadas.push({ table: '__rpc__', method: fn, payload: args })
        return Promise.resolve({ data: null, error: null })
      }),
    },
  }
})

vi.mock('./zapi', () => ({
  // Marca o envio na mesma sequência `chamadas` que o Supabase — é assim que
  // o teste de ORDEM abaixo confere que o WhatsApp sai DEPOIS dos boletos.
  enviarMensagem: vi.fn(() => {
    chamadas.push({ table: '__whatsapp__', method: 'send' })
    return Promise.resolve(true)
  }),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(() => Promise.resolve({ content: [{ type: 'text', text: 'fertilizante_n' }] })) },
  })),
}))

import { parseXmlNFe, processarNFe, type NFeData, type NFeItem } from './nfeProcessor'
import { enviarMensagem } from './zapi'

// Monta uma NF-e mínima. `extra` entra dentro de <infNFe>, depois dos itens.
function nfeXml(extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe>
  <ide><nNF>4516</nNF><dhEmi>2026-07-14T18:15:00-03:00</dhEmi></ide>
  <emit><xNome>TRIANGULO DIESEL TRR LTDA</xNome><CNPJ>12345678000199</CNPJ></emit>
  <det><prod><xProd>OLEO DIESEL S10</xProd><qCom>3000</qCom><uCom>L</uCom>
    <vUnCom>6.12</vUnCom><vProd>18360.00</vProd><NCM>27101259</NCM><CFOP>5102</CFOP></prod></det>
  <total><ICMSTot><vNF>30600.00</vNF></ICMSTot></total>
  ${extra}
</infNFe></NFe></nfeProc>`
}

const UMA_DUPLICATA = `
  <cobr>
    <fat><nFat>00004516</nFat><vOrig>30600.00</vOrig><vLiq>30600.00</vLiq></fat>
    <dup><nDup>001</nDup><dVenc>2026-07-21</dVenc><vDup>30600.00</vDup></dup>
  </cobr>
  <pag><detPag><tPag>15</tPag><vPag>30600.00</vPag></detPag></pag>`

const TRES_DUPLICATAS = `
  <cobr>
    <fat><nFat>00004516</nFat><vOrig>30600.00</vOrig><vLiq>30600.00</vLiq></fat>
    <dup><nDup>001</nDup><dVenc>2026-08-15</dVenc><vDup>10200.00</vDup></dup>
    <dup><nDup>002</nDup><dVenc>2026-09-15</dVenc><vDup>10200.00</vDup></dup>
    <dup><nDup>003</nDup><dVenc>2026-10-15</dVenc><vDup>10200.00</vDup></dup>
  </cobr>
  <pag><detPag><indPag>1</indPag><tPag>15</tPag><vPag>30600.00</vPag></detPag></pag>`

// Caso ERCAL, medido em 31/07/2026: boleto marcado, e nenhuma data em lugar nenhum.
const SEM_COBRANCA = `
  <pag><detPag><indPag>0</indPag><tPag>15</tPag><vPag>30600.00</vPag></detPag></pag>`

const CARTAO = `
  <cobr>
    <fat><nFat>0051843</nFat><vOrig>355.00</vOrig><vLiq>355.00</vLiq></fat>
    <dup><nDup>001</nDup><dVenc>2026-08-01</dVenc><vDup>355.00</vDup></dup>
  </cobr>
  <pag><detPag><indPag>1</indPag><tPag>05</tPag><vPag>355.00</vPag></detPag></pag>`

describe('parseXmlNFe — o que já era lido continua igual', () => {
  it('nota sem os blocos novos continua sendo lida por inteiro', () => {
    const r = parseXmlNFe(nfeXml())!
    expect(r).not.toBeNull()
    expect(r.numero).toBe('4516')
    expect(r.emitenteNome).toBe('TRIANGULO DIESEL TRR LTDA')
    expect(r.emitenteCnpj).toBe('12345678000199')
    expect(r.valorTotal).toBe(30600)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].description).toBe('OLEO DIESEL S10')
  })

  it('nota sem os blocos novos devolve listas vazias, nao estoura', () => {
    const r = parseXmlNFe(nfeXml())!
    expect(r.duplicatas).toEqual([])
    expect(r.formaPagamento).toBeNull()
  })
})

describe('parseXmlNFe — quadro de cobranca', () => {
  it('uma duplicata devolve uma parcela (o leitor entrega OBJETO, nao lista)', () => {
    const r = parseXmlNFe(nfeXml(UMA_DUPLICATA))!
    expect(r.duplicatas).toHaveLength(1)
    expect(r.duplicatas[0].vencimento).toBe('2026-07-21')
    expect(r.duplicatas[0].valor).toBe(30600)
  })

  it('tres duplicatas devolvem tres parcelas, na ordem', () => {
    const r = parseXmlNFe(nfeXml(TRES_DUPLICATAS))!
    expect(r.duplicatas).toHaveLength(3)
    expect(r.duplicatas.map(d => d.vencimento)).toEqual(['2026-08-15', '2026-09-15', '2026-10-15'])
    expect(r.duplicatas.map(d => d.valor)).toEqual([10200, 10200, 10200])
  })

  it('nota sem quadro de cobranca devolve lista vazia', () => {
    const r = parseXmlNFe(nfeXml(SEM_COBRANCA))!
    expect(r.duplicatas).toEqual([])
  })

  it('duplicata sem data de vencimento vira vencimento vazio, nao data invalida', () => {
    const semData = `<cobr><dup><nDup>001</nDup><vDup>500.00</vDup></dup></cobr>`
    const r = parseXmlNFe(nfeXml(semData))!
    expect(r.duplicatas).toHaveLength(1)
    expect(r.duplicatas[0].vencimento).toBeNull()
    expect(r.duplicatas[0].valor).toBe(500)
  })

  it('quadro de cobranca so com fatura, sem duplicata, devolve lista vazia', () => {
    const soFatura = `<cobr><fat><nFat>001</nFat><vLiq>500.00</vLiq></fat></cobr>`
    expect(parseXmlNFe(nfeXml(soFatura))!.duplicatas).toEqual([])
  })

  it('corta o horario quando o fornecedor manda data com hora', () => {
    const comHora = `<cobr><dup><dVenc>2026-07-21T00:00:00-03:00</dVenc><vDup>10.00</vDup></dup></cobr>`
    expect(parseXmlNFe(nfeXml(comHora))!.duplicatas[0].vencimento).toBe('2026-07-21')
  })
})

describe('parseXmlNFe — forma de pagamento', () => {
  it('boleto vem como 15', () => {
    expect(parseXmlNFe(nfeXml(UMA_DUPLICATA))!.formaPagamento).toBe('15')
  })

  it('codigo de um digito ganha zero a esquerda (5 vira 05)', () => {
    expect(parseXmlNFe(nfeXml(CARTAO))!.formaPagamento).toBe('05')
  })

  it('nota sem bloco de pagamento devolve vazio', () => {
    const soCobr = `<cobr><dup><dVenc>2026-08-01</dVenc><vDup>10.00</vDup></dup></cobr>`
    expect(parseXmlNFe(nfeXml(soCobr))!.formaPagamento).toBeNull()
  })

  it('varios pagamentos: usa o primeiro', () => {
    const dois = `<pag>
      <detPag><tPag>15</tPag><vPag>100.00</vPag></detPag>
      <detPag><tPag>01</tPag><vPag>50.00</vPag></detPag>
    </pag>`
    expect(parseXmlNFe(nfeXml(dois))!.formaPagamento).toBe('15')
  })
})

describe('parseXmlNFe — CFOP por item', () => {
  it('le o CFOP do item', () => {
    const r = parseXmlNFe(nfeXml())!
    expect(r.items[0].cfop).toBe('5102')
  })

  it('item sem CFOP devolve string vazia, nao quebra', () => {
    const semCfop = nfeXml().replace(/<CFOP>\d+<\/CFOP>/, '')
    expect(parseXmlNFe(semCfop)!.items[0].cfop).toBe('')
  })

  it('CFOP com pontuacao vira so digitos', () => {
    const comPonto = nfeXml().replace(/<CFOP>\d+<\/CFOP>/, '<CFOP>5.117</CFOP>')
    expect(parseXmlNFe(comPonto)!.items[0].cfop).toBe('5117')
  })

  it('nota com dois itens de CFOP diferente le os dois', () => {
    const doisItens = nfeXml().replace(
      '</det>',
      `</det><det><prod><xProd>BRINDE</xProd><qCom>2</qCom><uCom>UN</uCom>
       <vUnCom>0</vUnCom><vProd>0</vProd><NCM>31051000</NCM><CFOP>5910</CFOP></prod></det>`,
    )
    const r = parseXmlNFe(doisItens)!
    expect(r.items.map(i => i.cfop)).toEqual(['5102', '5910'])
  })

  it('os campos que ja eram lidos continuam identicos', () => {
    const r = parseXmlNFe(nfeXml())!
    expect(r.numero).toBe('4516')
    expect(r.items[0].description).toBe('OLEO DIESEL S10')
    expect(r.items[0].ncm).toBe('27101259')
  })
})

// ─── STEP 5 do brief da Task 5 — prova de isolamento, agora PERMANENTE ──────
//
// Esta é a propriedade em que a Fase 2 inteira se apoia: se a criação de
// boletos (gravarContasDaNota) estourar, o resto do processamento de NF-e
// (itens, estoque, financeiro, status da nota, WhatsApp) TEM que continuar.
// Sem este teste, alguém poderia mover o `await gravarContasDaNota(...)` para
// fora do try/catch em nfeProcessor.ts, os 88 testes de antes continuariam
// verdes, e nada avisaria — a Task 6 mexe exatamente neste bloco.
describe('processarNFe — isolamento do bloco de boletos (Fase 2)', () => {
  const nfeCompleta: NFeData = {
    numero:         '7777',
    dataEmissao:    '2026-07-31T10:00:00-03:00',
    emitenteNome:   'FORNECEDOR PROVA LTDA',
    emitenteCnpj:   '11111111000199',
    valorTotal:     5000,
    items: [{
      description:  'ADUBO NPK 04-14-08',
      quantity:     1000,
      unit:         'kg',
      unitValue:    5,
      totalValue:   5000,
      quantityTrib: 1000,
      unitTrib:     'kg',
      ncm:          '31051000',   // cai na fronteira determinística (cap. 31) — não depende do Haiku
      cfop:         '5102',
    }],
    duplicatas:     [{ numero: '001', vencimento: '2026-08-30', valor: 5000 }],
    formaPagamento: '15',
  }

  beforeEach(() => {
    chamadas.length = 0
    estadoBanco.falharUpsertContas = true
    vi.mocked(enviarMensagem).mockClear()
  })

  // O espião de console.error (vi.spyOn dentro de cada `it`) nunca era
  // restaurado antes desta correção, e este arquivo não tem `restoreMocks`
  // global no vitest.config.ts — o segundo teste conferia AUSÊNCIA de log
  // sobre um espião que o primeiro já tinha sujado. Confirmado empiricamente
  // (ver relatório) que vi.restoreAllMocks() aqui NÃO reseta os mocks
  // persistentes de ./supabase, ./zapi e @anthropic-ai/sdk: todos foram
  // criados com a implementação já embutida em vi.fn(impl) — nunca trocada
  // depois via mockImplementation() —, então "restaurar" volta pra essa
  // mesma implementação. Só o spy de console.error é de fato restaurado ao
  // console.error real, que é o efeito que queremos entre os testes.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('boleto explodindo no banco nao impede itens, estoque, financeiro, status=processada e WhatsApp', async () => {
    const erroSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await processarNFe(nfeCompleta, 'webhook', 'fazenda-fake-id')

    expect(chamadas.some(c => c.table === 'itens_nfe' && c.method === 'insert')).toBe(true)
    expect(chamadas.some(c => c.table === 'movimentacoes_estoque' && c.method === 'insert')).toBe(true)
    expect(chamadas.some(c => c.table === 'lancamentos_financeiros' && c.method === 'insert')).toBe(true)
    // A gravação em movimentacoes_estoque é só o registro histórico — quem
    // move o SALDO de verdade é este rpc. Sem checar isto, apagar a chamada
    // ao rpc no código mantinha este teste verde dizendo "estoque protegido".
    expect(chamadas.some(c => c.table === '__rpc__' && c.method === 'incrementar_estoque')).toBe(true)

    const statusGravados = chamadas
      .filter(c => c.table === 'notas_fiscais' && c.method === 'update')
      .map(c => c.payload.status)
    expect(statusGravados).toEqual(['processada'])   // nunca 'erro'

    expect(enviarMensagem).toHaveBeenCalledTimes(1)

    const logouIsolamento = erroSpy.mock.calls.some(args =>
      String(args[0]).includes('falha ao criar boletos (a nota foi processada assim mesmo)'))
    expect(logouIsolamento).toBe(true)

    // A mensagem de erro do banco (IMP-2) chega com nota + fornecedor, não crua.
    const mensagemErro = erroSpy.mock.calls.find(args =>
      String(args[0]).includes('falha ao criar boletos'))?.[1]
    expect(String(mensagemErro)).toContain('NF 7777 (FORNECEDOR PROVA LTDA)')
    expect(String(mensagemErro)).toContain('42703')

    // ─── ORDEM (achado da revisão, rodada 2) ───────────────────────────────
    // `chamadas` registra em sequência. Sem isto, mover o
    // update({status:'processada'}) para DEPOIS do bloco de boletos (o que
    // o IMP-1 condenou) passa pelos testes ACIMA sem quebrar nada — e mover
    // o enviarMensagem para ANTES dos boletos também passaria batido.
    const indice = (tabela: string, metodo: string) =>
      chamadas.findIndex(c => c.table === tabela && c.method === metodo)

    const iStatusProcessada = indice('notas_fiscais', 'update')
    const iBoleto           = indice('contas_a_pagar', 'upsert')
    const iWhatsapp         = indice('__whatsapp__', 'send')

    expect(iStatusProcessada).toBeGreaterThanOrEqual(0)
    expect(iBoleto).toBeGreaterThanOrEqual(0)
    expect(iWhatsapp).toBeGreaterThanOrEqual(0)

    // Nota marcada 'processada' ANTES de tentar o boleto: se o boleto travar
    // (não só estourar), a nota já não fica presa em 'processando' (IMP-1).
    expect(iStatusProcessada).toBeLessThan(iBoleto)
    // Boleto (sucesso ou falha) tentado ANTES do WhatsApp: a mensagem só sai
    // depois que o bloco de boletos já rodou por inteiro.
    expect(iBoleto).toBeLessThan(iWhatsapp)
  })

  it('sem a explosao, o boleto grava normalmente (contraprova: o mock nao mascara o caminho feliz)', async () => {
    estadoBanco.falharUpsertContas = false
    const erroSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await processarNFe(nfeCompleta, 'webhook', 'fazenda-fake-id')

    const upsertContas = chamadas.filter(c => c.table === 'contas_a_pagar' && c.method === 'upsert')
    expect(upsertContas).toHaveLength(1)

    const logouIsolamento = erroSpy.mock.calls.some(args =>
      String(args[0]).includes('falha ao criar boletos'))
    expect(logouIsolamento).toBe(false)
  })
})

// ─── CONSERTO 1 (revisão final da Fase 2) — "em N dias" compara com HOJE ────
//
// Amostra real (31/07/2026): nota da METAL AGRICOLA emitida 31/07, vencimento
// 01/08. Antes deste conserto, nfeProcessor passava `dataFormatada` (a data
// de EMISSÃO da nota) para o parâmetro `hojeISO` de linhaBoleto — então uma
// nota processada em atraso (ex.: 03/08, quando o e-mail demora a chegar)
// dizia "vence 01/08 (em 1 dia)" para um boleto que já tinha vencido há 2 dias.
// O sistema nunca conseguia dizer "venceu há N dias", porque a conta era
// sempre contra uma data congelada no passado.
describe('processarNFe — "em N dias" usa hoje de verdade, não a data da nota (conserto 1)', () => {
  const nfeAtrasada: NFeData = {
    numero:         '9001',
    dataEmissao:    '2026-07-31T09:00:00-03:00',
    emitenteNome:   'METAL AGRICOLA LTDA',
    emitenteCnpj:   '22222222000199',
    valorTotal:     1000,
    items: [{
      description:  'PECA METALICA',
      quantity:     1,
      unit:         'un',
      unitValue:    1000,
      totalValue:   1000,
      quantityTrib: 1,
      unitTrib:     'un',
      ncm:          '84314900',   // peça de máquina — fronteira determinística, não passa pelo Haiku
      cfop:         '5102',
    }],
    duplicatas:     [{ numero: '001', vencimento: '2026-08-01', valor: 1000 }],
    formaPagamento: '15',
  }

  beforeEach(() => {
    chamadas.length = 0
    estadoBanco.falharUpsertContas = false
    vi.mocked(enviarMensagem).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('nota emitida 31/07, vence 01/08, processada em 03/08 → mensagem diz "venceu há 2 dias"', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00-03:00'))   // "hoje" = 3 dias depois da emissão

    await processarNFe(nfeAtrasada, 'webhook', 'fazenda-fake-id')

    const mensagem = vi.mocked(enviarMensagem).mock.calls[0]?.[1] as string
    // Falharia com o código antigo: contra a data de EMISSÃO (31/07), o
    // vencimento 01/08 calcularia "em 1 dia" em vez de "venceu há 2 dias".
    expect(mensagem).toContain('venceu há 2 dias')
    expect(mensagem).not.toContain('em 1 dia')
  })

  // ─── Conserto 2 completo — o cabeçalho da mensagem escrevia dinheiro à mão ──
  // (`R$ ${valorTotal.toFixed(2)}` → "R$ 1000.00") enquanto a linha do boleto,
  // na MESMA mensagem, já usava a reais() centralizada em formato.ts
  // ("R$ 1.000,00"). Duas grafias do mesmo valor na mesma mensagem de
  // WhatsApp. Este teste falharia com o `toFixed(2)` antigo: o cabeçalho
  // não continha 'R$ 1.000,00', e sim 'R$ 1000.00'.
  it('cabeçalho e boleto usam a MESMA formatação de dinheiro (reais centralizado)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00-03:00'))

    await processarNFe(nfeAtrasada, 'webhook', 'fazenda-fake-id')

    const mensagem = vi.mocked(enviarMensagem).mock.calls[0]?.[1] as string
    const ocorrenciasDoValor = mensagem.match(/R\$ 1\.000,00/g) ?? []
    // valorTotal (cabeçalho) e o valor do boleto são os mesmos R$ 1.000,00
    // nesta nota — as duas linhas têm que grafar igual.
    expect(ocorrenciasDoValor.length).toBe(2)
    expect(mensagem).not.toContain('R$ 1000.00')
  })
})

// ─── TASK 4 — o CFOP manda no estoque e no custo ────────────────────────────
//
// Tasks 1-3 (commits ecc546e, 9dae886, bbaad64) deram ao sistema o dado (CFOP
// lido do XML) e a regra pura (efeitoDoCfop, sem banco). Esta suíte prova que
// processarNFe de fato OBEDECE a regra — sem isto, a nota de ENTREGA (CFOP
// 5117) continuaria somando estoque e gasto, exatamente como o caso real da
// SYAGRI de 400 t de cloreto de potássio (KCl) que gerou R$ 1,2 mi de gasto
// fantasma (ver docs/superpowers/plans/2026-08-03-nfe-cfop-entrega-futura.md).
describe('processarNFe — CFOP manda no estoque e no custo', () => {
  beforeEach(() => {
    chamadas.length = 0
    estadoBanco.falharUpsertContas = false
    vi.mocked(enviarMensagem).mockClear()
  })

  // Sem afterEach(vi.restoreAllMocks): o beforeEach acima já reseta tudo que
  // este describe usa. Os describes vizinhos não têm esse afterEach, e mantê-lo
  // aqui só protegeria um describe que fosse anexado DEPOIS deste — hoje não
  // existe nenhum.

  // Fábrica de item — NCM cap. 31 (fertilizante) cai na fronteira
  // determinística de fronteiraPorNCM(), então "estocável" nunca depende do
  // mock do Haiku aqui. Só o CFOP muda entre os testes.
  function item(overrides: Partial<NFeItem> = {}): NFeItem {
    return {
      description:  'CLORETO DE POTASSIO',
      quantity:     400,
      unit:         'TO',
      unitValue:    2650,
      totalValue:   1060000,
      quantityTrib: 400,
      unitTrib:     'TO',
      ncm:          '31042000',
      cfop:         '5102',
      ...overrides,
    }
  }

  function nota(overrides: Partial<NFeData> = {}): NFeData {
    return {
      numero:         '8001',
      dataEmissao:    '2026-08-03T10:00:00-03:00',
      emitenteNome:   'SYAGRI INSUMOS LTDA',
      emitenteCnpj:   '33333333000199',
      valorTotal:     1060000,
      items:          [item()],
      duplicatas:     [],
      formaPagamento: '90',
      ...overrides,
    }
  }

  const insertsEm = (tabela: string) =>
    chamadas.filter(c => c.table === tabela && c.method === 'insert')
  const updatesEm = (tabela: string) =>
    chamadas.filter(c => c.table === tabela && c.method === 'update')
  const rpcChamado = (fn: string) =>
    chamadas.some(c => c.table === '__rpc__' && c.method === fn)

  it('remessa (CFOP 5117, sem duplicata, tPag 90 — caso SYAGRI real) soma estoque e NAO cria lançamento', async () => {
    await processarNFe(nota({ items: [item({ cfop: '5117' })] }), 'webhook', 'fazenda-fake-id')

    expect(insertsEm('movimentacoes_estoque')).toHaveLength(1)
    expect(rpcChamado('incrementar_estoque')).toBe(true)
    expect(insertsEm('lancamentos_financeiros')).toHaveLength(0)
  })

  it('faturamento (CFOP 5922) cria lançamento e NAO soma estoque', async () => {
    await processarNFe(nota({ items: [item({ cfop: '5922' })] }), 'webhook', 'fazenda-fake-id')

    expect(insertsEm('lancamentos_financeiros')).toHaveLength(1)
    expect(insertsEm('movimentacoes_estoque')).toHaveLength(0)
    expect(rpcChamado('incrementar_estoque')).toBe(false)
  })

  it('bonificação (CFOP 5910) soma estoque, NAO cria lançamento e NAO grava preço médio', async () => {
    await processarNFe(
      nota({ items: [item({ cfop: '5910', unitValue: 5, totalValue: 2000 })] }),
      'webhook', 'fazenda-fake-id',
    )

    expect(insertsEm('movimentacoes_estoque')).toHaveLength(1)
    expect(rpcChamado('incrementar_estoque')).toBe(true)
    expect(insertsEm('lancamentos_financeiros')).toHaveLength(0)
    // custoZero: mesmo com preço unitário > 0, o preço médio do insumo não pode
    // ser mexido — bonificação não é compra (STJ, Súmula 457).
    const atualizouPrecoMedio = updatesEm('estoque')
      .some(u => u.payload && Object.prototype.hasOwnProperty.call(u.payload, 'preco_medio_unitario'))
    expect(atualizouPrecoMedio).toBe(false)
  })

  it('venda normal (CFOP 5102) continua fazendo tudo como antes — proteção contra regressão', async () => {
    await processarNFe(nota(), 'webhook', 'fazenda-fake-id')

    expect(insertsEm('movimentacoes_estoque')).toHaveLength(1)
    expect(rpcChamado('incrementar_estoque')).toBe(true)
    const lancamentos = insertsEm('lancamentos_financeiros')
    expect(lancamentos).toHaveLength(1)
    expect(lancamentos[0].payload.valor).toBe(1060000)
    // O item estocável também grava o cfop (o outro dos dois pontos de
    // gravação) — sem isto, apagar `cfop: item.cfop || null` no insert
    // "estocável" de itens_nfe deixaria a suíte inteira verde.
    expect(insertsEm('itens_nfe')[0].payload.cfop).toBe('5102')
  })

  it('o item é gravado em itens_nfe em TODOS os casos, com o cfop — inclusive quando não entra no estoque', async () => {
    // CFOP 5922 (faturamento) não entra no estoque — passa pelo insert "não
    // estocado" de itens_nfe, o outro dos dois pontos que precisam do cfop.
    await processarNFe(nota({ items: [item({ cfop: '5922' })] }), 'webhook', 'fazenda-fake-id')

    const itens = insertsEm('itens_nfe')
    expect(itens).toHaveLength(1)
    expect(itens[0].payload.cfop).toBe('5922')
    // Insert "não estocado" — o outro dos dois pontos de gravação de
    // conta_como_compra. 5922 (faturamento) conta como compra, então
    // algumECompra é true e a regra do próprio item manda: true.
    expect(itens[0].payload.conta_como_compra).toBe(true)
  })

  it('P1 — ERCAL: CFOP 5116, tPag 15, ZERO duplicatas → NAO cria lançamento (tPag não prova cobrança)', async () => {
    // Amostra real: .tmp/notas-exemplo/...823981...-nfe.xml — CFOP 5116,
    // tPag=15 (boleto), zero <dup>, observação livre "NFe Mae:000080930".
    await processarNFe(
      nota({ items: [item({ cfop: '5116' })], duplicatas: [], formaPagamento: '15' }),
      'webhook', 'fazenda-fake-id',
    )

    expect(insertsEm('lancamentos_financeiros')).toHaveLength(0)
  })

  it('P1 — escape hatch: remessa (5117) COM duplicata cria lançamento pelo valor total (revenda que cobra na entrega)', async () => {
    await processarNFe(
      nota({
        items:      [item({ cfop: '5117' })],
        duplicatas: [{ numero: '001', vencimento: '2026-08-30', valor: 1060000 }],
      }),
      'webhook', 'fazenda-fake-id',
    )

    const lancamentos = insertsEm('lancamentos_financeiros')
    expect(lancamentos).toHaveLength(1)
    expect(lancamentos[0].payload.valor).toBe(1060000)
  })

  it('P4 — nota mista soma só os itens de compra, não o total da nota', async () => {
    await processarNFe(
      nota({
        items: [
          item({ description: 'ADUBO NORMAL', cfop: '5102', totalValue: 1000 }),
          item({ description: 'ADUBO BONIFICADO', cfop: '5910', totalValue: 200 }),
        ],
        valorTotal: 1200,
      }),
      'webhook', 'fazenda-fake-id',
    )

    const lancamentos = insertsEm('lancamentos_financeiros')
    expect(lancamentos).toHaveLength(1)
    expect(lancamentos[0].payload.valor).toBe(1000)

    // P3 — a mensagem do WhatsApp precisa contar os dois valores da nota mista:
    // quanto contou como gasto e quanto não contou (ramo "Só parte da nota").
    const mensagem = vi.mocked(enviarMensagem).mock.calls[0]?.[1] as string
    expect(mensagem).toContain('R$ 1.000,00')
    expect(mensagem).toContain('R$ 200,00')
  })

  it('P3 — nota que NAO virou gasto (remessa 5117, sem duplicata) avisa o motivo na mensagem do WhatsApp', async () => {
    await processarNFe(nota({ items: [item({ cfop: '5117' })] }), 'webhook', 'fazenda-fake-id')

    const mensagem = vi.mocked(enviarMensagem).mock.calls[0]?.[1] as string
    expect(mensagem).toContain('não entrou como gasto')
    expect(mensagem).toContain('entrega de pedido já faturado')
  })

  it('P3 — nota de compra normal NAO ganha a linha extra sobre gasto', async () => {
    await processarNFe(nota(), 'webhook', 'fazenda-fake-id')

    const mensagem = vi.mocked(enviarMensagem).mock.calls[0]?.[1] as string
    expect(mensagem).not.toContain('não entrou como gasto')
    expect(mensagem).not.toContain('virou gasto')
  })

  // Finding 1 (rodada de revisão) — bonificação não tem nota de faturamento
  // nenhuma em lugar nenhum: mandar o dono "avisar se ela não chegou" o
  // colocaria atrás de um documento que nunca vai existir. Essa frase só faz
  // sentido para a família 'entrega de pedido já faturado' (CFOP 5116/5117).
  it('P3 — bonificação avisa que não virou gasto mas NAO promete nota de faturamento', async () => {
    await processarNFe(
      nota({ items: [item({ cfop: '5910', unitValue: 5, totalValue: 2000 })] }),
      'webhook', 'fazenda-fake-id',
    )

    const mensagem = vi.mocked(enviarMensagem).mock.calls[0]?.[1] as string
    expect(mensagem).toContain('não entrou como gasto')
    expect(mensagem).toContain('bonificação (produto de graça)')
    expect(mensagem).not.toContain('nota de faturamento')
  })

  // Task 5 — armadilha achada pelo controlador (não estava no brief original):
  // linhaBoleto() checa `motivo` ANTES de olhar quantos boletos foram criados.
  // Se nfeProcessor.ts continuasse passando o motivoSemBoleto "cru" (sem saber
  // da duplicata), uma nota com tPag 90 + duplicata criaria um boleto de
  // verdade E a mensagem diria "Sem boleto" — o dono nunca ia conferir.
  it('tPag 90 COM duplicata: cria o boleto de verdade e a mensagem NAO diz "Sem boleto"', async () => {
    await processarNFe(
      nota({
        formaPagamento: '90',
        duplicatas: [{ numero: '001', vencimento: '2026-09-15', valor: 1060000 }],
      }),
      'webhook', 'fazenda-fake-id',
    )

    const upsertContas = chamadas.filter(c => c.table === 'contas_a_pagar' && c.method === 'upsert')
    expect(upsertContas).toHaveLength(1)

    const mensagem = vi.mocked(enviarMensagem).mock.calls[0]?.[1] as string
    expect(mensagem).not.toContain('Sem boleto')
    expect(mensagem).toContain('Boleto:')
  })
})

// ─── TASK 6.5 — a tela Financeiro precisa saber, POR ITEM, o que é gasto ────
//
// Tasks 1-5 consertaram o back-end: o CFOP já decide estoque e o valor do
// LANÇAMENTO financeiro (lancamentos_financeiros). Mas a tela Financeiro soma
// direto de itens_nfe, sem olhar CFOP nenhum — ela ficaria cega para sempre
// se não gravássemos, EM CADA ITEM, a mesma resposta que a escada do
// valorCompra já calcula. Esta suíte prova que `conta_como_compra` segue
// exatamente a mesma escada (algumECompra → regra do item; senão →
// temCobrancaReal), tanto na nota inteira quanto no misto item a item.
describe('processarNFe — conta_como_compra grava a MESMA resposta da escada do valorCompra', () => {
  beforeEach(() => {
    chamadas.length = 0
    estadoBanco.falharUpsertContas = false
    vi.mocked(enviarMensagem).mockClear()
  })

  function item(overrides: Partial<NFeItem> = {}): NFeItem {
    return {
      description:  'CLORETO DE POTASSIO',
      quantity:     400,
      unit:         'TO',
      unitValue:    2650,
      totalValue:   1060000,
      quantityTrib: 400,
      unitTrib:     'TO',
      ncm:          '31042000',
      cfop:         '5102',
      ...overrides,
    }
  }

  function nota(overrides: Partial<NFeData> = {}): NFeData {
    return {
      numero:         '8001',
      dataEmissao:    '2026-08-03T10:00:00-03:00',
      emitenteNome:   'SYAGRI INSUMOS LTDA',
      emitenteCnpj:   '33333333000199',
      valorTotal:     1060000,
      items:          [item()],
      duplicatas:     [],
      formaPagamento: '90',
      ...overrides,
    }
  }

  const insertsEm = (tabela: string) =>
    chamadas.filter(c => c.table === tabela && c.method === 'insert')

  it('compra normal (CFOP 5102) grava conta_como_compra = true', async () => {
    await processarNFe(nota(), 'webhook', 'fazenda-fake-id')

    const itens = insertsEm('itens_nfe')
    expect(itens).toHaveLength(1)
    expect(itens[0].payload.conta_como_compra).toBe(true)
  })

  it('remessa pura (CFOP 5117, sem duplicata) grava conta_como_compra = false', async () => {
    await processarNFe(nota({ items: [item({ cfop: '5117' })] }), 'webhook', 'fazenda-fake-id')

    const itens = insertsEm('itens_nfe')
    expect(itens).toHaveLength(1)
    expect(itens[0].payload.conta_como_compra).toBe(false)
  })

  it('nota mista (5102 + 5910): true para o item de compra, false para a bonificação', async () => {
    await processarNFe(
      nota({
        items: [
          item({ description: 'ADUBO NORMAL', cfop: '5102', totalValue: 1000 }),
          item({ description: 'ADUBO BONIFICADO', cfop: '5910', totalValue: 200, unitValue: 5 }),
        ],
        valorTotal: 1200,
      }),
      'webhook', 'fazenda-fake-id',
    )

    const itens = insertsEm('itens_nfe')
    expect(itens).toHaveLength(2)
    const compra       = itens.find(i => i.payload.descricao === 'ADUBO NORMAL')
    const bonificacao  = itens.find(i => i.payload.descricao === 'ADUBO BONIFICADO')
    expect(compra?.payload.conta_como_compra).toBe(true)
    expect(bonificacao?.payload.conta_como_compra).toBe(false)
  })

  it('remessa (5117) COM duplicata: escape hatch grava conta_como_compra = true (revenda que cobra na entrega)', async () => {
    await processarNFe(
      nota({
        items:      [item({ cfop: '5117' })],
        duplicatas: [{ numero: '001', vencimento: '2026-08-30', valor: 1060000 }],
      }),
      'webhook', 'fazenda-fake-id',
    )

    const itens = insertsEm('itens_nfe')
    expect(itens).toHaveLength(1)
    expect(itens[0].payload.conta_como_compra).toBe(true)
  })
})
