-- ============================================================
-- AgroMouro — guardar o CFOP de cada item da NF-e
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Plano: docs/superpowers/plans/2026-08-03-nfe-cfop-entrega-futura.md
-- ============================================================
--
-- POR QUE: até 03/08/2026 o sistema lia o código de operação e jogava fora.
-- Sem ele gravado, não há como descobrir DEPOIS por que uma nota somou (ou não
-- somou) estoque. Mesma lição da coluna forma_pagamento.
--
ALTER TABLE itens_nfe ADD COLUMN IF NOT EXISTS cfop TEXT;

-- VERIFICAÇÃO — precisa devolver 1 linha.
SELECT 'coluna cfop criada' AS conferencia, column_name
  FROM information_schema.columns
 WHERE table_name = 'itens_nfe' AND column_name = 'cfop';
