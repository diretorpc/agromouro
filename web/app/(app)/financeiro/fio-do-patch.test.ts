import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Teste de TEXTO, no molde de `api/src/routes/routeMounts.test.ts` — que nasceu
// do mesmo defeito: função certa, testada, e desligada da tela, com a suíte
// inteira verde.
//
// Aqui isso foi MEDIDO pelo Apolo em 28/08/2026: colar o cálculo antigo
// (`valor_total: qtd * vUnit`) de volta dentro do `.update()` de `page.tsx`
// deixava `salvar-item.ts` intacto, os testes puros passando e a suíte em
// 338/338. A função pura fica bonita e o dinheiro volta a evaporar.
//
// O `web` não tem jsdom nem testing-library (decisão registrada no
// `vitest.config.ts`), então não dá para renderizar o componente. Ler o arquivo
// como texto é feio e pega o que precisa pegar: que o fio existe.
const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf-8')

describe('o fio entre a tela e a função pura', () => {
  it('handleEdit monta o patch pela função pura, não à mão', () => {
    expect(PAGE).toContain('.update(patchDoItemEditado(editItem, form))')
  })

  it('NENHUM update de itens_nfe grava valor_total calculado na mão', () => {
    // Varre cada `.from('itens_nfe').update({...})` do arquivo e recusa
    // `valor_total` dentro do literal. A edição em massa (só `centro_custo`) e
    // qualquer update futuro passam por aqui.
    const updates = [...PAGE.matchAll(/from\('itens_nfe'\)[\s\S]{0,80}?\.update\(\{([\s\S]*?)\}\)/g)]
    for (const [, corpo] of updates) {
      expect(corpo).not.toMatch(/valor_total\s*:/)
    }
  })

  it('o diálogo de edição recebe o item original — sem ele a prévia mente', () => {
    // `original={editItem ?? undefined}` é o que faz o rodapé mostrar o total
    // GRAVADO em vez do produto `qtd × unit`, e avisar quando ele vai mudar.
    expect(PAGE).toContain('original={editItem ?? undefined}')
  })

  it('o formatador de dinheiro aceita nulo — senão a rota inteira cai', () => {
    // `itens_nfe.valor_unitario` é NULLABLE e o importador de Controle grava
    // nulo de propósito. Sem `error.tsx` em `web/app`, uma exceção no render
    // mata a rota ("Application error"). Achado [alto] do Apolo, 28/08/2026.
    expect(PAGE).toMatch(/function fmtBRL\(value: number \| null \| undefined\)/)
    expect(PAGE).toMatch(/function fmtBRLKpi\(value: number \| null \| undefined\)/)
  })
})
