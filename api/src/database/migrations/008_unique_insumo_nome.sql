-- Migration 008 — Índice único case-insensitive em insumos.nome
-- Execute no SQL Editor do Supabase
--
-- Contexto: existia duplicata 'HERBICIDA DONTOR 20L' (2 linhas com mesmo nome,
-- IDs diferentes) que causou bug no fluxo WhatsApp — buscarInsumo() pegava o ID
-- órfão (sem linha em estoque) e o UPDATE silenciosamente não decrementava.
-- A duplicata foi removida manualmente; este índice impede recorrência.
--
-- Como funciona: índice funcional sobre LOWER(nome). 'Score', 'SCORE' e 'score'
-- normalizam para a mesma chave 'score' — qualquer INSERT/UPDATE que crie um
-- nome igual (case-insensitive) a outro existente vai falhar com erro 23505
-- (unique_violation). O fluxo NF-e já tenta vincular por similaridade antes de
-- criar; este índice é a rede de segurança no banco.

CREATE UNIQUE INDEX insumos_nome_lower_unique
ON insumos (LOWER(nome));
