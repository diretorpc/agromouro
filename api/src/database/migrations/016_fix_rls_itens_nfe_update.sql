-- Migration 016 — Corrige brecha de isolamento por fazenda no UPDATE de itens_nfe
-- APLICAR MANUALMENTE NO SQL EDITOR DO SUPABASE — não aplicado automaticamente.
--
-- Contexto: a migração 013 (centro de custo) criou a política
--   create policy "Usuários autenticados podem atualizar itens_nfe" on itens_nfe
--     for update using (auth.role() = 'authenticated');
-- sem checar fazenda_id. Essa tabela já tinha a política "itens_nfe_tenant"
-- (supabase/migrations/001_multi_fazenda.sql, linha ~99), que é FOR ALL e exige
-- fazenda_id = get_fazenda_ativa_id() para todo comando, inclusive UPDATE.
--
-- No Postgres, políticas de RLS (a trava de segurança que decide linha por linha
-- quem pode ler/gravar o quê) são permissivas por padrão e se combinam com OU,
-- não com E. Com as duas políticas de UPDATE coexistindo, basta satisfazer
-- QUALQUER UMA das duas para passar. Como a de 013 não exige fazenda_id, ela
-- sozinha já libera o UPDATE para qualquer usuário autenticado — a proteção de
-- isolamento por fazenda da 001 fica sem efeito nesse comando. Um usuário logado
-- de uma fazenda poderia editar item de nota fiscal de OUTRA fazenda.
--
-- Confirmado contra o banco em produção (consulta somente leitura,
-- `supabase db query --linked`):
--   select policyname, cmd, qual from pg_policies where tablename = 'itens_nfe';
-- As duas políticas acima retornaram coexistindo exatamente como descrito.
--
-- Esta migração remove a política frouxa criada por 013 e recria "itens_nfe_tenant"
-- pelo mesmo padrão de 001_multi_fazenda.sql (DROP POLICY IF EXISTS + CREATE POLICY,
-- usando get_fazenda_ativa_id()), garantindo que sobre exatamente uma política
-- cobrindo UPDATE em itens_nfe — e que ela exija a fazenda ativa do usuário.

-- 1. Remove a política permissiva que a migração 013 criou (sem checagem de fazenda_id)
drop policy if exists "Usuários autenticados podem atualizar itens_nfe" on itens_nfe;

-- 2. Recria a política de isolamento por fazenda com o mesmo nome e definição de
--    supabase/migrations/001_multi_fazenda.sql — idempotente, funciona mesmo se por
--    algum motivo ela não existir mais quando este script rodar.
drop policy if exists "itens_nfe_tenant" on itens_nfe;

create policy "itens_nfe_tenant" on itens_nfe
  for all
  using (auth.uid() is not null and fazenda_id = get_fazenda_ativa_id())
  with check (auth.uid() is not null and fazenda_id = get_fazenda_ativa_id());
