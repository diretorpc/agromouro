import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { controleRoutes } from './controle'
import { controleItensRoutes } from './controleItens'

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

  it('os DOIS mounts de Controle exigem requireAuth', () => {
    for (const nomeRouter of ['controleRoutes', 'controleItensRoutes']) {
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
