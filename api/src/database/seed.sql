-- ============================================================
-- AgroMouro — Dados iniciais reais
-- Execute no SQL Editor do Supabase APÓS o schema.sql
-- ============================================================

-- ─── FAZENDA ──────────────────────────────────────────────
insert into fazenda (nome, hectares, municipio, estado, lat, lng)
values (
  'Fazenda Boa Esperança da Palestina',
  1657.62,
  'Uberaba',
  'MG',
  -19.468066,
  -47.917383
);

-- ─── TALHÕES ──────────────────────────────────────────────
-- Áreas calculadas dos polígonos KMZ (Google Earth Pro)
insert into talhoes (nome, area_ha, cultura_atual, status) values
  ('19',          105.92, 'sorgo', 'ativo'),
  ('Pinos',       196.40, 'sorgo', 'ativo'),
  ('Mata Burro',  111.33, 'milho', 'ativo'),
  ('Lagoa',       111.90, 'sorgo', 'ativo'),
  ('Dida',        128.77, 'cana',  'ativo'),
  ('Santana',     175.95, 'milho', 'ativo'),
  ('Alvorada I',  187.38, 'aveia', 'ativo'),
  ('Alvorada II', 140.98, 'aveia', 'ativo'),
  ('Cravinhos',   184.98, 'milho', 'ativo'),
  ('Gogo I',      136.56, 'aveia', 'ativo'),
  ('Gogo II',     101.07, 'aveia', 'ativo'),
  ('Gogo III',     76.38, 'milho', 'ativo');
