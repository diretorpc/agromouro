// Regras PURAS da tela de conferência do PDF (conferencia-pdf.tsx), extraídas
// para dar para testar sem montar componente nenhum — mesmo padrão já usado em
// web/app/(app)/talhoes/salvar-talhao.ts e
// web/app/(app)/controle/components/deletar-linha.ts.
//
// Achado [médio] do Apolo, 3ª rodada (24/08/2026): os 5 consertos de front da
// rodada anterior (lidoOriginal, trava do botão, preservar CFOP ao confirmar a
// mesma família, etc.) foram entregues com ZERO teste — a lógica morava
// inteira dentro do componente React, sem forma de provar de mesa.

export type FamiliaItem = {
  chave:           string
  rotulo:          string
  cfop:            string
  contaComoCompra: boolean
}

export type ItemComCfop = {
  cfop:     string
  familia?: string
  // O que a IA LEU no papel, congelado pela rota antes de qualquer escolha do
  // dono. É a evidência de que uma nota rotulada como serviço talvez seja de
  // produto — ver `sinaisDeNotaDeProduto`.
  ncm?:      string
  cfopLido?: string
  // `null` = a nota não traz quantidade impressa (NFS-e). Ver `linhasSemQuantidade`.
  quantidade?: number | null
  unidade?:    string
}

// Nota em que NENHUM item é "compra normal" é rara e cara. A leitura de
// 24/08/2026 (loja de material de construção, CFOPs 5405 e 5102 impressos no
// papel) voltou com 5922 — faturamento de entrega futura — nos CINCO itens: o
// dinheiro contou certo por acaso, mas a mesma leitura numa nota de adubo faria
// a mercadoria NÃO entrar no estoque, calada.
//
// O menu de efeito por item existia e não bastou: ele apresenta a leitura como
// fato consumado, num campo pequeno. Quando a nota inteira cai fora de "compra",
// a tela precisa PARAR o dono, não sussurrar.
//
// Nota MISTA (parte compra, parte bonificação) não dispara: é o caso legítimo
// mais comum ("compre 20, leve 2").
export function precisaConfirmarEfeitoIncomum(itens: readonly ItemComCfop[]): boolean {
  if (itens.length === 0) return false
  return !itens.some(i => i.familia === 'compra')
}

// Trocar o efeito de um item grava o CFOP representante daquela família — o
// dono escolhe "já paguei antes", não "5117". Duas travas, nesta ordem:
//
// 1. Se a família escolhida é a MESMA que o item já tinha, e ele já veio com
//    um CFOP lido, NÃO reescreve: mantém o código real da nota. Sem isto,
//    confirmar a família de um item 6117 (interestadual) gravava 5117
//    (interno) — um código que a nota nunca imprimiu, só porque o dono
//    confirmou o que a IA já tinha acertado (achado 5, rodada anterior).
//
// 2. Família DIFERENTE, e o CFOP lido é interestadual (começa com '6'):
//    preserva o dígito de estado. Um item lido como 6117 cuja família o dono
//    troca para "Bonificação" grava 6910, NUNCA 5910 — 5910 é um código que a
//    nota nunca imprimiu, e num estado errado (achado 7, 3ª rodada,
//    24/08/2026). As 4 famílias têm gêmeo 6xxx com efeito idêntico
//    (6102/6117/6922/6910).
export function cfopAposEscolha(item: ItemComCfop, familiaEscolhida: FamiliaItem): string {
  const mantemCfopOriginal = item.familia === familiaEscolhida.chave && !!item.cfop
  if (mantemCfopOriginal) return item.cfop

  if (item.cfop.startsWith('6')) return '6' + familiaEscolhida.cfop.slice(1)

  return familiaEscolhida.cfop
}

// Item cujo efeito a tela NÃO deixa trocar: veio com CFOP lido, mas de uma
// família fora das quatro oferecidas (remessa sem compra 5905/5912/5920…,
// consignação 5917). A coluna "O que é este item" imprime o código cru para
// esses, sem select, porque trocá-los por "compra" seria piorar.
//
// Mora aqui, e não dentro do componente, porque DOIS lugares precisam da mesma
// resposta: o que decide se renderiza select e o que aplica família em massa.
// Quando essa pergunta existia só no JSX, o botão de conserto em massa passou
// por cima da trava e transformou remessa de depósito em compra nova — achado
// [alto] do Apolo, 25/08/2026.
export function itemTrancado(item: ItemComCfop): boolean {
  return !!item.cfop && !item.familia
}

// Aplica UMA família a TODOS os itens de uma vez, item por item, com a mesma
// regra de `cfopAposEscolha` — inclusive a preservação do dígito de estado e a
// de não reescrever um CFOP que já é daquela família.
//
// Item trancado (ver `itemTrancado`) fica INTOCADO: o botão conserta o que a
// tela deixaria consertar à mão, nunca mais que isso.
//
// Existe porque o aviso de `precisaConfirmarEfeitoIncomum` não bastou: em
// 25/08/2026 a nota 289122 (RURALCENTRO, 19 itens, CFOP 5102 e 5405 impressos)
// voltou com 5922 em TODAS as linhas. O aviso vermelho apareceu na tela e foi
// dispensado pela caixa "conferi no papel" — porque o conserto de verdade eram
// 19 dropdowns, um a um, e a caixa era um clique. Nenhum item entrou no estoque.
//
// Regra de UX que este caso ensina: quando a tela sabe qual é o conserto certo,
// ela tem que oferecer o conserto — não só o aviso e uma caixa de dispensa.
export function aplicarFamiliaATodos<T extends ItemComCfop>(
  itens: readonly T[],
  familia: FamiliaItem,
): T[] {
  return itens.map(item => (
    itemTrancado(item)
      ? item
      : { ...item, cfop: cfopAposEscolha(item, familia), familia: familia.chave }
  ))
}

// As DUAS pendências de CFOP da tela, numa resposta só — porque as duas têm a
// mesma exceção e responder cada uma no componente foi como o achado abaixo
// nasceu.
//
// NFS-e NÃO TEM CFOP: o campo é do DANFE. Numa nota de serviço, item sem CFOP é
// o normal, não pendência. Contar como pendência DESABILITAVA o botão
// "Confirmar e gravar", e a única saída que a tela oferecia era o dono escolher
// uma família no select — que carimba um CFOP 5102 inventado numa nota fiscal
// que não tem CFOP nenhum. Achado [alto] do Apolo, 27/08/2026, medido contra
// estas funções: do ponto de vista do dono o erro 422 tinha virado um botão
// morto, sem nem a mensagem que explicava o problema. E o 5102 falso divergiria
// do caminho do XML, onde `parseXmlNFSe` grava cfop ''.
//
// Os dois avisos também eram falsos para serviço: o vermelho diz "a mercadoria
// não entra no estoque" (não existe mercadoria) e o âmbar diz "conta o gasto
// duas vezes" (não conta — `servico: true` já resolve, ver nfeProcessor.ts).
//
// Reage à troca do campo "Tipo" na tela: se o dono corrigir NFS-e → NF-e, as
// pendências voltam na hora, como devem.
export function pendenciasDeCfop(
  modelo: 'nfe' | 'nfse',
  itens: readonly ItemComCfop[],
): { semCfop: number; efeitoIncomum: boolean } {
  if (modelo === 'nfse') return { semCfop: 0, efeitoIncomum: false }
  return {
    semCfop:       itens.filter(i => !i.cfop).length,
    efeitoIncomum: precisaConfirmarEfeitoIncomum(itens),
  }
}

// Unidades que só existem em mercadoria. NFS-e não tem coluna de unidade: o
// caminho do XML (`parseXmlNFSe`) sempre produz um item 'un', e o do PDF cai no
// mesmo 'un' quando não lê nada. Ver uma destas numa nota marcada como serviço
// é o papel dizendo "sou nota de produto".
// LISTA DE NEGAÇÃO, não de permissão — e a inversão é o ponto.
//
// `uCom` é TEXTO LIVRE no layout da NF-e: não existe tabela fechada de unidades
// comerciais. Lista de permissão nunca fica completa, e o default dela é CALAR.
// Achado [médio] do Apolo, 5ª rodada (27/08/2026), executado: uma DANFE de 8
// linhas rotulada 'nfse' com UN/PEÇA/FRASCO/BALDE/MT/PACOTE não acendia
// NENHUM aviso na tela inteira, botão habilitado, nenhuma mercadoria entrando
// no estoque. As duas versões anteriores da lista de permissão já tinham errado
// nas unidades que este projeto realmente usa (`TON` do fixture de DANFE,
// `MTN` do contrato da SYAGRI) — o terceiro erro seguido é sinal de que o
// formato da regra está errado, não o conteúdo dela.
//
// O conjunto que uma NFS-e legítima usa É pequeno e conhecido, então é ELE que
// vira lista. Unidade desconhecida passa a ACENDER em vez de sumir.
const UNIDADES_DE_SERVICO = new Set([
  '', 'UN', 'UND', 'UNID', 'UNIDADE', 'UNITARIO', 'UNITÁRIO',
  'H', 'HR', 'HRS', 'HORA', 'HORAS', 'HH',
  'DIA', 'DIAS', 'SEM', 'MES', 'MÊS', 'MESES', 'ANO', 'ANOS',
  'M2', 'M²', 'MT2', 'M3', 'M³', 'MT3',
  'SERV', 'SERVICO', 'SERVIÇO', 'VB', '%',
])
// `PCT` NÃO entra: `nfeProcessor.ts` lista PAC/PACOTE como unidade comercial de
// EMBALAGEM — mercadoria. Escrito por extenso acendia, abreviado calava.
// Achado [baixo] do Apolo, 6ª rodada (27/08/2026). Pacote de horas já é coberto
// por SERV/VB.

// `UN.` com ponto é `UN`: o DANFE pontua a abreviação e a comparação crua
// deixava passar. Mesma família do `numeroNormalizado` — normalizar antes de
// comparar, sempre.
function unidadeNormalizada(v: string | undefined): string {
  return (v ?? '').trim().toUpperCase().replace(/\./g, '')
}
// Quantas linhas mostram sinal de MERCADORIA numa nota marcada como serviço.
// Zero é o normal; qualquer número acima disso é contradição entre o papel e o
// campo "Tipo", e merece aviso.
//
// Achado [médio] do Apolo (27/08/2026), medido com a nota 289122 real (19
// linhas, CFOP impresso): trocar o "Tipo" para NFS-e apagava TODOS os bloqueios
// da tela de uma vez — banner vermelho, banner âmbar e a trava do botão — num
// clique. A nota entrava inteira como serviço e NENHUM item ia para o estoque,
// que é o desastre de 25/08/2026 por outra porta. O aviso é a única coisa que
// enxerga essa troca: `pendenciasDeCfop` (acima) tem que se calar em NFS-e,
// senão o dono não consegue gravar nota de serviço nenhuma.
//
// Aviso, não portão: NFS-e com CFOP alucinado é caso REAL e frequente (memória
// `cfop-lido-como-5922`), e travar por causa dele recriaria o botão morto que
// esta mesma rodada foi consertar. O efeito do código já está neutralizado no
// servidor (`converterParaNFeData` zera ncm/cfop em NFS-e); aqui é só a pista
// para o dono conferir o Tipo.
// DOIS sinais: código fiscal impresso, ou quantidade com unidade que não é de
// serviço. A 1ª versão olhava só NCM/CFOP impresso e era cega
// justamente no caso caro — achado [médio] do Apolo, 3ª rodada (27/08/2026):
// o `SCHEMA` da leitura ensina que NFS-e é "sem CFOP/NCM", então a MESMA
// decisão errada que rotula um DANFE como serviço tende a apagar os códigos
// dele. Quantidade e unidade sobrevivem a essa decisão: uma NFS-e não tem
// coluna de quantidade (por isso `quantidade === null` é o normal ali), e um
// DANFE sempre imprime QUANT e a unidade comercial.
export function sinaisDeNotaDeProduto(
  modelo: 'nfe' | 'nfse',
  itens: readonly ItemComCfop[],
): number {
  if (modelo !== 'nfse') return 0
  return itens.filter(i =>
    !!i.ncm
    || !!i.cfopLido
    // Quantidade SOZINHA não conta: NFS-e do padrão ABRASF traz "Qtde 1,00" no
    // corpo, e o aviso viraria ruído em nota de serviço legítima. O par
    // "quantidade impressa + unidade que NÃO é de serviço" é o que só existe em
    // nota de produto — e, por ser lista de negação, unidade que ninguém
    // previu acende em vez de sumir.
    || ((i.quantidade !== null && i.quantidade !== undefined)
        && !UNIDADES_DE_SERVICO.has(unidadeNormalizada(i.unidade)))
  ).length
}

// Quantas linhas estão sem quantidade impressa numa nota marcada como PRODUTO.
// Numa NFS-e é o normal (o papel não tem a coluna); numa NF-e é impossível de
// gravar — o servidor descarta a linha, e a nota inteira volta em 422.
//
// Achado [baixo] do Apolo (27/08/2026): sem esta trava, o dono que corrigisse o
// "Tipo" de uma NFS-e para NF-e via a linha na tela, escolhia "Compra normal"
// no CFOP, o botão habilitava — e o servidor respondia "Não consegui ler nenhum
// item desta nota" com o item ali, à vista. Botão morto com mensagem que mente,
// a mesma forma do defeito que abriu esta rodada.
export function linhasSemQuantidade(
  modelo: 'nfe' | 'nfse',
  itens: readonly ItemComCfop[],
): number {
  if (modelo !== 'nfe') return 0
  return itens.filter(i => i.quantidade === null).length
}

// ─── A trava de duplicidade ─────────────────────────────────────────────────
// Mora aqui, e não dentro do componente, porque foi de dentro do componente que
// saíram os dois achados [alto] da 5ª rodada do Apolo (27/08/2026) — e os dois
// eram de mesa, provaveis sem abrir navegador. Mesmo padrão de
// `salvar-talhao.ts` e `deletar-linha.ts`.
export type NotaGravada = {
  id: string; numero: string; data_emissao: string; emitente_nome: string
  // Ausente quando a API é mais velha que esta tela. `pareceMesmoDocumento`
  // trata a ausência como "pode ser a mesma nota" — direção segura.
  valor_total?: number
}
export type NotasNoBanco = { nfe: NotaGravada | null; nfse: NotaGravada | null }

// As identidades são comparadas NORMALIZADAS, com as mesmas duas regras do
// servidor (`numeroDaNota` e `cnpjLimpo` em api/src/services/nfe/notaPdf.ts).
// Achado [baixo] do Apolo, 6ª rodada (27/08/2026), medido: comparando texto
// cru, digitar "058717" no lugar de "58717", deixar um espaço no fim, ou
// pontuar o CNPJ desligava a trava — o dono não tinha mudado nada, e levava um
// erro do servidor depois de a tela ter dito que estava liberado.
function numeroNormalizado(v: string): string {
  return v.replace(/\D/g, '').replace(/^0+/, '')
}
function cnpjNormalizado(v: string): string {
  return v.replace(/\D/g, '')
}

// Mesmo número + mesmo CNPJ + MESMO TOTAL + MESMA DATA = mesmo documento, com o
// campo "Tipo" virado à mão. Total ou data diferentes = o par legítimo que a
// migration 011 descreve (NF-e nº 500 de peças + NFS-e nº 500 de mão de obra).
//
// Sem esse desempate os dois mundos produzem o MESMO estado de entrada, e
// escolher qualquer lado como padrão erra metade dos casos — achado [alto] do
// Apolo, 6ª rodada (27/08/2026). Na dúvida (API velha, sem `valor_total`, ou a
// sentinela -1 do fallback de corrida), responde "é a mesma": travar de mais
// custa um clique, travar de menos custa gasto e estoque em dobro.
export function pareceMesmoDocumento(
  gravada: NotaGravada,
  atual: { valorTotal: number; dataEmissao: string },
): boolean {
  if (typeof gravada.valor_total !== 'number' || gravada.valor_total < 0) return true
  if (!gravada.data_emissao) return true
  return gravada.data_emissao === atual.dataEmissao
    && Math.abs(gravada.valor_total - atual.valorTotal) <= 0.02
}

// ─── A trava de duplicidade ─────────────────────────────────────────────────
// Mora aqui, e não dentro do componente, porque foi de dentro do componente que
// saíram os achados [alto] da 5ª e da 6ª rodada do Apolo (27/08/2026) — e todos
// eram de mesa, provaveis sem abrir navegador. Mesmo padrão de
// `salvar-talhao.ts` e `deletar-linha.ts`.
//
// TRÊS entradas, não duas. A versão anterior recebia só o modelo ATUAL e as
// consultas, e por isso não distinguia:
//   (a) gêmea legítima do outro modelo  → pode gravar, com aviso;
//   (b) a PRÓPRIA nota, com o Tipo virado à mão → não pode, é gravação dobrada.
// Os dois chegavam com o mesmo estado, e a função escolhia sempre (a): um
// clique no campo "Tipo" liberava o botão, e a tela ainda chamava o estado de
// "normal". `modeloLido` + `pareceMesmoDocumento` são o que desempata.
export function travaDeDuplicidade(params: {
  modeloAtual:  'nfe' | 'nfse'
  // O que a IA leu no campo Tipo. `undefined` em tela que ainda não guardava —
  // aí a função assume que não houve troca, que é o comportamento anterior.
  modeloLido?:  'nfe' | 'nfse'
  notasNoBanco: NotasNoBanco | null | undefined
  // API mais velha que esta web (rollback): só sabemos que existe UMA nota
  // repetida, não em qual modelo. Trava nos dois — direção segura.
  jaExisteLegado: NotaGravada | null | undefined
  numeroAtual:  string
  cnpjAtual:    string
  numeroLido:   string | undefined
  cnpjLido:     string | undefined
  valorTotalAtual: number
  dataEmissaoAtual: string
}): {
  gemeoNoModeloAtual: NotaGravada | null
  gemeoNoOutroModelo: NotaGravada | null
  modeloDoOutroGemeo: 'nfe' | 'nfse'
  identidadeMudou:    boolean
  duplicataValendo:   boolean
  // true quando a trava vem do Tipo trocado, não da leitura original — a tela
  // precisa dizer isso ao dono, senão ele não entende o que travou.
  travadoPeloTipo:    boolean
  // true quando a tela não sabe em qual modelo a gêmea está (API velha) — sem
  // isso, o banner imprime um rótulo inventado. Achado [baixo] da 6ª rodada.
  modeloDoGemeoDesconhecido: boolean
} {
  const outro = params.modeloAtual === 'nfe' ? 'nfse' : 'nfe'

  // Só conta como "mudou" quando a tela SABE o que foi lido. Sem `numeroLido`,
  // assumir que mudou desligaria a trava — a direção errada.
  const identidadeMudou =
    (params.numeroLido !== undefined
      && numeroNormalizado(params.numeroAtual) !== numeroNormalizado(params.numeroLido))
    || (params.cnpjLido !== undefined
      && cnpjNormalizado(params.cnpjAtual) !== cnpjNormalizado(params.cnpjLido))

  // Guarda de FORMA, não de presença: um objeto truthy sem as duas chaves
  // abandonava o legado e devolvia `undefined` onde o tipo promete `null`.
  // Achado [baixo] do Apolo, 6ª rodada (27/08/2026).
  const nb = params.notasNoBanco
  const temForma = !!nb && 'nfe' in nb && 'nfse' in nb
  const legado = params.jaExisteLegado ?? null

  const gemeoNoModeloAtual = temForma ? (nb![params.modeloAtual] ?? null) : legado
  const gemeoNoOutroModelo = temForma ? (nb![outro] ?? null) : null

  // O Tipo foi trocado à mão E a gêmea está justamente no modelo que a IA leu:
  // é a própria nota, a menos que total ou data digam o contrário.
  const trocouOTipo = params.modeloLido !== undefined && params.modeloAtual !== params.modeloLido
  const gemeoNoModeloLido = trocouOTipo && temForma ? (nb![params.modeloLido!] ?? null) : null
  const travadoPeloTipo = !!gemeoNoModeloLido
    && !identidadeMudou
    && pareceMesmoDocumento(gemeoNoModeloLido, {
      valorTotal:  params.valorTotalAtual,
      dataEmissao: params.dataEmissaoAtual,
    })

  return {
    gemeoNoModeloAtual,
    // O aviso da gêmea cala em dois casos, e os dois são de não se contradizer:
    //
    // - `identidadeMudou`: ele afirma "existe uma nota com ESTE mesmo número",
    //   e depois da correção isso deixa de ser verdade (achado [médio] do
    //   Apolo, 6ª rodada);
    // - `travadoPeloTipo`: aí a "gêmea" É a própria nota. O aviso diria "data e
    //   valor diferentes, são documentos diferentes" logo ao lado do banner
    //   vermelho dizendo "é o mesmo documento" — dois avisos brigando na mesma
    //   tela, e o dono acreditando no mais simpático.
    gemeoNoOutroModelo: (identidadeMudou || travadoPeloTipo) ? null : gemeoNoOutroModelo,
    modeloDoOutroGemeo: outro,
    identidadeMudou,
    duplicataValendo: (!!gemeoNoModeloAtual && !identidadeMudou) || travadoPeloTipo,
    travadoPeloTipo,
    modeloDoGemeoDesconhecido: !temForma,
  }
}

// A condição que HABILITA o botão "Confirmar e gravar" — devolve `true`
// quando pode gravar, o INVERSO do que o componente usa em `disabled`.
//
// Item sem efeito escolhido TRAVA a gravação: deixar passar equivale a
// decidir "é compra" por omissão, que é o caminho do gasto dobrado. Mas só
// trava quando existe ESCOLHA possível (`familias` não vazia) — um botão que
// trava sem oferecer a ação que destrava é pior que o default que ele evita
// (achado do Apolo, 24/08/2026: API antiga sem `familias` deixava o dono sem
// nenhum caminho para gravar a nota).
export function podeGravar(params: {
  quantidadeItens:    number
  semCfop:            number
  familias:           readonly unknown[] | null | undefined
  duplicataValendo:   unknown
  gravando:           boolean
  // true quando a nota inteira caiu fora de "compra normal" E o dono ainda não
  // confirmou que é isso mesmo. Ver precisaConfirmarEfeitoIncomum.
  //
  // OBRIGATÓRIO pelo mesmo motivo do `linhasSemQuantidade` abaixo, e com mais
  // razão: esta é a trava que impede o GASTO DOBRADO por CFOP incomum (o
  // desastre de 25/08/2026). O Apolo mediu na 4ª rodada (27/08/2026) que dava
  // para arrancar esta linha da chamada em conferencia-pdf.tsx com a suíte
  // inteira verde e o `tsc` limpo.
  efeitoIncomumPendente: boolean
  // Linhas sem quantidade impressa numa nota marcada como NF-e. Ver
  // `linhasSemQuantidade`: o servidor recusa essas linhas, então deixar gravar
  // é mandar o dono bater num 422 que ele não tem como entender olhando a tela.
  //
  // OBRIGATÓRIO de propósito, mesma doutrina do `modelo` em NFeData. O `web`
  // não tem testing-library, então NENHUM teste prova que o componente chama
  // esta função com o valor certo — o Apolo mediu na 3ª rodada (27/08/2026):
  // arrancar esta linha da chamada em conferencia-pdf.tsx deixava a suíte
  // inteira verde e o `tsc` limpo. Sendo obrigatório, o compilador é a guarda.
  linhasSemQuantidade: number
}): boolean {
  if (params.gravando) return false
  if (params.quantidadeItens === 0) return false
  if (params.duplicataValendo) return false
  if (params.semCfop > 0 && (params.familias?.length ?? 0) > 0) return false
  if (params.efeitoIncomumPendente) return false
  if (params.linhasSemQuantidade > 0) return false
  return true
}
