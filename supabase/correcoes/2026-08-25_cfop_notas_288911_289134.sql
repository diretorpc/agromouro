-- ============================================================
-- AgroMouro — CORREÇÃO DE DADO (não é migration de schema)
-- Notas 288911 (01/07/2026) e 289134 (04/07/2026)
-- RURALCENTRO PRODUTOS AGROPECUARIOS EIRELI · CNPJ 38629580000153
-- Executar UMA vez no SQL Editor do Supabase.
--
-- Irmã de 2026-08-25_cfop_nota_289122.sql: MESMO defeito, mesmo fornecedor,
-- outras duas notas. Achadas ao varrer o banco depois de consertar a primeira —
-- das 4 notas que entraram por PDF, 3 tinham a nota inteira em 5922.
--
-- O QUE ESTÁ ERRADO
-- Os itens entraram com CFOP 5922 (faturamento de entrega futura). O papel
-- imprime 5102 e 5405, e a natureza da operação das duas notas é
-- "VENDA MERCADORIA ADQ REC TERCEIROS" — compra comum, não entrega futura.
-- Conferido em DUAS leituras independentes de cada PDF, com perguntas
-- diferentes, e as duas bateram linha por linha.
--
-- 5922 tem entraNoEstoque=false (api/src/services/contas/cfop.ts): as duas notas
-- gravaram itens com insumo_id nulo e ZERO movimentação de estoque.
--
-- O QUE MUDA E O QUE NÃO MUDA — igual à 289122:
--   ✔ o CFOP passa a ser o que está impresso no papel
--   ✘ NÃO cria estoque retroativo (UPDATE não faz processarNFe rodar de novo).
--     São itens de veterinária, estoque não controlado neste sistema. Para item
--     ESTOCÁVEL o caminho é apagar a nota (excluir_nota_fiscal) e reimportar.
--   — dinheiro NÃO muda: 5102, 5405 e 5922 contam todos como compra, e a coluna
--     conta_como_compra (já true nas 5 linhas) não é tocada aqui.
--
-- SEGURANÇA: o WHERE exige cfop = '5922'. Rodar duas vezes não faz nada na
-- segunda, e nenhuma linha fora destas duas notas é tocada.
-- ============================================================

BEGIN;

UPDATE itens_nfe AS i
   SET cfop = v.cfop
  FROM (VALUES
    -- Nota 288911 · 01/07/2026 · R$ 84,29
    ('bb87fb15-179e-4eb2-b46f-685578b7086b'::uuid, '5102'),  -- REMEDIO ROFLIN INJ. 100ML
    -- Nota 289134 · 04/07/2026 · R$ 164,34
    ('cd9101f8-1782-4af6-99b2-5dc2041b17aa'::uuid, '5102'),  -- REMEDIO ALIV - V INJETAVEL 50 ML
    ('337a2210-679f-48a2-a9c8-04b4e307d078'::uuid, '5102'),  -- REMEDIO POTENAY INJETAVEL 10ML
    ('06e63402-c5b6-4473-8fd1-81b5f806c29b'::uuid, '5405'),  -- SERINGA DESCARTAVEL 10ML
    ('5d38b1cc-c98a-4567-bd81-22eadae848ce'::uuid, '5405')   -- AGULHA DESCARTAVEL 25X8
  ) AS v(id, cfop)
 WHERE i.id   = v.id
   AND i.cfop = '5922'
   AND i.nota_fiscal_id IN (
     '5cb9d54a-1cd3-4e8f-bcd3-8a51e6c24ff0',  -- 288911
     'a49e959f-b4d5-4d18-8738-2be14f7cb346'   -- 289134
   );

COMMIT;

-- Conferência DEPOIS do COMMIT: o SQL Editor exibe o resultado do ÚLTIMO
-- statement. Para ensaiar sem gravar, troque o COMMIT por ROLLBACK.
--
-- Esperado:
--   288911 · 5102 · 1
--   289134 · 5102 · 2
--   289134 · 5405 · 2
-- Nenhuma linha com 5922.
SELECT n.numero, i.cfop, count(*) AS itens
  FROM itens_nfe i
  JOIN notas_fiscais n ON n.id = i.nota_fiscal_id
 WHERE i.nota_fiscal_id IN (
   '5cb9d54a-1cd3-4e8f-bcd3-8a51e6c24ff0',
   'a49e959f-b4d5-4d18-8738-2be14f7cb346'
 )
 GROUP BY n.numero, i.cfop
 ORDER BY n.numero, i.cfop;

-- E a varredura geral: nota de PDF com a nota INTEIRA em 5922 ainda por
-- corrigir. Depois desta correção tem que voltar VAZIO.
SELECT n.numero, n.emitente_nome, n.data_emissao, count(*) AS itens
  FROM itens_nfe i
  JOIN notas_fiscais n ON n.id = i.nota_fiscal_id
 WHERE n.arquivo_pdf IS NOT NULL
 GROUP BY n.id, n.numero, n.emitente_nome, n.data_emissao
HAVING bool_and(i.cfop = '5922');
