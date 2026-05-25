import cron from 'node-cron'
import { buscarNFesNoEmail } from './nfeEmail'
import { supabase } from '../services/supabase'
import { enviarMensagem } from '../services/zapi'

// ─── Consolidar e enviar confirmações pendentes de unidades comerciais ────────
async function enviarConfirmacoesPendentes(): Promise<void> {
  const agora = new Date().toISOString()

  const { data: pendentes, error } = await supabase
    .from('confirmacoes_pendentes')
    .select('*')
    .eq('enviado', false)
    .lte('enviar_apos', agora)

  if (error) {
    console.error('[Jobs] Erro ao buscar confirmações pendentes:', error.message)
    return
  }

  if (!pendentes || pendentes.length === 0) return

  // Agrupar por telefone
  const porTelefone = pendentes.reduce<Record<string, typeof pendentes>>((acc, item) => {
    if (!acc[item.telefone]) acc[item.telefone] = []
    acc[item.telefone].push(item)
    return acc
  }, {})

  for (const [telefone, itens] of Object.entries(porTelefone)) {
    // Ordenar por data de criação e atribuir ordem sequencial
    itens.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    const atualizacoes = itens.map((item, idx) => ({ id: item.id, ordem: idx + 1 }))

    // Salvar ordem antes de enviar (para mapear respostas posicionais depois)
    for (const { id, ordem } of atualizacoes) {
      await supabase.from('confirmacoes_pendentes').update({ ordem }).eq('id', id)
    }

    // Montar mensagem consolidada
    const total = itens.length
    let msg = `📦 *${total} ${total === 1 ? 'item precisa' : 'itens precisam'} de confirmação*\n\n`

    for (let i = 0; i < itens.length; i++) {
      const item    = itens[i]
      const payload = item.payload as any
      const ordem   = i + 1

      msg += `${ordem}) ${payload.insumo_nome} — ${payload.emitente_nome}\n`
      msg += `   ${payload.quantidade_comercial} ${payload.unidade_comercial} × R$ ${Number(payload.valor_unitario_comercial).toFixed(2)}\n`

      if (item.fator_sugerido) {
        msg += `   ✅ Detectamos: ${item.fator_sugerido} ${payload.unidade_base}/${payload.unidade_comercial}\n`
      } else {
        msg += `   Quantos ${payload.unidade_base} tem em 1 ${payload.unidade_comercial}?\n`
      }
      msg += '\n'
    }

    msg += `Responda em ordem, um por linha:\n`
    msg += itens.map((item, i) => item.fator_sugerido ? 'ok' : `[${i + 1}]`).join('\n')

    try {
      await enviarMensagem(telefone, msg)

      await supabase.from('confirmacoes_pendentes')
        .update({ enviado: true })
        .in('id', itens.map(i => i.id))

      console.log(`[Jobs] Confirmações enviadas para ${telefone}: ${total} item(s)`)
    } catch (err) {
      console.error(`[Jobs] Falha ao enviar confirmações para ${telefone}:`, err instanceof Error ? err.message : err)
    }
  }
}

export function iniciarJobs(): void {
  // A cada 30 minutos — buscar NF-es no e-mail
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Jobs] Buscando NF-es no e-mail...')
    await buscarNFesNoEmail()
  }, { timezone: 'America/Sao_Paulo' })

  // A cada 2 minutos — consolidar e enviar confirmações de unidades comerciais
  cron.schedule('*/2 * * * *', async () => {
    await enviarConfirmacoesPendentes()
  }, { timezone: 'America/Sao_Paulo' })

  console.log('[Jobs] Jobs agendados: NF-e e-mail (30min), confirmações (2min)')
}
