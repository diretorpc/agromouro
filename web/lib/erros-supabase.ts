// Tradução única dos erros crus do Postgres/PostgREST para a linguagem do
// produtor rural. Existe em um lugar só porque o dia em que um código novo
// precisar de tradução, ele precisa aparecer em TODAS as telas de uma vez.

export interface ErroSupabase {
  code?: string
  message?: string
  /**
   * HTTP da resposta. NÃO vem dentro do objeto de erro do supabase-js — é irmão
   * dele no envelope. Quem chama precisa desestruturar `{ data, error, status }`
   * e juntar com `comStatus()`; sem isso este campo fica sempre undefined e as
   * decisões que dependem dele viram código morto.
   */
  status?: number
}

/**
 * Falha de rede não vem como exceção no supabase-js: vira um erro comum, e o
 * produtor com sinal ruim leria o inglês do runtime na tela.
 *
 * A mensagem NÃO serve de discriminador — cada runtime escreve uma frase
 * diferente para a mesma falha (medido contra host morto em 24/08/2026):
 * Chrome "Failed to fetch", Node/undici "fetch failed", Safari/iOS
 * "Load failed", Firefox "NetworkError when attempting to fetch resource.".
 * A regex sozinha deixava passar justamente o iPhone no campo.
 *
 * A ordem das checagens importa:
 * 1. `status === 0` — não houve resposta HTTP nenhuma: é rede, ponto final.
 * 2. `status >= 400` — HOUVE resposta do servidor. Não é falta de internet,
 *    mesmo sem `code`. Sem esta linha, apikey errada num deploy da Vercel
 *    (gateway devolve `{message: 'No API key found in request'}`, sem `code`)
 *    faria TODA tela dizer "verifique a internet" com a internet perfeita.
 * 3. só então o `code` vazio, para quem não repassou o status.
 */
export function ehFalhaDeConexao(error: ErroSupabase): boolean {
  if (error.status === 0) return true
  if (error.status !== undefined && error.status >= 400) return false
  if (!error.code) return true
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed/i
    .test(error.message ?? '')
}

/**
 * `entidade` entra na frase no singular e sem artigo: 'talhão', 'produto'.
 */
export function mensagemErroBanco(error: ErroSupabase, entidade: string): string {
  if (ehFalhaDeConexao(error)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  }

  // Sessão vencida e acesso negado pedem uma AÇÃO diferente de "tente de novo".
  if (error.status === 401 || error.status === 403) {
    // ...mas "entre de novo" não conserta variável de ambiente errada. O 401 do
    // gateway por apikey inválida é problema de deploy, não de login.
    return /api key/i.test(error.message ?? '')
      ? 'Erro de configuração do sistema. Avise o suporte.'
      : 'Sua sessão expirou ou o acesso foi negado. Entre de novo.'
  }

  // 5xx é servidor fora do ar. Sem esta linha, a página de erro HTML do gateway
  // (o corpo mais comum de um 502 real) seria despejada inteira na tela.
  if (error.status !== undefined && error.status >= 500) {
    return 'O servidor está fora do ar no momento. Tente de novo em alguns minutos.'
  }

  switch (error.code) {
    case '23505': return `Já existe um ${entidade} com esse nome.`
    case '23502': return 'Faltou informar a fazenda. Recarregue a página e tente de novo.'
    // Frase NEUTRA de propósito: este helper não sabe se o chamador estava
    // salvando ou excluindo. "não pode ser excluído" num erro de salvar sai
    // auto-contraditório — quem precisa da frase específica de exclusão a
    // escreve no próprio chamador (ver mensagemErroExcluir em talhoes).
    case '23503': return `Este ${entidade} está ligado a outros registros do sistema.`
    case '42501': return 'Seu acesso não permite gravar nesta fazenda.'
  }

  // Último recurso: código junto, para o suporte conseguir achar. O `code` PODE
  // estar vazio aqui — é o caso do gateway respondendo 4xx sem código do
  // Postgres. `Erro (): ...` na tela seria pior que nenhum código.
  // `|| 'sem detalhe'` e não `??`: corpo vazio de proxy chega como string vazia,
  // que o `??` deixa passar — e a tela imprimia "Erro: " e mais nada.
  const detalhe = error.message?.trim() || 'sem detalhe'
  return error.code ? `Erro (${error.code}): ${detalhe}` : `Erro: ${detalhe}`
}
