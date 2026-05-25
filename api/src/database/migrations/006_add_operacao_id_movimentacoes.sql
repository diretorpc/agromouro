-- Migration 006 — Adicionar operacao_id em movimentacoes_estoque
-- Execute no SQL Editor do Supabase

ALTER TABLE movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS operacao_id uuid REFERENCES operacoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movimentacoes_operacao_id
  ON movimentacoes_estoque(operacao_id)
  WHERE operacao_id IS NOT NULL;
