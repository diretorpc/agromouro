import { somarMeses, vencimentoDoMes, competenciaDoMes } from './datas'

export type EntradaParcelamento = {
  descricao:  string
  fornecedor: string | null
  categoria:  string | null
  vencimento: string   // 'YYYY-MM-DD' — vencimento da 1ª parcela
  valor:      number
  parcelas:   number   // >= 2 — validado pelo Zod na rota, não aqui
}

export type DadosParcela = {
  descricao:      string
  fornecedor:     string | null
  categoria:      string | null
  vencimento:     string
  valor:          number
  competencia:    string
  valor_estimado: boolean
  status:         string
}

// Gera as N linhas de uma compra parcelada — mesma descrição sufixada
// "(i/N)", mesmo valor em todas (não divide, decisão do Matheus), vencimento
// um mês depois do anterior, no mesmo dia (cai no último dia do mês quando o
// dia não existe — mesma regra que "Nova conta fixa" já usa).
export function montarParcelas(entrada: EntradaParcelamento): DadosParcela[] {
  const [anoBase, mesBase, dia] = entrada.vencimento.split('-').map(Number)

  const parcelas: DadosParcela[] = []
  for (let i = 0; i < entrada.parcelas; i++) {
    const { ano, mes } = somarMeses({ ano: anoBase, mes: mesBase }, i)
    const vencimento = vencimentoDoMes(ano, mes, dia)
    parcelas.push({
      descricao:      `${entrada.descricao} (${i + 1}/${entrada.parcelas})`,
      fornecedor:     entrada.fornecedor,
      categoria:      entrada.categoria,
      vencimento,
      valor:          entrada.valor,
      competencia:    competenciaDoMes(ano, mes),
      valor_estimado: false,
      status:         'aberta',
    })
  }
  return parcelas
}
