-- Migration 014 — Adicionar categorias faltantes: adjuvante, manutencao, alimentacao, outros
-- A tela web/app/(app)/financeiro/page.tsx (array TIPOS) já oferecia estas 4 opções no menu,
-- mas a trava insumos_tipo_check (ver migration 002) nunca foi atualizada para aceitá-las.
-- Resultado: insert em insumos com uma dessas categorias era recusado pelo banco.
-- Lista completa abaixo = as 18 já existentes + as 4 novas, copiada 1:1 do array TIPOS
-- (web/app/(app)/financeiro/page.tsx linhas 69-92) para garantir 100% de correspondência.
-- Execute no SQL Editor do Supabase

alter table insumos
  drop constraint if exists insumos_tipo_check;

alter table insumos
  add constraint insumos_tipo_check check (
    tipo in (
      'herbicida',
      'fungicida',
      'inseticida',
      'adjuvante',
      'biologico',
      'fertilizante_n',
      'fertilizante_p',
      'fertilizante_k',
      'fertilizante_outro',
      'calcario',
      'semente',
      'combustivel',
      'lubrificante',
      'peca_maquina',
      'servico',
      'frete',
      'operacional',
      'rh',
      'outro',
      'manutencao',
      'alimentacao',
      'outros'
    )
  );
