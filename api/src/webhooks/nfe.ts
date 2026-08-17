import { Router } from 'express'
import { processarNFe, nfeJaProcessada, type NFeData } from '../services/nfeProcessor'
import { supabase } from '../services/supabase'

export const nfeWebhook = Router()

// ─── Webhook NFE.io (legado — mantido caso futuramente tenha CNPJ) ───────────
nfeWebhook.post('/', async (req, res) => {
  res.status(200).json({ ok: true }) // Responder 200 imediatamente

  const payload = req.body

  try {
    // Identificar fazenda pelo query param; fallback para env var ou 'mg'
    const fazendaCodigo = (req.query.fazenda as string) ?? process.env.FAZENDA_CODIGO ?? 'mg'
    const { data: fazenda } = await supabase
      .from('fazendas')
      .select('id, codigo')
      .eq('codigo', fazendaCodigo)
      .single()

    if (!fazenda) {
      console.error(`[NFeWebhook] Fazenda não encontrada: ${fazendaCodigo}`)
      return
    }

    const {
      number:     numero,
      issuedOn:   dataEmissao,
      issuerName: emitenteNome,
      issuerCnpj: issuerCnpjRaw,
      grandTotal: valorTotal,
      items = [],
    } = payload

    // req.body é livre (Express não tipa webhook externo) — sem esta coerção,
    // um payload sem issuerCnpj gera emitente_cnpj nulo. Índice único comum trata
    // cada NULL como distinto: duas notas de mesmo número passariam pela trava.
    // Mesmo comportamento do caminho de e-mail (parseXmlNFe usa CNPJ ?? CPF ?? '').
    const emitenteCnpj = String(issuerCnpjRaw ?? '')

    // NFE.io é só nota de produto — nunca lê NFS-e, então 'nfe' é fixo aqui.
    const modelo: 'nfe' = 'nfe'

    if (await nfeJaProcessada(numero, emitenteCnpj, fazenda.id, modelo)) {
      console.log(`[NFeWebhook] NF-e ${numero} já processada — ignorando.`)
      return
    }

    const nfe: NFeData = {
      numero,
      dataEmissao,
      emitenteNome,
      emitenteCnpj,
      valorTotal,
      items: (items as any[]).slice(0, 200).map((item: any) => ({
        description:  item.description || '',
        quantity:     item.quantity,
        unit:         item.unit,
        unitValue:    item.unitValue,
        totalValue:   item.totalValue,
        quantityTrib: item.quantityTrib ?? item.quantity,
        unitTrib:     item.unitTrib     ?? item.unit,
        ncm:          String(item.ncm ?? '').replace(/\D/g, ''),
        // Payload do NFE.io não traz CFOP — assume compra normal (vazio).
        // Task 2 (efeitoDoCfop) trata string vazia como compra normal.
        cfop:         String(item.cfop ?? '').replace(/\D/g, ''),
      })),
      // Payload do NFE.io não traz quadro de cobrança nem forma de pagamento
      // (é JSON próprio do serviço, não o XML da SEFAZ que parseXmlNFe lê).
      duplicatas:     [],
      formaPagamento: null,
      modelo,
    }

    await processarNFe(nfe, 'webhook', fazenda.id)

  } catch (err) {
    console.error('[NFeWebhook] Erro:', err instanceof Error ? err.message : err)
  }
})
