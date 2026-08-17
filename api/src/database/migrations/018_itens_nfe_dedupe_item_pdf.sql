-- Migration 018 — Trava de duplicidade por ITEM em itens_nfe (item importado de PDF)
-- Execute no SQL Editor do Supabase
--
-- Contexto (Achado 1, revisão do Apolo em gravarDocumentoPdf.ts): a migration
-- 017 só protege duplicidade em nível de DOCUMENTO — idx_doc_controle_dedupe
-- é `unique (fazenda_id, fornecedor_normalizado, numero_documento)`, e esse
-- `numero_documento` é o do DOCUMENTO (montarNumeroDocumento, documentoPdf.ts:
-- `${codigoCliente}-${dataDocumento}`). Um extrato "Contas a Receber por
-- Cliente" é cumulativo POR DEFINIÇÃO: toda duplicata ainda em aberto volta a
-- aparecer em todo extrato reemitido. `codigoCliente` fica fixo, mas
-- `dataDocumento` é a DATA DE GERAÇÃO DO RELATÓRIO — então o mesmo extrato
-- gerado em 01/07 ("000786-2026-07-01") e regerado em 01/08
-- ("000786-2026-08-01"), ainda listando as MESMAS duplicatas em aberto,
-- produz duas chaves de DOCUMENTO diferentes. Nenhum índice dispara, o
-- documento novo entra, e cada item da duplicata repetida é gravado de novo
-- em itens_nfe — dobrando o gasto contado pelo Financeiro. Confirmado: hoje
-- não existe nenhum índice único em itens_nfe (varridas as 17 migrations
-- desta pasta e as 10 de supabase/migrations) — zero defesa em nível de item.
--
-- Correção: uma segunda trava, independente da primeira, em nível de ITEM —
-- usando o número da duplicata INDIVIDUAL (itens_nfe.numero_documento, já
-- gravado desde a migration 017 — ver `numeroDocumentoDoItem` em
-- gravarDocumentoPdf.ts) em vez do número do documento. Só se aplica a item
-- IMPORTADO DE PDF (documento_controle_id not null): item de NF-e não ganha
-- esta defesa e não é o escopo desta correção (a NF-e tem CFOP para
-- distinguir duplicidade real de entrega/devolução — ver
-- nfe-entrega-futura-conta-dobrado.md).
--
-- Revisão do Apolo, rodada 3 (Achados B e C) — dois furos encontrados nesta
-- trava original, corrigidos nesta mesma versão do arquivo (nunca aplicada em
-- produção ainda, então não precisa de migration 019 separada):
--
-- ACHADO B — duas linhas LEGÍTIMAS e DISTINTAS dentro do MESMO documento
-- (mesmo produto, mesmo valor, mesma duplicata — comum quando a mesma
-- duplicata cobra 2x o mesmo produto em datas de entrega diferentes, ou
-- quando o documento repete a linha por outro motivo real) colidiam ENTRE SI
-- no índice original (5 colunas). A segunda virava "já existe, pula" mesmo
-- sendo uma compra real e distinta — perda de dinheiro na conferência, sem
-- aviso nenhum de que não era reimportação. Correção: `ocorrencia_no_documento`
-- (coluna nova) — a ordem sequencial (0, 1, 2...) de cada combinação idêntica
-- de (numero_documento, descricao, valor_total) DENTRO do mesmo documento,
-- calculada em código (gravarDocumentoPdf.ts). Duas linhas iguais no mesmo
-- documento recebem ocorrência 0 e 1 — não colidem, as duas são gravadas.
-- Reimportar o MESMO documento (mesma multiplicidade de repetição) produz a
-- MESMA sequência de ocorrências — continua sendo pego como duplicata de
-- verdade. Ver comentário da coluna, abaixo, para o detalhe do cálculo.
--
-- ACHADO C — item SEM número de duplicata próprio (contrato Mosaic, sem
-- numeração por linha) caía no fallback `numeroDocumentoDoItem` para o número
-- do DOCUMENTO inteiro — que muda a cada reimportação pelo MESMO motivo do
-- Achado 1 (embute `dataDocumento`, a data de GERAÇÃO do relatório/contrato
-- relido). A trava desta migration nunca disparava para este caso: um
-- contrato de R$ 250 mil reenviado (mesmo conteúdo, "data" de leitura
-- diferente) duplicava o gasto inteiro. Correção: o fallback em
-- `numeroDocumentoDoItem` (gravarDocumentoPdf.ts) passou a usar
-- `documento.codigoCliente` (estável entre reimportações — é o código
-- impresso no documento, sem a data embutida) em vez de
-- `documento.numeroDocumento`. `codigoCliente` é campo NOVO em
-- `DocumentoLido` (documentoPdf.ts) — antes só existia como variável local
-- dentro de `validarDocumentoLido`, usada para montar `numeroDocumento` e
-- descartada; agora também é devolvida no objeto. Não exige coluna nova
-- nesta migration: é só um dado adicional que passa a alimentar a mesma
-- coluna `itens_nfe.numero_documento` que já existia.
--
-- Este arquivo pode ser colado mais de uma vez neste banco sem erro — todo
-- índice/constraint usa DROP POR NOME antes do CREATE (mesma disciplina da
-- migration 017: "IF NOT EXISTS" pularia uma correção de definição em
-- silêncio numa reaplicação). EXCEÇÃO, replicando o padrão real que a própria
-- 017 já usa (ver `documentos_controle.fornecedor_normalizado` e
-- `documentos_controle.arquivo_hash` naquele arquivo): COLUNA usa
-- `ADD COLUMN IF NOT EXISTS`, nunca DROP — dropar uma coluna já em uso
-- destruiria dado gravado (índice/constraint não guardam dado, coluna
-- guarda). Se um dia a EXPRESSÃO da coluna gerada abaixo precisar mudar,
-- "IF NOT EXISTS" não vai aplicar a mudança (fica com a expressão antiga,
-- em silêncio) — quem editar este arquivo nesse cenário precisa trocar por
-- `ALTER TABLE ... DROP COLUMN fornecedor_normalizado` (cascade derruba o
-- índice que depende dela) seguido de novo `ADD COLUMN`, explicitamente.

begin;

-- Coluna gerada NOVA em itens_nfe (não existe hoje — diferente de
-- documentos_controle.fornecedor_normalizado, que já nasceu na 017). Mesmo
-- padrão de normalização (maiúsculo, sem espaço duplicado/nas pontas), pra
-- "Solos Soluções" e "SOLOS SOLUÇÕES  " não virarem duas chaves diferentes.
-- Fica NULL automaticamente quando `fornecedor` é NULL — não precisa de CASE
-- explícito, upper/btrim/regexp_replace de NULL já devolve NULL em Postgres.
-- Isso já cobre sozinho a exigência de "só preencher quando fornecedor não é
-- nulo": toda linha de NF-e tem itens_nfe.fornecedor NULL (constraint
-- fornecedor_so_sem_nota, migration 017), então fornecedor_normalizado
-- também fica NULL nela, e o índice abaixo (que além disso é filtrado por
-- documento_controle_id not null) nunca a alcança.
--
-- ADD COLUMN IF NOT EXISTS de propósito, não DROP por nome — ver exceção
-- documentada no cabeçalho do arquivo.
alter table itens_nfe
  add column if not exists fornecedor_normalizado text
    generated always as (upper(btrim(regexp_replace(fornecedor, '\s+', ' ', 'g')))) stored;

comment on column itens_nfe.fornecedor_normalizado is
  'Espelha documentos_controle.fornecedor_normalizado (migration 017), mas
   calculado em cima de itens_nfe.fornecedor. Só é não-nulo em linha
   importada de PDF — fornecedor_so_sem_nota proíbe preencher
   itens_nfe.fornecedor numa linha de NF-e, então esta coluna nasce NULL
   junto. Existe só para o índice idx_itens_nfe_dedupe_item, abaixo.';

-- Ocorrência sequencial (0, 1, 2...) da combinação (numero_documento,
-- descricao, valor_total) DENTRO do mesmo documento — ver ACHADO B no
-- cabeçalho do arquivo. Calculada em código (gravarDocumentoPdf.ts), nunca no
-- banco: o banco não sabe a ORDEM em que os itens de um documento foram
-- lidos, só código sabe. NOT NULL DEFAULT 0: item de NF-e (nunca entra no
-- índice parcial abaixo, filtrado por documento_controle_id) e item
-- legitimamente único dentro do seu documento (ocorrência 0, o caso comum)
-- não precisam de tratamento especial.
alter table itens_nfe
  add column if not exists ocorrencia_no_documento integer not null default 0;

comment on column itens_nfe.ocorrencia_no_documento is
  'Só relevante para item importado de PDF (documento_controle_id not null).
   0 para a primeira linha com esta combinação de (numero_documento,
   descricao, valor_total) dentro do MESMO documento; 1 para a segunda linha
   idêntica, 2 para a terceira, etc. Existe para permitir que duas linhas
   REALMENTE distintas (mesmo produto, mesmo valor, mesma duplicata — ex.:
   duas entregas do mesmo pedido em datas diferentes) sejam gravadas as DUAS,
   sem colidir uma com a outra no índice idx_itens_nfe_dedupe_item — e ainda
   assim continuar pegando reimportação de verdade do MESMO documento (mesma
   multiplicidade de repetição produz a MESMA sequência de ocorrências).';

-- Índice PARCIAL — só cobre item importado de PDF (documento_controle_id not
-- null). O par (fornecedor_normalizado, numero_documento) sozinho NÃO
-- bastaria: quando o item não tem número de duplicata próprio (contrato
-- Mosaic, por exemplo), `numeroDocumentoDoItem` (gravarDocumentoPdf.ts) cai
-- no fallback do `codigoCliente` do documento (estável entre reimportações —
-- ver ACHADO C no cabeçalho). `descricao` + `valor_total` fecham a
-- identidade nesse caso: dois produtos diferentes do mesmo "documento" sem
-- número próprio de item não colidem por engano entre si, e o MESMO produto
-- pelo MESMO valor, na mesma duplicata, é exatamente o caso de duplicidade
-- que queremos barrar. `ocorrencia_no_documento` (ver ACHADO B) fecha o
-- último furo: sem ela, duas linhas REAIS e distintas com os mesmos 4
-- valores colidiriam entre si dentro do MESMO documento.
--
-- AVISO para quem grava (gravarDocumentoPdf.ts): índice PARCIAL não é alvo
-- confiável de upsert/on-conflict do Postgres via supabase-js/PostgREST
-- (mesma lição já registrada no comentário de idx_doc_controle_hash, na
-- migration 017). Grave com INSERT simples — item a item, ou lote com
-- fallback item a item quando o lote falhar — e capture o erro 23505 de cada
-- item como "já importado antes, pula este", sem abortar o documento
-- inteiro por causa de um item repetido.
drop index if exists idx_itens_nfe_dedupe_item;
create unique index idx_itens_nfe_dedupe_item
  on itens_nfe (fazenda_id, fornecedor_normalizado, numero_documento, descricao, valor_total, ocorrencia_no_documento)
  where documento_controle_id is not null;

-- ACHADO D — revisão do Apolo, rodada 4: `marcarDocumentoComErro`
-- (gravarDocumentoPdf.ts) marca a linha como 'erro' de propósito, pra
-- permitir reenvio depois de uma falha parcial (item já gravado, erro no
-- meio do lote). `idx_doc_controle_hash` (migration 017) já é parcial —
-- `where status <> 'erro'` — e de fato libera o reenvio do MESMO ARQUIVO
-- (mesmo hash) depois da marca. Mas `idx_doc_controle_dedupe` (migration
-- 017, linhas 124-125 original — SEM cláusula WHERE) continua bloqueando
-- pelo CONTEÚDO (fornecedor_normalizado + numero_documento) mesmo com a
-- linha em 'erro'. Os dois índices protegem o MESMO documento por vias
-- diferentes (arquivo vs. conteúdo) e só um foi liberado — resultado:
-- documento marcado 'erro' fica preso pra sempre. Nem reenviar o mesmo
-- arquivo, nem enviar um arquivo NOVO com o mesmo fornecedor+número, passam,
-- porque o segundo índice recusa os dois.
--
-- Correção: tornar `idx_doc_controle_dedupe` também parcial, `where status
-- <> 'erro'` — mesmo padrão de `idx_doc_controle_hash`. Documento em 'erro'
-- deixa de contar pra nenhuma das duas travas; documento 'processado' segue
-- protegido pelas duas, como sempre foi.
--
-- Por que este ajuste está AQUI (na 018) e não voltando a editar o arquivo
-- 017: a 017 já foi aplicada em produção uma vez (commit ba68b0e) — reescrever
-- aquele arquivo agora não mudaria nada do que já rodou lá, só criaria
-- confusão pra quem comparar o texto da 017 com o banco de produção sem saber
-- que o texto mudou depois da aplicação. Ajuste sobre migration já aplicada
-- vira parte da PRÓXIMA migration que rodar — mesma disciplina que o resto
-- deste arquivo já segue (DROP por nome antes de recriar, nunca "IF NOT
-- EXISTS" silencioso sobre definição divergente).
--
-- CUSTO desta mudança, registrado por exigência da revisão: o comentário
-- original de `idx_doc_controle_dedupe` (migration 017, linhas 132-135) o
-- deixa SEM WHERE de propósito, justamente para servir de alvo de um
-- eventual futuro on-conflict/upsert (`idx_doc_controle_hash`, o outro
-- índice, já nasceu parcial e por isso NUNCA serviria pra isso). Tornar
-- `idx_doc_controle_dedupe` parcial também fecha essa porta: índice PARCIAL
-- não é alvo confiável de on-conflict do Postgres via supabase-js/PostgREST
-- — mesma lição já registrada pro `idx_doc_controle_hash` na 017. Hoje esse
-- custo é TEÓRICO: nada neste projeto usa on-conflict contra nenhum dos dois
-- índices — o service grava com INSERT simples e trata o erro 23505 no catch
-- (decisão já tomada, ver `gravarDocumentoDoPdf` em gravarDocumentoPdf.ts).
-- Fica registrado para quem ler depois: se um dia alguém quiser trocar
-- INSERT+catch por upsert em documentos_controle, NENHUM dos dois índices
-- vai servir de alvo — vai exigir outra estratégia (RPC, ou um índice
-- adicional não-parcial só pra upsert).
drop index if exists idx_doc_controle_dedupe;
create unique index idx_doc_controle_dedupe
  on documentos_controle (fazenda_id, fornecedor_normalizado, numero_documento)
  where status <> 'erro';

commit;

-- VERIFICAÇÃO 1 — precisa devolver 2 linhas: as duas colunas novas
-- (fornecedor_normalizado gerada/nullable; ocorrencia_no_documento not null
-- com default 0).
select column_name, is_nullable, column_default, generation_expression
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'itens_nfe'
   and column_name in ('fornecedor_normalizado', 'ocorrencia_no_documento');

-- VERIFICAÇÃO 2 — precisa devolver 1 linha. LEIA o indexdef, não só a
-- existência: precisa conter "WHERE (documento_controle_id IS NOT NULL)" e
-- as 6 colunas na ordem (fazenda_id, fornecedor_normalizado,
-- numero_documento, descricao, valor_total, ocorrencia_no_documento) — é o
-- mesmo tipo de engano já documentado no comentário da VERIFICAÇÃO 5 da
-- migration 017.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'itens_nfe'
   and indexname = 'idx_itens_nfe_dedupe_item';

-- VERIFICAÇÃO 3 (ACHADO D) — precisa devolver 1 linha, com o indexdef
-- contendo "WHERE (status <> 'erro'::text)". Antes deste ajuste, esta
-- consulta devolvia o mesmo índice SEM cláusula WHERE nenhuma — se o
-- indexdef vier sem o WHERE, a migration não rodou (ou rodou uma versão
-- antiga do arquivo) e o bloqueio de documento 'erro' descrito no comentário
-- acima ainda existe no banco.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'documentos_controle'
   and indexname = 'idx_doc_controle_dedupe';
