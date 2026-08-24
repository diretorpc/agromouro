import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Achado 6 da revisão do Apolo (18/08/2026, 3ª rodada): `web/` tinha ZERO
// arquivo de teste — dois bugs de dinheiro já passaram batido exatamente
// por isso (`parseNumeroBR`: R$ 1.234,56 virava R$ 1,23; `parseDataBR`: 1º
// de dezembro virava 12 de janeiro). Config mínima de propósito: as
// funções testadas aqui são todas PURAS (sem DOM, sem fetch de verdade),
// então o ambiente padrão 'node' do vitest já basta — nada de jsdom, que
// inflaria a instalação à toa (mesma lição do achado 6 da rodada anterior:
// `npm install` sem cuidado arrastou 118 pacotes de carona).
//
// CORREÇÃO 24/08/2026 (achado 5 da revisão do Apolo): este comentário dizia
// que o alias `@/...` também "inflaria a instalação". ERRADO, e medido: o
// `resolve.alias` abaixo é do próprio Vite, que já vem dentro do vitest —
// custa 2 linhas e ZERO pacote. O texto errado tinha virado lei e estava
// sendo citado como justificativa para import relativo `../../../` dentro de
// arquivo de produção. Sem o alias, `@/...` só sobrevive em `import type`
// (o transform apaga) e quebra calado em qualquer import de VALOR.
export default defineConfig({
  test: {},
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
})
