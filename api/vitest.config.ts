import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // O .env vive na raiz do projeto (agromouro-base/.env), não em api/ —
    // é o mesmo arquivo que `npm run dev` já usa via `--env-file=../.env`.
    // Sem isso, qualquer teste que importe um módulo que faz
    // `import { supabase } from './supabase'` quebra no carregamento do
    // arquivo (supabase.ts lança erro se as chaves não existem), mesmo que
    // o teste nunca chame nada do banco — como é o caso de parseXmlNFe.
    // `envDir` sozinho não basta: o Vite só expõe variáveis VITE_* em
    // import.meta.env; process.env precisa do dotenv explícito abaixo.
    setupFiles: ['./vitest.setup.ts'],
  },
})
