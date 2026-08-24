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
  arrendatario: '',
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
      arrendatario: null,
      fazenda_id: FAZENDA,
    })
  })

  it('cultura vazia vira null, não string vazia', () => {
    const r = prepararTalhao({ ...FORM_BASE, cultura_atual: '   ' }, FAZENDA, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.cultura_atual).toBeNull()
  })

  it('cultura é gravada normalizada — "Cana" não pode virar uma 2ª cultura', () => {
    const r = prepararTalhao({ ...FORM_BASE, cultura_atual: ' Cana ' }, FAZENDA, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.cultura_atual).toBe('cana')
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

describe('prepararTalhao — arrendamento', () => {
  it('grava o arrendatário aparado quando o status é arrendado', () => {
    const r = prepararTalhao(
      { ...FORM_BASE, status: 'arrendado', arrendatario: '  Usina Uberaba  ' },
      FAZENDA, null,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.arrendatario).toBe('Usina Uberaba')
  })

  // NÃO minusculiza: é nome próprio, e a exibição usa CSS `capitalize`, que
  // transformaria "usina de uberaba" em "Usina De Uberaba".
  it('preserva a caixa do nome — não é normalizado como a cultura', () => {
    const r = prepararTalhao(
      { ...FORM_BASE, status: 'arrendado', arrendatario: 'Usina de Uberaba' },
      FAZENDA, null,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.arrendatario).toBe('Usina de Uberaba')
  })

  it('arrendatário vazio vira null, nunca string vazia', () => {
    const r = prepararTalhao(
      { ...FORM_BASE, status: 'arrendado', arrendatario: '   ' },
      FAZENDA, null,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.arrendatario).toBeNull()
  })

  // O usuário pode digitar o arrendatário e DEPOIS trocar o status. Sem esta
  // limpeza o INSERT bate na CHECK `arrendatario is null or status = 'arrendado'`
  // e o produtor leva um erro que não fez por merecer.
  it.each(['ativo', 'pousio', 'colhido'] as const)(
    'status %s zera o arrendatário mesmo se o formulário trouxer texto',
    (status) => {
      const r = prepararTalhao(
        { ...FORM_BASE, status, arrendatario: 'Usina Uberaba' },
        FAZENDA, null,
      )
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.payload.arrendatario).toBeNull()
    },
  )

  // Este caminho só passa a ser alcançável pela tela a partir da Tarefa 4, que
  // é quem cria o campo Arrendatário. Sem zerar na edição, o UPDATE bate na
  // CHECK `arrendatario is null or status = 'arrendado'` e o produtor leva um
  // erro sem ter feito nada errado.
  it('desarrendar na EDIÇÃO zera o arrendatário', () => {
    const r = prepararTalhao(
      { ...FORM_BASE, status: 'ativo', arrendatario: 'Usina Uberaba' },
      FAZENDA, 'talhao-que-era-arrendado',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.arrendatario).toBeNull()
    expect(r.payload).not.toHaveProperty('fazenda_id')
  })
})
