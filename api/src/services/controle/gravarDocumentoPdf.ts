import { randomUUID, createHash } from 'crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../supabase'
import { lerDocumentoPdf, type DocumentoLido, type ItemDocumentoLido } from './documentoPdf'
import { normalizarFornecedor } from './normalizarFornecedor'
import { gravarContasDoContrato } from '../contas/gravarContasDoContrato'

// Grava no banco o que `documentoPdf.ts` já leu — mesmo espírito de
// gravarBoletoPdf.ts, mas com uma diferença de desenho: a LEITURA acontece
// AQUI DENTRO (não é passada pronta por quem chama), porque só depois de ler
// é que se sabe se o documento tem identidade (fornecedor + número) — e três
// dos quatro motivos de recusa (falha/não-documento/sem-itens-aproveitáveis)
// só existem no nível da leitura. Mesmo padrão de `importarXmlManual`
// (nfeManual.ts): lê e decide dentro de uma função só, devolve um status para
// quem chamou (a rota da Epic 2.3) decidir o que mostrar ao Matheus.

const BUCKET = 'controle-documentos'

export type ResultadoGravarDocumento =
  | {
      status: 'gravado'
      documentoId: string
      itensGravados: number
      itensDescartados: number
      // Quantos itens deste lote já existiam em itens_nfe (mesmo fornecedor +
      // numero_documento + descricao + valor_total de um item gravado antes —
      // ver idx_itens_nfe_dedupe_item, migration 018). Não é erro: um extrato
      // "Contas a Receber" é cumulativo por natureza, reimportar o mês
      // seguinte é o fluxo NORMAL, e a maioria das duplicatas já vai constar.
      // Separado de `itensDescartados` (que vem da LEITURA — linha ilegível)
      // porque o motivo é outro: aqui a linha foi lida certo, só já existia.
      itensDuplicados: number
      // Quantas contas a pagar nasceram deste documento. Sempre 0 para
      // extrato (o boleto dele chega por e-mail, ver deContrato.ts).
      contasCriadas: number
      // Texto pronto para mostrar na tela quando o documento entrou mas a
      // conta a pagar não — sem isto, um contrato importado "com sucesso"
      // deixaria um vencimento invisível. null quando não há o que avisar.
      avisoContas: string | null
    }
  // Repassados de `lerDocumentoPdf` sem tocar em banco nem Storage — mesmos
  // três motivos de recusa da leitura (ver documentoPdf.ts).
  | { status: 'falha'; motivo: string }
  | { status: 'nao-documento' }
  | { status: 'sem-itens-aproveitaveis'; itensDescartados: number }
  // Quarto motivo de recusa, só existe aqui: a leitura reconheceu o
  // documento, mas faltou fornecedor OU número (dataDocumento embutida no
  // número — ver `montarNumeroDocumento` em documentoPdf.ts). A migration 017
  // (constraint `dedupe_exige_identidade`) proíbe gravar sem os dois; sem
  // este status a linha estouraria o banco com erro 23514 na cara de quem
  // chamou, em vez de uma recusa com nome.
  | { status: 'sem-identidade' }
  // Dois índices únicos independentes da migration 017 — precisam de nomes
  // diferentes porque pedem ação diferente de quem sobe o PDF: "hash" é
  // literalmente o mesmo arquivo (reenvio por engano); "conteudo" é um
  // documento que a IA leu como o mesmo fornecedor+número de um já gravado
  // (extrato do mês seguinte reimportado, por exemplo).
  | { status: 'duplicada-hash' }
  | { status: 'duplicada-conteudo' }
  | { status: 'erro'; mensagem: string }

function caminhoNoBucket(fazendaId: string): string {
  // Convenção OBRIGATÓRIA da migration 017 (comentário de arquivo_path):
  // <fazenda_id>/<uuid>.pdf — travada no banco pelo constraint
  // arquivo_path_por_fazenda. Um path fora desse formato faria o INSERT
  // falhar depois do upload já feito (mais um caminho que precisaria de
  // limpeza) — construir certo aqui evita esse caso todo.
  return `${fazendaId}/${randomUUID()}.pdf`
}

// Arquivo órfão no Storage (upload feito, mas a linha em documentos_controle
// não existe ou foi desfeita) não aparece em lugar nenhum da tela — só custa
// espaço calado. Falha ao limpar é logada, não propagada: o INSERT já falhou
// por outro motivo, e é essa falha original que precisa chegar a quem chamou.
async function removerDoStorage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) {
    console.error(`[GravarDocumentoPdf] Falha ao limpar arquivo órfão do Storage (${path}):`, error.message)
  }
}

// Os dois índices únicos da migration 017 não têm nome de constraint com cara
// de "amigável" no erro do PostgREST — mas o nome do ÍNDICE aparece dentro de
// `message`/`details` ("duplicate key value violates unique constraint
// ..."). Checar pelo nome do índice, não pela ordem das colunas, porque os
// dois índices compartilham a coluna fazenda_id.
function tipoDeDuplicidade(error: { message?: string; details?: string } | null): 'hash' | 'conteudo' | null {
  const texto = `${error?.message ?? ''} ${error?.details ?? ''}`
  if (texto.includes('idx_doc_controle_hash')) return 'hash'
  if (texto.includes('idx_doc_controle_dedupe')) return 'conteudo'
  return null
}

// Número da duplicata/nota/contrato de CADA item, com fallback quando o item
// não tiver o seu próprio (ex.: contrato Mosaic, onde o "número" que existe é
// o do contrato inteiro, não de cada linha).
//
// Achado C da revisão do Apolo (rodada 3): o fallback NÃO pode ser
// `documento.numeroDocumento` — aquele número embute `dataDocumento` (a data
// de GERAÇÃO do relatório/contrato relido, ver `montarNumeroDocumento` em
// documentoPdf.ts) e MUDA a cada reimportação, mesmo quando o conteúdo é
// idêntico. Isso fazia a trava de dedupe por item (idx_itens_nfe_dedupe_item,
// migration 018) nunca disparar para item sem numeração própria — um
// contrato de R$ 250 mil reenviado duplicava o gasto inteiro, sem aviso.
// `documento.codigoCliente` é a metade ESTÁVEL do número do documento (sem a
// data embutida) — mesmo contrato, mesmo `codigoCliente`, em qualquer
// reimportação.
function numeroDocumentoDoItem(item: ItemDocumentoLido, documento: DocumentoLido): string | null {
  return item.numeroDocumento ?? documento.codigoCliente
}

// `item.data` já resolve o fallback pro documento dentro da leitura (ver
// comentário acima) — chamado aqui de novo só por defesa: se um dia
// `documentoPdf.ts` parar de aplicar esse fallback, a constraint
// `item_de_documento_completo` da migration 017 ainda precisa de uma data.
function dataManualDoItem(item: ItemDocumentoLido, documento: DocumentoLido): string | null {
  return item.data ?? documento.dataDocumento
}

// Marca o documento como 'erro' em vez de apagar a linha — usado quando pelo
// menos 1 item JÁ FOI gravado em itens_nfe apontando para este documento
// (achado A da revisão do Apolo, rodada 3): `itens_nfe_doc_controle_fk` é
// `on delete restrict` (migration 017) — um DELETE aqui seria RECUSADO
// (erro 23503), a linha sobreviveria travada mesmo assim, e o PDF já teria
// sido apagado do Storage por quem chamou achando que o desfazer tinha
// funcionado. NÃO apaga o Storage: o PDF continua sendo a prova do que foi
// parcialmente importado, e `arquivo_path` da linha ainda aponta pra ele.
// `idx_doc_controle_hash` (migration 017) é PARCIAL — `where status <>
// 'erro'` — então marcar 'erro' libera reenvio natural do mesmo arquivo
// depois que o dono corrigir o que causou a queda. `idx_doc_controle_dedupe`
// (a trava por CONTEÚDO, fornecedor+número) também precisa estar parcial da
// mesma forma pra essa liberação valer de verdade — achado da revisão do
// Apolo, rodada 4: até a migration 018 ser ajustada, `idx_doc_controle_dedupe`
// não tinha WHERE nenhum e continuava bloqueando um documento em 'erro' pelo
// conteúdo, mesmo com o hash já liberado — reenvio (arquivo igual ou novo,
// mesmo fornecedor+número) ficava preso pra sempre. O ajuste está na 018
// (ver comentário "ACHADO D" naquele arquivo) porque a 017 já rodou em
// produção uma vez. AVISO: esta frase só é verdadeira DEPOIS que a migration
// 018 (com o ajuste do ACHADO D) for de fato aplicada no Supabase — até lá,
// código e banco ficam dessincronizados e um documento marcado 'erro'
// continua preso pela trava de conteúdo.
async function marcarDocumentoComErro(documentoId: string, mensagem: string): Promise<void> {
  const { error } = await supabase
    .from('documentos_controle')
    .update({ status: 'erro', erro_mensagem: mensagem })
    .eq('id', documentoId)
  if (error) {
    // Documento fica com status desatualizado (não reflete o erro real) —
    // logar é o máximo que dá para fazer aqui: o erro original (que já vai
    // ser devolvido a quem chamou) é mais importante que este follow-up.
    console.error(`[GravarDocumentoPdf] Falha ao marcar documento ${documentoId} como erro:`, error.message)
  }
}

// Desfaz a linha em documentos_controle + o objeto no Storage — só é seguro
// chamar quando ZERO itens deste documento foram gravados em itens_nfe: com
// zero itens, a FK `itens_nfe_doc_controle_fk` (on delete restrict) não tem
// nada para reter, o DELETE funciona, e apagar o PDF do Storage não deixa
// nenhuma linha sobrevivente apontando pra um arquivo inexistente. Chame
// `marcarDocumentoComErro` em vez desta função quando houver item gravado —
// ver achado A da revisão do Apolo, rodada 3.
//
// Usado nos dois pontos onde algo pode dar errado DEPOIS do upload, mas ANTES
// de qualquer item ter sido persistido: o INSERT do documento (duplicata ou
// outro erro) e a falha "limpa" do INSERT de itens (INSERT em lote é uma
// instrução SQL só — falha atômica, zero linhas persistidas). Não é uma
// função de banco transacional — decisão do Matheus, 17/08/2026: aceitar o
// risco residual de faltar luz/rede exatamente entre os dois DELETEs, sem
// construir RPC atômica agora.
async function desfazerDocumentoSemItens(documentoId: string, arquivoPath: string): Promise<void> {
  const { error } = await supabase.from('documentos_controle').delete().eq('id', documentoId)
  if (error) {
    // Não deveria falhar aqui (nenhum item referencia esta linha ainda, a FK
    // RESTRICT não tem motivo para recusar) — mas pode falhar por outro
    // motivo (RLS, rede). Sem tratar isso à parte, o Storage seria apagado
    // de qualquer forma logo abaixo, deixando uma linha sobrevivente com
    // `arquivo_path` apontando pra um arquivo que não existe mais (o mesmo
    // problema estrutural do achado A, por outra porta). Marca 'erro' em vez
    // de seguir para o `removerDoStorage`.
    console.error(`[GravarDocumentoPdf] Falha ao apagar documento ${documentoId} (sem itens gravados):`, error.message)
    await marcarDocumentoComErro(documentoId, error.message)
    return
  }
  await removerDoStorage(arquivoPath)
}

// Persiste, na linha EXISTENTE que "absorveu" a duplicata, o sinal de
// "reencontrada numa reimportação" (migration 019, colunas
// duplicata_confirmada_em/duplicata_confirmada_vezes) — Caso 1 do desenho
// (docs/superpowers/specs/2026-08-18-controle-tabela-editavel-design.md):
// a trava de dedupe (idx_itens_nfe_dedupe_item, migration 018) BLOQUEIA a
// linha nova, mas nunca deixava rastro nenhum na linha antiga até aqui — a
// tela (GET /controle/itens) usa este sinal para pintar a linha.
//
// Busca pelas MESMAS 6 colunas do índice parcial, MENOS
// documento_controle_id (ele não faz parte da chave do índice — a mesma
// combinação (fornecedor, número, descrição, valor, ocorrência) só pode
// existir em UMA linha em toda a fazenda, não importa de qual documento).
// Falha aqui (busca ou update) é logada, não propagada: o item já foi
// corretamente tratado como duplicata pelo chamador (não gravado de novo,
// contado em `duplicados`) — este sinal extra é "nice to have", não pode
// derrubar a importação por causa dele.
async function marcarDuplicataConfirmada(item: Record<string, unknown>): Promise<void> {
  const fornecedor = item.fornecedor
  if (typeof fornecedor !== 'string') {
    // Não deveria acontecer: todo item de Controle grava `fornecedor` (ver
    // `itensParaGravar`, abaixo) — defensivo, sem ele não há como montar
    // `fornecedor_normalizado` pra buscar a linha existente.
    console.error('[GravarDocumentoPdf] marcarDuplicataConfirmada: item sem fornecedor, sinal não gravado.')
    return
  }

  const { data: existente, error: errBusca } = await supabase
    .from('itens_nfe')
    .select('id, duplicata_confirmada_vezes')
    .eq('fazenda_id', item.fazenda_id as string)
    .eq('fornecedor_normalizado', normalizarFornecedor(fornecedor))
    .eq('numero_documento', item.numero_documento as string)
    .eq('descricao', item.descricao as string)
    .eq('valor_total', item.valor_total as number)
    .eq('ocorrencia_no_documento', item.ocorrencia_no_documento as number)
    .maybeSingle()

  if (errBusca) {
    console.error('[GravarDocumentoPdf] Falha ao localizar item duplicado para marcar (busca):', errBusca.message)
    return
  }
  if (!existente) {
    // Bateu no 23505 (a trava do banco confirma que a linha existe), mas
    // esta busca em código não achou — sinal de que a normalização em
    // código (normalizarFornecedor) divergiu da coluna gerada do banco, ou
    // outra corrida rara. Loga para investigar; não é motivo de falhar a
    // importação (o item já foi corretamente contado como duplicata).
    console.error('[GravarDocumentoPdf] 23505 confirmado pelo banco, mas item existente não encontrado na busca — sinal de duplicata não gravado.')
    return
  }

  const { error: errUpdate } = await supabase
    .from('itens_nfe')
    .update({
      duplicata_confirmada_em: new Date().toISOString(),
      duplicata_confirmada_vezes: (existente.duplicata_confirmada_vezes ?? 0) + 1,
    })
    .eq('id', existente.id)

  if (errUpdate) {
    console.error('[GravarDocumentoPdf] Falha ao marcar duplicata confirmada:', errUpdate.message)
  }
}

// Caminho de fallback quando o INSERT em lote de itens_nfe falha com 23505
// (achado do Apolo — Achado 1): idx_itens_nfe_dedupe_item (migration 018) é
// um índice PARCIAL, então NÃO serve de alvo de on-conflict/upsert — a única
// forma confiável de "pular só o item duplicado, gravar o resto" é gravar um
// a um e tratar cada 23505 individualmente. Só é chamado depois que o INSERT
// em lote (o caminho rápido, sem duplicidade) já falhou — reimportar um
// extrato sem NENHUM item repetido nunca paga o custo de N round-trips.
async function inserirItensUmAUm(
  itens: Record<string, unknown>[],
): Promise<{ gravados: number; duplicados: number; erro: { message: string } | null }> {
  let gravados = 0
  let duplicados = 0

  for (const item of itens) {
    const { error } = await supabase.from('itens_nfe').insert(item)
    if (error) {
      if (error.code === '23505') {
        // Já existe uma linha idêntica (fornecedor + numero_documento +
        // descricao + valor_total) — este item específico é pulado, não o
        // lote inteiro. Não distingue aqui qual dos dois índices únicos de
        // itens_nfe bateu porque só um cobre item de PDF
        // (idx_itens_nfe_dedupe_item, migration 018) — não há ambiguidade
        // como existe em documentos_controle (que tem dois).
        duplicados++
        // Migration 019 — persiste o sinal na linha EXISTENTE, para a tela
        // (GET /controle/itens) poder pintá-la. Ver comentário da função.
        await marcarDuplicataConfirmada(item)
        continue
      }
      // Erro diferente de duplicidade (conexão, RLS, etc.) — para aqui e
      // devolve pra quem chamou decidir se desfaz o documento. Não continua
      // tentando os itens restantes: um erro de infra tende a repetir.
      return { gravados, duplicados, erro: { message: error.message } }
    }
    gravados++
  }

  return { gravados, duplicados, erro: null }
}

export async function gravarDocumentoDoPdf(
  pdf: Buffer,
  nomeArquivo: string,
  hojeISO: string,
  fazendaId: string,
  anthropic: Anthropic,
): Promise<ResultadoGravarDocumento> {
  const lido = await lerDocumentoPdf(pdf, nomeArquivo, hojeISO, anthropic)

  // Três dos quatro motivos de recusa nascem na LEITURA — nenhum toca banco
  // nem Storage. Repassa o status tal como veio; quem chamou decide o aviso.
  if (lido.status === 'falha') return { status: 'falha', motivo: lido.motivo }
  if (lido.status === 'nao-documento') return { status: 'nao-documento' }
  if (lido.status === 'sem-itens-aproveitaveis') {
    return { status: 'sem-itens-aproveitaveis', itensDescartados: lido.itensDescartados }
  }

  const documento = lido.documento

  // Quarto motivo — só existe aqui, não na leitura: documento reconhecido,
  // mas sem fornecedor OU sem número (dataDocumento embutida no número, ver
  // `montarNumeroDocumento`). A migration exige os dois para gravar
  // (`dedupe_exige_identidade`); sem este corte, o INSERT abaixo estouraria
  // com 23514 cru, depois de já ter subido o arquivo pro Storage.
  if (!documento.fornecedor || !documento.numeroDocumento) {
    return { status: 'sem-identidade' }
  }

  // sha256 do arquivo, independente da leitura por IA — é a primeira trava de
  // duplicidade (idx_doc_controle_hash), calculada antes do upload como o
  // comentário da migration 017 recomenda.
  const arquivoHash = createHash('sha256').update(pdf).digest('hex')
  const arquivoPath = caminhoNoBucket(fazendaId)

  const upload = await supabase.storage.from(BUCKET).upload(arquivoPath, pdf, {
    contentType: 'application/pdf',
    upsert: false,
  })

  if (upload.error) {
    console.error('[GravarDocumentoPdf] Falha ao subir PDF pro Storage:', upload.error.message)
    return { status: 'erro', mensagem: upload.error.message }
  }

  const insertDocumento = await supabase
    .from('documentos_controle')
    .insert({
      fornecedor:       documento.fornecedor,
      numero_documento: documento.numeroDocumento,
      data_documento:   documento.dataDocumento,
      valor_total:      documento.valorTotalDocumento,
      tipo:             documento.tipoDocumento,
      status:           'processado',
      nome_arquivo:     nomeArquivo,
      arquivo_path:     arquivoPath,
      arquivo_hash:     arquivoHash,
      fazenda_id:        fazendaId,
    })
    .select('id')
    .single()

  if (insertDocumento.error) {
    // Erro de banco no INSERT do documento sempre deixa um arquivo órfão no
    // Storage (o upload já aconteceu) — toda saída daqui pra baixo precisa
    // limpar antes de devolver.
    await removerDoStorage(arquivoPath)

    if (insertDocumento.error.code === '23505') {
      const tipo = tipoDeDuplicidade(insertDocumento.error)
      if (tipo === 'hash') {
        console.log(`[GravarDocumentoPdf] "${nomeArquivo}" já foi importado antes (mesmo arquivo) — ignorado.`)
        return { status: 'duplicada-hash' }
      }
      if (tipo === 'conteudo') {
        console.log(
          `[GravarDocumentoPdf] "${nomeArquivo}": documento ${documento.fornecedor} / ` +
          `${documento.numeroDocumento} já existe nesta fazenda — ignorado.`,
        )
        return { status: 'duplicada-conteudo' }
      }
      // 23505 sem bater com nenhum dos dois índices conhecidos — não chuta
      // qual foi; devolve erro genérico em vez de reportar duplicidade errada.
      console.error('[GravarDocumentoPdf] Violação de unicidade não reconhecida:', insertDocumento.error.message)
    }

    console.error('[GravarDocumentoPdf] Erro ao gravar documento:', insertDocumento.error.message)
    return { status: 'erro', mensagem: insertDocumento.error.message }
  }

  const documentoId = insertDocumento.data.id as string

  try {
    // Achado B da revisão do Apolo (rodada 3): a ordem de OCORRÊNCIA de cada
    // combinação idêntica de (numeroDocumentoDoItem, descricao, valorTotal)
    // DENTRO deste documento — 0 para a primeira linha com esses três
    // valores, 1 para a segunda igual, 2 para a terceira, etc. Sem isto, duas
    // linhas REAIS e distintas (mesmo produto, mesmo valor, mesma duplicata —
    // ex.: duas entregas do mesmo pedido em datas diferentes) colidiriam
    // ENTRE SI no índice de dedupe (idx_itens_nfe_dedupe_item, migration
    // 018), e a segunda seria descartada como "já existe" — perda de
    // dinheiro na conferência, não reimportação. Reimportar o MESMO
    // documento, com a MESMA multiplicidade de repetição, produz a MESMA
    // sequência de ocorrências — continua batendo como duplicata de verdade.
    const ocorrenciaPorChave = new Map<string, number>()

    const itensParaGravar = documento.itens.map(item => {
      const dataManual = dataManualDoItem(item, documento)
      if (!dataManual) {
        // Não deveria acontecer: `sem-identidade` já garante
        // `documento.numeroDocumento` não-nulo, e `montarNumeroDocumento`
        // (documentoPdf.ts) só monta esse número quando `dataDocumento`
        // também existe — então todo item chega aqui com pelo menos a data
        // do documento como fallback. Se isso mudar um dia e quebrar o
        // invariante, falha ruidosamente em vez de estourar o banco com
        // `item_de_documento_completo` (23514).
        throw new Error(`item sem data resolvível: "${item.descricao}"`)
      }

      const numeroDocumentoItem = numeroDocumentoDoItem(item, documento)
      const chaveOcorrencia = `${numeroDocumentoItem ?? ''}||${item.descricao}||${item.valorTotal}`
      const ocorrenciaNoDocumento = ocorrenciaPorChave.get(chaveOcorrencia) ?? 0
      ocorrenciaPorChave.set(chaveOcorrencia, ocorrenciaNoDocumento + 1)

      return {
        nota_fiscal_id:          null,
        descricao:               item.descricao.slice(0, 500),
        quantidade:              item.quantidade,
        unidade:                 item.unidade,
        valor_unitario:          item.valorUnitario,
        valor_total:             item.valorTotal,
        insumo_id:               null,
        fornecedor:              documento.fornecedor,
        numero_documento:        numeroDocumentoItem,
        ocorrencia_no_documento: ocorrenciaNoDocumento,
        documento_controle_id:   documentoId,
        // O TIPO decide, não a aba. Extrato de revenda (Syagri, Solos,
        // Protec) tem NF-e chegando pelo Make e some do total de propósito —
        // contar aqui dobraria o dinheiro. Contrato de fabricante (Mosaic)
        // nunca gera NF-e no sistema: é a única fonte daquele gasto, e se não
        // contar aqui não conta em lugar nenhum. Medido em 23/08/2026: zero
        // NF-e de fornecedor de adubo no banco.
        conta_como_compra:       documento.tipoDocumento === 'contrato',
        data_manual:             dataManual,
        fazenda_id:              fazendaId,
      }
    })

    let itensGravados = itensParaGravar.length
    let itensDuplicados = 0

    const insertItens = await supabase.from('itens_nfe').insert(itensParaGravar)

    if (insertItens.error) {
      if (insertItens.error.code === '23505') {
        // Pelo menos um item deste lote já existia (mesmo fornecedor +
        // numero_documento + descricao + valor_total — idx_itens_nfe_dedupe_
        // item, migration 018). O INSERT em lote é UMA instrução SQL só, e
        // um único conflito derruba TODOS os itens dele — inclusive os
        // novos, que não deveriam ser perdidos. Refaz item a item: cada
        // 23505 individual vira "pula este item específico", os demais
        // (novos) são gravados normalmente. Achado 1 da revisão do Apolo —
        // reimportar um extrato de contas a receber com duplicatas ainda em
        // aberto é o fluxo NORMAL, não um erro.
        console.log(
          `[GravarDocumentoPdf] "${nomeArquivo}": lote com item(ns) já gravado(s) antes — regravando item a item.`,
        )
        const resultado = await inserirItensUmAUm(itensParaGravar)
        if (resultado.erro) {
          // Achado A da revisão do Apolo (rodada 3): se pelo menos 1 item já
          // foi gravado com sucesso ANTES deste erro fatal, a FK RESTRICT
          // (migration 017) recusaria um DELETE de documentos_controle — não
          // tenta. Marca 'erro' e preserva o PDF (ver `marcarDocumentoComErro`).
          // Só quando ZERO itens sobreviveram até aqui (erro logo no
          // primeiro, ou todos os anteriores eram duplicata) o caminho
          // "limpo" (DELETE + apagar Storage) continua correto e seguro.
          if (resultado.gravados > 0) {
            console.error(
              `[GravarDocumentoPdf] Erro ao gravar itens (item a item), com ${resultado.gravados} já ` +
              'gravado(s) antes — marcando documento como erro (FK impede desfazer):',
              resultado.erro.message,
            )
            await marcarDocumentoComErro(documentoId, resultado.erro.message)
          } else {
            console.error(
              '[GravarDocumentoPdf] Erro ao gravar itens (item a item), nenhum gravado ainda — desfazendo documento:',
              resultado.erro.message,
            )
            await desfazerDocumentoSemItens(documentoId, arquivoPath)
          }
          return { status: 'erro', mensagem: resultado.erro.message }
        }
        itensGravados = resultado.gravados
        itensDuplicados = resultado.duplicados
      } else {
        // INSERT em lote é UMA instrução SQL só — falhou antes de persistir
        // qualquer linha (nenhum item deste documento existe em itens_nfe
        // ainda), então o caminho "limpo" é seguro aqui.
        console.error('[GravarDocumentoPdf] Erro ao gravar itens — desfazendo documento:', insertItens.error.message)
        await desfazerDocumentoSemItens(documentoId, arquivoPath)
        return { status: 'erro', mensagem: insertItens.error.message }
      }
    }

    console.log(
      `[GravarDocumentoPdf] "${nomeArquivo}" gravado: ${documento.fornecedor} / ${documento.numeroDocumento}, ` +
      `${itensGravados} item(ns) novo(s), ${itensDuplicados} já existente(s), ` +
      `${documento.itensDescartados} descartado(s) na leitura.`,
    )

    // Depois dos itens, nunca antes: uma conta a pagar apontando para um
    // documento que não conseguiu gravar item nenhum seria uma dívida sem
    // compra. Chega aqui só quando o documento e os itens já estão de pé.
    let contasCriadas = 0
    let avisoContas: string | null = null

    if (documento.tipoDocumento === 'contrato') {
      const contas = await gravarContasDoContrato(documento, documentoId, fazendaId)
      contasCriadas = contas.criadas

      if (contas.erro) {
        avisoContas = `O contrato foi importado, mas a conta a pagar não pôde ser criada (${contas.erro}). Cadastre o vencimento à mão em Contas a Pagar.`
      } else if (contas.criadas === 0 && contas.duplicadas === 0) {
        avisoContas = 'O contrato foi importado, mas não encontrei a data de pagamento nele. Cadastre a conta à mão em Contas a Pagar.'
      }
    }

    if (documento.tipoDocumento !== 'contrato') {
      // Extrato não gera conta a pagar de propósito: o boleto dele chega por
      // e-mail pelo Make (nfeEmail.ts). Sem esta linha, quem subiu o arquivo
      // pela aba de Contas a Pagar ficaria esperando uma conta que nunca vem.
      avisoContas = 'Isto é um extrato de revenda, não um contrato — os itens entraram na aba Controle e nenhuma conta a pagar foi criada (o boleto do extrato chega por e-mail).'
    }

    return {
      status:           'gravado',
      documentoId,
      itensGravados,
      itensDescartados:  documento.itensDescartados,
      itensDuplicados,
      contasCriadas,
      avisoContas,
    }
  } catch (err) {
    // Cobre o `throw` de data não-resolvível acima — acontece dentro do
    // `.map()` que MONTA `itensParaGravar`, sempre ANTES de qualquer INSERT
    // ser tentado. Zero itens deste documento podem existir em itens_nfe
    // neste ponto — o caminho "limpo" é sempre seguro aqui.
    const mensagem = err instanceof Error ? err.message : String(err)
    console.error('[GravarDocumentoPdf] Falha ao montar itens — desfazendo documento:', mensagem)
    await desfazerDocumentoSemItens(documentoId, arquivoPath)
    return { status: 'erro', mensagem }
  }
}
