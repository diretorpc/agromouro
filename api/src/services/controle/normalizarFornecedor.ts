// Espelha EXATAMENTE a coluna gerada `fornecedor_normalizado` das migrations
// 017 (documentos_controle) e 018 (itens_nfe): ambas usam
// `upper(btrim(regexp_replace(fornecedor, '\s+', ' ', 'g')))`. Precisa ser a
// mesma conta nos DOIS lados (código e banco) — se divergirem (ex.: só
// `toUpperCase().trim()`, sem colapsar espaço duplo), uma busca em código por
// esta chave não acha a linha que o Postgres gerou.
//
// Extraído para arquivo próprio (achado desta sessão): antes só existia
// como função local em routes/controle.ts — `gravarDocumentoPdf.ts`
// precisava da MESMA conta para localizar a linha existente ao persistir o
// sinal de "duplicata confirmada" (migration 019), e duas cópias da mesma
// regra divergindo cedo ou tarde é o tipo de bug que este projeto já pagou
// caro (ver MEMORY.md do projeto).
export function normalizarFornecedor(valor: string): string {
  return valor.replace(/\s+/g, ' ').trim().toUpperCase()
}
