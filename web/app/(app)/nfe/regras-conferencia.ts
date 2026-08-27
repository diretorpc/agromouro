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
  // `M2`/`M3` NÃO entram: areia, brita, pedra, madeira e concreto se vendem em
  // m³, e o fornecedor do caso de 24/08 é loja de material de construção — uma
  // DANFE dessas rotulada como serviço não acendia sinal nenhum. Serviço medido
  // em m² existe (pintura, limpeza), mas aqui errar para o lado barulhento
  // custa um banner, e errar para o lado calado custa o galpão. Achado [médio]
  // do Apolo, 7ª rodada (27/08/2026).
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
// Quando NÃO dá para comparar (sentinela -1 do fallback de corrida, ou API que
// não devolveu nem valor nem data), `pareceMesmoDocumento` responde "é a mesma"
// por IGNORÂNCIA, não por evidência. É a direção segura para TRAVAR — mas não
// serve de base para uma caixa que LIBERA: o banner afirma "mesmo número, mesmo
// fornecedor, mesma data e mesmo valor", e duas dessas quatro ninguém conferiu.
// Achado [médio] do Apolo, 9ª rodada (27/08/2026): a tela pedia uma decisão de
// dinheiro em cima de uma afirmação inventada, e escondia a evidência.
export function sabeCompararDocumento(gravada: NotaGravada): boolean {
  const temValor = typeof gravada.valor_total === 'number' && gravada.valor_total >= 0
  return temValor || !!gravada.data_emissao
}

export function pareceMesmoDocumento(
  gravada: NotaGravada,
  // O que a IA LEU neste PDF, nunca o que o dono digitou depois. Valor e data
  // não fazem parte da chave de duplicidade do servidor (`numero`,
  // `emitente_cnpj`, `fazenda_id`, `modelo`), então editá-los não pode ter
  // efeito nenhum sobre a trava — e tinha: achado [alto] do Apolo, 7ª rodada
  // (27/08/2026), medido. Corrigir um centavo lido errado e trocar o Tipo
  // liberava o botão, e a nota entrava pela segunda vez.
  lido: { valorTotal: number; dataEmissao: string },
): boolean {
  const temValor = typeof gravada.valor_total === 'number' && gravada.valor_total >= 0
  const temData  = !!gravada.data_emissao

  // Não sei nada sobre a gravada (sentinela -1 do fallback de corrida, ou API
  // velha sem nenhum dos dois): responde "pode ser a mesma". Travar de mais
  // custa um clique; travar de menos custa gasto em dobro.
  if (!temValor && !temData) return true

  // Cada campo CONHECIDO que diverge já basta para concluir "documento
  // diferente". Campo ausente não vota — assim uma API velha, que sabe a data
  // mas não o valor, ainda distingue o par legítimo emitido em dias diferentes,
  // em vez de travar tudo e recriar o botão morto.
  if (temData && gravada.data_emissao !== lido.dataEmissao) return false
  if (temValor && Math.abs(gravada.valor_total! - lido.valorTotal) > 0.02) return false
  return true
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
// A tela é editável e a leitura é congelada. A assinatura recebe os DOIS
// OBJETOS INTEIROS, e é a função que decide qual campo sai de qual — em vez de
// 8 campos soltos, onde ligar o fio errado é invisível.
//
// Isto não é estética: os DOIS [alto] da 7ª rodada do Apolo (27/08/2026) foram
// exatamente fio trocado. `modeloLido` recebendo `nota.modelo` (o editável) em
// vez de `lidoOriginal.modelo` mata a feature inteira com a suíte verde e o
// `tsc` limpo — os dois candidatos têm o mesmo tipo, então nem o compilador nem
// os testes da função pura enxergam. Com objetos, passar o errado exige trocar
// `lido` por `atual` de propósito, e aí a diferença é visível na chamada.
//
// A MARCA `lidaPelaIA` é o que faz o compilador pegar o fio trocado. Sem ela,
// os dois objetos são estruturalmente compatíveis e TRÊS trocas diferentes
// compilavam com a suíte verde — o Apolo mediu na 8ª rodada (27/08/2026):
//   `lido: nota`          → a foto vira o campo editável (defeito da 7ª rodada);
//   `atual: lidoOriginal!` → `identidadeMudou` nunca liga, e corrigir número ou
//                            CNPJ lido errado NUNCA libera o botão: o botão
//                            morto que este ramo inteiro existe para matar.
// Com a marca: `lido: nota` vira TS2741 e `atual: lidoOriginal!` vira TS2322.
// Custa um campo e uma função de 6 linhas.
export type NotaNaTela   = {
  modelo: 'nfe' | 'nfse'; numero: string; emitenteCnpj: string
  readonly lidaPelaIA?: never
}
export type NotaComoLida = {
  modelo: 'nfe' | 'nfse'; numero: string; emitenteCnpj: string
  valorTotal: number; dataEmissao: string
  readonly lidaPelaIA: true
}

// Copia os 5 campos — a foto tem que ser CÓPIA, não referência. Guardar o mesmo
// objeto que o estado editável fazia o congelamento depender de todo edit
// futuro continuar imutável, coisa que nenhum tipo, teste ou lint garante:
// um `nota.numero = x` num conserto futuro descongelaria a foto em silêncio.
// Achado [baixo] do Apolo, 8ª rodada (27/08/2026).
export function congelarLeitura(n: {
  modelo: 'nfe' | 'nfse'; numero: string; emitenteCnpj: string
  valorTotal: number; dataEmissao: string
}): NotaComoLida {
  return {
    modelo: n.modelo, numero: n.numero, emitenteCnpj: n.emitenteCnpj,
    valorTotal: n.valorTotal, dataEmissao: n.dataEmissao,
    lidaPelaIA: true,
  }
}

export function travaDeDuplicidade(params: {
  // O estado ATUAL da tela: o que o dono pode ter editado.
  atual: NotaNaTela
  // O que a IA leu, congelado no passo 1. `null` enquanto a leitura não chegou —
  // aí nada é tratado como editado, que é a direção segura.
  lido:  NotaComoLida | null | undefined
  notasNoBanco: NotasNoBanco | null | undefined
  // API mais velha que esta web (rollback): só sabemos que existe UMA nota
  // repetida, não em qual modelo. Trava nos dois — direção segura.
  jaExisteLegado: NotaGravada | null | undefined
  // O dono confirmou, na tela, que são dois documentos diferentes apesar de
  // número, fornecedor, data e valor baterem. Existe porque "travar de mais
  // custa um clique" só é verdade SE O CLIQUE EXISTIR — e não existia: o par
  // legítimo NF-e/NFS-e emitido no mesmo dia com valores iguais ficava sem
  // saída nenhuma nos dois lados do campo Tipo, e as duas saídas que o banner
  // oferecia estavam erradas ("apague a nota gravada" — é legítima; "confira o
  // número" — está certo). Achado [médio] do Apolo, 8ª rodada (27/08/2026).
  //
  // NÃO destrava a duplicata do MESMO modelo: ali a nota é a mesma, ponto, e a
  // saída continua sendo corrigir número ou CNPJ.
  //
  // É a CHAVE do que foi confirmado, não um booleano com reset à mão. Booleano
  // pegajoso já custou um [alto] neste mesmo arquivo (`identidadeEditada`, 5ª
  // rodada): ligava com qualquer tecla, nunca desligava, e o reset morava no
  // JSX, onde nenhum teste alcança. Sendo chave, a confirmação expira sozinha
  // quando o dono mexe em Tipo, número ou CNPJ — não existe reset para alguém
  // esquecer de escrever.
  confirmadoPara: string | null
}): {
  gemeoNoModeloAtual: NotaGravada | null
  gemeoNoOutroModelo: NotaGravada | null
  modeloDoOutroGemeo: 'nfe' | 'nfse'
  identidadeMudou:    boolean
  duplicataValendo:   boolean
  // A chave a gravar quando o dono marcar a caixa, e se a marca atual ainda
  // vale. A tela não monta chave nenhuma: ela só repassa o que esta função diz.
  chaveDeConfirmacao: string
  confirmacaoValendo: boolean
  // A gêmea que ESTÁ sendo acusada de ser o mesmo documento — o banner vermelho
  // precisa dela para imprimir fornecedor, data e valor. Sem isso a tela acusa e
  // esconde a prova (achado [médio] do Apolo, 9ª rodada).
  oMesmoDocumento:    NotaGravada | null
  // true quando o veredicto "é o mesmo documento" veio de IGNORÂNCIA. A caixa
  // de confirmação NÃO é oferecida aqui: a saída certa é abrir a nota gravada.
  veredictoPorIgnorancia: boolean
  // true quando a gêmea do outro modelo É esta nota — mesmo documento, com o
  // Tipo diferente. Quem trava é este campo.
  ehOMesmoDocumento:  boolean
  // true quando, além disso, foi o DONO que virou o campo Tipo. Só escolhe o
  // TEXTO do banner: "você trocou o Tipo" contra "confira o Tipo".
  travadoPeloTipo:    boolean
  // true quando a tela não sabe em qual modelo a gêmea está (API velha) — sem
  // isso, o banner imprime um rótulo inventado. Achado [baixo] da 6ª rodada.
  modeloDoGemeoDesconhecido: boolean
} {
  const modeloAtual = params.atual.modelo
  // Normalizada, para reformatar o número não expirar a confirmação — mesma
  // regra de `identidadeMudou`.
  const chaveDeConfirmacao = [
    params.atual.modelo,
    numeroNormalizado(params.atual.numero),
    cnpjNormalizado(params.atual.emitenteCnpj),
  ].join('|')
  const confirmouEstaSituacao = params.confirmadoPara === chaveDeConfirmacao
  const outro = modeloAtual === 'nfe' ? 'nfse' : 'nfe'
  const lido = params.lido ?? null

  // Só conta como "mudou" quando a tela SABE o que foi lido. Sem a leitura,
  // assumir que mudou desligaria a trava — a direção errada.
  const identidadeMudou = !!lido && (
    numeroNormalizado(params.atual.numero) !== numeroNormalizado(lido.numero)
    || cnpjNormalizado(params.atual.emitenteCnpj) !== cnpjNormalizado(lido.emitenteCnpj)
  )

  // Guarda de FORMA, não de presença: um objeto truthy sem as duas chaves
  // abandonava o legado e devolvia `undefined` onde o tipo promete `null`.
  // Achado [baixo] do Apolo, 6ª rodada (27/08/2026).
  const nb = params.notasNoBanco
  const temForma = !!nb && 'nfe' in nb && 'nfse' in nb
  const legado = params.jaExisteLegado ?? null

  const gemeoNoModeloAtual = temForma ? (nb![modeloAtual] ?? null) : legado
  const gemeoNoOutroModelo = temForma ? (nb![outro] ?? null) : null

  // A gêmea do OUTRO modelo é o mesmo documento? Se for, gravar entraria pela
  // segunda vez — `modelo` faz parte da chave de duplicidade, então nem o
  // servidor nem o índice único pegam.
  //
  // A pergunta NÃO é "quem virou o campo Tipo?". A versão anterior só olhava
  // quando o DONO virava (`modeloAtual !== modeloLido`), e por isso não cobria
  // o caso mais frequente: a IA errando o Tipo sozinha, que é o modo de falha
  // documentado deste projeto — a razão de `sinaisDeNotaDeProduto` existir.
  // Achado [alto] do Apolo, 7ª rodada (27/08/2026), medido: nota já gravada
  // como NF-e, IA lê 'nfse', dono não mexe em nada, botão HABILITADO, gasto em
  // dobro.
  const ehOMesmoDocumento = !!gemeoNoOutroModelo
    && !!lido
    && !identidadeMudou
    && pareceMesmoDocumento(gemeoNoOutroModelo, {
      valorTotal:  lido.valorTotal,
      dataEmissao: lido.dataEmissao,
    })
  // `travadoPeloTipo` só muda o TEXTO do banner: quando o dono virou o campo, a
  // frase certa é "você trocou o Tipo"; quando foi a IA, é "confira o Tipo".
  const travadoPeloTipo = ehOMesmoDocumento && !!lido && modeloAtual !== lido.modelo

  // A confirmação não vale quando o veredicto veio de ignorância — e isso é
  // decidido AQUI, não no JSX: mesmo que a tela renderize a caixa por engano,
  // marcá-la não libera nada.
  const veredictoPorIgnorancia = ehOMesmoDocumento
    && !!gemeoNoOutroModelo
    && !sabeCompararDocumento(gemeoNoOutroModelo)
  const confirmacaoValendo = confirmouEstaSituacao && !veredictoPorIgnorancia

  return {
    gemeoNoModeloAtual,
    // O aviso da gêmea cala em dois casos, e os dois são de não se contradizer:
    //
    // - `identidadeMudou`: ele afirma "existe uma nota com ESTE mesmo número",
    //   e depois da correção isso deixa de ser verdade (achado [médio] do
    //   Apolo, 6ª rodada);
    // - `ehOMesmoDocumento`: aí a "gêmea" É a própria nota. O aviso afirma "data
    //   e valor diferentes, são documentos diferentes" — texto que o código
    //   NUNCA tinha conferido (achado [médio] do Apolo, 7ª rodada) — e apareceria
    //   ao lado do vermelho dizendo o contrário. Dois avisos brigando na mesma
    //   tela, e o dono acreditando no mais simpático.
    gemeoNoOutroModelo: (identidadeMudou || ehOMesmoDocumento) ? null : gemeoNoOutroModelo,
    modeloDoOutroGemeo: outro,
    identidadeMudou,
    duplicataValendo: (!!gemeoNoModeloAtual && !identidadeMudou)
      || (ehOMesmoDocumento && !confirmacaoValendo),
    chaveDeConfirmacao,
    confirmacaoValendo,
    oMesmoDocumento: ehOMesmoDocumento ? gemeoNoOutroModelo : null,
    veredictoPorIgnorancia,
    ehOMesmoDocumento,
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
  // O OBJETO que `travaDeDuplicidade` devolve, não um booleano solto. Com
  // `duplicataValendo: unknown` (como era) o parâmetro aceitava o próprio `dup`
  // inteiro — sempre truthy — e trocar por `boolean` ainda deixava passar
  // qualquer um dos 6 booleanos irmãos daquele retorno: `dup.confirmacaoValendo`
  // no lugar de `dup.duplicataValendo` matava a trava inteira com `tsc` limpo e
  // a suíte verde (achado [médio] do Apolo, 9ª rodada, 27/08/2026).
  //
  // Recebendo o objeto, não existe campo para trocar — mesma doutrina que já
  // fechou o fio de `travaDeDuplicidade` na 8ª rodada.
  trava: { duplicataValendo: boolean }
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
  if (params.trava.duplicataValendo) return false
  if (params.semCfop > 0 && (params.familias?.length ?? 0) > 0) return false
  if (params.efeitoIncomumPendente) return false
  if (params.linhasSemQuantidade > 0) return false
  return true
}
