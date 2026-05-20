-- Migration 002 — Adicionar centros de custo: biologico, calcario, frete, operacional
-- Execute no SQL Editor do Supabase

alter table insumos
  drop constraint if exists insumos_tipo_check;

alter table insumos
  add constraint insumos_tipo_check check (
    tipo in (
      'herbicida',
      'fungicida',
      'inseticida',
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
      'outro'
    )
  );
