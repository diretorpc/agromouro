# Adicionar NF em PDF — design

**Data:** 24/08/2026
**Estado:** aprovado no brainstorming, aguardando plano de implementação
**Ramo:** `claude/add-pdf-note-option-a586f8`

---

## O problema

O botão **Adicionar NF** da aba Notas tem hoje dois caminhos: `Upload XML` e `Manual`.

- O **XML** é o caminho bom — dado fiscal exato, processado pelo mesmo cano do e-mail
  automático (`importarXmlManual` → `processarNFe`): estoque, financeiro, contas a pagar
  e aviso no WhatsApp saem prontos.
- O **Manual** é o caminho pobre: grava a casca da nota e **um único item sintético** com
  o nome do fornecedor (`web/app/(app)/nfe/page.tsx`, função `handleSaveNF`). Não toca
  estoque, não cria boleto, não lê CFOP.

Falta o caso do meio, que é o mais comum na prática: **o fornecedor mandou o DANFE em PDF
e o XML não chegou** (ou chegou por um e-mail que o Make não vigia). Hoje isso vira
digitação à mão no modo Manual — com o estoque e os boletos ficando de fora.

## Objetivo, e o que fica de fora

**Objetivo:** subir o PDF da nota e ter o mesmo resultado do XML — nota na aba NF, itens
no estoque, gasto no Financeiro, boleto em Contas a Pagar — sem digitar nada.

**Fora de escopo, explicitamente:**

- OCR próprio (a leitura é do Claude, via bloco `document` em base64 — mesmo mecanismo já
  usado em `boletoPdf.ts` e `controle/documentoPdf.ts`).
- Importação em lote (um PDF por vez).
- Edição de valor e quantidade item a item na conferência — ver a decisão 4 abaixo (o
  EFEITO do item é editável desde 24/08/2026; valor e quantidade não).
- Extração de chave de acesso e validação na SEFAZ. O PDF não é documento fiscal; é papel.

---

## Decisões de design

### 1. Reaproveitar `processarNFe`, não construir cano paralelo

`processarNFe(nfe: NFeData, origem, fazenda_id)` (`api/src/services/nfeProcessor.ts:474`)
já grava nota → itens → estoque → preço médio → lançamento financeiro → contas a pagar →
WhatsApp, e já obedece às regras caras do projeto (CFOP decide estoque, bonificação entra
com custo zero, `duplicataEhReal` impede gasto fantasma).

**A feature inteira é montar um `NFeData` a partir do PDF e entregar para ele.** Qualquer
desenho que grave nota por conta própria estaria condenado a divergir dessas regras no
primeiro conserto que só um dos lados receber — é o defeito que a memória
`financeiro-soma-itens-nao-lancamentos` documenta.

Consequência aceita: `processarNFe` passa a **devolver o id da nota** (`Promise<string>`
em vez de `Promise<void>`). Mudança de uma linha, retro-compatível com os três chamadores
atuais. A alternativa — reconsultar a nota por `(numero, cnpj, fazenda, modelo)` depois —
é uma segunda fonte da mesma verdade, e a consulta pode achar a nota do *outro* caminho de
entrada numa corrida (`nfe-corrida-duas-portas`).

### 2. Dois passos: ler, conferir, gravar

| Passo | Rota | Escreve? |
|---|---|---|
| 1 | `POST /nfe/ler-pdf` | **não** — lê, valida, avisa se já existe |
| 2 | `POST /nfe/importar-pdf` | sim — sobe o arquivo e chama `processarNFe` |

**O PDF fica no navegador entre os dois passos**, não no Storage. Desistir na tela de
conferência não deixa arquivo órfão no bucket nem linha no banco. O custo é o arquivo
trafegar duas vezes (~1 MB); a alternativa (subir no passo 1 e apagar depois) exige uma
rotina de limpeza de órfãos que ninguém vai lembrar de manter.

**Por que conferência, e não gravar direto como o XML:** o XML é dado fiscal; o PDF é a IA
lendo um papel. Um dígito errado no número ou no CNPJ **fura o índice único**
`idx_nfe_numero_emitente_fazenda_modelo` — e quando a mesma nota chegar depois pelo Make,
estoque e gasto contam duas vezes, calados. Já aconteceu em produção (nota 58717 da SOLOS,
duas gravações com 11 ms de diferença; ver `nfe-corrida-duas-portas`).

### 3. Três travas anti-duplicata, em camadas

1. **Conferência humana** — número, CNPJ, data, valor e modelo ficam editáveis antes de
   qualquer escrita. É a única trava que corrige a causa, não o sintoma.
2. **Aviso de nota existente** — o passo 1 roda `nfeJaProcessada(numero, cnpj, fazenda,
   modelo)` e devolve `jaExiste`. A tela barra em vermelho, com a data em que a nota
   entrou. Checagem em código **não é atômica** — é aviso, não trava.
3. **Hash do arquivo** — `sha256` do PDF gravado em `notas_fiscais.arquivo_hash`, com
   índice único parcial por fazenda. Subir o **mesmo arquivo** duas vezes é recusado pelo
   banco mesmo que a IA leia diferente na segunda vez. Esta é a única trava atômica nova.

O que nenhuma das três resolve: o PDF e o XML da mesma nota entrando com o número lido
errado. Só a conferência humana pega esse caso — por isso ela não é opcional.

### 4. Itens: o dono escolhe o EFEITO, não edita número

**Revisado em 24/08/2026, depois da revisão do Apolo.** A decisão original era "itens
só-leitura, com remoção de linha", pelo motivo abaixo — que continua valendo para valor e
quantidade. O que mudou: a revisão provou, executando o código, que a mitigação não
fechava o caso mais caro.

Cabeçalho editável (número, fornecedor, CNPJ, data, valor total, modelo). Cada item tem
**um menu de efeito em português** e um **botão de remover**. Valor e quantidade seguem
só-leitura.

**Por que valor e quantidade continuam travados:** o que decide estoque é o `CFOP` e o
`NCM` de cada item (`efeitoDoCfop`, `fronteiraPorNCM`). Deixar o dono editar valor, mas
não o efeito, cria a ilusão de que ele corrigiu o item quando o resultado no estoque
continua vindo de um código que ele não viu.

**Por que o efeito passou a ser editável:** `efeitoDoCfop('')` devolve *compra*. Com a
coluna CFOP borrada — comum em DANFE escaneado — uma nota de **entrega de pedido já pago**
entrava inteira como compra nova: é o mecanismo exato do gasto fantasma de R$ 1,2 mi da
SYAGRI, reaberto pelo caminho novo. O aviso amarelo não fechava (só disparava com CFOP
**vazio**, nunca com CFOP lido **errado**), e a única ação oferecida — remover a linha —
tirava o item do estoque e, quando aplicada a todos, tornava a nota inimportável.

O menu oferece **efeito de negócio, não código fiscal**: "Compra normal", "Entrega de
pedido que já paguei", "Faturamento — paguei agora, mercadoria vem depois", "Bonificação —
veio de graça". Ninguém na fazenda sabe o que é 5117; todo mundo sabe o que já pagou. A
lista mora em `api/src/services/contas/cfop.ts` e chega pronta pela rota — regra fiscal
tem um dono só neste projeto, e não é o front.

**Gravar fica travado enquanto houver item sem efeito escolhido.** Deixar passar equivale
a decidir "é compra" por omissão. Para a nota comum existe um atalho explícito ("São todos
compra normal"), que é escolha do dono, não default calado. CFOP de família que o menu não
oferece (consignação, remessa sem compra) aparece como código cru e não é trocável —
substituí-lo por "compra" seria piorar um efeito que já está certo.

Itens que a validação descartou (ilegíveis, valor fora de escala) **aparecem como aviso
amarelo com a contagem** — nunca somem calados. Mesmo princípio de `itensDescartados` em
`documentoPdf.ts`.

### 5. O PDF é guardado; o XML nunca foi

Bucket privado `notas-pdf`, caminho `{fazenda_id}/{uuid}.pdf`, mesmo padrão de
`controle-documentos` (migration 017). A coluna `notas_fiscais.arquivo_pdf` guarda o
caminho.

Isto conserta pela metade a dor registrada em `nfe-xml-nao-guardado`: das notas que
entrarem por PDF, o papel original fica recuperável. A decisão de **não** guardar o XML
inteiro continua valendo (volume), e não é revista aqui.

Download pela API (`GET /nfe/:id/arquivo` → URL assinada, 60 s), não pelo cliente do
navegador: a API usa a chave de serviço e não depende de policy de Storage — o mesmo
motivo pelo qual as rotas de nota já moram lá.

### 6. Aceita DANFE e NFS-e; a IA decide qual é

`modelo` (`'nfe' | 'nfse'`) faz parte da chave de duplicidade desde a migration 011: NF-e
nº 500 e NFS-e nº 500 do mesmo fornecedor são notas diferentes. A IA classifica, e o campo
fica **editável na conferência** — classificação errada aqui descarta uma nota real como
"já processada".

NFS-e leva `servico: true` nos itens, que vence a cascata de estoque sem consultar a IA de
categorização (mesma trava que `parseXmlNFSe` usa: serviço nunca é estocável).

### 7. Opus, não Haiku

`ANTHROPIC_MODEL_NOTA_PDF ?? 'claude-opus-5'` — mesma regra ETC de `documentoPdf.ts`
(o modelo vem do ambiente, nunca cravado). Sem `effort: 'low'`.

Uma DANFE tem tabela de produtos com NCM e CFOP por linha e um quadro de duplicatas; errar
uma linha é estoque ou dinheiro errado. Precisão vale mais que velocidade e mais que os
centavos de diferença por nota. **O custo real por nota deve ser medido na primeira
importação de verdade e anotado no ESTADO.md** — não estimado aqui.

---

## Contrato de dados

O que o passo 1 devolve (e o passo 2 recebe de volta, possivelmente editado):

```ts
type NotaLidaDoPdf = {
  modelo:         'nfe' | 'nfse'
  numero:         string
  emitenteNome:   string
  emitenteCnpj:   string          // só dígitos
  dataEmissao:    string          // 'AAAA-MM-DD'
  valorTotal:     number
  formaPagamento: string | null   // tPag, quando o DANFE imprimir
  duplicatas:     { numero: string; vencimento: string | null; valor: number | null }[]
  itens: {
    descricao:      string
    quantidade:     number
    unidade:        string
    valorUnitario:  number
    valorTotal:     number
    quantidadeTrib: number
    unidadeTrib:    string
    ncm:  string   // '' quando ilegível — a cascata existente trata
    cfop: string   // '' quando ilegível
  }[]
}
```

`ncm`/`cfop` vazios são **legítimos**, não erro: `processarNFe` já trata a ausência
(`fronteiraPorNCM` devolve null → decide pelo tipo; `efeitoDoCfop('')` assume compra
normal). O que **não** pode acontecer é NCM ou CFOP inventado — daí a validação abaixo.

## Validação determinística (`validarNotaLida`)

Exportada e testada sem gastar chamada de IA, como `validarDocumentoLido`. Regras:

| Campo | Regra | Falha vira |
|---|---|---|
| `emitenteCnpj` | só dígitos, 11 (CPF) ou 14 | nota recusada (`sem-identidade`) |
| `numero` | não vazio depois de `trim` | nota recusada (`sem-identidade`) |
| `dataEmissao` | formato + `dataExiste` + janela 5 anos passado / 30 dias futuro | nota recusada |
| `valorTotal` | finito, `> 0`, `<= 5.000.000` | nota recusada |
| item `valorTotal` | finito, `>= 0`, `<= 2.000.000` | item descartado, contado |
| item `valorUnitario` | finito, `<= 50.000.000` | vira 0, item sobrevive |
| item `quantidade` | finita, `> 0`, `< 1.000.000.000` | item descartado, contado |
| item `descricao` | não vazia | item descartado, contado |
| `cfop` | exatamente 4 dígitos | vira `''` |
| `ncm` | exatamente 8 dígitos | vira `''` |
| itens | corta em 200 (mesmo teto de `itensSeguros`) | excedente contado como descartado |
| duplicatas | corta em 24; vencimento fora da janela vira `null` | contado |

Nota sem **nenhum** item aproveitável não vira `NFeData` vazio — vira recusa `sem-itens`,
com aviso na tela. Uma nota sem item passaria por `todosSaoCompra` (o `every` de lista
vazia é `true`) e lançaria o valor cheio no Financeiro sem nada que o justifique.

## Erros e status HTTP

Mesmo vocabulário de `controle.ts` — a distinção que importa é **"o arquivo não serve"**
(422, não adianta repetir) contra **"a IA está fora do ar"** (503, tente de novo):

| Situação | HTTP | Mensagem ao produtor |
|---|---|---|
| leu, tudo certo | 200 | — |
| não é nota fiscal | 422 | "Este arquivo não parece ser uma nota fiscal." |
| sem itens aproveitáveis | 422 | "Não consegui ler nenhum item desta nota." |
| sem número ou CNPJ | 422 | "Não consegui identificar o número da nota ou o CNPJ do fornecedor." |
| data de emissão ilegível | 422 | "Não consegui ler a data de emissão da nota." |
| valor total ilegível | 422 | "Não consegui ler o valor total da nota." |
| arquivo acima de 10 MB | 422 | "Arquivo grande demais (máximo 10 MB)." |
| IA indisponível ou resposta truncada | 503 | "O leitor de notas está indisponível agora. Tente de novo em alguns minutos." |
| nota já existe (passo 2) | 200 | "Esta nota já está no sistema (entrou em DD/MM/AAAA)." |
| mesmo arquivo já importado | 200 | "Este mesmo PDF já foi importado." |
| falha de banco ou Storage | 500 | "Erro ao gravar a nota." |

Todos mandam `error` em português no corpo — sem esse campo, `web/lib/api.ts` cai no
fallback "API error: {status}" e o motivo nunca chega na tela.

## Banco — migration `supabase/migrations/013_notas_fiscais_pdf.sql`

- `notas_fiscais.arquivo_pdf text` — caminho no bucket, nulo para nota que não veio de PDF.
- `notas_fiscais.arquivo_hash text` — sha256 do arquivo.
- `create unique index idx_nfe_arquivo_hash on notas_fiscais (fazenda_id, arquivo_hash)
  where arquivo_hash is not null` — **parcial**: sem o `where`, todas as notas antigas
  (hash nulo) colidiriam entre si.
- Bucket `notas-pdf`, privado, teto de 10 MB — criado no painel do Supabase, com o comando
  de conferência no cabeçalho da migration.

Sem alteração de RLS: quem lê é a API, com chave de serviço.

**O SQL completo vai colado no chat**, não só linkado (regra `feedback-sql-cole-no-chat`).

---

## Tarefas

1. **Migration 013 + bucket.** Colunas, índice parcial, bucket privado. Conferir no banco
   vivo com `pg_indexes` antes de seguir — arquivo de migration não prova estado do banco
   (`migration-009-e-fossil`).
2. **`api/src/services/nfe/notaPdf.ts` — leitura.** Schema JSON, prompt, tetos de sanidade,
   `validarNotaLida` exportada. Testes cobrindo: CNPJ com letra, data fora da janela, valor
   absurdo, item sem descrição, 5.000 itens alucinados, CFOP de 3 dígitos, nota sem item
   nenhum, resposta truncada (`stop_reason: 'max_tokens'` → `falha`).
3. **`processarNFe` devolve o id da nota e aceita o arquivo.** Assinatura ganha um 4º
   parâmetro opcional `arquivo?: { pdfPath, hash }`, gravado no **mesmo INSERT** da nota —
   o índice único do hash só protege se ele chegar ao banco antes de o estoque mexer. A
   suíte existente tem que continuar verde.
4. **`api/src/services/nfe/gravarNotaDoPdf.ts` — gravação.** Hash, upload, dedupe,
   `processarNFe`, limpeza em caso de falha (apagar a casca da nota **e** remover o arquivo
   do bucket — o mesmo cuidado do `catch` de `importarXmlManual`). Testes com o Supabase e
   o `processarNFe` mockados: upload falha → nenhuma nota; `processarNFe` lança → casca
   apagada e arquivo removido; sucesso → `arquivo_pdf` e `arquivo_hash` gravados; hash
   repetido → `duplicada-arquivo`.
5. **Rotas.** `POST /nfe/ler-pdf`, `POST /nfe/importar-pdf`, `GET /nfe/:id/arquivo`, mais o
   limite de 15 MB no mount de `/nfe` em `index.ts` (hoje 2 MB — nenhum PDF passa). A
   fazenda vem **sempre** de `req.user.app_metadata.fazenda_ativa_id`, nunca do corpo.
   Testes de rota para cada linha da tabela de erros acima.
6. **Tela.** Terceira aba "Upload PDF" no diálogo Adicionar NF; painel de conferência
   (cabeçalho editável, itens com remover, boletos listados, avisos amarelos, barra
   vermelha de nota existente); "Baixar PDF" no menu da linha quando `arquivo_pdf` não for
   nulo.
7. **Verificação ponta a ponta e ESTADO.md.** Importar uma nota real e **abrir as quatro
   telas**: aba NF, Financeiro, Contas a Pagar e Estoque — mais o Dashboard, que soma
   tabela diferente do Financeiro (`financeiro-soma-itens-nao-lancamentos`). Anotar o custo
   medido da leitura.

Tarefas 2 e 3 são as que carregam risco de dinheiro; 6 é a maior em volume.

## O que pode dar errado

- **A IA lê o número certo mas o CNPJ errado** (formatação com pontos, CNPJ do
  transportador no lugar do emitente). O índice único não pega, e a nota entra duas vezes
  quando o XML chegar. Mitigação: conferência, mais um prompt que exige o CNPJ do
  **emitente** e validação que recusa CNPJ sem 11 ou 14 dígitos.
- **DANFE escaneado torto ou foto de celular.** A leitura vira `nao-nota` ou itens
  descartados. É recusa honesta, não corrupção de dado — mas frustra. Aceito.
- **Nota de entrega futura em PDF.** O CFOP por item resolve, igual ao XML — desde que a IA
  leia a coluna CFOP. Se vier vazio, o item conta como compra normal e **dobra o gasto** de
  uma remessa (`nfe-entrega-futura-conta-dobrado`). Mitigação: o painel de conferência
  mostra o CFOP de cada item e destaca em amarelo os que vieram vazios.
- **PDF com duas notas grudadas.** A IA vai ler a primeira e ignorar a segunda, ou misturar
  as duas. Não há trava contra isso nesta entrega; a conferência é a defesa.
