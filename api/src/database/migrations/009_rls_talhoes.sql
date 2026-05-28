-- Migration 009 — Políticas de escrita RLS para talhoes
-- Execute no SQL Editor do Supabase

CREATE POLICY "Usuários autenticados podem inserir talhões" ON talhoes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem atualizar talhões" ON talhoes
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem excluir talhões" ON talhoes
  FOR DELETE USING (auth.role() = 'authenticated');
