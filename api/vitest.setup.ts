// Alguns módulos (ex: nfeProcessor.ts) exigem variáveis de ambiente na hora
// do IMPORT — supabase.ts lança erro se SUPABASE_URL/SUPABASE_SERVICE_KEY não
// existirem, mesmo que o teste em questão nunca chame o banco de verdade.
//
// Os valores aqui são FALSOS de propósito — só para o módulo não explodir ao
// carregar. NÃO carregar o .env real: SUPABASE_SERVICE_KEY é a chave que
// ignora toda regra de permissão do banco (lê/escreve em qualquer tabela de
// produção). Se um teste futuro chamar o Supabase/Anthropic de verdade sem
// simular (mock), ele tem que FALHAR alto e claro — não gravar dado real na
// fazenda do dono em silêncio.
process.env.SUPABASE_URL          ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_KEY  ??= 'chave-fake-so-para-o-modulo-nao-explodir'
process.env.ANTHROPIC_API_KEY     ??= 'chave-fake-so-para-o-modulo-nao-explodir'
