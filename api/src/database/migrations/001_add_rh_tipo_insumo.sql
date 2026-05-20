-- Migration 001 — Adicionar centro de custo RH ao tipo de insumo
-- Execute no SQL Editor do Supabase

alter table insumos
  drop constraint if exists insumos_tipo_check;

alter table insumos
  add constraint insumos_tipo_check check (
    tipo in (
      'herbicida',
      'fungicida',
      'inseticida',
      'fertilizante_n',
      'fertilizante_p',
      'fertilizante_k',
      'fertilizante_outro',
      'semente',
      'combustivel',
      'lubrificante',
      'peca_maquina',
      'servico',
      'rh',
      'outro'
    )
  );
