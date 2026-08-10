# Reorganização das telas Financeiro e Contas a Pagar — Design

## Contexto

O usuário (Matheus, agricultor leigo em tecnologia) reportou as duas telas de
dinheiro do AgroMouro como desorganizadas: "a aba financeiro você entra já
cospe trocentos números na sua cara" e "toda a estrutura em si, ficou muito
desorganizado". Ele considerou inicialmente construir um sistema financeiro
do zero, copiando algum concorrente — decisão descartada depois de entender
que o problema é a ORGANIZAÇÃO DA TELA, não a automação por baixo (NF-e
automática por e-mail via Make.com, WhatsApp, banco de dados), que já
funciona em produção e não deve ser tocada.

Pesquisa de mercado (agente Gaia, 10/08/2026) sobre sistemas de gestão
agrícola bem avaliados (Aegro — Capterra 4,5/5; Traction Ag/Conservis —
Capterra 4,9/5; SSCrop) confirmou um padrão comum: **resumo (poucos números)
separado do detalhe (lista completa)**, nunca as duas camadas misturadas na
mesma visão. Achado de alerta: o sistema americano mais bem avaliado é
criticado por mostrar bem despesa e mal receita — o Financeiro do AgroMouro
hoje só trata despesa (não há receita na tela), mas isso é lacuna de
funcionalidade, não de organização, e fica fora do escopo deste projeto.

Arquivos afetados:
- `web/app/(app)/financeiro/page.tsx` (único componente, ~1000 linhas)
- `web/app/(app)/contas/page.tsx` + `web/app/(app)/contas/lista-contas.tsx`

Nenhuma outra rota importa desses arquivos — mudança isolada nas duas telas,
sem risco de quebrar navegação ou outras páginas. Nenhuma migration de banco
é necessária; todas as mudanças são de estado local (`useState`) e
apresentação (JSX/layout).

**Risco assumido, já registrado hoje na revisão do Apolo:** a pasta `web`
não tem nenhum teste automatizado. Toda verificação desta mudança é manual
(navegador) — ver seção "Verificação" no final.

## Objetivo

Reduzir a carga de informação apresentada de uma vez nas duas telas, sem
remover nenhuma funcionalidade nem tocar na automação por baixo, seguindo o
padrão validado pela pesquisa de mercado (resumo separado do detalhe).

## Decisões validadas com o usuário

Confirmadas via brainstorming em 10/08/2026, cada uma escolhida
individualmente pelo Matheus.

**Financeiro:**
1. Abrir já filtrada no mês atual (hoje abre em "Todos os meses")
2. Gráfico de categorias mostra só as 5 maiores por padrão, com opção de ver todas
3. Lista de lançamentos mostra 20 por vez, com botão "Carregar mais"
4. Filtro de origem (5 botões: Todos/NF-e/Cartão/Manual/Conta) vira 1 menu suspenso
5. Bloco "resumo" (KPIs + gráfico) separado visualmente do bloco "lançamentos"

**Contas a Pagar:**
1. Bloco "resumo" (3 KPIs) separado visualmente da lista de contas
2. Filtro de tipo (Todas/Contas fixas/Boletos de nota) vira 1 menu suspenso
3. Lista mostra um número limitado por vez, com botão "Carregar mais"
4. Todo botão de filtro de status mostra a quantidade entre parênteses (hoje só "Falta vencimento" e "Dispensadas" mostram)
5. Filtro "Todas" para de acumular conta paga para sempre — some da vista padrão depois de 30 dias, mantendo a aba "Pagas" como histórico completo

---

## 1. Financeiro — mês atual por padrão

**Hoje:** `const [filtroMes, setFiltroMes] = useState('todos')` — a tela soma
o histórico inteiro desde a primeira nota fiscal processada.

**Muda para:** inicializar com o mês corrente —
`useState(() => new Date().toISOString().slice(0, 7))`. O `useEffect` que já
sincroniza `?mes=` da URL (linha ~350-358) continua funcionando sem
alteração — se o link trouxer um mês específico, ele sobrescreve o padrão
normalmente. A opção "Todos os meses" continua existindo no `Select` para
quem quiser ver o histórico completo.

**Borda a tratar:** mês atual sem nenhum lançamento ainda (ex: dia 2 do mês,
antes de a NF-e do mês chegar) não pode parecer tela quebrada. Quando
`itensFiltrados.length === 0 && filtroMes !== 'todos'`, a célula "Nenhum
lançamento encontrado." da tabela ganha uma segunda linha com um botão
"Ver todos os meses" que chama `setFiltroMes('todos')`.

## 2. Financeiro — gráfico limitado a 5 categorias

Novo estado `const [verTodasCategorias, setVerTodasCategorias] = useState(false)`.

```ts
const chartDataExibido = verTodasCategorias ? chartData : chartData.slice(0, 5)
```

Renderiza `chartDataExibido` no lugar de `chartData` dentro do `<BarChart>`
(a altura do `ResponsiveContainer`, hoje `chartData.length * 52 + 16`, usa
`chartDataExibido.length` para não sobrar espaço vazio). Abaixo do gráfico,
se `chartData.length > 5`, um link/botão texto:
`{verTodasCategorias ? 'Ver só as 5 maiores' : `Ver todas as ${chartData.length} categorias`}`.

## 3. Financeiro — lista paginada (20 por vez)

Novo estado `const [visivelCount, setVisivelCount] = useState(20)`, resetado
sempre que um filtro muda:

```ts
useEffect(() => { setVisivelCount(20) }, [filtroMes, filtroCentro, filtroOrigem])
```

A tabela renderiza `itensFiltrados.slice(0, visivelCount)` no lugar de
`itensFiltrados`. **Importante:** os totais (`totalGeral`, `porCategoria`,
o rodapé "Total (N itens)") continuam calculados sobre `itensQueContam` /
`itensFiltrados` completos — nunca sobre a fatia visível. Paginar a tabela
não pode fazer o "Total" da tela mudar conforme o usuário clica em "Carregar
mais"; o valor tem que ser o mesmo do primeiro segundo. Abaixo da tabela,
se `itensFiltrados.length > visivelCount`, botão
`Carregar mais ${Math.min(20, itensFiltrados.length - visivelCount)}`.

## 4. Financeiro — filtro de origem em menu único

Troca os 5 `<button>` (linhas ~690-709) por um `<Select>` — mesmo componente
já usado para mês e centro de custo na mesma tela (import já existe). Mantém
o mesmo estado `filtroOrigem` e a mesma chamada `setUrlParam('origem', v)`.
Opções: Todos / NF-e / Cartão / Manual / Conta (mesmos rótulos curtos de
hoje). O crachá "Conta paga" / "Cartão" / etc. na coluna Origem da tabela não
muda — só o filtro de cima.

## 5. Financeiro — separar resumo de detalhe

Envolve os 3 cards de KPI + o gráfico num bloco com um rótulo pequeno
("Resumo do mês", `text-sm font-semibold text-muted-foreground`) acima, e
insere um `<Separator />` antes do `Card` de "Lançamentos por Item". Se
`web/components/ui/separator.tsx` ainda não existir (confirmar — a spec de
`reorganizacao-estoque` de 05/08 já cita esse componente na lista de UI
existentes), reaproveita o mesmo em vez de criar de novo.

---

## 6. Contas a Pagar — separar resumo de detalhe

Mesmo tratamento do item 5: os 3 cards de KPI (`Vence esta semana` /
`Atrasado` / `Aguardando`) ganham rótulo "Resumo" e um `<Separator />` antes
do `Card` de "Contas".

## 7. Contas a Pagar — filtro de tipo em menu único

Troca os 3 botões de `FILTROS_TIPO` (Todas/Contas fixas/Boletos de nota) por
um `<Select>`. `contas/page.tsx` ainda não importa `Select` — adicionar o
import (`@/components/ui/select`, já usado em `financeiro/page.tsx` com a
mesma API). Estado `filtroTipo` não muda de tipo nem de lógica, só o
controle visual.

## 8. Contas a Pagar — lista paginada

Mesmo padrão do item 3: `visivelCount` com reset ao trocar `filtro` ou
`filtroTipo`, `contasFiltradas.slice(0, visivelCount)` passado para
`<ListaContas contas={...} />`, botão "Carregar mais" abaixo da tabela. O
contador "{contasFiltradas.length} de {contas.length}" no `CardTitle`
continua usando os arrays completos (não a fatia visível).

## 9. Contas a Pagar — todo filtro mostra quantidade (e corrige achado pré-existente)

**Hoje** (`page.tsx`, dentro do `FILTROS.map`) só `sem-vencimento` e
`dispensada` calculam `n`; os demais recebem `0` e o número some do botão.
**Bug já registrado pelo Apolo (achado 5, revisão de hoje de manhã):** o
contador de `sem-vencimento` ignora `filtroTipo` — com "Contas fixas"
selecionado, o botão pode dizer "(3)" e a lista mostrar 1.

Correção proposta: extrair a lógica de predicado de cada filtro de status
para uma função só, usada tanto pela filtragem quanto pela contagem — hoje
são dois lugares com a mesma regra escrita duas vezes (`if (filtro ===
'aberta') return c.status === 'aberta'` dentro do `.filter()`, e nada
equivalente no cálculo de `n`). Isso fecha o achado 5 de graça, como
consequência de resolver a correção 4 pedida pelo usuário — não é escopo
extra, é a mesma mudança feita direito.

```ts
function contaBateFiltro(c: ContaAPI, filtro: FiltroStatus, hoje: string): boolean {
  if (filtro === 'todas')          return /* ver item 10 */
  if (filtro === 'sem-vencimento') return !ENCERRADAS.has(c.status) && !c.vencimento
  if (filtro === 'atrasada')       return !ENCERRADAS.has(c.status) && !!c.vencimento && diasEntre(hoje, c.vencimento) < 0
  return c.status === filtro
}
```

O filtro principal passa a chamar essa função; o cálculo de `n` de cada
botão também chama a mesma função, aplicando primeiro o filtro de tipo
(`okTipo`, já existente) e contando quantos batem — igual em espírito ao que
`contasFiltradas` já faz, só que por botão em vez de só pelo `filtro` ativo.

## 10. Contas a Pagar — "Todas" esconde paga com mais de 30 dias

Ajusta o branch `if (filtro === 'todas')` (comentário já escrito hoje de
manhã pela revisão do Apolo, linhas 144-148 de `page.tsx`) para também
excluir conta paga há mais de 30 dias:

```ts
if (filtro === 'todas') {
  if (c.status === 'dispensada') return false
  if (c.status === 'paga') return diasEntre(c.data_pagamento ?? hoje, hoje) <= 30
  return true
}
```

**Verificar ao implementar:** confirmar o sentido exato de `diasEntre` em
`datas.ts` (qual argumento é "de" e qual é "até", e se o resultado é
positivo ou negativo para data passada) — o trecho acima descreve a
intenção ("até 30 dias atrás continua aparecendo"), não necessariamente a
sintaxe literal final.

A aba dedicada "Pagas" (já existe em `FILTROS`) **não** ganha esse corte —
continua mostrando o histórico completo, sem limite de data. Só "Todas" para
de acumular pra sempre.

**Atualizar o comentário existente** (linhas 144-147 de `page.tsx`, escrito
na correção de hoje de manhã) para descrever a nova regra — ele hoje diz só
"'dispensada' é escondida", e isso deixa de ser verdade.

---

## Fora de escopo (decisão explícita, não esquecimento)

- Não mexe na automação por trás (NF-e, WhatsApp, banco de dados)
- Não adiciona rastreamento de receita ao Financeiro (achado da pesquisa de
  mercado, mas é funcionalidade nova, não reorganização de tela)
- Não decompõe `financeiro/page.tsx` nem `contas/page.tsx` em componentes
  menores além do que já está descrito acima — é reorganização visual, não
  refatoração de arquitetura
- Não cria um componente `<CarregarMais>` compartilhado entre as duas telas
  — o padrão se repete só 2 vezes; extrair um componente pra isso agora
  seria abstração prematura (YAGNI). Se uma terceira tela precisar do mesmo
  padrão no futuro, aí vale extrair.

## Verificação

Sem suíte de teste automatizado no `web` (achado já registrado hoje). Depois
de implementado, checklist manual no navegador:

- [ ] Financeiro abre no mês atual; "Todos os meses" no seletor ainda mostra o histórico completo
- [ ] Mês sem lançamento mostra aviso + atalho "Ver todos os meses", não tela vazia sem explicação
- [ ] Gráfico mostra só 5 categorias por padrão; "ver todas" expande e volta
- [ ] "Carregar mais" na lista do Financeiro não muda o valor de "Total de Despesas"
- [ ] Filtro de origem (menu único) filtra igual aos 5 botões antigos
- [ ] Contas a Pagar: resumo visualmente separado da lista nas duas telas
- [ ] Contas a Pagar: filtro de tipo em menu único filtra igual aos 3 botões antigos
- [ ] Contas a Pagar: todo botão de status mostra quantidade correta, respeitando o filtro de tipo ativo (testar com "Contas fixas" selecionado)
- [ ] Contas a Pagar: "Todas" não mostra mais conta paga há mais de 30 dias; aba "Pagas" continua mostrando tudo
- [ ] `npx tsc --noEmit` limpo nas duas telas
