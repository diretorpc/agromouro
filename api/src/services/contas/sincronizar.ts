import { supabase } from '../supabase'
import { somarMeses } from './datas'
import { ocorrenciasEsperadas, ocorrenciasFaltantes, type Regra } from './ocorrencias'
import { estimativaDaOcorrencia } from './estimativa'

// Janela de antecipação: cria as ocorrências dos próximos ~45 dias (2 meses).
const MESES_A_FRENTE = 2

// Cria no banco as ocorrências que deveriam existir e ainda não existem.
// Idempotente: rodar duas vezes no mesmo dia não duplica (índice único no banco).
export async function sincronizarOcorrencias(fazendaId: string, hojeISO: string): Promise<number> {
  const [ano, mes] = hojeISO.split('-').map(Number)
  const de  = { ano, mes }
  const ate = somarMeses(de, MESES_A_FRENTE)

  const { data: regras, error: erroRegras } = await supabase
    .from('contas_recorrentes')
    .select('id, descricao, fornecedor, categoria, periodicidade, dia_vencimento, mes_primeira, valor_referencia, ativa')
    .eq('fazenda_id', fazendaId)
    .eq('ativa', true)

  if (erroRegras) throw erroRegras
  if (!regras?.length) return 0

  const { data: existentes, error: erroExistentes } = await supabase
    .from('contas_a_pagar')
    .select('recorrente_id, competencia')
    .eq('fazenda_id', fazendaId)
    .not('recorrente_id', 'is', null)

  if (erroExistentes) throw erroExistentes

  const novas: any[] = []

  for (const regra of regras) {
    // Uma regra com dado inconsistente (ex.: anual sem mes_primeira) estoura
    // de propósito lá no gerador. Aqui ela é isolada: registra e segue para a
    // próxima. Uma conta com defeito não pode calar o aviso de todas as outras.
    let esperadas
    try {
      esperadas = ocorrenciasEsperadas(regra as unknown as Regra, de, ate)
    } catch (err) {
      console.error(
        `[Contas] Regra ignorada — ${regra.descricao} (${regra.id}):`,
        err instanceof Error ? err.message : err,
      )
      continue
    }

    const faltam = ocorrenciasFaltantes(esperadas, existentes ?? [])
    if (!faltam.length) continue

    // Valor da estimativa: o último valor realmente pago dessa regra.
    // Se nunca foi paga, cai no valor de referência do cadastro.
    const { data: ultimaPaga, error: erroUltimaPaga } = await supabase
      .from('contas_a_pagar')
      .select('valor_pago')
      .eq('recorrente_id', regra.id)
      .eq('status', 'paga')
      .order('competencia', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Erro de banco aqui NÃO pode virar "nunca foi paga" — isso trocaria o
    // valor real por uma estimativa velha sem ninguém perceber. Banco com
    // problema é falha de verdade: estoura e o job registra.
    if (erroUltimaPaga) throw erroUltimaPaga

    const estimativa = estimativaDaOcorrencia(
      ultimaPaga?.valor_pago ?? null,
      regra.valor_referencia ?? null,
    )

    for (const o of faltam) {
      novas.push({
        recorrente_id:  o.recorrente_id,
        competencia:    o.competencia,
        vencimento:     o.vencimento,
        descricao:      regra.descricao,
        fornecedor:     regra.fornecedor,
        categoria:      regra.categoria,
        valor:          estimativa,
        valor_estimado: true,
        status:         'aguardando',
        fazenda_id:     fazendaId,
      })
    }
  }

  if (!novas.length) return 0

  // ignoreDuplicates: se duas execuções cruzarem, o índice único resolve sem estourar erro.
  const { data, error } = await supabase
    .from('contas_a_pagar')
    .upsert(novas, { onConflict: 'recorrente_id,competencia', ignoreDuplicates: true })
    .select('id')

  if (error) throw error
  return data?.length ?? 0
}
