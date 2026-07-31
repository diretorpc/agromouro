-- ============================================================
-- AgroMouro — Contas a Pagar, Fase 2 (boletos vindos da NF-e)
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Rodar DEPOIS de 005_nfe_duplicidade.sql.
-- Spec: docs/superpowers/specs/2026-07-31-contas-a-pagar-fase2-design.md
-- ============================================================

-- 1. Conta pode nascer sem data de vencimento (caso ERCAL: fornecedor não informou).
--    "Falta vencimento" NÃO vira status: é derivado da coluna vazia, do mesmo jeito
--    que "atrasada" já é derivada. Guardar como estado criaria uma segunda verdade
--    que precisaria ser mantida em dia.
ALTER TABLE contas_a_pagar ALTER COLUMN vencimento DROP NOT NULL;

-- 2. Qual parcela desta nota é esta conta ("2 de 3").
ALTER TABLE contas_a_pagar
  ADD COLUMN IF NOT EXISTS numero_parcela SMALLINT,
  ADD COLUMN IF NOT EXISTS total_parcelas SMALLINT;

-- 3. Trava de duplicidade: uma conta por nota por parcela.
--    SEM cláusula WHERE, de propósito — índice único PARCIAL não serve de árbitro
--    para o ON CONFLICT do upsert: o banco recusa com 42P10 e nada é gravado, em
--    silêncio. Já aconteceu neste projeto nas cotações (ver o cabeçalho de
--    api/src/database/migrations/011_cotacoes_commodities.sql).
--    NULL é distinto de NULL num índice único, então conta fixa (nota_fiscal_id
--    vazio) continua sem colidir com outra conta fixa.
--
--    PASSO 3A — PRÉ-CHECAGEM (executar ANTES do índice).
--    Se esta consulta devolver QUALQUER linha, PARE: já existe conta duplicada
--    em produção e o índice abaixo vai falhar. Hoje o resultado esperado é
--    nenhuma linha: as contas atuais têm nota_fiscal_id e numero_parcela nulos,
--    e nulo não colide com nulo em índice único.
SELECT nota_fiscal_id, numero_parcela, count(*) AS repetidas
FROM contas_a_pagar
GROUP BY nota_fiscal_id, numero_parcela
HAVING count(*) > 1 AND (nota_fiscal_id IS NOT NULL OR numero_parcela IS NOT NULL);

--    PASSO 3B — a tranca de verdade.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conta_nota_parcela
  ON contas_a_pagar (nota_fiscal_id, numero_parcela);

-- 4. Qual forma de pagamento o sistema LEU na nota. Serve para descobrir por que
--    uma nota não gerou boleto, em vez de adivinhar.
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;

-- ============================================================
-- VERIFICAÇÃO FINAL — Confirmar que as alterações subiram correto
-- ============================================================
--
-- Executar estas consultas APÓS rodar a migração acima. Todas precisam devolver
-- o esperado. Se alguma devolver zero linhas (exceto no caso (e)), reporte
-- o resultado ao Matheus — quer dizer que algo não foi criado certo.
--
-- Resultado esperado para cada query:
-- (a) 1 linha com is_nullable = 'YES'
-- (b) 2 linhas (numero_parcela, total_parcelas)
-- (c) 1 linha confirmando que idx_conta_nota_parcela é único e sem WHERE
-- (d) 1 linha (forma_pagamento)
-- (e) Qualquer número ≥ 0 (guardar este número para comparar depois do deploy)
--
SELECT 'vencimento passou a aceitar nulo', is_nullable
  FROM information_schema.columns
 WHERE table_name = 'contas_a_pagar' AND column_name = 'vencimento'
UNION ALL
SELECT 'colunas de parcela', column_name
  FROM information_schema.columns
 WHERE table_name = 'contas_a_pagar' AND column_name IN ('numero_parcela', 'total_parcelas')
UNION ALL
SELECT 'trava que impede conta duplicada (único e sem WHERE)', 'OK'
  FROM pg_index
 WHERE indexrelid = to_regclass('public.idx_conta_nota_parcela')
   AND indisunique
   AND indpred IS NULL
UNION ALL
SELECT 'forma_pagamento criada', column_name
  FROM information_schema.columns
 WHERE table_name = 'notas_fiscais' AND column_name = 'forma_pagamento'
UNION ALL
SELECT 'contas_a_pagar (seu historico)', count(*)::text
  FROM contas_a_pagar;
