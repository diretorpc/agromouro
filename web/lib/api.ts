import { supabase } from './supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// Carrega o status HTTP junto da mensagem — achado do Matheus, 18/08/2026
// (grade editável de Controle): sem o status, quem chama `api.patch(...)`
// não tinha como distinguir "o servidor RECUSOU o pedido por um motivo de
// negócio" (400/409 — validação, conflito de duplicidade) de "a rede caiu"
// ou "o servidor quebrou" (5xx) — os dois caíam no mesmo `catch`, e um
// erro de VALIDAÇÃO acabava disparando o mesmo remédio pesado (recarregar a
// tela inteira) que só faz sentido pra falha de rede. Ver
// use-controle-itens.ts, `editarItem`.
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Erro de VALIDAÇÃO/negócio (400-499) — o servidor TERMINOU de processar o
// pedido e recusou por um motivo concreto (campo inválido, conflito de
// duplicidade...). Diferente de falha de REDE (fetch nem completou — não é
// `ApiError`, `err` é o `TypeError` que o `fetch()` lança) ou erro do
// SERVIDOR (5xx — algo quebrou do lado de lá, sem garantia nenhuma do que
// o banco recebeu). Só o primeiro caso permite confiar que "nada mudou
// além do que o pedido tentou mudar" — os outros dois exigem desconfiar do
// estado local inteiro. Função pura e exportada de propósito: testável sem
// precisar montar um `fetch` de verdade.
export function ehErroDeValidacao(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const authHeader = await getAuthHeader()

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...(options?.headers ?? {}),
    },
  })

  if (!res.ok) {
    // Usa a mensagem que o servidor mandou; sem ela, cai no código do erro.
    let mensagem = `API error: ${res.status}`
    try {
      const corpo = await res.json()
      if (corpo?.error) mensagem = corpo.error
    } catch { /* resposta sem corpo JSON — mantém a mensagem padrão */ }
    throw new ApiError(mensagem, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: (path: string) => apiFetch<void>(path, { method: 'DELETE' }),
}
