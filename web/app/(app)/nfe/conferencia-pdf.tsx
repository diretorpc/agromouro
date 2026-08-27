'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Trash2, AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { CATEGORIAS_FINANCEIRAS } from '@/lib/centro-custo'
import { aplicarFamiliaATodos, cfopAposEscolha, sinaisDeNotaDeProduto, itemTrancado, linhasSemQuantidade, pendenciasDeCfop, podeGravar, travaDeDuplicidade, congelarLeitura, type FamiliaItem, type NotaComoLida, type NotasNoBanco } from './regras-conferencia'

// Toda a UI do modo "Upload PDF" mora aqui, fora de page.tsx (que já passa de
// 700 linhas). O fluxo tem DOIS passos porque a leitura é da IA, não do dado
// fiscal: primeiro LER (não grava nada), depois CONFERIR e gravar.
//
// A conferência não é enfeite: um dígito errado no número ou no CNPJ fura o
// índice único da nota, e quando a mesma nota chegar pelo Make o estoque e o
// gasto contam duas vezes, calados.

type ItemLido = {
  descricao:      string
  // `null` = a nota não traz quantidade impressa (NFS-e não tem a coluna). O
  // `1` é fabricado só no servidor, na conversão — nunca guardado aqui.
  quantidade:     number | null
  unidade:        string
  valorUnitario:  number
  valorTotal:     number
  quantidadeTrib: number | null
  unidadeTrib:    string
  ncm:            string
  cfop:           string
  // Escolha do dono, não leitura do papel: o DANFE não traz centro de custo.
  // '' = "o sistema decide" (a tela Financeiro cai em insumos.tipo ?? 'outro').
  centroCusto?:   string
  // Qual família de efeito o CFOP lido representa, calculada pela API
  // (contas/cfop.ts). Vazia quando o CFOP não foi lido — aí o dono escolhe.
  // Só existe na tela: o servidor reconstrói o item a partir do `cfop`.
  familia?:       string
  // O CFOP tal como a IA leu, ANTES de qualquer escolha do dono — congelado
  // pela rota no instante da leitura (routes/nfe.ts). Achado [baixo] do
  // Apolo, 3ª rodada (24/08/2026): sem isto, um item sem CFOP em que o dono
  // escolhe "Compra normal" (grava 5102) imprimia "CFOP 5102" embaixo do
  // select, idêntico ao que teria sido lido de verdade — a tela não tinha
  // como distinguir leitura de edição, o mesmo papel que `lidoOriginal` já
  // cumpre para número/CNPJ.
  cfopLido?:      string
}

// Efeitos que a tela oferece, em português de produtor, e o tipo `FamiliaItem`
// (com `contaComoCompra`) moram em regras-conferencia.ts — as mesmas duas
// funções puras que fazem a conta de CFOP e a trava do botão.

type DuplicataLida = { numero: string; vencimento: string | null; valor: number | null }

type NotaLida = {
  modelo:             'nfe' | 'nfse'
  numero:             string
  emitenteNome:       string
  emitenteCnpj:       string
  dataEmissao:        string
  valorTotal:         number
  formaPagamento:     string | null
  // O texto CRU que a IA leu no quadro de pagamento, antes da normalização
  // que recusa tudo que não é código puro (notaPdf.ts). Achado [alto] do
  // Apolo, 3ª rodada (24/08/2026): quando `formaPagamento` vira null, a tela
  // não tinha como mostrar ao dono O QUE sumiu.
  formaPagamentoLido: string | null
  duplicatas:         DuplicataLida[]
  itens:              ItemLido[]
}

type NotaNoBanco = { id: string; numero: string; data_emissao: string; emitente_nome: string }

type RespostaLeitura = {
  status: 'nota'
  nota: NotaLida
  itensDescartados: number
  duplicatasDescartadas: number
  jaExiste: NotaNoBanco | null
  // Nota com o mesmo número e CNPJ gravada no OUTRO modelo (NF-e x NFS-e).
  // Aviso, não bloqueio: se a IA classificou errado, as duas travas de
  // duplicidade procuram no modelo errado e a compra entra duas vezes.
  existeNoOutroModelo?: NotaNoBanco | null
  // As duas consultas, por modelo. Ausente quando a API é mais velha que esta
  // tela — `travaDeDuplicidade` cai no legado e trava nos dois modelos.
  notasNoBanco?: NotasNoBanco | null
  familias?: FamiliaItem[]
}

type RespostaGravacao = {
  status: 'gravada' | 'duplicada-nota' | 'duplicada-arquivo'
  nota?: NotaNoBanco
}

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

// Mesmo teto do leitor (LIMITE_MB em api/src/services/nfe/notaPdf.ts) e do
// bucket. Barrar AQUI é o que dá mensagem em português: acima de ~11,3 MB o
// corpo estoura o body-parser da API antes de a rota rodar, e o dono lê
// "Erro interno do servidor" (achado do Apolo, 24/08/2026).
const LIMITE_BYTES = 10 * 1024 * 1024

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ddmmaaaa = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

export function ConferenciaPdf(
  { onGravada, onCancelar }: { onGravada: (dataEmissao: string) => void; onCancelar: () => void },
) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [base64, setBase64] = useState<string | null>(null)
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')
  const [leitura, setLeitura] = useState<RespostaLeitura | null>(null)
  const [nota, setNota] = useState<NotaLida | null>(null)
  // Quantas linhas o dono tirou à mão — muda o que o rodapé pode afirmar sobre
  // a diferença entre a soma dos itens e o total da nota.
  const [itensRemovidos, setItensRemovidos] = useState(0)
  // O aviso "esta nota já existe" vale para o número/CNPJ/tipo que a IA LEU.
  // Se o dono corrigir qualquer um dos três, o aviso envelheceu e não pode
  // continuar travando o botão (achado do Apolo, 24/08/2026: número lido errado
  // que casava com nota existente deixava a nota real sem caminho de entrada).

  // Foto do que a IA leu, tirada no instante em que a leitura chega — antes de
  // qualquer edição. Mostrado ao lado dos campos para o dono CONFERIR contra o
  // papel, em vez de só confiar que "o servidor recusa se for duplicata": um
  // dígito errado no CNPJ faz o servidor não achar nada e gravar a nota como
  // se fosse nova (achado do Apolo, 24/08/2026).
  // `modelo` entra aqui porque `travaDeDuplicidade` precisa saber o que a IA leu
  // no campo Tipo para distinguir a gêmea legítima da própria nota com o Tipo
  // virado à mão (achado [alto] do Apolo, 6ª rodada, 27/08/2026).
  const [lidoOriginal, setLidoOriginal] = useState<NotaComoLida | null>(null)
  // Marcado pelo dono quando a nota INTEIRA caiu fora de "compra normal" e ele
  // confirma que é isso mesmo. Ver precisaConfirmarEfeitoIncomum.
  const [confirmouEfeito, setConfirmouEfeito] = useState(false)
  // Guarda a CHAVE do que foi confirmado (tipo + número + CNPJ), não um "sim".
  // Assim a confirmação expira sozinha quando qualquer um dos três muda — sem
  // reset à mão, que é onde o `identidadeEditada` da 5ª rodada se perdeu.
  const [docDiferenteConfirmadoPara, setDocDiferenteConfirmadoPara] = useState<string | null>(null)

  function escolherArquivo(file: File) {
    setErro(''); setLeitura(null); setNota(null)
    setNomeArquivo(file.name)
    setBase64(null)
    setLidoOriginal(null)
    setConfirmouEfeito(false)
    setDocDiferenteConfirmadoPara(null)
    if (file.size > LIMITE_BYTES) {
      setErro(`Arquivo grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB). O limite é 10 MB.`)
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      // readAsDataURL devolve "data:application/pdf;base64,XXXX" — a API quer
      // só o miolo. O arquivo fica AQUI, no navegador, entre os dois passos:
      // desistir na conferência não deixa órfão no Storage.
      const url = String(e.target?.result ?? '')
      setBase64(url.split(',')[1] ?? null)
    }
    reader.onerror = () => setErro('Não consegui ler o arquivo do seu computador.')
    reader.readAsDataURL(file)
  }

  async function ler() {
    if (!base64 || !nomeArquivo) return
    setLendo(true); setErro('')
    try {
      const r = await api.post<RespostaLeitura>('/nfe/ler-pdf', { arquivo: base64, nomeArquivo })
      setLeitura(r)
      setNota(r.nota)
      setLidoOriginal(congelarLeitura(r.nota))   // CÓPIA dos 5 campos, e a marca que o tsc cobra
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao ler o PDF.')
    } finally {
      setLendo(false)
    }
  }

  async function gravar() {
    if (!nota || !base64 || !nomeArquivo) return
    setGravando(true); setErro('')
    try {
      const r = await api.post<RespostaGravacao>('/nfe/importar-pdf', { arquivo: base64, nomeArquivo, nota })
      if (r.status === 'duplicada-nota') {
        const quando = r.nota?.data_emissao ? ` (entrou em ${ddmmaaaa(r.nota.data_emissao)})` : ''
        setErro(`Esta nota já está no sistema${quando}.`)
        return
      }
      if (r.status === 'duplicada-arquivo') {
        setErro('Este mesmo PDF já foi importado antes.')
        return
      }
      // A data de emissão vai junto: quem chama usa ela para levar a lista até o
      // mês da nota. Sem isso, uma nota de mês passado nasce fora da vista —
      // foi assim que a nota 289122 (emitida em 04/07, importada em 25/08)
      // pareceu ter sumido.
      onGravada(nota.dataEmissao)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao gravar a nota.')
    } finally {
      setGravando(false)
    }
  }

  function removerItem(indice: number) {
    if (!nota) return
    setNota({ ...nota, itens: nota.itens.filter((_, n) => n !== indice) })
    setItensRemovidos(n => n + 1)
  }

  // Trocar o efeito de um item grava o CFOP representante daquela família —
  // o dono escolhe "já paguei antes", não "5117". A conta fica em
  // regras-conferencia.ts (cfopAposEscolha): mantém o CFOP lido quando a
  // família escolhida é a mesma de antes, e preserva o dígito de estado
  // (5xxx/6xxx) quando muda — um item interestadual não pode virar código
  // interno só porque o dono trocou o efeito.
  function escolherFamilia(indice: number, chave: string) {
    if (!nota) return
    const familia = leitura?.familias?.find(f => f.chave === chave)
    if (!familia) return
    // Mexer na composição da nota derruba a confirmação de efeito incomum: ela
    // valia para o conjunto que o dono conferiu, não para este novo. O
    // comentário do `confirmouEfeito` já afirmava isso, mas nada zerava o
    // estado — a caixa marcada sobrevivia a qualquer mudança posterior.
    setConfirmouEfeito(false)
    setNota({
      ...nota,
      itens: nota.itens.map((item, n) => {
        if (n !== indice) return item
        return { ...item, cfop: cfopAposEscolha(item, familia), familia: familia.chave }
      }),
    })
  }

  // O conserto de 1 clique da nota lida errado: joga TODOS os itens para
  // "compra normal". Diferente de `marcarRestantesComoCompra`, que só preenche
  // os itens SEM CFOP, este reescreve os que vieram com um CFOP lido errado —
  // o caso da nota 289122 (25/08/2026), em que 19 linhas de 5102/5405 viraram
  // 5922 e a mercadoria não entrou no estoque.
  //
  // A conta continua em `cfopAposEscolha`: item interestadual vira 6102, e um
  // item que já era compra mantém o código impresso na nota (5405 não vira 5102).
  function marcarTodosComoCompra() {
    if (!nota) return
    const compra = leitura?.familias?.find(f => f.chave === 'compra')
    if (!compra) return
    setConfirmouEfeito(false)
    setNota({ ...nota, itens: aplicarFamiliaATodos(nota.itens, compra) })
  }

  // Atalho para a nota comum (tudo é compra) — evita 30 cliques quando a coluna
  // CFOP inteira saiu borrada. É escolha EXPLÍCITA do dono, não default calado.
  function marcarRestantesComoCompra() {
    if (!nota) return
    const compra = leitura?.familias?.find(f => f.chave === 'compra')
    if (!compra) return
    setNota({
      ...nota,
      itens: nota.itens.map(item =>
        item.cfop ? item : { ...item, cfop: compra.cfop, familia: compra.chave }),
    })
  }

  // Centro de custo é o que o Financeiro usa para agrupar gasto. Item
  // não-estocável (peça, material de construção, frete) entra com insumo_id
  // nulo — sem escolher aqui, a nota inteira cai em "Outro" e o dono
  // reclassifica item por item depois, na outra tela. Pedido do Matheus na
  // primeira importação real (24/08/2026).
  function escolherCentro(indice: number, valor: string) {
    if (!nota) return
    setNota({
      ...nota,
      itens: nota.itens.map((item, n) => n === indice ? { ...item, centroCusto: valor } : item),
    })
  }

  // Nota de fornecedor costuma ser toda do mesmo centro (material de
  // construção, peça, defensivo). Um clique em vez de N.
  function aplicarCentroATodos(valor: string) {
    if (!nota || !valor) return
    setNota({ ...nota, itens: nota.itens.map(item => ({ ...item, centroCusto: valor })) })
  }

  function editar<K extends keyof NotaLida>(campo: K, valor: NotaLida[K]) {
    if (!nota) return
    // Nada de flag de "identidade editada" aqui: quem decide isso é
    // `travaDeDuplicidade`, comparando o valor ATUAL com o que a IA leu. A flag
    // pegajosa que morava aqui ligava com qualquer tecla e nunca desligava —
    // apagar um dígito e redigitar o mesmo matava o aviso de duplicidade para
    // sempre (achado [alto] do Apolo, 5ª rodada, 27/08/2026).
    setNota({ ...nota, [campo]: valor })
  }

  // ─── Passo 1: escolher o arquivo e mandar ler ─────────────────────────────
  if (!leitura || !nota) {
    return (
      <div className="space-y-4">
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Arraste o PDF da nota aqui ou <span className="text-primary font-medium">clique para selecionar</span>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) escolherArquivo(f) }}
          />
        </div>

        {nomeArquivo && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium truncate">{nomeArquivo}</span>
          </div>
        )}

        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>}

        <p className="text-xs text-muted-foreground">
          A leitura leva alguns segundos. Nada é gravado até você conferir e confirmar.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
          <Button onClick={ler} disabled={!base64 || lendo}>
            {lendo && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {lendo ? 'Lendo o PDF…' : 'Ler PDF'}
          </Button>
        </div>
      </div>
    )
  }

  // ─── Passo 2: conferir o que a IA leu e gravar ────────────────────────────
  const somaItens = nota.itens.reduce((s, i) => s + i.valorTotal, 0)

  // A soma que o rodapé pode honestamente prometer PARA O LANÇAMENTO é a dos
  // itens que CONTAM COMO GASTO — não a soma de todos os itens (`somaItens`
  // acima, usado só como comparação genérica com o total impresso, mais
  // abaixo). Achado [médio] do Apolo, 3ª rodada (24/08/2026), medido: nota com
  // 2 itens de compra (R$ 1.000 cada) + 1 bonificação (R$ 200) fazia a tela
  // imprimir R$ 2.200 exatamente no cenário em que o lançamento real
  // (processarNFe, nfeProcessor.ts) vai ser R$ 2.000. `contaComoCompra` vem
  // PRONTO de cada família (contas/cfop.ts, via a rota) — a tela não duplica a
  // regra fiscal de cabeça.
  const familiaPorChave = new Map((leitura.familias ?? []).map(f => [f.chave, f]))
  // Item com CFOP lido mas SEM família reconhecida (código de efeito próprio —
  // consignação, remessa sem compra — mostrado como texto cru na coluna "O que
  // é este item"): a tela não sabe se ele conta como compra ou não. Havendo um
  // item assim entre os restantes, nenhuma afirmação quantitativa sobre o
  // lançamento pode ser feita com certeza.
  //
  // Item SEM CFOP nenhum entra na mesma conta (achado [baixo] da 4ª rodada,
  // 24/08/2026, medido): a tela o trata como "não conta", mas o backend lê
  // efeitoDoCfop('') = COMPRA_NORMAL e o soma — R$ 800 de diferença no cenário
  // medido. Enquanto ele existir, nenhum número é confiável, então a frase cai
  // no ramo qualitativo. (A trava do botão já impede gravar nesse estado; isto
  // conserta o que a tela AFIRMA enquanto o dono ainda não escolheu.)
  const temItemSemFamiliaReconhecida = nota.itens.some(i => !i.familia)
  const itensQueContam = nota.itens.filter(i => {
    const familia = i.familia ? familiaPorChave.get(i.familia) : undefined
    return familia?.contaComoCompra === true
  })
  const somaCompra = itensQueContam.reduce((s, i) => s + i.valorTotal, 0)
  const todosOsRestantesContam = !temItemSemFamiliaReconhecida && nota.itens.length > 0
    && itensQueContam.length === nota.itens.length
  const algumRestanteConta = itensQueContam.length > 0

  // Espelha valorCompra de nfeProcessor.ts (seção 3): todosSaoCompra usa o
  // TOTAL da nota (frete/imposto incluso); algumECompra usa a soma só de quem
  // conta; sem NENHUM item de compra, o lançamento pode ainda existir se a
  // nota trouxer cobrança real (duplicata) mesmo sem item de compra — a tela
  // não tem esse dado replicado aqui de propósito (é regra de
  // contas/deNotaFiscal.ts, duplicataEhReal), então esse ramo fica só na
  // regra qualitativa. Nunca afirma o ramo `temCobrancaReal`: número errado
  // numa tela de dinheiro é pior que número ausente.
  const mensagemLancamentoAposRemocao = temItemSemFamiliaReconhecida
    ? 'O valor que vai para o Financeiro depende do CFOP de cada linha restante — confira o lançamento depois de gravar.'
    : todosOsRestantesContam
      ? `O lançamento de gasto mantém o total impresso na nota (${brl(nota.valorTotal)}), porque todas as linhas restantes contam como compra.`
      : algumRestanteConta
        ? `O lançamento de gasto passa a ser a soma só das linhas que contam como compra (${brl(somaCompra)}) — bonificação e entrega já paga não entram.`
        : 'Nenhuma linha restante conta como compra nova: o lançamento de gasto pode não ser criado, a menos que a nota traga cobrança real (duplicata) mesmo sem item de compra — confira depois de gravar.'

  // As duas pendências de CFOP moram em regras-conferencia.ts: NFS-e não tem
  // CFOP, e contar isso como pendência travava o botão de gravar sem oferecer
  // saída que não fosse carimbar um 5102 falso (achado [alto] do Apolo,
  // 27/08/2026). A confirmação vale para a composição ATUAL da nota: mudar o
  // efeito de qualquer item — ou o campo "Tipo" — recalcula, e `confirmouEfeito`
  // só destrava enquanto a situação continuar a mesma que ele confirmou.
  const { semCfop, efeitoIncomum } = pendenciasDeCfop(nota.modelo, nota.itens)
  // As duas contradições entre o papel e o campo "Tipo", nos dois sentidos.
  const pareceProduto   = sinaisDeNotaDeProduto(nota.modelo, nota.itens)
  const semQuantidade   = linhasSemQuantidade(nota.modelo, nota.itens)
  // O aviso só vale enquanto o dono não mexer na identificação da nota.
  // Os dois objetos INTEIROS, não campo a campo: ligar o fio errado aqui foi a
  // causa dos dois [alto] da 7ª rodada do Apolo (27/08/2026), e nenhum teste
  // nem o `tsc` enxergavam, porque os candidatos tinham o mesmo tipo.
  const dup = travaDeDuplicidade({
    atual:          nota,
    lido:           lidoOriginal,
    notasNoBanco:   leitura.notasNoBanco,
    jaExisteLegado: leitura.jaExiste,
    confirmadoPara: docDiferenteConfirmadoPara,
  })
  const duplicataValendo = dup.duplicataValendo
  // API antiga não manda `familias`: sem a lista não há como oferecer o conserto,
  // e um botão que não conserta nada é pior que nenhum botão.
  const temFamiliaCompra = (leitura.familias ?? []).some(f => f.chave === 'compra')
  // O botão só mexe no que a tela deixaria mexer à mão. Contar a nota inteira
  // no rótulo prometeria um conserto que ele não faz.
  const itensQueOBotaoMuda = nota.itens.filter(i => !itemTrancado(i)).length
  const itensTrancados     = nota.itens.length - itensQueOBotaoMuda

  return (
    <div className="space-y-4">
      {/* Os três avisos de duplicidade saem todos de `travaDeDuplicidade`, que é
          função pura e testada — a decisão morava aqui dentro e foi de onde
          saíram os dois achados [alto] da 5ª rodada do Apolo (27/08/2026). */}
      {duplicataValendo && !dup.ehOMesmoDocumento && (
        <div className="rounded-md bg-red-50 text-red-700 px-3 py-2 text-sm">
          <strong>Esta nota já está no sistema</strong>
          {dup.modeloDoGemeoDesconhecido ? '' : ` como ${nota.modelo === 'nfe' ? 'nota de produto (NF-e)' : 'nota de serviço (NFS-e)'}`}
          {dup.gemeoNoModeloAtual?.data_emissao ? ` (entrou em ${ddmmaaaa(dup.gemeoNoModeloAtual.data_emissao)})` : ''}.
          {' '}Gravar de novo somaria estoque e gasto duas vezes.
          {' '}Se o número ou o CNPJ estiverem lidos errado, corrija abaixo — o sistema confere
          de novo com o número corrigido.
        </div>
      )}

      {/* A trava que vem da TROCA do Tipo precisa de texto próprio: sem ele, o
          dono troca o campo, o botão continua travado e ele não faz ideia do
          porquê. Achado [alto] do Apolo, 6ª rodada (27/08/2026): antes deste
          bloco, trocar o Tipo LIBERAVA o botão e a tela chamava o estado de
          "normal" — a mesma nota entrava uma segunda vez, sem estoque. */}
      {dup.ehOMesmoDocumento && (
        <div className="rounded-md bg-red-50 text-red-700 px-3 py-2 text-sm">
          <strong>{dup.travadoPeloTipo
            ? 'Você trocou o Tipo, mas esta nota já está gravada com o tipo original'
            : `Esta nota já está gravada como ${dup.modeloDoOutroGemeo === 'nfe' ? 'nota de produto (NF-e)' : 'nota de serviço (NFS-e)'}`}</strong>
          {' '}— mesmo número, mesmo fornecedor, mesma data e mesmo valor. É o mesmo documento.
          {dup.travadoPeloTipo ? '' : ' O campo "Tipo" desta leitura provavelmente saiu errado.'}
          {' '}Gravar assim entraria pela segunda vez, com estoque e gasto contados em dobro.
          {' '}Se a nota já gravada é que está com o tipo errado, <strong>apague ela primeiro</strong>
          {' '}na aba NF-e.
          {/* A saída de um clique. Sem ela, o par legítimo NF-e/NFS-e emitido no
              MESMO dia com o MESMO valor (peças e mão de obra rachados meio a
              meio) ficava sem caminho nenhum: os DOIS lados do campo Tipo
              travavam, e as duas saídas oferecidas no texto acima estavam
              erradas para ele — apagar a nota gravada (que é legítima) ou
              conferir o número (que está certo). Achado [médio] do Apolo, 8ª
              rodada (27/08/2026): "travar de mais custa um clique" só é verdade
              se o clique existir, e não existia. */}
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={dup.confirmacaoValendo}
              onChange={e => setDocDiferenteConfirmadoPara(e.target.checked ? dup.chaveDeConfirmacao : null)}
            />
            <span>Conferi no papel: são <strong>dois documentos diferentes</strong> com o mesmo número.</span>
          </label>
        </div>
      )}

      {dup.gemeoNoModeloAtual && dup.identidadeMudou && (
        <div className="rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-sm">
          Você corrigiu a identificação da nota. A conferência de duplicidade é refeita no
          servidor ao gravar — se ainda for a mesma nota, ela é recusada lá.
        </div>
      )}

      {/* O rótulo sai do modelo em que a gêmea foi ENCONTRADA, não do `Tipo`
          atual da tela. Com o rótulo derivado do Tipo, obedecer a este aviso
          invertia o texto dele: o dono trocava o Tipo e o banner passava a
          apontar o modelo errado, justo no clique que ele mesmo pediu. */}
      {dup.gemeoNoOutroModelo && (
        <div className="rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-sm">
          Já existe uma nota <strong>{dup.modeloDoOutroGemeo === 'nfe' ? 'de produto (NF-e)' : 'de serviço (NFS-e)'}</strong>{' '}
          com este mesmo número e fornecedor
          {dup.gemeoNoOutroModelo.data_emissao ? ` (entrou em ${ddmmaaaa(dup.gemeoNoOutroModelo.data_emissao)})` : ''}
          {typeof dup.gemeoNoOutroModelo.valor_total === 'number' && dup.gemeoNoOutroModelo.valor_total >= 0
            ? `, de ${brl(dup.gemeoNoOutroModelo.valor_total)}` : ''}.
          {' '}Data e valor diferentes dos desta nota, então são documentos diferentes — acontece
          {' '}quando o fornecedor manda peças e mão de obra separadas. Ainda assim,{' '}
          <strong>confira o campo Tipo</strong> antes de gravar.
        </div>
      )}

      {/* As duas contradições entre o papel e o campo "Tipo". Nenhuma das duas
          existia antes de a tela passar a se calar sobre CFOP em NFS-e — e sem
          elas a troca de "Tipo" virava uma saída de 1 clique que apagava todos
          os bloqueios sem deixar rastro (achados do Apolo, 27/08/2026). */}
      {pareceProduto > 0 && (
        <div className="rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-sm space-y-2">
          <p>
            <strong>Esta nota tem cara de nota de produto, mas o Tipo diz serviço.</strong>
            {' '}{pareceProduto} {pareceProduto === 1 ? 'linha traz' : 'linhas trazem'} código fiscal,
            {' '}ou quantidade com unidade de mercadoria — coisas que nota de serviço não tem.
            {' '}Gravada como NFS-e, <strong>nenhuma mercadoria desta nota entra no estoque</strong>.
            {' '}Se for nota de produto, troque o campo <strong>"Tipo"</strong> acima.
          </p>
          {/* SEM botão de conserto, de propósito — e isto contraria de propósito o
              comentário de `aplicarFamiliaATodos` ("quando a tela sabe o conserto,
              ela oferece o conserto"). Duas razões, as duas medidas pelo Apolo na
              4ª rodada (27/08/2026):
              1. O botão apagava o aviso de duplicidade e deixava a nota entrar
                 duas vezes (ver o comentário em `editar`).
              2. `sinaisDeNotaDeProduto` não tem certeza suficiente para um botão.
              E o precedente de 25/08 não se aplica: lá o conserto eram 19
              dropdowns contra 1 clique de dispensa. Aqui é UM dropdown, o campo
              "Tipo", que está logo acima nesta mesma tela. */}
        </div>
      )}

      {semQuantidade > 0 && (
        <div className="rounded-md bg-red-50 text-red-700 px-3 py-2 text-sm">
          <strong>Esta nota está marcada como produto (NF-e), mas {semQuantidade === 1 ? 'uma linha não tem' : `${semQuantidade} linhas não têm`} quantidade impressa.</strong>
          {' '}Em nota de produto a quantidade é o que entra no estoque, e o sistema não inventa
          {' '}número. Volte o Tipo para <strong>NFS-e (serviço)</strong> se for nota de serviço, ou
          {' '}leia o PDF de novo.
        </div>
      )}

      {efeitoIncomum && (
        <div className="rounded-md bg-red-50 text-red-700 px-3 py-2 text-sm space-y-2">
          <p>
            <strong>Atenção: nenhum item desta nota foi lido como compra normal.</strong>
            {' '}Isso é raro. Do jeito que está, a mercadoria <strong>não entra no estoque</strong>
            {' '}(ou entra sem custo, no caso de bonificação).
          </p>
          <p>
            Quase sempre é erro de leitura: já aconteceu em 24/08/2026 (loja de material de
            construção) e de novo em 25/08/2026 (nota de 19 itens) — nas duas o CFOP impresso
            no papel era de compra comum. Se for este o caso, conserte a nota inteira aqui:
          </p>
          {temFamiliaCompra && itensQueOBotaoMuda > 0 && (
            <>
              <button
                type="button"
                onClick={marcarTodosComoCompra}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                São todos compra normal — corrigir {itensQueOBotaoMuda} {itensQueOBotaoMuda === 1 ? 'item' : 'itens'}
              </button>
              {/* O botão grava o código representante da família (5102, ou 6102
                  num item interestadual). Ele NÃO sabe o que está impresso no
                  papel: numa nota cujo CFOP real é 5405, o gravado será 5102 —
                  mesmo efeito de estoque e de gasto, código fiscal diferente.
                  Dizer isso aqui é mais honesto que deixar o rótulo prometer
                  fidelidade que não existe (achado [médio] do Apolo). */}
              <p className="text-xs">
                Grava 5102 (compra comum) em cada linha — o efeito certo no estoque e no gasto,
                ainda que o código impresso na nota seja outro da mesma família.
                {itensTrancados > 0 && (
                  <> {itensTrancados} {itensTrancados === 1 ? 'linha fica' : 'linhas ficam'} como está:
                  {' '}são remessa ou consignação, que a tela não deixa virar compra.</>
                )}
              </p>
            </>
          )}
          {/* A caixa continua existindo para a nota que É mesmo incomum (uma
              remessa de verdade, uma bonificação inteira). Mas ela deixou de ser
              o caminho mais fácil da tela: em 25/08/2026 o conserto certo eram 19
              dropdowns um a um e a dispensa era um clique — o dono marcou a caixa,
              e nenhum item entrou no estoque. */}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={confirmouEfeito}
              onChange={e => setConfirmouEfeito(e.target.checked)}
            />
            Não é erro de leitura: conferi no papel e esta nota é isso mesmo.
          </label>
        </div>
      )}

      {(leitura.itensDescartados > 0 || leitura.duplicatasDescartadas > 0 || semCfop > 0) && (
        <div className="rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> Confira antes de gravar
          </div>
          {leitura.itensDescartados > 0 && (
            <p>{leitura.itensDescartados} item(ns) não puderam ser lidos e ficaram de fora.</p>
          )}
          {leitura.duplicatasDescartadas > 0 && (
            <p>{leitura.duplicatasDescartadas} parcela(s) de cobrança ficaram de fora.</p>
          )}
          {/* `familias` pode vir vazia/undefined quando a API é mais velha que o
              front (web novo na Vercel, API antiga no Railway — sobem separados).
              Sem família não existe escolha possível: o select só teria "— escolha
              —" e o atalho não faria nada, então travar o botão prenderia o dono
              sem saída. Mostramos o aviso antigo (sem exigir escolha) nesse caso. */}
          {semCfop > 0 && ((leitura.familias?.length ?? 0) > 0 ? (
            <p>
              {semCfop} item(ns) sem CFOP legível. <strong>Escolha na coluna "O que é este item"</strong> —
              sem escolha o sistema assume compra nova, e numa nota de entrega de pedido já pago isso
              conta o gasto duas vezes.{' '}
              <button
                type="button"
                className="underline font-medium"
                onClick={marcarRestantesComoCompra}
              >
                São todos compra normal
              </button>
            </p>
          ) : (
            <p>
              {semCfop} item(ns) sem CFOP legível — vão entrar como compra normal e somar no estoque.
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="pdf-numero">Número da nota</Label>
          <Input id="pdf-numero" value={nota.numero} onChange={e => editar('numero', e.target.value)} />
          {lidoOriginal && <p className="text-[10px] text-muted-foreground">a IA leu: {lidoOriginal.numero}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-modelo">Tipo</Label>
          <select
            id="pdf-modelo"
            className={SELECT_CLASS}
            value={nota.modelo}
            onChange={e => editar('modelo', e.target.value as 'nfe' | 'nfse')}
          >
            <option value="nfe">NF-e (produto)</option>
            <option value="nfse">NFS-e (serviço)</option>
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <Label htmlFor="pdf-emitente">Fornecedor</Label>
          <Input id="pdf-emitente" value={nota.emitenteNome} onChange={e => editar('emitenteNome', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-cnpj">CNPJ do fornecedor</Label>
          <Input id="pdf-cnpj" value={nota.emitenteCnpj} onChange={e => editar('emitenteCnpj', e.target.value)} />
          {lidoOriginal && <p className="text-[10px] text-muted-foreground">a IA leu: {lidoOriginal.emitenteCnpj}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-data">Data de emissão</Label>
          <Input id="pdf-data" type="date" value={nota.dataEmissao} onChange={e => editar('dataEmissao', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-valor">Valor total</Label>
          <Input
            id="pdf-valor"
            type="number"
            step="0.01"
            value={nota.valorTotal}
            onChange={e => editar('valorTotal', parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-1">
          <p className="text-sm font-medium">Itens ({nota.itens.length})</p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Centro de custo de todos:
            <select
              className="rounded border border-input bg-background px-2 py-1 text-xs"
              value=""
              aria-label="Aplicar um centro de custo a todos os itens"
              onChange={e => { aplicarCentroATodos(e.target.value); e.currentTarget.value = '' }}
            >
              <option value="">— escolher —</option>
              {CATEGORIAS_FINANCEIRAS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left p-2">Produto</th>
                <th className="text-right p-2">Qtd</th>
                <th className="text-left p-2">Un</th>
                <th className="text-right p-2">Total</th>
                <th className="text-left p-2">O que é este item</th>
                <th className="text-left p-2">Centro de custo</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {nota.itens.map((item, n) => (
                <tr key={n} className="border-t">
                  <td className="p-2">{item.descricao}</td>
                  {/* Quantidade inferida não pode ter a MESMA cara de quantidade
                      lida: o "1" da NFS-e não está impresso em lugar nenhum do
                      papel. Mesma doutrina de `cfopLido` logo abaixo. */}
                  <td className="p-2 text-right">
                    {item.quantidade === null
                      ? <span className="text-muted-foreground" title="A NFS-e não traz coluna de quantidade — o serviço conta como 1 na hora de gravar">não impressa</span>
                      : item.quantidade}
                  </td>
                  <td className="p-2">{item.unidade}</td>
                  <td className="p-2 text-right">{brl(item.valorTotal)}</td>
                  {/* O CFOP decide estoque, bonificação e entrega futura. Quando a
                      IA não conseguiu ler, sem escolha o item entra como COMPRA — e
                      numa nota de entrega futura isso dobra o gasto. O dono escolhe o
                      EFEITO em português; o código sai da lista que a API mandou.
                      Família fora da lista (consignação, remessa sem compra) aparece
                      como código cru: trocá-la por "compra" seria piorar. */}
                  <td className={`p-2 ${item.cfop ? '' : 'bg-amber-50'}`}>
                    {/* `itemTrancado` mora em regras-conferencia.ts porque o
                        botão de conserto em massa precisa da MESMA resposta.
                        Quando esta pergunta vivia só aqui, o botão passou por
                        cima da trava (achado [alto] do Apolo, 25/08/2026). */}
                    {nota.modelo === 'nfse' ? (
                      // Serviço não tem CFOP para escolher. Oferecer o select
                      // aqui seria oferecer o carimbo de um código que a nota
                      // não imprime — e é justamente o que travava a gravação
                      // (achado [alto] do Apolo, 27/08/2026).
                      <span className="text-muted-foreground" title="Nota de serviço: não tem CFOP, e serviço nunca entra no estoque">Serviço</span>
                    ) : itemTrancado(item) ? (
                      <span title="CFOP com efeito próprio — não mexa sem motivo">CFOP {item.cfop}</span>
                    ) : (
                      <>
                        <select
                          className={`w-full rounded border bg-background px-1 py-0.5 text-xs ${item.familia ? 'border-input' : 'border-amber-400 text-amber-800'}`}
                          value={item.familia ?? ''}
                          aria-label={`O que é o item ${item.descricao}`}
                          onChange={e => escolherFamilia(n, e.target.value)}
                        >
                          {!item.familia && <option value="">— escolha —</option>}
                          {(leitura.familias ?? []).map(f => (
                            <option key={f.chave} value={f.chave}>{f.rotulo}</option>
                          ))}
                        </select>
                        {/* `efeitoDoCfop` (api/contas/cfop.ts) devolve "compra normal"
                            para todo código FORA da tabela conhecida — inclusive 5906/
                            6906 (retirada de depósito, problema aberto no backlog: conta
                            como gasto novo sem ser). O select já preenchido some com essa
                            pista; manter o código impresso, discreto, é o que deixa o dono
                            notar um CFOP que o sistema classificou como compra sem ser.
                            SÓ imprime quando o código ainda É o que foi LIDO (cfopLido) —
                            achado [baixo] do Apolo, 3ª rodada (24/08/2026): um item que
                            veio sem CFOP e recebeu o representante da família escolhida
                            pelo dono (ex.: 5102 de "Compra normal") imprimia "CFOP 5102"
                            com a MESMA cara de um código lido de verdade. */}
                        {item.cfop && item.cfop === item.cfopLido && (
                          <span className="block text-[10px] text-muted-foreground">CFOP {item.cfop}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="p-2">
                    <select
                      className="w-full rounded border border-input bg-background px-1 py-0.5 text-xs"
                      value={item.centroCusto ?? ''}
                      aria-label={`Centro de custo do item ${item.descricao}`}
                      onChange={e => escolherCentro(n, e.target.value)}
                    >
                      {/* Vazio é opção legítima, não erro: mantém o comportamento
                          de sempre (Financeiro deriva de insumos.tipo). */}
                      <option value="">— o sistema decide —</option>
                      {CATEGORIAS_FINANCEIRAS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      onClick={() => removerItem(n)}
                      aria-label={`Remover ${item.descricao}`}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Duas frases diferentes de propósito: com item removido, dizer "a
            diferença é frete e imposto" seria mentira — e é justamente a frase
            que faria o dono não desconfiar (achado do Apolo, 24/08/2026). */}
        {itensRemovidos > 0 ? (
          <p className="text-xs text-amber-700 mt-1">
            Você removeu {itensRemovidos} linha(s). Remover linha tira o item do estoque
            <strong> e</strong> da lista do Financeiro. {mensagemLancamentoAposRemocao}{' '}
            Não use isto para descontar valor da nota.
          </p>
        ) : Math.abs(somaItens - nota.valorTotal) > 0.01 && (
          <p className="text-xs text-muted-foreground mt-1">
            Soma dos itens: {brl(somaItens)} — diferente do total da nota ({brl(nota.valorTotal)}).
            A diferença normalmente é frete e imposto, que o total já inclui.
          </p>
        )}
      </div>

      {/* Achado [alto] do Apolo, 3ª rodada (24/08/2026): a tarja
          "Conferir antes de pagar" (PREFIXO_CONFERIR, contas/deNotaFiscal.ts)
          some da conta quando a forma de pagamento vira null — e a tela nunca
          mostrava o que a IA tinha lido. Sem isto, uma nota de cartão COM
          duplicata gera a conta calada, sem o dono ter como reagir. */}
      {(nota.formaPagamento || nota.formaPagamentoLido) && (
        <p className="text-xs">
          {nota.formaPagamento ? (
            <span className="text-muted-foreground">Forma de pagamento: {nota.formaPagamento}</span>
          ) : (
            <span className="text-amber-700">
              Forma de pagamento: a IA leu «{nota.formaPagamentoLido}» e não reconheceu o código —
              esta nota vai gerar conta a pagar. Confira antes de pagar.
            </span>
          )}
        </p>
      )}

      {nota.duplicatas.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">Boletos que vão para Contas a Pagar</p>
          <ul className="text-xs space-y-1">
            {nota.duplicatas.map((d, n) => (
              <li key={n} className="flex justify-between rounded bg-muted px-2 py-1">
                <span>
                  Parcela {d.numero || n + 1} — {d.vencimento ? ddmmaaaa(d.vencimento) : 'sem vencimento lido'}
                </span>
                <span>{d.valor !== null ? brl(d.valor) : '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {erro && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
        {/* Item sem efeito escolhido TRAVA a gravação: deixar passar equivale a
            decidir "é compra" por omissão, que é o caminho do gasto dobrado. Mas
            só trava quando existe ESCOLHA possível (`familias` não vazia) — um
            botão que trava sem oferecer a ação que destrava é pior que o default
            que ele evita (achado do Apolo, 24/08/2026: API antiga sem `familias`
            deixava o dono sem nenhum caminho para gravar a nota). */}
        <Button
          onClick={gravar}
          disabled={!podeGravar({
            quantidadeItens: nota.itens.length, semCfop, familias: leitura.familias,
            linhasSemQuantidade: semQuantidade,
            duplicataValendo, gravando,
            efeitoIncomumPendente: efeitoIncomum && !confirmouEfeito,   // obrigatório: ver regras-conferencia.ts
          })}
          title={semCfop > 0 && (leitura.familias?.length ?? 0) > 0 ? 'Escolha o que é cada item marcado em amarelo' : undefined}
        >
          {gravando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {gravando ? 'Gravando…' : 'Confirmar e gravar'}
        </Button>
      </div>
    </div>
  )
}
