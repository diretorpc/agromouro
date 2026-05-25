-- Migration 005 — Adicionar políticas de escrita RLS para o frontend
-- Execute no SQL Editor do Supabase
--
-- Contexto: o backend (Railway) usa SERVICE_KEY que bypassa RLS.
-- O frontend (Vercel) usa o JWT do usuário autenticado e precisa
-- de policies explícitas para INSERT/UPDATE.

-- movimentacoes_estoque: frontend precisa inserir saídas de operações e correções
CREATE POLICY "Usuários autenticados podem inserir movimentações" ON movimentacoes_estoque
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- estoque: frontend precisa atualizar saldo (ajuste manual, operações, converter unidade)
CREATE POLICY "Usuários autenticados podem atualizar estoque" ON estoque
  FOR UPDATE USING (auth.role() = 'authenticated');

-- insumos: frontend precisa inserir novos insumos e atualizar unidade (converter)
CREATE POLICY "Usuários autenticados podem inserir insumos" ON insumos
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem atualizar insumos" ON insumos
  FOR UPDATE USING (auth.role() = 'authenticated');
