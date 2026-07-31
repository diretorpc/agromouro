// Carrega o .env da raiz do projeto (agromouro-base/.env) para dentro do
// processo de teste — o mesmo arquivo que `npm run dev` já usa via
// `tsx watch --env-file=../.env`. Necessário porque alguns módulos (ex:
// nfeProcessor.ts) importam `./supabase` no topo do arquivo, e supabase.ts
// lança erro na hora do import se as chaves não existirem, mesmo quando o
// teste em questão nunca chama o banco.
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../.env') })
