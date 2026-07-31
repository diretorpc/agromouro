import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // vitest.setup.ts preenche variáveis de ambiente FALSAS antes de cada
    // suíte rodar — só para módulos como supabase.ts não lançarem erro na
    // hora do import. Não carrega o .env real de propósito: a chave de
    // serviço do Supabase ignora toda permissão do banco de produção.
    setupFiles: ['./vitest.setup.ts'],
  },
})
