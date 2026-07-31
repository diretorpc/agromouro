import { describe, it, expect } from 'vitest'
import { parseXmlNFe } from './nfeProcessor'

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
