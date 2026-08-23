-- ============================================================
-- AgroMouro — contrato de adubo vira conta a pagar
-- Executar no Supabase SQL Editor: colar o arquivo INTEIRO e clicar em Run.
-- Spec: docs/superpowers/specs/2026-08-23-contrato-adubo-contas-a-pagar-design.md
--
-- O QUE ESTE ARQUIVO TOCA: só CRIA coisa nova (duas colunas nulas e um
-- índice). Não altera nem apaga nenhuma linha existente. É seguro colar
-- quantas vezes for preciso — todo comando tem IF NOT EXISTS.
--
-- POR QUE `tipo` PODE SER NULO: os 3 documentos já importados (Syagri,
-- Solos, Protec) foram gravados antes desta coluna existir. NULO significa
-- 'extrato' para todo efeito de código — ver `tipoDeDocumento()` em
-- documentoPdf.ts. Preencher esses 3 à mão seria adivinhar; o default de
-- código já os trata do jeito certo (não contam como gasto).
--
-- POR QUE `on delete set null`: apagar o documento pela tela do Controle NÃO
-- pode apagar uma conta a pagar que talvez já esteja paga. A conta sobrevive
-- órfã e o dono a dispensa à mão (decisão do Matheus, 23/08/2026).
-- ============================================================

ALTER TABLE contas_a_pagar
  ADD COLUMN IF NOT EXISTS documento_controle_id UUID
  REFERENCES documentos_controle(id) ON DELETE SET NULL;

ALTER TABLE documentos_controle
  ADD COLUMN IF NOT EXISTS tipo TEXT;

-- CHECK separado do ADD COLUMN: se a coluna já existir de uma execução
-- anterior, o ADD COLUMN vira no-op e o CHECK precisa ser garantido mesmo
-- assim. NULL passa em CHECK por definição no Postgres — é o que queremos.
ALTER TABLE documentos_controle
  DROP CONSTRAINT IF EXISTS documentos_controle_tipo_check;

ALTER TABLE documentos_controle
  ADD CONSTRAINT documentos_controle_tipo_check
  CHECK (tipo IN ('extrato','contrato'));

-- Reimportar o mesmo contrato não pode criar a mesma conta duas vezes.
-- Parcial (WHERE ... IS NOT NULL) para não atrapalhar conta avulsa/de nota,
-- que têm documento_controle_id nulo e podem repetir vencimento à vontade.
CREATE UNIQUE INDEX IF NOT EXISTS contas_a_pagar_contrato_unico
  ON contas_a_pagar (fazenda_id, documento_controle_id, vencimento)
  WHERE documento_controle_id IS NOT NULL;

-- VERIFICAÇÃO — precisa devolver 3 linhas.
SELECT 'coluna documento_controle_id' AS conferencia, column_name
  FROM information_schema.columns
 WHERE table_name = 'contas_a_pagar' AND column_name = 'documento_controle_id'
UNION ALL
SELECT 'coluna tipo', column_name
  FROM information_schema.columns
 WHERE table_name = 'documentos_controle' AND column_name = 'tipo'
UNION ALL
SELECT 'indice unico', indexname
  FROM pg_indexes
 WHERE indexname = 'contas_a_pagar_contrato_unico';
