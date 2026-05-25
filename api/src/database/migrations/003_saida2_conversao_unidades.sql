-- Migration 003 — Saída 2: conversão de unidades comerciais + confirmações WhatsApp
-- Execute no SQL Editor do Supabase

-- 1. Novas colunas em movimentacoes_estoque (por transação, não por insumo)
ALTER TABLE movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS unidade_comercial    text,
  ADD COLUMN IF NOT EXISTS quantidade_comercial numeric(12,3),
  ADD COLUMN IF NOT EXISTS fator_conversao      numeric(10,4);

-- 2. Adicionar 'aguardando_confirmacao' ao status das NF-e
ALTER TABLE notas_fiscais
  DROP CONSTRAINT IF EXISTS notas_fiscais_status_check;

ALTER TABLE notas_fiscais
  ADD CONSTRAINT notas_fiscais_status_check
  CHECK (status IN ('recebida', 'processando', 'processada', 'erro', 'aguardando_confirmacao'));

-- 3. Tabela de confirmações pendentes (buffer WhatsApp para conversão de unidades)
CREATE TABLE IF NOT EXISTS confirmacoes_pendentes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo           text        NOT NULL DEFAULT 'fator_conversao',
  telefone       text        NOT NULL,
  ordem          integer     NOT NULL DEFAULT 0,
  payload        jsonb       NOT NULL,
  fator_sugerido numeric(10,4),
  enviado        boolean     DEFAULT false,
  enviar_apos    timestamptz NOT NULL DEFAULT now() + interval '60 seconds',
  respondido     boolean     DEFAULT false,
  fator_usado    numeric(10,4),
  created_at     timestamptz DEFAULT now(),
  expires_at     timestamptz DEFAULT now() + interval '24 hours'
);

-- Index para o job de consolidação (busca periódica de itens não enviados)
CREATE INDEX IF NOT EXISTS idx_conf_pendentes_job
  ON confirmacoes_pendentes (telefone, enviado, enviar_apos)
  WHERE enviado = false;

-- Index para o interceptor WhatsApp (busca rápida de pendências do remetente)
CREATE INDEX IF NOT EXISTS idx_conf_pendentes_wpp
  ON confirmacoes_pendentes (telefone, enviado, respondido)
  WHERE enviado = true AND respondido = false;
