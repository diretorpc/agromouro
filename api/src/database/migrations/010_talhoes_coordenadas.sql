-- Migration 010 — Adicionar coluna de coordenadas geográficas nos talhões
-- Execute no SQL Editor do Supabase
--
-- Armazena o polígono do talhão como array de [lat, lng] em JSONB,
-- importado via arquivo KMZ (Google Earth).

ALTER TABLE talhoes ADD COLUMN IF NOT EXISTS coordenadas JSONB;
