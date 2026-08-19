import type { ItemControleFlat } from '@/lib/types'

// Achado 1 da revisão do Apolo (18/08/2026, 4ª rodada) — as DUAS peças da
// correção do "Delete na linha inteira não funciona", extraídas pra
// arquivo PRÓPRIO sem import de React/CSS: `grade-itens.tsx` importa
// `react-datasheet-grid/dist/style.css`, que não é seguro rodar fora de um
// ambiente com DOM (o projeto `web/` não tem jsdom configurado, de
// propósito — ver vitest.config.mts). Extrair a lógica PURA pra cá permite
// testar sem precisar montar o componente inteiro.

// Coluna de AÇÃO ("Documento": abrir PDF, excluir documento) — nunca
// guarda dado de item nenhum. Sem `isCellEmpty` explícito, ela cai no
// padrão da BIBLIOTECA (`defaultIsCellEmpty = () => false`,
// dist/hooks/useColumns.js) — e como o Delete de linha inteira exige TODAS
// as colunas concordarem que a célula está vazia
// (dist/components/DataSheetGrid.js, `columns.every(isCellEmpty)`), essa
// UMA coluna sem dado nenhum bloqueava o gesto pra SEMPRE, não importa o
// que as outras colunas (já corrigidas — `colunaTextoSemNulo`,
// `isoDateColumn` nativo) dissessem. Provado pelo Apolo por mutação:
// forçar `isCellEmpty: () => true` só nesta coluna já vira o
// `columns.every(...)` de `false` pra `true`.
export function acoesIsCellEmpty(): boolean {
  return true
}

// "Linha indo pro lixo": todos os campos editáveis já estão no valor de
// "vazio" que o Delete produz (`colunaTextoSemNulo.deletedValue`, o
// `deleteValue` padrão de `colunaNumeroBR`/`isoDateColumn` — todos `null`
// ou `''`, nunca `undefined`). `valor_total` NUNCA pode ser persistido
// como `null` numa linha JÁ EXISTENTE — `controleItens.ts`:
// `valor_total: z.number().positive()`, sem `.nullable()` — então "a linha
// inteira voltou pro estado vazio, incluindo valor_total" só pode
// significar UMA coisa: o usuário quer a linha FORA da grade, não um PATCH
// que o backend SEMPRE recusaria com 400 (e que, antes desta correção,
// revertia 400ms depois — a "pisca e volta" que o Matheus relatou).
//
// Decisão do Matheus, 18/08/2026: Delete na linha inteira APAGA a linha —
// mesmo caminho de `DELETE /controle/itens/:id` que a operação DELETE
// nativa da grade já usa (ver `handleChange`, ramo `op.type === 'DELETE'`
// em grade-itens.tsx), sem esperar um 2º Delete (que é o que o mecanismo
// NATIVO de "smart delete" da biblioteca, por si só, exigiria — 1ª tecla
// limpa as células, só a 2ª chamaria `deleteRows()` de verdade). Detectar
// esta assinatura direto no `onChange` e chamar `onExcluirItem` na hora
// resolve os dois problemas de uma vez: a linha some numa tecla só, e
// nenhum PATCH condenado a falhar chega a sair.
export function linhaIndoParaOLixo(linha: ItemControleFlat): boolean {
  return (
    linha.descricao === '' &&
    linha.unidade === '' &&
    linha.quantidade === null &&
    linha.valor_unitario === null &&
    linha.valor_total === null &&
    linha.data_manual === null &&
    linha.fornecedor === null &&
    linha.numero_documento === null
  )
}

// ─── Portão de escopo (achados 1-3 da revisão do Apolo, 18/08/2026, 5ª
// rodada) — sem isto, `linhaIndoParaOLixo` sozinha disparava em cenários
// que o Matheus NUNCA pediu: Ctrl+A + Delete (todas as linhas carregadas,
// até 500, apagadas numa tecla), colar um bloco de 8 colunas em branco do
// Excel, Ctrl+X (a lib desliga o "smart delete" nesse gesto, mas a
// detecção por RESULTADO não sabia disso), e Delete numa FAIXA PARCIAL de
// células de uma linha "magra" (avulsa, só Produto+V.Total preenchidos —
// exatamente o mínimo que `possivelmenteCriar` exige).
//
// As 8 colunas de dado ficam nos índices 0-7 (Data, Fornecedor, NF,
// Produto, Quant., Unidade, V.Unit., V.Total) — medido pelo Apolo direto
// no código real da lib via `onSelectionChange`. Índice 8 (Documento) é a
// coluna de ação, nunca faz parte da seleção "linha inteira" que importa
// aqui.
export function selecaoCobreLinhaInteira(selecao: { min: { col: number }; max: { col: number } } | null): boolean {
  return !!selecao && selecao.min.col === 0 && selecao.max.col >= 7
}

// As TRÊS condições precisam bater JUNTAS pro Delete de 1 tecla apagar a
// linha: (1) o gesto foi de fato a tecla Delete/Backspace — não paste, não
// Ctrl+X; (2) a operação do `onChange` cobre EXATAMENTE 1 linha — não
// Ctrl+A; (3) a seleção no momento do gesto cobria a linha inteira — não
// uma faixa parcial. Qualquer uma fora do lugar cai no caminho normal
// (PATCH → 400 → reverte+marca, achado 2 da rodada anterior) — destino
// seguro, nunca destrutivo, pros gestos que não deveriam apagar nada.
export function podeSerDeleteDeLinha(opts: {
  foiTeclaDelete: boolean
  quantasLinhasNaOperacao: number
  selecao: { min: { col: number }; max: { col: number } } | null
}): boolean {
  return opts.foiTeclaDelete && opts.quantasLinhasNaOperacao === 1 && selecaoCobreLinhaInteira(opts.selecao)
}
