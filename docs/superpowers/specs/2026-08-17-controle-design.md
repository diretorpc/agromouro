# Design: aba "Controle" (defensivos/adubos/sementes)

**Data:** 2026-08-17
**Status:** Reconstruído retroativamente — Epics 2.1 a 2.3 já implementadas e
commitadas antes deste documento existir (falha de processo, ver nota abaixo). Epic
2.4 em diante ainda não tem design.

---

## ⚠️ Nota sobre este documento

Este spec foi escrito **depois** de 3 das 5 epics já estarem prontas, código e tudo.
O branch `feature/controle-gastos` foi criado numa sessão anterior só com uma lista
vaga de 6 itens ("10 tasks: data/migration, PDF backend, UI, interactions, PDF
import, sidebar" — nem numerados, nem descritos) e as sessões seguintes foram
inventando "Epic 2.1", "2.2", "2.3" à medida que avançavam, sem nunca escrever o
plano inteiro antes. O Matheus notou a falta e pediu para reconstituir. As decisões
abaixo são reais (foram tomadas de verdade, com o Matheus, durante as sessões) — só a
**organização num documento único** é nova.

---

## Objetivo

Cruzar duas fontes de gasto com insumo agrícola (defensivo, adubo/fertilizante,
semente) que hoje vivem separadas:

1. **NF-e automática** — chega por e-mail, processada sozinha (Make → webhook →
   `nfeProcessor`), já tem tela própria (`/nfe`).
2. **PDF importado manualmente** — extrato "Contas a Receber" que a revenda manda
   (Solos, Syagri, Protec...) ou contrato de compra e venda (Mosaic e afins). **Sem
   XML nenhum envolvido** — é o lado que não tem documento fiscal pra se apoiar.

A aba Controle mostra os dois lados lado a lado, com o PDF de origem sempre
rastreável, pra o Matheus enxergar tudo que comprou — não só o que tem nota.

**O que este design NÃO faz:** não substitui a NF-e automática, não tenta ler nota
fiscal nenhuma (isso é `nfeProcessor.ts`), não cria boleto/Contas a Pagar a partir do
PDF (fora de escopo — se o documento importado tiver vencimento, é lançamento à parte).

---

## Decisões fechadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | O item importado do PDF conta como gasto sozinho, mesmo que a NF-e da mesma compra já tenha chegado? | **Não.** `conta_como_compra: false` sempre. A aba Controle é conferência/cruzamento — o gasto de verdade continua vindo só da NF-e quando ela existir. Aceita perder o gasto de compra que nunca teve NF-e no sistema; é o trade-off escolhido conscientemente para não dobrar dinheiro no Financeiro (achado crítico, 4 rodadas de revisão do Apolo em 17/08). |
| 2 | Como distinguir reimportação de um extrato (mesma duplicata, mês seguinte) de compra nova? | Chave de dedupe por **ITEM** (não só por documento): fornecedor + número da duplicata do item + descrição + valor + posição de ocorrência dentro do documento (migration 018, índice `idx_itens_nfe_dedupe_item`). Documento sozinho não bastava — extrato é cumulativo por definição e sua "data" muda a cada geração. |
| 3 | O que acontece se o PDF não for reconhecido (não é extrato/contrato) ou não tiver nenhuma linha aproveitável? | **Nenhuma linha é criada** em `documentos_controle`. Sem histórico de falha no banco — mesmo padrão do upload manual de XML (`importarXmlManual`, `nfe.ts`). A tela mostra a mensagem na hora, não fica registro. |
| 4 | Documento que falha no meio da gravação (alguns itens gravados, erro depois) — desfaz tudo ou marca erro? | **Marca `status='erro'`, preserva o PDF no Storage, não tenta DELETE** (a FK `itens_nfe_doc_controle_fk` é `ON DELETE RESTRICT` — desfazer falharia mesmo, e apagar o PDF nesse caso deixaria prova nenhuma do que foi parcialmente importado). Os dois índices de dedupe (`idx_doc_controle_hash`, `idx_doc_controle_dedupe`) são parciais (`WHERE status <> 'erro'`) justamente pra permitir reenvio depois. |
| 5 | Sem transação atômica entre gravar o documento e gravar os itens (2 chamadas HTTP separadas ao Supabase) — construir função de banco pra garantir tudo-ou-nada? | **Não agora.** Risco aceito: se cair exatamente entre as duas chamadas, sobra documento com zero itens. Mitigado por: se o INSERT dos itens falhar, o código desfaz o documento + Storage (quando zero itens foram gravados) ou marca erro (quando algum item já entrou). Cobre a esmagadora maioria dos casos reais (erro de validação, rede instável); não cobre o processo morrer no meio exato. |
| 6 | `GET /controle/documentos` traz os itens vinculados junto, ou só o resumo do documento? | **Traz os itens junto.** Mais peso na resposta agora, mas a tela nasce com tudo numa chamada só — decisão do Matheus, contra a recomendação inicial (que era "só o resumo, itens depois"). |
| 7 | Construir a rota de visualizar/baixar o PDF original agora, ou deixar pra Epic separada? | **Construir agora**, junto com upload e listagem — decisão do Matheus, contra a recomendação inicial (que era adiar). Signed URL do Storage, 60s de validade, checando `fazenda_id` no código antes de gerar (signed URL não passa pela RLS do Postgres). |
| 8 | Duplicata (hash ou conteúdo já existe) é erro HTTP ou sucesso? | **200**, não 409/4xx — mesmo padrão que `POST /nfe/importar-xml` já usa pra `'duplicada'`: o pedido foi processado, só não criou nada novo porque já existia. |
| 9 | Falha de infraestrutura da IA (Anthropic sobrecarregada, chave inválida) — mesmo código HTTP que "PDF não reconhecido"? | **Não.** `falha` (infra) → **503**, com mensagem de "tente de novo". Os 3 status de recusa real de conteúdo (`nao-documento`, `sem-itens-aproveitaveis`, `sem-identidade`) continuam **422**. Achado do Apolo: tratar os dois igual fazia o Matheus achar que o PDF dele era ruim numa simples instabilidade passageira da API, e não reenviar. |

---

## Design técnico — o que já está construído

### Epic 2.1 — Fundação (migration 017 + bucket + leitor de PDF)

**Status: ✅ pronto, commitado (`ba68b0e`), migration aplicada em produção.**

- `api/src/database/migrations/017_controle.sql` — tabela `documentos_controle`
  (fornecedor, número do documento, data, valor total, status, hash do arquivo,
  caminho no Storage) + 3 colunas novas em `itens_nfe` (`fornecedor`,
  `numero_documento`, `documento_controle_id`) + constraints de integridade
  (`dedupe_exige_identidade`, `fornecedor_so_sem_nota`, `item_de_documento_completo`).
- Bucket Storage `controle-documentos` (privado) criado manualmente no painel do
  Supabase.
- `api/src/services/controle/documentoPdf.ts` — `lerDocumentoPdf()`: manda o PDF pro
  Claude Opus, valida o retorno (schema fechado, teto de sanidade por valor/data/
  quantidade), devolve `DocumentoLido` com os itens. **Só lê — não grava nada.**

### Epic 2.2 — Gravação no banco (gravarDocumentoPdf.ts + migration 018)

**Status: ✅ pronto, commitado (`40b8487`), migration 018 aplicada em produção
(confirmado pelo Matheus via 3 consultas de verificação em 17/08).**

- `api/src/services/controle/gravarDocumentoPdf.ts` — `gravarDocumentoDoPdf()`:
  calcula hash do PDF, sobe pro Storage, chama `lerDocumentoPdf()`, grava em
  `documentos_controle` + itens em `itens_nfe` (`conta_como_compra: false` sempre,
  decisão #1 acima).
- `api/src/database/migrations/018_itens_nfe_dedupe_item_pdf.sql` — trava de
  duplicidade por ITEM (decisão #2), incluindo o ajuste retroativo do índice de
  documento pra parcial (decisão #4).
- **4 rodadas de revisão do Apolo** — 2 críticos de dinheiro dobrando resolvidos
  (decisão #1 e #2), 4 altos de "tela de conferência ficando errada" resolvidos
  (decisão #4, mais duas correções técnicas: linha legítima repetida dentro do mesmo
  documento não é mais descartada; item de contrato sem número de duplicata próprio
  ganhou proteção contra reimportação).

### Epic 2.3 — Rotas da API

**Status: ✅ pronto, commitado (`d4e8ca5`).**

- `api/src/routes/controle.ts`:
  - `POST /controle/documentos` — upload (base64 no corpo, mesmo padrão de
    `/cartoes/importar-preview`, sem multer). Mapeamento status→HTTP conforme
    decisões #8 e #9.
  - `GET /controle/documentos` — lista da fazenda ativa, com itens agrupados
    (decisão #6), sem N+1 query.
  - `GET /controle/documentos/:id/arquivo` — signed URL do PDF original (decisão #7),
    checando posse por fazenda antes de gerar.
- Isolamento por fazenda testado com **mutação de código real** pelo Apolo (não só
  mock): os 5 pontos sensíveis (incluindo a rota de signed URL, que não passa pela
  RLS) falham a suíte quando o filtro de `fazenda_id` é removido.

---

## Backlog — ainda não desenhado

### Epic 2.4 — Tela (upload, lista, visualizar PDF, cruzamento)

**Status: 🔴 não desenhada.** Precisa de uma sessão própria de
`superpowers:brainstorming` (+ provavelmente `frontend-design`/`ui-ux-pro-max`, dado
que é UI nova) antes de virar plano — este documento não antecipa decisões de tela
que ainda não foram discutidas com o Matheus.

Perguntas em aberto conhecidas, levantadas durante a Epic 2.3 mas não respondidas:
- Como mostrar visualmente "este item já tem NF-e correspondente" vs "só existe no
  PDF" — é o cruzamento que dá nome à aba, e ainda não tem desenho nenhum.
- Documento com `itens: []` porque tudo já existia (reimportação legítima) precisa de
  algum sinal na tela pra não parecer que a gravação falhou (achado médio do Apolo,
  ainda pendente — ver ESTADO.md).
- Onde entra o botão de upload — página nova, ou dentro de alguma tela existente
  (Financeiro? NF-e?).

### Epic 2.5 — Navegação (sidebar)

**Status: 🔴 não desenhada.** Depende da Epic 2.4 existir pra saber o que linkar.

### Pendências técnicas conhecidas (não é dinheiro, registradas no ESTADO.md)

Ver `ESTADO.md`, seção "Feature Controle", para a lista completa de achados
médios/baixos aceitos como pendência (limite de linhas na listagem, rate limit
próprio na rota de upload, `divergenciaTotal` não propagado, confirmação do limite de
tamanho do bucket no painel do Supabase).

---

## Arquivos afetados (Epics 2.1–2.3, já commitados)

- `api/src/database/migrations/017_controle.sql` — novo
- `api/src/database/migrations/018_itens_nfe_dedupe_item_pdf.sql` — novo
- `api/src/services/controle/documentoPdf.ts` — novo
- `api/src/services/controle/documentoPdf.test.ts` — novo
- `api/src/services/controle/gravarDocumentoPdf.ts` — novo
- `api/src/services/controle/gravarDocumentoPdf.test.ts` — novo
- `api/src/routes/controle.ts` — novo
- `api/src/routes/controle.test.ts` — novo
- `api/src/index.ts` — registro da rota nova
- `ESTADO.md` — histórico e pendências (não copiar de volta o detalhe pra cá)
