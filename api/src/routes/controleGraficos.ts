import { Router } from 'express'
import { z } from 'zod'
import { agregarControle } from '../services/controle/agregarControle'

// Router PRÓPRIO, montado em `/controle/graficos` no index.ts.
//
// Não é sub-recurso de `/controle/documentos` nem de `/controle/itens`: o
// gráfico resume a fazenda inteira, não um documento nem um item. Essa lição
// já custou uma sessão — as rotas de item nasceram dentro de
// `controleRoutes` (montado em `/controle/documentos`) e davam 404 em tudo,
// com a suíte inteira verde, porque o teste chamava o handler direto e nunca
// o caminho HTTP real. O mount deste router é conferido em
// `routeMounts.test.ts` contra o `index.ts` lido como texto.
//
// Corpo não existe (é GET) — cai no `express.json({ limit: '2mb' })` global.
export const controleGraficosRoutes = Router()

// Mesmo padrão de controle.ts/controleItens.ts: a fazenda vem SEMPRE do
// token validado pelo requireAuth, NUNCA da query. A API usa
// SUPABASE_SERVICE_KEY (sem RLS), então este valor é a única barreira entre
// as fazendas — aceitar `?fazendaId=` seria entregar a chave.
function fazendaDe(req: any): string | undefined {
  return req.user?.app_metadata?.fazenda_ativa_id as string | undefined
}

// Espelha `listarItensSchema` de controleItens.ts nos campos comuns, de
// propósito: gráfico e grade precisam responder ao MESMO filtro, senão as
// duas metades da tela discordam e ninguém sabe qual está certa.
//
// `top` só corta os gráficos 4 e 5 (uma série por produto). Teto de 50: a
// tela não desenha 300 linhas, e um pedido maior geraria payload grande sem
// nada legível na ponta — melhor recusar do que fingir que atende.
const graficosSchema = z.object({
  fornecedor: z.union([z.string(), z.array(z.string())]).optional()
    .transform(v => v === undefined ? [] : Array.isArray(v) ? v : [v]),
  status:     z.union([z.string(), z.array(z.string())]).optional()
    .transform(v => v === undefined ? [] : Array.isArray(v) ? v : [v]),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  top:        z.coerce.number().int().min(1).max(50).optional(),
})

// GET /controle/graficos — os 5 gráficos numa chamada só (não cinco rotas):
// os cinco leem exatamente o mesmo conjunto filtrado, e cinco chamadas
// seriam cinco oportunidades de o filtro divergir entre elas.
controleGraficosRoutes.get('/', async (req, res, next) => {
  const fazendaId = fazendaDe(req)
  if (!fazendaId) {
    res.status(400).json({ error: 'Fazenda não identificada.' })
    return
  }

  const parsed = graficosSchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Parâmetros de busca inválidos.', detalhe: parsed.error.flatten() })
    return
  }

  try {
    const resultado = await agregarControle(fazendaId, parsed.data)
    res.json(resultado)
  } catch (err) {
    // Deixa subir para o errorHandler (500). Responder 200 com listas vazias
    // faria a tela dizer "sem dados" quando o problema é a migration 020 não
    // aplicada — exatamente o que aconteceu com a 019.
    next(err)
  }
})
