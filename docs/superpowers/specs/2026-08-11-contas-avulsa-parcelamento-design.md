# Design: Parcelamento em "Nova conta avulsa"

**Data:** 2026-08-11
**Status:** Aprovado pelo Matheus
**Escopo:** só "Nova conta avulsa" — "Nova conta fixa" (recorrente) não é tocada.

---

## Contexto

Pedido do Matheus:

> "no botão nova conta avulsa, coloca uma opção de criar PARCELAS. Eu tenho uma conta
> aqui que tem 3 parcelas, então em vez de criar 1 de cada vez, coloca uma opção de
> inserir parcelas"

Hoje, uma compra parcelada (ex.: um trator financiado em 4x) exige abrir o formulário
"Nova conta avulsa" 4 vezes, uma por parcela — trocando só o vencimento a cada vez.
Tedioso e sujeito a erro de digitação repetida (categoria/fornecedor diferentes por
descuido entre uma parcela e outra).

## Decisões (resolvidas em conversa antes deste documento)

1. **Valor**: o campo Valor continua sendo o valor de **cada** parcela — não o total
   dividido. "4 parcelas de R$ 4.000" cria 4 contas de R$ 4.000 cada (R$ 16.000 no
   total). Confirmado explicitamente pelo Matheus, rejeitando a opção de dividir um
   valor total.
2. **Vencimento**: só a data da 1ª parcela é digitada. As seguintes caem um mês depois,
   no mesmo dia — reaproveitando a mesma regra de calendário que "Nova conta fixa" já
   usa (`vencimentoDoMes`/`somarMeses`, em `api/src/services/contas/datas.ts`): dia que
   não existe no mês cai no último dia do mês.
3. **Identificação na lista**: a descrição de cada parcela ganha o sufixo automático
   `(N/total)` — ex. "Trator John Deere" vira "Trator John Deere (1/4)", "(2/4)" etc.
4. **Sem agrupamento visual**: as N parcelas aparecem como **linhas separadas** na lista
   de Contas a Pagar — não colapsadas numa linha expansível (esse recurso existe hoje só
   para boletos de uma mesma nota fiscal). Confirmado explicitamente pelo Matheus.

## Desenho

### Formulário (`web/app/(app)/contas/formulario-conta-avulsa.tsx`)

- Nova caixinha "Parcelar esta conta" (checkbox), abaixo dos campos existentes.
- Ao marcar, aparece um campo **"Quantidade de parcelas"** (número inteiro, mínimo 2,
  máximo 60 — cobre qualquer financiamento razoável sem abrir a porta pra um número
  absurdo digitado por engano).
- Os campos existentes (Descrição, Fornecedor, Categoria, Vencimento, Valor) continuam
  os mesmos — sem duplicar UI por parcela. O rótulo do campo Vencimento passa a dizer
  "Vencimento da 1ª parcela" quando a caixinha está marcada.
- Texto do botão Salvar muda pra refletir a ação: "Salvar 4 parcelas" em vez de
  "Salvar", quando parcelado.

### Backend (`api/src/routes/contas.ts`, rota `POST /contas`)

- `avulsaSchema` ganha um campo opcional `parcelas: z.number().int().min(2).max(60).optional()`.
- Sem `parcelas` no corpo: comportamento **idêntico ao de hoje** (cria 1 conta, resposta
  `.single()`) — mudança é aditiva, não quebra nada que já funciona.
- Com `parcelas` presente: a rota gera as N linhas em memória (descrição sufixada,
  vencimento calculado por `vencimentoDoMes(somarMeses(...))`, competência recalculada
  por linha a partir do vencimento de cada uma — mesma fórmula que já existe hoje:
  `vencimento.slice(0, 7) + '-01'`) e insere **todas de uma vez**, num único
  `.insert([...])`. Um insert múltiplo do Postgres é atômico: ou as N nascem juntas, ou
  nenhuma nasce — não existe estado "3 de 4 parcelas criadas" por falha de rede no meio
  do caminho.
- Resposta: array com as N contas criadas (o front só usa isso pra decidir se recarrega
  a lista, então o formato não quebra nada existente).

### Frontend — chamada à API

- `formulario-conta-avulsa.tsx` manda `parcelas: quantidadeParcelas` no corpo do POST
  só quando a caixinha está marcada — senão omite o campo (undefined), preservando o
  comportamento de hoje pra quem não usa a funcionalidade nova.

## Casos de borda

- **Quantidade de parcelas vazia ou menor que 2 com a caixinha marcada**: botão Salvar
  fica desabilitado (mesmo padrão dos outros campos obrigatórios do formulário — ver
  `podeSalvar` em `formulario-conta-avulsa.tsx`).
- **Dia de vencimento que não existe em algum mês da sequência** (ex.: 1ª parcela dia 31
  de janeiro → 2ª parcela cairia em "31 de fevereiro"): cai no último dia daquele mês
  (28 ou 29). Mesma regra já usada em "Nova conta fixa", nada novo sendo inventado.
- **Uma das N contas falhar a inserção** (ex.: erro de rede no meio): como é um único
  `.insert([...])` atômico, ou todas entram, ou nenhuma entra — sem parcela órfã.

## Fora de escopo (de propósito, YAGNI)

- Agrupamento visual das parcelas numa linha expansível na lista — decisão explícita do
  Matheus de não fazer agora.
- "Nova conta fixa" (recorrente) não ganha parcelamento — só a avulsa, como pedido.
- Editar/excluir "todas as parcelas de uma vez" depois de criadas — cada parcela vira
  uma conta comum, editável/excluível uma a uma, do jeito que qualquer conta avulsa já é
  hoje. Não há vínculo gravado entre elas no banco (nenhuma coluna nova tipo
  `grupo_parcela_id`) — se isso vier a fazer falta, é extensão futura, não faz parte
  deste pedido.
- Valor diferente por parcela (ex.: entrada maior, parcelas menores) — fora de escopo
  por decisão do Matheus (valor único, repetido).

## Testes

- Unitário: gerar N linhas a partir de `{descricao, fornecedor, categoria, vencimento,
  valor, parcelas}` — confere sufixo `(i/N)`, vencimento mês a mês, e o caso de borda de
  dia 29/30/31 caindo no último dia do mês seguinte quando ele não existe.
- Rota: `POST /contas` sem `parcelas` continua criando 1 conta (regressão); com
  `parcelas` entre 2 e 60, cria N contas numa única resposta; `parcelas: 0`, `1`,
  negativo ou maior que 60 é rejeitado pelo Zod (400) — o formulário nunca manda menos
  de 2 (checkbox só libera o campo com mínimo 2), então esse erro só apareceria por
  chamada direta à API, não pelo uso normal da tela.
