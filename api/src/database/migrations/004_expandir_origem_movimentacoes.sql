-- Migration 004 — Expandir valores válidos para movimentacoes_estoque.origem
-- Execute no SQL Editor do Supabase

ALTER TABLE movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS movimentacoes_estoque_origem_check;

ALTER TABLE movimentacoes_estoque
  ADD CONSTRAINT movimentacoes_estoque_origem_check
  CHECK (origem IN ('nfe', 'whatsapp', 'manual', 'operacao', 'correcao_unidade'));
