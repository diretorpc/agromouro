'use client'

import { useEffect, useRef, useState } from 'react'
import { DataSheetGrid } from 'react-datasheet-grid'
import 'react-datasheet-grid/dist/style.css'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FiltroColuna } from './filtro-coluna'
import { construirColunas } from './colunas-controle'
import { linhaIndoParaOLixo, podeSerDeleteDeLinha } from './deletar-linha'
import estilos from './grade-itens.module.css'
import type { ItemControleFlat, FiltrosControle, PatchItemControleFlat } from '@/lib/types'
import type { FiltrosSelecionados } from '../hooks/use-controle-itens'

// Grade totalmente editável estilo Excel (pedido do Matheus, 18/08/2026) —
// substitui `tabela-documentos.tsx` (fica no repo, sem uso, até decisão de
// limpar). Biblioteca: react-datasheet-grid — justificativa completa da
// escolha (React 19, MIT, paste/edição/teclado prontos) em
// docs/superpowers/specs/2026-08-18-controle-tabela-editavel-design.md.
//
// Decisões nº 1-4 do Matheus (célula clicável + Enter/Tab, add/apaga linha,
// colar do Excel, salva sozinho) são NATIVAS da biblioteca — o trabalho
// desta camada é só TRADUZIR o `onChange(novoValor, operacoes)` dela para
// as chamadas de API certas (editarItem/criarItem/excluirItem do hook).
//
// ⚠️ Revisão do Apolo (18/08/2026) achou 4 bloqueantes na 1ª versão deste
// arquivo — os comentários abaixo, marcados "achado N", documentam CADA UM
// e por que a correção é a que está escrita, não outra.

const DEBOUNCE_EDICAO_MS = 400

// Prefixo que identifica uma linha ainda NÃO persistida (criada localmente,
// esperando a 1ª chamada de criarItem() resolver e trocar pelo id real do
// banco). Nunca colide com um UUID de verdade — nenhum id do Postgres começa
// com este texto.
const PREFIXO_TEMP = 'temp-'

// `Operation` não é reexportado pelo pacote (só existe em seu ./types.ts
// interno) — replicado aqui em vez de importar de um caminho não público
// (react-datasheet-grid/dist/types), que pode mudar sem aviso entre versões
// menores. Formato confirmado lendo o .d.ts instalado.
type OperacaoGrade = { type: 'UPDATE' | 'DELETE' | 'CREATE'; fromRowIndex: number; toRowIndex: number }

// `SelectionWithId` é exportada por `dist/types.d.ts`, mas NÃO reexportada
// pelo pacote (índice público não a lista, diferente de `DataSheetGridRef`/
// `CellComponent`/`Column`, que são reexportadas de propósito) — mesmo
// motivo de `OperacaoGrade` acima: replicada aqui em vez de importar de um
// caminho interno.
type SelecaoComId = { min: { col: number; row: number }; max: { col: number; row: number } }

// `crypto.randomUUID()` é a Web Crypto API do NAVEGADOR (global, disponível
// em todo navegador moderno) — diferente de `crypto` do Node.js (módulo
// nativo do servidor, nunca funcionaria aqui: este é um componente
// `'use client'`, o código roda no navegador).
function novaLinhaVazia(): ItemControleFlat {
  return {
    id: `${PREFIXO_TEMP}${crypto.randomUUID()}`,
    descricao: '',
    quantidade: null,
    unidade: 'UN',
    valor_unitario: null,
    valor_total: null,
    fornecedor: null,
    numero_documento: null,
    ocorrencia_no_documento: 0,
    documento_controle_id: null,
    conta_como_compra: false,
    data_manual: null,
    insumo_id: null,
    fazenda_id: '',
    duplicata_confirmada_em: null,
    duplicata_confirmada_vezes: 0,
    duplicado: false,
    duplicadoMotivo: null,
  }
}

// Campos que a grade PODE editar — usado pra montar o PATCH (diff contra a
// baseline persistida, ver `agendarEdicao`). `conta_como_compra` NUNCA
// aparece aqui de propósito — nem a grade nem o backend deixam essa coluna
// ser tocada por edição manual (ver spec, "Trava de conta_como_compra").
const CAMPOS_EDITAVEIS = [
  'descricao', 'quantidade', 'unidade', 'valor_unitario', 'valor_total',
  'data_manual', 'fornecedor', 'numero_documento',
] as const

function diffCampos(anterior: ItemControleFlat, atual: ItemControleFlat): PatchItemControleFlat {
  const patch: PatchItemControleFlat = {}
  for (const campo of CAMPOS_EDITAVEIS) {
    if (anterior[campo] !== atual[campo]) (patch as any)[campo] = atual[campo]
  }
  return patch
}

type GradeItensProps = {
  itens: ItemControleFlat[]
  atualizarLocal: (novos: ItemControleFlat[]) => void
  filtrosDisponiveis: FiltrosControle
  filtros: FiltrosSelecionados
  onFiltrosChange: (novos: FiltrosSelecionados) => void
  temMais: boolean
  carregandoMais: boolean
  onCarregarMais: () => void
  onAbrirPdf: (documentoId: string) => void
  onEditarItem: (id: string, patch: PatchItemControleFlat) => Promise<ItemControleFlat>
  onCriarItem: (dados: PatchItemControleFlat & { descricao: string; valor_total: number }, idTemporario: string) => Promise<ItemControleFlat>
  onExcluirItem: (id: string) => Promise<void>
  onExcluirDocumento: (documentoId: string) => Promise<void>
  // Achado 1 da revisão do Apolo (18/08/2026, 3ª rodada) — CRÍTICO: sem
  // isto, uma edição recusada (400/409) ficava mostrada na tela pra sempre
  // (a grade nunca sabia que o servidor não aceitou), e como o diff sempre
  // compara contra a MESMA baseline, o campo recusado voltava em TODO
  // patch seguinte daquela linha — nada mais salvava nela até um F5
  // manual. `onReverterItem` é `substituirItem` do hook (exposto de
  // propósito) — grava de volta o ÚLTIMO VALOR CONFIRMADO pelo servidor,
  // sem remontar a grade inteira nem mexer nas outras linhas.
  onReverterItem: (id: string, valorAnterior: ItemControleFlat) => void
}

export function GradeItens({
  itens, atualizarLocal, filtrosDisponiveis, filtros, onFiltrosChange,
  temMais, carregandoMais, onCarregarMais,
  onAbrirPdf, onEditarItem, onCriarItem, onExcluirItem, onExcluirDocumento, onReverterItem,
}: GradeItensProps) {
  // ─── Autosave: baseline + patch acumulado (achado 2 da revisão do Apolo) ──
  //
  // A 1ª versão comparava `itens[i]` (a prop já atualizada OTIMISTICAMENTE a
  // cada tecla) contra a linha nova — como o estado "anterior" já incluía a
  // edição em curso, o diff da tecla seguinte não via mais o campo anterior
  // como alterado, e ele nunca era salvo. Pior: quando o PATCH da última
  // tecla respondia, a linha inteira era trocada pela versão do servidor —
  // que nunca recebeu os campos anteriores — apagando o que foi digitado
  // primeiro, sem aviso.
  //
  // Correção: `ultimoPersistidoRef` guarda a última versão CONFIRMADA pelo
  // servidor de cada linha (nunca a otimista) — o diff é SEMPRE contra ela,
  // não contra a prop `itens`. Como a baseline só muda quando o PATCH
  // resolve, recalcular o diff a cada tecla contra a MESMA baseline
  // naturalmente ACUMULA todas as mudanças em curso (não precisa de merge
  // manual) — cada campo alterado carrega sempre o valor mais recente
  // digitado, porque `diffCampos` copia direto de `atual[campo]`.
  const ultimoPersistidoRef = useRef<Map<string, ItemControleFlat>>(new Map())
  // Patch pendente por linha — o que falta mandar pro servidor. Recalculado
  // (não mesclado campo a campo) a cada edição, sempre contra a MESMA
  // baseline — ver comentário acima.
  const patchesPendentesRef = useRef<Map<string, PatchItemControleFlat>>(new Map())
  // Timer de debounce por linha (400ms — decisão nº 4, "salva sozinho" sem
  // disparar 1 PATCH por tecla).
  const timersEdicao = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Linhas com PATCH atualmente em voo — evita 2 PATCHes concorrentes pro
  // MESMO item (a resposta que chegasse por último decidiria a baseline,
  // mesmo sendo a mais velha). Enquanto em voo, uma edição nova só fica
  // acumulada em `patchesPendentesRef`; o disparo é reagendado pro fim do
  // voo atual, não cancelado.
  const emVooRef = useRef<Set<string>>(new Set())

  // ─── Portão de escopo do "Delete apaga a linha" (achados 1-3 da revisão
  // do Apolo, 18/08/2026, 5ª rodada) ──────────────────────────────────────
  //
  // A 1ª versão de `linhaIndoParaOLixo` só olhava o RESULTADO (todos os 8
  // campos vazios) — sem saber COMO a linha chegou nesse estado. Isso
  // acertava o gesto travado pelo Matheus (selecionar 1 linha inteira +
  // Delete) mas também disparava em 3 cenários que ele NUNCA pediu:
  //   1. [CRÍTICO] Ctrl+A + Delete: seleciona TODAS as linhas carregadas
  //      (até 500), `deleteSelection` da lib limpa as 8 colunas de TODAS
  //      elas num único `UPDATE` — cada uma bate na assinatura de "vazia" e
  //      seria apagada. N × DELETE físico numa combinação de teclas.
  //   2. Colar um bloco de 8 colunas em branco do Excel sobre uma linha —
  //      o caminho de paste da lib não passa pelo pré-teste de "já está
  //      vazia" que o Delete tem, vai direto pro UPDATE.
  //   3. `Ctrl+X` (recortar) — a lib desliga o "smart delete" de propósito
  //      nesse gesto (`deleteSelection(false)`), mas a detecção por
  //      RESULTADO não sabia disso e apagava a linha assim mesmo.
  //   4. Delete numa FAIXA PARCIAL de células (ex.: só Produto..V.Total)
  //      de uma linha "magra" (avulsa, com só Produto+V.Total preenchidos)
  //      — os outros campos já nascem vazios, e limpar só esses dois já
  //      fecha a assinatura completa.
  //
  // Correção: exigir DUAS condições ALÉM do resultado, as duas medidas
  // pelo Apolo direto no código real da lib —
  //   (a) a op do `onChange` cobre EXATAMENTE 1 linha
  //       (`toRowIndex - fromRowIndex === 1`) — mata o Ctrl+A;
  //   (b) a SELEÇÃO no momento do gesto cobre a linha INTEIRA
  //       (`min.col === 0 && max.col >= 7`, via `onSelectionChange` — a
  //       prop existe nesta versão, `types.d.ts:169`) — mata a faixa
  //       parcial (achado 3);
  //   (c) o gesto foi de fato a TECLA Delete/Backspace, não paste nem
  //       cut — capturado num `onKeyDownCapture` no wrapper (fase de
  //       CAPTURA, corre ANTES do handler interno da lib, garantindo que o
  //       `ref` já está `true` quando `handleChange` roda na mesma
  //       distribuição síncrona do evento) — mata paste-de-vazio (achado 2)
  //       e Ctrl+X (que nem dispara keydown de Delete/Backspace).
  // As três precisam bater JUNTAS; qualquer uma fora do lugar cai no
  // caminho normal (agendarEdicao → PATCH → 400 → reverte+marca, achado 2
  // da rodada anterior — destino seguro, não destrutivo).
  const teclaDeleteAtivaRef = useRef(false)
  const selecaoAtualRef = useRef<SelecaoComId | null>(null)

  function handleKeyDownCapture(e: React.KeyboardEvent) {
    teclaDeleteAtivaRef.current = e.key === 'Delete' || e.key === 'Backspace'
  }

  // Seed da baseline pra toda linha NOVA que aparecer (carga inicial,
  // "carregar mais", ou linha recém-criada reconciliada com o id real do
  // servidor) — só ADICIONA quando o id ainda não existe; NUNCA sobrescreve
  // uma linha já rastreada. Isso importa porque uma edição otimista local
  // (via `atualizarLocal`) também muda a prop `itens` — sobrescrever aqui
  // destruiria a baseline exatamente no momento em que o diff mais precisa
  // dela. Reload completo (troca de filtro, `recarregar()`) não passa por
  // aqui: `page.tsx` remonta este componente inteiro nesse caso (`key`
  // ligada a `versaoDados` do hook), o que já reseta este `ref` sozinho.
  useEffect(() => {
    for (const item of itens) {
      if (!ultimoPersistidoRef.current.has(item.id)) {
        ultimoPersistidoRef.current.set(item.id, item)
      }
    }
  }, [itens])

  // Ids em processo de CRIAÇÃO — evita disparar criarItem() duas vezes pra
  // MESMA linha temporária enquanto a 1ª chamada ainda está em voo.
  const criandoIds = useRef<Set<string>>(new Set())
  // Ids temporários cuja última tentativa de criação FALHOU — achado 7:
  // antes a linha sumia da tela sem aviso nenhum na falha; agora fica
  // visível, marcada, e a próxima edição tenta de novo.
  const [idsComErroCriacao, setIdsComErroCriacao] = useState<Set<string>>(new Set())
  // Ids de linhas JÁ EXISTENTES cuja última tentativa de EDIÇÃO falhou com
  // erro de validação (4xx — ex.: 409 de conflito de duplicidade ao
  // esvaziar a descrição de duas linhas iguais no mesmo documento; ver
  // migration 018). Bug relatado pelo Matheus, 18/08/2026: antes, QUALQUER
  // falha de PATCH chamava `recarregar()` (use-controle-itens.ts), que
  // remonta a grade inteira e desfaz TUDO que estivesse sendo digitado em
  // qualquer outra célula — parecia "a página recarregar e o produto
  // voltar". Agora só falha de REDE/5xx recarrega; erro de validação marca
  // SÓ esta linha, sem mexer no resto.
  const [idsComErroEdicao, setIdsComErroEdicao] = useState<Set<string>>(new Set())

  // Diálogo de confirmação de exclusão de DOCUMENTO (não item) — mesmo
  // padrão de `tabela-documentos.tsx` (achado 3): erro mostrado DENTRO do
  // diálogo, não em `erroAcao` da página, porque é uma ação destrutiva e o
  // usuário precisa ver o motivo sem perder o contexto de qual documento.
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<{ documentoId: string; item: ItemControleFlat } | null>(null)
  const [excluindoDocumento, setExcluindoDocumento] = useState(false)
  const [erroExcluirDocumento, setErroExcluirDocumento] = useState<string | null>(null)

  function fecharConfirmacaoExclusao() {
    if (excluindoDocumento) return
    setConfirmandoExclusao(null)
    setErroExcluirDocumento(null)
  }

  async function confirmarExclusaoDocumento() {
    if (!confirmandoExclusao) return
    setExcluindoDocumento(true)
    setErroExcluirDocumento(null)
    try {
      await onExcluirDocumento(confirmandoExclusao.documentoId)
      setConfirmandoExclusao(null)
    } catch (err) {
      setErroExcluirDocumento(err instanceof Error ? err.message : 'Não foi possível excluir o documento agora.')
    } finally {
      setExcluindoDocumento(false)
    }
  }

  // Dispara o PATCH acumulado pra uma linha — respeita `emVooRef` (não
  // manda 2 PATCHes concorrentes pro mesmo item).
  function dispararSalvar(id: string) {
    if (emVooRef.current.has(id)) {
      // Já tem PATCH em voo — reagenda pro fim dele (o `.finally()` abaixo
      // chama `dispararSalvar` de novo se sobrar algo pendente), não cria
      // um segundo timer concorrente.
      return
    }
    const patch = patchesPendentesRef.current.get(id)
    if (!patch || Object.keys(patch).length === 0) {
      patchesPendentesRef.current.delete(id)
      return
    }
    patchesPendentesRef.current.delete(id)
    emVooRef.current.add(id)
    onEditarItem(id, patch)
      .then(itemServidor => {
        // Baseline nova = o que o servidor CONFIRMOU — não o que a grade
        // mostra localmente (pode já ter mudado de novo enquanto este PATCH
        // estava em voo).
        ultimoPersistidoRef.current.set(id, itemServidor)
        setIdsComErroEdicao(atual => {
          if (!atual.has(id)) return atual
          const novo = new Set(atual); novo.delete(id); return novo
        })
      })
      .catch(() => {
        // Erro já fica em `erroAcao` (hook mostra a mensagem no topo da
        // página).
        //
        // Achado 1 da revisão do Apolo (18/08/2026, 3ª rodada) — CRÍTICO,
        // regressão da correção anterior: marcar a linha de erro SEM
        // reverter deixava a tela MENTINDO — mostrando um valor que o
        // banco RECUSOU (400/409), e como `agendarEdicao` sempre compara
        // contra a MESMA baseline, o campo recusado reaparecia em TODO
        // patch seguinte daquela linha: nada mais salvava nela até um F5
        // manual. Pior que o `recarregar()` de antes, que pelo menos
        // corrigia a mentira.
        const pendente = patchesPendentesRef.current.get(id)
        if (pendente && Object.keys(pendente).length > 0) {
          // Já existe um patch MAIS NOVO acumulado (o usuário editou de
          // novo enquanto este PATCH estava em voo) — não reverte: o
          // `.finally()` logo abaixo já vai disparar esse patch mais novo
          // na sequência, usando o valor mais recente. Reverter aqui só
          // criaria um pisca-pisca (volta pro antigo, manda o novo em
          // seguida) sem ganho nenhum.
          return
        }
        const baseline = ultimoPersistidoRef.current.get(id)
        if (baseline) {
          // Achado 2 da revisão do Apolo (18/08/2026, 4ª rodada): reverter
          // SEM marcar deixava o "pisca e volta" do bug original entrar
          // pela porta nova — as células ficam em branco na hora
          // (otimista), 400ms depois voltam pro valor de antes, e SEM
          // nenhuma marca visual o único sinal era o `erroAcao` no topo,
          // que some sozinho no próximo autosave bem-sucedido de QUALQUER
          // outra linha. Reverter E marcar, não um ou outro —
          // `agendarEdicao` já limpa a marca quando o diff volta a `{}`
          // (achado 4 da rodada anterior), então ela não fica presa.
          onReverterItem(id, baseline)
          setIdsComErroEdicao(atual => new Set(atual).add(id))
        } else {
          // Não deveria acontecer (toda linha existente é "seedada" pelo
          // efeito acima) — sem baseline pra reverter, a única opção
          // honesta é marcar erro em vez de arriscar mostrar algo errado.
          setIdsComErroEdicao(atual => new Set(atual).add(id))
        }
      })
      .finally(() => {
        emVooRef.current.delete(id)
        // Algo foi digitado DURANTE o voo? Já está acumulado em
        // `patchesPendentesRef` (agendarEdicao recalculou contra a
        // baseline, ainda a mesma até este `.then()` acima rodar). Dispara
        // de novo agora que a baseline real chegou, sem esperar mais
        // 400ms — o usuário já esperou o bastante.
        if (patchesPendentesRef.current.has(id)) dispararSalvar(id)
      })
  }

  function agendarEdicao(linha: ItemControleFlat) {
    const id = linha.id
    const baseline = ultimoPersistidoRef.current.get(id)
    if (!baseline) return // defensivo — toda linha existente já foi "seedada" pelo efeito acima

    const diff = diffCampos(baseline, linha)
    if (Object.keys(diff).length === 0) {
      // Voltou exatamente ao valor original (digitou e desfez) — nada pra
      // mandar, mesmo que um timer estivesse agendado de uma edição
      // anterior que já tinha sido cancelada.
      patchesPendentesRef.current.delete(id)
      // Achado 4 da revisão do Apolo (18/08/2026, 3ª rodada): sem isto, uma
      // linha que ficou marcada de erro (PATCH recusado) continuava
      // vermelha PRA SEMPRE se o usuário digitasse de volta o valor
      // original — `diffCampos` dava `{}`, nenhum PATCH saía, e a marca
      // nunca era limpa (só o `.then()` de sucesso limpava). Digitar de
      // volta o valor que já está confirmado no servidor é, por definição,
      // "não há mais erro nenhum" — mesmo sem round-trip de rede.
      setIdsComErroEdicao(atual => {
        if (!atual.has(id)) return atual
        const novo = new Set(atual); novo.delete(id); return novo
      })
    } else {
      patchesPendentesRef.current.set(id, diff)
    }

    const timerAnterior = timersEdicao.current.get(id)
    if (timerAnterior) clearTimeout(timerAnterior)
    const timer = setTimeout(() => {
      timersEdicao.current.delete(id)
      dispararSalvar(id)
    }, DEBOUNCE_EDICAO_MS)
    timersEdicao.current.set(id, timer)
  }

  function possivelmenteCriar(linha: ItemControleFlat) {
    if (criandoIds.current.has(linha.id)) return

    // Achado 8 da revisão do Apolo (18/08/2026, 2ª rodada): `descricao` e
    // `unidade` usam `colunaTextoSemNulo()` (colunas-br.ts) agora, que NUNCA
    // devolve `null` — a coluna do PACOTE (`createTextColumn` padrão)
    // devolvia (Delete, Backspace até esvaziar, ou colar vazio), e o tipo
    // `ItemControleFlat.descricao: string` prometia algo que o RUNTIME não
    // garantia. `?? ''` continua aqui como segunda camada de defesa — barato
    // e não custa nada manter, mesmo com a correção primária já na coluna.
    const descricao = (linha.descricao ?? '').trim()

    // Mínimo pro backend aceitar (criarItemAvulsoSchema): descrição não-vazia
    // e valor_total > 0. Enquanto isso não bate, a linha fica só local —
    // digitar linha nova gera VÁRIOS onChange (um por Tab/Enter), e não faz
    // sentido gastar um POST por tecla até ela ficar "completa o bastante".
    // Decisão de escopo, 18/08/2026: diferente de EDITAR uma linha já
    // existente (que agora aceita descrição vazia — pedido explícito do
    // Matheus), CRIAR uma linha nova ainda exige pelo menos descrição +
    // valor pra virar POST — uma linha em branco na grade nunca devia gerar
    // requisição nenhuma sozinha.
    if (!descricao || linha.valor_total === null || linha.valor_total <= 0) return

    criandoIds.current.add(linha.id)
    onCriarItem({
      descricao,
      quantidade:       linha.quantidade,
      unidade:          linha.unidade || 'UN',
      valor_unitario:   linha.valor_unitario,
      valor_total:      linha.valor_total,
      data_manual:      linha.data_manual,
      fornecedor:       linha.fornecedor,
      numero_documento: linha.numero_documento,
    }, linha.id)
      .then(itemCriado => {
        ultimoPersistidoRef.current.set(itemCriado.id, itemCriado)
        setIdsComErroCriacao(atual => {
          if (!atual.has(linha.id)) return atual
          const novo = new Set(atual); novo.delete(linha.id); return novo
        })
      })
      .catch(() => {
        // Achado 7: a linha NÃO some mais (ver use-controle-itens.ts,
        // `criarItem` não remove mais em falha) — só marca visualmente. A
        // próxima edição desta linha tenta de novo automaticamente (ainda
        // é `temp-...`, continua caindo neste mesmo caminho).
        setIdsComErroCriacao(atual => new Set(atual).add(linha.id))
      })
      .finally(() => { criandoIds.current.delete(linha.id) })
  }

  // `itens` (a prop desta renderização) representa o estado ANTES desta
  // mudança — usado só pra resolver DELETE (que remove linhas do array,
  // então o id removido só existe no array ANTIGO). UPDATE não usa mais
  // `itens[i]` como baseline — ver `agendarEdicao`.
  // Cancela timer/patch pendente e chama `onExcluirItem` pra uma linha JÁ
  // EXISTENTE (nunca temp-) — extraído porque agora tem DOIS gatilhos: a
  // operação DELETE nativa da grade (selecionar linha(s) + apagar via menu,
  // ou 2ª tecla Delete numa linha já vazia — mecanismo "smart delete" da
  // biblioteca) e a detecção de "linha indo pro lixo" num UPDATE (achado 1
  // da revisão do Apolo, 18/08/2026, 4ª rodada — ver deletar-linha.ts).
  function excluirLinhaExistente(id: string) {
    const timer = timersEdicao.current.get(id)
    if (timer) { clearTimeout(timer); timersEdicao.current.delete(id) }
    patchesPendentesRef.current.delete(id)
    setIdsComErroEdicao(atual => {
      if (!atual.has(id)) return atual
      const novo = new Set(atual); novo.delete(id); return novo
    })
    onExcluirItem(id).catch(() => { /* erro já fica em erroAcao */ })
  }

  function handleChange(novoValor: ItemControleFlat[], operacoes: OperacaoGrade[]) {
    // Otimista primeiro (decisão nº 4): a grade já mostra a mudança antes de
    // qualquer chamada de rede.
    atualizarLocal(novoValor)

    // "One-shot": só vale pro onChange que está rodando ISTO agora — outro
    // gesto (paste, cut, outra tecla) já passou pelo `onKeyDownCapture` de
    // novo antes deste `onChange` disparar, ou nem passou (paste/cut não
    // emitem keydown de Delete/Backspace), então o valor aqui já reflete o
    // gesto CERTO. Zera antes do loop pra não vazar pro próximo onChange
    // caso este handler dispare de novo por outro motivo no meio do
    // caminho.
    const foiTeclaDelete = teclaDeleteAtivaRef.current
    teclaDeleteAtivaRef.current = false

    for (const op of operacoes) {
      if (op.type === 'UPDATE') {
        // Achados 1-3 da revisão do Apolo (18/08/2026, 5ª rodada): só uma
        // linha (não Ctrl+A) E seleção cobrindo a linha inteira (não faixa
        // parcial) E veio da tecla Delete/Backspace (não paste/cut) — ver
        // `podeSerDeleteDeLinha` em deletar-linha.ts (função pura,
        // testada) e o comentário completo no bloco de refs, acima.
        const gestoQualificaComoDeleteDeLinha = podeSerDeleteDeLinha({
          foiTeclaDelete,
          quantasLinhasNaOperacao: op.toRowIndex - op.fromRowIndex,
          selecao: selecaoAtualRef.current,
        })

        for (let i = op.fromRowIndex; i < op.toRowIndex; i++) {
          const linha = novoValor[i]
          if (!linha) continue
          if (linha.id.startsWith(PREFIXO_TEMP)) {
            // Linha ainda não existe no banco — UPDATE nela é "está ficando
            // completa", não "editar algo que já existia".
            possivelmenteCriar(linha)
            continue
          }
          // Decisão do Matheus: Delete na linha inteira APAGA a linha —
          // MAS só quando as 3 condições do portão acima batem juntas.
          // Sem isso, o autosave mandaria um PATCH com `valor_total: null`,
          // que o backend SEMPRE recusa (400, campo obrigatório numa linha
          // já existente) — mas esse destino (reverte+marca) é o CORRETO
          // pros gestos que não passam no portão (Ctrl+A, paste, cut,
          // faixa parcial): nenhum deles deveria apagar nada.
          if (gestoQualificaComoDeleteDeLinha && linhaIndoParaOLixo(linha)) {
            excluirLinhaExistente(linha.id)
            continue
          }
          agendarEdicao(linha)
        }
      } else if (op.type === 'DELETE') {
        for (let i = op.fromRowIndex; i < op.toRowIndex; i++) {
          const linhaRemovida = itens[i]
          if (!linhaRemovida) continue
          if (linhaRemovida.id.startsWith(PREFIXO_TEMP)) {
            const timer = timersEdicao.current.get(linhaRemovida.id)
            if (timer) { clearTimeout(timer); timersEdicao.current.delete(linhaRemovida.id) }
            patchesPendentesRef.current.delete(linhaRemovida.id)
            setIdsComErroCriacao(atual => {
              if (!atual.has(linhaRemovida.id)) return atual
              const novo = new Set(atual); novo.delete(linhaRemovida.id); return novo
            })
            continue // nunca existiu no banco
          }
          excluirLinhaExistente(linhaRemovida.id)
        }
      }
      // CREATE não precisa de ação aqui: a linha nasce vazia (ver
      // `novaLinhaVazia`/`createRow`) e só é criada de verdade no banco
      // quando o próximo UPDATE a deixar com descrição + valor — ver
      // `possivelmenteCriar`.
    }
  }

  // Extraído pra colunas-controle.tsx (achado 5 da revisão do Apolo,
  // 18/08/2026, 5ª rodada) — a MESMA função monta a lista aqui e no teste
  // (`colunas-controle.test.ts`), então uma mutação na fiação real (ex.:
  // tirar `isCellEmpty` da coluna de ações) derruba o teste, não só o
  // helper isolado.
  const columns = construirColunas(onAbrirPdf, (documentoId, item) => setConfirmandoExclusao({ documentoId, item }))

  // Prioridade de pintura quando mais de uma se aplicaria: erro (criação OU
  // edição — mais urgente, a linha pode se perder de vez se ignorada) >
  // duplicata > rascunho não-persistido > normal. Na prática erro-criação e
  // duplicata nunca coincidem (duplicata só existe em linha já persistida
  // pelo servidor), mas a ordem fica explícita mesmo assim.
  function classeDaLinha(item: ItemControleFlat): string | undefined {
    if (idsComErroCriacao.has(item.id) || idsComErroEdicao.has(item.id)) return estilos.linhaErro
    if (item.duplicado) return estilos.linhaDuplicada
    if (item.id.startsWith(PREFIXO_TEMP)) return estilos.linhaRascunho
    return undefined
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-6">
        <FiltroColuna
          label="Fornecedor"
          valores={filtrosDisponiveis.fornecedores}
          selecionados={filtros.fornecedores}
          onChange={fornecedores => onFiltrosChange({ ...filtros, fornecedores })}
        />
        <FiltroColuna
          label="Status do documento"
          valores={filtrosDisponiveis.status}
          selecionados={filtros.status}
          onChange={status => onFiltrosChange({ ...filtros, status })}
        />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Período:</span>
          <input
            type="date"
            value={filtros.dataInicio}
            onChange={e => onFiltrosChange({ ...filtros, dataInicio: e.target.value })}
            className="w-28 rounded border px-1 py-0.5 text-xs"
            aria-label="Data inicial"
          />
          <span>–</span>
          <input
            type="date"
            value={filtros.dataFim}
            onChange={e => onFiltrosChange({ ...filtros, dataFim: e.target.value })}
            className="w-28 rounded border px-1 py-0.5 text-xs"
            aria-label="Data final"
          />
        </div>
        {/* Legenda das cores — `bg-*` do Tailwind aqui, DIRETO no <span>
            (não a classe do módulo CSS): as classes de `estilos.*` só
            sobrescrevem a VARIÁVEL que `.dsg-cell`/`.dsg-row` leem (ver
            grade-itens.module.css) — aplicadas num <span> qualquer, fora da
            grade, não pintam nada, porque nada mais no CSS desta página lê
            aquela variável. */}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-100 border border-amber-200" /> Duplicata
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-100 border border-slate-300" /> Rascunho
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-100 border border-red-200" /> Erro ao salvar
        </div>
      </div>

      {/* `onKeyDownCapture` na fase de CAPTURA — corre ANTES do handler
          interno da biblioteca, então `teclaDeleteAtivaRef` já está
          atualizado quando `handleChange` roda (mesma distribuição
          síncrona do evento). Ver achados 1-3, comentário completo no
          bloco de refs acima do `handleChange`. */}
      <div onKeyDownCapture={handleKeyDownCapture}>
        <DataSheetGrid<ItemControleFlat>
          value={itens}
          onChange={handleChange}
          columns={columns}
          // Chave estável por id — sem isto, react-datasheet-grid usaria o
          // ÍNDICE do array como chave, e trocar o id temporário pelo real
          // (depois de criarItem resolver) confundiria o foco/seleção ativos.
          rowKey={({ rowData }) => rowData.id}
          createRow={novaLinhaVazia}
          rowClassName={({ rowData }) => classeDaLinha(rowData)}
          height={560}
          onSelectionChange={({ selection }: { selection: SelecaoComId | null }) => {
            selecaoAtualRef.current = selection
          }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{itens.length} {itens.length === 1 ? 'item carregado' : 'itens carregados'}{temMais ? ' — há mais' : ''}</span>
        {temMais && (
          <button
            type="button"
            onClick={onCarregarMais}
            disabled={carregandoMais}
            className={cn(
              'rounded border px-2 py-1 hover:bg-muted',
              carregandoMais && 'opacity-50',
            )}
          >
            {carregandoMais ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </div>

      <Dialog open={confirmandoExclusao !== null} onOpenChange={open => { if (!open) fecharConfirmacaoExclusao() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir documento?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Excluir o documento de{' '}
            <span className="font-medium text-foreground">
              {confirmandoExclusao?.item.fornecedor ?? confirmandoExclusao?.item.numero_documento ?? 'origem'}
            </span>
            ? Todas as linhas desta grade vinculadas a ele também são apagadas. O PDF original deixa de
            ficar acessível. Esta ação não pode ser desfeita.
          </p>
          {erroExcluirDocumento && (
            <p aria-live="polite" className="text-sm text-destructive bg-red-50 border border-red-200 rounded px-3 py-2">
              {erroExcluirDocumento}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={fecharConfirmacaoExclusao} disabled={excluindoDocumento}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmarExclusaoDocumento} disabled={excluindoDocumento}>
              {excluindoDocumento ? 'Excluindo…' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
