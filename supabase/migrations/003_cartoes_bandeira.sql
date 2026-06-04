-- Renomeia ultimos_digitos → bandeira e remove a restrição CHAR(4)
ALTER TABLE cartoes RENAME COLUMN ultimos_digitos TO bandeira;
ALTER TABLE cartoes ALTER COLUMN bandeira TYPE TEXT;
