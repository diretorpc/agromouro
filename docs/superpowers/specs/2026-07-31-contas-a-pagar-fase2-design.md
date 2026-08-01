# Design: Contas a Pagar — Fase 2 (boletos nascendo das notas fiscais)

**Data:** 2026-07-31
**Status:** Aguardando aprovação do Matheus
**Fase 1:** no ar desde 31/07/2026 (PR #43, `f3b614d`), testada em produção pelo dono
**Spec da Fase 1:** `docs/superpowers/specs/2026-07-29-contas-a-pagar-design.md`

---

## Objetivo

Quando uma nota fiscal chega por e-mail, o boleto dela entra sozinho na agenda de contas
— com data de vencimento e valor — sem o Matheus digitar nada. Quando a nota não traz a
data, o sistema avisa e ele resolve em dois toques.

**O que a Fase 2 NÃO faz:** não muda o Financeiro, não muda o painel, não mexe em número
que já está no ar.

---

## O que mudou no entendimento (e por quê isto vem antes de tudo)

Durante o brainstorming o Matheus corrigiu uma premissa que estava errada no meu
entendimento, e a correção mudou o desenho inteiro:

> **"À vista", na linguagem dele, NÃO significa "pago no ato".**
> Significa **pagamento em parcela única, com data marcada no futuro.**
> Exemplo dele: adubo comprado em 31/07, R$ 660.000,00 pagos de uma vez em 15/08.

Consequência: as notas de valor alto (adubo, defensivo, semente) são o **caso principal**
da Fase 2, não a exceção. O parcelamento de verdade acontece em peça e material, de valor
menor.

Registrado em memória permanente: `a-vista-e-parcela-unica.md`.

---

## Evidência medida (não suposta)

Três arquivos reais de NF-e do produtor, salvos em `.tmp/notas-exemplo/` em 31/07/2026:

| Fornecedor | O que é | Valor | Emitida | Quadro de cobrança | Vencimento | Forma de pagamento |
|---|---|---|---|---|---|---|
| TRIANGULO DIESEL TRR | combustível | R$ 30.600,00 | 14/07 | ✅ presente | 21/07 (1 parcela) | `tPag=15` boleto, sem `indPag` |
| **ERCAL** | **calcário** | **R$ 8.258,40** | **23/07** | ❌ **ausente** | **nenhum** | `indPag=0` "à vista" + `tPag=15` boleto |
| METAL AGRICOLA | peças | R$ 355,00 | 31/07 | ✅ presente | 01/08 (1 parcela) | `indPag=1` a prazo + `tPag=05`, texto livre diz cartão de crédito |

**Placar: 2 de 3 trazem a data.** O campo de observações (`infCpl`) foi conferido nos três
— a ERCAL não escreveu a data lá também. A data daquela nota **não existe no arquivo**.

**Três conclusões que a amostra impõe:**

1. **O quadro de cobrança funciona** — o desenho é viável.
2. **`indPag` não é confiável.** A ERCAL marcou "à vista" e boleto ao mesmo tempo; o
   Triângulo Diesel nem preencheu. **O único sinal confiável é a presença de `dVenc`.**
3. **Prazos são curtíssimos:** 7 dias e 1 dia. Esperar a tarefa das 07:00 é tarde demais.

**Buraco conhecido na amostra:** nenhuma das três estava parcelada, e nenhuma era de
adubo de valor alto. O caso dos R$ 660 mil **continua sem prova**.

---

## Decisões fechadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Nota vira conta a pagar automaticamente? | **Sim**, ao processar a nota. Sem confirmação |
| 2 | Em que mês o gasto conta? | **Não muda nada.** Financeiro responde "quanto custou a safra" (data da nota); Contas responde "quanto sai do banco e quando" (data do vencimento). Duas perguntas, não duas verdades |
| 3 | Nota com N parcelas | **N contas**, uma por parcela, cada uma com sua data e seu valor |
| 4 | Nota sem data no arquivo | **Cria a conta sem data**, etiquetada "falta vencimento", e **avisa** no WhatsApp |
| 5 | Como o Matheus responde | **Pelo link para a tela**, não por texto no WhatsApp. Ver "Alternativa descartada" |
| 6 | Nota paga no cartão de crédito | **Não vira conta** — quem cobra é a fatura do cartão, já controlada na tela de Cartões |
| 7 | Notas antigas | **Não migram.** O arquivo delas nunca foi guardado. Vale das novas em diante |
| 8 | Guardar o arquivo XML | **Não.** 100–200 MB/ano contra 500 MB do plano gratuito. Extrai o que serve, descarta o resto |
| 9 | Aviso de boleto curto | **Vai junto na mensagem de "NF-e processada"** que já existe, no minuto em que a nota chega |
| 10 | Trava anti-duplicata de NF-e furada | **Consertar DENTRO desta fase, como primeira tarefa.** Ver "Pré-requisito" |
| 11 | Insistência da conta sem data | **Todo dia, subindo de tom:** passados 5 dias sem resposta, sai do grupo ❓ e entra no 🔴 junto das atrasadas |
| 12 | Aprender o prazo do fornecedor | **Fora desta fase.** Ver "Fora de escopo" |

### Alternativa descartada: responder por texto no WhatsApp

Foi considerada e recusada **nesta fase**. Motivo medido, não estético:

- O webhook do WhatsApp classifica a mensagem em 5 tipos (operação, aplicação de insumo,
  consulta de estoque, consulta geral, desconhecido). **"Resposta a uma pergunta pendente"
  não é um deles.**
- A tabela `confirmacoes_pendentes` existe desde a migration 003 e **nenhuma linha de
  código a usa** — foi construída e abandonada.
- O problema difícil não é entender "vence dia 15": é saber **de qual nota** ele falou
  quando há 3 esperando. Ou o sistema repergunta (chato), ou chuta (carimba data errada
  na nota errada, em silêncio).

O link resolve a ambiguidade de graça: ele tocou naquela conta, então o sistema sabe qual é.
Se o uso provar que abrir o site incomoda, isto vira fase própria — com dado, não palpite.

---

## Pré-requisito: consertar a trava anti-duplicata de NF-e

**Descoberto na sabatina de 31/07, em código que já está em produção.** Não foi criado
pela Fase 2 — mas a Fase 2 pisa em cima e transforma um número errado em dinheiro perdido.
Aprovado pelo Matheus para entrar **como primeira tarefa desta fase**.

### Defeito 1 — a chave de deduplicação ignora quem emitiu

`nfeJaProcessada(numero, fazenda_id)` (`nfeProcessor.ts:105-114`) pergunta apenas
*"já existe a nota nº 4516 nesta fazenda?"*.

**O número da NF-e não é único no mundo — é sequencial por emitente e por série.** As três
amostras reais: Triângulo Diesel nº 4516, Metal Agrícola nº 51843, ERCAL nº 82398. No dia
em que outro fornecedor emitir uma nota nº 4516, o sistema **descarta em silêncio**
(`"NF-e 4516 já processada — ignorando"`): estoque não entra, financeiro não registra e,
com a Fase 2, **o boleto nunca nasce** — o Matheus não paga e leva juros ou protesto.

### Defeito 2 — duas portas de entrada, conferência não atômica

A NF-e entra por dois caminhos que rodam em paralelo:

- Make (make.com) vigia as duas caixas → `POST /webhook/nfe-email` → `nfeEmailWebhook.ts`
- Tarefa `nfeEmail.ts` a cada 30 min, via IMAP direto (`jobs/index.ts:29`)

Ambos fazem *conferir → gravar* em dois passos separados. Não existe **nenhuma** restrição
única no banco: `notas_fiscais` não tem UNIQUE em coluna alguma (conferido em
`schema.sql:84-94` e em todas as migrations). Se os dois caminhos pegarem a mesma nota no
mesmo instante, ela entra duas vezes — estoque dobrado, gasto dobrado, boleto dobrado.

### O conserto (um só, resolve os dois)

```sql
-- ANTES DE APLICAR: conferir se já existe duplicata em produção.
-- Se devolver linha, decidir com o Matheus qual fica — o índice FALHA se houver repetido.
SELECT numero, emitente_cnpj, fazenda_id, count(*)
FROM notas_fiscais
GROUP BY numero, emitente_cnpj, fazenda_id
HAVING count(*) > 1;

-- A tranca de verdade. Sem cláusula WHERE, pelo mesmo motivo da Fase 1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfe_numero_emitente_fazenda
  ON notas_fiscais (numero, emitente_cnpj, fazenda_id);
```

E no código: `nfeJaProcessada(numero, emitenteCnpj, fazendaId)` — os dois chamadores
(`jobs/nfeEmail.ts:89` e `webhooks/nfeEmailWebhook.ts`) passam o CNPJ do emitente.

**Ordem obrigatória:** esta tarefa vem **antes** de qualquer coisa da Fase 2. Construir
boleto automático em cima de trava furada é construir sobre areia.

---

## Arquitetura

Mesma divisão que fez a Fase 1 subir sem susto: **decisão em função pura e testada; a
camada que fala com o banco fica fina.**

### Arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `api/src/services/contas/duplicatas.ts` | Dado o conteúdo de uma NF-e, quais contas devem nascer. **Puro, sem banco** |
| `api/src/services/contas/duplicatas.test.ts` | Testes da regra |
| `api/src/services/contas/deNotaFiscal.ts` | Única peça que grava as contas da nota no banco |
| `supabase/migrations/005_contas_de_nfe.sql` | Ajustes de tabela (abaixo) |

**Modificar:**

| Arquivo | O quê | Risco |
|---|---|---|
| `api/src/services/nfeProcessor.ts` | `parseXmlNFe` passa a ler `cobr` e `pag`; `processarNFe` ganha **uma** chamada isolada no fim | ⚠️ **o ponto sensível** — ver rede de proteção |
| `api/src/services/contas/resumo.ts` | Novo grupo "sem vencimento"; tolerar vencimento vazio | baixo, é puro e testado |
| `api/src/jobs/contas.ts` | Incluir o grupo novo e o link no texto | baixo |
| `web/app/(app)/contas/page.tsx` | Filtro por tipo, filtro "falta vencimento", três botões | médio (arquivo com 633 linhas — ver nota) |

**Nota sobre `page.tsx`:** já tem 633 linhas e vai crescer. A lista de contas sai para um
componente próprio como parte desta fase — não é refatoração à toa, é a peça que estamos
mexendo ficando grande demais para ser mexida com segurança.

### Fluxo quando a nota chega

```
E-mail com NF-e
      │
      ▼
parseXmlNFe ─── lê o que já lia (emitente, itens, total)
      │         + NOVO: quadro de cobrança (dup[]) e forma de pagamento (pag)
      ▼
processarNFe ── grava a nota, o estoque, os itens, o lançamento financeiro
      │          (TUDO isso continua exatamente igual)
      │
      └──► try { criarContasDaNota() } catch { só registra no log }   ◄── NOVO, isolado
                    │
                    ▼
            duplicatas.ts decide:
              tem dup[] ......... N contas, uma por parcela
              sem dup[] ......... 1 conta sem data ("falta vencimento")
              forma = cartão .... nenhuma conta
                    │
                    ▼
            grava em contas_a_pagar (trava de duplicidade no banco)
                    │
                    ▼
            a mensagem de "NF-e processada" ganha a linha do boleto
```

### 🛡️ Rede de proteção — a parte que não pode falhar

A Fase 1 tinha a regra de ouro *"nada altera o fluxo de NF-e"*, e foi por isso que subiu
tranquila. **A Fase 2 quebra essa regra por necessidade.** O `nfeProcessor.ts` é a peça que
alimenta estoque, financeiro e WhatsApp sozinha; se ela quebrar, quebra calada e o
Matheus só descobre pelo estoque errado semanas depois.

Quatro travas, todas obrigatórias:

1. **A leitura só ACRESCENTA campos.** Nenhum campo existente muda de nome, tipo ou
   significado. Nota sem os blocos novos continua sendo lida exatamente como hoje.
2. **A criação de contas fica isolada, por último, dentro do próprio `try/catch`.**
   Se falhar — arquivo estranho, banco fora do ar, qualquer coisa — a nota **continua**
   atualizando estoque, financeiro e WhatsApp. A conta a pagar é parafusada por fora,
   nunca pré-requisito.
3. **Reprocessar a mesma nota não duplica boleto.** Trava no banco (índice único),
   mesma solução da Fase 1.
4. **A decisão inteira mora em função pura, coberta por teste.** O pedaço que grava é fino
   de propósito.

**Critério de aceite desta seção:** existe um teste que prova que, quando a criação de
contas estoura, a nota ainda é processada por inteiro.

---

## Estrutura de dados

Nenhuma tabela nova. Quatro ajustes:

```sql
-- 1. Conta pode nascer sem data de vencimento (caso ERCAL).
--    "Falta vencimento" NÃO vira status: é derivado da coluna vazia, do mesmo jeito
--    que "atrasada" já é derivada. Guardar como estado criaria segunda verdade.
ALTER TABLE contas_a_pagar ALTER COLUMN vencimento DROP NOT NULL;

-- 2. Qual parcela desta nota é esta conta ("2 de 3").
ALTER TABLE contas_a_pagar
  ADD COLUMN IF NOT EXISTS numero_parcela SMALLINT,
  ADD COLUMN IF NOT EXISTS total_parcelas SMALLINT;

-- 3. Trava de duplicidade: uma conta por nota por parcela.
--    SEM cláusula WHERE, de propósito — índice único PARCIAL não serve de árbitro
--    para ON CONFLICT e o banco recusa em silêncio (erro 42P10). Este projeto já
--    passou por isso nas cotações. NULL é distinto de NULL num índice único, então
--    conta fixa (nota_fiscal_id nulo) não colide com outra conta fixa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conta_nota_parcela
  ON contas_a_pagar (nota_fiscal_id, numero_parcela);

-- 4. Qual forma de pagamento o sistema LEU na nota. Serve para auditar por que uma
--    nota não gerou boleto, em vez de adivinhar.
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
```

**Não precisa de coluna para separar "conta fixa" de "boleto de nota":** conta fixa tem
`recorrente_id` preenchido, boleto de nota tem `nota_fiscal_id` preenchido. A informação
já existe.

### Com que valores a conta de nota nasce

| Coluna | Valor |
|---|---|
| `descricao` | `"<emitente> — NF <numero>"`, com `" (2/3)"` quando parcelada |
| `fornecedor` | emitente da nota |
| `vencimento` | `dVenc` da parcela — **ou vazio**, quando o arquivo não traz |
| `competencia` | 1º dia do mês do vencimento; **sem vencimento**, 1º dia do mês da emissão |
| `valor` | `vDup` da parcela |
| `valor_estimado` | `false` — é o valor real do boleto, não estimativa |
| `status` | `aberta` — a nota chegou, o valor é real. **Nunca `aguardando`**, que significa "ainda não chegou" |
| `nota_fiscal_id` | a nota |
| `numero_parcela` / `total_parcelas` | 1/1, ou 1/3, 2/3, 3/3 |
| `categoria` | `insumos` |
| `recorrente_id` | vazio |

### Regra de leitura da forma de pagamento

Não cria boleto quando o código lido for de cartão ou dinheiro:

| Código | Significa | Cria conta? |
|---|---|---|
| `03`, `04`, `05` | cartão de crédito, débito, crédito loja | ❌ não |
| `01` | dinheiro | ❌ não |
| `15` boleto, `90` sem pagamento, `99` outros, ausente | — | ✅ sim |

⚠️ **Decisão tomada com uma amostra só.** A METAL AGRICOLA usou `05` ("crédito loja") para
o que o texto livre chama de cartão de crédito. Por isso a coluna `forma_pagamento` existe:
se um boleto sumir da agenda, dá para descobrir por quê. **Confirmar a tabela oficial de
códigos no manual vigente da NF-e na hora de implementar** — não confiar nesta lista de cor.

**A decisão de NÃO criar boleto é anunciada, nunca silenciosa.** A mensagem de "NF-e
processada" diz o que o sistema concluiu (`💳 Sem boleto — a nota diz cartão de crédito`).
Se o fornecedor marcou errado, o Matheus vê no mesmo minuto e cadastra à mão — em vez de
descobrir pelo boleto vencido. Este é o principal remédio do risco nº 3.

### Casos de borda da leitura

| Situação no arquivo | O que o sistema faz |
|---|---|
| `cobr` presente, mas a parcela sem `dVenc` | Trata como **sem vencimento** — mesma etiqueta e mesmo fluxo do caso ERCAL |
| `cobr` com `fat` e nenhuma `dup` | Trata como **sem vencimento** — 1 conta com o valor total da nota |
| Parcela com `dVenc` mas sem `vDup` | Cria a conta com data e **sem valor**; o valor entra junto com a confirmação |
| Mais de 24 parcelas | Cria mesmo assim e registra no log. Truncar seria perder boleto em silêncio |

⚠️ **Armadilha de leitura, com risco real de passar despercebida.** O leitor de XML devolve
**um objeto** quando existe uma única `<dup>` e **uma lista** quando existem várias. O
código já trata isso para os itens da nota (`nfeProcessor.ts:78-79`) e **precisa tratar
igual** para `cobr.dup` e `pag.detPag`.

Por que isto é perigoso aqui: **as três amostras reais têm exatamente uma parcela.** O
caminho de várias parcelas **não tem nenhuma prova real** — ele vai ser exercitado pela
primeira vez em produção, na primeira nota parcelada. E como a criação de contas é
isolada em `try/catch`, o erro seria engolido: a nota entraria normalmente e **o boleto
simplesmente não nasceria**. Teste com XML de várias duplicatas é obrigatório.

---

## A tela

### Dois filtros novos

```
Tipo:     [ Todas ]  [ Contas fixas ]  [ Boletos de nota ]
Situação: [ Todas ]  [ Falta vencimento (2) ]  [ Atrasadas ]  [ Vencendo ]  [ Pagas ]
```

O filtro por tipo existe porque 10 a 30 boletos por mês vão dividir a tela com 5 ou 6
contas fixas. Sem ele, a conta de luz some no meio das notas de peça.

### A conta sem vencimento

```
┌──────────────────────────────────────────────────────┐
│ ⚠️ ERCAL — calcário                  NF 82398 · 23/07 │
│ R$ 8.258,40                ❓ vencimento não informado │
│                                                        │
│ [ Informar data ]   [ Já foi paga ]   [ Sem boleto ]  │
└──────────────────────────────────────────────────────┘
```

**As três ações já existem na API desde a Fase 1** — nenhuma rota nova:

| Botão | Rota | Estado final |
|---|---|---|
| Informar data | `PATCH /contas/:id` (já aceita `vencimento`) | `aberta` com data |
| Já foi paga | `POST /contas/:id/pagar` | `paga` |
| Sem boleto | `POST /contas/:id/dispensar` | `dispensada` |

**Guarda leve na data informada** (proposta minha, não pedida — vetar se incomodar): se a
data digitada estiver no passado ou a mais de 180 dias, a tela **avisa e deixa salvar**.
Aviso, nunca bloqueio: errar o ano ao digitar é comum, e travar o Matheus fora do próprio
sistema é pior que o erro.

**Sem dinheiro contado duas vezes:** a regra `precisaCriarLancamento` da Fase 1 já devolve
`false` para conta que veio de nota fiscal — o gasto entrou no Financeiro quando a nota
chegou. Marcar o boleto como pago só carimba data e valor. **Nada a construir.**

### Ordenação

Conta sem vencimento não tem por onde ser ordenada por data. Ela sobe para o topo da lista:
é a única que exige ação do Matheus para o sistema voltar a funcionar sozinho.

---

## O aviso

### Imediato — junto com a nota

A mensagem de "NF-e processada" que já existe ganha uma linha:

```
📄 NF-e processada
👤 TRIANGULO DIESEL TRR LTDA
💰 R$ 30.600,00
💳 Boleto: R$ 30.600,00 vence 21/07 (em 7 dias)
```

Sem esta linha, um boleto que vence em 1 dia (caso METAL AGRICOLA) só apareceria na tarefa
das 07:00 do dia seguinte — o próprio dia do vencimento.

Três variações, uma para cada conclusão possível — **o sistema sempre diz o que decidiu:**

| Situação | Linha na mensagem |
|---|---|
| Boleto com data | `💳 Boleto: R$ 30.600,00 vence 21/07 (em 7 dias)` |
| Parcelado | `💳 3 boletos: 15/08, 15/09, 15/10 — R$ 3.000,00 cada` |
| Sem data no arquivo | `💳 Boleto sem data — informe em agromouro.com.br/contas` |
| Cartão / dinheiro | `💳 Sem boleto — a nota diz cartão de crédito` |

### Diário — 07:00, a tarefa que já existe

Ganha um quarto grupo e o link:

```
📋 Contas — 05/08

🔴 1 atrasada:
• Energia — venceu 02/08, R$ 890,00

🟡 2 vencendo:
• ERCAL — calcário, dia 07/08, R$ 8.258,40
• Água — dia 08/08, R$ 340,00

❓ 1 sem vencimento:
• Triângulo Diesel — R$ 30.600,00 (nota de 14/07)
👉 agromouro.com.br/contas?filtro=sem-vencimento
```

### Escalonamento da conta sem data

**Este é o único ponto cego do sistema.** Conta sem vencimento **nunca pode ficar
"atrasada"** — não há data para comparar. O boleto vence no mundo real e o sistema não
tem como saber. Por isso ele não se cala:

| Dias desde que a conta nasceu | Onde aparece |
|---|---|
| 0 a 5 | grupo `❓ sem vencimento` |
| **6 em diante** | sobe para `🔴`, junto das atrasadas, com o texto *"há N dias sem vencimento informado"* |

Custa uma linha numa mensagem que ele já recebe. Uma linha que aparece igual todo dia
vira paisagem; o tom subindo, não.

**Link com filtro, não link por conta:** com 3 notas esperando, um link por conta viraria
3 links na mesma mensagem. O filtro resolve todas de uma vez e é menos peça para quebrar.

---

## Fora de escopo (de propósito)

| O quê | Por quê |
|---|---|
| **Aprender o prazo do fornecedor** | Decidido na sabatina. O sistema poderia sugerir a data a partir do histórico daquele CNPJ ("nas 3 últimas da ERCAL, 23 dias depois"), **sugerindo sempre, nunca preenchendo sozinho**. Fica de fora porque **não tem o que aprender no dia 1**: depende de o Matheus já ter informado a data 2 ou 3 vezes. Construir agora é entregar peça que fica inútil por semanas e que ninguém vai lembrar de conferir quando acordar. **Reavaliar depois de 3–4 semanas no ar** |
| Responder por texto no WhatsApp | Ver "Alternativa descartada". Vira fase própria, se o uso provar necessidade |
| Nota de devolução | Nota de devolução emitida pelo fornecedor criaria boleto que não existe. Não observado até hoje; se aparecer, é um toque em "sem boleto". Construir detecção agora é resolver problema que não temos |
| Detector de fornecedor de nota que sumiu | Lógica diferente da conta fixa. Não mistura |
| Filtro de CNPJ do destinatário (nota fantasma) | Premissa mantida: só chega compra da fazenda nas caixas monitoradas |
| Trazer notas antigas | Impossível — o arquivo não existe mais |
| Guardar o XML inteiro | Custo de armazenamento contra o plano gratuito |
| Nota cancelada pelo fornecedor | O sistema **já hoje** não sabe que uma nota foi cancelada. Sobra um boleto fantasma, dispensado em um toque. Consertar de verdade é outro assunto |
| Regime de caixa no Financeiro | Decisão nº 2. O Financeiro e o painel não mudam |

---

## Riscos

| # | Risco | Gravidade | O que reduz |
|---|---|---|---|
| 1 | **Fornecedor não preencher o quadro de cobrança** — medido: 1 em 3 | **Alta** | O fluxo "falta vencimento". **Medir de novo depois de 3–4 semanas no ar** e decidir com número |
| 2 | **A nota de adubo de R$ 660 mil segue sem prova** | **Alta** | Nenhuma amostra ainda. Pedir uma nota de adubo assim que houver. Não impede subir: o pior caso é ele informar a data à mão |
| 3 | Código de forma de pagamento enganar e sumir um boleto de verdade | Média | **A recusa é anunciada na mensagem da nota**, no mesmo minuto. Coluna `forma_pagamento` guarda o que foi lido, para auditoria depois |
| 4 | Quebrar o processamento de NF-e | Baixa, **mas a mais grave se ocorrer** | As quatro travas da rede de proteção + teste que prova o isolamento |
| 5 | Volume afogar as contas fixas | Média | Filtro por tipo |
| 6 | Tornar `vencimento` opcional quebrar código que já roda | Média | Teste para cada consumidor da coluna antes de mexer |
| 7 | **O caminho de várias parcelas nunca foi exercitado com arquivo real** — e, se quebrar, o `try/catch` engole e o boleto some calado | **Alta** | Teste obrigatório com XML de 3 duplicatas, montado à mão. Pedir uma nota parcelada real assim que houver |
| 8 | O índice único novo falhar por já existir nota duplicada em produção | Baixa | A consulta de conferência roda **antes**, e o Matheus decide qual fica |

### Observação fora desta fase

O lançamento que a NF-e cria em `lancamentos_financeiros` **não grava `origem`**
(`nfeProcessor.ts:286-294`). Pela memória `lancamento-invisivel-sem-origem`, isso faz o
gasto ficar invisível numa tela e contado em outra. **Não é da Fase 2 e não será tocado
aqui** — registrado para virar tarefa própria.

---

## Testes

**Trava anti-duplicata (pré-requisito):**
- Duas notas de **fornecedores diferentes** com o **mesmo número** entram as duas
- A **mesma** nota do **mesmo** fornecedor entra uma vez só
- Gravar a mesma nota duas vezes em paralelo: a segunda é recusada pelo banco, não pelo código

**Leitura do arquivo (`parseXmlNFe`):**
- **XML com 3 duplicatas devolve 3 parcelas** (o caso que nenhuma amostra real cobre)
- XML com 1 duplicata devolve 1 parcela — não quebra por vir objeto em vez de lista
- Nota com 1 duplicata devolve 1 parcela, com data e valor corretos
- Nota com 3 duplicatas devolve 3 parcelas, na ordem
- Nota **sem** quadro de cobrança devolve lista vazia — não estoura
- Nota sem bloco de pagamento devolve forma vazia — não estoura
- **Os campos que já eram lidos continuam idênticos** (usar os 3 arquivos reais)

**Regra de criação (`duplicatas.ts`, puro):**
- 1 duplicata → 1 conta, `numero_parcela` 1 de 1
- 3 duplicatas → 3 contas, 1/3, 2/3, 3/3, cada uma com seu valor
- Sem duplicata → 1 conta sem vencimento, com o valor total da nota
- Forma de pagamento cartão → nenhuma conta, **e a mensagem diz que não criou e por quê**
- Parcela com `dVenc` vazio → conta sem vencimento, não conta com data inválida
- Competência sem vencimento cai no mês da emissão
- Soma das parcelas diferente do total da nota → cria mesmo assim e registra no log
  (o valor do boleto é a verdade; divergência é problema do fornecedor, não motivo de silêncio)

**Isolamento (o teste que mais importa):**
- Quando a criação de contas estoura, `processarNFe` **conclui**: estoque, itens,
  lançamento e mensagem de WhatsApp acontecem do mesmo jeito

**Duplicidade:**
- Processar a mesma nota duas vezes não cria boleto repetido
- Marcar boleto de nota como pago **não** cria lançamento financeiro novo

**Aviso:**
- Conta sem vencimento entra no grupo "sem vencimento" e em nenhum outro
- Conta sem vencimento **não** é contada como atrasada
- Conta sem vencimento com 6 dias ou mais **sobe para o grupo crítico**
- Conta sem vencimento com 5 dias **ainda não** subiu (a fronteira exata)
- Dia sem nada a dizer continua sem gravar alerta

---

## Premissas (se alguma cair, o desenho muda)

1. **A amostra de 3 notas representa o comportamento dos fornecedores.** É uma amostra
   pequena. A medição depois de 3–4 semanas é parte do trabalho, não opcional.
2. **Só chegam compras da fazenda nas duas caixas monitoradas.** Se entrar nota de venda,
   nasceria boleto fantasma.
3. **A tabela de códigos de forma de pagamento usada aqui está correta.** Confirmar no
   manual vigente da NF-e ao implementar.
4. **O gasto continua contando na data da nota.** Se um dia ele quiser ver por data de
   pagamento, isso é outro projeto e mexe em telas que já estão no ar.
