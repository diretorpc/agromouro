-- Migration 017 — Fundação da aba "Controle" (defensivos/adubos/sementes)
-- Execute no SQL Editor do Supabase
--
-- Contexto: a aba "Controle" cruza duas fontes de gasto com insumo que hoje
-- vivem separadas — a NF-e automática (Make → webhook → itens_nfe) e um PDF
-- importado manualmente (extrato de fornecedor ou contrato de compra, sem
-- XML nenhum). O objetivo é uma tabela única na tela mostrando os dois lados
-- lado a lado, com o PDF de origem sempre rastreável.
--
-- Bucket de Storage já criado manualmente: "controle-documentos" (privado).
-- Falta ajustar nas Configurações do bucket (2 campos, painel do Supabase):
--   file_size_limit -> ~10 MB   |   allowed_mime_types -> application/pdf
-- Hoje está "Any" / 50 MB — não é bloqueante pra esta migration, mas fica
-- registrado pra não esquecer.
--
-- FLUXO QUE ESTA MIGRATION ASSUME (decide agora, muda o desenho do service):
-- a linha em `documentos_controle` só é criada DEPOIS de o PDF ser lido pela
-- IA — fornecedor, número do documento e hash do arquivo já resolvidos no
-- mesmo INSERT. `arquivo_hash` não depende da IA (é hash puro do arquivo),
-- então pode ser calculado antes da leitura — mas a LINHA só nasce depois,
-- junto com o resultado da leitura. Se o service falhar no INSERT por
-- conflito de duplicidade (constraints abaixo), ele PRECISA apagar o objeto
-- já subido no Storage antes de responder — senão fica arquivo órfão que
-- nada no banco referencia.
--
-- Linha importada em `itens_nfe` é OBRIGADA a decidir, no mesmo INSERT, se
-- conta como gasto (`conta_como_compra`) e qual a data do gasto
-- (`data_manual` = `documentos_controle.data_documento`) — ver constraint
-- `item_de_documento_completo`. Sem isso, o Financeiro (que lê itens_nfe
-- inteira, sem filtro, e trata `conta_como_compra` nulo como "conta") soma
-- a mesma compra duas vezes quando a NF-e correspondente também chegar
-- (mesmo mecanismo do gasto fantasma de R$ 1,06 mi documentado na 008).
--
-- Este arquivo já foi colado neste banco de dev em versões anteriores.
-- Toda mudança de índice/constraint usa DROP POR NOME antes de recriar —
-- nunca confiar em "IF NOT EXISTS" quando o nome pode já existir apontando
-- pra uma definição antiga.

begin;

-- 1. Tabela de documentos importados (PDF de fornecedor/contrato) — bloco
--    completo, pra ambiente novo que nunca rodou esta migration.
create table if not exists documentos_controle (
  id                uuid primary key default gen_random_uuid(),
  fornecedor        text,          -- nome do fornecedor lido do PDF, como veio
  numero_documento  text,          -- número da duplicata/nota/contrato — chave de dedupe junto com fornecedor
  data_documento    date,          -- data impressa no documento (emissão do extrato / início do contrato)
  valor_total       numeric(12,2), -- total declarado no PDF, pra conferir contra a soma dos itens gravados
  status            text not null default 'processando'
                       check (status in ('importado','processando','processado','erro')),
  erro_mensagem     text,
  nome_arquivo      text not null, -- nome original do arquivo enviado
  arquivo_path      text not null, -- ver convenção obrigatória no comment abaixo
  fazenda_id        uuid not null references fazendas(id),
  created_at        timestamptz not null default now()
);

-- Colunas/ajustes que ambiente já migrado ainda não tem (ambiente novo já
-- nasce assim pela CREATE TABLE acima — vira no-op nesse caso).
alter table documentos_controle add column if not exists arquivo_hash text;
alter table documentos_controle alter column status set default 'processando';

-- Fornecedor normalizado (maiúsculo, sem espaço duplicado/nas pontas) só
-- pra efeito de dedupe — "Solos Soluções" e "SOLOS SOLUÇÕES  " não podem
-- virar duas chaves diferentes e deixar o mesmo documento entrar 2x.
alter table documentos_controle
  add column if not exists fornecedor_normalizado text
    generated always as (upper(btrim(regexp_replace(fornecedor, '\s+', ' ', 'g')))) stored;

comment on column documentos_controle.arquivo_path is
  'Caminho no bucket "controle-documentos". Convenção OBRIGATÓRIA:
   <fazenda_id>/<uuid>.pdf — a primeira pasta precisa ser o fazenda_id, pra a
   policy de storage.objects (quando existir) conseguir isolar por fazenda.
   Travado no banco pelo constraint arquivo_path_por_fazenda, abaixo.';

comment on column documentos_controle.arquivo_hash is
  'sha256 do arquivo em hexadecimal, calculado ANTES de subir pro Storage —
   não depende de leitura por IA. Primeira linha de defesa contra reenviar o
   MESMO arquivo duas vezes; a segunda (fornecedor+número normalizados) só
   entra em ação depois da IA ler o conteúdo. NOT NULL: sem hash, esta trava
   não existe — ver constraint dedupe_exige_identidade.';

alter table documentos_controle
  drop constraint if exists arquivo_path_por_fazenda,
  add  constraint arquivo_path_por_fazenda check (arquivo_path like fazenda_id::text || '/%');

-- Linha só nasce depois da leitura (ou com status='erro' quando a leitura
-- falhou) — nula em fornecedor/número/hash não pode passar pelas duas
-- travas de duplicidade em silêncio, senão elas nunca disparam. Confere
-- também numero_documento não-vazio: sem isso, dois documentos diferentes
-- do MESMO fornecedor com número igualmente ilegível ("") colidiriam como
-- se fossem o mesmo, e um seria recusado por engano.
alter table documentos_controle
  drop constraint if exists dedupe_exige_identidade,
  add  constraint dedupe_exige_identidade check (
    status = 'erro'
    or (
      fornecedor is not null and btrim(fornecedor) <> ''
      and numero_documento is not null and btrim(numero_documento) <> ''
    )
  );
alter table documentos_controle alter column arquivo_hash set not null;

-- Precisa vir AQUI, antes do DROP da unique(id, fazenda_id) mais abaixo:
-- numa reaplicação deste arquivo, itens_nfe_doc_controle_fk (criada na
-- seção 2) já existe e depende dessa unique — dropar a unique primeiro dá
-- erro 2BP01 "other objects depend on it" e a migration para no meio.
-- Nome padrão do Postgres pra REFERENCES em coluna é <tabela>_<coluna>_fkey
-- (confirmado no banco vivo); o segundo DROP cobre o nome que esta própria
-- migration usa — nenhum dos dois falha se o nome não bater, é só no-op.
alter table itens_nfe drop constraint if exists itens_nfe_documento_controle_id_fkey;
alter table itens_nfe drop constraint if exists itens_nfe_doc_controle_fk;

-- Índice de coluna única em fazenda_id virou peso morto: o índice composto
-- abaixo já atende `where fazenda_id = X` sozinho (fazenda_id é a primeira
-- coluna dele). Índice solto sem uso só custa escrita.
drop index if exists idx_documentos_controle_faz;

-- Identidade do documento pelo conteúdo (fornecedor normalizado + número).
-- DROP por nome antes de recriar: um índice com esse nome já existe neste
-- banco (rodada anterior), indexando `fornecedor` CRU — "if not exists"
-- teria pulado a correção em silêncio e deixado a trava errada no lugar.
drop index if exists idx_doc_controle_dedupe;
create unique index idx_doc_controle_dedupe
  on documentos_controle (fazenda_id, fornecedor_normalizado, numero_documento);

-- Segunda trava, independente: mesmo arquivo (byte a byte) reenviado duas
-- vezes, mesmo que a leitura da IA divirja entre as duas. WHERE status <>
-- 'erro' de propósito: sem isso, reenviar o mesmo PDF depois de uma falha
-- de leitura (timeout, chave expirada) ficaria bloqueado pra sempre, sem
-- tela nenhuma pra apagar a linha de erro. IMPORTANTE pro service (Epic
-- 2.2): por ser índice PARCIAL, ele não serve de alvo para upsert/
-- on-conflict — grave com INSERT simples e capture o erro 23505 (mesma
-- lição do idx_doc_controle_dedupe, que segue sem WHERE de propósito por
-- ser o índice que o on-conflict, se algum dia precisar, deveria usar).
drop index if exists idx_doc_controle_hash;
create unique index idx_doc_controle_hash
  on documentos_controle (fazenda_id, arquivo_hash)
  where status <> 'erro';

-- Exigido pela FK composta de itens_nfe mais abaixo — Postgres só aceita
-- FK composta contra colunas com unique constraint. id já é PK (único
-- sozinho); esta unique(id, fazenda_id) é só pra habilitar a FK composta.
-- A FK de itens_nfe que depende desta unique já foi derrubada acima (antes
-- deste bloco) de propósito: reaplicar o arquivo com a ordem invertida dá
-- erro 2BP01 "other objects depend on it" na segunda vez.
alter table documentos_controle
  drop constraint if exists documentos_controle_id_fazenda_key,
  add  constraint documentos_controle_id_fazenda_key unique (id, fazenda_id);

alter table documentos_controle enable row level security;

-- Mesmo padrão de isolamento por fazenda que itens_nfe_tenant usa desde a
-- correção da migration 016 (FOR ALL + fazenda_id = get_fazenda_ativa_id()).
drop policy if exists "documentos_controle_tenant" on documentos_controle;
create policy "documentos_controle_tenant" on documentos_controle
  for all
  using (auth.uid() is not null and fazenda_id = get_fazenda_ativa_id())
  with check (auth.uid() is not null and fazenda_id = get_fazenda_ativa_id());

-- 2. Colunas novas em itens_nfe pra suportar linha importada de PDF ou
--    lançada manualmente (sem nota_fiscal_id).
--    Não precisa de policy nova: itens_nfe_tenant (FOR ALL) já cobre a linha
--    inteira, incluindo estas colunas.
alter table itens_nfe
  add column if not exists fornecedor text,
  add column if not exists numero_documento text,
  add column if not exists documento_controle_id uuid;

-- FK composta (documento + fazenda), não só documento: sem isso, um bug no
-- service poderia gravar item da fazenda A apontando pra documento da
-- fazenda B sem erro nenhum — a checagem de integridade referencial roda
-- sem RLS. Os DROPs desta FK (nome antigo e nome novo) já aconteceram lá
-- em cima, antes da unique(id, fazenda_id) — ver comentário naquele ponto.
alter table itens_nfe
  add constraint itens_nfe_doc_controle_fk
  foreign key (documento_controle_id, fazenda_id)
  references documentos_controle (id, fazenda_id)
  on delete restrict;

drop index if exists idx_itens_nfe_doc_controle;
create index idx_itens_nfe_doc_controle on itens_nfe(documento_controle_id);

comment on column itens_nfe.fornecedor is
  'Nome do fornecedor para item sem nota_fiscal_id (manual ou importado de PDF).
   Quando nota_fiscal_id existe, o fornecedor exibido vem de notas_fiscais.emitente_nome
   via JOIN, coluna própria primeiro — mesmo padrão de centro_custo com
   insumos.tipo. O constraint fornecedor_so_sem_nota, abaixo, IMPEDE gravar
   fornecedor numa linha de NF-e — se um dia for preciso corrigir o nome de
   um emitente lido errado do XML, isso é decisão de produto nova (editar
   notas_fiscais.emitente_nome direto, não esta coluna), não bug.';

comment on column itens_nfe.numero_documento is
  'Número da duplicata/nota/contrato do fornecedor, lido do PDF importado
   (espelha documentos_controle.numero_documento na linha). Travado junto com
   fornecedor pelo mesmo constraint: nunca preenchido numa linha de NF-e.';

comment on column itens_nfe.documento_controle_id is
  'Vínculo com o PDF de origem em documentos_controle, quando a linha veio de um
   documento importado. Nulo para item de NF-e (veio do XML) e para lançamento
   manual direto na tabela ("+ Nova linha" sem PDF). ON DELETE RESTRICT: apagar
   um documento com itens já gravados exige decisão explícita sobre o gasto —
   mesmo motivo de 009_excluir_nota_fiscal.sql existir.';

-- Trava as três colunas de "linha importada" juntas, num ALTER TABLE só
-- (atômico — se o ADD falhar, o DROP da mesma instrução também não efetiva).
alter table itens_nfe
  drop constraint if exists fornecedor_so_sem_nota,
  add  constraint fornecedor_so_sem_nota
  check (
    nota_fiscal_id is null
    or (fornecedor is null and numero_documento is null and documento_controle_id is null)
  );

-- Linha importada é obrigada a dizer se conta como gasto e qual a data —
-- sem isso, o Financeiro (item sem filtro, conta_como_compra nulo = conta)
-- pode somar a mesma compra duas vezes quando a NF-e chegar depois.
alter table itens_nfe
  drop constraint if exists item_de_documento_completo,
  add  constraint item_de_documento_completo
  check (
    documento_controle_id is null
    or (conta_como_compra is not null and data_manual is not null)
  );

commit;

-- VERIFICAÇÃO 1 — precisa devolver 3 linhas.
select 'coluna criada' as conferencia, column_name, is_nullable, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'itens_nfe'
   and column_name in ('fornecedor','numero_documento','documento_controle_id');

-- VERIFICAÇÃO 2 — precisa devolver 1 linha, cmd = ALL, com fazenda_id no qual.
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'documentos_controle';

-- VERIFICAÇÃO 3 — precisa devolver 3 linhas (as três constraints novas).
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.itens_nfe'::regclass
   and conname in ('fornecedor_so_sem_nota', 'item_de_documento_completo', 'itens_nfe_doc_controle_fk');

-- VERIFICAÇÃO 4 — coluna gerada e default novo de status, lado a lado.
select column_name, column_default, generation_expression
  from information_schema.columns
 where table_schema = 'public' and table_name = 'documentos_controle'
   and column_name in ('status', 'fornecedor_normalizado', 'arquivo_hash');

-- VERIFICAÇÃO 5 (rode por último, ou sozinha — o editor só mostra o
-- resultado do último SELECT quando cola tudo junto) — precisa devolver 2
-- linhas. LEIA o indexdef, não só a existência: o de "dedupe" TEM que
-- conter "fornecedor_normalizado", nunca "fornecedor" cru — é exatamente o
-- que ficou errado numa rodada anterior, e um count(*) sozinho não pegaria
-- de novo. O de "hash" tem que trazer "WHERE (status <> 'erro'::text)".
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'documentos_controle'
   and indexname in ('idx_doc_controle_dedupe', 'idx_doc_controle_hash');
