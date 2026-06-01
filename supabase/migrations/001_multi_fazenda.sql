-- ============================================================
-- AgroMouro — Multi-Fazenda Migration
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- EDITAR os UPDATE/INSERT com os dados reais das fazendas antes de rodar.
-- ============================================================

-- 1. Renomear fazenda → fazendas
ALTER TABLE fazenda RENAME TO fazendas;

-- 2. Adicionar campos de configuração por fazenda
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS codigo     TEXT UNIQUE;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS nfe_email  TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS zapi_instance TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS zapi_phone    TEXT;

-- 3. Marcar fazenda existente como MG (EDITAR estado/nome com dados reais)
UPDATE fazendas
SET codigo = 'mg', estado = 'MG'
WHERE id = (SELECT id FROM fazendas LIMIT 1);

-- 4. Inserir SP e MT (EDITAR nome, municipio, hectares, lat, lng com dados reais)
INSERT INTO fazendas (nome, codigo, estado, hectares, municipio)
VALUES
  ('Fazenda SP', 'sp', 'SP', 0, 'A preencher'),
  ('Fazenda MT', 'mt', 'MT', 0, 'A preencher')
ON CONFLICT (codigo) DO NOTHING;

-- 5. Adicionar fazenda_id em todas as tabelas (backfill com o id da MG)
DO $$
DECLARE
  mg_id UUID;
  t     TEXT;
BEGIN
  SELECT id INTO mg_id FROM fazendas WHERE codigo = 'mg';

  FOREACH t IN ARRAY ARRAY[
    'talhoes','safras','operacoes','insumos','estoque',
    'movimentacoes_estoque','notas_fiscais','itens_nfe',
    'lancamentos_financeiros','alertas'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS fazenda_id UUID REFERENCES fazendas(id)', t
    );
    EXECUTE format('UPDATE %I SET fazenda_id = $1 WHERE fazenda_id IS NULL', t) USING mg_id;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN fazenda_id SET NOT NULL', t);
  END LOOP;
END $$;

-- 6. Índices de performance (um por tabela)
CREATE INDEX IF NOT EXISTS idx_talhoes_faz           ON talhoes(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_safras_faz            ON safras(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_operacoes_faz         ON operacoes(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_insumos_faz           ON insumos(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_estoque_faz           ON estoque(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_movest_faz            ON movimentacoes_estoque(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_nfe_faz               ON notas_fiscais(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_itens_nfe_faz         ON itens_nfe(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_faz       ON lancamentos_financeiros(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_alertas_faz           ON alertas(fazenda_id);

-- 7. Função helper para extrair fazenda ativa do JWT
-- Usada pelas RLS policies. Fallback = fazenda mais antiga (MG).
CREATE OR REPLACE FUNCTION get_fazenda_ativa_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'fazenda_ativa_id')::uuid,
    (SELECT id FROM fazendas ORDER BY created_at LIMIT 1)
  );
$$;

-- 8. Dropar TODAS as policies existentes nas tabelas afetadas e recriar
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE tablename IN (
      'talhoes','safras','operacoes','insumos','estoque',
      'movimentacoes_estoque','notas_fiscais','itens_nfe',
      'lancamentos_financeiros','alertas','fazendas','fazenda'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- fazendas: leitura por qualquer usuário autenticado (switcher precisa listar todas)
CREATE POLICY "fazendas_read" ON fazendas
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Todas as outras tabelas: filtro por fazenda ativa do JWT
CREATE POLICY "talhoes_tenant"       ON talhoes              FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "safras_tenant"        ON safras               FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "operacoes_tenant"     ON operacoes            FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "insumos_tenant"       ON insumos              FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "estoque_tenant"       ON estoque              FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "movest_tenant"        ON movimentacoes_estoque FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "notas_fiscais_tenant" ON notas_fiscais        FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "itens_nfe_tenant"     ON itens_nfe            FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "lancamentos_tenant"   ON lancamentos_financeiros FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
CREATE POLICY "alertas_tenant"       ON alertas              FOR ALL USING (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id()) WITH CHECK (auth.uid() IS NOT NULL AND fazenda_id = get_fazenda_ativa_id());
