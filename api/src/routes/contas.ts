import { Router } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../services/supabase'
import { lerBoletoEProcurarNotas, gravarBoletoConfirmado } from '../services/contas/importarBoleto'
import { sugestaoParaPreSelecionar } from '../services/contas/casarNota'
import { hojeSaoPauloISO } from '../services/contas/formato'
import { sincronizarOcorrencias } from '../services/contas/sincronizar'
import { precisaCriarLancamento, montarLancamento } from '../services/contas/pagamento'
import { competenciaDoMes } from '../services/contas/datas'
import { montarParcelas } from '../services/contas/parcelamento'

export const contaRoutes = Router()

const ISO = /^\d{4}-\d{2}-\d{2}$/

// Conta paga ou dispensada nunca deve mudar de status por causa de uma edição de
// cadastro (ver PATCH /:id) — mesma regra que ENCERRADAS em web/app/(app)/contas/tipos.ts
// e services/contas/resumo.ts, repetida aqui de propósito: são times/arquivos
// diferentes, e um `import` cruzado front↔back não existe neste projeto.
const ENCERRADOS_PARA_EDICAO = new Set(['paga', 'dispensada'])

// Schema base separado do .refine(): ZodEffects (o tipo que .refine() devolve)
// não tem .partial() no zod 3.x — o PATCH abaixo precisa da forma "objeto puro"
// para aceitar edição parcial.
const recorrenteBase = z.object({
  descricao:         z.string().min(1),
  fornecedor:        z.string().min(1),
  categoria:         z.string().min(1),
  periodicidade:     z.enum(['mensal', 'bimestral', 'trimestral', 'semestral', 'anual']),
  dia_vencimento:    z.number().int().min(1).max(31),
  mes_primeira:      z.number().int().min(1).max(12).nullable().optional(),
  valor_referencia:  z.number().nonnegative().nullable().optional(),
  avisar_dias_antes: z.number().int().min(0).max(30).default(3),
  // Sem este campo aqui, o Zod DESCARTA `ativa` do corpo em silêncio (modo
  // "strip" é o padrão) e o banco aplica DEFAULT true. A caixinha "Ativa" do
  // formulário viraria enfeite: desmarcar não teria efeito nenhum, sem erro.
  ativa:             z.boolean().optional(),
})

const MSG_MES_PRIMEIRA = 'Conta que não é mensal precisa do mês da primeira ocorrência'

// Regra cruzada para o PATCH: vale sobre o resultado da fusão do que veio no
// corpo com o que já está gravado. Sem isso, trocar só a periodicidade para
// 'anual' bate no CHECK do banco e o usuário recebe "Erro interno do servidor"
// em vez de saber que faltou informar o mês.
function mesPrimeiraOk(periodicidade: string, mesPrimeira: number | null | undefined): boolean {
  return periodicidade === 'mensal' || mesPrimeira != null
}

const recorrenteSchema = recorrenteBase.refine(r => mesPrimeiraOk(r.periodicidade, r.mes_primeira), {
  message: MSG_MES_PRIMEIRA,
  path: ['mes_primeira'],
})

const avulsaSchema = z.object({
  descricao:  z.string().min(1),
  fornecedor: z.string().nullable().optional(),
  categoria:  z.string().nullable().optional(),
  vencimento: z.string().regex(ISO),
  valor:      z.number().nonnegative(),
  parcelas:   z.number().int().min(2).max(60).optional(),
})

const edicaoSchema = z.object({
  descricao:  z.string().min(1).optional(),
  fornecedor: z.string().nullable().optional(),
  valor:      z.number().nonnegative().optional(),
  vencimento: z.string().regex(ISO).optional(),
  categoria:  z.string().nullable().optional(),
  observacao: z.string().nullable().optional(),
})

const pagamentoSchema = z.object({
  data_pagamento: z.string().regex(ISO),
  valor_pago:     z.number().nonnegative(),
})

function fazendaDe(req: any): string | undefined {
  return req.user?.app_metadata?.fazenda_ativa_id as string | undefined
}

// ─── GET /contas ──────────────────────────────────────────────────────────────
contaRoutes.get('/', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .select('*, contas_recorrentes(avisar_dias_antes, periodicidade), notas_fiscais(numero)')
      .eq('fazenda_id', fazendaId)
      .order('vencimento', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) { next(err) }
})

// ─── Importar SÓ o boleto de uma nota que já está no sistema ──────────────────
//
// Nasceu do caso da nota 4507 (MIKAMI, 31/08/2026): a nota entrou em julho,
// quando o sistema ainda não puxava boleto, e a conta a pagar nunca existiu.
// Reimportar a nota duplicaria os itens. Ver `importarBoleto.ts` para o porquê
// de serem DUAS rotas e não uma.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const boletoUploadSchema = z.object({
  arquivo:     z.string().min(1),
  nomeArquivo: z.string().min(1),
})

// O boleto volta do navegador na confirmação. Este schema é só a forma; as
// travas de dinheiro (teto, janela de vencimento, data que existe) são
// reaplicadas no serviço por `validarBoletoLido` — a MESMA função da leitura,
// para as duas nunca divergirem.
const boletoConfirmadoSchema = z.object({
  nomeArquivo: z.string().min(1),
  notaFiscalId: z.string().uuid().nullable(),
  boleto: z.object({
    valor:            z.number(),
    vencimento:       z.string(),
    beneficiario:     z.string().min(1),
    cobradoPor:       z.string().nullable(),
    documento:        z.string().nullable(),
    totalDeCobrancas: z.number().int().min(1),
  }),
})

// POST /contas/boleto/ler — passo 1: lê e SUGERE. Não grava nada.
contaRoutes.post('/boleto/ler', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const parsed = boletoUploadSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Corpo inválido.' })

    const pdf = Buffer.from(parsed.data.arquivo, 'base64')
    const r = await lerBoletoEProcurarNotas(
      pdf, parsed.data.nomeArquivo, hojeSaoPauloISO(), fazendaId, anthropic,
    )

    // Mesma separação de `controle.ts`: conclusão sobre o CONTEÚDO vira 422,
    // problema de INFRA da chamada à IA vira 503 ("tente de novo"), e as duas
    // mandam `error` em português — sem esse campo o front cai no genérico
    // "API error: {status}" e a razão real nunca chega na tela.
    if (r.status === 'nao-boleto') {
      return res.status(422).json({ error: 'Este PDF não parece ser um boleto de cobrança.', ...r })
    }
    if (r.status === 'falha') {
      return res.status(503).json({ error: 'O leitor de boletos está indisponível agora. Tente de novo em alguns minutos.', ...r })
    }
    // Quem vem pré-marcado é decisão sobre dinheiro e sai do SERVIDOR, onde
    // tem teste (`casarNota.test.ts`). Antes a regra morava dentro do JSX e
    // pré-marcava a nota errada — achado 9 do Apolo.
    return res.json({ ...r, preSelecionar: sugestaoParaPreSelecionar(r.sugestoes) })
  } catch (err) { next(err) }
})

// POST /contas/boleto — passo 2: grava o que o dono confirmou.
contaRoutes.post('/boleto', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const parsed = boletoConfirmadoSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Corpo inválido.' })

    const r = await gravarBoletoConfirmado(
      {
        boleto: { ...parsed.data.boleto },
        nomeArquivo: parsed.data.nomeArquivo,
        notaFiscalId: parsed.data.notaFiscalId,
      },
      hojeSaoPauloISO(),
      fazendaId,
    )

    switch (r.status) {
      case 'criada':
        return res.status(201).json(r)
      // A conta já existia SOLTA e foi amarrada agora. Não é erro nem
      // duplicata: é o conserto do gasto que ia contar duas vezes.
      case 'adotada':
        return res.status(200).json(r)
      // Reenviar o mesmo boleto é resposta válida do pedido, não erro de
      // requisição — mesmo padrão de nfe.ts e controle.ts.
      case 'duplicada':
        return res.status(200).json(r)
      case 'boleto-invalido':
        return res.status(422).json({ error: 'Valor ou vencimento do boleto está fora do que o sistema aceita. Confira o papel.', ...r })
      case 'nota-invalida':
        return res.status(422).json({ error: 'A nota escolhida não existe nesta fazenda.', ...r })
      // A nota existe mas não lançou gasto no Financeiro (caso ERCAL: nota de
      // remessa, boleto cheio, gasto zero). Amarrar faria o dinheiro sair do
      // banco sem virar despesa em tela nenhuma.
      case 'nota-sem-gasto':
        return res.status(409).json({
          error: 'Esta nota não lançou gasto no Financeiro, então amarrar o boleto nela faria a despesa sumir. '
            + 'Importe sem nota — assim o pagamento vira despesa.',
          ...r,
        })
      // Mesmo valor E mesmo vencimento na MESMA nota: é o mesmo boleto, não
      // outra parcela. Parcela diferente passa e vira conta nova.
      case 'parcela-repetida':
        return res.status(409).json({
          error: 'Esta nota já tem uma conta com este mesmo valor e vencimento — é o mesmo boleto, já importado.',
          ...r,
        })
      // Existe conta com este valor e vencimento, mas em estado que não pode
      // ser amarrado. NÃO tranquiliza: manda conferir.
      case 'conta-encerrada':
        return res.status(409).json({
          error: `Já existe uma conta com este valor e vencimento, mas ela está ${r.statusConta} `
            + '— nada foi amarrado. Confira essa conta antes de importar de novo.',
          ...r,
        })
      case 'erro':
        return res.status(500).json({ error: 'Erro ao gravar o boleto.', detalhe: r.mensagem })
      // `never` obriga o compilador a reclamar quando alguém acrescentar um
      // status ao union (que é montado a partir de TRÊS arquivos) e esquecer
      // deste switch. Sem isto o handler terminava sem responder e o navegador
      // ficava pendurado — `web/lib/api.ts` não tem timeout. Achado 6 do Apolo.
      default: {
        const _exaustivo: never = r
        console.error('[Boleto] Status não tratado:', _exaustivo)
        return res.status(500).json({ error: 'Erro ao gravar o boleto.' })
      }
    }
  } catch (err) { next(err) }
})

// ─── GET /contas/recorrentes ──────────────────────────────────────────────────
contaRoutes.get('/recorrentes', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .select('*')
      .eq('fazenda_id', fazendaId)
      .order('descricao', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) { next(err) }
})

// ─── POST /contas/recorrentes ─────────────────────────────────────────────────
contaRoutes.post('/recorrentes', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = recorrenteSchema.parse(req.body)

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .insert({ ...body, fazenda_id: fazendaId })
      .select()
      .single()

    if (error) throw error

    // Já cria as ocorrências da janela para a conta aparecer na hora,
    // sem esperar a tarefa das 07:00 do dia seguinte.
    //
    // Falha aqui NÃO pode derrubar a requisição: a regra JÁ está salva. Se o
    // usuário recebesse erro, ele clicaria em Salvar de novo e nasceria uma
    // SEGUNDA regra idêntica — nada no banco impede isso — e daí todo mês
    // apareceriam duas contas iguais, para sempre.
    // Este módulo se apoia num princípio: a tarefa das 07:00 é idempotente e se
    // conserta sozinha. Um dia de atraso nas ocorrências é muito melhor que uma
    // regra duplicada, que só sai de lá com SQL na mão.
    try {
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      await sincronizarOcorrencias(fazendaId, hoje)
    } catch (erroSync) {
      console.error(
        `[Contas] Regra ${data?.id} salva, mas falhou ao criar as ocorrências agora. ` +
        'A tarefa das 07:00 cria na próxima execução.',
        erroSync,
      )
    }

    res.status(201).json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── PATCH /contas/recorrentes/:id ────────────────────────────────────────────
contaRoutes.patch('/recorrentes/:id', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = recorrenteBase.partial().parse(req.body)

    // Lê o estado atual para validar a regra cruzada sobre o resultado final.
    const { data: atual, error: erroAtual } = await supabase
      .from('contas_recorrentes')
      .select('periodicidade, mes_primeira')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (erroAtual) throw erroAtual
    if (!atual) return res.status(404).json({ error: 'Conta fixa não encontrada' })

    const periodicidadeFinal = body.periodicidade ?? atual.periodicidade
    const mesPrimeiraFinal   = body.mes_primeira !== undefined ? body.mes_primeira : atual.mes_primeira

    if (!mesPrimeiraOk(periodicidadeFinal, mesPrimeiraFinal)) {
      return res.status(400).json({ error: MSG_MES_PRIMEIRA })
    }

    const { data, error } = await supabase
      .from('contas_recorrentes')
      .update(body)
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta fixa não encontrada' })
    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /contas — conta avulsa (parcelada ou não) ───────────────────────────
contaRoutes.post('/', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = avulsaSchema.parse(req.body)
    const fornecedor = body.fornecedor ?? null
    const categoria  = body.categoria ?? null

    // Sem `parcelas`: uma linha só, comportamento idêntico ao de antes desta
    // mudança. Com `parcelas`: N linhas, um único insert atômico — ou todas
    // nascem juntas, ou nenhuma nasce (ver docs/superpowers/specs/2026-08-11-
    // contas-avulsa-parcelamento-design.md).
    const linhas = body.parcelas
      ? montarParcelas({
          descricao:  body.descricao,
          fornecedor,
          categoria,
          vencimento: body.vencimento,
          valor:      body.valor,
          parcelas:   body.parcelas,
        })
      : [{
          descricao:      body.descricao,
          fornecedor,
          categoria,
          vencimento:     body.vencimento,
          valor:          body.valor,
          competencia:    `${body.vencimento.slice(0, 7)}-01`,
          valor_estimado: false,
          status:         'aberta',
        }]

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .insert(linhas.map(l => ({ ...l, fazenda_id: fazendaId })))
      .select()

    if (error) throw error
    if (!data?.length) throw new Error('Falha ao criar conta: nenhuma linha retornada pelo insert')
    res.status(201).json(body.parcelas ? data : data?.[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── PATCH /contas/:id — registrar o valor real ───────────────────────────────
contaRoutes.patch('/:id', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = edicaoSchema.parse(req.body)

    // Busca o estado atual sempre — não só quando `vencimento` muda. O dialog de
    // edição completa (Matheus, 18/08/2026) reenvia `valor` mesmo quando o dono só
    // quis corrigir a categoria de uma conta JÁ PAGA (o campo Valor vem pré-preenchido
    // no form). Sem saber o status atual, a regra de "informar valor confirma a
    // conta" abaixo reabriria uma conta paga — achado CRÍTICO do Apolo, 18/08/2026:
    // ela volta a contar como devendo, reentra no aviso de atraso do WhatsApp, e se o
    // dono "pagar" de novo uma conta sem nota_fiscal_id nasce um SEGUNDO lançamento
    // no Financeiro (gasto duplicado, sem checagem que impeça).
    const { data: atual, error: erroAtual } = await supabase
      .from('contas_a_pagar')
      .select('nota_fiscal_id, status, valor')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (erroAtual) throw erroAtual
    if (!atual) return res.status(404).json({ error: 'Conta não encontrada' })

    const patch: Record<string, unknown> = { ...body }

    // Informar o valor confirma a conta: deixa de ser estimativa e passa a 'aberta'
    // — mas SÓ quando a conta ainda está em aberto/aguardando E o valor de fato
    // mudou. Conta já paga ou dispensada nunca troca de status por causa de uma
    // edição de cadastro (descrição, fornecedor, categoria) que por acaso reenviou
    // o mesmo valor de sempre.
    if (
      body.valor !== undefined
      && !ENCERRADOS_PARA_EDICAO.has(atual.status)
      && body.valor !== atual.valor
    ) {
      patch.valor_estimado = false
      patch.status = 'aberta'
    }

    // Boleto de NF-e: informar o vencimento tem que recalcular a competência
    // (1º dia do mês do vencimento) — senão a conta ERCAL nasce com competência
    // de julho (mês da emissão) e continua em julho mesmo depois do dono
    // informar 15/08, contradizendo o próprio desenho do módulo (ver conserto 3
    // da revisão final da Fase 2). Conta FIXA recorrente (sem nota_fiscal_id)
    // fica de fora de propósito: lá a competência é o mês da REGRA, decidido em
    // sincronizar.ts — não o mês do vencimento informado aqui.
    if (body.vencimento !== undefined && atual.nota_fiscal_id) {
      const [ano, mes] = body.vencimento.split('-').map(Number)
      patch.competencia = competenciaDoMes(ano, mes)
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update(patch)
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /contas/:id/pagar ───────────────────────────────────────────────────
contaRoutes.post('/:id/pagar', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const body = pagamentoSchema.parse(req.body)

    const { data: conta, error: erroBusca } = await supabase
      .from('contas_a_pagar')
      .select('*')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (erroBusca) throw erroBusca
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' })
    if (conta.status === 'paga') return res.status(409).json({ error: 'Esta conta já está paga' })

    let lancamentoId: string | null = null

    if (precisaCriarLancamento(conta)) {
      const { data: lanc, error: erroLanc } = await supabase
        .from('lancamentos_financeiros')
        .insert(montarLancamento(conta, body.data_pagamento, body.valor_pago))
        .select('id')
        .single()

      if (erroLanc) throw erroLanc
      lancamentoId = lanc.id
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({
        status:         'paga',
        data_pagamento: body.data_pagamento,
        valor_pago:     body.valor_pago,
        // Conta paga: o valor que saiu do banco passa a ser a verdade e a
        // estimativa não serve mais para nada. Sem estas duas linhas a lista
        // continuaria mostrando "R$ 890,00 — estimado" numa conta de R$ 912,35
        // já quitada, e o resumo das 07:00 no WhatsApp repetiria o mesmo engano.
        valor:          body.valor_pago,
        valor_estimado: false,
        lancamento_id:  lancamentoId,
      })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    // Dinheiro contado duas vezes é pior que requisição falhada.
    // O lançamento acima já está gravado. Se a conta não virou 'paga', ela
    // continua elegível: o usuário clica de novo, passa pela mesma checagem e
    // nasce um SEGUNDO lançamento — despesa dobrada, e o órfão nem aparece na
    // tela de contas. Então desfaz o lançamento antes de devolver o erro.
    if (error || !data?.length) {
      if (lancamentoId) {
        const { error: erroRollback } = await supabase
          .from('lancamentos_financeiros')
          .delete()
          .eq('id', lancamentoId)
          .eq('fazenda_id', fazendaId)

        // Não estoura: o erro que interessa é o original. Mas registra —
        // sobrou um lançamento órfão no Financeiro que precisa de olho humano.
        if (erroRollback) {
          console.error(
            `[Contas] Pagamento da conta ${req.params.id} falhou E o lançamento ` +
            `${lancamentoId} não pôde ser desfeito — há um lançamento órfão no Financeiro.`,
            erroRollback,
          )
        }
      }

      if (error) throw error
      return res.status(404).json({ error: 'Conta não encontrada' })
    }

    res.json(data[0])
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', detalhes: err.errors })
    }
    next(err)
  }
})

// ─── POST /contas/:id/desfazer-pagamento ──────────────────────────────────────
contaRoutes.post('/:id/desfazer-pagamento', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data: conta, error: erroBusca } = await supabase
      .from('contas_a_pagar')
      .select('id, lancamento_id')
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .maybeSingle()

    if (erroBusca) throw erroBusca
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' })

    // Só apaga o lançamento que ESTA conta criou.
    if (conta.lancamento_id) {
      const { error: erroDelete } = await supabase
        .from('lancamentos_financeiros')
        .delete()
        .eq('id', conta.lancamento_id)
        .eq('fazenda_id', fazendaId)

      if (erroDelete) throw erroDelete
    }

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({ status: 'aberta', data_pagamento: null, valor_pago: null, lancamento_id: null })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) { next(err) }
})

// ─── POST /contas/:id/dispensar ───────────────────────────────────────────────
contaRoutes.post('/:id/dispensar', async (req, res, next) => {
  try {
    const fazendaId = fazendaDe(req)
    if (!fazendaId) return res.status(400).json({ error: 'Fazenda não identificada' })

    const { data, error } = await supabase
      .from('contas_a_pagar')
      .update({ status: 'dispensada' })
      .eq('id', req.params.id)
      .eq('fazenda_id', fazendaId)
      .select()

    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'Conta não encontrada' })
    res.json(data[0])
  } catch (err) { next(err) }
})
