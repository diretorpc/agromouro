-- ============================================================
-- AgroMouro — trava anti-duplicata de NF-e (pré-requisito da Fase 2)
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Spec: docs/superpowers/specs/2026-07-31-contas-a-pagar-fase2-design.md
-- ============================================================

-- PASSO 1 — CONFERIR ANTES DE CRIAR O ÍNDICE.
-- Se esta consulta devolver QUALQUER linha, PARE: já existe nota duplicada
-- em produção e o índice abaixo vai falhar. Levar o resultado ao Matheus
-- para ele decidir qual linha fica.
SELECT numero, emitente_cnpj, fazenda_id, count(*) AS repetidas
FROM notas_fiscais
GROUP BY numero, emitente_cnpj, fazenda_id
HAVING count(*) > 1;

-- PASSO 2 — a tranca de verdade.
-- Sem cláusula WHERE, de propósito (ver Global Constraints).
-- O número da NF-e é sequencial POR EMITENTE: sem o CNPJ na chave, a nota
-- 4516 da Triângulo Diesel bloqueia a nota 4516 de qualquer outro fornecedor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfe_numero_emitente_fazenda
  ON notas_fiscais (numero, emitente_cnpj, fazenda_id);

-- PASSO 3 — conferência. Precisa devolver 1 linha.
SELECT indexname FROM pg_indexes
WHERE indexname = 'idx_nfe_numero_emitente_fazenda';
