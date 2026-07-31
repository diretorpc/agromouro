-- ============================================================
-- AgroMouro — Contas a Pagar, Fase 1
-- Executar no Supabase SQL Editor: colar o arquivo INTEIRO e clicar em Run.
-- Spec: docs/superpowers/specs/2026-07-29-contas-a-pagar-design.md
--
-- O QUE ESTE ARQUIVO TOCA:
--   • Seções 1 a 4 só CRIAM coisa nova (duas tabelas, quatro índices,
--     permissões). Não encostam em nenhum dado que já existe no banco.
--   • A Seção 5 ALTERA a tabela lancamentos_financeiros — a que guarda o
--     HISTÓRICO FINANCEIRO real da fazenda, com dados de verdade. Ela troca
--     só a restrição de quais valores a coluna "origem" aceita. Nenhuma
--     linha existente é apagada, criada ou modificada por essa seção.
--
-- É SEGURO colar este arquivo inteiro quantas vezes for preciso — na segunda,
-- terceira vez, etc. nada quebra e nada se perde. Cada comando foi desenhado
-- para isso (ver comentários de cada seção).
--
-- ANTES DE RODAR, ANOTE este número à parte (não precisa fazer nada com ele
-- agora — é só para conferir depois):
--
--   SELECT count(*) FROM lancamentos_financeiros;
--
-- A conferência automática no fim deste arquivo mostra esse mesmo número de
-- novo, na última linha. Se os dois números não baterem, PARE e avise — teria
-- sumido histórico financeiro, o que este arquivo nunca deveria fazer.
-- ============================================================

-- 1. A REGRA que se repete ("Cemig, todo dia 10")
CREATE TABLE IF NOT EXISTS contas_recorrentes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao          TEXT NOT NULL,
  fornecedor         TEXT NOT NULL,
  categoria          TEXT NOT NULL,
  periodicidade      TEXT NOT NULL
                     CHECK (periodicidade IN ('mensal','bimestral','trimestral','semestral','anual')),
  dia_vencimento     SMALLINT NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  mes_primeira       SMALLINT CHECK (mes_primeira BETWEEN 1 AND 12),
  valor_referencia   NUMERIC(12,2),
  avisar_dias_antes  SMALLINT NOT NULL DEFAULT 3 CHECK (avisar_dias_antes BETWEEN 0 AND 30),
  ativa              BOOLEAN NOT NULL DEFAULT true,
  fazenda_id         UUID NOT NULL REFERENCES fazendas(id),
  created_at         TIMESTAMPTZ DEFAULT now(),
  -- quando não é mensal, mes_primeira é obrigatório
  CONSTRAINT mes_primeira_obrigatorio
    CHECK (periodicidade = 'mensal' OR mes_primeira IS NOT NULL)
);

-- 2. A OCORRÊNCIA concreta ("Cemig, julho/2026")
CREATE TABLE IF NOT EXISTS contas_a_pagar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorrente_id   UUID REFERENCES contas_recorrentes(id) ON DELETE SET NULL,
  competencia     DATE NOT NULL,
  descricao       TEXT NOT NULL,
  fornecedor      TEXT,
  categoria       TEXT,
  vencimento      DATE NOT NULL,
  valor           NUMERIC(12,2),
  valor_estimado  BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'aguardando'
                  CHECK (status IN ('aguardando','aberta','paga','dispensada')),
  data_pagamento  DATE,
  valor_pago      NUMERIC(12,2),
  lancamento_id   UUID REFERENCES lancamentos_financeiros(id) ON DELETE SET NULL,
  nota_fiscal_id  UUID REFERENCES notas_fiscais(id) ON DELETE SET NULL,
  observacao      TEXT,
  fazenda_id      UUID NOT NULL REFERENCES fazendas(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 3. Idempotência da tarefa diária: uma ocorrência por regra por competência.
--    É ESTE índice que impede a tarefa de duplicar conta ao rodar todo dia.
--
--    SEM cláusula WHERE, de propósito. Um índice único PARCIAL não serve de
--    árbitro para o ON CONFLICT que o upsert do supabase-js gera: o banco
--    recusa com erro 42P10 e NADA é gravado, em silêncio. Este projeto já
--    passou por isso nas cotações — ver o cabeçalho de
--    api/src/database/migrations/011_cotacoes_commodities.sql.
--
--    Tirar o WHERE não custa nada: o Postgres já trata cada NULL como distinto
--    de todos os outros num índice único, então conta avulsa (recorrente_id
--    nulo) continua sem colidir com outra conta avulsa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conta_recorrente_competencia
  ON contas_a_pagar (recorrente_id, competencia);

CREATE INDEX IF NOT EXISTS idx_contas_faz_venc   ON contas_a_pagar (fazenda_id, vencimento);
CREATE INDEX IF NOT EXISTS idx_contas_faz_status ON contas_a_pagar (fazenda_id, status);
CREATE INDEX IF NOT EXISTS idx_recorrentes_faz   ON contas_recorrentes (fazenda_id, ativa);

-- 4. Permissões — FOR ALL cobre ler, inserir, alterar e apagar.
--    Só de SELECT faria a escrita do site falhar em silêncio.
ALTER TABLE contas_recorrentes ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY não tem "IF NOT EXISTS" no Postgres: colar este arquivo uma
-- segunda vez pararia aqui com erro 42710 e desfaria o arquivo inteiro (o
-- Editor SQL do Supabase roda o que foi colado como uma única transação).
-- O DROP abaixo garante que colar de novo é seguro.
DROP POLICY IF EXISTS "contas_recorrentes_tenant" ON contas_recorrentes;
CREATE POLICY "contas_recorrentes_tenant" ON contas_recorrentes
  FOR ALL
  USING      (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());

ALTER TABLE contas_a_pagar ENABLE ROW LEVEL SECURITY;
-- Mesmo motivo do DROP acima: torna seguro colar o arquivo mais de uma vez.
DROP POLICY IF EXISTS "contas_a_pagar_tenant" ON contas_a_pagar;
CREATE POLICY "contas_a_pagar_tenant" ON contas_a_pagar
  FOR ALL
  USING      (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());

-- 5. Nova origem 'conta' para os lançamentos criados pelo módulo de contas a pagar.
--    Sem isso o lançamento nasce com origem nula e a tela Financeiro, que filtra
--    por origem, nunca o mostra — enquanto o Dashboard, que não filtra, o conta.
--
--    O nome da restrição atual é DESCOBERTO em pg_constraint, não chutado no
--    código: o Postgres gera esse nome sozinho quando a restrição é criada
--    sem CONSTRAINT nomeado, e ele pode variar entre bancos.
--
--    Derrubar a restrição antiga e criar a nova são UM SÓ comando ALTER TABLE
--    (DROP e ADD na mesma instrução, separados por vírgula) — de propósito.
--    Um ALTER TABLE inteiro é sempre atômico no Postgres: ou passa tudo, ou
--    não passa nada, independente de como o SQL Editor do Supabase agrupa os
--    comandos colados. Antes, derrubar e recriar eram DOIS comandos separados
--    (um bloco DO que só derrubava, e um ALTER TABLE que só recriava depois).
--    Nesse desenho antigo, colar SÓ o bloco DO — por engano, ou copiando um
--    trecho isolado — derrubava a trava, devolvia "Success" e não repunha
--    nada: a tabela financeira ficava PERMANENTEMENTE sem restrição, em
--    silêncio, e ninguém era avisado. Com o comando único esse recorte
--    perigoso deixou de existir: o bloco não tem mais um "meio" que funcione
--    sozinho, então colar só um pedaço dele continua seguro.
--
--    origem IS NULL continua aceito de propósito: as NF-e antigas nunca
--    preencheram esse campo, e a restrição não pode barrar o histórico delas.
--
--    string_agg junta TODAS as restrições de origem encontradas (não só a
--    primeira) numa lista só de "DROP CONSTRAINT", para o caso de existir
--    mais de uma (patch manual, backup restaurado) — nenhuma fica pra trás.
DO $$
DECLARE derrubar text;
BEGIN
  SELECT string_agg(format('DROP CONSTRAINT %I', conname), ', ')
    INTO derrubar
    FROM pg_constraint
   WHERE conrelid = 'lancamentos_financeiros'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%origem%';

  EXECUTE 'ALTER TABLE lancamentos_financeiros '
       || COALESCE(derrubar || ', ', '')
       || 'ADD CONSTRAINT lancamentos_financeiros_origem_check '
       || 'CHECK (origem IS NULL OR origem IN (''nfe'',''cartao'',''manual'',''conta''))';
END $$;

-- ── Conferência automática ───────────────────────────────────────────────────
-- Roda junto com o arquivo, sem precisar copiar nada à parte. As seis linhas
-- abaixo precisam bater com a coluna "esperado". Uma linha que não bate
-- significa PARAR, não seguir.
--
-- A MAIS CRÍTICA é a quinta ("Financeiro passou a aceitar conta paga"): se ela
-- vier 0, TODO pagamento de conta vai falhar — e isso só se descobre na hora
-- de pagar uma conta de verdade, quando o agricultor vir a mensagem de erro.
SELECT 'tabelas novas criadas' AS o_que, count(*)::text AS resultado, '2' AS esperado
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('contas_recorrentes','contas_a_pagar')
UNION ALL
SELECT 'permissao de ESCRITA (nao so leitura)', count(*)::text, '2'
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('contas_recorrentes','contas_a_pagar')
   AND cmd = 'ALL'
UNION ALL
SELECT 'protecao por fazenda ligada', count(*)::text, '2'
  FROM pg_class
 WHERE relnamespace = 'public'::regnamespace
   AND relname IN ('contas_recorrentes','contas_a_pagar')
   AND relrowsecurity
UNION ALL
SELECT 'trava que impede conta duplicada', count(*)::text, '1'
  FROM pg_indexes
 WHERE indexname = 'idx_conta_recorrente_competencia'
UNION ALL
SELECT 'Financeiro passou a aceitar conta paga', count(*)::text, '1'
  FROM pg_constraint
 WHERE conrelid = 'lancamentos_financeiros'::regclass
   AND conname  = 'lancamentos_financeiros_origem_check'
   AND pg_get_constraintdef(oid) LIKE '%conta%'
UNION ALL
SELECT 'lancamentos financeiros (seu historico)', count(*)::text, 'o MESMO numero de antes'
  FROM lancamentos_financeiros;
