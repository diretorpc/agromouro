import { supabase } from '../services/supabase'
import { enviarMensagem, getAuthorizedPhones } from '../services/zapi'
import { sincronizarOcorrencias } from '../services/contas/sincronizar'
import { montarResumo, resumoVazio, textoResumo, type ContaResumo } from '../services/contas/resumo'
import { hojeSaoPauloISO } from '../services/contas/formato'

export async function rodarContasDoDia(): Promise<void> {
  const hoje = hojeSaoPauloISO()

  const { data: fazendas, error } = await supabase.from('fazendas').select('id, nome, codigo')
  if (error) { console.error('[Contas] Erro ao listar fazendas:', error.message); return }

  for (const fazenda of fazendas ?? []) {
    try {
      const criadas = await sincronizarOcorrencias(fazenda.id, hoje)
      if (criadas > 0) console.log(`[Contas] ${fazenda.nome}: ${criadas} ocorrência(s) criada(s).`)

      const { data: contas, error: erroContas } = await supabase
        .from('contas_a_pagar')
        .select('descricao, fornecedor, vencimento, valor, status, created_at, contas_recorrentes(avisar_dias_antes)')
        .eq('fazenda_id', fazenda.id)
        .in('status', ['aguardando', 'aberta'])

      // Sem esta checagem, banco com problema devolve lista vazia e o job
      // conclui "nada a avisar hoje" — falha de banco vira silêncio idêntico
      // ao dia em que realmente não há nada. Justo o contrário do que queremos.
      if (erroContas) throw erroContas

      const paraResumo: ContaResumo[] = (contas ?? []).map((c: any) => ({
        descricao:         c.descricao,
        fornecedor:        c.fornecedor,
        vencimento:        c.vencimento,
        valor:             c.valor,
        status:            c.status,
        avisar_dias_antes: c.contas_recorrentes?.avisar_dias_antes ?? 3,
        // created_at vem como timestamp completo; o escalonamento só quer o dia.
        criada_em:         String(c.created_at ?? '').slice(0, 10),
      }))

      const resumo = montarResumo(paraResumo, hoje)
      if (resumoVazio(resumo)) {
        console.log(`[Contas] ${fazenda.nome}: nada a avisar hoje.`)
        continue
      }

      const titulo = `Contas — ${hoje}`

      // Um alerta por fazenda por dia. Se a tarefa rodar de novo, não duplica.
      const { data: existente, error: erroExistente } = await supabase
        .from('alertas')
        .select('id')
        .eq('fazenda_id', fazenda.id)
        .eq('titulo', titulo)
        .maybeSingle()

      if (erroExistente) throw erroExistente
      if (existente) { console.log(`[Contas] ${fazenda.nome}: aviso de hoje já existe.`); continue }

      const mensagem = textoResumo(resumo, hoje)
      const nivel    = (resumo.atrasadas.length > 0 || resumo.semVencimentoAntigas.length > 0)
        ? 'critico'
        : 'aviso'

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
          // enviarMensagem devolve false quando a Z-API RECUSA (ex.: celular
          // desconectado da instância). Sem ler esse retorno, o painel diria
          // "avisei no WhatsApp" para mensagem que nunca chegou.
          const ok = await enviarMensagem(phone, mensagem, fazenda.codigo)
          if (ok) enviou = true
          else console.error(`[Contas] Z-API recusou o envio para ${phone}.`)
        } catch (err) {
          console.error(`[Contas] Falha ao enviar para ${phone}:`, err instanceof Error ? err.message : err)
        }
      }

      if (enviou) {
        const { error: erroFlag } = await supabase
          .from('alertas').update({ enviado_whatsapp: true }).eq('id', alerta.id)
        if (erroFlag) console.error(`[Contas] Não consegui marcar o alerta como enviado:`, erroFlag.message)
      }
    } catch (err) {
      console.error(`[Contas] Erro em ${fazenda.nome}:`, err instanceof Error ? err.message : err)
      // segue para a próxima fazenda
    }
  }
}
