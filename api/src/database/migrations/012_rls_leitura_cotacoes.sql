-- Migration 012 — Policy de leitura RLS para cotacoes_commodities
-- Execute no SQL Editor do Supabase
--
-- Contexto: o backend (Railway) grava as cotações via SERVICE_KEY, que bypassa
-- RLS. O frontend (Vercel) lê com o JWT do usuário autenticado e precisa de uma
-- policy explícita de SELECT. A tabela recriada na migration 011 ficou com RLS
-- ativa e SEM policy de leitura → o frontend recebia vazio (card CBOT em branco
-- apesar dos dados estarem gravados).
--
-- Cotações não são sensíveis, mas mantemos o padrão do projeto: leitura liberada
-- para usuários autenticados (mesma convenção das demais tabelas).

ALTER TABLE cotacoes_commodities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados podem ler cotações" ON cotacoes_commodities
  FOR SELECT USING (auth.role() = 'authenticated');
