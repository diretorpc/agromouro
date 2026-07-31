// Formatação e data-base compartilhadas entre os dois avisos do módulo de
// Contas a Pagar: a linha de boleto na mensagem de "NF-e processada"
// (avisoBoleto.ts) e o resumo das 07:00 (resumo.ts). Nasceram duplicadas em
// tarefas diferentes (Task 6 e Task 7) — juntas aqui para que mudar o formato
// de moeda, de data ou o endereço do site nunca deixe as duas mensagens
// discordando no mesmo WhatsApp.

// Endereço do site. Variável de ambiente porque quem manda no domínio não sou
// eu: mudou o endereço, muda a variável — não o código.
export const APP_URL = process.env.APP_URL ?? 'https://agromouro.com.br'

export function reais(v: number | null): string {
  if (v == null) return 'valor a definir'
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function ddmm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// Data de hoje como 'YYYY-MM-DD' no fuso de São Paulo.
// NÃO usar toISOString(): ele devolve UTC e vira o dia seguinte depois das
// 21h — defeito que este projeto já teve (ver MEMORY financeiro-centro-custo).
export function hojeSaoPauloISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
