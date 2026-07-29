# Design: Contas a Pagar

**Data:** 2026-07-29
**Status:** Aguardando aprovação
**Abordagem escolhida:** A — "agenda" separada do "diário", em duas fases
**Fase 1 (este spec):** contas fixas recorrentes, cadastradas à mão
**Fase 2 (esboçada, não detalhada):** contas nascendo das notas fiscais

---

## Contexto

Desde 28/07/2026 o Matheus responde pelo pagamento das contas da unidade de Uberaba
inteira da Agromoura. A Agromoura **não tem ERP nenhum** (nem TOTVS, nem similar) — o
único sistema é o AgroMouro.

O pedido, nas palavras dele:

> "Não quero automatizar nada, quero facilitar os registros para analisar mais
> facilmente depois. Organização primeiro."

E a dor nº 1, também nas palavras dele:

> "O problema principal são as contas que os fornecedores esquecem de enviar por e-mail."

O `lancamentos_financeiros` de hoje é um **diário**: registra o que já aconteceu. Falta a
**agenda**: o que ainda vai vencer. Não existe vencimento, status de pago, fornecedor nem
recorrência em lugar nenhum do sistema.

---

## O que a grelha (grill-me) mudou no desenho

Três achados inverteram prioridades. Ficam registrados porque explicam por que o módulo
tem a forma que tem:

1. **A dor nº 1 é conta fixa, não nota fiscal.** Existe uma contradição que só apareceu
   quando perguntamos pelo caso real: as contas que o sistema *consegue* ver chegar
   sozinho (notas fiscais por e-mail) são compras eventuais, não mensais. As contas que
   são *de verdade* mensais (luz, água, internet, imposto) são justamente as que o
   sistema **não vê chegar** — chegam em papel. Toda a engenharia de "detectar o
   silêncio do fornecedor pela nota fiscal" não ajuda no caso que dói. Por isso o módulo
   foi cortado em duas fases, e a Fase 1 é a que resolve a dor.

2. **O vencimento das notas antigas está perdido, e não dá para recuperar.** A coluna
   `notas_fiscais.xml_raw` existe (`api/src/database/schema.sql:92`), mas **nenhum código
   grava nela** — o insert em `api/src/services/nfeProcessor.ts:191-200` não a inclui. O
   leitor do arquivo (`nfeProcessor.ts:53-102`) também não abre o bloco `<cobr>`, que é
   onde a nota fiscal traz os boletos com data de vencimento. O arquivo é lido e
   descartado. Decisão: **não passar a guardar o arquivo inteiro** (ocuparia 100–200 MB
   por ano contra os 500 MB do plano gratuito do Supabase); na Fase 2, extrair só
   vencimento e parcelas.

3. **Periodicidade não é só mensal.** ITR é anual, seguro costuma ser anual. Se a
   recorrência nascesse como "todo mês", a conta anual não caberia — e o conserto depois
   seria migração com dado real em produção. O campo entra agora: custa um campo hoje,
   custaria uma migração depois.

---

## Decisões fechadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Onde o módulo vive | **Dentro do AgroMouro** — página nova + tabelas novas. App separado criaria digitação dupla |
| 2 | Qual fazenda é Uberaba | **A fazenda de código `mg`**, que já existe. Nada novo a cadastrar |
| 3 | Tipos de conta | Contas fixas, impostos/obrigações e folha. **Sem** financiamento de banco |
| 4 | Nota fantasma (filtro de CNPJ) | **Não construir agora.** Premissa assumida: só chegam compras da unidade nas caixas monitoradas |
| 5 | Folha de pagamento | **Uma linha por mês** ("Folha julho/2026"). Não vira controle por funcionário |
| 6 | Conta do mês antes de chegar | **Criada sozinha**, com valor estimado **marcado e somado à parte** do confirmado |
| 7 | Periodicidade | **Entra agora**: mensal, bimestral, trimestral, semestral, anual |
| 8 | Anexar boleto/PDF | **Não na Fase 1.** Só os números |
| 9 | Quem usa | **Só o Matheus.** Sem coluna de autor, sem usuário novo |
| 10 | O que analisar depois | As quatro: vence em 30 dias, atrasado, gasto por categoria, gasto por fornecedor |
| 11 | Avisos | **Os dois**: silêncio (não chegou) e vencimento (vence em X dias) |

---

## Por que NÃO usar a tabela `lancamentos_financeiros` que já existe

Foi a alternativa mais barata em peças, e está **descartada por risco medido**:

- O Dashboard lê a tabela inteira (`web/app/(app)/dashboard/page.tsx:64`).
- O Financeiro trata cada linha como despesa realizada
  (`web/app/(app)/financeiro/page.tsx:33`).

Colocar conta futura não paga ali **infla o gasto do mês com dinheiro que ainda não
saiu**, sem erro e sem aviso. É a mesma família de defeito silencioso que já mordeu este
projeto duas vezes (RLS sem policy de escrita; Z-API desconectada).

A "agenda" fica separada do "diário". Elas se encontram num ponto só: quando uma conta é
marcada como paga.

---

## Modelo de dados — Fase 1

Duas tabelas, porque são duas coisas diferentes: a **regra** que se repete e a
**ocorrência** concreta de um mês.

### `contas_recorrentes` — a regra ("Cemig, todo dia 10")

```sql
CREATE TABLE contas_recorrentes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao          TEXT NOT NULL,                 -- "Energia elétrica"
  fornecedor         TEXT NOT NULL,                 -- "Cemig"
  categoria          TEXT NOT NULL,                 -- mesmo vocabulário do centro de custo
  periodicidade      TEXT NOT NULL
                     CHECK (periodicidade IN ('mensal','bimestral','trimestral','semestral','anual')),
  dia_vencimento     SMALLINT NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  mes_primeira       SMALLINT CHECK (mes_primeira BETWEEN 1 AND 12),  -- só quando não é mensal
  valor_referencia   NUMERIC(12,2),                 -- semente da primeira ocorrência
  avisar_dias_antes  SMALLINT NOT NULL DEFAULT 3,
  ativa              BOOLEAN NOT NULL DEFAULT true,
  fazenda_id         UUID NOT NULL REFERENCES fazendas(id),
  created_at         TIMESTAMPTZ DEFAULT now()
);
```

**Dia que não existe no mês:** `dia_vencimento = 31` em fevereiro cai no **último dia do
mês**. Regra explícita para não gerar data inválida.

**Quando não é mensal:** `mes_primeira` diz em que mês cai a **primeira** ocorrência; as
seguintes são contadas a partir dela pelo intervalo da periodicidade. Ex.: semestral com
`mes_primeira = 3` cai em março e setembro. Para `mensal`, o campo fica vazio.

**Nomes que NÃO podem ser confundidos** (a primeira versão deste spec os tinha iguais, e
isso viraria bug): `contas_recorrentes.valor_referencia` é um **valor em reais** (a
semente); `contas_a_pagar.valor_estimado` é um **sim/não** que marca se o valor daquela
conta ainda é chute.

### `contas_a_pagar` — a ocorrência ("Cemig, julho/2026")

```sql
CREATE TABLE contas_a_pagar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorrente_id   UUID REFERENCES contas_recorrentes(id) ON DELETE SET NULL,
  competencia     DATE NOT NULL,                    -- 1º dia do mês de referência
  descricao       TEXT NOT NULL,
  fornecedor      TEXT,
  categoria       TEXT,
  vencimento      DATE NOT NULL,
  valor           NUMERIC(12,2),
  valor_estimado  BOOLEAN NOT NULL DEFAULT false,   -- true = chute, ainda não confirmado
  status          TEXT NOT NULL DEFAULT 'aguardando'
                  CHECK (status IN ('aguardando','aberta','paga','dispensada')),
  data_pagamento  DATE,
  valor_pago      NUMERIC(12,2),
  lancamento_id   UUID REFERENCES lancamentos_financeiros(id) ON DELETE SET NULL,
  nota_fiscal_id  UUID REFERENCES notas_fiscais(id) ON DELETE SET NULL,   -- só Fase 2
  observacao      TEXT,
  fazenda_id      UUID NOT NULL REFERENCES fazendas(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Garante que a tarefa diária nunca crie a mesma conta duas vezes
CREATE UNIQUE INDEX idx_conta_recorrente_competencia
  ON contas_a_pagar (recorrente_id, competencia)
  WHERE recorrente_id IS NOT NULL;

CREATE INDEX idx_contas_faz_venc ON contas_a_pagar (fazenda_id, vencimento);
CREATE INDEX idx_contas_faz_status ON contas_a_pagar (fazenda_id, status);
```

**Os quatro estados, em português comum:**

| Status | Significa |
|---|---|
| `aguardando` | O sistema criou a linha; a conta de verdade ainda não chegou. O valor é estimativa |
| `aberta` | A conta chegou, o valor é real, ainda não foi paga |
| `paga` | Paga. Tem data e valor pago |
| `dispensada` | Este mês não teve (serviço cancelado, cobrança não veio). Sai da conta sem sumir do histórico |

**"Atrasada" não é um status** — é derivado da data (`vencimento < hoje` e status não é
`paga` nem `dispensada`). Guardar isso como estado criaria uma segunda verdade que
precisaria ser mantida em dia.

### Permissões (RLS)

Ambas as tabelas seguem o padrão já usado em `cartoes`
(`supabase/migrations/002_cartoes.sql:36-39`):

```sql
ALTER TABLE contas_recorrentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contas_recorrentes_tenant" ON contas_recorrentes
  FOR ALL
  USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
-- idem para contas_a_pagar
```

`FOR ALL` cobre ler, inserir, alterar e apagar. **Isso não é detalhe:** tabela com
permissão só de leitura faz o botão "marcar como paga" falhar em silêncio — o usuário
clica, não dá erro, e nada salva. Já aconteceu neste projeto com `itens_nfe` em junho.

---

## A tarefa automática

Roda **todo dia às 07:00** (fuso de São Paulo), no mesmo trilho de
`api/src/jobs/index.ts`, logo depois de clima (06:00) e cotações (06:30).

**Por que todo dia e não no dia 1º:** uma tarefa mensal que caísse justamente num
reinício do servidor **perderia o mês inteiro em silêncio**. Rodando diariamente e sendo
idempotente (o índice único impede duplicata), ela se conserta sozinha no dia seguinte.

Três passos:

1. **Criar o que falta.** Para cada regra ativa, calcula quais ocorrências deveriam
   existir nos próximos 45 dias e cria as que faltam, com status `aguardando` e valor =
   último `valor_pago` da mesma regra (ou o `valor_referencia` do cadastro, na primeira
   vez), marcando `valor_estimado = true`.
2. **Montar o resumo do dia**, aplicando três regras de aviso:
   - `aguardando` e faltando ≤ `avisar_dias_antes` para o vencimento → *"ainda não chegou"*
   - `aberta` e faltando ≤ `avisar_dias_antes` → *"vence em X dias"*
   - vencimento já passou e não está paga nem dispensada → *"atrasada"*
3. **Gravar UM alerta agrupado** em `alertas` (tipo `contas_resumo`). Se não houver nada
   a dizer, não grava nada — silêncio é resposta válida.

Exemplo da mensagem:

> 📋 *Contas — 29/07*
> 🔴 1 atrasada: Água (venceu 25/07, R$ 340)
> 🟡 2 vencem esta semana: Energia dia 10 (R$ 890), Internet dia 12 (R$ 249)
> ⏳ 1 ainda não chegou: Telefone (esperada dia 08)

**Uma mensagem por dia, agrupada** — nunca uma por conta. Mensagem demais vira ruído, e
ruído faz você parar de ler o aviso que importa.

**O WhatsApp é o extra, não o caminho único.** O alerta sempre é gravado no banco e
aparece na tela. Se a instância Z-API estiver desconectada, o envio falha calado
(`api/src/services/zapi.ts` só faz `console.error`) — mas a informação não se perde.

---

## A tela `/contas`

**Topo — três números:**

| Cartão | Mostra |
|---|---|
| Vence esta semana | Valor **confirmado** e **estimado** somados **em separado**: *"R$ 12.400 confirmados + R$ 3.100 estimados"* |
| Atrasado | Total e quantidade do que passou do vencimento |
| Aguardando | Quantas contas o sistema espera e ainda não chegaram |

Nunca somar estimativa com valor real num número só. Um número que mistura chute com
fato mente sem avisar.

**Lista:** ordenada por vencimento, com filtro Todas / Aguardando / Abertas / Atrasadas /
Pagas. Cada linha mostra fornecedor, descrição, vencimento, valor (com etiqueta
*estimado* quando for o caso), categoria.

**Ações por linha:** registrar valor real (passa de `aguardando` para `aberta`), marcar
como paga, dispensar o mês, editar, apagar.

**Seção "Contas fixas":** gerencia as regras — cadastrar, editar, desativar.

**Cadastro de conta avulsa:** formulário curto para o que não se repete.

---

## A regra do "pago" — evita dinheiro contado duas vezes

Ao marcar uma conta como paga, o sistema pergunta a data e o valor realmente pago (que
pode diferir do previsto, por juros ou desconto). Depois:

- **Conta sem nota fiscal** (todas as da Fase 1): **cria** um lançamento em
  `lancamentos_financeiros` (tipo despesa, data = data do pagamento, valor = valor pago,
  categoria escolhida) e guarda o id em `lancamento_id`. Sem isso, a conta de luz nunca
  apareceria no gasto.
- **Conta vinda de nota fiscal** (Fase 2): o lançamento **já existe** desde que a nota
  entrou. Marcar como paga só carimba data e valor. Não cria nada.
- **Desfazer um pagamento:** apaga o lançamento que foi criado (por isso o `lancamento_id`
  é guardado) e volta a conta para `aberta`.

Sem essa regra, ou a luz nunca entra no gasto, ou a nota fiscal entra duas vezes.

---

## O que a Fase 1 NÃO faz

Deliberadamente de fora, para o módulo nascer pequeno:

- Pagamento parcial de uma conta
- Anexar boleto, PDF ou foto
- Qualquer integração com banco ou baixa automática
- Previsão de saldo em caixa
- Controle de folha por funcionário
- Filtro de CNPJ do destinatário da nota
- Registro de quem cadastrou ou quem pagou
- Qualquer alteração no leitor de NF-e, no `nfeProcessor.ts` ou no fluxo do Make.com

**A Fase 1 não altera uma linha do que já roda.** Ela só adiciona: duas tabelas, uma
tarefa diária, uma página e uma rota. O único ponto de contato com o que existe é criar
um lançamento financeiro quando uma conta é paga — inserção, nunca alteração.

---

## Fase 2 — esboço (não é escopo deste spec)

Só depois de a Fase 1 rodar por algumas semanas e provar que serve:

- Ensinar o leitor de NF-e a abrir o bloco `<cobr>` do arquivo, onde ficam os boletos com
  vencimento e valor. Nota com 3 parcelas vira 3 contas ligadas à mesma nota.
- Nota sem bloco de cobrança (venda à vista) nasce com etiqueta *"falta vencimento"*.
- Detector de silêncio por fornecedor de nota fiscal, comparando por **CNPJ do emitente**
  (nunca pelo texto do nome, que muda).
- Reavaliar o filtro de CNPJ do destinatário, se aparecer nota que não é compra da unidade.

---

## Premissas assumidas (se alguma cair, o desenho muda)

1. **Uberaba é a fazenda `mg`.** Se for outra unidade, as contas nascem no lugar errado.
2. **Só chegam compras da unidade nas caixas de e-mail monitoradas.** Se entrar nota de
   venda ou de outra empresa, a Fase 2 criaria conta a pagar fantasma. Conserto: o filtro
   de CNPJ do destinatário, documentado e não construído.
3. **Só o Matheus usa.** Se o Ivan ou alguém do escritório passar a lançar, falta saber
   quem fez cada coisa — uma coluna a mais, barata de adicionar depois.
4. **O histórico não migra.** O módulo começa limpo, valendo das contas cadastradas em
   diante. O gasto passado continua visível no Financeiro de sempre.

---

## Testes

**Tarefa diária:**
- Cria a ocorrência do mês para uma regra mensal ativa
- Rodar duas vezes no mesmo dia **não** duplica (índice único)
- Regra anual só gera ocorrência no mês da primeira (`mes_primeira`)
- Regra semestral com `mes_primeira = 3` gera em março e setembro, e em mais nenhum mês
- Segunda ocorrência herda o `valor_pago` da anterior, não o `valor_referencia` do cadastro
- `dia_vencimento = 31` em fevereiro cai no último dia do mês
- Regra inativa não gera nada

**Avisos:**
- Conta `aguardando` perto do vencimento entra no resumo como "não chegou"
- Conta `aberta` perto do vencimento entra como "vence em X dias"
- Conta vencida e não paga entra como "atrasada"
- Conta `paga` e conta `dispensada` não entram em aviso nenhum
- Dia sem nada a dizer não grava alerta

**Regra do pago:**
- Marcar conta sem nota como paga **cria** um lançamento financeiro
- Desfazer o pagamento **apaga** o lançamento criado
- Marcar conta com nota fiscal (Fase 2) **não** cria lançamento

**Permissões:**
- Usuário da fazenda `mg` não enxerga conta de outra fazenda
- Marcar como paga persiste de verdade (não falha em silêncio)

---

## Referências no código

- Padrão de RLS multi-fazenda: `supabase/migrations/002_cartoes.sql:34-39`
- Tarefas agendadas: `api/src/jobs/index.ts`
- Envio de alerta por WhatsApp: `api/src/services/zapi.ts`
- Tabela de alertas: `api/src/database/schema.sql:123`
- Onde `lancamentos_financeiros` é lido: `web/app/(app)/dashboard/page.tsx:64`,
  `web/app/(app)/financeiro/page.tsx:33`
- Spec anterior no mesmo padrão: `docs/superpowers/specs/2026-06-03-cartoes-credito-design.md`
