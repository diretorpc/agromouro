import { supabase } from '../supabase'
import { contasDaNota, type ContaDeNota, type DadosParaConta } from './deNotaFiscal'

// Grava no banco os boletos de uma NF-e. Devolve o que foi criado.
//
// Idempotente: rodar duas vezes para a mesma nota não duplica, porque o índice
// único (nota_fiscal_id, numero_parcela) arbitra o conflito.
export async function gravarContasDaNota(
  nfe: DadosParaConta,
  notaFiscalId: string,
  fazendaId: string,
): Promise<ContaDeNota[]> {
  // contasDaNota pode estourar quando a data de emissão (ou de uma parcela) vem
  // vazia/inválida — mas a mensagem original só cita a data, não a nota. Quem
  // chama esta função só vê o `err.message` no log (nfeProcessor engole o erro
  // por design, ver comentário lá), então sem número + fornecedor aqui, o dono
  // veria "data em formato inválido" sem saber qual nota causou.
  let contas: ContaDeNota[]
  try {
    contas = contasDaNota(nfe)
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err)
    throw new Error(`NF ${nfe.numero} (${nfe.emitenteNome}): ${motivo}`)
  }
  if (contas.length === 0) return []

  const linhas = contas.map(c => ({
    descricao:      c.descricao,
    fornecedor:     c.fornecedor,
    categoria:      'insumos',
    competencia:    c.competencia,
    vencimento:     c.vencimento,
    valor:          c.valor,
    // false: é o valor real do boleto, não estimativa de conta fixa.
    valor_estimado: false,
    // 'aberta' e nunca 'aguardando': a nota CHEGOU e o valor é real.
    // 'aguardando' significa "a conta ainda não chegou" — outra coisa.
    status:         'aberta',
    nota_fiscal_id: notaFiscalId,
    numero_parcela: c.numero_parcela,
    total_parcelas: c.total_parcelas,
    fazenda_id:     fazendaId,
  }))

  const { data, error } = await supabase
    .from('contas_a_pagar')
    .upsert(linhas, { onConflict: 'nota_fiscal_id,numero_parcela', ignoreDuplicates: true })
    .select('id')

  if (error) throw error

  // Quando o upsert ignora duplicata, `data` volta menor que `linhas`.
  // Devolvemos o que a REGRA decidiu, não o que o banco aceitou: quem chama
  // usa isto para escrever a mensagem, e a mensagem deve descrever a nota.
  console.log(`[Contas] NF ${nfe.numero}: ${contas.length} boleto(s) previsto(s), ${data?.length ?? 0} gravado(s).`)
  return contas
}
