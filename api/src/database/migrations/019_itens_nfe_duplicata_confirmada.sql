-- Migration 019 — Sinal PERSISTIDO de duplicata confirmada, item de Controle
-- Execute no SQL Editor do Supabase
--
-- Contexto (desenho completo: docs/superpowers/specs/2026-08-18-controle-
-- tabela-editavel-design.md, seção "Duplicatas pintadas — Caso 1"): a trava
-- de dedupe por item (idx_itens_nfe_dedupe_item, migration 018) já BLOQUEIA
-- a reimportação de uma linha idêntica — mas o bloqueio nunca deixa rastro:
-- a linha nova é descartada em silêncio (INSERT falha com 23505, o item
-- nunca chega a existir), e a linha ANTIGA que "absorveu" a duplicata nunca
-- é marcada de nenhum jeito. Pedido do Matheus (tela editável estilo
-- Excel): a tela precisa PINTAR essa linha antiga, pra ele ver "esta linha
-- já foi confirmada de novo numa reimportação" em vez de não saber.
--
-- Esta migration só adiciona a COLUNA que guarda o sinal. Quem GRAVA o
-- valor é `gravarDocumentoPdf.ts` (Tarefa 2 do plano) — ao capturar um
-- 23505 na reimportação, busca a linha existente pela mesma chave do
-- índice parcial e atualiza estas duas colunas nela. Quem LÊ é
-- `GET /controle/itens` (Tarefa 3) — devolve `duplicado: true` para toda
-- linha com `duplicata_confirmada_em is not null`.
--
-- De brinde, resolve a pendência conhecida do ESTADO.md: "documento
-- fantasma com itens: [] — nada distingue de gravação falhou". Depois desta
-- migration, reimportar um extrato onde TUDO já existia deixa rastro
-- visível — não no documento novo (que de fato fica com itens: [], isso não
-- muda), mas nas linhas ANTIGAS, que ganham um `duplicata_confirmada_em`
-- fresco. Confirma que a reimportação rodou e bateu em cada linha, em vez
-- de ter falhado calada.
--
-- ADD COLUMN IF NOT EXISTS de propósito, nunca DROP — mesma disciplina das
-- migrations 017/018 (dropar coluna já em uso destrói dado gravado).

begin;

alter table itens_nfe
  add column if not exists duplicata_confirmada_em    timestamptz,
  add column if not exists duplicata_confirmada_vezes  integer not null default 0;

comment on column itens_nfe.duplicata_confirmada_em is
  'Timestamp da ÚLTIMA vez que uma reimportação tentou gravar um item IDÊNTICO
   a este (mesma chave de idx_itens_nfe_dedupe_item, migration 018) e foi
   barrada pela trava de dedupe. NULL = esta linha nunca foi reencontrada
   numa reimportação. Só é atualizado em `gravarDocumentoPdf.ts`
   (inserirItensUmAUm), nunca pelas rotas de edição manual (PATCH/POST
   /controle/itens) — editar um item à mão não é "reimportação".
   Usado por GET /controle/itens para pintar a linha na tela (Caso 1 da
   duplicata — ver o desenho em docs/superpowers/specs/2026-08-18-
   controle-tabela-editavel-design.md).';

comment on column itens_nfe.duplicata_confirmada_vezes is
  'Quantas vezes esta linha foi reencontrada numa reimportação (ver
   duplicata_confirmada_em). Não é dado crítico — só contexto extra pro
   tooltip da célula pintada ("confirmada de novo 3 vezes, a última em
   ..."). 0 é o valor normal (nunca reencontrada).';

commit;

-- VERIFICAÇÃO — precisa devolver 2 linhas: as duas colunas novas
-- (duplicata_confirmada_em nullable sem default; duplicata_confirmada_vezes
-- not null com default 0).
select column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'itens_nfe'
   and column_name in ('duplicata_confirmada_em', 'duplicata_confirmada_vezes');
