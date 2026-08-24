import { describe, it, expect } from 'vitest'
import {
  prepararTalhao, mensagemErroSalvar, mensagemErroExcluir, gravouNada,
  type FormTalhao,
} from './salvar-talhao'

const FORM_BASE: FormTalhao = {
  nome: '3M',
  area_ha: '450',
  cultura_atual: 'cana',
  status: 'ativo',
}

const FAZENDA = 'fazenda-mg-uuid'

describe('prepararTalhao — criação', () => {
  it('carrega fazenda_id da fazenda ativa (a ausência dele era o bug: coluna NOT NULL + WITH CHECK da policy)', () => {
    const r = prepararTalhao(FORM_BASE, FAZENDA, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.fazenda_id).toBe(FAZENDA)
  })

  it('monta o resto do payload com nome aparado, área numérica e status', () => {
    const r = prepararTalhao({ ...FORM_BASE, nome: '  3M  ' }, FAZENDA, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload).toEqual({
      nome: '3M',
      area_ha: 450,
      status: 'ativo',
      cultura_atual: 'cana',
      fazenda_id: FAZENDA,
    })
  })

  it('cultura vazia vira null, não string vazia', () => {
    const r = prepararTalhao({ ...FORM_BASE, cultura_atual: '   ' }, FAZENDA, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.cultura_atual).toBeNull()
  })

  it('sem fazenda ativa não deixa nem tentar gravar — barra com mensagem clara', () => {
    const r = prepararTalhao(FORM_BASE, null, null)
    expect(r).toEqual({
      ok: false,
      erro: 'Nenhuma fazenda ativa selecionada. Recarregue a página e tente de novo.',
    })
  })
})

describe('prepararTalhao — edição', () => {
  it('NÃO manda fazenda_id: reescrevê-lo moveria o talhão de fazenda em silêncio', () => {
    const r = prepararTalhao(FORM_BASE, FAZENDA, 'talhao-existente')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload).not.toHaveProperty('fazenda_id')
  })

  it('editar funciona mesmo sem fazenda ativa carregada — a linha já tem dono', () => {
    const r = prepararTalhao(FORM_BASE, null, 'talhao-existente')
    expect(r.ok).toBe(true)
  })
})

describe('prepararTalhao — validação', () => {
  it('nome só com espaços é recusado', () => {
    expect(prepararTalhao({ ...FORM_BASE, nome: '   ' }, FAZENDA, null))
      .toEqual({ ok: false, erro: 'Nome é obrigatório.' })
  })

  it.each(['', 'abc', '0', '-5'])('área inválida (%s) é recusada', (area_ha) => {
    expect(prepararTalhao({ ...FORM_BASE, area_ha }, FAZENDA, null))
      .toEqual({ ok: false, erro: 'Área deve ser um número positivo.' })
  })

  it('área com vírgula é lida inteira — "450,5" não pode virar 450 calado', () => {
    const r = prepararTalhao({ ...FORM_BASE, area_ha: '450,5' }, FAZENDA, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.area_ha).toBe(450.5)
  })

  it('área colada do Excel com separador de milhar não vira 1,23 ha', () => {
    const r = prepararTalhao({ ...FORM_BASE, area_ha: '1.234,56' }, FAZENDA, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.area_ha).toBe(1234.56)
  })
})

describe('mensagemErroSalvar', () => {
  it('traduz o erro exato deste bug (23502) em vez de despejar inglês na tela', () => {
    expect(mensagemErroSalvar({ code: '23502', message: 'null value in column "fazenda_id"' }))
      .toBe('Não foi possível salvar. Faltou informar a fazenda. Recarregue a página e tente de novo.')
  })

  it('sinal ruim no iPhone vira frase de produtor, não "Load failed"', () => {
    // Safari/iOS — o aparelho mais provável no campo. Chega SEM `status`, só
    // com `code: ''`, que é o discriminador de verdade (ver erros-supabase.ts).
    expect(mensagemErroSalvar({ code: '', message: 'TypeError: Load failed' }))
      .toBe('Não foi possível salvar. Sem conexão com o servidor. Verifique a internet e tente de novo.')
  })

  it('código sem tradução ainda mostra o código, para o suporte', () => {
    expect(mensagemErroSalvar({ code: 'PGRST116', message: 'no rows' }))
      .toBe('Não foi possível salvar. Erro (PGRST116): no rows')
  })

  it('sem erro, sem mensagem', () => {
    expect(mensagemErroSalvar(null)).toBe('')
  })
})

describe('mensagemErroExcluir', () => {
  it('traduz 23503 com a causa específica do talhão', () => {
    expect(mensagemErroExcluir({ code: '23503', message: 'violates foreign key constraint' }))
      .toBe('Este talhão possui operações vinculadas e não pode ser excluído.')
  })

  it('42501 vira explicação de permissão, não "permission denied"', () => {
    expect(mensagemErroExcluir({ code: '42501', message: 'permission denied' }))
      .toBe('Não foi possível excluir. Seu acesso não permite gravar nesta fazenda.')
  })
})

describe('gravouNada', () => {
  it('pega a gravação que a RLS engoliu: error null e zero linhas', () => {
    expect(gravouNada(null, [])).toBe(true)
    expect(gravouNada(null, null)).toBe(true)
  })

  it('não confunde com sucesso de verdade', () => {
    expect(gravouNada(null, [{ id: 'x' }])).toBe(false)
  })

  it('não dispara quando já existe erro explícito (esse tem mensagem própria)', () => {
    expect(gravouNada({ code: '23502' }, [])).toBe(false)
  })
})
