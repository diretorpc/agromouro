-- Migration 021 — Talhões arrendados (áreas próprias operadas por terceiro)
-- Execute no SQL Editor do Supabase. Uma vez só.
-- Spec: docs/superpowers/specs/2026-08-24-talhoes-arrendados-design.md

-- 1. Trocar o CHECK de status. O nome da constraint em produção NÃO pode ser
--    presumido (schema.sql está desatualizado e as migrations foram coladas à
--    mão), então descobrimos o nome em vez de cravá-lo.
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'talhoes'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then
    execute format('alter table talhoes drop constraint %I', c);
  end if;
end $$;

alter table talhoes add constraint talhoes_status_check
  check (status in ('ativo','pousio','colhido','arrendado'));

-- 2. Arrendatário. Nullable, e o banco impede preencher fora do status certo.
alter table talhoes add column if not exists arrendatario text;

alter table talhoes add constraint talhoes_arrendatario_so_se_arrendado
  check (arrendatario is null or status = 'arrendado');

-- Conferir depois de aplicar (esperado: as duas constraints acima):
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint where conrelid = 'talhoes'::regclass and contype = 'c';
