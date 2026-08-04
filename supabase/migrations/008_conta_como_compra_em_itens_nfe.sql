-- ============================================================
-- AgroMouro — marcar em cada item da NF-e se ele conta como gasto
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Plano: docs/superpowers/plans/2026-08-03-nfe-cfop-entrega-futura.md
-- ============================================================
--
-- POR QUE: a tela Financeiro soma TODO item de itens_nfe, sem olhar o CFOP
-- (código de operação) que a migration 007 passou a gravar. Uma compra de
-- 400 t de cloreto de potássio (KCl) apareceu duas vezes na tela — na nota
-- de faturamento (a venda) e de novo em cada nota de entrega — porque a
-- tela não sabia distinguir as duas. R$ 1.060.000 de gasto fantasma.
--
-- NULO SIGNIFICA "CONTA". Toda nota já gravada antes desta coluna existir
-- fica com conta_como_compra = NULL, e NULL precisa continuar contando
-- exatamente como conta hoje — é o histórico inteiro do dono. Se NULL
-- virasse "não conta", a tela apagaria de uma vez todo gasto já lançado.
-- Só um FALSE explícito, escrito pelo processador da NF-e a partir de
-- 04/08/2026 em diante, tira um item da soma.
--
ALTER TABLE itens_nfe ADD COLUMN IF NOT EXISTS conta_como_compra BOOLEAN;

-- VERIFICAÇÃO — precisa devolver 1 linha.
SELECT 'coluna conta_como_compra criada' AS conferencia, column_name
  FROM information_schema.columns
 WHERE table_name = 'itens_nfe' AND column_name = 'conta_como_compra';
