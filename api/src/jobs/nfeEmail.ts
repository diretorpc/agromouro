import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { parseXmlNFe, nfeJaProcessada, processarNFe } from '../services/nfeProcessor'
import { supabase } from '../services/supabase'

// ─── Verificar se o XML é uma NF-e válida ────────────────────────────────────
function isNFeXml(content: string): boolean {
  return content.includes('<NFe') && content.includes('<infNFe')
}

// ─── Buscar e processar NF-es no e-mail ──────────────────────────────────────
export async function buscarNFesNoEmail(): Promise<void> {
  const user = process.env.IMAP_USER
  const pass = process.env.IMAP_PASS

  if (!user || !pass) {
    console.warn('[NFeEmail] IMAP_USER ou IMAP_PASS não configurados — pulando.')
    return
  }

  const client = new ImapFlow({
    host:   'outlook.office365.com',
    port:   993,
    secure: true,
    auth:   { user, pass },
    logger: false,
  })

  // Resolver fazenda padrão (IMAP job não tem query param — usa env var ou 'mg')
  const fazendaCodigo = process.env.FAZENDA_CODIGO ?? 'mg'
  const { data: fazenda } = await supabase
    .from('fazendas')
    .select('id, codigo')
    .eq('codigo', fazendaCodigo)
    .single()

  if (!fazenda) {
    console.error(`[NFeEmail] Fazenda não encontrada: ${fazendaCodigo}`)
    return
  }

  try {
    await client.connect()
    console.log('[NFeEmail] Conectado ao Hotmail.')

    const lock = await client.getMailboxLock('INBOX')

    try {
      // Busca e-mails não lidos
      const searchResult = await client.search({ seen: false })
      const uids = searchResult || []

      if (uids.length === 0) {
        console.log('[NFeEmail] Nenhum e-mail novo.')
        return
      }

      console.log(`[NFeEmail] ${uids.length} e-mail(s) não lido(s). Verificando anexos XML...`)

      for (const uid of uids) {
        try {
          // Baixar e-mail completo
          const msg = await client.fetchOne(String(uid), { source: true })
          if (!msg || !('source' in msg) || !msg.source) continue

          const parsed = await simpleParser(msg.source)
          const anexos = parsed.attachments ?? []

          // Filtrar apenas anexos .xml
          const xmlAnexos = anexos.filter(a =>
            a.filename?.toLowerCase().endsWith('.xml') ||
            a.contentType?.includes('xml')
          )

          if (xmlAnexos.length === 0) continue

          for (const anexo of xmlAnexos) {
            const xmlStr = anexo.content.toString('utf-8')

            if (!isNFeXml(xmlStr)) continue

            const nfe = parseXmlNFe(xmlStr)
            if (!nfe) {
              console.warn(`[NFeEmail] XML inválido no e-mail ${uid}: "${anexo.filename}"`)
              continue
            }

            // Evitar duplicatas
            const jaExiste = await nfeJaProcessada(nfe.numero, fazenda.id)
            if (jaExiste) {
              console.log(`[NFeEmail] NF-e ${nfe.numero} já processada — ignorando.`)
              continue
            }

            console.log(`[NFeEmail] Processando NF-e ${nfe.numero} de ${nfe.emitenteNome}...`)
            await processarNFe(nfe, 'email', fazenda.id)
            console.log(`[NFeEmail] NF-e ${nfe.numero} processada com sucesso.`)
          }

          // Marcar e-mail como lido independente de ter NF-e
          // (evita reprocessar e-mails sem XML a cada ciclo)
          await client.messageFlagsAdd(String(uid), ['\\Seen'])

        } catch (errMsg) {
          console.error(`[NFeEmail] Erro ao processar e-mail ${uid}:`, errMsg instanceof Error ? errMsg.message : errMsg)
          // Continua para o próximo e-mail
        }
      }

    } finally {
      lock.release()
    }

  } catch (errConn) {
    console.error('[NFeEmail] Erro de conexão IMAP:', errConn instanceof Error ? errConn.message : errConn)
  } finally {
    await client.logout().catch(() => {})
  }
}
