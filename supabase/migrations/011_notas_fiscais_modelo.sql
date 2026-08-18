-- ============================================================
-- AgroMouro — distingue NF-e (produto) de NFS-e (serviço) na trava anti-duplicata
-- Executar no Supabase SQL Editor. Apenas uma vez.
--
-- O QUE ESTAVA ERRADO: a trava da migração 005 (idx_nfe_numero_emitente_fazenda)
-- usa (numero, emitente_cnpj, fazenda_id) — mas número de NF-e e número de NFS-e
-- são sequências INDEPENDENTES do mesmo emitente. Um fornecedor que manda NF-e
-- nº 500 (peças) e NFS-e nº 500 (mão de obra) faz a segunda ser descartada como
-- "já processada" — gasto e boleto somem em silêncio. Achado do Apolo, 17/08/2026,
-- ao revisar o leitor de NFS-e (parseXmlNFSe, nfeProcessor.ts).
-- ============================================================

-- PASSO 1 — nova coluna. DEFAULT 'nfe' cobre TODA linha existente de uma vez:
-- até esta migração, o sistema só sabia ler NF-e — nenhuma linha antiga é NFS-e.
ALTER TABLE notas_fiscais
  ADD COLUMN IF NOT EXISTS modelo text NOT NULL DEFAULT 'nfe';

-- Postgres não tem "ADD CONSTRAINT IF NOT EXISTS" — script é para rodar uma
-- vez só (mesmo padrão da migração 005). Rodar de novo falha alto e claro,
-- nunca silencioso.
ALTER TABLE notas_fiscais
  ADD CONSTRAINT notas_fiscais_modelo_check CHECK (modelo IN ('nfe', 'nfse'));

-- PASSO 2 — trocar a trava. Sem risco de colisão nova: a chave antiga (numero,
-- emitente_cnpj, fazenda_id) já era única, e toda linha existente tem o MESMO
-- modelo ('nfe' pelo DEFAULT) — acrescentar uma coluna constante a uma chave já
-- única não pode criar duplicata onde não havia.
--
-- ORDEM IMPORTA: cria o índice NOVO primeiro, derruba o ANTIGO depois — nunca
-- pode existir um instante sem nenhuma trava única ativa. Invertida (DROP antes
-- do CREATE) até 17/08/2026 — achado [alto] do Apolo, 2ª rodada: a corrida real
-- de 11ms já medida em produção neste mesmo ponto (ver memória do projeto
-- "nfe-corrida-duas-portas") cai bem numa janela dessas.
--
-- AVISO: depois desta migração, reaplicar a 006_contas_de_nfe.sql vai falhar —
-- o RAISE EXCEPTION dela (linha ~20) exige que idx_nfe_numero_emitente_fazenda
-- exista, e o DROP abaixo o remove.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfe_numero_emitente_fazenda_modelo
  ON notas_fiscais (numero, emitente_cnpj, fazenda_id, modelo);

DROP INDEX IF EXISTS idx_nfe_numero_emitente_fazenda;

-- PASSO 3 — conferência. Precisa devolver 1 linha, índice novo, índice antigo sumido.
SELECT indexname FROM pg_indexes
WHERE tablename = 'notas_fiscais' AND indexname LIKE 'idx_nfe_numero_emitente_fazenda%';
