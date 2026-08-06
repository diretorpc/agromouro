export function getUrlParam(key: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(key)
}

export function setUrlParam(key: string, value: string, dflt = 'todos') {
  const p = new URLSearchParams(window.location.search)
  if (!value || value === dflt) p.delete(key)
  else p.set(key, value)
  window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname)
}

export function limparUrlParams(keys: string[]) {
  const p = new URLSearchParams(window.location.search)
  keys.forEach(k => p.delete(k))
  window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname)
}
