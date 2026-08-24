-- ============================================================
-- AgroMouro — guarda o PDF da nota importada pela tela
-- Executar no Supabase SQL Editor. Apenas uma vez.
--
-- CONTEXTO: a aba Notas ganhou um terceiro caminho de entrada — subir o DANFE
-- (ou NFS-e) em PDF, ler com IA, conferir na tela e gravar pelo mesmo
-- processarNFe que o XML usa. Duas coisas precisam ficar no banco:
--
--   arquivo_pdf  — caminho do PDF no Storage, para o dono reabrir o papel.
--                  O XML NUNCA foi guardado (a coluna xml_raw existe e fica
--                  sempre vazia); esta coluna conserta isso só do lado do PDF.
--   arquivo_hash — sha256 do arquivo. É a ÚNICA trava atômica nova contra
--                  reimportar o mesmo PDF: a conferência humana e o aviso de
--                  "nota já existe" são checagem em código, e checagem em
--                  código não é atômica (ver a corrida de 11 ms já medida em
--                  produção, memória "nfe-corrida-duas-portas").
--
-- BUCKET: criar "notas-pdf" no painel do Supabase, PRIVADO, antes de rodar
-- isto. Configurações do bucket: file_size_limit ~10 MB,
-- allowed_mime_types = application/pdf. Mesmo padrão de "controle-documentos"
-- (migration 017). Quem lê é a API, com service key — sem policy de Storage.
-- ============================================================

-- PASSO 1 — as duas colunas. Nulas em toda nota que não veio de PDF (e-mail,
-- webhook, XML manual) — que é toda nota existente hoje.
ALTER TABLE notas_fiscais
  ADD COLUMN IF NOT EXISTS arquivo_pdf text;

ALTER TABLE notas_fiscais
  ADD COLUMN IF NOT EXISTS arquivo_hash text;

-- PASSO 2 — a trava do arquivo.
--
-- O `WHERE arquivo_hash IS NOT NULL` NÃO é enfeite: sem ele, todas as notas
-- antigas (hash nulo) entrariam no índice. Em Postgres NULL nunca é igual a
-- NULL, então elas não colidiriam entre si — mas o índice carregaria milhares
-- de linhas mortas para sempre. Parcial é o formato certo, e é o mesmo que a
-- migration 017 usa em idx_doc_controle_hash.
--
-- A chave inclui fazenda_id de propósito: a mesma nota pode legitimamente ser
-- importada em duas fazendas diferentes (compra rateada), e um índice global
-- transformaria isso em recusa silenciosa na segunda fazenda.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfe_arquivo_hash
  ON notas_fiscais (fazenda_id, arquivo_hash)
  WHERE arquivo_hash IS NOT NULL;

-- PASSO 3 — conferência. Precisa devolver as 2 colunas e o índice novo.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'notas_fiscais' AND column_name IN ('arquivo_pdf', 'arquivo_hash');

SELECT indexname FROM pg_indexes
WHERE tablename = 'notas_fiscais' AND indexname = 'idx_nfe_arquivo_hash';
