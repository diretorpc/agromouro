import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import Anthropic from '@anthropic-ai/sdk'
import { parseXmlNFe, nfeJaProcessada, processarNFe, idDaNota } from '../services/nfeProcessor'
import { lerBoletoDoPdf, type BoletoLido } from '../services/contas/boletoPdf'
import { gravarBoletoDoPdf } from '../services/contas/gravarBoletoPdf'
import { hojeSaoPauloISO, reais, ddmm, APP_URL } from '../services/contas/formato'
import { enviarMensagem, getAuthorizedPhones } from '../services/zapi'
import { supabase } from '../services/supabase'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Quantos PDFs de um mesmo e-mail vale a pena mandar para a IA. Boleto de
// verdade não chega em lote: um e-mail com dezenas de PDFs é catálogo, folder
// ou assinatura de imagem. Sem o teto, cada um deles vira uma chamada paga.
const MAX_PDFS_POR_EMAIL = 5

// SEM filtro de remetente, por decisão explícita do Matheus (14/08/2026),
// perguntado e respondido: a caixa monitorada é PESSOAL (IMAP_USER é um
// hotmail), então TODO PDF de TODA mensagem não lida vai para a API da
// Anthropic — extrato de banco, boleto de escola, exame médico incluídos.
// Ele preferiu isso a arriscar perder um boleto de fornecedor que não estivesse
// numa lista. Não acrescente um filtro sem falar com ele; e se um dia a
// resposta mudar, o lugar é aqui: uma allowlist lida do ambiente, comparada
// contra `parsed.from`, antes do laço de PDFs.

// Evita duas execuções do job por cima uma da outra. Antes cada e-mail custava
// um parse local (milissegundos) e o ciclo de 30 min nunca se alcançava; agora
// custa uma chamada de IA por PDF, e uma caixa cheia pode passar da meia hora.
// Duas execuções simultâneas pagariam a leitura duas vezes e abririam a janela
// de corrida na gravação do boleto. Achado do Apolo.
let rodando = false

// ─── Verificar se o XML é uma NF-e válida ────────────────────────────────────
function isNFeXml(content: string): boolean {
  return content.includes('<NFe') && content.includes('<infNFe')
}

// Avisa que um boleto foi lido de um PDF. Diz de onde veio (PDF, não XML) e
// manda conferir: é leitura de imagem, não documento fiscal assinado. O envio é
// engolido em caso de falha — o boleto JÁ está no banco e aparece na tela com a
// tarja âmbar, então uma Z-API caída não pode derrubar o laço de e-mails.
async function avisarBoletoLido(boleto: BoletoLido, fazendaCodigo: string): Promise<void> {
  // Carnê ou nota parcelada: só a PRIMEIRA parcela virou conta. Sem esta linha
  // as outras venceriam sem nada no sistema — o silêncio exato que a feature
  // existe para acabar. Achado do Apolo.
  const parcelas = boleto.totalDeCobrancas > 1
    ? `\n\n⚠️ *Este documento tem ${boleto.totalDeCobrancas} parcelas* — registrei só a primeira. ` +
      `Lance as outras à mão em ${APP_URL}/contas`
    : ''

  const mensagem =
    `📎 *Boleto lido de um PDF*\n\n` +
    `${boleto.beneficiario}\n` +
    `${reais(boleto.valor)} — vence ${ddmm(boleto.vencimento)}\n\n` +
    `Veio sem XML, então li do papel. Confira valor e data antes de pagar: ${APP_URL}/contas` +
    parcelas

  for (const phone of getAuthorizedPhones(fazendaCodigo)) {
    try {
      await enviarMensagem(phone, mensagem, fazendaCodigo)
    } catch (err) {
      console.error('[BoletoPDF] Falha ao avisar no WhatsApp:', err instanceof Error ? err.message : err)
    }
  }
}

// ─── Buscar e processar NF-es no e-mail ──────────────────────────────────────
export async function buscarNFesNoEmail(): Promise<void> {
  if (rodando) {
    console.log('[NFeEmail] Ciclo anterior ainda rodando — pulando este.')
    return
  }
  rodando = true

  try {
    await rodarCiclo()
  } finally {
    // No finally: uma exceção que escape sem isto deixaria a trava presa e o
    // job morto para sempre, sem erro visível depois do primeiro.
    rodando = false
  }
}

async function rodarCiclo(): Promise<void> {
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
        // Alguma leitura de PDF falhou neste e-mail? Se sim, ele não vira lido.
        let houveFalha = false

        try {
          // Baixar e-mail completo
          const msg = await client.fetchOne(String(uid), { source: true })
          if (!msg || !('source' in msg) || !msg.source) continue

          const parsed = await simpleParser(msg.source)
          const anexos = parsed.attachments ?? []

          const xmlAnexos = anexos.filter(a =>
            a.filename?.toLowerCase().endsWith('.xml') ||
            a.contentType?.includes('xml')
          )

          const pdfAnexos = anexos.filter(a =>
            a.filename?.toLowerCase().endsWith('.pdf') ||
            a.contentType?.includes('pdf')
          )

          // E-mail sem anexo nenhum não entra em nenhum dos dois laços abaixo e
          // também NÃO é marcado como lido — ver o comentário do flag no fim.

          // Ids das notas deste e-mail (as que acabaram de entrar e as que já
          // estavam no banco). O boleto em PDF precisa saber se existe nota
          // aqui: amarrado a ela, pagar não duplica o gasto. Ver
          // contas/gravarBoletoPdf.ts.
          const notasDoEmail: string[] = []

          for (const anexo of xmlAnexos) {
            const xmlStr = anexo.content.toString('utf-8')

            if (!isNFeXml(xmlStr)) continue

            const nfe = parseXmlNFe(xmlStr)
            if (!nfe) {
              console.warn(`[NFeEmail] XML inválido no e-mail ${uid}: "${anexo.filename}"`)
              continue
            }

            // Evitar duplicatas
            const jaExiste = await nfeJaProcessada(nfe.numero, nfe.emitenteCnpj, fazenda.id)
            if (jaExiste) {
              console.log(`[NFeEmail] NF-e ${nfe.numero} já processada — ignorando.`)
              // Registrada mesmo assim: para o boleto em PDF, o que importa é
              // que a nota EXISTE (e já lançou o gasto), não se entrou agora.
              const id = await idDaNota(nfe.numero, nfe.emitenteCnpj, fazenda.id)
              if (id) notasDoEmail.push(id)
              continue
            }

            console.log(`[NFeEmail] Processando NF-e ${nfe.numero} de ${nfe.emitenteNome}...`)
            await processarNFe(nfe, 'email', fazenda.id)
            console.log(`[NFeEmail] NF-e ${nfe.numero} processada com sucesso.`)

            const id = await idDaNota(nfe.numero, nfe.emitenteCnpj, fazenda.id)
            if (id) notasDoEmail.push(id)
          }

          // ─── Boletos em PDF ──────────────────────────────────────────────
          // DEPOIS dos XMLs do mesmo e-mail, de propósito: o fornecedor costuma
          // mandar os dois juntos, e o XML é o documento de verdade. Processado
          // primeiro, o boleto dele já está no banco quando o PDF chega — e a
          // checagem de duplicata em gravarBoletoDoPdf() vê a conta e não repete.
          // Invertida a ordem, nasceriam duas contas para a mesma cobrança.
          // Com MAIS DE UMA nota no e-mail não dá para saber a qual delas o
          // boleto pertence, e chutar erraria o vínculo — mas todas já lançaram
          // gasto, então qualquer uma serve para impedir o lançamento dobrado.
          // Usa a primeira e diz isso no log, em vez de decidir calado.
          const notaParaBoleto = notasDoEmail[0] ?? null
          if (notasDoEmail.length > 1 && pdfAnexos.length > 0) {
            console.log(
              `[BoletoPDF] E-mail ${uid} tem ${notasDoEmail.length} notas; boleto será ` +
              `amarrado à primeira (evita gasto dobrado, mas o vínculo pode não ser o exato).`,
            )
          }

          // Teto por e-mail: sem ele, um e-mail com 30 PDFs de catálogo viram 30
          // chamadas de IA. Boleto de verdade não vem em lote grande.
          if (pdfAnexos.length > MAX_PDFS_POR_EMAIL) {
            console.log(`[BoletoPDF] E-mail ${uid} tem ${pdfAnexos.length} PDFs — lendo só os ${MAX_PDFS_POR_EMAIL} primeiros.`)
          }

          for (const anexo of pdfAnexos.slice(0, MAX_PDFS_POR_EMAIL)) {
            const nome = anexo.filename ?? 'anexo.pdf'
            const lido = await lerBoletoDoPdf(anexo.content, nome, hojeSaoPauloISO(), anthropic)

            // Falha ≠ "não é boleto". Marca o e-mail para NÃO virar lido, e ele
            // volta no ciclo de 30 min — a mesma rede que o caminho do XML tem.
            if (lido.status === 'falha') {
              console.warn(`[BoletoPDF] E-mail ${uid} volta no próximo ciclo: ${lido.motivo}`)
              houveFalha = true
              continue
            }

            if (lido.status === 'nao-boleto') continue

            const gravado = await gravarBoletoDoPdf(lido.boleto, nome, fazenda.id, notaParaBoleto)

            // Avisa SÓ quando a conta nasceu de verdade. Duplicata é o caminho
            // normal (XML e PDF no mesmo e-mail) e avisar dela seria barulho
            // diário; erro de banco já foi logado por quem gravou.
            if (gravado.status === 'criada') {
              await avisarBoletoLido(lido.boleto, fazenda.codigo)
            }
          }

          // Marcar como lido SÓ quando o e-mail tinha anexo que nos interessa e
          // nada falhou. Duas razões, ambas medidas:
          //  1. A caixa é PESSOAL (IMAP_USER é um hotmail). Marcar tudo como
          //     lido apagaria o aviso de não lido do celular do dono em e-mail
          //     de banco, escola, médico — dano fora do sistema.
          //  2. Falha de leitura sem esta guarda = boleto perdido para sempre:
          //     o e-mail nunca mais é reprocessado.
          const tinhaAnexoRelevante = xmlAnexos.length > 0 || pdfAnexos.length > 0
          if (tinhaAnexoRelevante && !houveFalha) {
            await client.messageFlagsAdd(String(uid), ['\\Seen'])
          }

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
