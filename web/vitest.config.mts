import { defineConfig } from 'vitest/config'

// Achado 6 da revisão do Apolo (18/08/2026, 3ª rodada): `web/` tinha ZERO
// arquivo de teste — dois bugs de dinheiro já passaram batido exatamente
// por isso (`parseNumeroBR`: R$ 1.234,56 virava R$ 1,23; `parseDataBR`: 1º
// de dezembro virava 12 de janeiro). Config mínima de propósito: as
// funções testadas aqui são todas PURAS (sem DOM, sem fetch de verdade),
// então o ambiente padrão 'node' do vitest já basta — nada de jsdom, nada
// de resolver de path alias (`@/...`), que inflaria a instalação à toa
// (mesma lição do achado 6 da rodada anterior: `npm install` sem cuidado
// arrastou 118 pacotes de carona). Os testes usam import RELATIVO, não
// `@/...`.
export default defineConfig({
  test: {},
})
