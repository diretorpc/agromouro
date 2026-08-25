-- ============================================================
-- AgroMouro — CORREÇÃO DE DADO (não é migration de schema)
-- Nota 289122 · RURALCENTRO PRODUTOS AGROPECUARIOS EIRELI · 04/07/2026
-- Executar UMA vez no SQL Editor do Supabase.
--
-- Esta pasta existe separada de supabase/migrations/ de propósito: quem
-- reconstruir o banco do zero NÃO deve rodar isto — a nota 289122 não existe
-- num banco novo, e um arquivo numerado na sequência das migrations viraria um
-- passo que falha (ou pior, não faz nada) para sempre.
--
-- O QUE ACONTECEU
-- A leitura do DANFE em PDF (25/08/2026) devolveu CFOP 5922 nas 19 linhas.
-- O papel imprime 5102 e 5405 — conferido duas vezes, em leituras
-- independentes, e batendo linha por linha nas duas.
--
-- 5922 é "faturamento de entrega futura": dinheiro sai, mercadoria não entra
-- (ver entraNoEstoque em api/src/services/contas/cfop.ts). Por isso a nota
-- gravou 19 itens com insumo_id nulo e ZERO movimentação de estoque.
--
-- O QUE ESTE ARQUIVO CONSERTA — E O QUE NÃO CONSERTA
--   ✔ o CFOP gravado passa a ser o que está impresso no papel
--   ✘ NÃO cria estoque retroativo: processarNFe já rodou e não roda de novo por
--     um UPDATE. Os itens (remédio, seringa, comedouro do Tejuco) continuam
--     fora do galpão. Foi decisão explícita — o estoque de veterinária não é
--     controlado neste sistema.
--   — o dinheiro NÃO muda: 5102, 5405 e 5922 contam como compra, então o
--     lançamento de R$ 3.369,73 já estava certo e continua igual.
--
-- SEGURANÇA: o WHERE exige cfop = '5922'. Rodar duas vezes não faz nada na
-- segunda, e nenhuma linha fora desta nota é tocada.
--
-- QUANDO **NÃO** USAR ESTE ARQUIVO COMO MODELO: se os itens forem ESTOCÁVEIS
-- (adubo, defensivo, semente), corrigir só o CFOP deixa a linha dizendo "compra
-- que entra no galpão" com insumo_id nulo e zero movimentação — inconsistência
-- calada, pior que o erro original. Nesse caso o caminho é outro: apagar a nota
-- (`SELECT excluir_nota_fiscal(...)`) e reimportar o PDF corrigindo o efeito na
-- tela de conferência, que faz o processarNFe rodar de novo.
--
-- EXECUTADO em 25/08/2026 pelo Matheus. Saída da conferência: 13 itens em 5102,
-- 6 em 5405, nenhum 5922 — igual ao que o papel imprime.
-- ============================================================

BEGIN;

UPDATE itens_nfe AS i
   SET cfop = v.cfop
  FROM (VALUES
    ('4bc3da45-3439-42b0-89c6-8b02e0dea98b'::uuid, '5405'),  -- TESOURA PODA C/L 78360/505EN
    ('10c6d10b-a9dc-421e-b63e-c0366cc8326b'::uuid, '5102'),  -- REMEDIO GLICOTON - B12 1000ML
    ('cc5f3bb9-89b9-4a89-a073-8a30582d1fa9'::uuid, '5102'),  -- REMEDIO PRADOR 100 ML
    ('b55a1779-e48d-4707-9e67-c3c84a14d238'::uuid, '5102'),  -- REMEDIO BORGAL 50ML
    ('1aa5ac09-0cf5-4c04-8615-a6fe0dc6a6a2'::uuid, '5102'),  -- REMEDIO PENCIVET PLUS PPU 50ML
    ('67b281eb-9370-4d5b-8463-94398a7b1b57'::uuid, '5102'),  -- REMEDIO MICOTIL INJ.300MG 050ML
    ('f8cb5924-ed73-45be-9e99-fb2836040ea7'::uuid, '5102'),  -- REMEDIO PHENODRAL 15ML C/ 3UN
    ('015043a6-81d2-4f2f-8a5d-9494d8c617e4'::uuid, '5102'),  -- REMEDIO MATABICHEIRA TOPLINE SPRAY 400ML
    ('389d1e26-bf16-4df6-ab72-dbac3c207e9e'::uuid, '5102'),  -- REMEDIO MONOVIN B1 20ML
    ('1db7c567-7e4f-4512-9414-7a5ac4e04ac3'::uuid, '5102'),  -- REMEDIO ANTIDIARREICO ORAL VALLEE 10 GR
    ('740a0942-775e-4383-963b-a1e7fc42de17'::uuid, '5102'),  -- REMEDIO CIDENTAL 250ML
    ('77dd0fee-4cce-4f77-b585-98ecd519e3df'::uuid, '5405'),  -- SERINGA DESC. 60ML S/AGULHA LOCK
    ('d5f1f3b2-4a39-4ff5-b4b9-21ede40e8d61'::uuid, '5405'),  -- SERINGA DESCARTAVEL 20ML
    ('a497de24-fbd4-48bb-85d6-5b731a264547'::uuid, '5405'),  -- SERINGA DESCARTAVEL 10ML
    ('6b7680b4-925a-47ad-90ff-98865dddc4b8'::uuid, '5405'),  -- SERINGA VETERINARIA FAZFORT 25ML
    ('208164bf-def6-41fc-aaa3-06ace5fe1912'::uuid, '5405'),  -- SERINGA DESCARTAVEL 03ML
    ('5edccf09-3710-41ea-aca4-ed26ae0c055a'::uuid, '5102'),  -- REMEDIO BAYCOX 1000ML
    ('10d977a1-d7f0-43aa-afc6-999dd7414e88'::uuid, '5102'),  -- COMEDOURO AVES TUB.B.PLAST 15KG
    ('6cd18ee7-0f49-4631-bbe8-60db7546a5f6'::uuid, '5102')   -- REMEDIO BIOXAN VALLEE 500ML
  ) AS v(id, cfop)
 WHERE i.id             = v.id
   AND i.nota_fiscal_id = 'ab80e71b-0e0a-4bf1-8f31-759678195725'
   AND i.cfop           = '5922';

COMMIT;

-- Conferência DEPOIS do COMMIT, de propósito: o SQL Editor do Supabase exibe o
-- resultado do ÚLTIMO statement. Com o SELECT no meio da transação, quem roda
-- vê a saída vazia do COMMIT e não confere nada (achado [médio] do Apolo).
-- Para ensaiar sem gravar, troque o COMMIT acima por ROLLBACK e rode de novo.
--
-- Esperado: 5102 → 13 itens · 5405 → 6 itens · nenhum 5922.
SELECT cfop, count(*) AS itens
  FROM itens_nfe
 WHERE nota_fiscal_id = 'ab80e71b-0e0a-4bf1-8f31-759678195725'
 GROUP BY cfop
 ORDER BY cfop;
