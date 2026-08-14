import { supabase } from '../supabase'
import {
  contasDaNota, parcelasDescartadasDaNota, duplicataEhReal,
  motivoVencidoPelaDuplicata, observacaoDoBoletoContraOCodigo,
  type ContaDeNota, type DadosParaConta, type ParcelaDescartada,
} from './deNotaFiscal'

// O que gravarContasDaNota devolve: as contas que entraram no banco, e as
// parcelas que ficaram de fora (data malformada) apesar da nota, no geral,
// ter dado certo. Quem chama (nfeProcessor.ts) usa `descartadas` para nunca
// deixar essa perda silenciosa — vira aviso na mensagem do WhatsApp.
export type ResultadoGravacaoContas = {
  contas:      ContaDeNota[]
  descartadas: ParcelaDescartada[]
}

// Grava no banco os boletos de uma NF-e. Devolve o que foi criado.
//
// O índice único (nota_fiscal_id, numero_parcela) da migração 006 só cobre UM
// cenário de duplicidade: reprocessar o MESMO notaFiscalId (ex.: reprocessamento
// manual da mesma linha de notas_fiscais). Ele NÃO protege o cenário real deste
// projeto — as duas portas de entrada (Make e o job de 30 min) podem gerar duas
// linhas de notas_fiscais DIFERENTES para a mesma nota do fornecedor, cada uma
// com seu próprio notaFiscalId, e para esse índice as duas são notas distintas.
// Quem impede essa duplicata de verdade é a migração 005
// (idx_nfe_numero_emitente_fazenda, chave numero+emitente_cnpj+fazenda_id) —
// se ela barrar a segunda linha em notas_fiscais, esta função nunca chega a
// rodar para a nota repetida.
export async function gravarContasDaNota(
  nfe: DadosParaConta,
  notaFiscalId: string,
  fazendaId: string,
): Promise<ResultadoGravacaoContas> {
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

  // Refaz o mesmo cálculo (função pura, sem estado) só para achar as parcelas que
  // NÃO entraram em `contas` acima — uma nota que, no geral, deu certo ainda pode
  // ter perdido 1 parcela no meio. Só chega a quem chama se o upsert abaixo NÃO
  // lançar: se o banco falhar, a função inteira estoura e nfeProcessor.ts cai no
  // aviso genérico de erro (que já manda o dono conferir em /contas por outro
  // motivo) — não há double-report da mesma parcela nesse caso.
  const descartadas = parcelasDescartadasDaNota(nfe)

  if (contas.length === 0) return { contas: [], descartadas }

  // Calculado AQUI a partir do mesmo `nfe`, em vez de recebido por parâmetro: a
  // função pura é a única fonte da resposta, então esta gravação nunca pode
  // divergir do que o WhatsApp diz sobre a mesma nota. Null no caso comum — a
  // coluna `observacao` fica como sempre esteve.
  const observacao = observacaoDoBoletoContraOCodigo(
    motivoVencidoPelaDuplicata(nfe.formaPagamento, nfe.duplicatas.some(duplicataEhReal)),
  )

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
    observacao,
    fazenda_id:     fazendaId,
  }))

  const { data, error } = await supabase
    .from('contas_a_pagar')
    .upsert(linhas, { onConflict: 'nota_fiscal_id,numero_parcela', ignoreDuplicates: true })
    .select('id')

  // PostgrestError estende Error, então quem loga só com `err.message` perde
  // `code`, `details` e `hint` — e a mensagem crua de um erro de banco (ex.:
  // 42703, coluna inexistente) não diz de qual nota nem de qual fornecedor.
  // Mesmo padrão do erro de competência acima: reembrulhar com contexto antes
  // de deixar subir, para o log de isolamento em nfeProcessor.ts ser rastreável.
  if (error) {
    throw new Error(
      `NF ${nfe.numero} (${nfe.emitenteNome}): falha ao gravar boleto no banco — ${error.message} (code: ${error.code})`,
    )
  }

  // Quando o upsert ignora duplicata, `data` volta menor que `linhas`.
  // Devolvemos o que a REGRA decidiu, não o que o banco aceitou: quem chama
  // usa isto para escrever a mensagem, e a mensagem deve descrever a nota.
  console.log(`[Contas] NF ${nfe.numero}: ${contas.length} boleto(s) previsto(s), ${data?.length ?? 0} gravado(s).`)
  return { contas, descartadas }
}
