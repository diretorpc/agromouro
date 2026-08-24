import { mensagemErroBanco, type ErroSupabase } from '@/lib/erros-supabase'
import { normalizarCultura } from '@/lib/cultura'
import { parseNumeroBR } from '@/lib/numeros-br'
import type { Talhao } from '@/lib/types'

// Regras de gravação do talhão, isoladas da tela para poderem ser testadas.
// O que motivou este arquivo: o INSERT ia sem `fazenda_id` — coluna NOT NULL
// (supabase/migrations/001_multi_fazenda.sql, passo 5) e exigida pelo
// WITH CHECK da policy `talhoes_tenant`. O banco recusava e a tela mostrava
// "Erro ao salvar. Tente novamente.", escondendo o motivo real.

export interface FormTalhao {
  nome: string
  area_ha: string
  cultura_atual: string
  status: Talhao['status']
  arrendatario: string
}

export interface PayloadTalhao {
  nome: string
  area_ha: number
  status: Talhao['status']
  cultura_atual: string | null
  arrendatario: string | null
  fazenda_id?: string
}

export type PreparoTalhao =
  | { ok: true; payload: PayloadTalhao }
  | { ok: false; erro: string }

/**
 * Valida o formulário e monta o payload que vai para o Supabase.
 * `editId` null = criação; preenchido = edição.
 */
export function prepararTalhao(
  form: FormTalhao,
  fazendaAtivaId: string | null,
  editId: string | null,
): PreparoTalhao {
  const nome = form.nome.trim()
  // `parseNumeroBR` e não `parseFloat`: o produtor digita "450,5" e cola
  // "1.234,56" do Excel — o parseFloat cru leria 450 e 1.234, sem reclamar.
  // É o mesmo defeito já medido em produção neste repo (ver lib/numeros-br.ts).
  const area = parseNumeroBR(form.area_ha)

  if (!nome) return { ok: false, erro: 'Nome é obrigatório.' }
  if (area === null || area <= 0) return { ok: false, erro: 'Área deve ser um número positivo.' }

  const base: PayloadTalhao = {
    nome,
    area_ha: area,
    status: form.status,
    cultura_atual: normalizarCultura(form.cultura_atual),
    // Só `.trim()`, sem minusculizar: nome próprio. E zerado fora do status
    // arrendado, senão o INSERT bate na CHECK do banco.
    arrendatario: form.status === 'arrendado' ? (form.arrendatario.trim() || null) : null,
  }

  // Edição NÃO repassa fazenda_id: reescrevê-lo com a fazenda ativa moveria o
  // talhão de fazenda em silêncio se o usuário tivesse trocado de fazenda.
  if (editId) return { ok: true, payload: base }

  // Criação precisa dele. Sem fazenda ativa carregada, nem tenta gravar —
  // o banco recusaria e o usuário levaria um erro sem explicação.
  if (!fazendaAtivaId) {
    return { ok: false, erro: 'Nenhuma fazenda ativa selecionada. Recarregue a página e tente de novo.' }
  }

  return { ok: true, payload: { ...base, fazenda_id: fazendaAtivaId } }
}

/** Mensagem de erro do salvar — motivo real do banco, em português de produtor. */
export function mensagemErroSalvar(error: ErroSupabase | null): string {
  if (!error) return ''
  return `Não foi possível salvar. ${mensagemErroBanco(error, 'talhão')}`
}

/** Mensagem de erro do excluir — 23503 aqui tem causa específica: operações vinculadas. */
export function mensagemErroExcluir(error: ErroSupabase | null): string {
  if (!error) return ''
  if (error.code === '23503') {
    return 'Este talhão possui operações vinculadas e não pode ser excluído.'
  }
  return `Não foi possível excluir. ${mensagemErroBanco(error, 'talhão')}`
}

/**
 * Detecta a gravação que "deu certo" sem tocar em nenhuma linha.
 * Acontece quando a RLS filtra a linha no USING: supabase-js devolve
 * `{ error: null, data: [] }` e o usuário acha que salvou.
 * Só funciona em consulta com `.select()` — sem ele o PostgREST responde 204
 * e `data` vem null mesmo quando a gravação aconteceu.
 */
export function gravouNada(error: ErroSupabase | null, data: unknown[] | null): boolean {
  return !error && (!data || data.length === 0)
}
