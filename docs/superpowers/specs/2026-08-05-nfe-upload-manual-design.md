# Design: fechar a porta cega do upload manual de XML

**Data:** 2026-08-05
**Status:** Aprovado pelo Matheus, pronto para virar plano de execução

---

## Objetivo

A tela de NF-e tem um jeito de subir uma nota fiscal fora do e-mail automático: upload
de arquivo XML, ou digitar os dados à mão. Os dois caminhos são **incompletos** hoje —
um não lê o CFOP (o código que diz se a nota é compra ou só entrega), o outro nem grava
o gasto. Este design fecha os dois buracos e conserta um terceiro que apareceu durante
a investigação: apagar uma nota importada não desfaz o que ela criou.

**O que este design NÃO faz:** não muda o caminho automático (e-mail → Make/job interno
→ processador), que já está certo desde o PR #45. Não dá suporte a nota de serviço
(NFS-e) — ver `ESTADO.md`, seção própria, decidido ficar no backlog.

---

## O que mudou no entendimento durante o brainstorming

1. **A porta manual pode envenenar o caminho automático.** `nfeJaProcessada`
   (`api/src/services/nfeProcessor.ts:152`) só confere se a nota **existe** em
   `notas_fiscais` — não se foi processada. Subir pela tela cria essa linha; quando a
   nota real chega depois por e-mail, o sistema acha que já foi feita e ignora **para
   sempre**. O botão "Reprocessar" não resolve (só muda o status, ninguém lê).
   Achado que reverteu a ideia inicial de **apagar** a porta manual — apagar exigiria
   provar que encaminhar e-mail funciona como substituto, e esse teste ficou para depois.
   **Consertar resolve os dois problemas de uma vez**, sem depender dessa prova: a nota
   só nasce em `notas_fiscais` **depois** de processada por completo.

2. **O modo "Manual" (digitar à mão) tem o mesmo problema, de um jeito pior.** Ele grava
   a nota com **zero itens** — o gasto simplesmente não aparece no Financeiro (que soma
   `itens_nfe`). Nenhum aviso, nenhum erro. Descoberto ao revisar o código, não por uso
   real ainda.

3. **"Excluir nota" nunca desfez o que a nota criou.** Enquanto a tela não mexia em
   estoque nem em boleto, isso era só desarrumado. Depois deste conserto, a tela passa a
   mexer nos dois — e excluir sem desfazer vira uma nota fantasma no estoque.

---

## Evidência medida (não suposta)

Consulta em produção, notas presas em `status = 'recebida'` há mais de 2 dias — **1
resultado**, de 02/06/2026:

| Campo | Valor |
|---|---|
| Emitente | CHEGOU STORE COMERCIO E DISTRIBUICAO LTDA |
| Descrição | Kit 4 Cartuchos Hp 950xl 951xl Original |
| Valor | R$ 1.199,00 |
| `cfop` | `null` (assinatura da porta manual) |
| Entrou em estoque | Não — correto, não é insumo agrícola |
| Virou lançamento | Não verificado por essa via, mas `conta_como_compra = null` já conta
  como gasto no Financeiro (a tela trata `null` como "sim, é gasto") |
| Virou boleto | Não |

**Conclusão:** a porta manual foi usada pelo menos uma vez em 2 meses, para algo que não
é insumo agrícola (papelaria). O estrago real foi pequeno — nenhum dinheiro contado a
mais ou a menos — mas confirma que a porta está em uso e o buraco é real, não teórico.
Essa nota específica **não será tocada**: sem risco ativo, mexer nela agora seria
mexer às cegas.

---

## Decisões fechadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Apagar a porta ou consertar? | **Consertar.** Resolve CFOP + envenenamento de uma vez, sem depender do teste de encaminhamento (adiado) |
| 2 | Upload de XML: prévia antes de importar, ou um clique só? | **Um clique só.** Processa direto e mostra o resultado depois. Simplifica, e o "Excluir" consertado (decisão 4) é a rede de segurança se der errado |
| 3 | Modo "Manual" (digitar à mão): remover, ou consertar no lugar? | **Consertar no lugar.** Continua exatamente como está na tela; ao salvar, também cria o item do gasto — sem redirecionar para outra tela |
| 4 | "Excluir nota": precisa desfazer estoque e boleto? | **Sim, dentro do próprio botão.** Sem tela de histórico, sem "desfazer" separado — excluir já devolve a mercadoria e apaga o boleto |
| 5 | Nota antiga da CHEGOU STORE (a única vítima encontrada) | **Não mexe.** Sem estrago ativo, correção às cegas é mais risco que benefício |
| 6 | Autorização da rota nova no servidor | **Mesmo padrão das outras rotas autenticadas** (`requireAuth` confere login; a fazenda vem do corpo do pedido). Não inventa verificação de posse de fazenda que não existe em nenhuma rota hoje — isso seria escopo novo, fora deste conserto |

---

## Design técnico

### 1. Upload de XML → nova rota no servidor

`POST /nfe/importar-xml`, autenticada (`requireAuth`), no arquivo novo
`api/src/routes/nfe.ts`.

Reaproveita as três peças já testadas do caminho automático, na mesma ordem que
`nfeEmailWebhook.ts` usa:

1. `parseXmlNFe(xml)` — lê o arquivo
2. `nfeJaProcessada(numero, cnpj, fazenda_id)` — confere se já existe
3. `processarNFe(nfe, 'manual', fazenda_id)` — CFOP, estoque, financeiro, boleto, WhatsApp

**Uma mudança pequena no processador:** o tipo de `origem` em `processarNFe`
(`api/src/services/nfeProcessor.ts:280`) ganha o valor `'manual'`, ao lado de
`'webhook' | 'email'` — só para a mensagem do WhatsApp dizer de onde a nota veio.
Nenhuma outra linha do processador muda.

O navegador **perde** a função `parseNFeXML` (~35 linhas) e a gravação direta em
`itens_nfe`. Continua fazendo upload do arquivo (arrastar ou clicar), só que agora
manda o conteúdo do XML para a rota nova via `api.post()` (`lib/api.ts`) em vez de ler
localmente.

**Respostas que a tela entende**, cada uma com mensagem própria:
- criada com sucesso (mostra nº de itens, valor, quantos entraram em estoque)
- nota já existe (mostra data em que entrou e link para ela)
- arquivo não é uma NF-e válida
- erro no processamento

### 2. Modo "Manual" — cria também o item do gasto

Em `handleSaveNF` (`web/app/(app)/nfe/page.tsx`), branch `addMode === 'manual'`: depois
de gravar a nota, insere **um** item em `itens_nfe`:

```
descricao:        manualForm.emitente_nome
quantidade:        1
unidade:           'un'
valor_unitario:     valor total digitado
valor_total:        valor total digitado
cfop:               null
conta_como_compra:  true   // explícito — não depende do default null
insumo_id:          null
nota_fiscal_id:      id da nota recém-criada
```

Não mexe em estoque (sem CFOP, sem produto identificado — não tem base para decidir).
Não cria boleto automaticamente (o formulário manual não captura quadro de cobrança) —
se a nota tiver vencimento futuro, o vencimento entra à parte, pela tela de Contas a
Pagar, que já existe para isso.

### 3. "Excluir nota" — desfaz o que criou

Nova rota `DELETE /nfe/:id`, autenticada, no mesmo arquivo `api/src/routes/nfe.ts`.
Substitui a lógica atual do navegador (que só apaga `itens_nfe` e `notas_fiscais`).

Ordem das operações, para respeitar as referências entre tabelas:

1. Busca `movimentacoes_estoque` com esse `nota_fiscal_id`
2. Para cada uma, **reverte o efeito no estoque**: subtrai de
   `estoque.quantidade_atual` a quantidade que aquela movimentação tinha somado
3. Apaga essas linhas de `movimentacoes_estoque`
4. Apaga `contas_a_pagar` com esse `nota_fiscal_id` (o boleto)
5. Apaga `itens_nfe` com esse `nota_fiscal_id`
6. Apaga a linha de `notas_fiscais`

Se qualquer passo falhar, **para e avisa** — nunca segue apagando o resto e finge que
deu certo (mesmo princípio já usado em `cfop.ts`: falhar ruidosamente é sempre melhor
que silencioso).

⚠️ **Risco aceito, não resolvido:** se parte do produto da nota já foi **usada** (saída
de estoque por uma operação) antes de perceber o erro e excluir, devolver a quantidade
pode deixar `quantidade_atual` estranho (inclusive negativo). É raro, o número errado
aparece na hora na tela, e corrigir nesse caso é ajuste manual — não dá para desfazer
uma aplicação que já aconteceu no campo.

---

## Fora de escopo

- **Notas antigas já importadas com CFOP vazio** (inclusive a da CHEGOU STORE) — ficam
  como estão.
- **Nota de serviço (NFS-e)** — backlog separado, ver `ESTADO.md`.
- **Teste de encaminhamento de e-mail** — adiado; não bloqueia este conserto porque a
  decisão passou a ser "consertar", não "apagar".
- **Verificação de posse de fazenda na rota nova** — seguindo o padrão (ausente) das
  demais rotas autenticadas. Não é regressão; é o mesmo nível de proteção que
  `/estoque`, `/talhoes` etc. já têm hoje.

---

## Arquivos afetados

- `api/src/routes/nfe.ts` — **novo**: `POST /nfe/importar-xml`, `DELETE /nfe/:id`
- `api/src/index.ts` — registrar `app.use('/nfe', requireAuth, nfeRoutes)`
- `api/src/services/nfeProcessor.ts` — `origem` ganha `'manual'`
- `web/app/(app)/nfe/page.tsx` — remove `parseNFeXML` e a gravação direta; upload e
  exclusão passam a chamar a API; modo Manual cria o item do gasto
- `web/lib/types.ts` — se precisar de tipo novo para a resposta da rota de importação
