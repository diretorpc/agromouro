-- Migration 015 — Adicionar coluna data_manual em itens_nfe
-- Bug crítico: web/app/(app)/financeiro/page.tsx (handleAdd) já gravava
-- `data_manual: form.data` no insert de itens_nfe, mas a coluna nunca existiu
-- na tabela. Todo lançamento manual do Financeiro falhava ao salvar com
-- "coluna inexistente" (erro do Postgres/PostgREST).
--
-- Por que uma coluna nova, e não reaproveitar `created_at`: o formulário
-- permite lançar uma despesa retroativa (data no passado), e `created_at`
-- é sempre "agora" — usar ele perderia a data escolhida pelo usuário.
--
-- Tipo `date` (não `timestamptz`) para ficar igual a `notas_fiscais.data_emissao`
-- (ver api/src/database/schema.sql linha 89) — as duas datas alimentam a mesma
-- coluna `data_emissao` no front (web/app/(app)/financeiro/page.tsx, função load,
-- com fallback `row.notas_fiscais?.data_emissao ?? row.data_manual`), então
-- precisam comparar como o mesmo tipo (mesmo formato "YYYY-MM-DD" de string).
-- Execute no SQL Editor do Supabase

alter table itens_nfe
  add column if not exists data_manual date;

comment on column itens_nfe.data_manual is
  'Data escolhida pelo usuário ao lançar uma despesa manual no Financeiro (permite retroagir). Nulo quando o item veio de uma NF-e — nesse caso a data vem de notas_fiscais.data_emissao.';
