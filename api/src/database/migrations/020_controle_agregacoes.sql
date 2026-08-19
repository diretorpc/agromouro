-- Migration 020 — Agregações da aba Controle (os 5 gráficos)
-- Desenho completo: docs/superpowers/specs/2026-08-19-controle-graficos-design.md
--
-- ============================================================
-- COMO APLICAR (a ordem importa — leia antes de colar)
-- ============================================================
-- 1. Cole SÓ o bloco `begin; ... commit;`. É uma transação única: qualquer
--    erro no meio significa que NADA foi aplicado.
-- 2. Rode CADA VERIFICAÇÃO do fim do arquivo SEPARADAMENTE. O SQL Editor do
--    Supabase mostra o resultado só da ÚLTIMA instrução de um script — colar
--    tudo de uma vez esconde as três primeiras, inclusive a que prova que
--    `authenticated` não pode chamar a função.
-- 3. Só depois suba o código da rota. Se a rota der 404 com "Could not find
--    the function ... in the schema cache", rode `notify pgrst, 'reload schema';`
--    — não é a migration que falhou, é o cache do PostgREST.
--
-- REAPLICAÇÃO: colar este arquivo de novo é seguro — `create or replace
-- function` substitui de verdade e o índice tem `drop` antes do `create`.
-- ⚠️ Mas se alguém MUDAR O TIPO de um argumento (ex.: p_top integer -> bigint),
-- `create or replace` cria uma SOBRECARGA em vez de substituir, e o PostgREST
-- passa a responder "function is not unique". Nesse caso, dropar a assinatura
-- antiga primeiro (ver ROLLBACK no fim do arquivo).
--
-- ============================================================
-- POR QUE NO BANCO E NÃO EM NODE (a decisão que faz o gráfico não mentir)
-- ============================================================
-- A grade de Controle carrega 500 itens por vez e o PostgREST corta em 1000
-- linhas por padrão. Um gráfico somado em cima do que está carregado mostra
-- a soma de UM PEDAÇO e parece a soma do TODO — erro que fica verde em todo
-- teste. Um GROUP BY aqui dentro vê a fazenda inteira, sempre.
--
-- ⚠️ ISOLAMENTO MULTI-FAZENDA: a API chama isto com SUPABASE_SERVICE_KEY, e
-- service_role tem BYPASSRLS — a RLS NÃO protege nada nesta porta. O filtro
-- `fazenda_id = p_fazenda_id` dentro da função é a única barreira. Ele
-- aparece UMA vez só (na CTE `itens`), de propósito: cinco funções separadas
-- seriam cinco lugares para alguém esquecer. Não copie o filtro para dentro
-- de outra CTE — todas bebem da mesma.
--
-- ⚠️ NÃO FILTRE POR `conta_como_compra`. Medido em 19/08/2026: item de
-- Controle nasce SEMPRE com `conta_como_compra = false` — tanto o importado
-- de PDF (gravarDocumentoPdf.ts) quanto o avulso (criarItemControleAvulso.ts).
-- É de propósito: Controle é conferência, o gasto real vem da NF-e (senão o
-- Financeiro soma a mesma compra 2x — gasto fantasma de R$ 1,06 mi, migration
-- 008). Quem copiar o filtro do Financeiro (`conta_como_compra <> false`)
-- para cá recebe CINCO GRÁFICOS VAZIOS e nenhum erro.
--
-- Volume atual (não escrevo o número, que apodrece — escrevo o comando):
--   select count(*), sum(valor_total) from itens_nfe where nota_fiscal_id is null;

begin;

-- ============================================================
-- 1. Normalização de descrição de produto
-- ============================================================
-- O PDF traz o CÓDIGO DO FORNECEDOR grudado na frente da descrição:
--   "0003586-ENGEO PLENO S - 20 LT"   <- 0003586 é o código DA SYAGRI
-- Outro fornecedor usa outro código para o mesmo produto, e
-- `itens_nfe.insumo_id` é sempre NULL em item de Controle
-- (gravarDocumentoPdf.ts) — não existe id compartilhado para agrupar.
-- Sem esta normalização, o gráfico 2 (gasto por produto) quebra o mesmo
-- produto em N barras e o gráfico 5 (preço entre fornecedores) não acha par.
--
-- O que ela faz, em ordem: tira o código inicial -> troca " - " por espaço ->
-- remove acento -> maiúsculas -> colapsa espaço -> trim.
--   "0003586-ENGEO PLENO S - 20 LT"  ->  "ENGEO PLENO S 20 LT"
--
-- ⚠️ O CÓDIGO PRECISA TER 4+ DÍGITOS (revisão do Apolo, achado 6). Com
-- `[0-9]+` solto, "10-30-10 GRANULADO" e "20-30-10 GRANULADO" viravam AMBOS
-- "30-10 GRANULADO" — dois adubos diferentes fundidos numa barra só, que é
-- exatamente o casamento errado que o spec proíbe. Fórmula NPK e decimal com
-- ponto ("2.4-D") têm 1-3 dígitos; código de fornecedor tem 4+. Errar para o
-- lado de NÃO remover é o erro barato: só separa o que poderia juntar.
--
-- ⚠️ LIMITE HONESTO, registrado no spec: isto NÃO casa embalagem escrita
-- diferente — "20 LT" e "20L" continuam produtos separados. É deliberado.
-- Casamento aproximado (fuzzy) foi PROIBIDO até o Matheus decidir: juntar
-- errado dois produtos num gráfico de preço faz ele negociar com o vendedor
-- em cima de um número falso — pior que não juntar.
--
-- IMMUTABLE de propósito: só depende do argumento, então pode virar índice
-- de expressão no dia em que o volume justificar.
create or replace function controle_normalizar_descricao(p_descricao text)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(
           btrim(
             regexp_replace(
               upper(
                 translate(
                   -- 2) traço com espaço de pelo menos um lado vira espaço.
                   --    Traço SEM espaço em volta fica: "2,4-D" não pode virar
                   --    "2,4 D" num lugar e continuar "2,4-D" em outro.
                   regexp_replace(
                     -- 1) código do fornecedor no começo: 4+ dígitos + separador.
                     --    O separador é OBRIGATÓRIO e o {4,} também — ver o
                     --    aviso do NPK acima.
                     regexp_replace(coalesce(p_descricao, ''),
                                    '^[[:space:]]*[0-9]{4,}[[:space:]]*[-/.][[:space:]]*', ''),
                     '[[:space:]]+-+[[:space:]]*|[[:space:]]*-+[[:space:]]+', ' ', 'g'),
                   -- 3) acento fora: "SOLUÇÃO" e "SOLUCAO" são o mesmo produto
                   'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                   'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
               -- 4) espaço duplo/tab vira um espaço só
               '[[:space:]]+', ' ', 'g')),
           '')
$fn$;

comment on function controle_normalizar_descricao(text) is
  'Normaliza descrição de item de Controle para agrupar o MESMO produto vindo
   de documentos diferentes: remove o código do fornecedor no início
   ("0003586-", 4+ dígitos), troca traço-com-espaço por espaço, remove acento,
   maiúsculas, colapsa espaço. Os 4+ dígitos protegem fórmula NPK no começo
   ("10-30-10 GRANULADO") de virar o mesmo rótulo de outra fórmula.
   NÃO faz casamento aproximado — "20 LT" e "20L" seguem separados (decisão
   registrada no spec de 19/08/2026: casar errado é pior que não casar).
   Devolve NULL para descrição vazia.';

-- ============================================================
-- 2. Índice que sustenta a varredura
-- ============================================================
-- Item de Controle é um SUBCONJUNTO pequeno de itens_nfe (o resto é NF-e).
-- O índice existente é `idx_itens_nfe_faz(fazenda_id)` — sozinho, ele obriga
-- o Postgres a ler também toda linha de NF-e da fazenda só para descartar.
-- Índice PARCIAL sobre o mesmo predicado que a agregação e a grade usam:
-- menor, mais rápido, e não pesa na escrita da NF-e (linha com
-- nota_fiscal_id não entra nele).
--
-- DROP POR NOME antes do CREATE, nunca `if not exists` — disciplina escrita
-- no cabeçalho da migration 018: `if not exists` PULA em silêncio uma
-- correção de definição numa reaplicação, e sobra um índice antigo que
-- ninguém sabe que está lá. A exceção é COLUNA (que guarda dado); índice não
-- guarda dado nenhum.
drop index if exists idx_itens_nfe_controle_faz_data;
create index idx_itens_nfe_controle_faz_data
  on itens_nfe (fazenda_id, data_manual)
  where nota_fiscal_id is null;

-- ============================================================
-- 3. controle_graficos — uma chamada, os 5 gráficos
-- ============================================================
-- UMA função, não cinco: os cinco gráficos usam EXATAMENTE o mesmo conjunto
-- de itens filtrado (mesmos filtros da grade). Cinco funções seriam cinco
-- cópias do filtro para divergir em silêncio — e o gráfico passaria a
-- discordar da tabela logo abaixo dele na tela, que é o pior defeito
-- possível aqui.
--
-- Os filtros espelham a função `listarItensControle`, em
-- api/src/services/controle/listarItensControle.ts (sem número de linha de
-- propósito: intervalo de linha quebra no primeiro commit).
-- Se aquele arquivo mudar de regra, ESTA função muda junto.
create or replace function controle_graficos(
  p_fazenda_id  uuid,
  p_fornecedor  text[]  default null,
  p_data_inicio date    default null,
  p_data_fim    date    default null,
  p_status      text[]  default null,
  p_top         integer default 10
)
returns jsonb
language sql
stable
parallel safe
security invoker
set search_path = public, pg_temp
as $fn$
with
-- Cinto de segurança do fazenda_id: com p_fazenda_id nulo, esta CTE não
-- produz linha nenhuma e o JOIN abaixo esvazia tudo — em vez de virar
-- "sem filtro" e devolver dado de outra fazenda. O freio de verdade é a
-- rota (400 antes de chegar aqui, fazendaDe(req)); isto é o cinto.
guarda as (
  select p_fazenda_id as fazenda_id where p_fazenda_id is not null
),
itens as (
  select
    -- Item avulso pode não ter fornecedor (criarItemControleAvulso.ts).
    -- Ele APARECE como "Sem fornecedor" — não some do gráfico 1.
    coalesce(nullif(btrim(i.fornecedor), ''), 'Sem fornecedor')     as fornecedor,
    -- NULL quando a descrição está vazia. O Matheus PODE apagar a célula
    -- Produto na grade (controleItens.ts aceita string vazia de propósito —
    -- "máxima liberdade, igual Excel"), então isto acontece de verdade.
    -- Item sem produto vira o balde 'Sem produto' no gráfico 2 e é contado
    -- em meta.itensSemProduto/valorSemProduto — nunca some calado.
    controle_normalizar_descricao(i.descricao)                      as produto,
    nullif(btrim(i.unidade), '')                                    as unidade,
    i.data_manual,
    coalesce(i.valor_total, 0)::numeric                             as valor_total,
    i.quantidade::numeric                                           as quantidade,
    -- UMA RÉGUA SÓ para preço unitário: sempre valor_total / quantidade
    -- (revisão do Apolo, achado 4). A coluna `valor_unitario` do PDF NÃO é
    -- reconciliada com o total (documentoPdf.ts usa o total INFORMADO quando
    -- existe, e deixa o unitário como veio) — extrato com preço de tabela na
    -- coluna unitária e total já com desconto fazia `precoMedio` cair FORA
    -- da faixa precoMin–precoMax da própria barra. Gráfico se contradizendo
    -- sozinho na tela em que ele senta com o vendedor.
    case when coalesce(i.quantidade, 0) <> 0
         then i.valor_total::numeric / i.quantidade::numeric end     as preco_unit
  from itens_nfe i
  join guarda g on g.fazenda_id = i.fazenda_id
  -- LEFT JOIN: item avulso não tem documento, e não pode sumir por isso.
  left join documentos_controle d
         on d.id = i.documento_controle_id
        and d.fazenda_id = g.fazenda_id
  where i.nota_fiscal_id is null            -- só Controle; NF-e nunca entra
    and (
      p_fornecedor is null or cardinality(p_fornecedor) = 0
      or i.fornecedor_normalizado in (
           -- Mesma normalização da coluna gerada (migrations 017/018), então
           -- funciona com o nome cru OU já normalizado vindo do Node.
           select upper(btrim(regexp_replace(f, '[[:space:]]+', ' ', 'g')))
             from unnest(p_fornecedor) f
         )
    )
    -- Item com data_manual NULL é EXCLUÍDO quando há filtro de período —
    -- mesmo comportamento do PostgREST na grade (gte/lte contra NULL é
    -- falso). Sem filtro de data, ele entra e é contado em meta.itensSemData.
    and (p_data_inicio is null or i.data_manual >= p_data_inicio)
    and (p_data_fim    is null or i.data_manual <= p_data_fim)
    -- Status pertence ao DOCUMENTO, não ao item. Item avulso não tem status
    -- e por isso NUNCA é escondido por este filtro — regra do spec, copiada
    -- do `.or(documento_controle_id.is.null, ...)` da grade. Não reinvente.
    and (
      p_status is null or cardinality(p_status) = 0
      or i.documento_controle_id is null
      or d.status = any (p_status)
    )
),
por_fornecedor as (
  select fornecedor as rotulo, sum(valor_total) as total, count(*) as itens
    from itens group by fornecedor
),
-- Produtos com nome. É esta lista, e não a do gráfico 2, que alimenta os
-- gráficos 4 e 5 — 'Sem produto' não é uma identidade de produto, não dá
-- para acompanhar preço dele no tempo nem comparar entre fornecedores.
por_produto_real as (
  select produto as rotulo, sum(valor_total) as total, count(*) as itens
    from itens where produto is not null group by produto
),
-- Balde do que perdeu o nome. `having count(*) > 0` faz a CTE devolver ZERO
-- linhas quando não existe item sem produto — sem barra fantasma de R$ 0,00.
--
-- ⚠️ O rótulo é CAIXA MISTA de propósito, e a razão precisa ficar escrita:
-- controle_normalizar_descricao devolve SEMPRE maiúscula, então nenhum produto
-- real pode virar 'Sem produto' e somar dinheiro dentro do balde. Trocar para
-- 'SEM PRODUTO' (para ficar igual aos outros rótulos da tela) cria a colisão.
sem_produto as (
  select 'Sem produto'::text as rotulo, sum(valor_total) as total, count(*) as itens
    from itens where produto is null having count(*) > 0
),
por_produto as (
  select rotulo, total, itens from por_produto_real
  union all
  select rotulo, total, itens from sem_produto
),
por_mes as (
  select to_char(data_manual, 'YYYY-MM') as mes, sum(valor_total) as total, count(*) as itens
    from itens where data_manual is not null group by 1
),
-- Gráficos 4 e 5 são POR PRODUTO: não dá para desenhar 300 linhas numa tela.
-- Corte explícito nos p_top produtos que mais custaram — e `meta` conta o
-- universo inteiro, para a legenda poder dizer "10 de 37". Corte silencioso
-- vira "cobri tudo" na cabeça de quem lê.
top_produtos as (
  select rotulo, total from por_produto_real order by total desc, rotulo limit greatest(p_top, 1)
),
-- Média PONDERADA pela quantidade (sum(valor)/sum(qtd)), não média simples:
-- uma compra de 1 unidade não pode pesar igual a uma de 500. A legenda da
-- tela precisa DIZER que é ponderada — ver meta.mediaPonderadaPor.
preco_no_tempo as (
  select i.produto,
         to_char(i.data_manual, 'YYYY-MM')                      as data,
         sum(i.valor_total) / nullif(sum(i.quantidade), 0)      as preco_medio,
         sum(i.quantidade)                                      as quantidade,
         -- Mesmo aviso de régua do gráfico 5: se o mesmo rótulo aparece com
         -- "SC" num mês e "KG" noutro, o degrau na linha parece variação de
         -- preço e é troca de unidade. A tela precisa poder avisar.
         array_agg(distinct i.unidade) filter (where i.unidade is not null) as unidades
    from itens i
    join top_produtos t on t.rotulo = i.produto
   where i.data_manual is not null
     and coalesce(i.quantidade, 0) > 0
   group by i.produto, 2
),
preco_no_tempo_json as (
  select p.produto,
         t.total,
         jsonb_agg(jsonb_build_object(
           'data',       p.data,
           'precoMedio', round(p.preco_medio, 4),
           'quantidade', p.quantidade,
           'unidades',   to_jsonb(p.unidades)
         ) order by p.data) as pontos
    from preco_no_tempo p
    join top_produtos t on t.rotulo = p.produto
   group by p.produto, t.total
),
preco_por_fornecedor as (
  select produto,
         fornecedor,
         sum(valor_total) / nullif(sum(quantidade), 0) as preco_medio,
         min(preco_unit)                              as preco_min,
         max(preco_unit)                              as preco_max,
         count(*)                                     as itens,
         -- Unidades vistas nesse par produto+fornecedor. Se vier mais de uma
         -- ("LT" e "L", ou pior, "KG" e "L"), a tela TEM que avisar: o preço
         -- médio ali está misturando régua. Devolver o array é mais honesto
         -- que escolher uma e calar.
         array_agg(distinct unidade) filter (where unidade is not null) as unidades
    from itens
   where produto is not null
     and coalesce(quantidade, 0) > 0
   group by produto, fornecedor
),
-- Gráfico 5 só faz sentido para produto comprado de MAIS DE UM fornecedor —
-- é a pergunta "qual loja me cobra mais caro?". Produto de um fornecedor só
-- viraria uma barra sozinha, sem comparação nenhuma.
produtos_comparaveis as (
  select f.produto
    from preco_por_fornecedor f
   group by f.produto
  having count(distinct f.fornecedor) > 1
),
-- p_top corta o gráfico 5 TAMBÉM (revisão do Apolo, achado 3: antes o
-- comentário prometia o corte e o SQL não fazia — payload ilimitado e
-- legenda mentirosa). O ranking aqui é entre os COMPARÁVEIS, não o top geral:
-- um produto comprado de 3 lojas mas barato não pode ser expulso do gráfico
-- de comparação por um produto caro comprado de uma loja só.
top_comparaveis as (
  select c.produto, coalesce(pp.total, 0) as total
    from produtos_comparaveis c
    left join por_produto_real pp on pp.rotulo = c.produto
   order by total desc, c.produto
   limit greatest(p_top, 1)
),
preco_por_fornecedor_json as (
  select f.produto,
         t.total,
         jsonb_agg(jsonb_build_object(
           'fornecedor', f.fornecedor,
           'precoMedio', round(f.preco_medio, 4),
           'precoMin',   round(f.preco_min, 4),
           'precoMax',   round(f.preco_max, 4),
           'itens',      f.itens,
           'unidades',   to_jsonb(f.unidades)
         ) order by f.preco_medio desc) as barras
    from preco_por_fornecedor f
    join top_comparaveis t on t.produto = f.produto
   group by f.produto, t.total
)
select jsonb_build_object(
  -- Gráficos 1, 2 e 3 vêm COMPLETOS (uma linha por fornecedor/produto/mês,
  -- não por item — o volume é pequeno). O agrupamento "top 10 + outros" e o
  -- botão "ver todos" acontecem no frontend, que é onde o botão existe.
  'porFornecedor', coalesce((
      select jsonb_agg(jsonb_build_object('rotulo', rotulo, 'total', round(total, 2), 'itens', itens)
                       order by total desc, rotulo)
        from por_fornecedor), '[]'::jsonb),
  'porProduto', coalesce((
      select jsonb_agg(jsonb_build_object('rotulo', rotulo, 'total', round(total, 2), 'itens', itens)
                       order by total desc, rotulo)
        from por_produto), '[]'::jsonb),
  'porMes', coalesce((
      select jsonb_agg(jsonb_build_object('mes', mes, 'total', round(total, 2), 'itens', itens)
                       order by mes)
        from por_mes), '[]'::jsonb),
  'precoNoTempo', coalesce((
      select jsonb_agg(jsonb_build_object('produto', produto, 'pontos', pontos)
                       order by total desc, produto)
        from preco_no_tempo_json), '[]'::jsonb),
  'precoPorFornecedor', coalesce((
      select jsonb_agg(jsonb_build_object('produto', produto, 'barras', barras)
                       order by total desc, produto)
        from preco_por_fornecedor_json), '[]'::jsonb),
  -- meta existe para a tela poder ser HONESTA sobre o que não está no
  -- gráfico. Cada descarte tem DOIS números: quantos itens e QUANTO DINHEIRO
  -- — num gráfico cujo eixo é dinheiro, "3 itens sem data" não conta que
  -- faltam R$ 180 mil nas barras.
  --
  -- ⚠️ OS TRÊS `valorSem*` NÃO SIGNIFICAM A MESMA COISA. Quem escrever a
  -- legenda somando os três como "fora do gráfico" vai mentir na tela:
  --
  --   campo               | gráfico 2      | gráfico 3 | gráficos 4 e 5
  --   valorSemData        | dentro         | FORA      | fora
  --   valorSemQuantidade  | dentro         | dentro    | FORA
  --   valorSemProduto     | DENTRO (balde) | dentro    | FORA
  --
  -- `valorSemProduto` é o único que aparece no gráfico 2 — como a barra
  -- 'Sem produto'. Lá as barras FECHAM com totalGeral; dizer "R$ X fora do
  -- gráfico" ao lado do gráfico 2 é falso.
  --
  -- `produtosDistintos` conta produtos COM NOME (o universo dos gráficos 4
  -- e 5). O gráfico 2 tem esse número + 1 quando existe item sem produto —
  -- para contar barras, use `porProduto.length`, não este campo.
  'meta', jsonb_build_object(
    'totalGeral',            coalesce((select round(sum(valor_total), 2) from itens), 0),
    'totalItens',            (select count(*) from itens),
    'itensSemData',          (select count(*) from itens where data_manual is null),
    'valorSemData',          coalesce((select round(sum(valor_total), 2) from itens where data_manual is null), 0),
    'itensSemProduto',       (select count(*) from itens where produto is null),
    'valorSemProduto',       coalesce((select round(sum(valor_total), 2) from itens where produto is null), 0),
    'itensSemQuantidade',    (select count(*) from itens where coalesce(quantidade, 0) = 0),
    'valorSemQuantidade',    coalesce((select round(sum(valor_total), 2) from itens where coalesce(quantidade, 0) = 0), 0),
    'fornecedoresDistintos', (select count(*) from por_fornecedor),
    'produtosDistintos',     (select count(*) from por_produto_real),
    'produtosNoPrecoTempo',  (select count(*) from preco_no_tempo_json),
    'produtosComparaveis',   (select count(*) from produtos_comparaveis),
    'produtosNoPrecoPorFornecedor', (select count(*) from preco_por_fornecedor_json),
    'topAplicado',           greatest(p_top, 1),
    'mediaPonderadaPor',     'quantidade'
  )
);
$fn$;

comment on function controle_graficos(uuid, text[], date, date, text[], integer) is
  'Alimenta os 5 gráficos da aba Controle numa chamada só (GET /controle/graficos).
   Filtros idênticos aos da grade (listarItensControle): fornecedor, período
   (data_manual), status do documento — com item avulso sempre visível — e
   sempre nota_fiscal_id is null. fazenda_id é OBRIGATÓRIO e vem de
   fazendaDe(req), NUNCA do corpo da requisição: service_role bypassa RLS, este
   filtro é a única barreira entre as fazendas.
   Não filtra conta_como_compra de propósito — item de Controle é sempre false.
   Preço unitário usa UMA régua só (valor_total/quantidade), nunca a coluna
   valor_unitario, que não é reconciliada com o total.
   p_top corta os gráficos 4 E 5 (ambos são uma série por produto); 1-3 vêm
   completos e o "top 10 + outros" é feito no frontend.
   meta.* diz o que ficou de fora, em itens E em reais.';

-- Menor privilégio: só o backend (service_role) chama. O frontend passa pela
-- rota do Railway, que resolve a fazenda pelo token — se `authenticated`
-- pudesse chamar direto com um p_fazenda_id à escolha, o isolamento entre
-- fazendas cairia, porque o filtro está no ARGUMENTO. O Supabase tem
-- `alter default privileges ... grant all on functions to anon, authenticated`,
-- então a função NASCE executável por eles: o revoke abaixo não é enfeite.
revoke all on function controle_normalizar_descricao(text) from public, anon, authenticated;
revoke all on function controle_graficos(uuid, text[], date, date, text[], integer) from public, anon, authenticated;
grant execute on function controle_normalizar_descricao(text) to service_role;
grant execute on function controle_graficos(uuid, text[], date, date, text[], integer) to service_role;

commit;

-- ============================================================
-- VERIFICAÇÃO 1 — RODE SOZINHA. Privilégio.
-- Esperado: 2 linhas, ambas com pode_service_role = true e
-- pode_authenticated = false.
-- ⛔ Se pode_authenticated vier true, PARE: o p_fazenda_id é o único
-- isolamento e estaria exposto à chave pública do navegador.
-- ============================================================
select p.proname                                                   as funcao,
       has_function_privilege('service_role',  p.oid, 'execute')   as pode_service_role,
       has_function_privilege('authenticated', p.oid, 'execute')   as pode_authenticated
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('controle_graficos', 'controle_normalizar_descricao');

-- ============================================================
-- VERIFICAÇÃO 2 — RODE SOZINHA. A normalização faz o que promete.
-- Esperado, coluna a coluna:
--   a = 'ENGEO PLENO S 20 LT'
--   b = 'ENGEO PLENO S 20L'
--   c = '2,4-D AMINA'          (traço colado NÃO vira espaço)
--   d = 'SOLUCAO'
--   e = NULL
--   f = '10-30-10 GRANULADO'   (fórmula NPK INTACTA — 2 dígitos, não é código)
--   g = '20-30-10 GRANULADO'   (⛔ se f e g vierem IGUAIS, a trava do {4,}
--                                caiu e dois adubos diferentes viraram um)
--   h = 'ADUBO NPK 04-14-08'   (fórmula no meio nunca foi afetada)
-- ⚠️ a e b NÃO batem entre si ("20 LT" vs "20L") — limite conhecido e aceito.
-- Se algum dia baterem, alguém adicionou casamento aproximado sem avisar.
-- ============================================================
select controle_normalizar_descricao('0003586-ENGEO PLENO S - 20 LT')  as a,
       controle_normalizar_descricao('12345-Engeo  Pleno S  20L')      as b,
       controle_normalizar_descricao('2,4-D AMINA')                    as c,
       controle_normalizar_descricao('  SOLUÇÃO  ')                    as d,
       controle_normalizar_descricao('   ')                            as e,
       controle_normalizar_descricao('10-30-10 GRANULADO')             as f,
       controle_normalizar_descricao('20-30-10 GRANULADO')             as g,
       controle_normalizar_descricao('ADUBO NPK 04-14-08')             as h;

-- ============================================================
-- VERIFICAÇÃO 3 — RODE SOZINHA. O índice existe e é parcial.
-- Esperado: 1 linha, com WHERE (nota_fiscal_id IS NULL) no indexdef.
-- ============================================================
select indexname, indexdef
  from pg_indexes
 where tablename = 'itens_nfe'
   and indexname = 'idx_itens_nfe_controle_faz_data';

-- ============================================================
-- VERIFICAÇÃO 4 — RODE SOZINHA. Isolamento entre fazendas + o que
-- ficou de fora dos gráficos. Compare `total_geral` de cada fazenda com o
-- rodapé da grade dela.
-- ⛔ Fazendas com dado devolvendo o MESMO total = filtro furado. Não suba
-- código nenhum.
-- ⚠️ Se `valor_sem_produto` ou `valor_sem_data` vierem altos, a soma das
-- barras NÃO vai bater com o total — e a tela precisa dizer isso na legenda.
-- ============================================================
select f.nome,
       g.meta ->> 'totalGeral'      as total_geral,
       g.meta ->> 'totalItens'      as total_itens,
       g.meta ->> 'itensSemData'    as itens_sem_data,
       g.meta ->> 'valorSemData'    as valor_sem_data,
       g.meta ->> 'itensSemProduto' as itens_sem_produto,
       g.meta ->> 'valorSemProduto' as valor_sem_produto,
       g.meta ->> 'produtosDistintos'   as produtos,
       g.meta ->> 'produtosComparaveis' as produtos_comparaveis
  from fazendas f
  cross join lateral (select controle_graficos(f.id) -> 'meta' as meta) g
 order by f.nome;

-- ============================================================
-- ROLLBACK — as três são reversíveis sem perda de dado (nenhuma escreve em
-- tabela). Use também antes de recriar com assinatura DIFERENTE.
-- ============================================================
-- drop function if exists controle_graficos(uuid, text[], date, date, text[], integer);
-- drop function if exists controle_normalizar_descricao(text);
-- drop index if exists idx_itens_nfe_controle_faz_data;
