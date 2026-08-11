// Lista oficial de "centro de custo" (categoria de gasto) usada pela tela
// Financeiro para agrupar itens de nota fiscal e lançamentos manuais. Contas
// a Pagar também usa esta lista para sugerir categoria, assim os dois lados
// falam a mesma língua e o gráfico "Gastos por Categoria" não separa
// "Manutenção" (digitado à mão) de "manutencao" (vindo de nota fiscal) em
// duas barras.
//
// AINDA NÃO é fonte única de verdade (achado do Apolo, 11/08/2026):
// web/app/(app)/cartoes/page.tsx mantém sua própria lista com 7 categorias
// que não estão aqui (mercado, veterinario, farmacia, predial, ferragens,
// tejuco_gado, pedagio) — gasto de cartão nessas categorias aparece no
// gráfico do Financeiro com o nome cru do banco (ex: "tejuco_gado") e com o
// crachá cinza de "Outro" (CENTRO_CUSTO_STYLE não conhece as 7). A cor da
// BARRA do gráfico existe (CENTRO_CUSTO_COLOR conhece as 7) — só o rótulo
// bonito e o crachá que faltam. Também fora daqui: 'insumos', gravado
// à mão (não digitado pelo usuário) em toda conta a pagar nascida de boleto
// de NF-e (api/src/services/contas/gravarDeNota.ts) — aparece no gráfico como
// "Insumos" depois de normalizado. Unificar as listas é trabalho futuro, não
// fica pra trás nesta memória.
//
// NÃO é a mesma lista de web/lib/insumos.ts (TIPOS_INSUMO) — aquela é a
// categoria do insumo no Estoque, campo separado por decisão do Matheus
// (ver memória financeiro-centro-custo-por-item).
export const CATEGORIAS_FINANCEIRAS = [
  { value: 'herbicida', label: 'Herbicida' },
  { value: 'fungicida', label: 'Fungicida' },
  { value: 'inseticida', label: 'Inseticida' },
  { value: 'adjuvante', label: 'Adjuvante' },
  { value: 'biologico', label: 'Biológico' },
  { value: 'fertilizante_n', label: 'Fertilizante N' },
  { value: 'fertilizante_p', label: 'Fertilizante P' },
  { value: 'fertilizante_k', label: 'Fertilizante K' },
  { value: 'fertilizante_outro', label: 'Fertilizante Outro' },
  { value: 'calcario', label: 'Calcário' },
  { value: 'semente', label: 'Semente' },
  { value: 'combustivel', label: 'Combustível' },
  { value: 'lubrificante', label: 'Lubrificante' },
  { value: 'peca_maquina', label: 'Peça de Máquina' },
  { value: 'servico', label: 'Serviço' },
  { value: 'frete', label: 'Frete' },
  { value: 'operacional', label: 'Operacional' },
  { value: 'rh', label: 'Mão de Obra (RH)' },
  { value: 'royalties', label: 'Royalties' },
  { value: 'outro', label: 'Outro' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'outros', label: 'Outros (cartão)' },
] as const

export function categoriaLabel(value: string): string {
  return CATEGORIAS_FINANCEIRAS.find(t => t.value === value)?.label ?? value
}

// Subconjunto oferecido como sugestão nos formulários de Contas a Pagar —
// não a lista inteira. As categorias de insumo agrícola (herbicida,
// fertilizante, calcário...) não fazem sentido pra conta de luz ou aluguel, e
// 'outros' é rotulado explicitamente "(cartão)": sugerir essa opção numa
// conta avulsa faria o Financeiro mostrar um boleto pago como se fosse gasto
// de cartão de crédito — dado errado sobre a origem do dinheiro, não só feio.
// Achado do Apolo, 11/08/2026.
export const CATEGORIAS_CONTAS_A_PAGAR = CATEGORIAS_FINANCEIRAS.filter(c =>
  (['manutencao', 'combustivel', 'servico', 'rh', 'frete', 'alimentacao', 'royalties', 'outro'] as readonly string[]).includes(c.value)
)

// Troca cada letra acentuada pela versão sem acento (á → a, ç → c, ...) antes
// de comparar duas categorias digitadas de jeitos diferentes.
const TROCA_ACENTO: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ã: 'a',
  é: 'e', ê: 'e',
  í: 'i',
  ó: 'o', ô: 'o', õ: 'o',
  ú: 'u', ü: 'u',
  ç: 'c',
}

function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .split('')
    .map(ch => TROCA_ACENTO[ch] ?? ch)
    .join('')
}

// "energia" / "ENERGIA " / "  Energia" viram todos "Energia" — primeira letra
// de cada palavra maiúscula, sem espaço sobrando. Não mexe em acento: "Água"
// continua "Água" (só o acento ERRADO, tipo "Enérgia", continua divergindo —
// isso é erro de digitação de verdade, a sugestão do campo já ajuda a evitar).
function capitalizarPalavras(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(palavra => palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase())
    .join(' ')
}

// Casa um texto digitado à mão (ex: "Manutenção", "COMBUSTIVEL") com o value
// oficial da lista, ignorando maiúscula/minúscula e acento — sem isso, cada
// jeito diferente de digitar a mesma categoria vira um grupo novo no gráfico.
// Não encontrando nenhuma categoria oficial parecida (categoria própria de
// conta a pagar, fora da lista — ex: "Energia", "Água"), ainda assim padroniza
// espaço e caixa antes de devolver, pelo mesmo motivo: "energia" num mês e
// "Energia" no outro não pode virar duas barras no gráfico.
export function normalizarCategoria(valorLivre: string | null): string {
  // 'outro' (sem "s"), não 'outros' — este fallback só é usado por conta a
  // pagar (campo Categoria é opcional). 'outros' tem rótulo "(cartão)": um
  // boleto pago sem categoria não pode aparecer no gráfico como se fosse
  // gasto de cartão de crédito. Achado do Apolo, 11/08/2026.
  if (!valorLivre || !valorLivre.trim()) return 'outro'
  const alvo = normalizarTexto(valorLivre)
  const achado = CATEGORIAS_FINANCEIRAS.find(
    t => normalizarTexto(t.label) === alvo || normalizarTexto(t.value) === alvo
  )
  return achado ? achado.value : capitalizarPalavras(valorLivre)
}
