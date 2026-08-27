import { Router } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { importarXmlManual, excluirNotaManual } from '../services/nfeManual'
import { supabase } from '../services/supabase'
import { lerNotaPdf, validarNotaLida, type ValidacaoNota } from '../services/nfe/notaPdf'
import { gravarNotaDoPdf } from '../services/nfe/gravarNotaDoPdf'
import { nfeJaProcessada } from '../services/nfeProcessor'
import { hojeSaoPauloISO } from '../services/contas/formato'
import { FAMILIAS_ITEM, familiaDoCfop } from '../services/contas/cfop'

export const nfeRoutes = Router()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Bucket privado onde o PDF da nota fica — ver o cabeçalho da migration 013.
// Mesmo nome usado em services/nfe/gravarNotaDoPdf.ts.
const BUCKET = 'notas-pdf'

const importarSchema = z.object({
  xml: z.string().min(50),
})

const lerPdfSchema = z.object({
  arquivo:     z.string().min(1),
  nomeArquivo: z.string().min(1),
})

const importarPdfSchema = lerPdfSchema.extend({
  // A nota volta com a MESMA forma que a leitura devolveu, possivelmente
  // editada na tela. O zod garante só o envelope; quem decide se o conteúdo
  // presta é validarNotaLida — a mesma função do passo 1, para não existirem
  // duas réguas diferentes para a mesma nota.
  nota: z.record(z.unknown()),
})

// ACHADO 6 (revisão do Apolo, 05/08/2026): a fazenda vem do usuário
// autenticado, nunca do corpo do pedido. A API usa a chave de serviço do
// Supabase, que desliga o RLS (a regra do banco que isola fazenda) — sem
// esta checagem, um fazenda_id errado no corpo gravaria ou apagaria nota
// na fazenda errada. Mesmo padrão de api/src/routes/contas.ts e cartoes.ts.
function fazendaDe(req: any): string | undefined {
  return req.user?.app_metadata?.fazenda_ativa_id as string | undefined
}

// POST /nfe/importar-xml — upload manual de XML pela tela, processado pelo
// mesmo caminho do e-mail automático (CFOP, estoque, boleto, WhatsApp).
// 'criada' e 'duplicada' voltam como 200: as duas são respostas válidas do
// pedido, não erro de requisição. Só XML inválido (422) e falha de
// processamento (500) viram erro HTTP de verdade.
nfeRoutes.post('/importar-xml', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = importarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const resultado = await importarXmlManual(parsed.data.xml, fazendaId)

    if (resultado.status === 'invalida') {
      res.status(422).json({ error: 'Arquivo XML inválido ou formato não reconhecido.' })
      return
    }
    if (resultado.status === 'erro') {
      res.status(500).json({ error: 'Erro ao processar a nota fiscal.', detalhe: resultado.mensagem })
      return
    }

    res.status(200).json(resultado)
  } catch (err) {
    next(err)
  }
})

// DELETE /nfe/:id — apaga a nota e desfaz o que ela criou (estoque e boleto),
// numa transação só (migration 009_excluir_nota_fiscal.sql).
nfeRoutes.delete('/:id', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  try {
    const resultado = await excluirNotaManual(req.params.id, fazendaId)

    switch (resultado.status) {
      case 'excluida':
        res.status(204).send()
        return
      case 'nao_encontrada':
        res.status(404).json({ error: 'Nota não encontrada.' })
        return
      case 'em_processamento':
        res.status(409).json({ error: 'Esta nota está sendo processada agora pelo e-mail automático. Tente excluir de novo em alguns segundos.' })
        return
      case 'boleto_pago':
        res.status(409).json({ error: 'Esta nota tem um boleto já marcado como pago. Desmarque o pagamento em Contas a Pagar antes de excluir.' })
        return
      case 'erro':
        res.status(500).json({ error: 'Erro ao excluir a nota.', detalhe: resultado.mensagem })
        return
    }
  } catch (err) {
    next(err)
  }
})

// ─── Nota em PDF (DANFE / NFS-e) ────────────────────────────────────────────
// Dois passos: `ler-pdf` NÃO grava nada (a IA pode ter lido errado, e o dono
// confere antes); `importar-pdf` grava o que ele confirmou. O arquivo fica no
// navegador entre os dois — desistir na conferência não deixa órfão no bucket.

type RecusaDeLeitura = ValidacaoNota | { status: 'nao-nota' } | { status: 'grande-demais' }

// Traduz a recusa para uma frase que o produtor entende. Sem o campo `error`,
// web/lib/api.ts mostra "API error: 422" e o motivo real nunca chega na tela.
function recusaEmPortugues(r: RecusaDeLeitura): string {
  switch (r.status) {
    case 'nao-nota':       return 'Este arquivo não parece ser uma nota fiscal.'
    case 'grande-demais':  return 'Arquivo grande demais (máximo 10 MB).'
    case 'sem-identidade': return 'Não consegui identificar o número da nota ou o CNPJ do fornecedor.'
    case 'sem-itens':      return 'Não consegui ler nenhum item desta nota.'
    case 'dados-invalidos':
      return r.campo === 'dataEmissao'
        ? 'Não consegui ler a data de emissão da nota.'
        : 'Não consegui ler o valor total da nota.'
    default:               return 'Não foi possível aproveitar este arquivo.'
  }
}

async function notaNoBanco(numero: string, cnpj: string, fazendaId: string, modelo: string) {
  const { data } = await supabase
    .from('notas_fiscais')
    .select('id, numero, data_emissao, emitente_nome')
    .eq('numero', numero)
    .eq('emitente_cnpj', cnpj)
    .eq('fazenda_id', fazendaId)
    .eq('modelo', modelo)
    .maybeSingle()
  return data as { id: string; numero: string; data_emissao: string; emitente_nome: string } | null
}

// POST /nfe/ler-pdf — passo 1. Lê o PDF com IA e devolve o que entendeu, mais
// os avisos de descarte e o alerta de nota já existente. NÃO GRAVA NADA.
// `jaExiste` é aviso para a tela, nunca trava: quem arbitra duplicidade de
// verdade é o índice único, no passo 2.
nfeRoutes.post('/ler-pdf', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = lerPdfSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const pdf = Buffer.from(parsed.data.arquivo, 'base64')
    const resultado = await lerNotaPdf(pdf, parsed.data.nomeArquivo, hojeSaoPauloISO(), anthropic)

    // 'falha' é INFRA (rede, sobrecarga, chave inválida, resposta truncada),
    // não defeito do arquivo — por isso 503 "tente de novo", nunca 422.
    if (resultado.status === 'falha') {
      res.status(503).json({
        error: 'O leitor de notas está indisponível agora. Tente de novo em alguns minutos.',
        motivo: resultado.motivo,
      })
      return
    }

    if (resultado.status !== 'nota') {
      res.status(422).json({ error: recusaEmPortugues(resultado), status: resultado.status })
      return
    }

    const { nota, itensDescartados, duplicatasDescartadas } = resultado

    let jaExiste = null as Awaited<ReturnType<typeof notaNoBanco>>
    if (await nfeJaProcessada(nota.numero, nota.emitenteCnpj, fazendaId, nota.modelo)) {
      jaExiste = (await notaNoBanco(nota.numero, nota.emitenteCnpj, fazendaId, nota.modelo))
        ?? { id: '', numero: nota.numero, data_emissao: '', emitente_nome: nota.emitenteNome }
    }

    // Achado 6 do Apolo (24/08/2026): errar o `modelo` fura as DUAS travas de
    // uma vez. `modelo` faz parte da chave de duplicidade (migration 011), então
    // um DANFE classificado como 'nfse' não acha a nota que o Make gravou como
    // 'nfe' — nem na checagem acima, nem no índice único. A mesma nota entra
    // duas vezes, e a segunda entra SEM estoque (converterParaNFeData marca
    // servico:true em NFS-e), divergência que nenhuma tela mostra. Uma consulta
    // a mais, sem custo de IA, e a tela avisa em vez de deixar passar.
    const outroModelo = nota.modelo === 'nfe' ? 'nfse' : 'nfe'
    const noOutroModelo = await notaNoBanco(nota.numero, nota.emitenteCnpj, fazendaId, outroModelo)

    // As DUAS consultas, sempre, e o resultado entregue por modelo. Antes o
    // `existeNoOutroModelo` era curto-circuitado quando `jaExiste` estava
    // preenchido — os dois banners nunca coexistiam, e a tela ficava CEGA para
    // o gêmeo do outro modelo justo quando o dono ia mexer no campo "Tipo".
    // Achados [alto] do Apolo, 5ª rodada (27/08/2026): sem saber dos dois, a
    // tela travava a nota LEGÍTIMA do outro modelo (NF-e nº 500 de peças +
    // NFS-e nº 500 de mão de obra, o par que a migration 011 descreve no
    // cabeçalho) e deixava passar a duplicada de verdade.
    //
    // `jaExiste` e `existeNoOutroModelo` continuam no corpo, com o MESMO
    // significado de antes, porque web e API sobem separados: uma web mais
    // velha que esta API precisa continuar enxergando o aviso de duplicidade.
    const notasNoBanco = {
      nfe:  nota.modelo === 'nfe'  ? jaExiste : noOutroModelo,
      nfse: nota.modelo === 'nfse' ? jaExiste : noOutroModelo,
    }
    const existeNoOutroModelo = jaExiste ? null : noOutroModelo

    // A tela deixa o dono corrigir o EFEITO de cada item (Achado 2 do Apolo):
    // CFOP ilegível vira "compra" por omissão, e numa nota de entrega futura
    // isso dobra o gasto. A regra fiscal continua morando em contas/cfop.ts —
    // aqui a rota só entrega a lista pronta e diz em que família cada item caiu.
    const notaComFamilias = {
      ...nota,
      // CFOP vazio devolve família VAZIA de propósito, embora efeitoDoCfop('')
      // seja "compra": preencher aqui faria a tela mostrar "Compra normal" já
      // escolhido para um item que ninguém leu — escondendo justamente o caso
      // que o dono precisa decidir.
      //
      // `cfopLido` (achado [baixo] do Apolo, 3ª rodada, 24/08/2026): o CFOP tal
      // como a IA leu, congelado aqui — o mesmo padrão do `lidoOriginal` da
      // tela para número/CNPJ. Sem isto, um item sem CFOP em que o dono escolhe
      // "Compra normal" (grava 5102) imprimia "CFOP 5102" embaixo do select,
      // idêntico ao que teria sido lido de verdade — o dono não tinha como
      // distinguir leitura de escolha própria.
      itens: nota.itens.map(i => ({ ...i, familia: i.cfop ? familiaDoCfop(i.cfop) : '', cfopLido: i.cfop })),
    }

    res.status(200).json({
      status: 'nota', nota: notaComFamilias, itensDescartados, duplicatasDescartadas, jaExiste,
      existeNoOutroModelo, notasNoBanco, familias: FAMILIAS_ITEM,
    })
  } catch (err) {
    next(err)
  }
})

// POST /nfe/importar-pdf — passo 2. Grava a nota que o dono conferiu.
// 'duplicada-nota' e 'duplicada-arquivo' voltam como 200, mesmo padrão de
// /importar-xml: reenviar é resposta válida do pedido, não erro de requisição.
nfeRoutes.post('/importar-pdf', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = importarPdfSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  // O que volta do navegador é dado de fora, mesmo tendo saído daqui: passa
  // pela MESMA validação da leitura antes de encostar em banco ou Storage.
  const validada = validarNotaLida(parsed.data.nota, hojeSaoPauloISO())
  if (validada.status !== 'nota') {
    res.status(422).json({ error: recusaEmPortugues(validada), status: validada.status })
    return
  }

  // Descarte de LINHA no passo 2 não pode passar calado. Achado [médio] do
  // Apolo (27/08/2026): esta rota lia só `validada.nota` e jogava
  // `itensDescartados` fora — a nota gravava com 1 de 2 linhas, o painel
  // fechava e ninguém dizia nada. O banner âmbar da tela é alimentado pelo
  // passo 1 e nunca mais é reescrito.
  //
  // Recusar é o certo aqui, e não "avisar depois de gravar": o dono NÃO edita
  // quantidade, descrição nem valor na conferência (a tela só deixa mexer em
  // identidade, Tipo, efeito do CFOP e centro de custo). Então linha caindo no
  // passo 2 significa que a nota mudou de NATUREZA entre os dois passos — na
  // prática, o campo "Tipo" trocado de NFS-e para NF-e, que tira o direito da
  // quantidade inferida de existir (ver `quantidade: number | null` em
  // notaPdf.ts). Gravar metade da nota seria o pior dos dois mundos.
  if (validada.itensDescartados > 0) {
    res.status(422).json({
      error: `${validada.itensDescartados} item(ns) desta nota ficariam de fora do jeito que ela está agora — `
        + 'em nota de produto (NF-e) toda linha precisa de quantidade impressa. '
        + 'Confira o campo "Tipo" ou leia o PDF de novo.',
      status: 'itens-descartados-no-passo-2',
    })
    return
  }

  try {
    const pdf = Buffer.from(parsed.data.arquivo, 'base64')
    const resultado = await gravarNotaDoPdf(validada.nota, pdf, fazendaId)

    switch (resultado.status) {
      case 'gravada':
        res.status(201).json(resultado)
        return
      case 'duplicada-nota':
      case 'duplicada-arquivo':
        res.status(200).json(resultado)
        return
      case 'erro':
        res.status(500).json({ error: 'Erro ao gravar a nota.', detalhe: resultado.mensagem })
        return
    }
  } catch (err) {
    next(err)
  }
})

// GET /nfe/:id/arquivo — URL assinada de 60 s para o dono reabrir o papel.
// Passa pela API (chave de serviço) e não pelo cliente do navegador: o bucket
// é privado e não tem policy de Storage — o filtro de fazenda é esta consulta.
// Mesmo formato de GET /controle/documentos/:id/arquivo.
nfeRoutes.get('/:id/arquivo', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  try {
    const { data: nota } = await supabase
      .from('notas_fiscais')
      .select('id, arquivo_pdf')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (!nota?.arquivo_pdf) {
      res.status(404).json({ error: 'Esta nota não tem PDF guardado.' })
      return
    }

    const { data: assinado, error: errAssinado } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(nota.arquivo_pdf, 60)

    if (errAssinado || !assinado) {
      console.error('[NFe] Falha ao gerar signed URL:', errAssinado?.message)
      res.status(500).json({ error: 'Erro ao gerar o link do PDF.' })
      return
    }

    res.json({ url: assinado.signedUrl })
  } catch (err) {
    next(err)
  }
})
