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

# 1. NO AR — o que o sistema já faz

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

---

# 2. ABERTO — o que precisa de decisão ou de trabalho

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

## 🟡 Segunda porta cega: upload manual de XML

`web/app/(app)/nfe/page.tsx` faz a leitura do XML **no navegador** e insere em
`itens_nfe` sem `cfop` e sem `conta_como_compra`. Toda nota que entrar por esse caminho
volta a ter o defeito que o PR #45 consertou. Tarefa própria, ainda não aberta.

⚠️ **Achado investigando essa porta (05/08):** ela pode ENVENENAR o caminho automático.
`nfeJaProcessada` (`api/src/services/nfeProcessor.ts:152`) só confere se a nota EXISTE
em `notas_fiscais` — não se foi processada. Subir pela tela cria essa linha; quando a
nota real chega por e-mail depois, o sistema acha que já foi feita e ignora **para
sempre** (o botão "Reprocessar" não resolve — é o P5, só muda o status). Isso pesa
contra manter a porta como está.

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

Detalhe de cada um: `.superpowers/sdd/2026-07-31-contas-a-pagar-fase2/progress.md` e
`.superpowers/sdd/2026-08-03-nfe-cfop-entrega-futura/progress.md`.

---

# 3. HISTÓRICO — do mais novo para o mais velho

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
