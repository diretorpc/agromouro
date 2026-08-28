// Regra PURA da edição de um item de `itens_nfe` na tela Financeiro — extraída
// para dar para testar sem montar componente, mesmo padrão de
// `web/app/(app)/talhoes/salvar-talhao.ts` e
// `web/app/(app)/nfe/regras-conferencia.ts`.
//
// POR QUE EXISTE: o `handleEdit` gravava `valor_total: quantidade × valor_unitario`,
// RECALCULANDO o total em vez de preservar o que veio da nota fiscal. Medido no
// banco de produção em 28/08/2026: **31 das 368 linhas de `itens_nfe` não
// satisfazem `quantidade × valor_unitario === valor_total`**, e 8 delas encolhem
// o gasto quando recalculadas — R$ 413.495,52 no total.
//
// O caminho para o estrago não exige o dono querer mexer em dinheiro: o diálogo
// existe principalmente para trocar o CENTRO DE CUSTO, e salvar já recalculava.
// Quatro linhas de CANA DE AÇÚCAR estão gravadas com `quantidade 0` e
// `valor_unitario 0` contra totais de R$ 9 mil a R$ 119 mil — um salvar zerava
// cada uma.
//
// Medir de novo (número em documento apodrece; o comando não):
//   select count(*) from itens_nfe
//   where abs(coalesce(quantidade,0) * coalesce(valor_unitario,0) - valor_total) > 0.02;

export type ItemOriginal = {
  quantidade:     number
  valor_unitario: number
  valor_total:    number
  // Item de nota fiscal tem a data mandada pela NOTA: a tela monta
  // `notas_fiscais.data_emissao ?? data_manual`, então `data_manual` num item
  // com nota é campo morto. Ver `dataEhEditavel`.
  nota_fiscal_id: string | null
}

export type FormularioItem = {
  descricao:      string
  quantidade:     string
  unidade:        string
  valor_unitario: string
  centro_custo:   string
  data:           string
}

export type PatchItem = {
  descricao:      string
  quantidade:     number
  unidade:        string
  valor_unitario: number
  valor_total:    number
  centro_custo:   string
  // Só aparece quando a data é editável — ver `dataEhEditavel`.
  data_manual?:   string
}

// A data só pode ser mudada aqui em item SEM nota fiscal. Com nota, a tela lê
// `notas_fiscais.data_emissao ?? data_manual`, então gravar `data_manual`
// seria escrever num campo que ninguém lê — o dono corrige a data, vê "salvo",
// e a lista volta com a data velha. Achado [médio] do Apolo (28/08/2026): o
// campo mentia, e mentia desde antes deste conserto.
export function dataEhEditavel(original: ItemOriginal): boolean {
  return original.nota_fiscal_id === null
}

// Campo numérico vazio, em branco ou ilegível significa "o dono não mexeu
// nisto", NUNCA um valor novo. A versão anterior fazia
// `parseFloat(form.quantidade) || 1`, que transformava campo vazio — e o próprio
// zero legítimo — em **1**, calado: nas linhas de cana com `quantidade 0` isso
// sozinho já reescrevia o dado.
//
// `parseFloat`, e NÃO `parseNumeroBR` — esta é a exceção à regra do repo, e ela
// foi MEDIDA antes de ser escrita.
//
// O Apolo pediu `parseNumeroBR` aqui (achado [alto], 28/08/2026), pelo
// precedente de `salvar-talhao.ts` e do bug de produção que gerou
// `lib/numeros-br.ts`. Segui, o teste quebrou, e a medição no banco mostrou que
// seguir era pior: **5 linhas reais de `itens_nfe` seriam lidas 1000× maiores.**
//
//   ESPALHANTE TRIOMAX   valor_unitario 117.505  ->  117505
//   HERBICIDA DONTOR     valor_unitario 335.999  ->  335999
//   CANA DE ACUCAR       valor_unitario   0.082  ->      82
//
// Nessa última, `quantidade` é 1.084.374: o total iria de R$ 88.939 para
// R$ 88,9 MILHÕES num salvar.
//
// A causa: `parseNumeroBR` lê `NNN.NNN` como AGRUPAMENTO DE MILHAR, que é o
// certo para texto que uma pessoa digita ou cola do Excel. Mas este campo é
// `<input type="number">`, e por especificação o `value` dele é sempre "" ou um
// número em formato en-US (ponto decimal) — vírgula não sai daí. Além disso o
// campo nasce preenchido com `String(item.valor_unitario)`, que também é en-US.
// Aqui não existe entrada pt-BR para proteger, e proteger dela quebra a real.
//
// ⚠️ O MESMO risco existe em `salvar-talhao.ts`, que usa `parseNumeroBR` num
// `<input type="number">`: uma área de `1.234` ha seria lida como 1234. Não
// mexi lá (escopo), mas está registrado no ESTADO.md.
function numeroOuOriginal(texto: string, original: number): number {
  const n = parseFloat(texto)
  return Number.isFinite(n) ? n : original
}

// Comparação DERIVADA, não flag de "mexeu". Flag pegajosa com reset à mão já
// custou um achado [alto] em `nfe/regras-conferencia.ts` nesta mesma semana:
// ligava com qualquer tecla, nunca desligava, e o reset morava no JSX.
// Aqui, digitar e desfazer volta ao estado de "não mexeu", como tem que ser.
function mudou(a: number, b: number): boolean {
  return Math.abs(a - b) > 1e-9
}

export function patchDoItemEditado(original: ItemOriginal, form: FormularioItem): PatchItem {
  const quantidade     = numeroOuOriginal(form.quantidade, original.quantidade)
  const valorUnitario  = numeroOuOriginal(form.valor_unitario, original.valor_unitario)

  // O TOTAL é o número que a nota fiscal afirma e o que a tela soma (ver a
  // memória `financeiro-soma-itens-nao-lancamentos`: as duas telas de dinheiro
  // somam tabelas diferentes). Ele só muda quando o dono mexeu, de propósito,
  // em quantidade ou unitário — aí recalcular é a intenção dele, e a tela
  // mostra o novo total antes de gravar.
  //
  // COM UM DOS DOIS NULO, nunca recalcula. `null * 480` dá 0 em JavaScript, e
  // `mudou(481, null)` dá true — então mexer na quantidade de uma linha de
  // unitário nulo ZERAVA um total de R$ 100.000. As três colunas são NULLABLE
  // no schema e `documentoPdf.ts` grava `valorUnitario: null` DE PROPÓSITO
  // quando o total já vem pronto no documento. Medido em 28/08/2026: 0 linhas
  // nulas hoje (395 itens), então é latente — mas a primeira nota assim que
  // entrar arma a bomba. Achado [médio] do Apolo, 2ª rodada.
  const contaEhConhecida = Number.isFinite(original.quantidade) && Number.isFinite(original.valor_unitario)
  const mexeuNaConta = contaEhConhecida
    && (mudou(quantidade, original.quantidade) || mudou(valorUnitario, original.valor_unitario))

  return {
    descricao:      form.descricao.trim(),
    quantidade,
    // `.trim()` como na descrição: " KG " gravado com espaços vira sujeira de
    // agrupamento. Achado [baixo] do Apolo (28/08/2026).
    unidade:        form.unidade.trim(),
    valor_unitario: valorUnitario,
    valor_total:    mexeuNaConta ? quantidade * valorUnitario : original.valor_total,
    centro_custo:   form.centro_custo,
    ...(dataEhEditavel(original) && form.data ? { data_manual: form.data } : {}),
  }
}

// O que a tela precisa imprimir ANTES de gravar. Hoje o diálogo mostra só o
// produto `qtd × unit` e nunca o total ATUAL do item — então não existe com o
// que comparar, e um total prestes a cair de R$ 119 mil para zero não aparece
// em lugar nenhum.
export function previaDoTotal(original: ItemOriginal, form: FormularioItem): {
  totalAtual: number
  totalNovo:  number
  vaiMudar:   boolean
} {
  const totalNovo = patchDoItemEditado(original, form).valor_total
  return {
    totalAtual: original.valor_total,
    totalNovo,
    vaiMudar:   mudou(totalNovo, original.valor_total),
  }
}


// ─── O caminho de ADIÇÃO ────────────────────────────────────────────────────
// Item novo não tem original, então aqui recalcular É a única opção — o total
// nasce do que o dono digitou. O que NÃO pode continuar é o `|| 1`.
//
// Achado [médio] do Apolo, 2ª rodada (28/08/2026), executado: com quantidade
// "0" e unitário "440", a prévia do diálogo mostrava **R$ 0,00** (ela usa
// `|| 0`) e o insert gravava **R$ 440,00** (ele usava `|| 1`). Duas contas
// diferentes na mesma tela, no mesmo clique, e quantidade 0 é exatamente o caso
// das linhas de cana. `FormFields` já era compartilhado entre adicionar e
// editar; a regra não era.
export type ItemNovo = {
  descricao:      string
  quantidade:     number
  unidade:        string
  valor_unitario: number
  valor_total:    number
  centro_custo:   string
  // Ausente quando o dono não escolheu data. A coluna é `date` (migration 015)
  // e mandar `''` para ela dá `invalid input syntax for type date`.
  data_manual?:   string
}

// BRANCO NÃO É ZERO, e confundir os dois custou um [alto].
//
// O `parseFloat(...) || 1` que este arquivo veio matar fazia DUAS coisas: o mal
// (o `"0"` digitado de propósito virava 1) e um bem (o campo apagado virava 1).
// A 1ª versão daqui matou as duas — e aí "FRETE COLHEITA, quantidade em branco,
// R$ 1.500" passou a gravar **R$ 0,00**. Achado [alto] do Apolo, 3ª rodada
// (28/08/2026), executado. Pior: a prévia nem aparecia, porque a condição de
// render exigia `form.quantidade` preenchido — tela e banco calavam juntos.
//
// E chegar ao branco não exige distração: `<input type="number">` devolve `""`
// para vírgula (medido em Chromium pt-BR nesta mesma branch), então "2,5"
// digitado no celular VIRA campo em branco.
function numeroDigitado(texto: string, seEmBranco: number): number {
  if (texto.trim() === '') return seEmBranco
  const n = parseFloat(texto)
  return Number.isFinite(n) ? n : seEmBranco
}

export function itemNovoDoFormulario(form: FormularioItem): ItemNovo {
  // Quantidade em branco = 1 (o padrão do formulário, e o que o dono quer dizer
  // ao lançar um frete). Quantidade "0" DIGITADA = 0, e a prévia mostra R$ 0,00.
  const quantidade    = numeroDigitado(form.quantidade, 1)
  // Unitário em branco = 0, mas o botão Salvar já barra unitário vazio.
  const valorUnitario = numeroDigitado(form.valor_unitario, 0)
  return {
    descricao:      form.descricao.trim(),
    quantidade,
    unidade:        form.unidade.trim(),
    valor_unitario: valorUnitario,
    valor_total:    quantidade * valorUnitario,
    centro_custo:   form.centro_custo,
    ...(form.data ? { data_manual: form.data } : {}),
  }
}

// A prévia do diálogo de ADIÇÃO sai da MESMA conta do insert — era isso que
// estava divergindo.
export function previaDoTotalNovo(form: FormularioItem): number {
  return itemNovoDoFormulario(form).valor_total
}
