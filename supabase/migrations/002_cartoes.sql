-- ============================================================
-- AgroMouro — Cartões de Crédito
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- ============================================================

-- 1. Criar tabela cartoes
CREATE TABLE IF NOT EXISTS cartoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apelido          TEXT NOT NULL,
  ultimos_digitos  CHAR(4),
  banco            TEXT DEFAULT 'Banco do Brasil',
  responsavel      TEXT,
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id),
  ativo            BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- 2. Adicionar colunas em lancamentos_financeiros
ALTER TABLE lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS cartao_id   UUID REFERENCES cartoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem      TEXT CHECK (origem IN ('nfe', 'cartao', 'manual')),
  ADD COLUMN IF NOT EXISTS dedup_hash  TEXT;

-- 3. Índice de unicidade para deduplicação de importações
CREATE UNIQUE INDEX IF NOT EXISTS idx_lancamentos_dedup
  ON lancamentos_financeiros (cartao_id, dedup_hash)
  WHERE dedup_hash IS NOT NULL;

-- 4. Índices de performance
CREATE INDEX IF NOT EXISTS idx_cartoes_fazenda ON cartoes(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_cartao ON lancamentos_financeiros(cartao_id);

-- 5. RLS para cartoes
ALTER TABLE cartoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cartoes_tenant" ON cartoes
  FOR ALL
  USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id())
  WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
