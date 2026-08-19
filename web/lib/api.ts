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

// Erro de VALIDAÇÃO/negócio de verdade — SÓ 400 (corpo recusado pelo zod)
// e 409 (conflito de duplicidade, migration 018). Achado da revisão do
// Apolo (18/08/2026, 3ª rodada): a 1ª versão desta função aceitava
// QUALQUER 4xx — inclusive 401/403 (`api/src/middleware/auth.ts:38`, token
// expirado) e 404 (item apagado em outra aba). Tratar esses como "erro de
// negócio, só marca a linha" é ERRADO: não existe "corrigir o campo e
// tentar de novo" pra um token vencido ou um item que já não existe — sem
// recarregar, o usuário fica preso digitando numa linha fantasma pra
// sempre, sem caminho de recuperação além de um F5 manual que ele não sabe
// que precisa dar. Só 400/409 são "o servidor terminou de processar e
// recusou por um motivo que EDITAR A CÉLULA resolve" — todo o resto
// (401/403/404, rede, 5xx) volta a recarregar, como era antes desta
// função existir.
export function ehErroDeValidacao(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 400 || err.status === 409)
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
