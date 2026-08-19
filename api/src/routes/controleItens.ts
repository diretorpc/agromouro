import { Router } from 'express'
import { z } from 'zod'
import { listarItensControle } from '../services/controle/listarItensControle'
import { editarItemControle } from '../services/controle/editarItemControle'
import { criarItemControleAvulso } from '../services/controle/criarItemControleAvulso'
import { excluirItemControle } from '../services/controle/excluirItemControle'

// Router PRÓPRIO para item de Controle, montado em `/controle/itens` no
// index.ts — NÃO é sub-recurso de `/controle/documentos` (controle.ts), e
// nunca foi: item AVULSO existe sem nenhum documento de origem, então
// "/controle/documentos/itens" nunca fez sentido como caminho.
//
// BUG CRÍTICO corrigido em 18/08/2026, achado ao testar no navegador (não
// pelos testes — ver comentário no arquivo de teste desta rota): estas 4
// rotas nasceram DENTRO de `controleRoutes` (controle.ts), que o index.ts
// monta em `/controle/documentos`. Isso resolvia em
// `/controle/documentos/itens`, não em `/controle/itens` — o caminho que o
// FRONTEND sempre chamou (`web/app/(app)/controle/hooks/use-controle-
// itens.ts`, comentário da linha 13 já dizia a intenção certa: "GET
// /controle/itens, não GET /controle/documentos"). A rota simplesmente não
// existia onde o front batia — 404 em silêncio, tela nunca carregava.
// `controle.test.ts` não pegou porque testava o HANDLER direto (sem passar
// pelo mount real do index.ts) — ver `routeMounts.test.ts`, escrito
// especificamente para fechar esse buraco.
//
// Corpo pequeno (texto/número) — usa o `express.json({ limit: '2mb' })`
// GLOBAL do index.ts (linha do fallback, sem path), não precisa de limite
// próprio como `/controle/documentos` (que carrega PDF em base64, 15mb).
// Ver comentário no index.ts, seção "Body parsing".
export const controleItensRoutes = Router()

// Mesmo padrão de controle.ts/nfe.ts/cartoes.ts: a fazenda vem SEMPRE do
// usuário autenticado (token JWT validado por requireAuth), nunca do corpo
// do pedido.
function fazendaDe(req: any): string | undefined {
  return req.user?.app_metadata?.fazenda_ativa_id as string | undefined
}

// GET /controle/itens (grade editável) — mesma forma de filtro que
// controle.ts usa pra `/controle/documentos`, mas com teto de página bem
// maior: a grade não pagina por clique (decisão do desenho — Excel não
// pagina), o "porPagina" grande é o tamanho do lote que o "carregar mais"
// busca de cada vez enquanto o usuário rola a grade virtualizada. 1000 é o
// teto real do PostgREST (padrão de linhas por página) — pedir mais do que
// isso simplesmente não traria mais linhas, então o schema já recusa antes
// de gerar uma expectativa que o banco não cumpre.
const listarItensSchema = z.object({
  pagina:     z.coerce.number().int().min(1).default(1),
  porPagina:  z.coerce.number().int().min(1).max(1000).default(500),
  fornecedor: z.union([z.string(), z.array(z.string())]).optional()
    .transform(v => v === undefined ? [] : Array.isArray(v) ? v : [v]),
  status:     z.union([z.string(), z.array(z.string())]).optional()
    .transform(v => v === undefined ? [] : Array.isArray(v) ? v : [v]),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// Campos comuns de item editável — reaproveitados por PATCH (parcial) e
// POST (criação avulsa). `conta_como_compra` de propósito NUNCA aparece
// aqui: campo desconhecido é removido em silêncio pelo modo "strip" padrão
// do zod, e mesmo que um dia alguém adicione o campo ao corpo por engano,
// o service (editarItemControle.ts/criarItemControleAvulso.ts) crava
// `false` no UPDATE/INSERT sem nunca ler o corpo da requisição para esse
// campo — duas camadas independentes de propósito. Ver spec, seção "Trava
// de conta_como_compra".
//
// `descricao`/`unidade` SEM `.min(1)` — decisão do Matheus, 18/08/2026
// (bug relatado: apagar a célula "Produto" recusava com 400 e a tela
// "recarregava sozinha"). Perguntado explicitamente, com o risco na mão
// (linha sem nome atrapalha a conferência contra a NF-e): ele quer poder
// deixar vazio, "máxima liberdade, igual Excel". `descricao` continua
// `z.string()` (não aceita `null` nem campo ausente quando a CHAVE está
// presente no patch) porque o banco exige `not null`
// (api/src/database/schema.sql:100, `itens_nfe.descricao text not null` —
// confirmado na fonte viva, migration 017_controle.sql nunca mexe nessa
// constraint) — string VAZIA satisfaz `not null` sem precisar de migration;
// `null` não satisfaria. O frontend (colunas-br.ts, `colunaTextoSemNulo`)
// nunca manda `null` pra estes dois campos, só `''`.
const camposItemEditavel = {
  descricao:        z.string(),
  quantidade:       z.number().nonnegative().nullable(),
  unidade:          z.string(),
  valor_unitario:   z.number().nonnegative().nullable(),
  valor_total:      z.number().positive(),
  data_manual:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  fornecedor:       z.string().min(1).nullable(),
  numero_documento: z.string().min(1).nullable(),
}

const patchItemSchema = z.object(camposItemEditavel).partial()
  .refine(patch => Object.keys(patch).length > 0, { message: 'Envie ao menos um campo para editar.' })

// CRIAR (POST) é diferente de EDITAR (PATCH) — achado da revisão do Apolo
// (18/08/2026, 3ª rodada): a decisão do Matheus foi sobre esvaziar um item
// JÁ EXISTENTE, não sobre criar um novo do zero em branco. `.required()`
// do zod só tira o `optional` de cima do `.partial()` — não devolve o
// `.min(1)` que `camposItemEditavel.descricao` perdeu. Sem esta
// sobrescrita, `POST {descricao:'', valor_total:10}` passava calado (só o
// guard do frontend, `grade-itens.tsx`/`possivelmenteCriar`, segurava —
// uma chamada direta à API, ou um bug futuro no front, furava). Continua
// `z.string().min(1)` — descrição em branco NUNCA cria linha.
const criarItemAvulsoSchema = z.object({
  ...camposItemEditavel,
  descricao: z.string().min(1),
}).partial({
  quantidade: true, unidade: true, valor_unitario: true, data_manual: true, fornecedor: true, numero_documento: true,
}).required({ descricao: true, valor_total: true })

// GET /controle/itens — lista FLAT (não agrupada por documento) para a
// grade editável estilo Excel (decisão do Matheus, 18/08/2026 — ver
// docs/superpowers/specs/2026-08-18-controle-tabela-editavel-design.md).
// GET /controle/documentos (controle.ts) continua existindo sem mudança —
// esta rota é quem alimenta a tela nova; a lógica pesada (filtro de status
// por documento, duplicata computada) mora em listarItensControle.ts.
controleItensRoutes.get('/', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = listarItensSchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Parâmetros de busca inválidos.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const resultado = await listarItensControle(fazendaId, parsed.data)
    res.json(resultado)
  } catch (err) {
    next(err)
  }
})

// POST /controle/itens — cria uma linha AVULSA (sem PDF de origem) direto
// na grade. Decisão travada nº 2 do Matheus: "adicionar linha nova".
controleItensRoutes.post('/', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = criarItemAvulsoSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const resultado = await criarItemControleAvulso({
      descricao:        parsed.data.descricao,
      quantidade:       parsed.data.quantidade ?? null,
      // `|| 'UN'` (não `??`) de propósito: `unidade` continua `z.string()`
      // sem `.min(1)` neste schema (achado da revisão, 3ª rodada) — uma
      // chamada direta à API com `unidade: ''` cairia no `??`, que só troca
      // `null`/`undefined`, e gravaria string vazia. Mesmo padrão que
      // `grade-itens.tsx` (`linha.unidade || 'UN'`) já usa do lado do
      // front — os dois lados tratam "vazio" e "ausente" igual aqui.
      unidade:          parsed.data.unidade || 'UN',
      valor_unitario:   parsed.data.valor_unitario ?? null,
      valor_total:      parsed.data.valor_total,
      data_manual:      parsed.data.data_manual ?? null,
      fornecedor:       parsed.data.fornecedor ?? null,
      numero_documento: parsed.data.numero_documento ?? null,
    }, fazendaId)

    if (resultado.status === 'erro') {
      res.status(500).json({ error: 'Erro ao criar o item.', detalhe: resultado.mensagem })
      return
    }
    res.status(201).json(resultado.item)
  } catch (err) {
    next(err)
  }
})

// PATCH /controle/itens/:id — edita célula(s) de um item já existente
// (importado de PDF ou avulso). Decisão travada nº 1: clicar na célula e
// digitar, Enter/Tab confirma — esta rota é quem persiste isso.
controleItensRoutes.patch('/:id', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = patchItemSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo inválido.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const resultado = await editarItemControle(req.params.id, fazendaId, parsed.data)

    switch (resultado.status) {
      case 'editado':
        res.json(resultado.item)
        return
      case 'nao_encontrado':
        res.status(404).json({ error: 'Item não encontrado.' })
        return
      case 'conflito':
        res.status(409).json({ error: 'Já existe um item idêntico (mesmo fornecedor, número, descrição e valor) — ajuste um dos campos.' })
        return
      case 'data_obrigatoria':
        res.status(400).json({ error: 'Item importado de um documento precisa de uma data — não é possível deixar a Data em branco aqui.' })
        return
      case 'erro':
        res.status(500).json({ error: 'Erro ao editar o item.', detalhe: resultado.mensagem })
        return
    }
  } catch (err) {
    next(err)
  }
})

// DELETE /controle/itens/:id — apaga UMA linha da grade (não o documento
// inteiro — ver DELETE /controle/documentos/:id, em controle.ts, para isso).
// Decisão travada nº 2: apagar linha.
controleItensRoutes.delete('/:id', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  try {
    const resultado = await excluirItemControle(req.params.id, fazendaId)

    switch (resultado.status) {
      case 'excluido':
        res.status(204).send()
        return
      case 'nao_encontrado':
        res.status(404).json({ error: 'Item não encontrado.' })
        return
      case 'erro':
        res.status(500).json({ error: 'Erro ao excluir o item.', detalhe: resultado.mensagem })
        return
    }
  } catch (err) {
    next(err)
  }
})
