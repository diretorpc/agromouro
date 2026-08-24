import { randomUUID, createHash } from 'crypto'
import { supabase } from '../supabase'
import { processarNFe, nfeJaProcessada } from '../nfeProcessor'
import { converterParaNFeData, type NotaLidaDoPdf } from './notaPdf'

// Grava a nota que veio de um PDF: sobe o arquivo, entrega ao MESMO
// processarNFe que o XML usa e limpa tudo se o caminho quebrar no meio.
// Nenhuma regra de estoque, gasto ou boleto mora aqui — de propósito: duas
// implementações da mesma regra divergem no primeiro conserto que só uma
// receber.

// Bucket privado (Storage do Supabase), criado no painel — ver o cabeçalho da
// migration 013. Mesmo padrão de "controle-documentos".
const BUCKET = 'notas-pdf'

export type ResultadoGravacaoNota =
  | { status: 'gravada'; notaId: string; numero: string; emitenteNome: string; valorTotal: number }
  // Nota com o mesmo (numero, cnpj, fazenda, modelo) já está no sistema.
  | { status: 'duplicada-nota'; nota: { id: string; numero: string; data_emissao: string; emitente_nome: string } }
  // O MESMO arquivo já foi importado antes (sha256 igual). Motivo separado do
  // de cima porque pede ação diferente de quem subiu: reenvio por engano.
  | { status: 'duplicada-arquivo' }
  | { status: 'erro'; mensagem: string }

// Convenção do bucket: <fazenda_id>/<uuid>.pdf — a mesma de
// controle-documentos, para o arquivo nunca ficar fora da pasta da fazenda.
function caminhoNoBucket(fazendaId: string): string {
  return `${fazendaId}/${randomUUID()}.pdf`
}

// Arquivo órfão no Storage (upload feito, nota não gravada) não aparece em
// tela nenhuma — só custa espaço calado. Falha ao limpar é logada, nunca
// propagada: quem chamou precisa receber a falha ORIGINAL, não a da limpeza.
async function removerDoStorage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) {
    console.error(`[GravarNotaDoPdf] Falha ao limpar arquivo órfão (${path}):`, error.message)
  }
}

type NotaNoBanco = { id: string; numero: string; data_emissao: string; emitente_nome: string }

async function buscarNota(nota: NotaLidaDoPdf, fazendaId: string): Promise<NotaNoBanco | null> {
  const { data } = await supabase
    .from('notas_fiscais')
    .select('id, numero, data_emissao, emitente_nome')
    .eq('numero', nota.numero)
    .eq('emitente_cnpj', nota.emitenteCnpj)
    .eq('fazenda_id', fazendaId)
    .eq('modelo', nota.modelo)
    .maybeSingle()
  return (data as NotaNoBanco | null) ?? null
}

// Fallback defensivo: quando a nota existe mas a consulta não a devolve
// (janela mínima entre duas consultas), responde com o que se sabe pelo
// próprio PDF em vez de lançar erro. Mesmo padrão de importarXmlManual.
function duplicada(existente: NotaNoBanco | null, nota: NotaLidaDoPdf): ResultadoGravacaoNota {
  return {
    status: 'duplicada-nota',
    nota: existente ?? { id: '', numero: nota.numero, data_emissao: '', emitente_nome: nota.emitenteNome },
  }
}

export async function gravarNotaDoPdf(
  nota: NotaLidaDoPdf,
  pdf: Buffer,
  fazendaId: string,
): Promise<ResultadoGravacaoNota> {
  // 1. Checagem em código — é AVISO, não trava: quem arbitra de verdade é o
  //    índice único (a corrida de 11 ms medida em produção passa por aqui).
  //    Vem antes do upload para não deixar arquivo no bucket à toa.
  if (await nfeJaProcessada(nota.numero, nota.emitenteCnpj, fazendaId, nota.modelo)) {
    return duplicada(await buscarNota(nota, fazendaId), nota)
  }

  const hash    = createHash('sha256').update(pdf).digest('hex')
  const caminho = caminhoNoBucket(fazendaId)

  const upload = await supabase.storage.from(BUCKET).upload(caminho, pdf, {
    contentType: 'application/pdf',
    upsert: false,
  })

  if (upload.error) {
    console.error('[GravarNotaDoPdf] Falha ao subir o PDF:', upload.error.message)
    return { status: 'erro', mensagem: upload.error.message }
  }

  try {
    const notaId = await processarNFe(converterParaNFeData(nota), 'manual', fazendaId, { pdfPath: caminho, hash })
    return {
      status: 'gravada',
      notaId,
      numero:       nota.numero,
      emitenteNome: nota.emitenteNome,
      valorTotal:   nota.valorTotal,
    }
  } catch (err) {
    // Daqui pra baixo o arquivo JÁ subiu: toda saída limpa o Storage.
    await removerDoStorage(caminho)

    // Erro do Supabase chega como objeto puro ({code, message, details}), não
    // como Error — por isso a leitura defensiva em vez de `instanceof`.
    const erro  = (err ?? {}) as { code?: string; message?: string; details?: string }
    const texto = `${erro.message ?? ''} ${erro.details ?? ''}`

    // Os dois índices únicos pedem ação diferente de quem subiu o arquivo, e
    // os dois compartilham colunas — por isso a checagem é pelo NOME do
    // índice, nunca pela ordem das colunas na mensagem.
    if (erro.code === '23505' && texto.includes('idx_nfe_arquivo_hash')) {
      console.log('[GravarNotaDoPdf] Mesmo PDF já importado nesta fazenda — ignorado.')
      return { status: 'duplicada-arquivo' }
    }

    if (erro.code === '23505' && texto.includes('idx_nfe_numero_emitente_fazenda_modelo')) {
      // Corrida com o caminho automático: o Make gravou a mesma nota entre a
      // checagem lá em cima e este insert. O índice arbitrou, e o insert falhou
      // — não existe casca no banco para limpar.
      return duplicada(await buscarNota(nota, fazendaId), nota)
    }

    // Falha DEPOIS do insert da nota: processarNFe grava a casca como PRIMEIRO
    // passo (status 'processando'). Se ela ficar, a nota real que chegar por
    // e-mail é descartada para sempre como "já processada" — nfeJaProcessada só
    // confere se a nota EXISTE. Mesmo cuidado do catch de importarXmlManual.
    const casca = await buscarNota(nota, fazendaId)
    if (casca?.id) {
      const { error: errLimpeza } = await supabase.rpc('excluir_nota_fiscal', {
        p_nota_id:    casca.id,
        p_fazenda_id: fazendaId,
      })
      if (errLimpeza) {
        // Não é para acontecer (nota recém-criada não tem boleto pago), mas se
        // acontecer, falha ruidosamente no log em vez de mascarar a original.
        console.error('[GravarNotaDoPdf] Falha ao limpar a casca da nota:', errLimpeza.message)
      }
    }

    const mensagem = err instanceof Error ? err.message : (erro.message ?? 'Erro desconhecido')
    console.error('[GravarNotaDoPdf] Erro ao gravar a nota:', mensagem)
    return { status: 'erro', mensagem }
  }
}
