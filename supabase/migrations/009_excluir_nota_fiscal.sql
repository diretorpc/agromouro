-- ============================================================
-- AgroMouro — excluir_nota_fiscal: exclusão atômica de NF-e
-- Executar no Supabase SQL Editor. Apenas uma vez.
--
-- MOTIVO: revisão do Apolo (05/08/2026) na feature de upload manual de XML
-- achou que apagar a nota em vários passos separados, do lado do Node, tinha
-- três problemas:
--   1. lancamentos_financeiros não era apagado — a chave é ON DELETE SET
--      NULL, então o gasto ficava no Dashboard para sempre, sem dono.
--   2. sem transação: uma falha no meio (ex.: rede caindo) podia deixar o
--      estoque já devolvido mas a movimentação ainda no banco — numa
--      segunda tentativa, o mesmo estoque era devolvido de novo.
--   3. apagava boleto já pago sem checar nada, perdendo o único rastro de
--      que aquele dinheiro tinha saído (pagamento de conta vinda de NF-e
--      não cria lançamento próprio — ver api/src/services/contas/pagamento.ts).
-- Uma função no Postgres resolve os três de uma vez: ou tudo acontece, ou
-- nada acontece — não existe "meio caminho" gravado no banco.
-- ============================================================

CREATE OR REPLACE FUNCTION excluir_nota_fiscal(p_nota_id UUID, p_fazenda_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_mov    RECORD;
BEGIN
  -- Trava 1: a nota existe e é desta fazenda? Sem isto, um pedido com o
  -- fazenda_id errado (bug no cliente, ou pior) apagaria nota de outra
  -- fazenda — a chave de serviço do Supabase não tem RLS para barrar isso.
  SELECT status INTO v_status
    FROM notas_fiscais
   WHERE id = p_nota_id AND fazenda_id = p_fazenda_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'nota_nao_encontrada';
  END IF;

  -- Trava 2: nota sendo processada NESTE exato momento pelo caminho do
  -- e-mail (corrida já provada neste sistema — ver memória
  -- nfe-corrida-duas-portas). Excluir agora deixaria movimentação órfã,
  -- porque movimentacoes_estoque não tem chave estrangeira para a nota.
  IF v_status = 'processando' THEN
    RAISE EXCEPTION 'nota_em_processamento';
  END IF;

  -- Trava 3: boleto já pago não pode sumir sem deixar rastro.
  IF EXISTS (
    SELECT 1 FROM contas_a_pagar
     WHERE nota_fiscal_id = p_nota_id AND status = 'paga'
  ) THEN
    RAISE EXCEPTION 'boleto_ja_pago';
  END IF;

  -- Devolve o estoque de cada movimentação desta nota. Sinal invertido:
  -- entrada devolve negativo, saída devolve positivo (defensivo — não
  -- deveria existir movimentação de saída vinda de NF-e).
  FOR v_mov IN
    SELECT insumo_id, tipo, quantidade
      FROM movimentacoes_estoque
     WHERE nota_fiscal_id = p_nota_id
  LOOP
    UPDATE estoque
       SET quantidade_atual = quantidade_atual
             + CASE WHEN v_mov.tipo = 'entrada' THEN -v_mov.quantidade ELSE v_mov.quantidade END,
           updated_at = now()
     WHERE insumo_id = v_mov.insumo_id;
  END LOOP;

  DELETE FROM movimentacoes_estoque   WHERE nota_fiscal_id = p_nota_id;
  DELETE FROM contas_a_pagar          WHERE nota_fiscal_id = p_nota_id;
  DELETE FROM lancamentos_financeiros WHERE nota_fiscal_id = p_nota_id;
  DELETE FROM itens_nfe               WHERE nota_fiscal_id = p_nota_id;
  DELETE FROM notas_fiscais           WHERE id = p_nota_id;
END;
$$;

-- ACHADO 2 (segunda revisão do Apolo, 05/08/2026): por padrão o Postgres
-- concede EXECUTE a PUBLIC, e o Supabase ainda concede a `anon` e
-- `authenticated`. Como a função é SECURITY DEFINER (ignora o RLS de
-- propósito, para poder mexer em estoque/boleto/lançamento independente de
-- quem chama), sem esta trava qualquer requisição com a CHAVE PÚBLICA do
-- site — que fica exposta no navegador, por desenho — conseguiria apagar
-- nota, estoque, boleto e lançamento de QUALQUER fazenda, sem passar pela
-- API. Só o `service_role` (o que a API usa) pode executar.
REVOKE ALL ON FUNCTION excluir_nota_fiscal(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION excluir_nota_fiscal(UUID, UUID) TO service_role;

-- ============================================================
-- VERIFICAÇÃO — rodar depois de criar a função acima.
-- ============================================================
-- Resultado esperado: 1 linha, confirmando que a função existe, é
-- SECURITY DEFINER (precisa ser, para poder mexer em estoque e boletos
-- mesmo quando chamada pela chave de serviço da API) e NÃO é executável
-- por anon/authenticated (só service_role).
SELECT
  p.proname,
  p.prosecdef AS eh_security_definer,
  NOT has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_esta_bloqueado,
  NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_esta_bloqueado,
  has_function_privilege('service_role', p.oid, 'EXECUTE')      AS service_role_pode_executar
FROM pg_proc p
WHERE p.proname = 'excluir_nota_fiscal';
