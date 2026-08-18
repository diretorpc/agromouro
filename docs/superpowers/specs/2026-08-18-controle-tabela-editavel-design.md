# Controle — tabela totalmente editável estilo Excel — desenho

> Contexto: PR #61 entregou `/controle` com filtro estilo Excel (menu de
> checkbox por coluna), mas SEM edição de célula — isso foi marcado "fora de
> escopo" no plano anterior sem perguntar ao Matheus. Ele testou e recusou:
> quer uma grade totalmente editável, "exatamente como se fosse uma tabela de
> Excel... pegar uma tabela de Excel e jogar lá dentro da aba". Este documento
> não reabre essas decisões — só desenha COMO construir.

## Decisões já travadas com o Matheus (não reabrir)

1. Editar clicando na célula e digitando. Enter salva, Tab anda pro lado. Sem
   diálogo/janela.
2. Adicionar linha nova e apagar linha.
3. Colar do Excel de verdade (Ctrl+V com várias linhas/colunas de uma vez).
4. Salva sozinho, sem botão "Salvar".
5. Linha duplicada fica PINTADA (destaque visual).

## Decisão nova 1 — biblioteca: `react-datasheet-grid`

**Escolhida:** [`react-datasheet-grid`](https://github.com/nick-keller/react-datasheet-grid)
(nick-keller), MIT, DOM-based (não canvas).

**Confirmação de compatibilidade — feita contra o `npm view` real do pacote
(não memória; o MCP `context7` não estava disponível como ferramenta nesta
sessão, então a fonte usada foi o metadado real do registry do npm, que é tão
confiável quanto — é o próprio `package.json` publicado):**

```
npm view react-datasheet-grid peerDependencies
# { react: '^15.0.0 || ^16.0.0 || ^17.0.0 || ^18.0.0 || ^19.0.0', ... }
npm view react-datasheet-grid version        # 4.11.6
npm view react-datasheet-grid time.modified  # 2026-03-03 — mantido, não abandonado
npm view react-datasheet-grid license        # MIT
```

Suporta `react ^19.0.0` explicitamente no `peerDependencies` — bate com o
projeto (`react` 19.2.4, `next` 16.2.6). Next.js 16 não entra na conta aqui:
o componente é 100% client-side (`'use client'`), sem uso de API de servidor
do Next — a mudança de major do Next não afeta a integração.

**Por que não as outras candidatas:**

| Biblioteca | Motivo de descartar |
|---|---|
| `@tanstack/react-table` (já instalada) | Headless — não dá paste/edição/navegação de teclado prontos. Construir isso do zero em cima dela é o "trabalho grande" que o pedido pediu para evitar. Continua no projeto para as OUTRAS telas com tabela (Financeiro, Contas, Estoque...), que não precisam virar planilha. |
| `glide-data-grid` (`@glideapps/glide-data-grid`) | `peerDependencies.react` trava em `^16.12.0 \|\| 17.x \|\| 18.x` — **sem React 19** na versão publicada mais recente (6.0.3, jun/2026). Também é canvas-based: célula mesclada/grupo visual e estilização via Tailwind ficam mais difíceis, e a paridade de acessibilidade (leitor de tela) é pior que DOM. |
| `handsontable` | Licença comercial acima de um teto de linhas/colunas ("SEE LICENSE IN LICENSE.txt" — não é MIT puro); pedido explícito era biblioteca MIT. |
| `react-spreadsheet` | Peer deps mais permissivas (`react >=16.8.0`, sem teto), mas o pacote é bem mais simples — não tem paste multi-célula nativo do Excel documentado, nem virtualização de linhas (organização em milhares de linhas ao longo dos anos ficaria lenta sem paginar — e paginar é exatamente o que estamos abandonando). |

**O que a biblioteca resolve pronta, sem código nosso:**
- Clique na célula edita; Enter confirma e desce; Tab confirma e anda pro
  lado (decisão 1 — comportamento NATIVO da lib, não precisa reimplementar).
- Ctrl+V com bloco de várias linhas/colunas copiado de um Excel de verdade
  cola direto na grade, expandindo linhas se precisar (decisão 3).
- Inserir linha / apagar linha (menu de contexto, botão da linha, ou atalho
  de teclado) — decisão 2.
- Virtualização de linhas (`@tanstack/react-virtual` por baixo) — resolve a
  decisão de paginação (ver abaixo) sem paginar.
- Callback único `onChange(novoValor, operacoes)` — `operacoes` é uma lista
  tipada de `{ type: 'UPDATE' | 'CREATE' | 'DELETE', fromRowIndex, toRowIndex }`
  que diz exatamente o que mudou numa colada/edição/exclusão — é o gancho
  para o autosave (decisão 4).

## Decisão nova 2 — células mescladas (rowSpan por fornecedor) somem

A tabela atual (PR #61) agrupa itens por DOCUMENTO: uma faixa-título com o
nome do fornecedor acima de cada bloco, colunas repetidas por bloco. Isso é
INCOMPATÍVEL com uma grade de planilha de verdade — Excel não tem "faixa de
grupo mesclada no meio das linhas", é sempre uma grade flat, linha = registro.

**Decisão: achatar.** Cada LINHA da grade é um item (`itens_nfe` com
`documento_controle_id` OU avulso, nunca item de NF-e). `Fornecedor` e `NF`
(numero_documento) viram COLUNAS normais, editáveis célula a célula — igual
a qualquer coluna. Isso também é o que "exatamente como Excel" pede
literalmente: Excel não agrupa por mesclagem, agrupa (quando agrupa) por
ordenação/filtro de coluna.

**O que se perde, aceito conscientemente:** o "Total do PDF" que aparecia no
cabeçalho de cada bloco (conferência da soma dos itens contra o valor
declarado no documento) não tem mais um lugar natural na grade linha-a-linha.
Fica como informação por CLIQUE (botão "PDF" na linha abre o documento
original — o Matheus já pode conferir manualmente lá) em vez de sempre
visível. Registrado aqui para não ser "descoberto" como regressão depois.

**O que se ganha:** o Matheus pode ordenar/filtrar por QUALQUER coluna (não
só fornecedor), incluindo edição de fornecedor/NF/data direto na célula sem
abrir nada — que é o pedido.

## Decisão nova 3 — paginação (20/página) vira scroll virtual

Excel não pagina. A paginação atual (`porPagina: 20`, cliques de página) é
outra coisa que "não parece Excel".

**Decisão:** a grade carrega tudo que estiver dentro do filtro ativo
(fornecedor/status/período) de uma vez, sem cliques de página — a
virtualização da biblioteca (`react-virtual`) já suporta "centenas de
milhares de linhas" (documentação do próprio pacote) renderizando só o que
está visível na tela, então não é um problema de performance do NAVEGADOR.

**O que É um problema, e a mitigação:** o BACKEND. `GET /controle/itens`
(nova rota, substitui o uso de `GET /controle/documentos` pela tela) não
pode devolver ilimitado — o Postgres/PostgREST tem teto de 1000 linhas por
página por padrão. Mitigação: a rota aceita `pagina`/`porPagina` (mesmo
padrão do resto do projeto), mas com `porPagina` default de **500** (bem
acima do que a tela mostra de uma vez visualmente, mas dentro de teto
seguro) e o hook do frontend faz "carregar mais" automático — dispara a
próxima página sozinho quando o scroll da grade virtual chega perto do fim
da lista carregada (não precisa de clique do usuário; visualmente é
transparente, a grade parece ter tudo desde sempre). Aceito como
suficiente para a escala atual do projeto (dezenas de documentos, poucas
centenas de itens); se um dia crescer para dezenas de milhares de itens,
o próximo passo seria cursor-based ao invés de offset — não construído
agora, documentado como próximo degrau.

## Backend

### `GET /controle/itens` (nova rota, substitui `GET /controle/documentos` NA TELA)

Devolve item a item (não mais agrupado por documento), incluindo tanto item
importado de PDF (`documento_controle_id not null`) quanto item AVULSO
(criado direto na grade, `documento_controle_id null`) — os dois têm em
comum `nota_fiscal_id is null` (nunca mostra item de NF-e nesta grade; isso
seria misturar duas fontes de dado com regras de edição diferentes).

Query params: `pagina`, `porPagina` (default 500, teto 1000 — mesmo teto do
PostgREST), `fornecedor[]`, `status[]` (do DOCUMENTO de origem, quando
houver — item avulso não tem status), `dataInicio`, `dataFim` — mesmo
contrato de filtro que `GET /controle/documentos` já tem, só que aplicado
a item em vez de documento.

Cada item devolvido ganha 2 campos computados de duplicata (ver seção
"Duplicatas", abaixo): `duplicado: boolean` e `duplicadoMotivo:
'reimportacao' | 'linhas_iguais' | null`.

`GET /controle/documentos` **continua existindo, sem mudança** — mais
barato manter os dois convivendo (nada mais o consome depois da troca da
tela, mas remover é risco sem benefício medido) do que arriscar quebrar algo
que não foi auditado nesta tarefa.

### `PATCH /controle/itens/:id` — editar item

Corpo (todos campos opcionais, zod `.partial()`, pelo menos 1 obrigatório):
`descricao`, `quantidade`, `unidade`, `valor_unitario`, `valor_total`,
`data_manual`, `fornecedor`, `numero_documento`.

- `fazendaDe(req)` obrigatório (mesmo padrão de toda rota de `controle.ts`).
- Busca o item por `id` + `fazenda_id` — 404 se não achar OU se
  `nota_fiscal_id is not null` (item de NF-e não é editável por esta rota —
  ver seção "Trava de conta_como_compra" abaixo para o motivo mais forte).
- **`conta_como_compra` NUNCA aceito no corpo** (fora do schema zod —
  chave desconhecida é removida silenciosamente pelo modo `strip` padrão do
  zod, e mesmo assim o `UPDATE` no banco explicita `conta_como_compra: false`
  cravado no payload, nunca lido do corpo — duas camadas independentes,
  cinto e suspensório, mesmo padrão de paranoia que `gravarDocumentoPdf.ts`
  já usa comentado).
- Conflito de unicidade (23505, exato — deveria ser raríssimo, ver seção
  Duplicatas) vira 409 com mensagem clara, não 500.
- 200 com o item atualizado + `duplicado`/`duplicadoMotivo` recalculados.

### `POST /controle/itens` — criar item avulso

Corpo: mesmos campos de PATCH, `valor_total` obrigatório (não dá para
lançar uma linha "vazia" que valha zero), resto opcional.
`documento_controle_id: null`, `nota_fiscal_id: null`, `conta_como_compra:
false` (cravado), `ocorrencia_no_documento: 0` (item avulso nunca colide
com a trava de dedupe — ela só se aplica `where documento_controle_id is
not null`, ver migration 018; item avulso é declaradamente livre dessa
proteção, é entrada manual). 201 com o item criado.

### `DELETE /controle/itens/:id` — apagar item

`fazendaDe(req)` + item precisa ser da fazenda e `nota_fiscal_id is null`.
Apaga QUALQUER item de Controle, inclusive um vindo de PDF importado —
decisão travada nº 2 não distingue origem. **Risco documentado, não
resolvido (decisão consciente, replicando o padrão de risco aceito que o
projeto já tem em outros lugares — ex.: "Adiado de propósito" nas seções de
Operações do ESTADO.md):** apagar um item de PDF libera a chave de dedupe da
migration 018 (o índice só existe enquanto a linha existe) — reimportar o
MESMO extrato depois pode trazer essa linha de volta, porque a trava não
"lembra" de uma linha apagada. Comentado no código da rota, para o próximo
que ler não reabrir como bug.

## Duplicatas pintadas — dois mecanismos, dois casos

### Caso 1 — a trava PEGOU (reimportação exata) → sinal PERSISTIDO

Hoje `itensDuplicados` (contagem) só existe na resposta efêmera do POST de
upload — nunca é gravado, e a linha EXISTENTE que "absorveu" a duplicata
nunca fica marcada. Migration nova (`019`) adiciona:

```sql
alter table itens_nfe
  add column if not exists duplicata_confirmada_em    timestamptz,
  add column if not exists duplicata_confirmada_vezes integer not null default 0;
```

Em `gravarDocumentoPdf.ts`, dentro de `inserirItensUmAUm` (o caminho que já
trata 23505 item a item — ver comentário existente no arquivo), ao capturar
um 23505: em vez de só incrementar o contador local `duplicados`, busca a
linha EXISTENTE pela mesma chave (as 6 colunas do índice parcial
`idx_itens_nfe_dedupe_item`, sem precisar de `documento_controle_id` — ele
NÃO faz parte da chave, então uma busca por
`fazenda_id + fornecedor_normalizado + numero_documento + descricao +
valor_total + ocorrencia_no_documento` acha exatamente 1 linha, seja qual
for o documento a que ela pertence) e faz `UPDATE` nela:
`duplicata_confirmada_em = now()`, `duplicata_confirmada_vezes = vezes + 1`.

Isso resolve, de brinde, a pendência do ESTADO.md ("documento fantasma com
`itens: []`, nada distingue de gravação falhou"): agora, ao reimportar um
extrato onde TUDO já existia, o documento novo continua com 0 itens novos,
mas as linhas ANTIGAS que ele bateu ganham um timestamp fresco — dá para
provar, olhando `duplicata_confirmada_em`, que a reimportação rodou e
CONFIRMOU cada linha, em vez de ter falhado em silêncio.

**Pintura:** qualquer item com `duplicata_confirmada_em is not null`.

### Caso 2 — a trava NÃO pegou (edição manual mudou a chave) → sinal COMPUTADO

O pedido do Matheus é: editar descrição/valor à mão de um jeito que faz o
item "parecer" igual a outro (mesmo produto, mesmo valor) sem bater
EXATAMENTE na chave da trava (ex.: descrição digitada com espaço/acento
diferente, ou o mesmo produto+valor legitimamente repetido em duas linhas
que a trava não deveria ter barrado — `ocorrencia_no_documento` cuida
disso). **Decisão: NÃO afrouxar `idx_itens_nfe_dedupe_item`** (ordem
explícita) — a pintura deste caso não é uma trava de banco, é uma consulta
de leitura, mais solta:

```sql
select fornecedor_normalizado, numero_documento, valor_total, array_agg(id) as ids
  from itens_nfe
 where fazenda_id = $1 and nota_fiscal_id is null
 group by 1, 2, 3
having count(*) > 1
```

Agrupa por `(fornecedor_normalizado, numero_documento, valor_total)` —
mais solto que a chave da trava (não exige `descricao` idêntica nem
`ocorrencia_no_documento`), porque o objetivo aqui é avisar sobre
"provavelmente a mesma compra", não impedir gravação. Roda sobre a
FAZENDA INTEIRA (não só a página carregada) — senão duas linhas duplicadas
que caem em páginas diferentes do "carregar mais" nunca se veriam pintadas
juntas.

**Custo aceito, documentado:** essa consulta roda a cada `GET
/controle/itens` (toda página), é uma agregação simples sobre índice
existente (as 3 colunas do `GROUP BY` já são prefixo do índice de dedupe) —
barato na escala atual (poucas centenas de itens), mas cresce como
"escanear a tabela inteira a cada carregamento de página" se o volume
crescer muito. Mesmo tipo de trade-off que o projeto já aceitou em outros
lugares (ex.: `GET /controle/documentos` sem paginação, backlog conhecido).

**Pintura:** qualquer item cujo `id` apareça em algum grupo com `count > 1`.

Os dois casos alimentam o MESMO campo na resposta (`duplicado: boolean`,
`duplicadoMotivo` para diferenciar no tooltip da célula pintada — "linha
confirmada de novo numa reimportação" vs. "duas linhas parecidas nesta
grade").

## Trava de `conta_como_compra` — nunca vira gasto duplicado

Item de Controle é conferência, não fonte de gasto (o gasto real vem da
NF-e — decisão já travada em Epic 2.2). As três rotas novas (`PATCH`/`POST`
de item) escrevem `conta_como_compra: false` cravado no payload de
banco, NUNCA lido do corpo da requisição (campo fora do schema zod).
Coberto por teste dedicado em `controle.test.ts`: manda `conta_como_compra:
true` no corpo do PATCH/POST e confirma que o valor gravado no "banco"
mockado continua `false`.

## Frontend

### Estrutura de arquivos

- `web/app/(app)/controle/components/grade-itens.tsx` (novo) — substitui
  `tabela-documentos.tsx` como componente principal da tela (arquivo antigo
  fica, sem uso, até uma limpeza futura — não apagar código morto às pressas
  no meio desta tarefa).
- `web/app/(app)/controle/hooks/use-controle-itens.ts` (novo) — substitui
  `use-controle-data.ts` PARA A TELA NOVA. Mesmo cuidado do hook antigo com
  debounce só em filtro (não em toda mudança de `consulta`) e com
  `cancelado` guard contra resposta atrasada — reaproveita o padrão já
  aprovado, adaptado para "carregar mais" em vez de paginação por clique.
- Colunas da grade: Data | Fornecedor | NF | Produto | Quant. | Unidade |
  V.Unit. | V.Total | PDF (célula de ação, não editável, abre o documento
  de origem quando existir) — mesma ordem lógica da tabela antiga.

### Autosave (decisão 4)

`onChange(novoValor, operacoes)` da biblioteca dispara a cada edição
confirmada (Enter/Tab/blur) ou colagem. Para cada operação:
- `UPDATE fromRowIndex..toRowIndex`: para cada linha no intervalo, `PATCH
  /controle/itens/:id` com só os campos que mudaram (diff contra o valor
  anterior guardado em `ref`), debounced 400ms por linha (evita disparar um
  PATCH por tecla ao digitar um número longo — só dispara quando o usuário
  para de digitar naquela célula, ou confirma com Enter/Tab, o que vier
  primeiro).
- `CREATE fromRowIndex..toRowIndex`: linha nova (digitada no fim da grade,
  ou colada além do que já existia) → `POST /controle/itens`; a linha fica
  com um id temporário local (`temp-<uuid>`) até a resposta do servidor
  trocar pelo id real — mesmo padrão de "otimista, reconcilia depois" que o
  projeto não tinha usado ainda nesta tela, documentado aqui por ser novo.
- `DELETE fromRowIndex..toRowIndex`: `DELETE /controle/itens/:id` por linha
  removida.

**Falha de rede numa operação:** reverte só AQUELA linha para o valor
anterior (não a grade inteira) e mostra um aviso pontual — mesmo espírito
de erro-por-linha que `excluirDocumento` do hook antigo já usa
(`erroAcao`), adaptado para granularidade de célula/linha em vez de ação
única.

### Pintura de duplicata

Prop de estilo por linha da biblioteca (`rowClassName`/equivalente) lê
`duplicado` do item e aplica um fundo âmbar (`bg-amber-100`) — mesma
lógica visual de "chama atenção sem ser erro" que o projeto já usa para
outros destaques (ex.: `bg-sky-100` para nota agrupada no Financeiro,
`bg-red-*` para erro). Tooltip/título da célula usa `duplicadoMotivo` para
explicar qual dos dois casos é.

## O que fica de fora desta obra, registrado

- **Total do PDF por documento** deixa de aparecer inline na grade (ver
  decisão 2, "o que se perde") — só via botão "PDF" que abre o original.
- **`GET /controle/documentos` e a tela antiga não são removidos** — ficam
  mortos até decisão explícita de limpar.
- **Cursor-based pagination** não é construída agora (ver decisão 3) —
  offset com `porPagina` grande + "carregar mais" é o suficiente para a
  escala atual, documentado como próximo degrau se crescer muito.
