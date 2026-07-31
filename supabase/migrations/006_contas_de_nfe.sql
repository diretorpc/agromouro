-- ============================================================
-- AgroMouro — Contas a Pagar, Fase 2 (boletos vindos da NF-e)
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Rodar DEPOIS de 005_nfe_duplicidade.sql.
-- Spec: docs/superpowers/specs/2026-07-31-contas-a-pagar-fase2-design.md
-- ============================================================

-- 1. Conta pode nascer sem data de vencimento (caso ERCAL: fornecedor não informou).
--    "Falta vencimento" NÃO vira status: é derivado da coluna vazia, do mesmo jeito
--    que "atrasada" já é derivada. Guardar como estado criaria uma segunda verdade
--    que precisaria ser mantida em dia.
ALTER TABLE contas_a_pagar ALTER COLUMN vencimento DROP NOT NULL;

-- 2. Qual parcela desta nota é esta conta ("2 de 3").
ALTER TABLE contas_a_pagar
  ADD COLUMN IF NOT EXISTS numero_parcela SMALLINT,
  ADD COLUMN IF NOT EXISTS total_parcelas SMALLINT;

-- 3. Trava de duplicidade: uma conta por nota por parcela.
--    SEM cláusula WHERE, de propósito — índice único PARCIAL não serve de árbitro
--    para o ON CONFLICT do upsert: o banco recusa com 42P10 e nada é gravado, em
--    silêncio. Já aconteceu neste projeto nas cotações (ver o cabeçalho de
--    api/src/database/migrations/011_cotacoes_commodities.sql).
--    NULL é distinto de NULL num índice único, então conta fixa (nota_fiscal_id
--    vazio) continua sem colidir com outra conta fixa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conta_nota_parcela
  ON contas_a_pagar (nota_fiscal_id, numero_parcela);

-- 4. Qual forma de pagamento o sistema LEU na nota. Serve para descobrir por que
--    uma nota não gerou boleto, em vez de adivinhar.
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
