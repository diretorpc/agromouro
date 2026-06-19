-- Migration 013 — Centro de custo por item de NF-e + policy de UPDATE
-- Execute no SQL Editor do Supabase
--
-- Contexto: itens não-estocáveis (peça, frete, serviço) entram com insumo_id null,
-- então o centro de custo não tinha onde ser gravado (era derivado de insumos.tipo).
-- Esta coluna torna o centro de custo editável por lançamento, independente do estoque.
--
-- Texto livre de propósito: o dropdown do frontend mistura categorias agrícolas
-- (insumos.tipo) com categorias de cartão (manutencao, alimentacao, etc.). Um
-- check constraint aqui recriaria o bug de "não salva em silêncio".

alter table itens_nfe
  add column if not exists centro_custo text;

-- itens_nfe só tinha policy de SELECT — escrita do frontend morria em silêncio (0 linhas).
-- Adiciona UPDATE para usuários autenticados (o backend usa SERVICE_KEY e bypassa RLS).
create policy "Usuários autenticados podem atualizar itens_nfe" on itens_nfe
  for update using (auth.role() = 'authenticated');
