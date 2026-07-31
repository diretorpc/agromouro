import { describe, it, expect, vi, beforeEach } from 'vitest'

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
      rpc:  vi.fn(() => Promise.resolve({ data: null, error: null })),
    },
  }
})

vi.mock('./zapi', () => ({
  enviarMensagem: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(() => Promise.resolve({ content: [{ type: 'text', text: 'fertilizante_n' }] })) },
  })),
}))

import { parseXmlNFe, processarNFe, type NFeData } from './nfeProcessor'
import { enviarMensagem } from './zapi'

// Monta uma NF-e mínima. `extra` entra dentro de <infNFe>, depois dos itens.
function nfeXml(extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe>
  <ide><nNF>4516</nNF><dhEmi>2026-07-14T18:15:00-03:00</dhEmi></ide>
  <emit><xNome>TRIANGULO DIESEL TRR LTDA</xNome><CNPJ>12345678000199</CNPJ></emit>
  <det><prod><xProd>OLEO DIESEL S10</xProd><qCom>3000</qCom><uCom>L</uCom>
    <vUnCom>6.12</vUnCom><vProd>18360.00</vProd><NCM>27101259</NCM></prod></det>
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
    }],
    duplicatas:     [{ numero: '001', vencimento: '2026-08-30', valor: 5000 }],
    formaPagamento: '15',
  }

  beforeEach(() => {
    chamadas.length = 0
    estadoBanco.falharUpsertContas = true
    vi.mocked(enviarMensagem).mockClear()
  })

  it('boleto explodindo no banco nao impede itens, estoque, financeiro, status=processada e WhatsApp', async () => {
    const erroSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await processarNFe(nfeCompleta, 'webhook', 'fazenda-fake-id')

    expect(chamadas.some(c => c.table === 'itens_nfe' && c.method === 'insert')).toBe(true)
    expect(chamadas.some(c => c.table === 'movimentacoes_estoque' && c.method === 'insert')).toBe(true)
    expect(chamadas.some(c => c.table === 'lancamentos_financeiros' && c.method === 'insert')).toBe(true)

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
