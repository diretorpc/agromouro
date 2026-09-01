# Design: exportação de Contas no formato do Livro Caixa

**Data:** 2026-09-01
**Status:** aprovado pelo Matheus em 01/09/2026 · implementado
**Modelo de referência:** `2026-09-01-modelo-extrato-livro-caixa.xlsx` (nesta mesma pasta,
cópia bit a bit do arquivo que o Matheus mandou). Guardado no repositório de propósito:
os índices de estilo cravados no código (Tarefa 1) só têm sentido contra ELE, e um
arquivo que mora só em `Downloads/` some.

---

## Contexto

Pedido do Matheus (01/09/2026): *"copia esse modelo de EXCEL, para ficar IDÊNTICO ao
nosso na hora de exportar as contas"*.

O modelo **não é uma lista de contas** — é um extrato bancário classificado (livro
caixa), com 18 colunas. O amarelo do cabeçalho conta a estrutura: **amarelo = coluna
que alguém preenche à mão**, branco = coluna que vem do extrato do banco.

A exportação atual (PR #76, no ar desde 31/08) tem 13 colunas próprias e um rodapé com
TOTAL. Ela **será substituída** — decisão do Matheus, tomada com o custo na mesa.

## Decisões (resolvidas em conversa antes deste documento)

1. **Substituir, não somar um segundo botão.** O botão "Exportar Excel" da aba Contas
   a Pagar passa a gerar o formato do modelo. **Custo aceito:** somem o rodapé de
   `TOTAL CONFIRMADO` / `TOTAL ESTIMADO` e a frase de descrição do recorte — os
   achados 1, 2 e 5 da revisão do Apolo de 31/08. O modelo não tem rodapé, e rodapé
   quebraria a colagem numa planilha mestre.
2. **DIA / MÊS / ANO saem da `data_pagamento`.** É livro caixa: registra quando o
   dinheiro SAIU. **Custo aceito:** conta ainda não paga sai com as três colunas em
   branco.
3. **As 7 colunas sem fonte de dado saem em branco** — `BANCO`, `AG`, `CC`,
   `DEPENDÊNCIA ORIGEM`, `TERCEIRO`, `IMÓVEL`, `INSCRIÇÃO IMÓVEL`. É fiel ao modelo,
   que já traz as três últimas vazias, e o amarelo do cabeçalho já sinaliza
   "preencha à mão".
4. **Conta de valor ESTIMADO não entra no arquivo.** O modelo não tem coluna,
   crachá nem rodapé onde marcar palpite, e toda ocorrência de conta fixa nasce
   estimada. **Custo aceito:** o arquivo passa a mentir por OMISSÃO — some conta e
   a planilha não tem onde avisar. Mitigação obrigatória: aviso âmbar na TELA, ao
   lado do botão, dizendo quantas contas ficaram de fora (ver Tarefa 5). É o
   último ponto antes do arquivo virar anexo de e-mail.
5. **Estilos COPIADOS do modelo, não reinventados.** O `xl/styles.xml` do modelo é
   pequeno (16 `cellXfs`) e autocontido. Vai para dentro do código verbatim, com as
   duas referências a tema (`<color theme="1"/>`, `<scheme val="minor"/>`) trocadas
   por valor literal para dispensar o `theme1.xml`. Descartado hand-authoring de
   fontes/fills/borders: daria "parecido", e o pedido foi "IDÊNTICO".
6. **Módulo NOVO, `lib/xlsx.ts` intacto.** `lib/xlsx.ts` é compartilhado com a
   exportação de Cartões. Trocar o `styles.xml` dele mudaria a planilha de Cartões
   de tabela, sem ninguém pedir.

## Mapa das 18 colunas

| Col | Cabeçalho | Fonte em `ContaAPI` | Observação |
|-----|-----------|---------------------|------------|
| A | BANCO | — | vazia (decisão 3) |
| B | AG | — | vazia |
| C | CC | — | vazia |
| D | DIA | `data_pagamento` | vazia se não paga |
| E | MÊS | `data_pagamento` | idem |
| F | ANO | `data_pagamento` | idem |
| G | DEPENDÊNCIA ORIGEM | — | vazia |
| H | HISTÓRICO | `fornecedor` + ` - ` + `descricao` | junta os dois; usa só o que existir |
| I | CUSTO/RECEITA | literal `Custo` | é Contas **a Pagar** — nunca receita |
| J | TRANSAÇÃO | `categoriaLabel(categoria)` | vocabulário nosso, não o do modelo |
| K | Nº DOCUMENTO | `notas_fiscais.numero` | vazio em conta fixa/avulsa |
| L | VALOR | `-Math.abs(valor)` | **sinal invertido** — no modelo custo é negativo |
| M | C/D | fórmula `IF(L{n}>0,"C","D")` | fórmula de verdade, com valor em cache |
| N | CC | `fazenda.codigo` em maiúscula | `MG`, `TJ`, `MT` |
| O | OBS | `observacao` | ver Tarefa 3 sobre o `ESTIMADO` |
| P | TERCEIRO | — | vazia |
| Q | IMÓVEL | — | vazia |
| R | INSCRIÇÃO IMÓVEL | — | vazia |

## Índices de estilo (lidos do modelo, não inventados)

Cabeçalho (linha 1): `A B C` → 1 · `D E F G H K R` → 2 · `I J` → 3 · `L` → 4 ·
`M N O P Q` → 1.

Dados: `A` → 5 · `B C I J K M` → 6 · `D E F` → 11 · `G` → 8 · `H O P Q R` → 7 ·
`N` → 15 · `L` → **10 quando negativo (vinho), 9 quando positivo (azul)**.

> O modelo foi editado à mão e não é 100% consistente entre as 4 linhas de exemplo
> (a coluna D aparece ora com `s=7`, ora com `s=11`). Onde há divergência vale o
> índice MAJORITÁRIO, contando **também as 225 linhas de gabarito vazias** — é por
> elas que `CC` usa `s=15`, que aparece em 1 linha de dado e em 225 de gabarito,
> e não `s=6`, que aparece em 3 de dado e nenhuma de gabarito. Nenhum índice foi
> inventado; todos existem no modelo, e um teste garante isso. Efeito colateral
> aceito e desejado: a nossa saída fica mais uniforme que o próprio modelo.
>
> **Uma exceção declarada:** `D E F` (DIA/MÊS/ANO) usam `s=11` nas três, embora o
> gabarito use `s=7` em `D`. São a mesma data partida em três colunas, e copiar a
> inconsistência faria uma delas alinhar diferente das irmãs. Visualmente as duas
> são equivalentes — `numFmtId=1` e General exibem 2026 igual, sem separador de
> milhar; a escolha é por uniformidade, não por formatação.
>
> A cor da coluna VALOR por sinal (azul receita / vinho custo) é padrão observado
> nas 4 linhas do modelo: linhas 2 e 3 (positivas) usam `s=9`, linhas 4 e 5
> (negativas) usam `s=14`/`s=10`, e a linha vazia de gabarito usa `s=10`.

### Conferido contra o modelo (01/09/2026)

Arquivo de amostra gerado e comparado célula a célula com `openpyxl`, normalizando
a cor de tema 1 (que É preto) para preto literal:

- **Cabeçalho: 0 divergências** nas 18 colunas — fonte, negrito, cor, fundo amarelo,
  borda, formato contábil e alinhamento, todos idênticos.
- **Corpo:** as únicas diferenças contra a linha 4 do modelo são de *alinhamento*
  em `G H L P`, e são exatamente as posições onde o modelo diverge de si mesmo.

## Tarefas

1. **`web/lib/xlsx-livro-caixa.ts` (novo).** Gerador do formato do modelo:
   `styles.xml` copiado, 18 colunas fixas, largura só nas colunas 7–12 e 15 (como o
   modelo), `sheetFormatPr defaultRowHeight="14.4"`, **sem** painel congelado e
   **sem** autoFilter — o modelo não tem nenhum dos dois. Suporte a `<f>` restrito à
   coluna M (nunca a texto vindo do banco: descrição que começa com `=` continua
   entrando como texto). Reaproveita `esc`, `letraColuna`, `dataParaSerial` e
   `baixarBlob` de `lib/xlsx.ts` — que passa a exportar `esc`.
2. **`web/lib/xlsx-livro-caixa.test.ts` (novo).** Abre o .xlsx gerado com `jszip` e
   confere: as 18 colunas na ordem certa, os índices `s=` por coluna, a fórmula da M,
   o sinal negativo da L, ausência de `autoFilter`/`pane`, e o caso de descrição com
   `=` na frente não virar fórmula.
3. **`web/app/(app)/contas/exportar.ts` (reescrita).** Sai `colunasExport`,
   `montarRodape`, `linhasDeTotal`, `descricaoDoFiltro`, `indiceDaColunaValor`,
   `HEADER_VALOR`. Entra `linhasLivroCaixa(contas, fazenda)`. Ficam
   `nomeArquivoExport` e `pareceTruncado` inalterados.
   Entram também `contasExportaveis` / `quantasEstimadas` (decisão 4) e
   `rotuloTransacao` — este último porque `categoriaLabel` devolve o valor CRU
   quando não conhece a categoria, e o caso mais comum do sistema cai aí: toda
   conta nascida de boleto de NF-e grava `categoria: 'insumos'`, que não está em
   `CATEGORIAS_FINANCEIRAS`. Sem tratamento, a coluna TRANSAÇÃO sai "insumos" em
   minúscula no meio de "Combustível". Consertado no exportador e NÃO no
   `categoriaLabel` compartilhado, que mudaria gráfico e crachá do Financeiro.
4. **`web/app/(app)/contas/exportar.test.ts` (reescrita).** Casos: data ausente →
   D/E/F vazios; valor positivo no banco → negativo na planilha; `valor` nulo →
   célula vazia (não zero); histórico com só um dos dois campos; fazenda nula.
5. **`web/app/(app)/contas/page.tsx`.** Trocar a chamada de `gerarXlsx(...)` por
   `gerarLivroCaixa(...)`. O `try/catch` fica (passa a reconhecer também o
   `xlsx-livro-caixa.ts` como defeito de código). Entram o **aviso âmbar** de
   contas estimadas fora do arquivo (decisão 4) e a trava do botão quando TODAS
   as contas do recorte são estimadas — senão o arquivo sairia vazio.
6. **Rodar `npm test` no `web/`** (468 testes verdes hoje) e revisar com o Apolo.

## O que este plano NÃO faz

- Não preenche `BANCO`/`AG`/`CC` a partir da fazenda — não existe esse dado no
  sistema. Quando existir, é uma linha em `linhasLivroCaixa`.
- Não mexe na exportação de Cartões nem em `lib/xlsx.ts` além de exportar o `esc`.
- Não traduz nossas categorias para o vocabulário do modelo (`Supermercado`,
  `diversos`). Sai `categoriaLabel` como está.
- Não filtra para "só contas pagas". Exporta o que está na tela, como hoje.
