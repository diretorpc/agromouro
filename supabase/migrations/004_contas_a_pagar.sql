-- ============================================================
-- AgroMouro — Contas a Pagar, Fase 1
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Spec: docs/superpowers/specs/2026-07-29-contas-a-pagar-design.md
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
CREATE POLICY "contas_recorrentes_tenant" ON contas_recorrentes
  FOR ALL
  USING      (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());

ALTER TABLE contas_a_pagar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contas_a_pagar_tenant" ON contas_a_pagar
  FOR ALL
  USING      (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
