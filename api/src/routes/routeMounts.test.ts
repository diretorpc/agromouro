import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { controleRoutes } from './controle'
import { controleItensRoutes } from './controleItens'
import { controleGraficosRoutes } from './controleGraficos'

// ─── O teste que teria pego o bug crítico de 18/08/2026 ────────────────────
//
// O que aconteceu: as rotas de item (GET/POST /controle/itens, PATCH/DELETE
// /controle/itens/:id) nasceram DENTRO de `controleRoutes`, que o index.ts
// monta em `/controle/documentos` — resolvendo em
// `/controle/documentos/itens`, nunca em `/controle/itens` (o caminho que o
// FRONTEND sempre chamou). `controle.test.ts` não pegou porque testa o
// HANDLER direto via `pegarHandler` (`(controleRoutes as any).stack.find(...)`),
// sem passar pelo `app.use(prefixo, router)` real do index.ts — mesma
// categoria do bug de streaming da manhã de 18/08 (suíte inteira verde,
// funcionalidade 100% quebrada na vida real, porque o mock/atalho de teste
// pulava exatamente a parte que quebrou).
//
// Este arquivo NÃO importa `index.ts` de propósito — index.ts tem efeito
// colateral pesado ao ser importado (lança se faltar variável de ambiente
// obrigatória, chama `app.listen()`, inicia jobs de cron/IMAP reais). Em vez
// disso:
//   1. Lê o CÓDIGO-FONTE de index.ts como TEXTO e extrai o prefixo de mount
//      de cada router relevante com regex — é a mesma fonte que vai pro
//      Railway, então um mount errado (ou removido) quebra este teste.
//   2. Importa os ROUTERS diretamente (seguro: são só `Router()` com
//      handlers registrados, sem side effect — mesmo padrão que
//      controle.test.ts/controleItens.test.ts já usam) e enumera as rotas
//      registradas dentro de cada um via `.stack`.
//   3. Combina prefixo + subcaminho e compara contra os caminhos que o
//      FRONTEND de fato chama (lido como texto de use-controle-itens.ts) —
//      fecha o laço ponta a ponta sem executar nenhum dos dois lados.
const indexTs = readFileSync(join(__dirname, '../index.ts'), 'utf-8')
const hookFrontend = readFileSync(
  join(__dirname, '../../../web/app/(app)/controle/hooks/use-controle-itens.ts'),
  'utf-8',
)
const hookGraficos = readFileSync(
  join(__dirname, '../../../web/app/(app)/controle/hooks/use-controle-graficos.ts'),
  'utf-8',
)

// Acha `app.use('/prefixo', ..., nomeDoRouter)` em index.ts — flexível a
// `requireAuth` (ou qualquer outro middleware) entre o path e o router,
// contanto que o NOME do router apareça na mesma chamada.
function prefixoDoMount(nomeRouter: string): string {
  const regex = new RegExp(`app\\.use\\(\\s*'([^']+)'[^)]*\\b${nomeRouter}\\b[^)]*\\)`)
  const match = indexTs.match(regex)
  if (!match) {
    throw new Error(
      `Mount de "${nomeRouter}" não encontrado em index.ts — o router foi renomeado, ` +
      'removido, ou a chamada app.use() mudou de formato o bastante pra escapar do regex ' +
      'deste teste (confira à mão antes de "consertar" afrouxando o regex).',
    )
  }
  return match[1]
}

function rotasDoRouter(router: any): { method: string; path: string }[] {
  return (router.stack as any[])
    .filter(camada => camada.route)
    .flatMap(camada =>
      Object.keys(camada.route.methods).map(method => ({ method, path: camada.route.path as string })),
    )
}

function caminhoCompleto(prefixo: string, subPath: string): string {
  return subPath === '/' ? prefixo : `${prefixo}${subPath}`
}

describe('Mount real das rotas de Controle (index.ts)', () => {
  it('controleItensRoutes está montado em /controle/itens — NÃO em /controle/documentos/itens', () => {
    expect(prefixoDoMount('controleItensRoutes')).toBe('/controle/itens')
  })

  it('controleRoutes (documento) está montado em /controle/documentos', () => {
    expect(prefixoDoMount('controleRoutes')).toBe('/controle/documentos')
  })

  it('controleGraficosRoutes está montado em /controle/graficos — irmão, não filho de documentos/itens', () => {
    expect(prefixoDoMount('controleGraficosRoutes')).toBe('/controle/graficos')
  })

  it('a rota de gráficos resolve no caminho HTTP que o FRONTEND chama', () => {
    // Mesmo laço ponta a ponta das rotas de item: prefixo do mount (lido do
    // index.ts como texto) + subcaminho registrado no router, conferido
    // contra o hook de verdade. É este assert que pega "a rota existe, mas
    // no lugar errado" — o handler isolado passa nos testes de qualquer jeito.
    const prefixo = prefixoDoMount('controleGraficosRoutes')
    const caminhos = rotasDoRouter(controleGraficosRoutes).map(r => caminhoCompleto(prefixo, r.path))

    expect(caminhos).toEqual(['/controle/graficos'])

    // ⚠️ NÃO usar `expect(hookGraficos).toContain('/controle/graficos')`.
    // Provado por mutação (revisão do Apolo, 19/08/2026): trocar o `api.get`
    // para `/controle/grafico` (sem o "s") deixa a tela em 404 e os 8 testes
    // deste arquivo passavam — porque o comentário do cabeçalho do hook cita
    // o caminho certo, e a busca por substring casava com o COMENTÁRIO.
    // É exatamente o bug de 18/08 de novo, com o teste escrito pra pegá-lo
    // olhando pro lado errado. Extraímos a URL de dentro da chamada.
    const urlChamada = /api\.get<[^>]*>\(`([^`?]+)/.exec(hookGraficos)
    expect(urlChamada, 'não achei a chamada api.get em use-controle-graficos.ts').toBeTruthy()
    expect(urlChamada![1]).toBe('/controle/graficos')
  })

  it('os NOMES DE PARÂMETRO que o hook de gráficos manda existem no schema da rota', () => {
    // ⚠️ A 1ª versão deste teste só fazia `expect(hookGraficos).toContain('dataInicio')`
    // — e passava mesmo com o hook mandando `params.set('data_inicio', ...)`,
    // porque a string "dataInicio" continuava aparecendo em `filtros.dataInicio`.
    // MEDIDO na rota real em 19/08/2026: com `data_inicio`, o zod descarta a
    // chave desconhecida em silêncio e a resposta vem SEM FILTRO NENHUM
    // (28 itens em vez de 3). Gráfico mostrando o ano inteiro embaixo de uma
    // grade filtrada em 2 meses, sem erro em lugar nenhum.
    //
    // Agora comparamos o que vai NO FIO: as chaves literais passadas para
    // URLSearchParams contra as chaves declaradas no schema da rota.
    const fonteRota = readFileSync(join(__dirname, './controleGraficos.ts'), 'utf-8')
    const corpoSchema = /graficosSchema\s*=\s*z\.object\(\{([\s\S]*?)\n\}\)/.exec(fonteRota)
    expect(corpoSchema, 'graficosSchema não encontrado em controleGraficos.ts').toBeTruthy()

    const chavesAceitas = new Set(
      [...corpoSchema![1].matchAll(/^\s{2}(\w+):\s*z\./gm)].map(m => m[1]),
    )
    const chavesEnviadas = [...hookGraficos.matchAll(/params\.(?:set|append)\('([^']+)'/g)].map(m => m[1])

    expect(chavesEnviadas.length).toBeGreaterThan(0)
    for (const chave of chavesEnviadas) {
      expect(
        chavesAceitas.has(chave),
        `use-controle-graficos.ts manda "${chave}", que graficosSchema não aceita — ` +
        'o zod descarta em silêncio e o gráfico ignora esse filtro',
      ).toBe(true)
    }

    // E os 4 filtros da tela precisam estar TODOS sendo enviados: um que o
    // hook esqueça de mandar some do gráfico sem ninguém perceber.
    for (const obrigatorio of ['fornecedor', 'status', 'dataInicio', 'dataFim']) {
      expect(chavesEnviadas).toContain(obrigatorio)
    }
  })

  it('gráfico e grade mandam os filtros com os MESMOS nomes de parâmetro', () => {
    // A tela mostra gráfico em cima e grade embaixo, com um painel de filtro
    // só. Se os dois hooks nomearem o mesmo filtro de formas diferentes, uma
    // metade obedece e a outra não — e ninguém sabe qual está certa.
    const chaves = (fonte: string) =>
      new Set([...fonte.matchAll(/params\.(?:set|append)\('([^']+)'/g)].map(m => m[1]))

    const daGrade = chaves(hookFrontend)
    for (const chave of ['fornecedor', 'status', 'dataInicio', 'dataFim']) {
      expect(daGrade.has(chave), `a grade não manda "${chave}"`).toBe(true)
      expect(chaves(hookGraficos).has(chave), `o gráfico não manda "${chave}"`).toBe(true)
    }
  })

  it('os TRÊS mounts de Controle exigem requireAuth', () => {
    for (const nomeRouter of ['controleRoutes', 'controleItensRoutes', 'controleGraficosRoutes']) {
      const regex = new RegExp(`app\\.use\\(\\s*'[^']+',\\s*requireAuth,\\s*${nomeRouter}\\s*\\)`)
      expect(indexTs).toMatch(regex)
    }
  })

  it('cada rota de controleItensRoutes resolve num caminho HTTP completo que o FRONTEND de fato chama', () => {
    const prefixo = prefixoDoMount('controleItensRoutes')
    const caminhos = rotasDoRouter(controleItensRoutes).map(r => caminhoCompleto(prefixo, r.path))

    // GET/POST na raiz, PATCH/DELETE com :id — as 4 rotas da Tarefa 3-5.
    expect(caminhos).toEqual(expect.arrayContaining(['/controle/itens', '/controle/itens/:id']))

    // Cross-check contra o HOOK de verdade: se o mount mudar de novo sem o
    // front acompanhar (ou vice-versa), este assert quebra — é exatamente
    // o buraco que deixou passar o bug de 18/08. `:id` no path do Express
    // vira template string (`${id}`) no fetch — comparamos só o prefixo
    // literal, que é o que precisa bater.
    for (const caminho of caminhos) {
      const prefixoLiteral = caminho.replace('/:id', '')
      expect(hookFrontend).toContain(prefixoLiteral)
    }
  })

  it('nenhuma rota de item sobrevive em controleRoutes (documento) — era o path que causava o bug original', () => {
    const caminhos = rotasDoRouter(controleRoutes).map(r => r.path)
    expect(caminhos).not.toContain('/itens')
    expect(caminhos).not.toContain('/itens/:id')
  })
})
