import { supabase } from '../services/supabase'
import { enviarMensagem, getAuthorizedPhones } from '../services/zapi'
import { sincronizarOcorrencias } from '../services/contas/sincronizar'
import { montarResumo, resumoVazio, textoResumo, type ContaResumo } from '../services/contas/resumo'

// Data de hoje como 'YYYY-MM-DD' no fuso de São Paulo.
// NÃO usar toISOString(): ele devolve UTC e vira o dia seguinte depois das 21h.
function hojeSaoPauloISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export async function rodarContasDoDia(): Promise<void> {
  const hoje = hojeSaoPauloISO()

  const { data: fazendas, error } = await supabase.from('fazendas').select('id, nome, codigo')
  if (error) { console.error('[Contas] Erro ao listar fazendas:', error.message); return }

  for (const fazenda of fazendas ?? []) {
    try {
      const criadas = await sincronizarOcorrencias(fazenda.id, hoje)
      if (criadas > 0) console.log(`[Contas] ${fazenda.nome}: ${criadas} ocorrência(s) criada(s).`)

      const { data: contas } = await supabase
        .from('contas_a_pagar')
        .select('descricao, fornecedor, vencimento, valor, status, contas_recorrentes(avisar_dias_antes)')
        .eq('fazenda_id', fazenda.id)
        .in('status', ['aguardando', 'aberta'])

      const paraResumo: ContaResumo[] = (contas ?? []).map((c: any) => ({
        descricao:         c.descricao,
        fornecedor:        c.fornecedor,
        vencimento:        c.vencimento,
        valor:             c.valor,
        status:            c.status,
        avisar_dias_antes: c.contas_recorrentes?.avisar_dias_antes ?? 3,
      }))

      const resumo = montarResumo(paraResumo, hoje)
      if (resumoVazio(resumo)) {
        console.log(`[Contas] ${fazenda.nome}: nada a avisar hoje.`)
        continue
      }

      const titulo = `Contas — ${hoje}`

      // Um alerta por fazenda por dia. Se a tarefa rodar de novo, não duplica.
      const { data: existente } = await supabase
        .from('alertas')
        .select('id')
        .eq('fazenda_id', fazenda.id)
        .eq('titulo', titulo)
        .maybeSingle()

      if (existente) { console.log(`[Contas] ${fazenda.nome}: aviso de hoje já existe.`); continue }

      const mensagem = textoResumo(resumo, hoje)
      const nivel    = resumo.atrasadas.length > 0 ? 'critico' : 'aviso'

      // O alerta é gravado SEMPRE. O WhatsApp é o extra — se a instância Z-API
      // estiver desconectada, o envio falha calado e a informação não pode sumir junto.
      const { data: alerta, error: erroAlerta } = await supabase
        .from('alertas')
        .insert({
          tipo: 'contas_resumo', titulo, mensagem, nivel,
          lido: false, enviado_whatsapp: false, fazenda_id: fazenda.id,
        })
        .select('id')
        .single()

      if (erroAlerta) { console.error(`[Contas] ${fazenda.nome}: erro ao gravar alerta:`, erroAlerta.message); continue }

      const telefones = getAuthorizedPhones(fazenda.codigo)
      let enviou = false
      for (const phone of telefones) {
        try {
          await enviarMensagem(phone, mensagem, fazenda.codigo)
          enviou = true
        } catch (err) {
          console.error(`[Contas] Falha ao enviar para ${phone}:`, err instanceof Error ? err.message : err)
        }
      }

      if (enviou) {
        await supabase.from('alertas').update({ enviado_whatsapp: true }).eq('id', alerta.id)
      }
    } catch (err) {
      console.error(`[Contas] Erro em ${fazenda.nome}:`, err instanceof Error ? err.message : err)
      // segue para a próxima fazenda
    }
  }
}
