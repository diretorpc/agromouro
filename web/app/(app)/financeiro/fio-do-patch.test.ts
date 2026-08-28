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
// `vitest.config.ts`), então não dá para renderizar o componente.
//
// ⚠️ A 1ª versão deste arquivo exigia uma STRING EXATA, e o Apolo mediu que ela
// passava em 3 de 5 contornos — inclusive o realista (um `.update()` novo logo
// abaixo) — e QUEBRAVA numa reformatação inofensiva do prettier, treinando o
// próximo a "consertar o teste" colando a string. Esta versão é CATRACA: conta
// quantos updates existem e recusa `valor_total` em qualquer um deles. Update
// novo obriga alguém a mexer aqui de propósito.
const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf-8')

// Todo trecho que escreve em `itens_nfe`, com o corpo até o fim da chamada.
// Casa `.update(` e `.insert(` com literal OU com variável/spread.
function escritasEmItensNfe(): string[] {
  const trechos: string[] = []
  const re = /from\(['"]itens_nfe['"]\)\s*(?:\r?\n\s*)?\.(update|insert)\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(PAGE)) !== null) {
    // Anda até fechar o parêntese da chamada, contando profundidade.
    let i = re.lastIndex, prof = 1
    while (i < PAGE.length && prof > 0) {
      if (PAGE[i] === '(') prof++
      else if (PAGE[i] === ')') prof--
      i++
    }
    trechos.push(`${m[1]}:${PAGE.slice(re.lastIndex, i - 1)}`)
  }
  return trechos
}

describe('o fio entre a tela e as funções puras', () => {
  const escritas = escritasEmItensNfe()

  it('CATRACA: existem exatamente 3 escritas em itens_nfe nesta tela', () => {
    // 1. edição em massa de centro de custo
    // 2. o insert de item novo (`itemNovoDoFormulario`)
    // 3. o update de edição (`patchDoItemEditado`)
    // Se este número mudar, alguém acrescentou um caminho que grava dinheiro —
    // e precisa passar pelas mesmas regras. Ajustar o número sem ler o resto
    // deste arquivo é como dispensar o aviso sem olhar a nota.
    expect(escritas).toHaveLength(3)
  })

  it('NENHUMA escrita monta valor_total à mão', () => {
    // Pega o bug original, o `.update()` acrescentado depois, a chave computada
    // e o `Object.assign` — todos os contornos que o Apolo mediu.
    for (const trecho of escritas) {
      expect(trecho).not.toMatch(/valor_total/)
      expect(trecho).not.toMatch(/quantidade\s*:/)
      expect(trecho).not.toMatch(/Object\.assign/)
    }
  })

  it('as duas escritas de dinheiro saem das funções puras', () => {
    // O update passa a função direto; o insert espalha a variável que ela
    // produziu (`...itemNovo`), porque precisa somar `insumo_id` e `fazenda_id`.
    const comDinheiro = escritas.filter(t => /patchDoItemEditado\(editItem, form\)|\.\.\.itemNovo/.test(t))
    expect(comDinheiro).toHaveLength(2)
    // E a variável espalhada TEM que vir da função pura, não de um literal
    // montado à mão logo acima.
    expect(PAGE).toMatch(/const itemNovo = itemNovoDoFormulario\(form\)/)
  })

  it('o diálogo de edição recebe o item original — sem ele a prévia mente', () => {
    expect(PAGE).toMatch(/original=\{editItem\s*\?\?\s*undefined\}/)
  })

  it('o formatador de dinheiro aceita nulo — senão a rota inteira cai', () => {
    // `itens_nfe.valor_unitario` é NULLABLE e o importador de Controle grava
    // nulo de propósito. Sem `error.tsx` em `web/app`, uma exceção no render
    // mata a rota ("Application error"). Achado [alto] do Apolo, 28/08/2026.
    expect(PAGE).toMatch(/function fmtBRL\(value: number \| null \| undefined\)/)
    expect(PAGE).toMatch(/function fmtBRLKpi\(value: number \| null \| undefined\)/)
  })
})

describe('a premissa que faz o parseFloat estar certo', () => {
  // `salvar-item.ts` usa `parseFloat` e NÃO `parseNumeroBR`, contra a regra
  // geral do repo. Isso só é correto porque estes dois campos são
  // `type="number"`, cujo `value` é sempre "" ou en-US por especificação — o
  // Apolo confirmou rodando Chromium em pt-BR: `SET[1.234,56] -> value=""`.
  //
  // Trocar para `type="text"` (plausível: spinner de número é ruim no celular)
  // reintroduziria calado o bug de produção que gerou `lib/numeros-br.ts`
  // (R$ 1.234,56 lido como R$ 1,23). Achado [médio] do Apolo, 2ª rodada: a
  // premissa mora em OUTRO arquivo e só um comentário a protegia.
  it('Quantidade e Valor Unitário continuam type="number"', () => {
    const numericos = [...PAGE.matchAll(/type="number"/g)]
    expect(numericos.length).toBeGreaterThanOrEqual(2)
  })

  it('nenhum dos dois virou type="text"', () => {
    // Se algum dia precisarem virar texto, o parser de `salvar-item.ts` TEM que
    // virar `parseNumeroBR` no mesmo commit.
    const blocoQtd  = PAGE.slice(PAGE.indexOf('<Label>Quantidade</Label>'), PAGE.indexOf('<Label>Unidade</Label>'))
    const blocoUnit = PAGE.slice(PAGE.indexOf('<Label>Valor Unitário (R$)</Label>'), PAGE.indexOf('<Label>Data</Label>'))
    expect(blocoQtd).toContain('type="number"')
    expect(blocoUnit).toContain('type="number"')
  })
})
