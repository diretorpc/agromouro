-- Migration 007 — Política de DELETE para insumos
-- Execute no SQL Editor do Supabase

CREATE POLICY "Usuários autenticados podem excluir insumos" ON insumos
  FOR DELETE USING (auth.role() = 'authenticated');
