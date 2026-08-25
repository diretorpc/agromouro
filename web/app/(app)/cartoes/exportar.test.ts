import { describe, it, expect } from 'vitest'
import { colunasExport, nomeArquivoExport, type LancamentoCartao } from './exportar'

const ROTULO: Record<string, string> = {
  combustivel: 'Combustível',
  peca_maquina: 'Peça de Máquina',
}
const rotulo = (c: string) => ROTULO[c] ?? c

function lanc(over: Partial<LancamentoCartao> = {}): LancamentoCartao {
  return {
    id: 'x',
    data: '2026-06-15',
    descricao: 'POSTO SHELL',
    valor: 1234.56,
    categoria: 'combustivel',
    origem: 'cartao',
    cartao_id: 'c1',
    cartoes: { apelido: 'Itaú Ivan' },
    ...over,
  }
}

function celulas(l: LancamentoCartao) {
  return colunasExport(rotulo).map(c => c.valor(l))
}

describe('colunasExport', () => {
  it('espelha a ordem da tabela da tela', () => {
    expect(colunasExport(rotulo).map(c => c.header)).toEqual([
      'Data', 'Estabelecimento', 'Categoria', 'Cartão', 'Tipo', 'Valor (R$)',
    ])
  })

  it('manda valor como número, não como texto com R$', () => {
    const valor = celulas(lanc())[5]
    expect(typeof valor).toBe('number')
    expect(valor).toBe(1234.56)
  })

  it('traduz a categoria para o rótulo que aparece na tela', () => {
    expect(celulas(lanc({ categoria: 'peca_maquina' }))[2]).toBe('Peça de Máquina')
  })

  it('categoria desconhecida sai crua em vez de sumir', () => {
    expect(celulas(lanc({ categoria: 'inventada' }))[2]).toBe('inventada')
  })

  it('sem categoria e sem cartão vira célula vazia, não "null"', () => {
    const c = celulas(lanc({ categoria: null, cartoes: null }))
    expect(c[2]).toBeNull()
    expect(c[3]).toBeNull()
  })

  it('distingue lançamento manual de importado', () => {
    expect(celulas(lanc({ origem: 'manual' }))[4]).toBe('Manual')
    expect(celulas(lanc({ origem: 'cartao' }))[4]).toBe('Importado')
  })

  // O bug de fuso que já mordeu o Financeiro: lendo '2026-06-01' como UTC,
  // no Brasil (UTC-3) o dia 1º vira 31/05.
  it('não escorrega a data um dia para trás', () => {
    const d = celulas(lanc({ data: '2026-06-01' }))[0] as Date
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5)
    expect(d.getDate()).toBe(1)
  })

  it('lançamento sem data vira célula vazia em vez de Invalid Date', () => {
    expect(celulas(lanc({ data: '' }))[0]).toBeNull()
    expect(celulas(lanc({ data: 'lixo' }))[0]).toBeNull()
  })
})

describe('nomeArquivoExport', () => {
  const base = { filtroMes: 'todos', apelidoCartao: null, fazenda: null, parcial: false }

  it('sem filtro nenhum, avisa que é tudo', () => {
    expect(nomeArquivoExport(base)).toBe('cartoes-tudo.xlsx')
  })

  it('carrega o mês filtrado', () => {
    expect(nomeArquivoExport({ ...base, filtroMes: '2026-06' })).toBe('cartoes-2026-06.xlsx')
  })

  it('carrega mês e cartão juntos', () => {
    expect(nomeArquivoExport({ ...base, filtroMes: '2026-06', apelidoCartao: 'Itaú Ivan' }))
      .toBe('cartoes-2026-06-itau-ivan.xlsx')
  })

  // Windows recusa `: / \ * ? " < > |` em nome de arquivo, e o navegador
  // troca ou trunca calado. Apelido de cartão é texto livre digitado pelo
  // usuário — não dá pra confiar.
  it('limpa apelido com acento, símbolo e espaço', () => {
    expect(nomeArquivoExport({ ...base, apelidoCartao: 'Cartão N° 2 / Ivan' }))
      .toBe('cartoes-tudo-cartao-n-2-ivan.xlsx')
  })

  it('apelido só de símbolo não deixa traço solto no nome', () => {
    expect(nomeArquivoExport({ ...base, apelidoCartao: '***' })).toBe('cartoes-tudo.xlsx')
  })

  // Sem a fazenda no nome, exportar sem filtro na MG e depois na Tejuco dá
  // dois arquivos de nome idêntico e conteúdo completamente diferente.
  it('a fazenda vem primeiro e separa arquivos de fazendas diferentes', () => {
    const mg = nomeArquivoExport({ ...base, fazenda: 'MG' })
    const tejuco = nomeArquivoExport({ ...base, fazenda: 'Tejuco' })
    expect(mg).toBe('cartoes-mg-tudo.xlsx')
    expect(tejuco).toBe('cartoes-tejuco-tudo.xlsx')
    expect(mg).not.toBe(tejuco)
  })

  // Arquivo chamado "tudo" que não é tudo é pior que arquivo nenhum:
  // ninguém desconfia dele.
  it('quando a tela está truncada, o nome nunca diz só "tudo"', () => {
    const nome = nomeArquivoExport({ ...base, parcial: true, fazenda: 'MG' })
    expect(nome).toBe('cartoes-mg-parcial-tudo.xlsx')
    expect(nome).toContain('parcial')
  })
})
