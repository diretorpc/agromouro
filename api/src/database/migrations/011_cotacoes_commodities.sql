-- Migration 011 — Versionar a tabela de cotações de commodities (CBOT)
-- Execute no SQL Editor do Supabase
--
-- A tabela cotacoes_commodities foi criada manualmente no dashboard e nunca
-- ficou versionada. Faltava o índice ÚNICO em (commodity, data), exigido pelo
-- upsert do job (onConflict: 'commodity,data') — sem ele todo upsert falhava
-- com erro 42P10 e nada era gravado (tabela sempre vazia).
--
-- Como a tabela nunca funcionou e não tem dados, drop+recreate é seguro e
-- garante que produção fique idêntica a este schema versionado.
-- RLS permanece desabilitada (cotações são dados públicos; o job grava via
-- service_role e o frontend só lê) — mesmo comportamento de antes.

DROP TABLE IF EXISTS cotacoes_commodities;

CREATE TABLE cotacoes_commodities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity   text NOT NULL,
  preco_rs    numeric,
  preco_usd   numeric,
  data        date NOT NULL,
  fonte       text DEFAULT 'cepea',
  created_at  timestamptz DEFAULT now(),
  UNIQUE (commodity, data)        -- conserta o upsert do job de cotações
);
