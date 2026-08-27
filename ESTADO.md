# agromouro-base — estado detalhado

> Movido do `STATE.md` global em 03/08/2026; **reorganizado em 04/08/2026** (o dia
> tinha colado três blocos no fim, fora de ordem e com repetição — nada foi apagado,
> só reagrupado). Motivo de o arquivo existir: o painel global é injetado na largada
> de TODA sessão, inclusive quando você está em outro projeto. Aqui isto só é lido
> quando você está neste projeto.
>
> **Regra 1 — onde mora o quê.** Detalhe, número, data e história moram AQUI. O painel
> global guarda uma linha e aponta para cá. **Nunca copie de volta** — a mesma verdade
> em dois lugares acaba discordando.
>
> **Regra 2 — número que o sistema sabe responder NÃO se escreve aqui. Escreve-se o
> COMANDO que mede.** Contagem de teste, de commit, estado do `tsc`, saldo em banco:
> isso é pergunta, não afirmação. Quer registrar mesmo assim? Então é **HISTÓRIA** —
> com data, congelada e rotulada como tal.
>
> **Como este arquivo é organizado:** (1) o que está NO AR, (2) o que está ABERTO,
> (3) histórico por data, do mais novo para o mais velho.
>
> Histórico automático turno a turno: `~/.claude/.remember/agromouro-base/feito.md`

---

## 🔧 Nota de SERVIÇO não entrava pelo importador de PDF — 27/08/2026 — **revisado 4x, aguardando merge**

Ramo `fix/nfse-pdf-sem-quantidade`. Começou com o Matheus mandando uma NFS-e real
(MAQNELSON AGRÍCOLA, licença de software) e dizendo "o importador não conseguiu ler".

**O que era:** a IA leu a nota INTEIRA e certa. Quem recusou foi o nosso validador.
`validarNotaLida` exigia `quantidade > 0` em toda linha — régua de DANFE. **NFS-e não
tem as colunas QUANT/UN/V.UNIT**: tem "Discriminação dos Serviços" e um valor. A IA
devolveu `quantidade: null` (o certo), a única linha caiu, e a nota virou `sem-itens` →
422 *"Não consegui ler nenhum item desta nota"* — mensagem que mentia.

O caminho do **XML** já resolvia isso desde 17/08/2026 (`parseXmlNFSe` monta o item com
quantidade 1, `cfop: ''`, `ncm: ''`). O caminho do **PDF** nunca ganhou esse tratamento.

**O que o Apolo achou em cima do conserto — e era pior que o defeito original:**

1. **[alto] O gasto evaporava.** `servico: true` protege o ESTOQUE, não o DINHEIRO:
   `processarNFe` roda `efeitoDoCfop` em TODOS os itens sem olhar `servico`. Um CFOP
   que a IA inventasse numa NFS-e (5910 "bonificação", 5117, 5905) zerava o
   `valorCompra` e a nota gravava **sem lançamento nenhum**. E a IA inventa CFOP com
   frequência medida — ver memória `cfop-lido-como-5922`.
2. **[alto] Botão morto.** Com o 422 resolvido, a NFS-e chegava na tela e **não gravava**:
   `podeGravar` travava por `semCfop > 0`, e a única saída era o dono carimbar um CFOP
   5102 falso numa nota que não tem CFOP.
3. **[médio] Saída de 1 clique.** Trocar o campo "Tipo" para NFS-e apagava banner
   vermelho, banner âmbar e a trava do botão de uma vez — nota de produto entrava
   inteira como serviço, zero itens no estoque, nenhuma tela acusando.
4. **[médio] Passo 2 mudo.** `POST /nfe/importar-pdf` jogava `itensDescartados` fora:
   a nota gravava com parte das linhas e o painel fechava sem dizer nada.
5. **[médio] Trava fail-open.** A 1ª tentativa carregava `quantidade: 1` + marca
   `quantidadeInferida`, que viajava pelo navegador — bastava a chave não voltar para o
   "1" inventado entrar no galpão como mercadoria de verdade.

**Como ficou:**
- `ItemNotaLido.quantidade` e `.quantidadeTrib` são `number | null`. O `1` nasce só em
  `converterParaNFeData`. **Fail-closed:** perder o campo fortalece a defesa.
- `converterParaNFeData` zera `ncm`/`cfop` em NFS-e (espelho do `parseXmlNFSe`) — mas só
  na CONVERSÃO, para a tela continuar enxergando o `cfopLido` e poder avisar.
- Duas funções puras novas em `regras-conferencia.ts`: `codigoFiscalEmNotaDeServico`
  (banner âmbar: o papel traz NCM/CFOP mas o Tipo diz serviço) e `linhasSemQuantidade`
  (trava o botão em vez de deixar o dono bater no 422).
- `pendenciasDeCfop` cala CFOP em NFS-e — é o que destrava a gravação.
- Passo 2 recusa a nota inteira quando descartaria linha (422
  `itens-descartados-no-passo-2`) em vez de gravar metade.
- **Régua da DANFE não afrouxou:** quantidade ilegível continua derrubando a linha.

**Como conferir que continua de pé:**
```bash
cd api && npx tsc --noEmit && npx vitest run && cd ../web && npx tsc --noEmit && npx vitest run
```

**3ª rodada do Apolo — mais 5, sendo 1 [alto] que veio de um erro do próprio Apolo na
rodada anterior e passou por mim:**

6. **[alto] Linha inconsistente apagava gasto.** Eu preservava o valor unitário lido
   quando a quantidade era inferida — gravando `{quantidade: 1, unitário: 200,
   total: 600}`. O Financeiro **recalcula** `valor_total = quantidade × valor_unitario`
   ao salvar (`web/app/(app)/financeiro/page.tsx`, `handleEdit`), então abrir o item só
   para trocar o CENTRO DE CUSTO derrubava o gasto de R$ 600 para R$ 200. Num caso
   medido, de R$ 4.370 para R$ 0,01. Agora, sem quantidade impressa, o unitário É o
   total — sempre, espelho literal do `parseXmlNFSe`, com teste de invariante.
   *A justificativa antiga citava uma coluna de valor unitário na tela de conferência
   que não existe. Documento não confere sistema; o sistema conferiu.*
7. **[médio] Fio do front sem guarda.** Dava para arrancar a trava do botão do JSX e a
   suíte ficava verde com `tsc` limpo. `linhasSemQuantidade` virou parâmetro
   **obrigatório** de `podeGravar` — o compilador é a guarda que o teste não é.
8. **[médio] Detector cego no caso caro.** `sinaisDeNotaDeProduto` e olha TRÊS sinais: código fiscal, quantidade impressa e
   unidade de mercadoria. Motivo: o `SCHEMA` ensina que NFS-e é "sem CFOP/NCM", então a
   mesma decisão errada que rotula um DANFE como serviço tende a apagar os códigos dele
   — quantidade e unidade sobrevivem. O banner ganhou **botão** "É nota de produto —
   mudar o Tipo", pela regra que este repo já escreveu: quando a tela sabe o conserto,
   ela oferece o conserto.
9. **[baixo] `ncm: ''` é simetria, não defesa** — o NCM não é gravado em coluna nenhuma.
   Comentário corrigido para não prometer proteção que não existe.
10. **[médio] ORDEM DE DEPLOY: API primeiro, web depois.** Web nova + API velha reabre o
    achado 1 com a defesa da tela desligada — a web nova cala o banner de CFOP em NFS-e,
    e a API velha ainda não zera o CFOP alucinado. Não mergear a web sem a API no ar.

**Limite conhecido:** os consertos que moram no `.tsx` (célula "não impressa", célula
"Serviço", os três banners e os botões) **não têm teste** — o `web` não tem
testing-library instalada, é convenção do projeto. O fio mais perigoso (a trava do
botão) passou a ser protegido pelo `tsc`; os banners não.

**4ª rodada do Apolo — mais 6, e o [alto] de novo foi coisa minha da rodada anterior:**

11. **[alto] O botão que eu adicionei desligava a trava de duplicidade.**
    `editar('modelo', …)` marcava `identidadeEditada`, que apaga o banner "Esta nota já
    está no sistema" e libera o gravar. E o servidor **não recupera**: `modelo` faz parte
    da chave de duplicidade (`nfeJaProcessada(..., nota.modelo)` + índice único da
    migration 011), então a nota gravada como NFS-e não colide com a mesma gravada como
    NF-e — **estoque e gasto entrando duas vezes, calados**. O banner substituto ainda
    dizia "a conferência é refeita no servidor ao gravar", falso por construção.
    Conserto: `modelo` saiu do gatilho de `identidadeEditada`, e o banner vermelho passou
    a dizer que trocar o Tipo não resolve.
12. **[médio] O botão foi removido.** Além do item 11, ele era armado por um sinal com
    falso positivo. E o precedente de 25/08 não se aplicava: lá o conserto eram 19
    dropdowns contra 1 clique de dispensa; aqui é UM dropdown, na mesma tela.
13. **[médio] Quantidade sozinha era falso positivo.** NFS-e do padrão ABRASF traz
    "Qtde 1,00" — o aviso acenderia em nota de serviço legítima. Agora só conta
    quantidade **com** unidade de mercadoria.
14. **[médio] A trava mais antiga continuava opcional.** `efeitoIncomumPendente` — a que
    impede o gasto dobrado por CFOP incomum — também virou obrigatória em `podeGravar`.
15. **[alto] O `0` do valor unitário não vinha da IA: era fabricado por nós.** Um item
    `{q: 3, vu: null, vt: 6000}` era gravado com `vu: 0`, e o Financeiro zerava R$ 6.000
    no primeiro salvar. Agora unitário ilegível vira `total ÷ quantidade`, e um `0` lido
    contra total maior que zero recebe o mesmo tratamento. Zero só sobrevive quando o
    total também é zero (bonificação de verdade). Vale para DANFE e NFS-e.
16. **[baixo] `UNIDADES_DE_MERCADORIA` errava nas duas unidades que este projeto usa** —
    `TON` (fixture de DANFE) e `MTN` (contrato da SYAGRI). Corrigida; `M2`/`M3` saíram,
    porque são unidades corriqueiras de NFS-e de verdade.

**Backlog que saiu daqui, não consertado de propósito:** o Financeiro **recalcular**
`valor_total = quantidade × valor_unitario` no `handleEdit`. O item 15 tapou a ORIGEM do
zero, mas não a tela nem as linhas já gravadas com unitário 0 e total cheio — nessas,
abrir para trocar o centro de custo ainda apaga o gasto. Subiu para o L3 do painel global.

**Como medir a exposição das linhas já gravadas:**
```sql
select count(*) from itens_nfe
where valor_unitario * quantidade <> valor_total;
```

---

## 🔧 "O importar PDF não funcionou" — 25/08/2026 — **PRONTO, aguardando merge**

Ramo `fix/nfe-cfop-lido-errado-e-filtro-mes`. Começou como bug relatado e terminou
em três coisas, sendo que **a queixa original não era bug**.

**O que o Matheus viu:** importou a nota 289122 (RURALCENTRO) por PDF; ela não
apareceu na aba NF-e nem no Financeiro, só em Contas a pagar.

**O que era:** a nota estava íntegra no banco. Ela é de **04/07/2026** — data
confirmada pela chave de acesso do DANFE (`3126 07…`, AAMM = 2607), não é leitura
errada. A aba NF-e ordena por data de emissão e carregava tudo: a nota caiu na
posição 69. O Financeiro abre filtrado no mês corrente. Contas a pagar ordena por
vencimento (23/08), por isso apareceu. **Nada foi perdido; ninguém disse para onde
a nota tinha ido.**

**O bug de verdade, que estava escondido atrás da queixa:** os 19 itens entraram
com **CFOP 5922** (faturamento de entrega futura) quando o papel imprime 5102 e
5405 — conferido em duas leituras independentes do PDF, batendo linha por linha.
5922 tem `entraNoEstoque: false`: **nenhum item entrou no estoque**. O dinheiro
ficou certo por acaso (as duas famílias contam como compra).

É **reincidência**: o mesmo erro de leitura já estava documentado no prompt de
`api/src/services/nfe/notaPdf.ts` (caso de 24/08/2026). O aviso vermelho de
`precisaConfirmarEfeitoIncomum` DISPAROU e foi dispensado pela caixa "conferi no
papel" — porque o conserto de verdade eram 19 dropdowns, um a um, e a dispensa era
um clique. **Lição de desenho:** quando a tela sabe qual é o conserto certo, ela
tem que oferecer o conserto, não só o aviso e uma saída fácil.

**O que foi feito**

1. **Dado corrigido** — `supabase/correcoes/2026-08-25_cfop_nota_289122.sql`,
   executado pelo Matheus em 25/08/2026. Pasta nova, separada de `migrations/` de
   propósito: quem reconstruir o banco do zero não deve rodar correção de dado.
   **Não cria estoque retroativo** — `UPDATE` não faz o `processarNFe` rodar de
   novo, e o estoque de veterinária não é controlado aqui. Para item ESTOCÁVEL o
   caminho é outro (apagar a nota e reimportar), e o cabeçalho do arquivo diz isso.
2. **Botão "São todos compra normal"** no aviso vermelho da conferência de PDF.
   Conserta a nota inteira num clique, preservando o dígito de estado (6102 num
   item interestadual) e **sem tocar** em item de remessa/consignação, que a tela
   trava de propósito. A caixa "conferi no papel" continua, agora em letra pequena.
3. **Filtro de mês na aba NF-e** (pedido do Matheus). Três travas para ele não
   repetir o sumiço que veio consertar: abre no mês mais recente **com nota** (não
   no do calendário); depois de importar — PDF, XML ou manual — a lista **salta**
   para o mês da nota; e **a busca desliga o filtro de mês**, com aviso na tela.

**Achados do Apolo corrigidos neste mesmo ramo** (a revisão pegou dois [altos] que
eu mesmo tinha criado, e nenhum teste de função pura pegaria — os dois nasceram no
acoplamento entre a função e o componente):

- `aplicarFamiliaATodos` passava por cima da trava de item read-only e transformava
  remessa de depósito (5905) em compra nova, com estoque e gasto. Predicado virou
  função única (`itemTrancado`), usada pelos DOIS lados.
- Busca e mês estavam em E lógico: procurar a nota sumida pelo número devolvia zero.
- SQL confirmava sozinho antes da conferência (`SELECT` dentro da transação).
- **Financeiro** montava o mês padrão com `toISOString()` (UTC): das 21h do dia 31
  até a virada, a tela do dinheiro abria num mês vazio. Helper único em
  `web/lib/mes.ts`, usado pelas duas telas. Ganhou também guarda de nulo em
  `data_emissao` (a coluna aceita nulo no schema).
- `importarXmlManual` passou a devolver `dataEmissao` — o site adivinhava a nota
  pelo número na lista recarregada.

**O que continua aberto**

- **A leitura do CFOP erra na MAIORIA das notas em PDF, e o prompt endurecido não
  segurou.** Medido em 25/08/2026, depois do conserto da 289122: das **4** notas
  que entraram por PDF, **3** vieram com a nota inteira em 5922 — 289122 (19
  itens), 288911 (1 item) e 289134 (4 itens). A quarta (12728, ZAMPIERI) só está
  certa porque foi corrigida à mão na importação. **As três foram corrigidas e os
  dois arquivos de `supabase/correcoes/` FORAM EXECUTADOS em 25/08/2026** — checado
  depois por consulta direta: nenhum item com cfop 5922 restou no sistema. Cada PDF
  foi conferido em duas leituras independentes antes do SQL. Nenhuma delas pôs nada
  no estoque; dinheiro certo nas três. O botão conserta na hora da importação;
  ninguém conserta a leitura.
  Opção discutida e **não** implementada: segunda leitura só da coluna CFOP quando
  nenhum item vier como compra, marcando como ilegível quando as duas discordarem.
  Para achar as próximas, use a segunda consulta do bloco SQL abaixo.
- **Nota lida PARCIALMENTE errada escapa dos dois lados.** Se a IA acertar uma
  linha e errar as outras 18, `precisaConfirmarEfeitoIncomum` não dispara (ele exige
  que NENHUM item seja compra), então o aviso vermelho e o botão **não aparecem** —
  e a varredura com `bool_and` também não acha a nota. É o formato que a leitura vai
  produzir assim que acertar uma linha. A varredura já foi trocada para `bool_or`;
  o lado da tela continua aberto (gatilho por "algum item fora de compra" custa
  ruído em nota mista legítima, tipo "compre 20 leve 2" — decisão do Matheus).
  Achado [médio] da 2ª rodada do Apolo.
- **`cartoes/page.tsx` ainda usa `toISOString()`** para data padrão e mês do filtro
  — mesmo bug que o Financeiro acabou de perder. Fora do escopo deste ramo.
- **KPIs do topo da aba NF-e continuam globais** com a lista mensal: "1 pendente"
  sem nenhuma pendente na lista do mês. Sugestão do Apolo (não feita): KPI clicável
  que joga o filtro para "todos os meses" + o status correspondente.
- **`loadNotas` faz `.select('*')` sem `.limit()`.** Não é regressão deste ramo, mas
  se as notas passarem do teto do PostgREST os meses truncados somem do dropdown
  sem avisar — o mesmo tipo de teto que apareceu em Cartões.

**Verificado na tela** (login feito pelo Matheus, dev server local contra a API de
produção): filtro de mês cortando a lista, troca de mês, e a busca por `289122` com
o filtro em agosto trazendo a nota de julho com o aviso "a busca está olhando todos
os meses". **NÃO verificado na tela:** o aviso vermelho com o botão novo — depende
de um PDF lido como não-compra, e o navegador desta sessão não anexa arquivo. Está
coberto por teste de mesa, inclusive o caso do item de remessa.

Comandos que medem (nunca copie o número para cá):
```bash
cd web && npx vitest run && npx tsc --noEmit && npx next build
cd api && npx vitest run && npx tsc --noEmit
```
```sql
-- a nota 289122 continua honesta? (esperado: 5102 e 5405, nenhum 5922)
select cfop, count(*) from itens_nfe
 where nota_fiscal_id = 'ab80e71b-0e0a-4bf1-8f31-759678195725'
 group by cfop order by cfop;

-- notas de PDF contaminadas por 5922. bool_OR, nunca bool_and: nota em que a IA
-- acertou uma linha e errou as outras não sai com bool_and — e também não
-- dispara o aviso vermelho na tela. Esperado hoje: vazio.
select n.numero, n.emitente_nome, n.data_emissao,
       count(*) filter (where i.cfop = '5922') as itens_5922,
       count(*)                                as itens_total
  from itens_nfe i join notas_fiscais n on n.id = i.nota_fiscal_id
 where n.arquivo_pdf is not null
 group by n.id, n.numero, n.emitente_nome, n.data_emissao
having bool_or(i.cfop = '5922');
```

---

## ✅ Exportar Excel na aba Cartões — 25/08/2026 — **NO AR** (PR #71)

Botão "Exportar Excel" no cabeçalho de `/cartoes`. Exporta o que está na tela
(respeita filtro de mês e de cartão), como `.xlsx` de verdade: data como data,
valor como número, cabeçalho congelado e autofiltro.

Gerador próprio em `web/lib/xlsx.ts`, montando os XMLs do OOXML sobre o `jszip`
que já era dependência. **Não** foi instalada biblioteca de planilha: a `SheetJS`
publicada no npm carrega CVE-2023-30533 e a `exceljs` custa ~2 MB no bundle do
navegador. O preço dessa escolha é código artesanal — por isso `xlsx.test.ts`
existe, incluindo um teste que força o caminho de codificação do NAVEGADOR
(`support.nodebuffer = false`), porque o vitest roda em Node e o `jszip` usa
codificador diferente em cada ambiente.

**Teto de 1000 lançamentos revelado, não removido.** A consulta da página sempre
parou em 1000 e, ao estourar, descartava as notas mais antigas em silêncio — com
KPI, gráfico e (agora) arquivo todos concordando com a versão truncada. Passou a
vir `count: 'exact'` junto — e o alarme tem DUAS testemunhas, porque `count`
pode voltar nulo: bater no teto também dispara. A tela ganha faixa de aviso e o
arquivo sai com `parcial` no nome.

Comandos que medem (nunca copie o número para cá):
```bash
cd web && npx vitest run && npx tsc --noEmit && npm run build
```
```sql
-- quão perto do teto de 1000 estamos
select count(*) from lancamentos_financeiros where origem in ('cartao','manual');
```

**Ficou de fora, de propósito (fora do escopo):** `page.tsx` monta a data padrão do
lançamento manual e o "mês atual" do filtro com `new Date().toISOString()`, que é
UTC — depois das 21h no Brasil o formulário nasce com o dia seguinte, e num dia 31
joga o gasto para o mês errado. Bug pré-existente, achado na revisão do Apolo.

**Três achados da 3ª revisão que subiram sem correção** (a feature funciona; isto
é endurecimento, e o Matheus mandou subir mesmo assim em 25/08):

1. **A regra de truncamento é o único pedaço da feature sem teste** — e ela é
   justamente o alarme contra perda silenciosa de dado. Dois mutantes sobreviveram
   à suíte inteira: trocar `.limit(LIMITE_LANCAMENTOS)` por `.limit(500)` passa
   225/225 (aí a tela carrega 500, descarta o resto e nunca avisa); apagar a 2ª
   testemunha (`|| lancamentos.length >= LIMITE_LANCAMENTOS`) também passa.
   Conserto: extrair `estaTruncado(count, carregados, limite)` para `exportar.ts`
   como função pura e testar — é onde já mora a lógica testável desta tela.
2. **Com EXATAMENTE 1000 lançamentos e `count` funcionando, a tela alarma à toa** e
   o arquivo nasce `parcial` — sendo que o `count` prova que está completo. A
   informação que desfaria o engano é jogada fora no `?? carregados.length`.
   Conserto: guardar o `count` como `number | null` e só cair na 2ª testemunha
   quando ele for nulo.
3. **Se a busca de fazendas falhar, o botão morre mudo** — `fazenda-context.tsx`
   engole o erro, deixa `fazendaAtiva` nulo para sempre e não tenta de novo. A
   tabela aparece com 458 linhas, o botão fica desabilitado e o `title` continua
   prometendo "Baixar 458 lançamentos em Excel". Só F5 resolve. Falhar fechado
   está certo; falhar mudo, não. Conserto: uma linha no `title`.

---

## ✅ Adicionar NF em PDF — 24/08/2026 — **NO AR** (PRs #67, #68 e #69)

Subir o DANFE em PDF na aba Notas, conferir na tela e gravar pelo MESMO `processarNFe`
que o XML usa. Banco conferido na fonte viva (`arquivo_pdf`, `arquivo_hash`,
`idx_nfe_arquivo_hash`) e bucket privado `notas-pdf` criado.

Medir a suíte: `cd api && npm test` e `cd web && npx vitest run` (eram 634 e 172 antes
desta feature).

### PROVADO AO VIVO — nota 12728, ZAMPIERI ROCHA, 24/08/2026

Conferido no BANCO, não na tela (script de leitura no scratchpad da sessão):

```
status=processada · R$ 457 · emissão 07/08/2026 · PDF guardado · hash gravado
5 itens · soma R$ 457,00 = total da nota · centro de custo "manutencao" nos 5
LANÇAMENTO FINANCEIRO: R$ 457     CONTA A PAGAR: R$ 457 vence 06/09 [aberta]
MOVIMENTAÇÕES DE ESTOQUE: 0 (correto — material de construção não é estocável)
```

**O que a prova ao vivo pegou e nenhum teste pegaria:** a IA leu **5922** (faturamento de
entrega futura) nos cinco itens, quando o DANFE imprime **5405** em quatro e **5102** no
quinto. Nesta nota o dinheiro ficou certo por acaso; a mesma leitura numa nota de adubo
faria a mercadoria **não entrar no estoque, calada**. Os 5 itens foram corrigidos no banco
com o dono olhando o papel — `conta_como_compra` continua `true`, dinheiro intacto.

Conserto no PR #69, em duas frentes: o prompt manda COPIAR o número da coluna CFOP
(proibido deduzir da natureza da operação), e nota em que NENHUM item é "compra normal"
abre faixa vermelha e exige confirmação marcada antes de gravar.

**Lição:** o menu de efeito por item existia e não bastou — mostrava a resposta errada num
campo pequeno, e "parecia conferido". Informação certa sem PESO é pior que informação
ausente. Quem fechou o buraco foi o dono abrir o PDF e ler a coluna.

**Ainda NÃO medido:** o custo por leitura (Opus lendo o PDF). Conferir no console da
Anthropic e anotar aqui — número medido, nunca estimativa.

Medir a suíte: `cd api && npm test` (era 634 antes desta feature).

**Revisão do Apolo (24/08/2026): 10 achados, nenhum crítico — os 10 tratados.** Os dois
que mexiam em dinheiro:

1. **`tPag` do PDF não casava com a tabela.** O parser de XML normaliza para dois dígitos
   (`'3'` → `'03'`); o PDF passava a string crua, e a IA devolve tanto `'3'` quanto
   `'Cartão de Crédito'`. Efeito medido: nota de cartão COM duplicata criava o boleto mas
   perdia o aviso "Conferir antes de pagar" nos três lugares (conta, WhatsApp, resumo
   diário) — os três que existem para o dono não pagar a mesma coisa duas vezes.
2. **CFOP ilegível virava compra por omissão** (`efeitoDoCfop('')` = compra). Numa nota de
   entrega de pedido já pago isso conta o gasto de novo — o mecanismo exato dos R$ 1,2 mi
   da SYAGRI. **Decisão revista com o dono:** cada item ganhou menu de EFEITO em português
   ("Compra normal", "Entrega de pedido que já paguei", "Faturamento", "Bonificação"), a
   lista mora em `contas/cfop.ts`, e gravar fica travado enquanto houver item sem escolha.

Os outros 8: excluir nota apaga o PDF do bucket (a RPC da migration 009 não conhece
Storage); aviso quando existe nota de mesmo número no OUTRO modelo (NF-e × NFS-e fura as
duas travas de uma vez); aviso de duplicata deixa de travar o botão quando o dono corrige
a identificação; rodapé para de dizer "a diferença é frete" quando o dono removeu linha;
casca não apagável perde `arquivo_pdf`; limite de 10 MB barrado no navegador;
`ANTHROPIC_MODEL_NOTA_PDF` no `.env.example`.

**4 rodadas de revisão no total.** A 2ª pegou um CRÍTICO que o conserto da 1ª criou
(`tPagNormalizado` catava dígito de dentro de frase: "90 dias" virava tPag 90 = sem
pagamento, e a nota ficava SEM conta a pagar — pior que o defeito original, que gerava
boleto a mais). A 4ª fechou sem achado crítico, alto ou médio. **Lição do ramo: revisar o
conserto não é opcional — duas vezes o conserto virou o problema seguinte.**

**Deixado de fora, de propósito:**
- (Achado 9, 2ª rodada) falha de banco na checagem de duplicidade do passo 1 joga fora uma
  leitura de IA já paga. Custa centavos e um reenvio.
- (4ª rodada, desejáveis) a conta do rodapé da conferência é a única lógica de dinheiro
  que ficou dentro do componente, sem teste — se divergir do `nfeProcessor`, nada avisa;
  a tela mostra "Forma de pagamento: 15" sem dizer que 15 é boleto; quando o quadro de
  pagamento não é impresso (`formaPagamento` e `formaPagamentoLido` nulos) a nota também
  gera conta e a tela não avisa; e trocar a família some com o CFOP lido da tela.

**Ressalva do Apolo, não verificada:** o XSD da SEFAZ proíbe zero à esquerda em `nNF`
(NF-e), o que garante que PDF e XML gerem o mesmo `numero`. Ninguém conferiu se a mesma
proibição vale para `nNFSe`. Se alguém for importar NFS-e pelos dois caminhos, testar antes.

---

### Como estava quando o trabalho começou

Terceira opção no botão **Adicionar NF** da aba Notas: subir o DANFE (ou NFS-e) em PDF,
a IA lê, o dono confere na tela e confirma — e a nota entra pelo **mesmo
`processarNFe`** que o XML usa. Estoque, Financeiro, Contas a Pagar e aviso no WhatsApp
saem pelo cano que já existe; nada de cano paralelo.

Ramo: `claude/add-pdf-note-option-a586f8` (worktree `reverent-satoshi-2ebab4`).
Spec: `docs/superpowers/specs/2026-08-24-nfe-pdf-design.md` — 7 tarefas numeradas.
Plano: `docs/superpowers/plans/2026-08-24-nfe-pdf.md` — 7 tarefas numeradas.

Quatro decisões fechadas com o dono nesta sessão:
1. **Confere antes de gravar** (não grava direto como o XML) — cabeçalho editável.
2. **Mexe no estoque também**, igual ao XML (CFOP/NCM por item decidem).
3. **Guarda o PDF** em bucket privado `notas-pdf` + coluna `notas_fiscais.arquivo_pdf`.
4. **Aceita DANFE e NFS-e**; a IA classifica e o `modelo` fica editável.

**O risco que motivou a conferência:** o PDF é a IA lendo papel, não dado fiscal. Um
dígito errado no número ou no CNPJ fura `idx_nfe_numero_emitente_fazenda_modelo`, e
quando a mesma nota chegar pelo Make o estoque e o gasto contam duas vezes, calados —
o mesmo estrago da nota 58717 (11 ms de diferença, junho/2026). Trava atômica nova:
índice único parcial sobre `(fazenda_id, arquivo_hash)`.

**Próximo passo concreto:** dono revisar o spec → escrever o plano →
tarefa 1 (migration `supabase/migrations/013_notas_fiscais_pdf.sql` + bucket), com o
SQL colado no chat.

**Custo da leitura por nota: NÃO estimado de propósito** — medir na primeira nota real
e anotar aqui.

---

## ✅ Talhões arrendados — 24/08/2026 — **NO AR** (PR #66 mergeado)

Área arrendada para a Usina Uberaba: terra própria da família operada por terceiro.
`arrendado` virou o quarto valor de `talhoes.status`, com coluna `arrendatario` que o
banco só aceita preenchida nesse status. **Migration 021 JÁ APLICADA em produção.**

Objetivo escolhido pelo dono: enxergar o **patrimônio completo**. Contrato, valor e
vencimento ficaram FORA de escopo, explicitamente — nada tocou Financeiro nem Contas.

Spec: `docs/superpowers/specs/2026-08-24-talhoes-arrendados-design.md`
Plano: `docs/superpowers/plans/2026-08-24-talhoes-arrendados.md`

**Provado AO VIVO em produção, com o dono logado** (criado talhão de 80 ha arrendado
**com cultura cana**, de propósito — era o teste que importava; depois excluído):
- Dashboard: a cana ficou em 659,3 ha, **não subiu**. Fatia "Arrendado" apareceu separada.
- Talhões: "14 em operação · 1 arrendado", "sendo 80 ha arrendados", Culturas Ativas intacta.
- Operações: o arrendado NÃO aparece no seletor; os outros 14 sim.
- Custos: nem lista o arrendado. A afirmação da spec virou **medição**, não raciocínio.
- Desarrendar (editar → Ativo) zera o arrendatário e a CHECK do banco não barra.

**A revisão final achou o que 6 revisões de tarefa não viram: a "trava" existia em 1 das
3 portas.** `web/operacoes` tinha; `api/src/webhooks/whatsapp.ts` (`buscarTalhao`) e o POST
`api/src/routes/operacoes.ts` **não**. O WhatsApp é o canal principal do produtor e resolve
talhão por LIKE frouxo sem `.order()` — "Gogo" casa com Gogo I, II e III. Corrigido no
mesmo PR, com teste dos dois lados (recusa arrendado E aceita talhão normal).

Também corrigido: o badge do Dashboard pintava arrendado com a **cor de "colhido"**, porque
`StatusBadge` tipava o parâmetro como `string` e caia num fallback. Consertado TIPANDO como
`Talhao['status']` — fecha a classe, não só o caso.

**Lição de processo desta feature:** de 5 rodadas de correção, **3 foram em TESTES**, não em
código de produção. Os testes que eu especifiquei no plano passariam com o código quebrado —
o pior foi um que conferia `emOperacao + arrendada === total`, identidade verdadeira por
construção porque `emOperacao` é derivado por subtração. E uma "prova" por grep na Task 1
era **auto-confirmatória**: procurou o padrão TIPADO, que só acha o que o compilador já pega.
O site que importava era o não tipado.

Comando que mede: `cd web && npx tsc --noEmit && npx vitest run && npm run build`
e a suíte do `api/` do mesmo jeito.

**PR #66** — https://github.com/diretorpc/agromouro/pull/66 — MERGED (squash) na `main`
como `6a07b6f`, 17 commits. Branch apagada nos dois lados. Vercel e Railway sobem sozinhos.


---

# 1. NO AR — o que o sistema já faz

## Contas a Pagar + Financeiro: edição completa, 2 cards de KPI — PR #60 mergeado em 18/08/2026

https://github.com/diretorpc/agromouro/pull/60 — commit `3c2e8b4` na `main` (squash),
branch `fix/contas-edicao-completa` apagada (local e remoto). Railway/Vercel fazem
deploy automático.

Pedido do Matheus: um boleto chegou do email com centro de custo errado (Insumos em
vez de Combustível) e não tinha como editar — nem a conta em "Contas a Pagar", nem o
lançamento que ela já tinha criado no Financeiro. Depois de testar a correção de
categoria, ele pediu edição COMPLETA (descrição, fornecedor, categoria, valor, data)
nos dois lugares — não só categoria.

**Contas a Pagar:** dialog "Editar" cobre tudo agora, sem gate de status (funciona até
em conta já paga/dispensada). 2 cards novos no topo: "Próximo vencimento do mês" (mês
real de hoje, não olha filtro) e "Total de contas pagas" (reage só ao filtro de mês).

**Financeiro:** lançamento de "conta paga" ganhou checkbox de seleção em massa (troca
`lancamentos_financeiros.categoria`, separado de `itens_nfe.centro_custo`) e dialog de
edição próprio (fornecedor/descrição separados na tela, recombinados no mesmo formato
que o backend grava — `separarFornecedorDaConta`/`handleEditarConta`).

**Correção crítica achada na revisão do Apolo (2ª rodada):** `PATCH /contas/:id`
reabria conta já PAGA (status voltava pra `'aberta'`) toda vez que o corpo incluía
`valor` — o novo dialog de edição completa reenvia esse campo sempre, mesmo editando só
a categoria. Sem a correção: conta paga reaparecia como devendo no resumo do WhatsApp,
e "pagar" de novo criava lançamento duplicado no Financeiro (gasto dobrado). Corrigido
em `api/src/routes/contas.ts`: status/`valor_estimado` só mudam quando a conta ainda
não está paga/dispensada **e** o valor de fato mudou. Coberto por
`api/src/routes/contas.test.ts` (6 casos novos, nasceu nesta PR — rota não tinha teste
próprio antes). Suite completa: 316/316.

Revisão também corrigiu: aviso do Financeiro só aparece quando existe lançamento de
verdade (boleto de nota nunca cria um — o gasto já está nos itens da NF-e); card "Total
de contas pagas" agora inclui conta paga sem vencimento (fallback pra
`data_pagamento`); preserva o texto original ao limpar um "fornecedor" que era só
split automático da descrição (não editado antes); aviso de risco de duplicar boleto ao
editar valor/vencimento/fornecedor de conta vinda de nota fiscal (dedupe do
`gravarBoletoPdf.ts` usa esses 3 campos — risco latente, não observado em produção,
aceito documentado em vez de resolvido com migration agora).

`api/src/index.ts`: CORS libera qualquer `localhost:*` só fora de produção — facilita
teste local quando várias sessões Claude ocupam portas diferentes (achado de uma
sessão anterior, mesma PR).

## Financeiro: origem "Conta paga" mostra o fornecedor — PR #59 mergeado em 18/08/2026

https://github.com/diretorpc/agromouro/pull/59 — commit `037f51c` na `main` (squash),
branch `fix/financeiro-origem-conta-paga` apagada (local e remoto). Railway/Vercel
fazem deploy automático da `main`.

Pedido do Matheus: lançamento vindo de conta a pagar quitada (`lancamentos_financeiros`
com `origem = 'conta'`) mostrava só o crachá genérico "Conta paga" na coluna Origem da
tela Financeiro — diferente dos lançamentos de NF-e, que mostram o nome do fornecedor.

**Descoberta:** o backend (`api/src/services/contas/pagamento.ts`, função
`montarLancamento`) já grava o fornecedor dentro do campo `descricao`, no formato
`"FORNECEDOR — resto da descrição"` (separador é espaço + em-dash U+2014 + espaço) —
intencional, só nunca foi separado de volta na tela.

**Corrigido só no frontend, sem migration:** `web/app/(app)/financeiro/page.tsx` ganhou
`separarFornecedorDaConta()` + `textoDescricaoExibido()` (fonte única do texto exibido,
usada tanto na célula quanto na ordenação da coluna). Fornecedor vai pra coluna Origem
(nome em negrito + crachá esmeralda pequeno "Conta paga" embaixo, pra continuar
diferenciando de nota fiscal); o resto fica em Produto/Serviço, sem repetir o
fornecedor. Sem separador válido (ou fornecedor/resto vazio após trim), cai no
comportamento antigo — crachá genérico, texto completo.

**2 rodadas de revisão do Apolo, ambas com achados corrigidos antes do merge:**
1. Ordenação da coluna "Produto/Serviço" quebrada (comparava texto com fornecedor,
   exibia só o resto) — corrigido com `textoDescricaoExibido()` como fonte única.
   Célula podia ficar muda (descrição terminando logo após o separador) — corrigido
   com `.trim()` + fallback.
2. Fornecedor não era trimado (podia renderizar nome/linha em branco com espaço) —
   corrigido, trim nos dois lados agora. Variável morta (`descricaoConta` calculada e
   nunca usada, função rodando 2x por linha) — removida.

**Risco aceito por decisão do Matheus (não é bug, é escolha registrada):** o parser
detecta o SEPARADOR, não o fornecedor de verdade — uma conta SEM fornecedor cuja
descrição digitada à mão contenha " — " pode gerar um "fornecedor" inventado na coluna
Origem. Chance baixa (exige o dono digitar esse traço exato numa conta sem fornecedor),
não mexe em nenhum valor de dinheiro — só apresentação. Conserto definitivo exigiria
coluna própria de fornecedor em `lancamentos_financeiros` (migration) — decidido não
fazer agora, documentado em comentário no código (`page.tsx`, perto de
`separarFornecedorDaConta`).

**Verificado:** função testada isolada em Node (várias vezes, incluindo espaços em
branco e casos limite) — bateu certo nas duas rodadas. `npx tsc --noEmit` limpo.
Matheus conferiu ao vivo no navegador antes do PR ir pro ar e confirmou o merge.

## Financeiro: cor de destaque pra nota agrupada — corrigido em 17/08/2026, commitado (`19ed6eb`)

Pedido do Matheus: quando uma nota tem vários itens (linha expansível "N itens desta
nota", em `web/app/(app)/financeiro/page.tsx`), o cinza que marcava os itens do grupo
(`bg-muted/20`) era quase invisível — difícil ver onde uma nota termina e a próxima
começa.

**Trocado por azul claro** (`bg-sky-100`, cabeçalho + itens). Achado do Apolo na 1ª
rodada de revisão **[alto]**: o `TableRow` base do projeto (`web/components/ui/table.tsx:60`)
já injeta `has-aria-expanded:bg-muted/50`, que sobrevivia à mesclagem do tailwind-merge
contra a classe azul nova e ganhava por especificidade — a cor só aparecia com a nota
**FECHADA**, sumia ao abrir (o estado que mais importava, já que foi o pedido original).
Corrigido acrescentando os mesmos modificadores (`has-aria-expanded:`) na classe nova,
pra vencer a regra embutida do componente sem mexer nele (evita quebrar outras telas que
usam a mesma tabela).

2ª rodada do Apolo confirmou a correção com o compilador Tailwind real do projeto +
`tailwind-merge` real + hover simulado em Chrome headless de verdade (não só leitura) —
sem achado bloqueante. Testado visualmente também no navegador (Browser pane) pelo
Claude: nota fechada, aberta e com hover, os três estados ficam azuis.

**Duas notas de baixa prioridade, sem código pendente:** a tela irmã
`web/app/(app)/contas/lista-contas.tsx` tem o mesmo padrão de agrupamento e **não**
recebeu a mesma cor — decisão explícita de não mexer, ficou fora do pedido. Se a mesma
reclamação aparecer lá, o remédio é igual. Em tela de toque (tablet/celular) o efeito de
hover não existe (`@media (hover: hover)` do Tailwind) — só o fundo persistente aparece.

Depois disso o Matheus ainda achou o azul fraco nos ITENS da nota — escurecido de
`bg-sky-100/40` pra `bg-sky-100` sólido (mais forte que o próprio cabeçalho), sem
rodada extra do Apolo por ser ajuste de contraste, não de lógica.

**Commitado na branch `feature/colunas-redimensionaveis`** (junto com a feature
abaixo, que nasceu na mesma sessão) — depende de merge/PR pra chegar na `main`.

## Financeiro: colunas redimensionáveis (Fase 1 — só a tabela do Financeiro) — 17/08/2026

Pedido do Matheus: arrastar a borda de uma coluna da tabela pra mudar a largura, com
a largura salva. Confirmado em conversa: é redimensionar (não reordenar), vale pras
9 telas com tabela do sistema, mas construído e validado numa só antes de replicar.
Desenho completo: `docs/superpowers/specs/2026-08-17-colunas-redimensionaveis-design.md`.
Plano: `docs/superpowers/plans/2026-08-17-colunas-redimensionaveis.md`.

**No ar (Fase 1, só Financeiro):** hook `web/lib/use-column-widths.ts` (largura por
coluna, arrasto via ponteiro, salva em `localStorage` por tabela) + componente
`web/components/ui/column-resize-handle.tsx` (faixa de 6px na borda) +
`SortableTableHead` (`web/components/ui/sortable-table-head.tsx`) ganhou `style`/
`resizeHandle` opcionais, sem quebrar os outros 11 usos (Contas a Pagar incluído).

**Achado sério, corrigido:** `w-auto` na tabela não fazia ela encolher pro conteúdo —
`width:auto` num `<table>` (bloco) preenche o contêiner igual `width:100%`, então a
coluna arrastada salvava certinho mas não mudava de tamanho NA TELA. Testado ao vivo
no navegador pelo Claude antes de prescrever a correção. Trocado por `w-max`
(`width: max-content`) — confirmado ao vivo que resolve, e que a rolagem horizontal
do card continua funcionando quando a tabela fica mais larga que o card.

**Achado da revisão final de branch, corrigido:** `table-layout: fixed` sem
`overflow-hidden` nas células deixava texto/valor que não cabe vazar por cima da
coluna vizinha ao encolher (ex.: arrastar "Valor Total" pro mínimo). Corrigido
acrescentando `overflow-hidden` nas células — commit `da29ff8`.

**Fica pra depois, registrado e não esquecido (backlog da Fase 2, não bloqueou este
merge):**
- Replicar `ResizableTableHead`/mecanismo pras outras 8 telas com tabela (Contas,
  Operações, Estoque×2, NF-e, Talhões, Cartões, Custos) — hoje só Financeiro tem.
- O mecanismo ficou "soldado" no `SortableTableHead`, não virou um wrapper genérico
  como o desenho original previa — decidir isso ANTES de começar a Fase 2, porque
  Contas a Pagar tem coluna não-ordenável (sem caminho pra redimensionar hoje) e
  Estoque usa um `SortableTableHead` próprio, com API diferente.
- Risco de hydration mismatch (o hook lê `localStorage` no `useState` inicial) —
  o Financeiro escapa por acidente porque a tabela só existe depois do loading
  skeleton; telas que renderizam a tabela no primeiro paint vão sofrer isso.
- Re-render da página inteira a cada `pointermove` durante o arrasto (barato hoje com
  poucas linhas visíveis, pode pesar com "Carregar mais" em uso).
- Escrita no `localStorage` dentro do updater de `setState` (funciona, mas é padrão
  frágil — deveria ler de um `ref`, não do `prev` do updater).
- Arrastar até o mínimo (60px) numa coluna de cabeçalho comprido (ex.: "Produto /
  Serviço") às vezes não encolhe visualmente até lá — trava num piso maior definido
  pelo texto do cabeçalho (`nowrap`). Estado interno salva 60 certinho, só o visual
  fica maior que o esperado nesse extremo.
- Faixa de arrastar não é operável por teclado (sem `tabIndex`/setas).

**Na branch `feature/colunas-redimensionaveis`**, revisada por Apolo (por tarefa +
revisão final de branch inteira) — depende de merge/PR pra chegar na `main`.

## Boleto lido de PDF quando a NF-e chega sem XML — PR #56 mergeado em 14/08/2026

https://github.com/diretorpc/agromouro/pull/56 — commit `15cc642` na `main`, branch
`feat/readboletos` apagada (local e remoto). Railway faz deploy automático da `main`.
**Ainda não confirmado rodando em produção:** a prova é a próxima NF-e que chegar
por e-mail só com PDF.

**O defeito.** Fornecedor manda a nota e o boleto em PDF, sem XML. O job de e-mail
só olhava anexos `.xml`, então o e-mail inteiro era ignorado: sem gasto, sem estoque,
sem boleto, sem aviso. O boleto vencia no silêncio. Caso que provou: boleto da
UBE TERRA de R$ 730,50 vencendo 17/08, que não estava no sistema — cadastrado à mão
em 14/08 (ver seção própria abaixo).

**O que faz.** `contas/boletoPdf.ts` manda o PDF para `claude-opus-5` (document block
base64 + `output_config.format` json_schema, effort low) e valida o retorno;
`contas/gravarBoletoPdf.ts` grava a conta com a tarja `PREFIXO_CONFERIR`; o job avisa
no WhatsApp. **Só o boleto, nunca a nota inteira** — quatro números grandes e
padronizados, com erro visível na tela antes de pagar; a nota tem dezenas de linhas e
um dígito errado entraria no estoque calado. Nota continua exigindo XML.

**Três rodadas de revisão do Apolo, cada uma achando defeito na correção da anterior:**

1. 8 achados, 1 crítico — boleto em e-mail que também tinha XML nascia solto
   (`nota_fiscal_id: null`) e **dobrava o gasto** ao ser pago.
2. A correção do crítico **inverteu o defeito**: amarrar a qualquer nota fazia o gasto
   **sumir** no caso ERCAL (nota de remessa não lança gasto). Corrigido com
   `idDaNotaQueLancouGasto()` — só amarra quando a nota de fato lançou. Mais 8 achados,
   incluindo erro de banco perdendo o boleto e **zero teste** protegendo as correções
   (ele mediu 10 mutações passando limpas).
3. Medida com PDF real: boleto cedido a FIDC traz o **fundo** no campo "Beneficiário";
   o fornecedor está em "Beneficiário Final". Sem isso, conta repetida em toda compra
   financiada, e um nome que o dono não reconhece na tela.

**Rede de segurança** (cada item veio de um achado): falha de leitura ou de banco não
marca o e-mail como lido (volta em 30 min); carnê avisa quantas parcelas ficaram de
fora; teto de 5 PDFs por e-mail e 20 por ciclo; falha persistente avisa no WhatsApp no
3º ciclo; trava contra o job rodar sobreposto (vale por processo — **2 réplicas no
Railway quebram**, e o índice único da migração 006 não protege este caminho porque
grava `numero_parcela` NULL).

**Decisão do dono, registrada no código:** SEM filtro de remetente. A caixa é pessoal
(`IMAP_USER` é hotmail), então TODO PDF de TODA mensagem não lida vai para a API da
Anthropic — extrato de banco, escola, médico incluídos. Ele preferiu isso a arriscar
perder um boleto de fornecedor fora de uma lista. Perguntado e respondido em 14/08.

**Também subiu junto:** `@anthropic-ai/sdk` 0.27.3 → 0.117.1 (a 0.27 não tipa document
block nem `stop_reason: 'refusal'`), e o conserto de um defeito antigo do job — o
`continue` que pulava o `messageFlagsAdd` fazia todo e-mail sem XML ser reprocessado a
cada 30 min para sempre.

Para medir os testes e os tipos, rodar (não copiar número daqui):
```bash
cd api && npm test && npx tsc --noEmit
```

Para refazer a leitura de um PDF de boleto de verdade:
```bash
cd api && DOTENV_CONFIG_PATH=../.env npx tsx -r dotenv/config -e "import {lerBoletoDoPdf} from './src/services/contas/boletoPdf';import Anthropic from '@anthropic-ai/sdk';import {readFileSync} from 'fs';lerBoletoDoPdf(readFileSync(process.argv[1]),'b.pdf','$(date +%F)',new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY})).then(r=>console.log(JSON.stringify(r,null,1)))" CAMINHO_DO_PDF
```

**Backlog que ficou aberto** (achados aceitos, não consertados): PDF hoje + XML da mesma
nota semana que vem cria duas contas, e se o dono dispensar a da nota e pagar a solta o
gasto DOBRA — o conserto seria `gravarContasDaNota()` adotar conta solta com mesmo
valor+vencimento em vez de criar outra. Também: com várias notas no mesmo e-mail o
boleto é amarrado à primeira, e vínculo errado faz a exclusão em cascata da migração 009
apagar boleto de outra nota.

## Reorganização Financeiro + Contas a Pagar — PR #55 mergeado (squash) em 10/08/2026

https://github.com/diretorpc/agromouro/pull/55 — branch `fix/telasfin` apagada (local e remoto)
depois do merge. ⚠️ Mesmo padrão de incerteza de outros itens desta seção: Vercel faz deploy
automático no push pra `main`, **não confirmado de fora** que já está servindo o código novo, e
o Matheus ainda não testou visualmente no navegador com login de verdade.

Pedido de 10/08/2026: as duas telas de dinheiro "cospem número demais na cara". Pesquisa de
mercado (Aegro, Traction Ag/Conservis, SSCrop) confirmou o padrão: resumo separado do detalhe,
"a pagar" nunca misturado com histórico infinito. Nada mudou por baixo (NF-e, WhatsApp, banco)
— é reorganização de tela. 10 tarefas do plano original implementadas por subagentes e
revisadas uma a uma + o branch inteiro junto (`superpowers:subagent-driven-development`), mais
4 rodadas de ajuste pontual pedidas por ele depois de testar ao vivo. Detalhe completo, achados
menores registrados e plano tarefa-a-tarefa: `docs/superpowers/plans/2026-08-10-reorganizacao-financeiro-contas.md`
e `docs/superpowers/specs/2026-08-10-reorganizacao-financeiro-contas-design.md`.

**Financeiro:** abre no mês atual (era "todos os meses"), gráfico top-5 categorias, lista
paginada (20/vez), filtro de origem em menu, resumo separado do detalhe, grade completa nas
células (bordas, estilo escolhido por ele em protótipo visual), texto longo quebra linha em
vez de cortar com "...", **nota com mais de 1 item vira 1 linha resumida expansível** (soma o
valor, mostra selo por categoria, avisa se algum item não conta como gasto).

**Contas a Pagar:** dispensada some da aba "Todas" por padrão (aba "Dispensadas" dedicada),
resumo separado (rótulo "Resumo geral" — os 3 números não seguem o filtro de tipo, ao
contrário do Financeiro), filtro de tipo em menu, filtro de mês por vencimento (atrasada e sem
vencimento sempre aparecem, em qualquer mês — decisão de segurança, não some dívida ativa),
lista paginada (50/vez), todo filtro com quantidade (corrigiu achado do Apolo de 10/08: contador
ignorava o filtro de tipo), "Todas" esconde paga com mais de 30 dias (aba "Pagas" sem limite),
mesma grade/texto-sem-corte do Financeiro, **boleto agrupado só quando nota + vencimento + status
forem iguais** (parcela com vencimento diferente NUNCA agrupa — decisão dele, evita esconder
data de pagamento).

**Ordenação por coluna** (clicar no título tipo "Vencimento"/"Valor" reordena, clica de novo
inverte) — nas duas telas, generalizado do que só existia na coluna Data do Financeiro.

A revisão final do branch achou e corrigiu 1 bug real (padrão de mês novo tinha quebrado o
botão "Limpar" e a URL). Duas rodadas de agrupamento por nota (Financeiro e Contas) tiveram
achado de dinheiro corrigido antes do merge: crachá de "não conta como gasto"/"valor
incompleto" escondido na linha resumida.

## Categoria oficial unificada + parcelamento em Contas a Pagar — commitado e enviado ao GitHub em 11/08/2026

Push feito (`f0f87ca`, `main`) — ⚠️ mesmo padrão de incerteza dos outros itens desta seção:
deploy automático da Vercel esperado, **ele testa em produção depois do push** (não é um
teste feito por mim antes de enviar, dessa vez).

**Parte 1 — categoria duplicava barra no gráfico "Gastos por Categoria" do Financeiro.**
"Manutenção" digitado à mão numa conta paga virava categoria diferente de `manutencao`
vinda de nota fiscal — duas barras pro que era a mesma coisa. `web/lib/centro-custo.ts`
(novo) virou a lista oficial única, com função que casa texto digitado à mão com a
categoria oficial ignorando acento/maiúscula. Revisado 4x pelo Apolo (achado crítico na
1ª rodada: caixa de sugestão de categoria podia cobrir o botão Salvar e trocar a
categoria escolhida sem avisar — corrigido). Categoria "Royalties" adicionada à lista
depois, a pedido dele (commit `85649b2`).

**Parte 2 — parcelamento em "Nova conta avulsa".** Pedido dele: em vez de cadastrar uma
compra parcelada (ex: trator em 4x) uma parcela de cada vez, uma caixinha "Parcelar esta
conta" cria as N contas de uma vez — mesmo valor em cada uma (não divide, decisão dele),
vencimento um mês depois do anterior, descrição ganha "(i/N)" sozinha. Backend gera as N
linhas e insere todas juntas (atômico — ou nasce tudo, ou nada). Feito com
`superpowers:subagent-driven-development` (3 tarefas, cada uma com implementador +
revisor próprios) + revisão final do branch inteiro — achou e corrigiu 1 bug real antes
do merge: filtro de mês da tela escondia as parcelas recém-criadas (a maioria vence em
mês futuro), parecendo que o salvamento tinha falhado calado. Desenho completo:
`docs/superpowers/specs/2026-08-11-contas-avulsa-parcelamento-design.md`; plano
tarefa-a-tarefa: `docs/superpowers/plans/2026-08-11-contas-avulsa-parcelamento.md`.

**Ainda não testado ao vivo por ninguém** (nem por mim — tela atrás de login, proibido eu
digitar senha; nem por ele, ainda) — 245/245 testes do backend e checagem de tipos do
frontend passaram, mas o teste real (criar 4 parcelas de verdade, conferir que aparecem e
que uma conta normal sem parcelar continua igual) fica para ele em produção.

## Upload manual de XML — porta cega fechada, no ar desde 05/08/2026

**PR #46 mergeado** (`3ea4f04`, squash) — https://github.com/diretorpc/agromouro/pull/46.
Upload de XML e "Excluir nota" passaram a usar rotas do servidor
(`POST /nfe/importar-xml`, `DELETE /nfe/:id`), que reaproveitam o mesmo processador do
e-mail — antes a tela gravava direto no banco, sem ler CFOP. Modo "Manual" passou a criar
o item do gasto. Exclusão virou função atômica no Postgres: devolve estoque, apaga boleto
e lançamento financeiro, ou nada acontece.

Migração `supabase/migrations/009_excluir_nota_fiscal.sql` **já rodada em produção** — foi
ela que permitiu o teste ao vivo abaixo. Para reconferir em vez de acreditar neste texto,
no SQL Editor do Supabase:
`select proname from pg_proc where proname = 'excluir_nota_fiscal';`

**Duas rodadas de revisão do Apolo** — 15 + 2 problemas achados (lançamento fantasma ao
excluir, exclusão sem transação, boleto pago apagado sem rastro, envenenamento no caminho
de erro do upload, fazenda vinda do corpo do pedido em vez do login, WhatsApp derrubando
importação boa quando a rede falha, função do banco sem trava de permissão). Todos os
críticos/altos e os 2 bloqueantes foram corrigidos. Ficaram 7 achados médios/baixos,
documentados no PR, decididos como não-bloqueantes pelo próprio Apolo.

✅ **HISTÓRIA de 05/08 — testado por ele, ao vivo, contra o banco de produção:** XML de
nota de serviço → rejeitado com aviso claro. XML já processado → "nota já está no
sistema", sem erro técnico. XML de nota nova (sintética, "EMPRESA TESTE") → importou,
CFOP lido, insumo criado e vinculado, estoque foi a 10 KG. Excluiu a nota → estoque
voltou a **exatamente 0** (achado 3, transação atômica) e o gasto de R$ 50 **sumiu do
Financeiro** (achado 1, lançamento fantasma) — sem sobrar rastro nos dois casos. Os 5
críticos + 2 bloqueantes das revisões do Apolo estão confirmados na prática, não só em
teste automatizado.

⚠️ Railway e Vercel fazem deploy automático no push — **não confirmado de fora** que os
dois já servem o código novo (mesmo padrão de incerteza da Fase 2 de contas a pagar em
31/07).

## Estoque: fazenda_id nas gravações manuais — no ar desde 06/08/2026

**PR #49 mergeado** (`3309300`, squash), branch `claude/nervous-torvalds-4a56e7`
apagada. Achado independente do bug de isolamento por fazenda do PR #48: em
`web/app/(app)/estoque/hooks/use-estoque-data.ts`, 5 gravações (`ajustarEstoque`,
`criarInsumo`, `converterUnidade`) não mandavam `fazenda_id` (coluna `NOT NULL` sem
padrão, regra de permissão do banco exige o valor) e nenhuma conferia erro de retorno —
falha muda. Sintoma: saldo mudava na tela, o histórico que deveria explicar por quê
nunca era gravado.

**3 rodadas de revisão do Apolo**, cada uma achando problema na correção da anterior:
(1) `fazenda_id` ausente + falha muda; (2) estado parcial em falha de rede — converter
unidade podia trocar o rótulo sem a quantidade, cadastrar insumo podia deixar produto
"fantasma" preso pelo índice único de nome; (3) a própria correção do item 2 podia
deixar a tela desatualizada quando só o histórico falhava por último, arriscando
repetir a operação. Confirmado em produção (`SELECT ... FROM pg_policies`) que as 3
tabelas têm política `FOR ALL` — as compensações (desfazer o passo anterior) têm
permissão pra funcionar.

⚠️ **Não testado ao vivo** (diferente do PR #46/#48) — só revisão de código + `tsc
--noEmit` limpo. Vercel/Railway fazem deploy automático no push; não confirmado de
fora que o ar já serve este código.

## Operações: fazenda_id condicional na exclusão — no ar desde 06/08/2026

**PR #51 mergeado** (`7c8cddd`, squash), branch `claude/zen-mayer-9a5a06` apagada
(local e remota). Achado pelo Apolo durante a correção do Estoque (seção anterior),
enquanto ele lia `use-estoque-data.ts` em busca de padrões repetidos — mesma família
dos dois bugs acima (PR #48 e #49).

Em `web/app/(app)/operacoes/page.tsx`, função `confirmarDeleteOp` (apaga uma operação e
devolve os produtos usados ao estoque): o insert em `movimentacoes_estoque` mandava
`fazenda_id` só condicionalmente — mesmo sintoma dos outros dois, saldo mudava sem o
registro que explica por quê.

**4 rodadas de revisão do Apolo**, cada uma achando problema na correção da anterior:
(1) `fazenda_id` condicional → obrigatório + guarda de `fazendaAtiva`; (2) delete da
operação e update do saldo sem checar erro → checados (decisão do Matheus: resolver só
isso agora, sem função no banco — ver adiados abaixo); (3) a própria correção do item 2
introduziu 3 bugs (variável de controle ligando tarde, `return` de erro sem recarregar
os dados, botão "Excluir" continuando clicável depois de erro parcial) → corrigidos;
(4) comentário prometendo trava permanente que o código não entregava + mensagem de
erro antiga não sendo limpa ao abrir nova tentativa → 2 ajustes triviais.

**Confirmado com o Matheus rodando SQL no Supabase:** `itens_operacao_operacao_id_fkey`
tem `confdeltype = c` (cascata) — apagar uma operação apaga os itens vinculados
automaticamente, sem risco de exclusão travada por vínculo.

⚠️ **Não testado ao vivo** — só revisão de código + `tsc --noEmit` limpo antes e depois
do merge com `main`. Deploy de teste do PR (Vercel) passou; não confirmado de fora que
o ar em produção já serve este código.

**Adiado de propósito, decisão do Matheus ("só o mínimo agora") — vira tarefa quando
ele quiser:**
- função no banco "tudo ou nada" para a exclusão inteira (igual à da migração 009 de
  excluir nota fiscal) — sem ela, ainda é fisicamente possível parar no meio com
  devolução parcial gravada (mensagem de erro avisa e trava o botão, mas não impede);
- mesmo bug de fundo (sem registro de movimentação) na **edição** de operação
  (`handleSubmit`), que é **mais grave** que o da exclusão: cada edição de operação
  salva empilha uma "saída fantasma" no histórico, porque a devolução ao ajustar
  quantidade não grava movimentação nenhuma;
- corrida entre ler e gravar o saldo (`select` + `update` em dois passos) — o projeto já
  tem a função `incrementar_estoque` pronta pra isso, mas ela não é usada aqui; usá-la
  exige antes conferir se está liberada para o navegador sem risco de fazenda cruzada;
- travar o diálogo de exclusão contra fechar por Esc/clique fora durante o processamento;
- origem da devolução gravada como `'manual'` em vez de `'operacao'` + `operacao_id` —
  dificulta distinguir, no histórico do Estoque, uma devolução de exclusão com erro
  parcial de um ajuste manual comum.

## CFOP de entrega futura — no ar desde 04/08/2026

**PR #45 mergeado** (`d76f413`, squash). Migrações `007` (coluna `cfop`) e `008`
(coluna `conta_como_compra`) rodadas em produção ANTES do merge — assim a ordem
Vercel/Railway deixou de importar. HISTÓRIA de 04/08: 176 testes verdes, `tsc --noEmit`
limpo nos dois projetos (para o número de hoje, rode a suíte).

O sistema lê o CFOP de cada item da NF-e e decide, **por item**: entra no estoque?
conta como compra? custo zero? A regra pura vive em `api/src/services/contas/cfop.ts` —
conferida contra a tabela oficial brasileira (Convênio SINIEF s/nº de 1970).

**Prova de ponta a ponta contra os 4 XMLs reais** (`.tmp/notas-exemplo/`):
o comando que mede está em `docs/superpowers/plans/2026-08-03-nfe-cfop-entrega-futura.md`,
Task 6 Step 2 — mas ele quebra como escrito: `nfeProcessor.ts` importa `./supabase`,
que lança sem credencial, e **não existe `api/.env`** (o `.env` está na raiz). Rodar com
`$env:SUPABASE_URL='https://exemplo.invalido'; $env:SUPABASE_SERVICE_KEY='conferencia-local'`.

## Contas a pagar — Fases 1 e 2 no ar desde 31/07/2026

PR #43 juntado (`f3b614d`) e PR #44 juntado com squash (`d5d122f`); migrações rodadas
em produção (6/6 conferências), Vercel READY, `/contas` → 401 no Railway, API
respondendo `{"status":"ok"}`. **Ele testou o fluxo inteiro em produção e passou**,
incluindo a conferência que mais importava — o gasto aparece no Financeiro ao marcar
pago e some ao desfazer.

**Sem conta real cadastrada ainda:** ele espera o banco liberar o acesso dele para
começar a pagar. Sem regra cadastrada o job das 07:00 não grava nada e não manda
mensagem — silêncio é resposta válida no desenho, então **nada urge**.

✅ Já decidido no desenho: Financeiro e painel **não mudam** (respondem "quanto custou
a safra", na data da nota); a agenda responde "quanto sai do banco e quando". Duas
perguntas diferentes, não duas verdades.

Detalhe, riscos e defeitos achados nas revisões: **corpo do PR** e
`.superpowers/sdd/2026-07-31-contas-a-pagar-fase2/progress.md` — não copie para cá.

## Financeiro: botão "Adicionar" volta a salvar — no ar desde 06/08/2026

**PR #50 mergeado** (`267a8f5`... squash) — https://github.com/diretorpc/agromouro/pull/50.
O lançamento manual da tela Financeiro falhava em silêncio (sem `fazenda_id` nos
`insert` de `insumos`/`itens_nfe`, mensagem de erro genérica escondendo o motivo,
categoria escolhida descartada quando o produto já existia no catálogo).

**Migração 014** (4 categorias que faltavam: `adjuvante`, `manutencao`, `alimentacao`,
`outros`) e **migração 015** (coluna `data_manual` em `itens_nfe`, que nunca tinha sido
criada) — **as duas já aplicadas e testadas em produção**, confirmado pelo PR.

**Migração 016** (RLS de UPDATE em `itens_nfe`, que deixava qualquer usuário logado
editar item de nota fiscal de outra fazenda) — **aplicada em produção em 07/08/2026**,
`SQL Editor` do Supabase, sem erro.

## Duplicata vazia de NF-e não gera mais boleto/gasto fantasma — no ar desde 06/08/2026

**PR #54 mergeado** (squash `7e8474a`), branch `claude/dazzling-nightingale-aebd93`
apagada (local e remota). Achado original do Apolo: quando o quadro de cobrança
(`<dup>`) de uma nota vinha com TODAS as parcelas completamente vazias (sem vencimento
e sem valor — só o número de controle), o sistema tratava isso como cobrança real.
Provado com a nota real da SYAGRI (CFOP 5117, tPag `90`, R$ 1.060.000): gerava boleto
fantasma sem vencimento, lançava o mesmo valor como gasto fantasma no Financeiro, e a
mensagem do WhatsApp sobre boleto ficava muda.

**Correção:** nova função `duplicataEhReal()` (vencimento OU valor > 0 finito) decide,
nos TRÊS lugares que perguntavam "essa nota cobra de verdade?" — o boleto
(`contasDaNota`/`parcelasDescartadasDaNota` em `deNotaFiscal.ts`), a mensagem do
WhatsApp e o lançamento financeiro (os dois em `nfeProcessor.ts`) — a mesma resposta.
Quando nenhuma duplicata é real, a nota é tratada como se não tivesse quadro de
cobrança (mesmo caminho do caso ERCAL): uma conta só, sem data, com o valor TOTAL da
nota — em vez de um valor nulo perdido à toa.

**5 rodadas de revisão do Apolo, cada uma achando e fechando um problema real antes da
próxima** (histórico completo, achado por achado, no PR #54 — não repetir aqui):
boleto fantasma → NaN/valor zero escapando → mensagem do WhatsApp muda → **gasto
fantasma no Financeiro** (o achado mais sério, mesma causa raiz, aprovado pelo Matheus
para entrar no mesmo commit em vez de virar tarefa separada) → confirmação final,
testada quebrando cada correção de propósito para provar que os testes protegem.

HISTÓRIA de 06/08: 209 testes de toda a API passam, `tsc --noEmit` limpo (rebase sobre
o PR #53, que tinha mexido nos mesmos 2 arquivos, sem conflito de comportamento — só
um conflito de posição de teste, resolvido mantendo os dois blocos).

✅ **Conferido no Supabase (06/08, pelo Matheus): zero linhas.** Nenhuma conta antiga
ficou com o defeito gravado — nada a corrigir no banco. Consulta usada, pra reconferir
se precisar no futuro (ex: depois de restaurar um dump antigo):
```sql
SELECT id, descricao, fornecedor, competencia, valor, nota_fiscal_id
FROM contas_a_pagar
WHERE nota_fiscal_id IS NOT NULL AND vencimento IS NULL AND valor IS NULL
ORDER BY competencia;
```

## Contas a pagar: tPag 16/19/21 avaliados e DELIBERADAMENTE NÃO mapeados — no ar desde 06/08/2026

**PR [#53](https://github.com/diretorpc/agromouro/pull/53) mergeado na `main`** (squash,
commit `267a8f5`), branch `claude/serene-kepler-985de0` apagada (local e remota).
CI (Vercel) passou antes do merge.

Pedido original citava um caso de produção ("Usina Uberaba", NF 16246, R$ 88.939,27)
como motivo para os códigos `17`/`18` — **investigado e não confirmado** (sem rastro em
`git log --all`; `17`/`18`/`20` nunca existiram no arquivo). Tratado como pedido novo.

**Tentativa 1:** `16` (depósito), `19` (cashback), `21` (crédito em loja) confirmados
contra a tabela oficial de `tPag` da NF-e e adicionados a `MOTIVO_SEM_BOLETO`, fora de
`CODIGOS_QUE_CEDEM_A_DUPLICATA`. **Apolo achado crítico:** em nota de pagamento misto
(mais de um `<detPag>`), o parser só lê o primeiro — `19`/`21` são pagamento parcial por
natureza, então um boleto real podia sumir dependendo da ordem em que o fornecedor
escreveu o XML. `16` tratado como "já pago" quando na real pode vencer no futuro igual
boleto.

**Tentativa 2:** `16`/`19`/`21` acrescentados também a `CODIGOS_QUE_CEDEM_A_DUPLICATA`
(mesmo mecanismo que já protege o `90`). Resolveu o caso COM duplicata preenchida.
**Apolo achou o mesmo risco no caminho SEM duplicata:** nota sem quadro de cobrança
nenhum com esses códigos virava "nada a pagar" — reproduzindo o padrão real do caso
ERCAL (`nfeProcessor.ts:249`: tPag 15, zero duplicata, boleto real de R$ 8.258,40).
Sem ler `vPag` (valor efetivamente pago, campo do XML que o parser não lê), não dá pra
saber se esses créditos cobrem a nota inteira.

**Decisão do Matheus, depois do trade-off explicado:** reverter os 3 códigos por
completo (opção "voltar ao seguro" — sistema sempre gera boleto quando o código não é
um dos já mapeados, dispensa com 1 toque se for falso alarme). `MOTIVO_SEM_BOLETO` e
`CODIGOS_QUE_CEDEM_A_DUPLICATA` voltaram ao estado original. Ficou um comentário no
código (`deNotaFiscal.ts`) explicando a decisão pra próxima pessoa não repetir a
tentativa sem primeiro resolver a raiz, + testes travando que `16/19/21` seguem o
caminho padrão "na dúvida, gera boleto".

197 testes de toda a API passam, `tsc --noEmit` limpo (rodado na 3ª rodada).

## Reorganização da tela `/estoque` — no ar desde 06/08/2026

PR #47 mergeado (squash `c66289d`), branch e worktree limpos. Virou abas
Produtos/Histórico, ordenar por data de entrada (clicando no cabeçalho da coluna, nas
duas abas), Excluir escondido atrás de um menu "⋯", arquivo de ~1000 linhas quebrado em
hooks + componentes. 13 tarefas + revisão final + 1 adicional, tudo via
subagent-driven-development num worktree isolado (nunca tocou a `main` até o merge).
Migração `010_estoque_created_at.sql` aplicada em produção e confirmada por ele
(`sem_entrada_registrada=0` de `71`). Testado logado por ele antes do merge.
Detalhe completo: `docs/superpowers/plans/2026-08-05-reorganizacao-estoque.md`.

O achado fora do escopo desta obra — `GET /estoque` não filtrava por `fazenda_id` —
**foi resolvido no PR #48**, seção acima. Nada pendente aqui.

---

# 2. ABERTO — o que precisa de decisão ou de trabalho

## ✅ Talhões: criar talhão estava quebrado — NO AR (PR #65 mergeado) — 24/08/2026

**Causa raiz:** o INSERT de `/talhoes` montava o payload sem `fazenda_id`. A coluna é
`NOT NULL` (`supabase/migrations/001_multi_fazenda.sql`, passo 5) e a policy
`talhoes_tenant` a exige no `WITH CHECK`. Era a ÚNICA tela do sistema sem isso —
estoque, financeiro, nfe e operações todas passam `fazendaAtiva.id`. A tela ainda
escondia o motivo real atrás de "Erro ao salvar. Tente novamente.".

**Provado ao vivo** (Matheus logado, localhost:3000, Fazenda MG): criou o talhão `3M`
(450 ha, cana) — lista 12→13; editou 450→451→450 ha e o total acompanhou nos dois
sentidos. Aba nova, carga limpa: zero erro de console.

**Arquivos:** `web/lib/erros-supabase.ts` (novo), `web/lib/numeros-br.ts` (novo,
`parseNumeroBR` promovido de `colunas-br.ts` para não arrastar `react-datasheet-grid`
para o bundle de Talhões), `web/app/(app)/talhoes/salvar-talhao.ts` (novo) + teste,
`web/app/(app)/talhoes/page.tsx`, `web/vitest.config.mts`,
`web/app/(app)/controle/components/colunas-br.ts`. Os testes de `parseNumeroBR`
mudaram de endereço junto com a função: saíram de `colunas-br.test.ts` e foram para
`web/lib/numeros-br.test.ts` — módulo compartilhado tem teste no próprio endereço.

**5 rodadas de revisão do Apolo.** O que ele pegou e foi corrigido: detector de "sem
conexão" não disparava em Safari/iOS (cada runtime escreve frase diferente — o
discriminador certo é o `code`, não a mensagem); `.replace(',', '.')` reintroduzia o
bug de milhar que este repo já pagou; KPIs exibindo "0 ha" como fato durante erro de
carregamento; Importar KMZ contando sucesso de gravação que podia não ter ocorrido
(sem `.select()` o PostgREST responde 204 e `data` vem null SEMPRE).

Na última rodada ele pegou o pior de todos, que era meu: `if (!error.code)` fazia
apikey errada num deploy da Vercel (gateway responde 401 SEM `code`) virar
"verifique a internet" em TODA tela, com a internet perfeita. O `status` mora no
ENVELOPE da resposta, não dentro do erro — os call sites agora desestruturam
`{ data, error, status }`. Também: KMZ com áreas sem nome recebia o conselho errado
("nenhuma com contorno"), mandando reexportar polígono que já estava lá; e o botão
"Tentar de novo" tinha corrida que ressuscitava erro velho por cima de dados novos.

Última rodada, com sonda ponta a ponta contra host morto: resposta 5xx com corpo HTML
despejava a página de erro do gateway inteira na tela, e corpo vazio imprimia
`Erro: ` pelado (`??` não pega string vazia, só null). Queda de conexão no meio da
importação KMZ era acusada como problema de fazenda — agora aborta e diz a verdade.
Medição de graça da sonda: sem sinal, o `postgrest-js` faz retries e o botão fica
~7 s em "Salvando…" antes da mensagem aparecer.

**Correção de documento (regra da casa):** o comentário do `web/vitest.config.mts`
afirmava que alias `@/` "inflaria a instalação". Errado e medido — `resolve.alias` é do
próprio Vite, custa 0 pacote. Texto corrigido no arquivo.

### ✅ RESPONDIDO — policies de `talhoes` conferidas no banco vivo em 24/08/2026

`select policyname, cmd, qual, with_check from pg_policies where tablename = 'talhoes';`
devolveu **UMA linha**: `talhoes_tenant`, `ALL`, com `qual` idêntico a `with_check`
(`auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()`).

Consequências, agora fundamentadas e não supostas:
- As 3 policies de `api/src/database/migrations/009_rls_talhoes.sql` **foram dropadas**
  pelo passo 8 da `001_multi_fazenda.sql`, como o script pretendia. O arquivo 009 é
  fóssil — engana quem lê procurando a regra vigente.
- **Não há caminho para gravar em fazenda errada:** INSERT com `fazenda_id` de outra
  fazenda é recusado pelo `WITH CHECK`.
- **O `.select('id')` não produz falso alarme:** `USING` idêntico ao `WITH CHECK`
  significa que toda linha gravada volta no RETURNING.

Registro do erro de raciocínio (para não repetir): eu tinha declarado isso fechado com
base em ter criado um talhão ao vivo. O Apolo mostrou que aquele teste passa nas DUAS
configurações de policy — as do 009 são MAIS permissivas, não mais estreitas, e o caso
que as distingue (gravar com `fazenda_id` de outra fazenda) nunca foi exercido. Só a
consulta ao `pg_policies` decidia.

### Mergeado

PR #65 — https://github.com/diretorpc/agromouro/pull/65 — MERGED (squash) na `main`
como `78a5163`. Branch `fix/talhoes-fazenda-id` apagada nos dois lados.
Vercel faz o deploy sozinho a partir da `main`.
Comando que mede: `cd web && npx tsc --noEmit && npx vitest run && npm run build`

`CLAUDE.md` atualizado no mesmo PR: a cana passou a constar como cultura permanente
da propriedade (sempre existiu, sempre vai existir), com o registro MEDIDO de que ela
é desigual no sistema — tem cor no Dashboard e linha no `seed.sql`, mas
`api/src/jobs/cotacoes.ts` só conhece soja, milho e trigo. **Não existe cotação de
cana.**

### Fora de escopo, virou chip de tarefa

- `web/context/fazenda-context.tsx` desempata a fazenda padrão por `.order('estado')`;
  o banco (`get_fazenda_ativa_id()`) desempata por `created_at`. Coincidem HOJE por
  acaso (MG é a mais antiga E a primeira alfabeticamente). Fazenda nova em BA/ES/GO
  quebra o primeiro login.
- `use-estoque-data.ts` mantém tradutor de erro próprio, sem tratamento de rede — deve
  delegar para `@/lib/erros-supabase`.

## ✅ Contrato de adubo → conta a pagar + gasto no Financeiro — NO AR (PR #64 mergeado) — 23/08/2026

PR #64 mergeado (squash, `88e3c30`), branch apagada nos dois lados. Desenho em
`docs/superpowers/specs/2026-08-23-contrato-adubo-contas-a-pagar-design.md`, plano em
`docs/superpowers/plans/2026-08-23-contrato-adubo-contas-a-pagar.md`.

✅ **Migration 012 aplicada em produção em 23/08** (3 linhas confirmadas pelo Matheus).
✅ **Conferido ao vivo com o contrato 280451 real**, ponta a ponta — o contrato ESTÁ no
sistema (documento `ff3de1fa`, conta a pagar de R$ 647.986,35 vencendo 28/08/2026).

✅ **PR #64 MERGEADO na main em 23/08** — https://github.com/diretorpc/agromouro/pull/64
Railway e Vercel fazem deploy automático. A migration 012 já estava aplicada ANTES do
merge; era o portão e foi respeitado.

Conferido na main **por conteúdo, não por nome de branch** (squash troca o hash): os 3
arquivos novos existem e as 3 travas de dinheiro estão lá — `conta_como_compra`
ramificado por tipo, trava do lançamento duplo em `pagamento.ts`, e o C1 preservando o
gasto ao editar célula. Comando que reconfere:
`grep -c "documento_controle_id == null" api/src/services/contas/pagamento.ts`

⚠️ **O gasto aparece em JULHO no Financeiro** (data do contrato) enquanto a dívida vence
em AGOSTO — decisão consciente do Matheus, regime de competência. Quem abrir o Financeiro
no mês corrente NÃO vê a compra; tem que trocar o filtro de mês. Ele estranhou isso na
prática em 23/08, foi avisado das três saídas possíveis e escolheu deixar como está.

**Dois defeitos de TELA achados só na conferência visual** — a conferência por banco não
pegaria nenhum dos dois: (1) a coluna Origem do Financeiro mostrava "Manual" em vez do
fornecedor, porque a cadeia de ternários checava `is_manual` antes do fornecedor e a
correção que preenchia o campo virou **código morto** — um quarto do pedido original não
estava entregue; (2) a categoria aparecia crua (`fertilizante_outro`) na tela de Contas,
com `categoriaLabel()` já existindo e não sendo usado.
**Lição: revisar a consulta e o fallback não prova que a célula DESENHA o dado.**

⚠️ **O bug mais caro da feature só apareceu na conferência ao vivo, com a suíte 100%
verde.** A API da Anthropic RECUSA a requisição inteira (HTTP 400) quando uma propriedade
do schema combina `enum` com `type` em união (`['string','null']`). `POST
/controle/documentos` devolvia 503 para QUALQUER PDF — contrato e extrato. Os 593 testes
ficavam verdes porque **todos mockam `anthropic.messages.stream`**: nenhum manda o schema
para a API de verdade. Corrigido em `b7d74f2`, com teste de invariante que percorre o
SCHEMA atrás da mesma combinação. **Lição que vale além deste projeto: suíte que mocka o
fornecedor externo não prova que o contrato com ele está certo. Conferência ao vivo não é
formalidade — foi ela que pegou.**

Contagem de teste NÃO se escreve aqui — mede-se: `cd api && npm test`

Pedido do Matheus: *"quero essa função de ler o contrato e cadastrar a data de pagamento
na ABA do contas a pagar! Cada um no seu quadrado. Também quero que joga o valor,
produto, quantidade e fornecedor na aba financeiro"*.

**O que foi MEDIDO nesta sessão (não é lembrança):**

- O leitor atual (`documentoPdf.ts`) **já acerta 100%** de um contrato Mosaic real
  (280451, 12 páginas, Docusign): fornecedor, código, produto, 165 MTN, R$ 3.927,19
  unitário, R$ 647.986,35 total, `divergenciaTotal: 0`. Leitura NÃO é o problema.
- O leitor **joga fora** a linha `Data de pagamento` do Quadro Resumo — não há campo no
  schema. Foi isso que originou o pedido.
- **Zero NF-e de fornecedor de adubo no banco** (mosaic/fertiliz/cibra/yara = 0). Isso
  derrubou a premissa da decisão de 17/08 (`conta_como_compra: false` sempre): ela
  nasceu pensando em extrato de revenda, onde a NF-e chega mesmo.

**Eixo do desenho:** o **tipo do documento** decide, não a aba. Contrato de fabricante
(NF-e nunca chega) conta como gasto; extrato de revenda (NF-e chega pelo Make) continua
não contando. Tipo ausente/ilegível cai em **extrato** de propósito — errar pro lado que
não soma é barato, errar pro lado que soma dobra dinheiro calado.

**Decisões fechadas com ele:** gasto no Financeiro na data do contrato; conta a pagar na
data de vencimento; aparece nos três lugares (Controle, Contas a Pagar, Financeiro); um
leitor só com dois destinos (leitor separado duplicaria ~600 linhas).

⚠️ **Trava de regressão nº 1:** os 3 extratos já importados (Syagri R$ 1.406.915,25,
Solos R$ 676.773,19, Protec R$ 685.054,96) **precisam continuar com
`conta_como_compra: false`**. Ligar "PDF conta como gasto" de forma global dobraria esse
dinheiro quando as NF-e dessas revendas chegarem.

⚠️ **Buraco achado na auto-revisão da spec:** a regra ingênua "pagamento sem valor herda
o total do documento" dobra a dívida quando o contrato tem 2 parcelas. Corrigido na
spec: N pagamentos com algum valor nulo **rateiam** o total e marcam
`valor_estimado: true`, reusando `montarParcelas()` de `parcelamento.ts`.

**Fora de escopo, dito em voz alta:** cruzamento PDF↔NF-e (4ª vez adiado — se a Mosaic
um dia mandar NF-e, dobra), estoque (as 165 t não entram), contrato cancelado/
renegociado.

**O que a revisão final (Apolo) achou depois de tudo codado — 3 Critical, 6 Important,
todos corrigidos.** Nenhum deles seria pego por revisão de task isolada:

- **C1** — `editarItemControle.ts` cravava `conta_como_compra: false` em todo PATCH. Essa
  trava nasceu em 18/08 sob a premissa *"item de Controle nunca conta como gasto"*, e
  esta branch quebrou a premissa. Editar qualquer célula do contrato na grade zerava os
  R$ 647.986,35 no Financeiro, em silêncio — e como a conta a pagar continua vinculada,
  pagá-la também não lançava: o dinheiro sumia das três telas de uma vez. **Lição: trava
  cravada carrega a premissa da época; mudar a premissa sem recalibrar a trava é como
  nasce bug caro.**
- **C2** — o aviso *"cadastre a conta à mão"* (que a spec §7 desenhou) levava a conta
  avulsa SEM vínculo → pagá-la criava lançamento → R$ 1,29 mi para uma compra de R$ 648
  mil. Agora contrato sem data legível cria conta **sem vencimento**, e o caminho manual
  deixou de existir.
- **C3** — deploy antes da migration quebra toda importação (ver bloqueio 1 acima).
- **I1** parcela com data ilegível descartada em silêncio fazia a sobrevivente herdar o
  total como valor confirmado · **I2** duas datas iguais escondiam metade da dívida ·
  **I3** apagar o item fazia a dívida virar invisível · **I4** a trava dos R$ 2,77 mi
  virou julgamento da IA · **I5** aviso âmbar viraria ruído no Controle · **I6**
  comentário sustentava decisão com fato morto.

**O "cinto de segurança" da classificação foi calibrado com MEDIÇÃO, não palpite.** O
limiar original contava itens numerados; a consulta ao banco mostrou que todo item de
todo documento tem número (28/28, 49/49, 32/32) — a regra não discriminava nada. O que
separa as populações é a quantidade de números **DISTINTOS**: extrato tem 25–30 (uma por
duplicata), contrato tem sempre 1 (todos os itens carregam o número do contrato),
independente de quantas mercadorias. Um re-revisor provou por sonda que o critério
antigo rebaixava um contrato Mosaic de 6 mercadorias a extrato e sumia com a dívida
inteira, sem alerta. Comando que remede: contar `numero_documento` distintos por
`documento_controle_id` em `itens_nfe`.

## ✅ Gráficos da aba Controle — PR #63 mergeado em 19/08/2026

https://github.com/diretorpc/agromouro/pull/63 — commit `f48cba8` na `main` (squash),
branch `feature/controle-graficos` apagada (local e remoto). Railway/Vercel fazem
deploy automático. **Migration 020 já estava aplicada em produção antes do merge.**

## ✅ Controle: tabela TOTALMENTE EDITÁVEL (estilo Excel) — PR #62, 18/08/2026

https://github.com/diretorpc/agromouro/pull/62 · **5 rodadas de revisão do Apolo,
~30 achados.** Testado ao vivo pelo Matheus a cada rodada. Suíte: 489 na API + **38 no
web, que não tinha NENHUM teste antes deste PR**.

**Os 4 achados que só apareceram porque alguém abriu a tela ou leu o fonte da lib** —
todos invisíveis pra suíte que existia:
1. **Rota montada no lugar errado.** Front chamava `/controle/itens`, backend respondia
   em `/controle/documentos/itens`. 404 em tudo, tela vazia, **479 testes verdes** — eles
   chamavam o handler direto, nunca o `app.use()` real. Fechado com `routeMounts.test.ts`,
   que cruza o `index.ts` lido como TEXTO com os caminhos literais do hook do front.
2. **Dinheiro em pt-BR corrompido calado.** `parseFloat("1.234,56")` = 1.234 — R$ 1.234,56
   virava R$ 1,23 com 200 OK. Valia igual pro colar do Excel, que era o pedido.
3. **`Ctrl+A` + `Delete` apagava até 500 linhas do banco** numa tecla, sem confirmação.
   `Ctrl+X` também — a lib desliga o smart-delete no recortar justamente pra isso não
   acontecer, e a interceptação ignorava.
4. **Segurar `Delete` apagava linha após linha em cascata** (8 repetições = 7 linhas
   medidas). A lib não reajusta a seleção quando o array encolhe por fora, então ela fica
   no índice N — que após a remoção é a próxima linha, cheia de dado.

**Lição que vale além desta feature:** os 4 passariam por qualquer suíte que teste só a
camada de dentro. O 1 e o 4 exigiram ler o código-fonte compilado da biblioteca; o 3 foi
achado perguntando "que gesto pode disparar isso sem querer?". Teste de unidade verde não
é evidência de que a feature funciona.

**Guarda de exclusão** — as 3 condições precisam bater juntas: operação de 1 linha, tecla
Delete real e não repetida (`onKeyDownCapture` + `!e.repeat`), e seleção cobrindo a linha
inteira (`min.col===0 && max.col>=7`). Qualquer uma fora cai no caminho seguro
(PATCH → 400 → reverte e marca): barulhento, nunca destrutivo.

**Desfazer de 7s** (decisão do Matheus): a linha some da tela na hora, o DELETE só sai no
fim do prazo. Timers são limpos no desmonte do hook — navegação interna do Next não passa
por `beforeunload`, e sem isso o DELETE saía depois, deixando a tela exibir linha que já
não existia.

**Pendências aceitas, nenhuma é dinheiro** (item de Controle tem `conta_como_compra`
sempre `false` — não entra no Financeiro):
- Recarga da lista dentro dos 7s cancela a exclusão pendente **em silêncio** (troca de
  filtro, importar PDF, falha de rede noutra linha). Direção segura — nada se perde —
  mas o Matheus não é avisado de por que a linha voltou. Achado [médio] da 5ª rodada.
- Editar `valor_total` ou esvaziar a descrição de linha importada desarma a trava de
  dedupe daquela linha; reimportar o mesmo extrato passa a duplicar. Agora o gesto ficou
  barato (uma tecla), o que aumenta a chance — risco assumido conscientemente.
- Desfazer devolve a linha 1 posição adiante quando 2+ saíram na MESMA operação
  (menu de contexto). Cosmético.
- Buraco de paginação acima de 500 itens (pré-existente, hoje são ~28).
- `use-controle-data.ts` e `tabela-documentos.tsx` ficaram como código morto.

**⚠️ Migration 019 aplicada em produção em 18/08** (`duplicata_confirmada_em`,
`duplicata_confirmada_vezes` em `itens_nfe`) — o código não funciona sem ela
(`GET /controle/itens` devolve 500 `column ... does not exist`).

<details>
<summary>Histórico da construção (por que a feature existiu)</summary>

## 🟡 Controle: tabela TOTALMENTE EDITÁVEL (estilo Excel) — codada 18/08/2026, falta o Matheus testar a digitação

Branch `feature/controle-tabela-editavel`, commit `e6fb46b` (**só local, não subiu**).
Desenho: `docs/superpowers/specs/2026-08-18-controle-tabela-editavel-design.md`.

**Por que existe:** o Matheus testou a tela entregue no PR #61 e disse *"não ficou
igual eu pedi, eu queria uma tabela totalmente editável como se fosse um Excel"*. O
"estilo Excel" do plano anterior era só o FILTRO por coluna; editar célula tinha sido
marcado como "fora de escopo" no papel, **sem ninguém perguntar a ele**. Lição de
processo: escopo cortado no plano precisa ser confirmado com o dono, não decidido
pelo executor.

**Decisões dele, travadas antes de codar:** clicar na célula e digitar (Enter salva,
Tab anda), adicionar/apagar linha, colar do Excel com várias linhas, salvar sozinho
sem botão. Quando avisado de que editar à mão faria o sistema perder o reconhecimento
de "já importei isso" e duplicar linha, respondeu que **isso é bom — duplicata deve
aparecer PINTADA**, e virou feature em vez de risco.

**⚠️ MIGRATION 019 JÁ APLICADA EM PRODUÇÃO em 18/08** (`duplicata_confirmada_em`,
`duplicata_confirmada_vezes` em `itens_nfe`) — rodada pelo Matheus, verificação
devolveu as 2 colunas certas. O código NÃO funciona sem ela (`GET /controle/itens`
devolve 500 `column ... does not exist`).

**Bug crítico achado só porque a tela foi aberta de verdade:** as 4 rotas de item
nasceram dentro do router montado em `/controle/documentos`, resolvendo em
`/controle/documentos/itens`, enquanto o front sempre chamou `/controle/itens` — 404
em tudo, tela vazia. **Os 479 testes passavam**, porque `controle.test.ts` chama os
handlers direto e nunca passa pelo `app.use()` real. Mesma categoria do bug de
streaming de hoje cedo (suíte verde, feature 100% morta na vida real). Corrigido com
router próprio (`controleItens.ts`) + `routeMounts.test.ts`, que cruza o `index.ts`
lido como TEXTO com os caminhos literais do hook do frontend — e foi provado por
mutação (reintroduzir o bug faz 2 dos 5 testes falharem).

**Revisão do Apolo: 12 achados, nenhum passou batido.** Os 8 acionáveis corrigidos;
2 eram CRÍTICOS que corrompiam dado em silêncio:
- número em pt-BR lido com `parseFloat` cru — `"1.234,56"` virava **1.234** (R$ 1.234,56
  → R$ 1,23), com 200 OK e sem erro. Valia igual pro colar do Excel, que é o pedido.
- autosave descartava o patch pendente junto com o timer: editar 2 células da mesma
  linha em menos de 400 ms persistia só a última, e a primeira sumia da tela quando o
  servidor respondia.
Mais: colar data `"01/12/2025"` virava 12 de janeiro; a pintura âmbar ficava atrás do
fundo branco opaco das células (feature invisível); e o `package-lock.json` tinha
arrastado **118 pacotes de carona** (incl. `@supabase/supabase-js` e 3 majors) que o
Vercel instalaria em produção sem ninguém ter pedido — restaurado para 7 adicionados,
0 trocados.

**REGRESSÃO pega pelo Apolo:** a troca de componentes desligou o botão de excluir
documento que o PR #61 tinha entregue HORAS antes. Nenhum arquivo vivo chamava
`DELETE /controle/documentos/:id`. Restaurado.

**✅ Medido por mim no navegador, depois das correções** (não é promessa do executor —
o subagente não tinha navegador em nenhuma das rodadas):
- os 28 itens carregam; formato pt-BR certo na tela (`3.956,75`, `44,2`, `25.480`)
- pintura funciona: `getComputedStyle` da célula devolve `rgb(254,243,199)` com a
  classe de duplicata contra `rgb(255,255,255)` normal
- botão "Excluir documento de origem" presente em cada linha

**✅ DIGITAÇÃO TESTADA E APROVADA PELO MATHEUS em 18/08, no navegador dele** — colar
do Excel e editar duas células seguidas rápido na mesma linha, os dois OK. Eu não
consegui testar isso: meus cliques não chegam na grade quando o painel do navegador
não é exibido (`pointer-events: none` no input, nenhuma célula selecionada, foco no
`body`) — foi limitação da automação, não defeito da tela.

**🐛 Bug que só apareceu no teste dele (commit `bd76cb7`):** apertar Delete numa
célula de Produto mandava `null` ao servidor → 400 → o `catch` de `editarItem`
remontava a grade inteira, o valor voltava e **qualquer outra edição em andamento
sumia junto**. Era o achado 8 do Apolo, corrigido pela metade na rodada anterior (só
o caminho de linha nova). Consertado em 3 frentes: Produto/Unidade aceitam texto
vazio (decisão dele — "máxima liberdade, igual Excel", ciente de que linha sem nome
atrapalha a conferência; sem migration, `''` já satisfaz o `not null`); erro 4xx
passou a só marcar a linha, e só rede/5xx recarrega; e esvaziar a descrição de 2
linhas iguais do mesmo documento colide na trava da 018 → 409 em português, não 500.
**Confirmado funcionando por ele.**

**Achados 9–12 do Apolo, aceitos como pendência de propósito** (nenhum é dinheiro):
editar `valor_total` de linha importada desarma as duas defesas de duplicidade ao
mesmo tempo (a chave do "Caso 2" inclui o valor); a varredura de duplicatas não tem
`.range()`/`.order()` e vira arbitrária acima de 1000 itens (hoje são 28 — latente);
`marcarDuplicataConfirmada` não filtra `documento_controle_id` e não é atômico no
contador; e `use-controle-data.ts` + `tabela-documentos.tsx` ficaram no repo como
código morto.

**Decisões de produto que ele ainda não viu** (o executor tomou sozinho): a tabela
ficou ACHATADA (sumiu a faixa de fornecedor mesclada), o "Total do PDF" saiu da tela,
e apagar linha importada libera a trava de dedupe daquele item (reimportar traz de
volta).

</details>

## ✅ Feature "Controle" (defensivos/adubos/sementes) — PR #61 mergeado em 18/08/2026

https://github.com/diretorpc/agromouro/pull/61 — squash em `main`, branch
`feature/controle-gastos` apagada no remoto (o worktree local desta sessão continua
com a branch, não apagada de propósito — é o worktree ativo). Railway/Vercel fazem
deploy automático no push — **ainda não confirmado de fora** que o ar já serve o
código novo, mesmo padrão de incerteza de outros itens desta seção. Cruza a NF-e
automática com PDF importado manualmente (extrato de fornecedor tipo Solos/Syagri, ou
contrato tipo Mosaic).

**Epic 2.4 (tela `/controle`) — as 10/10 tarefas do plano de feature prontas.**
Executada via `superpowers:subagent-driven-development`
(`docs/superpowers/plans/2026-08-17-controle-tela.md`, ledger em
`.superpowers/sdd/2026-08-17-controle-tela/progress.md`, dentro desta worktree): 8
tarefas + revisão de cada uma + **revisão final do branch inteiro**, que achou 7
problemas "importante" que só apareciam com tudo montado junto (menu de filtro cortado
pela tabela, filtro fechando a cada seleção, upload sem feedback, reimportação sem
total visível, filtro usando coluna não-normalizada, erro de PDF mudo, itens sem
ordem) — todos corrigidos numa rodada só, confirmada por re-revisão, sem quebra nova.
4 achados "menor" residuais aceitos conscientemente (ordem de item ainda instável em
certo sentido, um caso de acento/NBSP bem estreito, menu em maiúsculas vs. linha da
tabela em grafia crua, caixa de sucesso sem nome do arquivo) — nenhum é dinheiro ou
vazamento entre fazendas.

**Teste ao vivo começou em 18/08/2026, pela manhã (sessão seguinte).** Login funcionou
depois de corrigir `web/.env.local` da worktree (faltava — copiado do checkout
principal — e apontava pra API de **produção**, corrigido pra local). Verificado no
navegador (sem PDF ainda): menu "Controle" no lugar certo, Popover do filtro abre sem
cortar (resolve o achado 1 da revisão final), Esc fecha, diálogo abre/fecha certo.

**🔴 BUG CRÍTICO achado no primeiro upload real — corrigido em 18/08/2026, commit
`f91d19a`.** `documentoPdf.ts` chamava a API da Anthropic com `max_tokens: 32000` SEM
streaming; o SDK recusa qualquer chamada não-streaming acima de ~21.333 tokens
("Streaming is required for operations that may take longer than 10 minutes") — **toda
importação de PDF, sem exceção, falhava com 503** "leitor indisponível", desde que a
feature foi escrita. Nenhum teste pegou isso porque a suíte inteira mocka a chamada de
IA — nunca bateu na API real antes de hoje. Corrigido trocando `.create()` por
`.stream().finalMessage()` (mesmo shape de retorno, confirmado lendo o código-fonte do
SDK). `boletoPdf.ts` (leitor irmão, `max_tokens: 1024`) NÃO precisava do mesmo
conserto — fica bem abaixo do limiar, confirmado pelo cálculo exato do SDK. Revisado
pelo Apolo, sem achado crítico/importante. **Ainda falta**: testar com um PDF de
extrato/contrato de verdade (o teste do conserto usou um PDF qualquer só pra confirmar
que o erro de streaming sumiu, não testou a qualidade da extração).

**Lição registrada:** nem `lerDocumentoPdf` nem `lerBoletoDoPdf` têm teste (nem
mockado) sobre a chamada real ao SDK — só a validação pura (`validarDocumentoLido`/
`validarBoletoLido`). Foi esse buraco que deixou o bug do streaming invisível por
todas as revisões anteriores. Vale um teste que force `max_tokens` alto e confirme que
o código usa `.stream()`, pra não repetir a categoria.

### 18/08/2026 tarde — chamadas repetidas diagnosticadas e corrigidas; botão Excluir construído

**Bug das "dezenas de chamadas repetidas"** (sintoma achado de manhã, sem diagnóstico
até aqui): causa raiz não era loop de re-render — é `FiltroColuna` (checkboxes de
fornecedor) e os dois `<input type="date">` disparando uma requisição a cada
clique/mudança, sem espera nenhuma. Corrigido com debounce de 300ms dentro do
`useEffect` de `web/app/(app)/controle/hooks/use-controle-data.ts` (mantendo a trava
`cancelado` que já existia). Testado ao vivo no navegador: mudar o período aplicou o
filtro certo, sem travar e sem disparo duplo perceptível.

**Botão "Excluir documento" construído** (pedido dele, confirmado nesta sessão):
`api/src/services/controle/excluirDocumentoControle.ts` (novo, apaga itens_nfe antes
do documento — FK `ON DELETE RESTRICT` da migration 017 — depois tenta apagar o PDF do
Storage, best-effort), rota `DELETE /controle/documentos/:id`, botão + diálogo de
confirmação em `tabela-documentos.tsx`. **Decisão registrada no próprio arquivo:** sem
função atômica no Postgres (diferente do padrão de `excluir_nota_fiscal`, migration
009) — Controle nunca mexe em estoque/lançamento (`conta_como_compra` é sempre falso
aqui), então não há o que desfazer numa falha parcial.

Testado ao vivo: o diálogo abre certo com "Cancelar"/"Excluir". **A exclusão de
verdade não foi testada** — cancelei de propósito pra não apagar o documento real da
SYAGRI que está na tela de teste.

**Revisão do Apolo: sem crítico/alto.** 3 achados médios + 5 baixos. Os 3 médios e 2
baixos rápidos foram corrigidos na mesma sessão (decisão do Matheus: só os
importantes agora):
- documento não "mente" mais na tela se o delete falhar no meio (marca erro, igual
  `marcarDocumentoComErro`); tela recarrega sozinha no erro também, não só no sucesso
- debounce de 300ms agora só no clique de filtro — montagem/paginação/import/exclusão
  disparam na hora
- rota `DELETE /controle/documentos/:id` ganhou teste (400/404/204/500)
- 2 textos corrigidos ("item vinculado" no singular certo; "PDF deixa de ficar
  acessível" em vez de prometer remoção garantida)

**3 achados baixos, aceitos como pendência de propósito** (nenhum é dinheiro nem
vazamento entre fazendas): DELETE sem `count:'exact'` (duas abas excluindo o mesmo
documento ao mesmo tempo não dá erro, é inofensivo); id fora do formato UUID vira 500
em vez de 404; sem guarda contra excluir documento no meio do processamento (caminho
já é limpo mesmo sem a guarda, só não está escrito em lugar nenhum).

**Testado ao vivo depois da correção:** recarreguei `/controle` no navegador, tabela
carrega normal, cliquei em "Excluir documento" e o texto novo apareceu certo ("e 28
itens vinculados? O PDF original deixa de ficar acessível."). Cancelei de novo — a
exclusão de verdade (clicar "Excluir" e confirmar que a linha some) **continua nunca
testada**.

**✅ Exclusão real testada pelo Matheus, ao vivo — deu certo.** Também confirmou que
as quantidades (kg, litros) vieram corretas na tela — o fix de unidade do commit
`87de655` (sessão anterior) está validado na prática.

**Ainda em aberto:**
- Confirmar que o deploy (Railway API + Vercel web) já serve o código novo — próxima
  vez que alguém abrir `/controle` em produção resolve isso.

Pra medir de novo em vez de confiar no texto: `cd api && npm test && npx tsc --noEmit`
(e o mesmo dentro de `web/` para o build).

Servidores rodando nesta sessão (18/08 manhã): API na porta 3001, site na 3000 — caem
quando a sessão do Claude Code encerra, subir de novo com `cd api && npm run dev` e
`cd web && npm run dev` (+ `web/.env.local` da worktree precisa existir, copiado do
checkout principal com `NEXT_PUBLIC_API_URL` trocado pra `http://localhost:3001`).

**✅ Migration 018 aplicada em produção em 17/08/2026** — 3 consultas de verificação
rodadas pelo Matheus no Supabase, as 3 bateram (índice de item com as 6 colunas e o
WHERE certo, índice de documento virou parcial, as 2 colunas novas de `itens_nfe`
existem). Trava de duplicidade por item está viva no banco.

**5 de 10 tarefas do plano prontas:** migration 017 + bucket + leitor de PDF (sessão
anterior, `ba68b0e`); `gravarDocumentoPdf.ts` + migration 018 (Epic 2.2, `40b8487`);
rota da API — `POST /controle/documentos` (upload), `GET /controle/documentos` (lista
com itens), `GET /controle/documentos/:id/arquivo` (signed URL do PDF original) — Epic
2.3, `d4e8ca5`.

**Isolamento por fazenda testado com mutação de verdade** (Apolo alterou o código pra
tirar cada filtro de `fazenda_id` um de cada vez e confirmou que a suíte falha em todos
os 5 pontos sensíveis, inclusive a rota de signed URL — que NÃO passa pela RLS do
Postgres, então precisa checar `fazenda_id` no código mesmo).

**Achados médios/baixos aceitos como pendência, não corrigidos de propósito** (decisão
do Matheus, sessão de 17/08 — nenhum é dinheiro ou vazamento entre fazendas):
- `GET /controle/documentos` sem `.limit()`/paginação — 4+ documentos cheios de itens
  podem estourar o teto de linhas do PostgREST (padrão 1000) e truncar em silêncio;
  ~220 documentos estouram o `IN()` da query por tamanho de URL.
- Reimportação de documento onde TODOS os itens já existiam (extrato regerado) grava um
  "documento fantasma" com `valor_total` cheio e `itens: []` no `GET /` — nada no
  payload distingue isso de "gravação falhou". `itensDuplicados` só existe na resposta
  do POST (efêmera), não é persistido.
- `divergenciaTotal` (calculado na leitura do PDF, é a defesa contra a IA repetir linha)
  é jogado fora — nunca chega no `gravarDocumentoDoPdf()` nem na rota.
- Sem rate limit próprio na rota de upload e sem checar hash ANTES de chamar a IA —
  clique duplo no botão paga 2 leituras de Opus (~US$ 1 cada).
- Bucket `controle-documentos` no painel do Supabase ainda não confirmado se foi
  ajustado pra `file_size_limit ~10MB` / `allowed_mime_types application/pdf` (hoje
  "Any / 50 MB" — pendência manual registrada desde a migration 017).

**Histórico resumido de revisão** (Epic 2.2, sessão 17/08 — detalhe completo já não
cabe aqui de propósito, ver git log das migrations 017/018 e o corpo dos commits
`40b8487`/`d4e8ca5` se precisar reconstituir):
- 2 críticos de dinheiro dobrando resolvidos: dedupe por documento não pegava extrato
  regerado mês a mês (corrigido com dedupe por ITEM, migration 018); `conta_como_compra`
  virou sempre `false` pra item de PDF (Controle é conferência, gasto de verdade
  continua vindo só da NF-e).
- 4 altos de "tela de conferência ficando errada" resolvidos: documento preso pra
  sempre em erro parcial; linha legítima repetida no mesmo documento sendo descartada;
  contrato sem número próprio sem proteção; e (Epic 2.3) mensagens de erro genéricas +
  falha de infra da IA tratada como PDF inválido.

**Limitação aceita, registrada no código (não é dinheiro, é conferência rara):** item de
extrato SEM número de duplicata legível usa como identidade o código do cliente
(estável) + descrição + valor. Se o MESMO produto pelo MESMO valor aparecer em dois
MESES diferentes sem número de duplicata em nenhum dos dois, o segundo é tratado como
"já existe" e a compra nova some da conferência — silencioso. Estreito (só afeta item
sem número, que é o caso raro) e não mexe em dinheiro (`conta_como_compra` já é `false`).

**Próximo passo:** a TELA (upload, lista, visualização do PDF, cruzamento com NF-e) —
ainda não desenhada nem no PLAN.md. Antes de destravar upload de verdade pelo público,
vale revisitar a lista de pendências acima.

## Financeiro: origem "Conta paga" sem nome de fornecedor — pronto, falta só abrir o PR — 18/08/2026

Branch `feature/controle-graficos` (worktree `ou-e5b8ce`), **não commitado ainda**.
Desenho: `docs/superpowers/specs/2026-08-19-controle-graficos-design.md`.

**Migration 020 (`020_controle_agregacoes.sql`) JÁ APLICADA em produção pelo Matheus.**
Cria `controle_graficos()` + `controle_normalizar_descricao()` + índice parcial
`idx_itens_nfe_controle_faz_data`. Duas rodadas de revisão do Apolo antes de aplicar.
Toda a soma acontece no Postgres de propósito — a grade carrega 500 itens por vez, e
somar no navegador mostraria o pedaço parecendo o todo.

**Entregue:** rota `GET /controle/graficos`, `agregarControle.ts`, hook
`use-controle-graficos.ts`, `graficos-controle.tsx` e `graficos-dados.ts` (puro,
testado). Três gráficos na tela: gasto por produto, gasto por mês, preço por unidade
no tempo. Para conferir a suíte em vez de acreditar neste parágrafo:

```bash
cd api && npx vitest run   # e depois: cd web && npx vitest run && npx tsc --noEmit
```

### O que entrou no PR #63 (19/08/2026, tarde)

Além dos 3 primeiros, entrou o **gasto por fornecedor** a pedido do Matheus ("mais um
gráfico, por empresa" — confirmado que "empresa" = a loja que vende, não a fazenda).
Com um fornecedor só ele nasce com barra única, e a tela diz isso em letras em vez de
deixar parecer defeito.

**Segunda revisão do Apolo (frontend), 14 achados — 10 corrigidos nesta rodada:**
balde "Sem produto" saía do ranking e sumia dentro de "Outros" (agora é barra fixa
laranja); alerta de erro ficava escondido quando os gráficos estavam recolhidos (saiu
para fora do bloco); faltava sinal de "atualizando" durante a rebusca; gráfico de preço
descartava item sem quantidade/data sem avisar; frase "mostrando os N produtos" era
falsa quando zero linhas eram desenhadas; rodapé prometia gráficos que ninguém
desenhava; `toFixed(1)` imprimia "75.0%" com ponto; mês sem compra era pulado no eixo
(a linha do tempo parecia contínua); `localStorage` sem try/catch podia derrubar a rota
inteira (não existe `error.tsx` no app); comentário da paleta prometia estabilidade que
o código não dá.

**A tela agora CONFERE em vez de AFIRMAR:** ela soma as barras do gráfico de produto e
compara com o total do período. Batendo, diz que fecha; não batendo, vira aviso âmbar.
Antes só imprimia a frase "nada foi descartado" e confiava numa invariante que mora
inteira no SQL.

**6 mutações que sobreviviam aos testes agora morrem** (contagem de itens vs fatias,
`sort` sem cópia mutando estado do React, limite negativo, fronteira de R$ 1 milhão,
valor negativo no eixo, mês fora da faixa virando "undefined/26"). Testes do web:
**56 → 76**.

**Sem revisão do Apolo, por decisão do Matheus (19/08/2026):** o gráfico de fornecedor,
as 10 correções acima e o `versaoNumeros` em `use-controle-itens.ts` foram entregues sem
a rodada final de revisão — foi oferecida e dispensada. Não é pendência aberta; é escopo
fechado assim de propósito. As duas rodadas anteriores (backend e frontend) foram
revisadas, e todas as correções desta última têm teste, várias provadas por mutação.

⚠️ **DADO DE PRODUÇÃO COM VALOR DE TESTE (Fazenda MG).** Três linhas têm `valor_total`
que não bate com `quantidade × valor_unitario` e divergem do PDF de origem em
R$ 113.708,00 no total: NF 44294/3-1 (DUAL GOLD, R$ 50.000 em vez de R$ 8.400),
NF 44953/3-1 (VERDAVIS 20 LT, R$ 100.000 em vez de R$ 28.800) e NF 45446/3-1 (GESAPRIM,
R$ 2.000 em vez de R$ 1.092). Provável resíduo do teste de "o gráfico acompanha a
edição". Conferir contra `Downloads\JACOB DOMINGOS MOURO syagri.pdf` e corrigir na
grade. Enquanto estiverem lá, o total do Controle (R$ 1.520.623,25) NÃO bate com o
extrato da SYAGRI (R$ 1.406.915,25).

**✅ RESOLVIDO em 19/08/2026 — decisão "b" do Matheus.** O gráfico não acompanhava
edição de célula (`versaoDados` só sobe em carga completa; `editarItem` mexe só no
estado local), então corrigir uma linha deixava o gráfico com o número velho até o F5 —
as duas metades da mesma tela discordando em dinheiro. Apolo classificou como CRÍTICO.

Conserto: contador **`versaoNumeros`**, novo e SEPARADO, em `use-controle-itens.ts`.
Sobe só quando o servidor CONFIRMA mudança de dado — editar, criar, excluir item (após
o `api.del` resolver, nunca durante a janela de 7 s de Desfazer), excluir documento e
importar documento. Os gráficos observam ele; a grade continua com `versaoDados`.

⚠️ **Duas armadilhas registradas, ambas já pisadas:**
1. **Não bater `versaoDados`** para isso — `page.tsx` usa `key={versaoDados}` e
   remontaria a grade, matando a edição em andamento (o bug que o PR #62 consertou).
2. **Não bater `versaoNumeros` na carga da página 1.** O plano original do Apolo
   mandava isso; seria a rajada do achado 5 de volta (troca de filtro → o gráfico já
   dispara pelo filtro, e a carga que a própria troca provocou dispararia de novo).
   Só mutação confirmada.

Debounce de **1 s** para mutação (300 ms segue valendo para filtro): a grade tem
autosave, e corrigir uma linha célula a célula confirma vários PATCHes seguidos — sem a
folga sairia uma agregação por célula, e agregação aqui é `GROUP BY` sobre a fazenda
inteira.

**Falta conferir ao vivo:** editar uma célula e ver o gráfico redesenhar ~1 s depois.
Não deu para testar na sessão (o painel do navegador estava oculto e a planilha congela
o desenho sem ele). Código, tipos e suítes conferidos.

**Fora de escopo por falta de dado, não por esquecimento:** gráfico de gasto por
fornecedor e comparação de preço entre fornecedores. O SQL dos dois está pronto e
devolve `[]`; a fazenda MG tem UM fornecedor só. A tela diz isso em voz alta em vez
de simplesmente não mostrar nada.

**Latente, 0 ocorrências hoje (achado 8 do Apolo):** o gráfico 1 rotula pelo
`fornecedor` CRU e o menu de filtro oferece o `fornecedor_normalizado`. No dia em que
o parser gravar "Syagri Agronegócios" e "SYAGRI AGRONEGOCIOS" no mesmo banco, uma loja
vira duas barras e o filtro continua oferecendo uma opção só.

## Dado do Controle da Fazenda MG foi RECONSTRUÍDO em 19/08/2026 — e a lição

O extrato da SYAGRI (`JACOB DOMINGOS MOURO syagri.pdf`, único documento da aba) estava
com 23 itens, dos quais 10 defeituosos. **Não era bug do importador** — era o Matheus
testando a grade editável nova: linhas apagadas, células esvaziadas, `teste`/`aeee`
digitado por cima. Cheguei a abrir investigação contra o leitor de PDF e fechei quando
ele contou.

**A linha `teste` / `aeee` de R$ 1.060.000 era uma COMPRA REAL** — duplicata 61968/2-1,
`0004585-FERTILIZANTE CIBRA KCL 60 GR`, 400 × R$ 2.650. Eu tinha recomendado apagá-la.
Só descobri porque fui ler o PDF de origem em vez de confiar na tela.

Conserto: documento excluído e reimportado (com o PDF salvo antes — a exclusão apaga o
arquivo do Storage junto). **O leitor devolveu 28 de 28 itens idênticos ao extrato**,
inclusive os três documentos de duas linhas, e a soma bate ao centavo com o TOTAL GERAL
impresso no PDF. Para reconferir a qualquer momento:

```sql
select count(*), sum(valor_total) from itens_nfe
 where nota_fiscal_id is null
   and fazenda_id = (select id from fazendas where nome = 'Fazenda MG');
```

**Lição que vale além desta feature:** antes de recomendar apagar dado, leia a FONTE
(o PDF, o XML, o extrato) — não a tela. A tela já tinha sido editada por alguém.


## Aba "Controle" (gastos defensivos/adubos/sementes) — NO AR: PRs #61 e #62 mergeados em 18/08/2026

⚠️ **Este bloco já mentiu duas vezes, e a segunda foi consertada em 19/08/2026.** Em
17/08 dizia *"nada commitado ainda"* quando o trabalho estava numa worktree; até 19/08
dizia *"Epic 2.4 em execução"* quando os dois PRs já estavam mergeados havia um dia.
**Não escreva estado de feature aqui sem conferir o GitHub primeiro.**

- **PR #61 — a feature `Controle`.** Cruza a NF-e automática com PDF importado à mão
  (extrato de fornecedor tipo Solos/Syagri, contrato tipo Mosaic). Squash na `main`,
  branch `feature/controle-gastos` apagada no remoto. As 10 tarefas do plano da Epic 2.4
  (tela `/controle`) prontas, via `superpowers:subagent-driven-development`.
- **PR #62 — a tabela do Controle virou TOTALMENTE EDITÁVEL, estilo Excel.** Nasceu de
  ele testar a tela entregue no #61 e reprovar. **5 rodadas de revisão do Apolo, ~30
  achados**, testado ao vivo por ele a cada rodada. De quebra, o `web` **ganhou teste
  automatizado — não tinha NENHUM antes deste PR**.

**Detalhe completo — os ~30 achados, o histórico de cada rodada e os comandos que
remedem — vive no `ESTADO.md` DENTRO da worktree**, pela regra do próprio projeto
(detalhe mora perto do código; aqui só a frase-resumo). Não copiado para cá de
propósito, para as duas verdades não discordarem depois:
`C:\Users\Dib\Projetos\pessoal\agromouro-base\.claude\worktrees\ou-e5b8ce\ESTADO.md`

⚠️ **Risco conhecido dessa escolha:** aquele arquivo mora dentro de `.claude\worktrees\`.
**Quem apagar a worktree leva o único registro dos ~30 achados junto**, e nada avisa.
Antes de remover a worktree, mover o `ESTADO.md` dela para `docs/` neste repositório.

⚠️ **A checkout principal (esta pasta) está ATRÁS da `main` do GitHub.** Medido em
19/08/2026: o `git log` daqui para em `f7dccd2` (PR #60) — os PRs #61 e #62 não
aparecem. **Não conclua nada a partir do log local sem um `git fetch` antes.**
## Leitor de NFS-e (nota de serviço) — codado em 17/08/2026, 5 rodadas de revisão do Apolo feitas

**Estado:** Migração 011 JÁ APLICADA em produção e confirmada pela API (17/08, 12h20).
5 rodadas de revisão do Apolo — 1ª achou 8 pontos (2 altos), 2ª achou mais 1 alto + 3
menores (sobre os consertos dos 2 altos), 3ª confirmou o CÓDIGO limpo, 4ª e 5ª reabriram
só a PARTE DE TEXTO/DECISÃO do achado 9 (nenhuma achou defeito de código novo). Checagem
do e-mail da SITRACK já feita (achado 9: manda ZIP, fora do escopo abrir automaticamente —
fica manual mesmo, decisão do Matheus). Falta só `git push`. `cd api && npx vitest run`
e `npx tsc --noEmit` para medir o estado atual — não copiar número de teste para cá.

**⚠️ TRAVA DE ORDEM DE DEPLOY — LER ANTES DE DAR PUSH.** O código novo grava e filtra por
uma coluna `modelo` em `notas_fiscais` que **AINDA NÃO EXISTE em produção** — só existe
como migração escrita (`supabase/migrations/011_notas_fiscais_modelo.sql`), não aplicada.
Se este código subir pro Railway ANTES da migração rodar no Supabase, **toda gravação de
NF-e para de funcionar** (não só NFS-e) — `column modelo does not exist` em todo insert.
**Ordem obrigatória:** 1) rodar a migração 011 no SQL Editor do Supabase, 2) só depois
`git push`.

**E se a ordem for invertida, o erro é MUDO.** `nfeEmailWebhook.ts` responde `200 OK` pro
Make **antes** de processar o XML (linha 8, `res.status(200).json(...)`) — é assim de
propósito, pra não deixar o Make esperando. Mas isso quer dizer que, se o código subir
antes da migração, o `column modelo does not exist` acontece DEPOIS do 200 já ter sido
enviado: o Make marca como entregue e não reenvia, o erro vai só pro `console.error` do
Railway (ninguém olha isso em tempo real), e a nota inteira desaparece sem aviso nenhum —
nem pro Matheus, nem pro sistema. Mais um motivo pra respeitar a ordem acima à risca.

**O gatilho.** Matheus tentou subir pelo upload manual a NFS-e da SITRACK (mensalidade
do rastreador de frota, R$ 124) e o sistema recusou como "inválido" — o leitor só
conhecia NF-e de produto (raiz `<NFe>`). NFS-e é outro formato inteiro (raiz `<NFSe>`,
sem `<det>`/CFOP/NCM, sem `<cobr><dup>` de vencimento).

**O que foi feito (base).** `nfeProcessor.ts` ganhou `parseXmlNFSe()` (devolve o mesmo
formato `NFeData`, com item sintético único representando o serviço) e `parseXmlNota()`
(tenta NF-e primeiro, cai pra NFS-e). Os 3 lugares que liam nota fiscal — upload manual
(`nfeManual.ts`), webhook do Make (`nfeEmailWebhook.ts`) e o job que lê IMAP direto a
cada 30 min (`jobs/nfeEmail.ts`) — trocaram para `parseXmlNota`; o job também ganhou
`isNFSeXml()` companheiro do `isNFeXml()` que já existia.

**Achados da 1ª revisão do Apolo, e o que foi feito com cada um:**

1. **[ALTO, consertado]** Item de NFS-e (cfop/ncm vazios) caía na mesma cascata de uma
   NF-e sem CFOP/NCM — "compra normal, estocável até prova em contrário" — e a única
   prova em contrário era a IA (Haiku) classificando a descrição. Provado rodando
   `processarNFe` de verdade: virou insumo fantasma e somou estoque. Corrigido com um
   campo `servico: true` no item, que vence a cascata inteira sem perguntar pra IA — o
   PARSER já sabe que é serviço (soube ler `<NFSe>`, não `<NFe>`), não precisa adivinhar.
2. **[ALTO, consertado — código + migração + dado]** Número de NF-e e de NFS-e são
   sequências INDEPENDENTES do mesmo fornecedor — a trava de duplicidade (só
   numero+cnpj+fazenda) faria a NF-e nº 500 e a NFS-e nº 500 do mesmo emitente colidirem,
   e a segunda seria descartada em silêncio. **Decisão do Matheus, 17/08: consertar com
   migração agora, não só registrar o risco.** `NFeData` ganhou `modelo: 'nfe'|'nfse'`
   (obrigatório), migração `011_notas_fiscais_modelo.sql` (coluna + índice único novo:
   numero+cnpj+fazenda+modelo), e os 6 pontos que comparam nota por essa chave
   (`nfeJaProcessada`, `idDaNotaQueLancouGasto`, 2 buscas em `nfeManual.ts`) ganharam o
   filtro por `modelo`. **Migração escrita, NÃO aplicada em produção ainda** (ver trava
   de ordem de deploy acima).
5. **[médio, consertado]** `valorTotal` podia virar `NaN` sem ser pego (`??` não pega tag
   vazia, `NaN <= 0` é `false`) — cobrança ficaria sem valor E sem vencimento. Corrigido
   com `paraNumeroOuNull()` (`Number.isFinite`).
8. **[baixo, consertado]** Descrição só com espaço virava `''` depois do trim e caía
   DEPOIS do `??`, então não pegava o fallback "Serviço" — item sem nome que caísse no
   caminho estocável casaria com QUALQUER insumo (`.ilike('%%')`). Corrigido: `|| 'Serviço'`
   movido para depois do `.trim()`.
3+4. **[alto, consertado — código + dado, mesmo movimento]** `parseXmlNFe` (parser
   ANTIGO, já em produção — bug não relacionado ao pedido de hoje, achado sem querer
   procurar) tinha a MESMA falha do zero à esquerda em CNPJ/CPF. **Decisão do Matheus,
   17/08: consertar agora também.** Código: mesmo `numberParseOptions:{leadingZeros:false}`
   aplicado ao parser antigo. Dado: medido em produção via script (não SQL Editor — sem
   `DATABASE_URL` no `.env`, só o client do Supabase) — **129 notas no total, 39 com CNPJ
   corrompido** (36 perderam 1 zero, 3 perderam 2). Reparado com `.padStart(14,'0')` em
   cada linha — reversão exata, porque o bug só remove zero da frente, nunca dígito do
   meio ou do fim. **Já aplicado e conferido: as 129 notas têm 14 dígitos agora.** Script
   descartado depois (não fica no repo — era de uso único).
   **Limite do reparo:** `.padStart(14,'0')` só é uma reversão exata para **CNPJ** (14
   dígitos sempre). Não foi usado em CPF (11 dígitos) — não apareceu nenhum caso na
   amostra de 17/08, mas se aparecer, o mesmo `.padStart(14,'0')` aplicado a um CPF
   mutilado alongaria o número errado para 14 dígitos em vez de 11, piorando o dado em
   vez de corrigi-lo. Registrar o limite aqui porque o script já foi descartado.
   **Retrato de 17/08/2026 — quem foi corrigido, pelo nome como veio na nota** (8
   fornecedores, não 6 — a 1ª versão deste registro errou a contagem, achado do Apolo
   na 2ª revisão): USINA UBERABA, SYAGRI (2 filiais — CNPJ terminado em `000191` e em
   `000272`), PROTEC, TERRA AGRÍCOLA, CULTURA, FERNANDES E TAKAO, IPESA DO BRASIL. Esta
   lista é histórica e **não é mais recalculável ao vivo** (o script de reparo era de uso
   único e já rodou — os CNPJs já estão certos em produção, não sobrou "estado errado"
   para reconsultar). Para reconferir que o reparo continua valendo hoje (sem mais nada
   corrompido), a pergunta certa ao banco é: `SELECT emitente_nome, emitente_cnpj FROM
   notas_fiscais WHERE length(emitente_cnpj) NOT IN (11, 14)` — hoje deve devolver zero
   linhas.
6. **[baixo, documentado, sem código]** O leitor de NFS-e só entende o layout NACIONAL
   (raiz `NFSe/infNFSe`). Município que ainda emite em ABRASF (`CompNfse`/`Nfse`/`InfNfse`)
   continua sendo recusado — não é bug, é fronteira ainda não coberta. Amostra até
   17/08: 1 nota (SITRACK).
7. **[baixo, documentado, sem código]** `valorTotal` usa `vLiq` (líquido). Se um dia
   aparecer prestador com retenção de ISS de verdade, `vLiq` é o que se PAGA, não o custo
   total — gasto sairia subdimensionado. Não é o caso da SITRACK (ISS embutido, tomador
   CPF). Comentário deixado no código para quando aparecer o primeiro caso.

**Achados da 2ª rodada (sobre os consertos dos achados 1 e 2 acima) — 3ª confirmou o código; 4ª e 5ª reabriram só a parte de texto/decisão:**

9. **[ALTO, consertado — DADO, não código]** A NFS-e da SITRACK (a nota que motivou este
   trabalho inteiro) cai no caminho "conta sem vencimento" — e o probe achou que já existe
   em produção uma conta **RECORRENTE** da SITRACK (R$124/mês, dia 20, cadastrada em
   10/08), com 3 ocorrências JÁ CRIADAS em `contas_a_pagar`: agosto (R$124, **aberta**,
   vence 20/08), setembro e outubro (sem valor ainda, `aguardando`, vencem 20/09 e 20/10).
   Se a nota entrasse sem mais nada, nasceria uma SEGUNDA cobrança pro mesmo
   fornecedor/mês/valor — e como a recorrente não tem `nota_fiscal_id`, ela CRIA
   lançamento financeiro ao ser paga: pagar as duas dobra o GASTO de verdade (Financeiro
   E Dashboard), não só o boleto. Uma tarja de aviso na tela (código, 1ª tentativa) **não
   bastava** — dispensar a conta errada (a nova, em vez da recorrente) deixava as duas
   telas de dinheiro mostrando o dobro do gasto do mesmo jeito. **Decisão do Matheus,
   17/08: desligar só a regra recorrente (`contas_recorrentes.ativa = false`, id
   `8c0278e4-…`), sem apagar as 3 contas que ela já tinha criado** — feito direto em
   produção via script (mesma abordagem do reparo de CNPJ).

   **⚠️ Correção da 5ª revisão — desligar a regra NÃO apaga o lembrete até novembro.**
   `sincronizarOcorrencias` já tinha criado as 3 ocorrências ANTES de a regra ser
   desligada — elas continuam em `contas_a_pagar` e o aviso diário das 07:00 continua
   listando agosto/setembro/outubro normalmente (`reais(null)` vira "valor a definir").
   O lembrete só some de fato a partir de novembro/2026, quando a regra desligada deixa
   de gerar ocorrência nova.

   **Checagem de "a NFS-e chega sozinha por e-mail" — RESPONDIDA (17/08, confirmado pelo
   Matheus): NÃO chega sozinha, e o motivo é pior do que "só manda PDF".** O e-mail da
   SITRACK manda um **ZIP** (XML + boleto + nota juntos no mesmo arquivo compactado).
   `isNFeXml()`/`isNFSeXml()` (`jobs/nfeEmail.ts`) só reconhecem anexo `.xml` ou `.pdf`
   soltos — **nenhum lugar do código abre `.zip`**, então mesmo com a coluna `modelo` e
   o parser de NFS-e prontos, este fornecedor específico NUNCA vai entrar sozinho
   enquanto isso não for construído (extrair o zip é tarefa nova, fora do escopo de
   hoje — não é bug do trabalho desta sessão, é um formato que o pipeline de e-mail
   nunca tratou, nem pra NF-e). **Decisão do Matheus: continuar extraindo o XML do zip
   e subindo pelo upload manual todo mês** — é exatamente o que o botão "Adicionar NF →
   Upload XML" resolve. A regra recorrente (`8c0278e4-…`) fica desligada porque ele sabe
   que vai lançar à mão; se algum mês esquecer, não sobra lembrete automático — ele
   está ciente da troca.

   **Decisão do Matheus sobre a conta de agosto (17/08):** fica como está — ele vai
   **pagar ela normalmente e NÃO subir o XML de agosto da SITRACK** (evita o dobro: pagar
   a conta velha + lançar a nota nova pro mesmo mês). A NFS-e só começa a ser enviada a
   partir de **setembro**.
   **⚠️ Se subir o XML de agosto por engano DEPOIS de já ter pago a recorrente:**
   "dispensar" a conta nova NÃO desfaz o pagamento antigo — o lançamento de R$124 já
   pago fica lá do mesmo jeito, e o Financeiro/Dashboard mostram R$248. Antes de
   dispensar qualquer coisa, ir em `/contas`, achar o pagamento da recorrente de agosto e
   clicar **"Desfazer pagamento"** primeiro — só depois disso dispensar sobra sem gasto
   dobrado. Achado [alto] da 5ª revisão do Apolo.

   **As contas de setembro e outubro (ainda sem valor) — AÇÃO COM DATA, não "depois":**
   até **19/09/2026**, antes de pagar a recorrente de setembro, decidir: se a NFS-e de
   setembro já tiver chegado no sistema, **dispensar a conta da recorrente de setembro**
   (mesma lógica de agosto). Se não tiver chegado, pagar a recorrente normalmente e não
   subir a NFS-e de setembro depois. Mesma decisão pra outubro, até **18/10/2026**. Achado
   [alto] da 5ª revisão — a versão anterior deste registro dizia só "decide depois, na
   tela", sem dono nem data, e era justamente aqui que o gasto dobrava de verdade.
10. **[médio, consertado]** O aviso de "confira conta recorrente" só alcançava a coluna
    `observacao` da tela — nunca o WhatsApp, que é o canal que o dono lê primeiro. Nova
    função `linhaServicoSemRecorrencia()` em `avisoBoleto.ts`, mesmo padrão de
    `linhaBoletoContraOCodigo()` já existente. Texto ajustado nas duas pontas (tela e
    WhatsApp) pra nomear a AÇÃO CERTA — "dispense A RECORRENTE (não esta)" — porque a
    tarja irmã termina com "dispense esta conta", e copiar esse padrão aprendido
    dispensaria o lado errado.
11. **[baixo, aceito, sem código]** A tarja de "confira conta recorrente" dispara em
    TODA NFS-e sem vencimento, tenha ou não conta recorrente de verdade — hoje o volume é
    1 fornecedor conhecido (SITRACK), então o barulho é zero na prática. Se aparecer uma
    2ª NFS-e de outro fornecedor, revisitar: mover a decisão pra `gravarDeNota.ts`
    (que já é async) e consultar `contas_a_pagar` por recorrente do mesmo fornecedor/mês
    antes de carimbar — detectar e avisar, não casar automaticamente (casar errado é pior
    que avisar demais).

**Decisão registrada:** NFS-e sem vencimento no XML (a maioria — confirmado que o campo
só existe pra nota de aluguel de imóvel) cai no mesmo comportamento que nota de produto
sem duplicata: vira conta a pagar SEM DATA em Contas a Pagar, o dono confirma a data à
mão. Decisão do Matheus, 17/08 — não programar leitura de vencimento pra esse caso raro.

## ✅ A duplicata passa a vencer o tPag — ENVIADO em 14/08/2026

**Estado:** commit `cb7e531` (+ `4215b0b` de registro) na `main`, enviado ao GitHub pelo
Matheus às ~15:59 de 14/08. Revisado 2x pelo Apolo antes de subir. Deploy do Railway é
automático a partir da `main`.

**Falta a prova em produção:** ninguém viu isto rodando com nota de verdade ainda. A
confirmação vem sozinha na próxima NF-e que chegar com forma de pagamento de cartão ou
crédito da loja — o boleto deve nascer em Contas a Pagar com a tarja âmbar "Conferir
antes de pagar". Até lá, funciona só em teste.

**O defeito, medido com nota real.** A NF-e 76593 (HIGA COMERCIO E DISTRIBUICAO,
R$ 642,22, emitida e processada em 03/08/2026) trazia quadro de cobrança de verdade no
XML — `<dup>` com `dVenc` 2026-09-02 e `vDup` 642,22, e `Cnd.Pag:A PRAZO` no campo
livre. O parser leu a duplicata certinho. Quem jogou fora foi a REGRA: tPag `05`
("crédito da loja") estava em `MOTIVO_SEM_BOLETO` e fora de `CODIGOS_QUE_CEDEM_A_DUPLICATA`
(só `17`/`18`/`20`/`90` cediam). O boleto sumiu e o WhatsApp mandou
*"💳 Sem boleto — a nota diz crédito da loja"* — conclusão errada com cara de certa. O
Matheus só descobriu em 14/08, ao achar o PDF do boleto no e-mail: 11 dias de silêncio.

A regra antiga tinha sido escrita em 04/08 com **uma amostra só** (METAL AGRÍCOLA nota
51843, que usou `05` para o que o texto livre chamava de cartão de crédito). A HIGA usa
o mesmo código para carnê a prazo. É o risco de generalizar de uma amostra: tPag
descreve o MEIO de pagamento, não o MOMENTO, e cada fornecedor preenche do seu jeito.

**A correção (decisão do Matheus, 14/08, escolhida entre 2 opções apresentadas):**
duplicata real vence QUALQUER tPag. `CODIGOS_QUE_CEDEM_A_DUPLICATA` deixou de existir;
`motivoSemBoletoDaNota()` devolve `null` sempre que houver duplicata real. O mapa
`MOTIVO_SEM_BOLETO` continua existindo, mas só decide nota SEM quadro de cobrança.

**A contrapartida, no mesmo trabalho** — troca um erro caro (boleto perdido) por um
barato (boleto a mais), e barato só continua barato se o dono souber na hora. Nova
`motivoVencidoPelaDuplicata()` (`deNotaFiscal.ts`) alimenta **três** lugares, não um:

1. **WhatsApp da nota** — `linhaBoletoContraOCodigo()` (`avisoBoleto.ts`) acrescenta
   *"👀 Confira este boleto: a nota diz crédito da loja, mas veio com cobrança marcada…"*.
   `linhaBoleto()` ganhou um 6º parâmetro opcional para isso.
2. **A própria conta** — `observacaoDoBoletoContraOCodigo()` grava o aviso na coluna
   `observacao` (`gravarDeNota.ts`), e a tela de Contas mostra em âmbar na linha.
3. **Resumo diário** — `marcaConferir()` (`resumo.ts`) põe *"👀 confira antes de pagar"*
   na linha da conta, mais o link da tela no rodapé; a lista de colunas que o job lê
   virou `COLUNAS_CONTA_RESUMO`, exportada de `resumo.ts` e travada por teste.

**O aviso NÃO vale para tPag `17`/`18`/`20`/`90`** (PIX, transferência, "sem pagamento"),
via `CODIGOS_QUE_JA_CEDIAM_ANTES`. Esses já cediam à duplicata desde 06/08 — ali ela
sempre foi cobrança de verdade (revenda que embute o boleto na nota de remessa). Dizer
"pode já ter sido pago, dispense" numa dessas empurraria o Matheus a dispensar o boleto
mais caro do sistema: a SYAGRI de R$ 1.060.000 é tPag `90`, e remessa não tem fatura de
cartão. Achado [alto] da 2ª rodada do Apolo, pego antes de ir pro ar.

**Só o texto que começa com `PREFIXO_CONFERIR`** (`'Conferir antes de pagar:'`) vira
alerta na tela e no resumo — nunca "tem observação". A coluna é campo livre e já guarda
nota de auditoria escrita à mão em produção (conta `c0fbe499…`: *"Dispensada em
04/08/2026: cobrança duplicada"*). A constante está repetida nos dois lados
(`deNotaFiscal.ts` e `web/app/(app)/contas/tipos.ts`) porque o front não importa do back
— **mudar o texto exige mexer nos dois**.

Os itens 2 e 3 vieram do **achado [alto] do Apolo**: a mensagem da nota é enviada uma
vez, para um número só, e a falha de envio é engolida com `console.error`. Sem persistir,
o resumo diário cobraria esse boleto como *"🔴 urgente"* todo dia sem ressalva nenhuma —
e se o Matheus pagasse, o dinheiro sairia duas vezes **sem aparecer em lugar nenhum do
sistema** (`precisaCriarLancamento` devolve `false` para conta de nota, então o Financeiro
continuaria batendo certinho; só o extrato do banco ficaria errado).

`duplicataEhReal()` **não** mudou — o caso SYAGRI (duplicata vazia, R$ 1.060.000)
continua protegido pelo mesmo critério de 06/08.

Arquivos: `api/src/services/contas/deNotaFiscal.ts`, `avisoBoleto.ts`, `gravarDeNota.ts`,
`resumo.ts`, `api/src/jobs/contas.ts`, `api/src/services/nfeProcessor.ts`,
`web/app/(app)/contas/lista-contas.tsx` + testes em `deNotaFiscal.test.ts`,
`gravarDeNota.test.ts`, `avisoBoleto.test.ts` e `nfeProcessor.test.ts`.

HISTÓRIA de 14/08: 265/265 testes da API passando, `tsc --noEmit` limpo nos dois lados.
**Duas rodadas de revisão do Apolo**, a segunda achando 6 problemas na correção da
primeira — inclusive o mais grave de todos (o aviso indo parar em nota de remessa). Ele
mediu as mutações numa cópia isolada para provar quais testes realmente travam o quê:
zerar `marcaConferir` ou tirar `observacao` do `select` passava com a suíte inteira verde
antes desta segunda rodada.
O XML da HIGA foi guardado junto dos outros casos-testemunha em `.tmp/notas-exemplo/`
(pasta **fora do git**, ver `.gitignore:49` — se a máquina for trocada, o arquivo se
perde). Para refazer a medição ponta a ponta com um XML de verdade, em vez de confiar
só em teste de mesa:

O `-r dotenv/config` + `DOTENV_CONFIG_PATH` não são enfeite: `parseXmlNFe` mora em
`nfeProcessor.ts`, que importa `./supabase`, que estoura na carga sem as variáveis — e o
`.env` está na RAIZ, não em `api/`. Sem isso o comando não roda (medido: a primeira
versão escrita aqui em 14/08 estava quebrada, achado do Apolo).

```bash
cd api && DOTENV_CONFIG_PATH=../.env npx tsx -r dotenv/config -e "import {parseXmlNFe} from './src/services/nfeProcessor';import {contasDaNota,motivoVencidoPelaDuplicata,duplicataEhReal} from './src/services/contas/deNotaFiscal';import {readFileSync} from 'fs';const d=parseXmlNFe(readFileSync(process.argv[1],'utf-8'))!;const n={numero:d.numero,emitenteNome:d.emitenteNome,dataEmissao:d.dataEmissao,valorTotal:d.valorTotal,formaPagamento:d.formaPagamento,duplicatas:d.duplicatas,items:d.items.map(i=>({descricao:i.description}))};console.log('tPag',d.formaPagamento,'| boletos',JSON.stringify(contasDaNota(n).map(c=>[c.vencimento,c.valor])),'| aviso:',motivoVencidoPelaDuplicata(d.formaPagamento,d.duplicatas.some(duplicataEhReal)))" ../.tmp/notas-exemplo/31260810476426000170550010000765931015659698-nfe.xml
```

Saída esperada para a HIGA (conferida em 14/08):
`tPag 05 | boletos [["2026-09-02",642.22]] | aviso: a nota diz crédito da loja`

**Aviso que o Apolo deixou e não foi resolvido:** na amostra de 5 XMLs do repositório, a
ÚNICA nota que muda de comportamento com a regra nova é a METAL AGRÍCOLA 51843 — que é
cartão de verdade (`Cnd.Pag:A VISTA;PAGAMENTO CARTAO CREDITO`) e vai gerar boleto
fantasma **já vencido**. Ou seja: o aviso "confira este boleto" pode aparecer com
frequência e quase sempre pedir "dispensar". Aviso que quase sempre é falso alarme é
aviso que se aprende a ignorar. Se isso incomodar na prática, o refinamento está no
backlog abaixo.

**Próximo passo:** confirmar o deploy do Railway e conferir a próxima nota de fornecedor
que chegar com forma de pagamento de cartão.

## 🟡 Boleto da NF 76593 foi gravado À MÃO no banco — 14/08/2026

Enquanto a regra acima não sobe, o boleto que faltava foi inserido direto no Supabase
(`contas_a_pagar`, id `5d6e2ebd-e492-4275-a013-3c9012ab6173`), já com `nota_fiscal_id`
apontando para a NF 76593 — **de propósito**: conta amarrada à nota não cria lançamento
novo ao ser paga (`precisaCriarLancamento`, `contas/pagamento.ts`), então o gasto de
R$ 642,22 que a nota já lançou em 03/08 não é contado duas vezes. Se tivesse sido
cadastrada pela tela como "conta avulsa", nasceria solta e **duplicaria o gasto** no dia
do pagamento.

⚠️ **Lacuna que isto expõe:** a tela "Nova conta avulsa" não tem como vincular a conta a
uma nota fiscal. Sempre que chegar boleto de uma nota já lançada, ou alguém edita o
banco à mão (como hoje), ou o gasto dobra. O Matheus foi avisado e deixou a decisão de
construir o campo para depois.

## ✅ 4 notas de agosto sem boleto — CONFERIDAS pelo Matheus em 14/08, não tinham cobrança mesmo

Medido em 14/08/2026: das 14 notas que entraram de 01/08 em diante, 10 geraram boleto e
4 não, somando R$ 43.870,00 (NF 62473 SYAGRI R$ 29.150; NF 59109 SOLOS R$ 12.000;
NF 59104 SOLOS R$ 2.580; NF 47109 TOTAL METAL R$ 140). Como o XML não é guardado
(`xml_raw` fica vazio — ver memória `nfe-xml-nao-guardado`), o banco não sabe responder
se elas tinham `<dup>`; só o e-mail original. **O Matheus conferiu no mesmo dia: as 4
realmente não tinham boleto.**

Conclusão que isso fecha: o estrago da regra antiga (tPag barrando duplicata real) foi
**1 nota, a HIGA 76593** — não uma safra inteira de boletos perdidos. Vale como
tranquilizador, não como garantia: só cobre 01/08 em diante, e a regra existe desde
31/07. Nota anterior a isso nunca gerou boleto por outro motivo (a feature não existia).

Para refazer a lista depois (comparar notas contra contas vinculadas), consultar
`notas_fiscais` por `created_at` e cruzar com `contas_a_pagar.nota_fiscal_id`.

## 🟡 Pendências de baixo risco do Financeiro, deixadas para depois

Do conserto do botão "Adicionar" (PR #50, ver seção NO AR): índice único de nome de
insumo é **global**, não por fazenda — vira problema no dia em que a segunda fazenda
tiver dados; se o segundo `insert` falhar, sobra insumo "órfão" no catálogo (impacto
baixo); `recarregar()` zera a lista de produtos se a API cair na mesma falha que gerou
o aviso; projeto `web` não tem ESLint configurado, só o `tsc` confere automaticamente.

## 🟡 Achados menores deixados de propósito no PR #55 (Financeiro + Contas)

Nenhum é dinheiro errado — todos foram revisados e classificados como não-bloqueantes.
Detalhe completo em `.superpowers/sdd/2026-08-10-reorganizacao-financeiro-contas/progress.md`
(esse arquivo não é versionado — some se o worktree for limpo; o resumo abaixo é o que sobrevive):
agrupamento na Contas acontece depois da paginação (pode reordenar visualmente ou uma linha
"sumir" ao clicar "Carregar mais" — decisão deliberada, não bug); `aria-label` do botão
"expandir nota" sobrepõe o texto visível pro leitor de tela, igual nas duas telas; item sem
data no Financeiro fica invisível dentro de um filtro de mês específico, sem aviso; lista vazia
da Contas não tem atalho "ver tudo" como o Financeiro já ganhou.

## 🔴 As 66 toneladas da SYAGRI (dele, não do sistema)

466 t entregues contra 400 t faturadas = **66 t, R$ 174.900**. Ele supôs duplicata;
**contestei com evidência**: os 13 números de nota são todos distintos, e duplicata
neste sistema tem assinatura de número REPETIDO (caso provado: nota 58717 da SOLOS,
11 ms de diferença). Nenhum subconjunto das 13 soma 66. **Não é o banco.**

**O estoque NÃO foi baixado para 400 de propósito** — errar para menos é pior que para
mais: para menos ele compra a mais e paga duas vezes.

**Próximo passo, e é dele:** perguntar à SYAGRI + conferir o galpão.

## 🔴 Consulta da ERCAL — pendente desde 03/08, nunca rodada

O XML da nota 82398 (CFOP `5116`, remessa de calcário) diz `NFe Mae:000080930`.
**Se essa nota mãe entrou no sistema, o boleto de R$ 8.258 dela é fantasma.**
Falta ele colar no Supabase o resultado da consulta de notas/lançamentos da ERCAL —
é isso que decide se o calcário também entra no conserto do histórico.

## 🔴 CFOP de RETORNO de depósito (`5906`/`6906`) não mapeado

⚠️ **Correção feita em 04/08/2026, conferindo o código em vez de acreditar no texto:**
o `5905`/`6905` (remessa PARA depósito fechado) **já está mapeado** em
`api/src/services/contas/cfop.ts`, como "remessa sem compra". Quem falta é o **retorno**
— `5906`/`6906` — e os irmãos dele. O painel global e este arquivo diziam "família
`5905`/`5906` não mapeada", o que era meia verdade.

Confira em vez de acreditar: `grep -n "590[56]" api/src/services/contas/cfop.ts`

Sem o retorno mapeado, a nota de retirada de uma compra antiga conta como gasto novo.
**Não mapear às cegas** — a nota de origem pode não estar no sistema, e aí marcar "não
conta" **perde** o gasto em vez de consertá-lo. Precisa decidir caso a caso, com nota
na mão.

## 🟡 Tela de "produtos em carteira" (pedida por ele em 04/08, não para hoje)

Ele quer ver, **por fornecedor**, o que já é dele mas ainda está na loja — comprado e
pago, esperando retirada. Um extrato do tipo "na SYAGRI tenho X t a retirar, na SOLOS
tenho Y sacos".

**Por que ficou barato agora:** o conserto do CFOP construiu exatamente o dado que
faltava. O saldo em carteira é `faturado − entregue`, por insumo e por fornecedor:
- **faturado** = itens de nota com CFOP de faturamento de entrega futura (`5922`/`6922`)
  e, quando o retorno de depósito for mapeado, também a compra que ficou em depósito
- **entregue** = itens com CFOP de remessa (`5116`/`5117`/`6116`/`6117`) e o retorno
  de depósito (`5906`, se a regra confirmar)

Antes do CFOP isso era impossível: o sistema não distinguia "comprei" de "recebi".

**Cuidados já conhecidos, para quem for desenhar:**
- `cfop` é NULO em todo o histórico anterior a 04/08/2026 — a tela nasce cega para o
  passado. Ou aceita isso e mostra só o que veio depois, ou depende de preenchimento
  manual do histórico.
- A conta pode dar NEGATIVA e isso não é defeito: a SYAGRI entregou 466 t contra 400
  faturadas. Saldo negativo significa "recebi mais do que me cobraram" e é sinal de
  que falta nota de faturamento complementar — vale como ALERTA, não como erro.
- `xPed` (número do pedido) veio VAZIO na amostra real, e o vínculo com a nota mãe só
  existe em texto livre no campo de observação. Não dá para agrupar automaticamente
  por pedido — agrupar por fornecedor + insumo é o que é confiável hoje.
- O **retorno** de depósito (`5906`/`6906`) ainda não está mapeado (item acima).

## 🟡 Nota de serviço (NFS-e) não é lida por NENHUM caminho automático — achado em 05/08/2026

`parseXmlNFe` (`api/src/services/nfeProcessor.ts:78`) exige a raiz `<NFe>`/`<infNFe>` —
formato da nota de PRODUTO (SEFAZ, padrão nacional). Nota de serviço (NFS-e) é emitida
pela prefeitura, sem padrão nacional único, e não tem essas tags. Os dois caminhos
automáticos (Make e o job interno `jobs/nfeEmail.ts`) descartam em silêncio — sem erro,
sem aviso, some.

**Frequência, na palavra dele:** nem rara nem comum, "meio termo".

**Decisão de 05/08:** fica no backlog. Enquanto não for construído, lançar à mão pela
tela **Financeiro** (botão Adicionar — não pela tela de NF-e), que grava o gasto sem
precisar de nota vinculada. **Não cria boleto em Contas a Pagar sozinho** — se a nota
de serviço tiver vencimento futuro, lançar isso à parte.

Efeito colateral do lançamento manual: cria uma linha nova em `insumos` para cada
descrição não repetida — pode acumular entrada avulsa no catálogo de insumos, que é
pensado para produto agrícola, não serviço. Não corrigido, não é urgente.

Construir suporte de verdade é trabalho grande (cada prefeitura formata do seu jeito) —
só vale quando a frequência justificar.

## ⚠️ `precisaCriarLancamento` — deliberadamente NÃO consertado

`api/src/services/contas/pagamento.ts`: nota de remessa pode gerar boleto sem gasto;
marcar como paga não cria lançamento, e o dinheiro some da conta de custo.
**Decisão dele, com motivo:** criar o lançamento ali dobraria o gasto se a nota mãe
tiver entrado, e o sistema não tem como saber. Mitigado com aviso no WhatsApp quando o
boleto cobra mais que o gasto lançado.

## Defeitos e pendências menores — nenhum trava nada

- **P1** — nota certa fica vermelha quando a Z-API cai (~4 linhas de conserto).
- **P5** — o botão "Reprocessar" não faz nada.
- Link do WhatsApp perde o filtro no login.
- Falta a tela que mostraria `forma_pagamento`.
- Não há botão de apagar/editar conta fixa (o spec pedia, o plano omitiu).
- `categoria` é texto livre e fragmenta o relatório por categoria.
- `calcularTotais` é puro mas sem teste (o Vitest só foi instalado na API).
- `.superpowers/sdd/.../task-1-report.md` é rascunho que vazou no squash.
- **P2 saiu de urgente:** só a fazenda de MG recebe NF-e hoje. `APP_URL` já configurada
  no Railway.
- Nota misturada (parte compra, parte remessa) lança o gasto só da parte de compra —
  comportamento correto e **travado por teste**.
- **Duplicata parcialmente vazia** (achado [baixo] do Apolo, 14/08/2026, sem ocorrência
  conhecida): nota com 1 duplicata real + 1 só com número de controle gera 2 contas, e a
  segunda nasce sem valor e sem data. A mensagem sai *"2 boletos: 10/09, sem data —
  R$ 500,00 no total"* para uma nota de R$ 1.000. Pré-existente; a mudança de 14/08 só
  estendeu isso a cartão/dinheiro.
- **Refinar o aviso "confira este boleto" pelo campo livre** (sugestão do Apolo, 14/08):
  o `infCpl` separa os dois casos sozinho — HIGA diz `Cnd.Pag:A PRAZO`, METAL AGRÍCOLA diz
  `Cnd.Pag:A VISTA;PAGAMENTO CARTAO CREDITO`. Ler isso permitiria subir o tom só quando
  for cartão de verdade, em vez de pedir conferência em toda nota de cartão. Texto livre é
  frágil (cada fornecedor escreve do seu jeito) — por isso é refinamento, nunca regra.

Detalhe de cada um: `.superpowers/sdd/2026-07-31-contas-a-pagar-fase2/progress.md` e
`.superpowers/sdd/2026-08-03-nfe-cfop-entrega-futura/progress.md`.

---

# 3. HISTÓRICO — do mais novo para o mais velho

## 07/08/2026 — faxina do repositório, e a armadilha do squash merge

Sobravam 4 pastas de worktree órfãs e 9 branches locais de sessões antigas, todas de
trabalho já mergeado. Tudo apagado (local e remoto), `main` sincronizada com o GitHub.
Para reconferir a qualquer momento, em vez de confiar neste parágrafo:

```bash
git worktree list && git branch -a
```

**A lição, que já custou um alarme falso nesta mesma sessão:** os PRs deste repositório
entram por *squash merge* — o GitHub junta todos os commits do ramo num só, com
identificador novo. Por isso `git rev-list --count origin/main..<ramo>` **sempre** acusa
commits "exclusivos" num ramo já mergeado, e `git branch --contains <sha>` não acha nada
na `main`. Isso parece trabalho perdido e não é. Aconteceu com o
`worktree-nfe-upload-manual`: 8 commits pareciam correção de segurança parada há 2 dias,
mas tinham entrado no PR #46 no dia anterior — arquivo por arquivo, idênticos à `main`.

**Antes de declarar que um ramo tem trabalho perdido, confira por CONTEÚDO:**

```bash
gh pr list --state all --head <ramo>
git diff --stat origin/main <ramo> -- <arquivo-chave>
```

PR MERGED, ou diff vazio, significa que o trabalho entrou.

## 04/08/2026 — o que o conserto do CFOP ensinou

### Três erros do plano, achados conferindo contra XML real

1. `tPag` NÃO prova cobrança — a ERCAL 82398 é remessa (`5116`) com `tPag 15`. Seguir
   o plano manteria o calcário dobrando. Só a duplicata prova.
2. Duplicata NÃO vence cartão — a METAL AGRÍCOLA 51843 é cartão (`05`) com duplicata.
   Só o código `90` cede.
3. A Decisão 3 do plano ("compra OU cobrança") virou escada excludente, não OU. Em nota
   misturada a metade "cobrança" ficava inalcançável.

### A tela Financeiro não somava o que o plano consertava

Descoberta que quase passou: `web/app/(app)/financeiro/page.tsx` soma **`itens_nfe`**,
não `lancamentos_financeiros`. O plano inteiro consertaria o Dashboard e deixaria o
fantasma na tela que ele abre todo dia. Virou a Task 6.5. Ver a memória
`financeiro-soma-itens-nao-lancamentos`.

### Histórico da SYAGRI corrigido (sessão com ele, transação com travas)

Estoque de KCl **866 → 466 t** · gasto **R$ 2.294.900 → R$ 1.116.280** · 1 cobrança
fantasma de R$ 29.150 **dispensada com motivo escrito** (não apagada).
Notas de ENGEO PLENO (45993, 46247) não foram tocadas — outro produto, outra série.
Números de 04/08, congelados: para reconferir, medir no banco, não acreditar neste texto.

## 03/08/2026 — a obra do CFOP, enquanto estava em execução

*(Superado pelo 04/08 acima; fica registrado porque explica as decisões.)*

Ramo `feat/nfe-cfop`. Ledger: `.superpowers/sdd/2026-08-03-nfe-cfop-entrega-futura/progress.md`
— lista as decisões P1–P5 e o que foi commitado.

Tasks 1 e 2 no ar (HISTÓRIA de 03/08: 147 testes verdes, `tsc` limpo). Tabela de CFOP
do plano conferida contra a tabela oficial: bateu inteira.

⚠️ **A pré-conferência dos 4 XMLs reais derrubou 4 trechos do plano** — o mais grave:
a ERCAL (nota 82398, CFOP `5116`) também trabalha com duas notas, o campo de
observação diz `NFe Mae:000080930`. O texto do plano consertaria só a SYAGRI e
deixaria a ERCAL dobrando, porque usava a forma de pagamento como prova de cobrança
e a ERCAL preenche `tPag=15`. Decidido com o Matheus: **só o quadro de boletos prova
cobrança.**

## 31/07/2026 — Contas a pagar Fase 2, e a limpeza de dado feita com ele

**Código completo e revisado.** Ramo `feat/contas-a-pagar-fase2`, 27 commits
(HISTÓRIA de 31/07: 128 testes verdes, `tsc` limpo nos dois lados). Spec e plano em
`docs/superpowers/{specs,plans}/2026-07-31-contas-a-pagar-fase2*`.

⚠️ **NÃO foi confirmado de fora que os deploys já servem o código NOVO** — nenhum dos
dois expõe versão. A prova seria a próxima NF-e real.

✅ **Limpeza de dado, na mesma noite:** R$ 45.227,24 de lançamentos de TESTE (de 21 e
25/05) apagados — eram só financeiros, **não encostaram no estoque**. Conferido
movimentação por movimentação: tudo em `movimentacoes_estoque` sem nota é
`saida/operacao` (pulverização real), `entrada/manual` (desfazimento da semana de
desenvolvimento) ou `correcao_unidade`. **Estoque limpo.**

📐 De quebra: as quantidades 111,900 e 223,800 provam que o sistema multiplica dose por
área certo (1 e 2 L/ha sobre 111,9 ha).

🐛 `movimentacoes_estoque.origem` tem valores (`operacao`, `correcao_unidade`) que NÃO
estão no `schema.sql` — mais uma prova de que aquele arquivo é documento velho.

⚠️ Conferência final NÃO pode reenviar os XMLs de `.tmp/notas-exemplo/` — as notas já
foram processadas e seriam ignoradas em silêncio. Só nota nova serve de prova.

## Descobertas que mudaram o desenho (julho/2026)

🐛 **Duplicata REAL, não teórica** (pré-checagem da migração 005): nota 58717 da SOLOS
SOLUÇÕES gravada duas vezes em 08/06/2026, com **11 milissegundos de diferença** — a
corrida entre as duas portas de entrada, provada. Estrago corrigido em produção com
ele: 5 L de TEBURAZ a mais no estoque (22,226 → 17,226) e R$ 4.400 de gasto contado em
dobro. Conferido depois: trava existe, 1 nota só, saldo certo. Memória:
[[nfe-corrida-duas-portas]].

🐛 **Dois defeitos que já estavam no ar**, achados pela sabatina e consertados:
(1) `nfeJaProcessada` deduplicava por número+fazenda e **ignorava o emitente** — número
de NF-e é sequencial POR fornecedor, então dois fornecedores com o mesmo número faziam
o sistema descartar uma compra inteira em silêncio (estoque, gasto e, na Fase 2, o
boleto). (2) as duas portas de entrada (Make + job de 30 min) conferiam e gravavam em
dois passos, e `notas_fiscais` **não tinha UNIQUE nenhum**. Conserto único: a chave
passou a incluir `emitente_cnpj` + índice único no banco.

📏 **Medido em 3 XMLs reais** (`.tmp/notas-exemplo/`): 2 de 3 trazem o vencimento;
a ERCAL (calcário, R$ 8.258) não traz em canto nenhum, nem no campo de observação.
`indPag` é contraditório — o único sinal confiável é a presença de `dVenc`.
Prazos curtíssimos: 7 dias e 1 dia. Nenhuma amostra era parcelada nem de adubo.

⚠️ **"À vista" na boca dele NÃO é "pago na hora"** — é pagamento em parcela única com
data marcada (adubo comprado 31/07, R$ 660 mil no dia 15/08). Ou seja, a nota de valor
alto é o caso PRINCIPAL da Fase 2, não a exceção. Parcelado de verdade é peça e
material, valor menor. Volume: 10 a 30 notas/mês. Memória: [[a-vista-e-parcela-unica]].

⛔ **Bloqueio que existia:** o bloco de cobrança é OPCIONAL na nota fiscal e não dava
para conferir nas notas antigas — o XML nunca foi guardado ([[nfe-xml-nao-guardado]]).
Resolvido na marra: ele salvou XMLs reais do Outlook em `.tmp/notas-exemplo/`
(`.tmp/` está protegida no `.gitignore`). Foram esses arquivos que derrubaram 4 trechos
do plano do CFOP em 03/08.

⚠️ A Fase 2 quebrou a regra de ouro da Fase 1 ("nada altera o fluxo de NF-e"): obrigou
a mexer no `nfeProcessor.ts`, peça que alimenta estoque, financeiro e WhatsApp sozinha.
Se quebrar, quebra calada — vale lembrar disso na próxima mexida ali.

⚠️ Armadilha que já mordeu: [[lancamento-invisivel-sem-origem]] na memória do projeto.
