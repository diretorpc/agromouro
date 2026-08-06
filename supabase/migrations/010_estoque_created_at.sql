-- ============================================================
-- AgroMouro — estoque.created_at: data de entrada de cada produto
-- Executar no Supabase SQL Editor. Apenas uma vez.
-- Plano: docs/superpowers/plans/2026-08-05-reorganizacao-estoque.md
-- ============================================================
--
-- POR QUE: a tela de Estoque precisa ordenar produtos por "mais recente
-- primeiro" (o que entrou por último). A tabela `estoque` só tinha
-- `updated_at`, que muda a cada ajuste — não serve pra saber quando o
-- produto entrou. `movimentacoes_estoque` já tem `created_at`, e como a
-- linha em `estoque` é criada uma única vez (na primeira entrada do
-- produto, nunca recriada depois — ver nfeProcessor.ts e o cadastro manual
-- em estoque/page.tsx), a data da primeira movimentação de "entrada" é a
-- data de entrada real do produto no estoque.
--
BEGIN;

ALTER TABLE estoque ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE estoque e
SET created_at = primeira_entrada.data
FROM (
  SELECT insumo_id, MIN(created_at) AS data
  FROM movimentacoes_estoque
  WHERE tipo = 'entrada'
  GROUP BY insumo_id
) AS primeira_entrada
WHERE e.insumo_id = primeira_entrada.insumo_id;

COMMIT;

-- Produtos sem nenhuma movimentação de "entrada" registrada (raro — só
-- existem por ajuste manual direto) ficam com o valor padrão (o momento em
-- que esta migration rodou) e aparecem por último na ordenação "mais
-- recentes primeiro". Não precisam de tratamento especial na aplicação.

-- VERIFICAÇÃO — rode as duas consultas SEPARADAMENTE — o SQL Editor só
-- mostra o resultado da última quando coladas juntas.
SELECT i.nome, e.created_at
FROM estoque e JOIN insumos i ON i.id = e.insumo_id
ORDER BY e.created_at ASC
LIMIT 5;

SELECT
  count(*) FILTER (WHERE created_at::date = current_date) AS sem_entrada_registrada,
  count(*) AS total_produtos
FROM estoque;
