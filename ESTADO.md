# agromouro-base — estado detalhado

> Movido do `STATE.md` global em 03/08/2026; **reorganizado em 04/08/2026** (o dia
> tinha colado três blocos no fim, fora de ordem e com repetição — nada foi apagado,
> só reagrupado). Motivo de o arquivo existir: o painel global é injetado na largada
> de TODA sessão, inclusive quando você está em outro projeto. Aqui isto só é lido
> quando você está neste projeto.
>
> **Regra 1 — onde mora o quê.** Detalhe, número, data e história moram AQUI. O painel
> global guarda uma linha e aponta para cá. **Nunca copie de volta** — a mesma verdade
> em dois lugares acaba discordando.
>
> **Regra 2 — número que o sistema sabe responder NÃO se escreve aqui. Escreve-se o
> COMANDO que mede.** Contagem de teste, de commit, estado do `tsc`, saldo em banco:
> isso é pergunta, não afirmação. Quer registrar mesmo assim? Então é **HISTÓRIA** —
> com data, congelada e rotulada como tal.
>
> **Como este arquivo é organizado:** (1) o que está NO AR, (2) o que está ABERTO,
> (3) histórico por data, do mais novo para o mais velho.
>
> Histórico automático turno a turno: `~/.claude/.remember/agromouro-base/feito.md`

---

# 1. NO AR — o que o sistema já faz

## Financeiro: cor de destaque pra nota agrupada — corrigido em 17/08/2026, commitado (`19ed6eb`)

Pedido do Matheus: quando uma nota tem vários itens (linha expansível "N itens desta
nota", em `web/app/(app)/financeiro/page.tsx`), o cinza que marcava os itens do grupo
(`bg-muted/20`) era quase invisível — difícil ver onde uma nota termina e a próxima
começa.

**Trocado por azul claro** (`bg-sky-100`, cabeçalho + itens). Achado do Apolo na 1ª
rodada de revisão **[alto]**: o `TableRow` base do projeto (`web/components/ui/table.tsx:60`)
já injeta `has-aria-expanded:bg-muted/50`, que sobrevivia à mesclagem do tailwind-merge
contra a classe azul nova e ganhava por especificidade — a cor só aparecia com a nota
**FECHADA**, sumia ao abrir (o estado que mais importava, já que foi o pedido original).
Corrigido acrescentando os mesmos modificadores (`has-aria-expanded:`) na classe nova,
pra vencer a regra embutida do componente sem mexer nele (evita quebrar outras telas que
usam a mesma tabela).

2ª rodada do Apolo confirmou a correção com o compilador Tailwind real do projeto +
`tailwind-merge` real + hover simulado em Chrome headless de verdade (não só leitura) —
sem achado bloqueante. Testado visualmente também no navegador (Browser pane) pelo
Claude: nota fechada, aberta e com hover, os três estados ficam azuis.

**Duas notas de baixa prioridade, sem código pendente:** a tela irmã
`web/app/(app)/contas/lista-contas.tsx` tem o mesmo padrão de agrupamento e **não**
recebeu a mesma cor — decisão explícita de não mexer, ficou fora do pedido. Se a mesma
reclamação aparecer lá, o remédio é igual. Em tela de toque (tablet/celular) o efeito de
hover não existe (`@media (hover: hover)` do Tailwind) — só o fundo persistente aparece.

Depois disso o Matheus ainda achou o azul fraco nos ITENS da nota — escurecido de
`bg-sky-100/40` pra `bg-sky-100` sólido (mais forte que o próprio cabeçalho), sem
rodada extra do Apolo por ser ajuste de contraste, não de lógica.

**Commitado na branch `feature/colunas-redimensionaveis`** (junto com a feature
abaixo, que nasceu na mesma sessão) — depende de merge/PR pra chegar na `main`.

## Financeiro: colunas redimensionáveis (Fase 1 — só a tabela do Financeiro) — 17/08/2026

Pedido do Matheus: arrastar a borda de uma coluna da tabela pra mudar a largura, com
a largura salva. Confirmado em conversa: é redimensionar (não reordenar), vale pras
9 telas com tabela do sistema, mas construído e validado numa só antes de replicar.
Desenho completo: `docs/superpowers/specs/2026-08-17-colunas-redimensionaveis-design.md`.
Plano: `docs/superpowers/plans/2026-08-17-colunas-redimensionaveis.md`.

**No ar (Fase 1, só Financeiro):** hook `web/lib/use-column-widths.ts` (largura por
coluna, arrasto via ponteiro, salva em `localStorage` por tabela) + componente
`web/components/ui/column-resize-handle.tsx` (faixa de 6px na borda) +
`SortableTableHead` (`web/components/ui/sortable-table-head.tsx`) ganhou `style`/
`resizeHandle` opcionais, sem quebrar os outros 11 usos (Contas a Pagar incluído).

**Achado sério, corrigido:** `w-auto` na tabela não fazia ela encolher pro conteúdo —
`width:auto` num `<table>` (bloco) preenche o contêiner igual `width:100%`, então a
coluna arrastada salvava certinho mas não mudava de tamanho NA TELA. Testado ao vivo
no navegador pelo Claude antes de prescrever a correção. Trocado por `w-max`
(`width: max-content`) — confirmado ao vivo que resolve, e que a rolagem horizontal
do card continua funcionando quando a tabela fica mais larga que o card.

**Achado da revisão final de branch, corrigido:** `table-layout: fixed` sem
`overflow-hidden` nas células deixava texto/valor que não cabe vazar por cima da
coluna vizinha ao encolher (ex.: arrastar "Valor Total" pro mínimo). Corrigido
acrescentando `overflow-hidden` nas células — commit `da29ff8`.

**Fica pra depois, registrado e não esquecido (backlog da Fase 2, não bloqueou este
merge):**
- Replicar `ResizableTableHead`/mecanismo pras outras 8 telas com tabela (Contas,
  Operações, Estoque×2, NF-e, Talhões, Cartões, Custos) — hoje só Financeiro tem.
- O mecanismo ficou "soldado" no `SortableTableHead`, não virou um wrapper genérico
  como o desenho original previa — decidir isso ANTES de começar a Fase 2, porque
  Contas a Pagar tem coluna não-ordenável (sem caminho pra redimensionar hoje) e
  Estoque usa um `SortableTableHead` próprio, com API diferente.
- Risco de hydration mismatch (o hook lê `localStorage` no `useState` inicial) —
  o Financeiro escapa por acidente porque a tabela só existe depois do loading
  skeleton; telas que renderizam a tabela no primeiro paint vão sofrer isso.
- Re-render da página inteira a cada `pointermove` durante o arrasto (barato hoje com
  poucas linhas visíveis, pode pesar com "Carregar mais" em uso).
- Escrita no `localStorage` dentro do updater de `setState` (funciona, mas é padrão
  frágil — deveria ler de um `ref`, não do `prev` do updater).
- Arrastar até o mínimo (60px) numa coluna de cabeçalho comprido (ex.: "Produto /
  Serviço") às vezes não encolhe visualmente até lá — trava num piso maior definido
  pelo texto do cabeçalho (`nowrap`). Estado interno salva 60 certinho, só o visual
  fica maior que o esperado nesse extremo.
- Faixa de arrastar não é operável por teclado (sem `tabIndex`/setas).

**Na branch `feature/colunas-redimensionaveis`**, revisada por Apolo (por tarefa +
revisão final de branch inteira) — depende de merge/PR pra chegar na `main`.

## Boleto lido de PDF quando a NF-e chega sem XML — PR #56 mergeado em 14/08/2026

https://github.com/diretorpc/agromouro/pull/56 — commit `15cc642` na `main`, branch
`feat/readboletos` apagada (local e remoto). Railway faz deploy automático da `main`.
**Ainda não confirmado rodando em produção:** a prova é a próxima NF-e que chegar
por e-mail só com PDF.

**O defeito.** Fornecedor manda a nota e o boleto em PDF, sem XML. O job de e-mail
só olhava anexos `.xml`, então o e-mail inteiro era ignorado: sem gasto, sem estoque,
sem boleto, sem aviso. O boleto vencia no silêncio. Caso que provou: boleto da
UBE TERRA de R$ 730,50 vencendo 17/08, que não estava no sistema — cadastrado à mão
em 14/08 (ver seção própria abaixo).

**O que faz.** `contas/boletoPdf.ts` manda o PDF para `claude-opus-5` (document block
base64 + `output_config.format` json_schema, effort low) e valida o retorno;
`contas/gravarBoletoPdf.ts` grava a conta com a tarja `PREFIXO_CONFERIR`; o job avisa
no WhatsApp. **Só o boleto, nunca a nota inteira** — quatro números grandes e
padronizados, com erro visível na tela antes de pagar; a nota tem dezenas de linhas e
um dígito errado entraria no estoque calado. Nota continua exigindo XML.

**Três rodadas de revisão do Apolo, cada uma achando defeito na correção da anterior:**

1. 8 achados, 1 crítico — boleto em e-mail que também tinha XML nascia solto
   (`nota_fiscal_id: null`) e **dobrava o gasto** ao ser pago.
2. A correção do crítico **inverteu o defeito**: amarrar a qualquer nota fazia o gasto
   **sumir** no caso ERCAL (nota de remessa não lança gasto). Corrigido com
   `idDaNotaQueLancouGasto()` — só amarra quando a nota de fato lançou. Mais 8 achados,
   incluindo erro de banco perdendo o boleto e **zero teste** protegendo as correções
   (ele mediu 10 mutações passando limpas).
3. Medida com PDF real: boleto cedido a FIDC traz o **fundo** no campo "Beneficiário";
   o fornecedor está em "Beneficiário Final". Sem isso, conta repetida em toda compra
   financiada, e um nome que o dono não reconhece na tela.

**Rede de segurança** (cada item veio de um achado): falha de leitura ou de banco não
marca o e-mail como lido (volta em 30 min); carnê avisa quantas parcelas ficaram de
fora; teto de 5 PDFs por e-mail e 20 por ciclo; falha persistente avisa no WhatsApp no
3º ciclo; trava contra o job rodar sobreposto (vale por processo — **2 réplicas no
Railway quebram**, e o índice único da migração 006 não protege este caminho porque
grava `numero_parcela` NULL).

**Decisão do dono, registrada no código:** SEM filtro de remetente. A caixa é pessoal
(`IMAP_USER` é hotmail), então TODO PDF de TODA mensagem não lida vai para a API da
Anthropic — extrato de banco, escola, médico incluídos. Ele preferiu isso a arriscar
perder um boleto de fornecedor fora de uma lista. Perguntado e respondido em 14/08.

**Também subiu junto:** `@anthropic-ai/sdk` 0.27.3 → 0.117.1 (a 0.27 não tipa document
block nem `stop_reason: 'refusal'`), e o conserto de um defeito antigo do job — o
`continue` que pulava o `messageFlagsAdd` fazia todo e-mail sem XML ser reprocessado a
cada 30 min para sempre.

Para medir os testes e os tipos, rodar (não copiar número daqui):
```bash
cd api && npm test && npx tsc --noEmit
```

Para refazer a leitura de um PDF de boleto de verdade:
```bash
cd api && DOTENV_CONFIG_PATH=../.env npx tsx -r dotenv/config -e "import {lerBoletoDoPdf} from './src/services/contas/boletoPdf';import Anthropic from '@anthropic-ai/sdk';import {readFileSync} from 'fs';lerBoletoDoPdf(readFileSync(process.argv[1]),'b.pdf','$(date +%F)',new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY})).then(r=>console.log(JSON.stringify(r,null,1)))" CAMINHO_DO_PDF
```

**Backlog que ficou aberto** (achados aceitos, não consertados): PDF hoje + XML da mesma
nota semana que vem cria duas contas, e se o dono dispensar a da nota e pagar a solta o
gasto DOBRA — o conserto seria `gravarContasDaNota()` adotar conta solta com mesmo
valor+vencimento em vez de criar outra. Também: com várias notas no mesmo e-mail o
boleto é amarrado à primeira, e vínculo errado faz a exclusão em cascata da migração 009
apagar boleto de outra nota.

## Reorganização Financeiro + Contas a Pagar — PR #55 mergeado (squash) em 10/08/2026

https://github.com/diretorpc/agromouro/pull/55 — branch `fix/telasfin` apagada (local e remoto)
depois do merge. ⚠️ Mesmo padrão de incerteza de outros itens desta seção: Vercel faz deploy
automático no push pra `main`, **não confirmado de fora** que já está servindo o código novo, e
o Matheus ainda não testou visualmente no navegador com login de verdade.

Pedido de 10/08/2026: as duas telas de dinheiro "cospem número demais na cara". Pesquisa de
mercado (Aegro, Traction Ag/Conservis, SSCrop) confirmou o padrão: resumo separado do detalhe,
"a pagar" nunca misturado com histórico infinito. Nada mudou por baixo (NF-e, WhatsApp, banco)
— é reorganização de tela. 10 tarefas do plano original implementadas por subagentes e
revisadas uma a uma + o branch inteiro junto (`superpowers:subagent-driven-development`), mais
4 rodadas de ajuste pontual pedidas por ele depois de testar ao vivo. Detalhe completo, achados
menores registrados e plano tarefa-a-tarefa: `docs/superpowers/plans/2026-08-10-reorganizacao-financeiro-contas.md`
e `docs/superpowers/specs/2026-08-10-reorganizacao-financeiro-contas-design.md`.

**Financeiro:** abre no mês atual (era "todos os meses"), gráfico top-5 categorias, lista
paginada (20/vez), filtro de origem em menu, resumo separado do detalhe, grade completa nas
células (bordas, estilo escolhido por ele em protótipo visual), texto longo quebra linha em
vez de cortar com "...", **nota com mais de 1 item vira 1 linha resumida expansível** (soma o
valor, mostra selo por categoria, avisa se algum item não conta como gasto).

**Contas a Pagar:** dispensada some da aba "Todas" por padrão (aba "Dispensadas" dedicada),
resumo separado (rótulo "Resumo geral" — os 3 números não seguem o filtro de tipo, ao
contrário do Financeiro), filtro de tipo em menu, filtro de mês por vencimento (atrasada e sem
vencimento sempre aparecem, em qualquer mês — decisão de segurança, não some dívida ativa),
lista paginada (50/vez), todo filtro com quantidade (corrigiu achado do Apolo de 10/08: contador
ignorava o filtro de tipo), "Todas" esconde paga com mais de 30 dias (aba "Pagas" sem limite),
mesma grade/texto-sem-corte do Financeiro, **boleto agrupado só quando nota + vencimento + status
forem iguais** (parcela com vencimento diferente NUNCA agrupa — decisão dele, evita esconder
data de pagamento).

**Ordenação por coluna** (clicar no título tipo "Vencimento"/"Valor" reordena, clica de novo
inverte) — nas duas telas, generalizado do que só existia na coluna Data do Financeiro.

A revisão final do branch achou e corrigiu 1 bug real (padrão de mês novo tinha quebrado o
botão "Limpar" e a URL). Duas rodadas de agrupamento por nota (Financeiro e Contas) tiveram
achado de dinheiro corrigido antes do merge: crachá de "não conta como gasto"/"valor
incompleto" escondido na linha resumida.

## Categoria oficial unificada + parcelamento em Contas a Pagar — commitado e enviado ao GitHub em 11/08/2026

Push feito (`f0f87ca`, `main`) — ⚠️ mesmo padrão de incerteza dos outros itens desta seção:
deploy automático da Vercel esperado, **ele testa em produção depois do push** (não é um
teste feito por mim antes de enviar, dessa vez).

**Parte 1 — categoria duplicava barra no gráfico "Gastos por Categoria" do Financeiro.**
"Manutenção" digitado à mão numa conta paga virava categoria diferente de `manutencao`
vinda de nota fiscal — duas barras pro que era a mesma coisa. `web/lib/centro-custo.ts`
(novo) virou a lista oficial única, com função que casa texto digitado à mão com a
categoria oficial ignorando acento/maiúscula. Revisado 4x pelo Apolo (achado crítico na
1ª rodada: caixa de sugestão de categoria podia cobrir o botão Salvar e trocar a
categoria escolhida sem avisar — corrigido). Categoria "Royalties" adicionada à lista
depois, a pedido dele (commit `85649b2`).

**Parte 2 — parcelamento em "Nova conta avulsa".** Pedido dele: em vez de cadastrar uma
compra parcelada (ex: trator em 4x) uma parcela de cada vez, uma caixinha "Parcelar esta
conta" cria as N contas de uma vez — mesmo valor em cada uma (não divide, decisão dele),
vencimento um mês depois do anterior, descrição ganha "(i/N)" sozinha. Backend gera as N
linhas e insere todas juntas (atômico — ou nasce tudo, ou nada). Feito com
`superpowers:subagent-driven-development` (3 tarefas, cada uma com implementador +
revisor próprios) + revisão final do branch inteiro — achou e corrigiu 1 bug real antes
do merge: filtro de mês da tela escondia as parcelas recém-criadas (a maioria vence em
mês futuro), parecendo que o salvamento tinha falhado calado. Desenho completo:
`docs/superpowers/specs/2026-08-11-contas-avulsa-parcelamento-design.md`; plano
tarefa-a-tarefa: `docs/superpowers/plans/2026-08-11-contas-avulsa-parcelamento.md`.

**Ainda não testado ao vivo por ninguém** (nem por mim — tela atrás de login, proibido eu
digitar senha; nem por ele, ainda) — 245/245 testes do backend e checagem de tipos do
frontend passaram, mas o teste real (criar 4 parcelas de verdade, conferir que aparecem e
que uma conta normal sem parcelar continua igual) fica para ele em produção.

## Upload manual de XML — porta cega fechada, no ar desde 05/08/2026

**PR #46 mergeado** (`3ea4f04`, squash) — https://github.com/diretorpc/agromouro/pull/46.
Upload de XML e "Excluir nota" passaram a usar rotas do servidor
(`POST /nfe/importar-xml`, `DELETE /nfe/:id`), que reaproveitam o mesmo processador do
e-mail — antes a tela gravava direto no banco, sem ler CFOP. Modo "Manual" passou a criar
o item do gasto. Exclusão virou função atômica no Postgres: devolve estoque, apaga boleto
e lançamento financeiro, ou nada acontece.

Migração `supabase/migrations/009_excluir_nota_fiscal.sql` **já rodada em produção** — foi
ela que permitiu o teste ao vivo abaixo. Para reconferir em vez de acreditar neste texto,
no SQL Editor do Supabase:
`select proname from pg_proc where proname = 'excluir_nota_fiscal';`

**Duas rodadas de revisão do Apolo** — 15 + 2 problemas achados (lançamento fantasma ao
excluir, exclusão sem transação, boleto pago apagado sem rastro, envenenamento no caminho
de erro do upload, fazenda vinda do corpo do pedido em vez do login, WhatsApp derrubando
importação boa quando a rede falha, função do banco sem trava de permissão). Todos os
críticos/altos e os 2 bloqueantes foram corrigidos. Ficaram 7 achados médios/baixos,
documentados no PR, decididos como não-bloqueantes pelo próprio Apolo.

✅ **HISTÓRIA de 05/08 — testado por ele, ao vivo, contra o banco de produção:** XML de
nota de serviço → rejeitado com aviso claro. XML já processado → "nota já está no
sistema", sem erro técnico. XML de nota nova (sintética, "EMPRESA TESTE") → importou,
CFOP lido, insumo criado e vinculado, estoque foi a 10 KG. Excluiu a nota → estoque
voltou a **exatamente 0** (achado 3, transação atômica) e o gasto de R$ 50 **sumiu do
Financeiro** (achado 1, lançamento fantasma) — sem sobrar rastro nos dois casos. Os 5
críticos + 2 bloqueantes das revisões do Apolo estão confirmados na prática, não só em
teste automatizado.

⚠️ Railway e Vercel fazem deploy automático no push — **não confirmado de fora** que os
dois já servem o código novo (mesmo padrão de incerteza da Fase 2 de contas a pagar em
31/07).

## Estoque: fazenda_id nas gravações manuais — no ar desde 06/08/2026

**PR #49 mergeado** (`3309300`, squash), branch `claude/nervous-torvalds-4a56e7`
apagada. Achado independente do bug de isolamento por fazenda do PR #48: em
`web/app/(app)/estoque/hooks/use-estoque-data.ts`, 5 gravações (`ajustarEstoque`,
`criarInsumo`, `converterUnidade`) não mandavam `fazenda_id` (coluna `NOT NULL` sem
padrão, regra de permissão do banco exige o valor) e nenhuma conferia erro de retorno —
falha muda. Sintoma: saldo mudava na tela, o histórico que deveria explicar por quê
nunca era gravado.

**3 rodadas de revisão do Apolo**, cada uma achando problema na correção da anterior:
(1) `fazenda_id` ausente + falha muda; (2) estado parcial em falha de rede — converter
unidade podia trocar o rótulo sem a quantidade, cadastrar insumo podia deixar produto
"fantasma" preso pelo índice único de nome; (3) a própria correção do item 2 podia
deixar a tela desatualizada quando só o histórico falhava por último, arriscando
repetir a operação. Confirmado em produção (`SELECT ... FROM pg_policies`) que as 3
tabelas têm política `FOR ALL` — as compensações (desfazer o passo anterior) têm
permissão pra funcionar.

⚠️ **Não testado ao vivo** (diferente do PR #46/#48) — só revisão de código + `tsc
--noEmit` limpo. Vercel/Railway fazem deploy automático no push; não confirmado de
fora que o ar já serve este código.

## Operações: fazenda_id condicional na exclusão — no ar desde 06/08/2026

**PR #51 mergeado** (`7c8cddd`, squash), branch `claude/zen-mayer-9a5a06` apagada
(local e remota). Achado pelo Apolo durante a correção do Estoque (seção anterior),
enquanto ele lia `use-estoque-data.ts` em busca de padrões repetidos — mesma família
dos dois bugs acima (PR #48 e #49).

Em `web/app/(app)/operacoes/page.tsx`, função `confirmarDeleteOp` (apaga uma operação e
devolve os produtos usados ao estoque): o insert em `movimentacoes_estoque` mandava
`fazenda_id` só condicionalmente — mesmo sintoma dos outros dois, saldo mudava sem o
registro que explica por quê.

**4 rodadas de revisão do Apolo**, cada uma achando problema na correção da anterior:
(1) `fazenda_id` condicional → obrigatório + guarda de `fazendaAtiva`; (2) delete da
operação e update do saldo sem checar erro → checados (decisão do Matheus: resolver só
isso agora, sem função no banco — ver adiados abaixo); (3) a própria correção do item 2
introduziu 3 bugs (variável de controle ligando tarde, `return` de erro sem recarregar
os dados, botão "Excluir" continuando clicável depois de erro parcial) → corrigidos;
(4) comentário prometendo trava permanente que o código não entregava + mensagem de
erro antiga não sendo limpa ao abrir nova tentativa → 2 ajustes triviais.

**Confirmado com o Matheus rodando SQL no Supabase:** `itens_operacao_operacao_id_fkey`
tem `confdeltype = c` (cascata) — apagar uma operação apaga os itens vinculados
automaticamente, sem risco de exclusão travada por vínculo.

⚠️ **Não testado ao vivo** — só revisão de código + `tsc --noEmit` limpo antes e depois
do merge com `main`. Deploy de teste do PR (Vercel) passou; não confirmado de fora que
o ar em produção já serve este código.

**Adiado de propósito, decisão do Matheus ("só o mínimo agora") — vira tarefa quando
ele quiser:**
- função no banco "tudo ou nada" para a exclusão inteira (igual à da migração 009 de
  excluir nota fiscal) — sem ela, ainda é fisicamente possível parar no meio com
  devolução parcial gravada (mensagem de erro avisa e trava o botão, mas não impede);
- mesmo bug de fundo (sem registro de movimentação) na **edição** de operação
  (`handleSubmit`), que é **mais grave** que o da exclusão: cada edição de operação
  salva empilha uma "saída fantasma" no histórico, porque a devolução ao ajustar
  quantidade não grava movimentação nenhuma;
- corrida entre ler e gravar o saldo (`select` + `update` em dois passos) — o projeto já
  tem a função `incrementar_estoque` pronta pra isso, mas ela não é usada aqui; usá-la
  exige antes conferir se está liberada para o navegador sem risco de fazenda cruzada;
- travar o diálogo de exclusão contra fechar por Esc/clique fora durante o processamento;
- origem da devolução gravada como `'manual'` em vez de `'operacao'` + `operacao_id` —
  dificulta distinguir, no histórico do Estoque, uma devolução de exclusão com erro
  parcial de um ajuste manual comum.

## CFOP de entrega futura — no ar desde 04/08/2026

**PR #45 mergeado** (`d76f413`, squash). Migrações `007` (coluna `cfop`) e `008`
(coluna `conta_como_compra`) rodadas em produção ANTES do merge — assim a ordem
Vercel/Railway deixou de importar. HISTÓRIA de 04/08: 176 testes verdes, `tsc --noEmit`
limpo nos dois projetos (para o número de hoje, rode a suíte).

O sistema lê o CFOP de cada item da NF-e e decide, **por item**: entra no estoque?
conta como compra? custo zero? A regra pura vive em `api/src/services/contas/cfop.ts` —
conferida contra a tabela oficial brasileira (Convênio SINIEF s/nº de 1970).

**Prova de ponta a ponta contra os 4 XMLs reais** (`.tmp/notas-exemplo/`):
o comando que mede está em `docs/superpowers/plans/2026-08-03-nfe-cfop-entrega-futura.md`,
Task 6 Step 2 — mas ele quebra como escrito: `nfeProcessor.ts` importa `./supabase`,
que lança sem credencial, e **não existe `api/.env`** (o `.env` está na raiz). Rodar com
`$env:SUPABASE_URL='https://exemplo.invalido'; $env:SUPABASE_SERVICE_KEY='conferencia-local'`.

## Contas a pagar — Fases 1 e 2 no ar desde 31/07/2026

PR #43 juntado (`f3b614d`) e PR #44 juntado com squash (`d5d122f`); migrações rodadas
em produção (6/6 conferências), Vercel READY, `/contas` → 401 no Railway, API
respondendo `{"status":"ok"}`. **Ele testou o fluxo inteiro em produção e passou**,
incluindo a conferência que mais importava — o gasto aparece no Financeiro ao marcar
pago e some ao desfazer.

**Sem conta real cadastrada ainda:** ele espera o banco liberar o acesso dele para
começar a pagar. Sem regra cadastrada o job das 07:00 não grava nada e não manda
mensagem — silêncio é resposta válida no desenho, então **nada urge**.

✅ Já decidido no desenho: Financeiro e painel **não mudam** (respondem "quanto custou
a safra", na data da nota); a agenda responde "quanto sai do banco e quando". Duas
perguntas diferentes, não duas verdades.

Detalhe, riscos e defeitos achados nas revisões: **corpo do PR** e
`.superpowers/sdd/2026-07-31-contas-a-pagar-fase2/progress.md` — não copie para cá.

## Financeiro: botão "Adicionar" volta a salvar — no ar desde 06/08/2026

**PR #50 mergeado** (`267a8f5`... squash) — https://github.com/diretorpc/agromouro/pull/50.
O lançamento manual da tela Financeiro falhava em silêncio (sem `fazenda_id` nos
`insert` de `insumos`/`itens_nfe`, mensagem de erro genérica escondendo o motivo,
categoria escolhida descartada quando o produto já existia no catálogo).

**Migração 014** (4 categorias que faltavam: `adjuvante`, `manutencao`, `alimentacao`,
`outros`) e **migração 015** (coluna `data_manual` em `itens_nfe`, que nunca tinha sido
criada) — **as duas já aplicadas e testadas em produção**, confirmado pelo PR.

**Migração 016** (RLS de UPDATE em `itens_nfe`, que deixava qualquer usuário logado
editar item de nota fiscal de outra fazenda) — **aplicada em produção em 07/08/2026**,
`SQL Editor` do Supabase, sem erro.

## Duplicata vazia de NF-e não gera mais boleto/gasto fantasma — no ar desde 06/08/2026

**PR #54 mergeado** (squash `7e8474a`), branch `claude/dazzling-nightingale-aebd93`
apagada (local e remota). Achado original do Apolo: quando o quadro de cobrança
(`<dup>`) de uma nota vinha com TODAS as parcelas completamente vazias (sem vencimento
e sem valor — só o número de controle), o sistema tratava isso como cobrança real.
Provado com a nota real da SYAGRI (CFOP 5117, tPag `90`, R$ 1.060.000): gerava boleto
fantasma sem vencimento, lançava o mesmo valor como gasto fantasma no Financeiro, e a
mensagem do WhatsApp sobre boleto ficava muda.

**Correção:** nova função `duplicataEhReal()` (vencimento OU valor > 0 finito) decide,
nos TRÊS lugares que perguntavam "essa nota cobra de verdade?" — o boleto
(`contasDaNota`/`parcelasDescartadasDaNota` em `deNotaFiscal.ts`), a mensagem do
WhatsApp e o lançamento financeiro (os dois em `nfeProcessor.ts`) — a mesma resposta.
Quando nenhuma duplicata é real, a nota é tratada como se não tivesse quadro de
cobrança (mesmo caminho do caso ERCAL): uma conta só, sem data, com o valor TOTAL da
nota — em vez de um valor nulo perdido à toa.

**5 rodadas de revisão do Apolo, cada uma achando e fechando um problema real antes da
próxima** (histórico completo, achado por achado, no PR #54 — não repetir aqui):
boleto fantasma → NaN/valor zero escapando → mensagem do WhatsApp muda → **gasto
fantasma no Financeiro** (o achado mais sério, mesma causa raiz, aprovado pelo Matheus
para entrar no mesmo commit em vez de virar tarefa separada) → confirmação final,
testada quebrando cada correção de propósito para provar que os testes protegem.

HISTÓRIA de 06/08: 209 testes de toda a API passam, `tsc --noEmit` limpo (rebase sobre
o PR #53, que tinha mexido nos mesmos 2 arquivos, sem conflito de comportamento — só
um conflito de posição de teste, resolvido mantendo os dois blocos).

✅ **Conferido no Supabase (06/08, pelo Matheus): zero linhas.** Nenhuma conta antiga
ficou com o defeito gravado — nada a corrigir no banco. Consulta usada, pra reconferir
se precisar no futuro (ex: depois de restaurar um dump antigo):
```sql
SELECT id, descricao, fornecedor, competencia, valor, nota_fiscal_id
FROM contas_a_pagar
WHERE nota_fiscal_id IS NOT NULL AND vencimento IS NULL AND valor IS NULL
ORDER BY competencia;
```

## Contas a pagar: tPag 16/19/21 avaliados e DELIBERADAMENTE NÃO mapeados — no ar desde 06/08/2026

**PR [#53](https://github.com/diretorpc/agromouro/pull/53) mergeado na `main`** (squash,
commit `267a8f5`), branch `claude/serene-kepler-985de0` apagada (local e remota).
CI (Vercel) passou antes do merge.

Pedido original citava um caso de produção ("Usina Uberaba", NF 16246, R$ 88.939,27)
como motivo para os códigos `17`/`18` — **investigado e não confirmado** (sem rastro em
`git log --all`; `17`/`18`/`20` nunca existiram no arquivo). Tratado como pedido novo.

**Tentativa 1:** `16` (depósito), `19` (cashback), `21` (crédito em loja) confirmados
contra a tabela oficial de `tPag` da NF-e e adicionados a `MOTIVO_SEM_BOLETO`, fora de
`CODIGOS_QUE_CEDEM_A_DUPLICATA`. **Apolo achado crítico:** em nota de pagamento misto
(mais de um `<detPag>`), o parser só lê o primeiro — `19`/`21` são pagamento parcial por
natureza, então um boleto real podia sumir dependendo da ordem em que o fornecedor
escreveu o XML. `16` tratado como "já pago" quando na real pode vencer no futuro igual
boleto.

**Tentativa 2:** `16`/`19`/`21` acrescentados também a `CODIGOS_QUE_CEDEM_A_DUPLICATA`
(mesmo mecanismo que já protege o `90`). Resolveu o caso COM duplicata preenchida.
**Apolo achou o mesmo risco no caminho SEM duplicata:** nota sem quadro de cobrança
nenhum com esses códigos virava "nada a pagar" — reproduzindo o padrão real do caso
ERCAL (`nfeProcessor.ts:249`: tPag 15, zero duplicata, boleto real de R$ 8.258,40).
Sem ler `vPag` (valor efetivamente pago, campo do XML que o parser não lê), não dá pra
saber se esses créditos cobrem a nota inteira.

**Decisão do Matheus, depois do trade-off explicado:** reverter os 3 códigos por
completo (opção "voltar ao seguro" — sistema sempre gera boleto quando o código não é
um dos já mapeados, dispensa com 1 toque se for falso alarme). `MOTIVO_SEM_BOLETO` e
`CODIGOS_QUE_CEDEM_A_DUPLICATA` voltaram ao estado original. Ficou um comentário no
código (`deNotaFiscal.ts`) explicando a decisão pra próxima pessoa não repetir a
tentativa sem primeiro resolver a raiz, + testes travando que `16/19/21` seguem o
caminho padrão "na dúvida, gera boleto".

197 testes de toda a API passam, `tsc --noEmit` limpo (rodado na 3ª rodada).

## Reorganização da tela `/estoque` — no ar desde 06/08/2026

PR #47 mergeado (squash `c66289d`), branch e worktree limpos. Virou abas
Produtos/Histórico, ordenar por data de entrada (clicando no cabeçalho da coluna, nas
duas abas), Excluir escondido atrás de um menu "⋯", arquivo de ~1000 linhas quebrado em
hooks + componentes. 13 tarefas + revisão final + 1 adicional, tudo via
subagent-driven-development num worktree isolado (nunca tocou a `main` até o merge).
Migração `010_estoque_created_at.sql` aplicada em produção e confirmada por ele
(`sem_entrada_registrada=0` de `71`). Testado logado por ele antes do merge.
Detalhe completo: `docs/superpowers/plans/2026-08-05-reorganizacao-estoque.md`.

O achado fora do escopo desta obra — `GET /estoque` não filtrava por `fazenda_id` —
**foi resolvido no PR #48**, seção acima. Nada pendente aqui.

---

# 2. ABERTO — o que precisa de decisão ou de trabalho

## Financeiro: origem "Conta paga" sem nome de fornecedor — corrigido, aguardando revisão e conferência visual — 18/08/2026

Pedido do Matheus: lançamento vindo de conta a pagar quitada (`lancamentos_financeiros`
com `origem = 'conta'`) mostrava só o crachá genérico "Conta paga" na coluna Origem da
tela Financeiro — diferente dos lançamentos de NF-e, que mostram o nome do fornecedor.

**Descoberta:** o backend (`api/src/services/contas/pagamento.ts`, função
`montarLancamento`) já grava o fornecedor dentro do campo `descricao`, no formato
`"FORNECEDOR — resto da descrição"` (separador é espaço + em-dash U+2014 + espaço) —
intencional, só nunca foi separado de volta na tela.

**Corrigido só no frontend, sem migration:** `web/app/(app)/financeiro/page.tsx` ganhou
`separarFornecedorDaConta()`, que separa o texto pelo `indexOf(' — ')`. Fornecedor vai
pra coluna Origem (mesmo estilo visual da NF-e: nome em negrito + "Conta paga" pequeno
embaixo); o resto fica em Produto/Serviço, sem repetir o fornecedor. Se o separador não
existir na descrição (registro sem fornecedor gravado), cai no comportamento antigo —
não quebra nada.

**Verificado:** função testada isolada em Node com 3 casos reais (Ube Terra, Pneuzão,
sem fornecedor) — bateu certo. `npx tsc --noEmit` limpo. Matheus conferiu ao vivo no
navegador (`http://localhost:3005/financeiro`) em 18/08 — confirmou que ficou certo.

**Próximo passo:** aguardar revisão do Apolo (convocada, ainda rodando). Depois disso:
commit + PR na branch `fix/financeiro-origem-conta-paga`.

## Aba "Controle" (gastos defensivos/adubos/sementes) — Epic 2.4 (tela) em execução via SDD — atualizado 17/08/2026

⚠️ **Este bloco estava desatualizado — reescrito do zero em 17/08 depois de o
Matheus perguntar "qual a próxima epic?" e a resposta revelar que ninguém tinha
mantido este arquivo em dia.** O texto anterior dizia "nada commitado ainda"; na
verdade o trabalho avançou bastante numa worktree separada. **Detalhe completo,
histórico de revisão do Apolo e comandos pra reconferir vivem no `ESTADO.md` DENTRO
da worktree** (regra do próprio arquivo: detalhe mora perto do código, aqui só a
frase-resumo) — não copiado pra cá de propósito, pra não discordar depois:
`C:\Users\Dib\Projetos\pessoal\agromouro-base\.claude\worktrees\ou-e5b8ce\ESTADO.md`

Trabalho inteiro na branch `feature/controle-gastos`, dentro dessa worktree — **a
checkout principal (aqui) continua limpa, na `main`, sem nada disso**. Ainda não
subiu pro GitHub.

**Prontas e commitadas (Epics 1.1 a 2.3 — migration 017+018, bucket, leitor de PDF,
gravação com dedupe, rotas da API):** todas revisadas várias vezes pelo Apolo,
incluindo 2 achados críticos de dinheiro dobrando (já corrigidos) e teste de
isolamento por fazenda com mutação de código real. Migration 017 **e** 018 já
aplicadas em produção, confirmadas pelo Matheus rodando as consultas de verificação.

**Em execução agora: Epic 2.4 (a tela `/controle`)**, via
`superpowers:subagent-driven-development` — 8 tarefas planejadas
(`docs/superpowers/plans/2026-08-17-controle-tela.md`, dentro da worktree), ledger de
progresso em `.superpowers/sdd/2026-08-17-controle-tela/progress.md`. Tasks 1-3
prontas e aprovadas (rota de filtros, paginação/filtro no `GET /controle/documentos`,
tipos do frontend); Task 4 (hook `use-controle-data.ts`) com 1 achado "importante" em
correção (possível bloqueio de pop-up ao abrir o PDF — `window.open` depois de um
`await` perde o gesto de clique em alguns navegadores).

**Próximo passo:** terminar as tasks 4-8 (fix da Task 4, depois componentes de UI —
filtro por coluna estilo Excel, tabela com células mescladas, diálogo de upload,
página + item no menu), revisão final do branch, e então push.

## Leitor de NFS-e (nota de serviço) — codado em 17/08/2026, 5 rodadas de revisão do Apolo feitas

**Estado:** Migração 011 JÁ APLICADA em produção e confirmada pela API (17/08, 12h20).
5 rodadas de revisão do Apolo — 1ª achou 8 pontos (2 altos), 2ª achou mais 1 alto + 3
menores (sobre os consertos dos 2 altos), 3ª confirmou o CÓDIGO limpo, 4ª e 5ª reabriram
só a PARTE DE TEXTO/DECISÃO do achado 9 (nenhuma achou defeito de código novo). Checagem
do e-mail da SITRACK já feita (achado 9: manda ZIP, fora do escopo abrir automaticamente —
fica manual mesmo, decisão do Matheus). Falta só `git push`. `cd api && npx vitest run`
e `npx tsc --noEmit` para medir o estado atual — não copiar número de teste para cá.

**⚠️ TRAVA DE ORDEM DE DEPLOY — LER ANTES DE DAR PUSH.** O código novo grava e filtra por
uma coluna `modelo` em `notas_fiscais` que **AINDA NÃO EXISTE em produção** — só existe
como migração escrita (`supabase/migrations/011_notas_fiscais_modelo.sql`), não aplicada.
Se este código subir pro Railway ANTES da migração rodar no Supabase, **toda gravação de
NF-e para de funcionar** (não só NFS-e) — `column modelo does not exist` em todo insert.
**Ordem obrigatória:** 1) rodar a migração 011 no SQL Editor do Supabase, 2) só depois
`git push`.

**E se a ordem for invertida, o erro é MUDO.** `nfeEmailWebhook.ts` responde `200 OK` pro
Make **antes** de processar o XML (linha 8, `res.status(200).json(...)`) — é assim de
propósito, pra não deixar o Make esperando. Mas isso quer dizer que, se o código subir
antes da migração, o `column modelo does not exist` acontece DEPOIS do 200 já ter sido
enviado: o Make marca como entregue e não reenvia, o erro vai só pro `console.error` do
Railway (ninguém olha isso em tempo real), e a nota inteira desaparece sem aviso nenhum —
nem pro Matheus, nem pro sistema. Mais um motivo pra respeitar a ordem acima à risca.

**O gatilho.** Matheus tentou subir pelo upload manual a NFS-e da SITRACK (mensalidade
do rastreador de frota, R$ 124) e o sistema recusou como "inválido" — o leitor só
conhecia NF-e de produto (raiz `<NFe>`). NFS-e é outro formato inteiro (raiz `<NFSe>`,
sem `<det>`/CFOP/NCM, sem `<cobr><dup>` de vencimento).

**O que foi feito (base).** `nfeProcessor.ts` ganhou `parseXmlNFSe()` (devolve o mesmo
formato `NFeData`, com item sintético único representando o serviço) e `parseXmlNota()`
(tenta NF-e primeiro, cai pra NFS-e). Os 3 lugares que liam nota fiscal — upload manual
(`nfeManual.ts`), webhook do Make (`nfeEmailWebhook.ts`) e o job que lê IMAP direto a
cada 30 min (`jobs/nfeEmail.ts`) — trocaram para `parseXmlNota`; o job também ganhou
`isNFSeXml()` companheiro do `isNFeXml()` que já existia.

**Achados da 1ª revisão do Apolo, e o que foi feito com cada um:**

1. **[ALTO, consertado]** Item de NFS-e (cfop/ncm vazios) caía na mesma cascata de uma
   NF-e sem CFOP/NCM — "compra normal, estocável até prova em contrário" — e a única
   prova em contrário era a IA (Haiku) classificando a descrição. Provado rodando
   `processarNFe` de verdade: virou insumo fantasma e somou estoque. Corrigido com um
   campo `servico: true` no item, que vence a cascata inteira sem perguntar pra IA — o
   PARSER já sabe que é serviço (soube ler `<NFSe>`, não `<NFe>`), não precisa adivinhar.
2. **[ALTO, consertado — código + migração + dado]** Número de NF-e e de NFS-e são
   sequências INDEPENDENTES do mesmo fornecedor — a trava de duplicidade (só
   numero+cnpj+fazenda) faria a NF-e nº 500 e a NFS-e nº 500 do mesmo emitente colidirem,
   e a segunda seria descartada em silêncio. **Decisão do Matheus, 17/08: consertar com
   migração agora, não só registrar o risco.** `NFeData` ganhou `modelo: 'nfe'|'nfse'`
   (obrigatório), migração `011_notas_fiscais_modelo.sql` (coluna + índice único novo:
   numero+cnpj+fazenda+modelo), e os 6 pontos que comparam nota por essa chave
   (`nfeJaProcessada`, `idDaNotaQueLancouGasto`, 2 buscas em `nfeManual.ts`) ganharam o
   filtro por `modelo`. **Migração escrita, NÃO aplicada em produção ainda** (ver trava
   de ordem de deploy acima).
5. **[médio, consertado]** `valorTotal` podia virar `NaN` sem ser pego (`??` não pega tag
   vazia, `NaN <= 0` é `false`) — cobrança ficaria sem valor E sem vencimento. Corrigido
   com `paraNumeroOuNull()` (`Number.isFinite`).
8. **[baixo, consertado]** Descrição só com espaço virava `''` depois do trim e caía
   DEPOIS do `??`, então não pegava o fallback "Serviço" — item sem nome que caísse no
   caminho estocável casaria com QUALQUER insumo (`.ilike('%%')`). Corrigido: `|| 'Serviço'`
   movido para depois do `.trim()`.
3+4. **[alto, consertado — código + dado, mesmo movimento]** `parseXmlNFe` (parser
   ANTIGO, já em produção — bug não relacionado ao pedido de hoje, achado sem querer
   procurar) tinha a MESMA falha do zero à esquerda em CNPJ/CPF. **Decisão do Matheus,
   17/08: consertar agora também.** Código: mesmo `numberParseOptions:{leadingZeros:false}`
   aplicado ao parser antigo. Dado: medido em produção via script (não SQL Editor — sem
   `DATABASE_URL` no `.env`, só o client do Supabase) — **129 notas no total, 39 com CNPJ
   corrompido** (36 perderam 1 zero, 3 perderam 2). Reparado com `.padStart(14,'0')` em
   cada linha — reversão exata, porque o bug só remove zero da frente, nunca dígito do
   meio ou do fim. **Já aplicado e conferido: as 129 notas têm 14 dígitos agora.** Script
   descartado depois (não fica no repo — era de uso único).
   **Limite do reparo:** `.padStart(14,'0')` só é uma reversão exata para **CNPJ** (14
   dígitos sempre). Não foi usado em CPF (11 dígitos) — não apareceu nenhum caso na
   amostra de 17/08, mas se aparecer, o mesmo `.padStart(14,'0')` aplicado a um CPF
   mutilado alongaria o número errado para 14 dígitos em vez de 11, piorando o dado em
   vez de corrigi-lo. Registrar o limite aqui porque o script já foi descartado.
   **Retrato de 17/08/2026 — quem foi corrigido, pelo nome como veio na nota** (8
   fornecedores, não 6 — a 1ª versão deste registro errou a contagem, achado do Apolo
   na 2ª revisão): USINA UBERABA, SYAGRI (2 filiais — CNPJ terminado em `000191` e em
   `000272`), PROTEC, TERRA AGRÍCOLA, CULTURA, FERNANDES E TAKAO, IPESA DO BRASIL. Esta
   lista é histórica e **não é mais recalculável ao vivo** (o script de reparo era de uso
   único e já rodou — os CNPJs já estão certos em produção, não sobrou "estado errado"
   para reconsultar). Para reconferir que o reparo continua valendo hoje (sem mais nada
   corrompido), a pergunta certa ao banco é: `SELECT emitente_nome, emitente_cnpj FROM
   notas_fiscais WHERE length(emitente_cnpj) NOT IN (11, 14)` — hoje deve devolver zero
   linhas.
6. **[baixo, documentado, sem código]** O leitor de NFS-e só entende o layout NACIONAL
   (raiz `NFSe/infNFSe`). Município que ainda emite em ABRASF (`CompNfse`/`Nfse`/`InfNfse`)
   continua sendo recusado — não é bug, é fronteira ainda não coberta. Amostra até
   17/08: 1 nota (SITRACK).
7. **[baixo, documentado, sem código]** `valorTotal` usa `vLiq` (líquido). Se um dia
   aparecer prestador com retenção de ISS de verdade, `vLiq` é o que se PAGA, não o custo
   total — gasto sairia subdimensionado. Não é o caso da SITRACK (ISS embutido, tomador
   CPF). Comentário deixado no código para quando aparecer o primeiro caso.

**Achados da 2ª rodada (sobre os consertos dos achados 1 e 2 acima) — 3ª confirmou o código; 4ª e 5ª reabriram só a parte de texto/decisão:**

9. **[ALTO, consertado — DADO, não código]** A NFS-e da SITRACK (a nota que motivou este
   trabalho inteiro) cai no caminho "conta sem vencimento" — e o probe achou que já existe
   em produção uma conta **RECORRENTE** da SITRACK (R$124/mês, dia 20, cadastrada em
   10/08), com 3 ocorrências JÁ CRIADAS em `contas_a_pagar`: agosto (R$124, **aberta**,
   vence 20/08), setembro e outubro (sem valor ainda, `aguardando`, vencem 20/09 e 20/10).
   Se a nota entrasse sem mais nada, nasceria uma SEGUNDA cobrança pro mesmo
   fornecedor/mês/valor — e como a recorrente não tem `nota_fiscal_id`, ela CRIA
   lançamento financeiro ao ser paga: pagar as duas dobra o GASTO de verdade (Financeiro
   E Dashboard), não só o boleto. Uma tarja de aviso na tela (código, 1ª tentativa) **não
   bastava** — dispensar a conta errada (a nova, em vez da recorrente) deixava as duas
   telas de dinheiro mostrando o dobro do gasto do mesmo jeito. **Decisão do Matheus,
   17/08: desligar só a regra recorrente (`contas_recorrentes.ativa = false`, id
   `8c0278e4-…`), sem apagar as 3 contas que ela já tinha criado** — feito direto em
   produção via script (mesma abordagem do reparo de CNPJ).

   **⚠️ Correção da 5ª revisão — desligar a regra NÃO apaga o lembrete até novembro.**
   `sincronizarOcorrencias` já tinha criado as 3 ocorrências ANTES de a regra ser
   desligada — elas continuam em `contas_a_pagar` e o aviso diário das 07:00 continua
   listando agosto/setembro/outubro normalmente (`reais(null)` vira "valor a definir").
   O lembrete só some de fato a partir de novembro/2026, quando a regra desligada deixa
   de gerar ocorrência nova.

   **Checagem de "a NFS-e chega sozinha por e-mail" — RESPONDIDA (17/08, confirmado pelo
   Matheus): NÃO chega sozinha, e o motivo é pior do que "só manda PDF".** O e-mail da
   SITRACK manda um **ZIP** (XML + boleto + nota juntos no mesmo arquivo compactado).
   `isNFeXml()`/`isNFSeXml()` (`jobs/nfeEmail.ts`) só reconhecem anexo `.xml` ou `.pdf`
   soltos — **nenhum lugar do código abre `.zip`**, então mesmo com a coluna `modelo` e
   o parser de NFS-e prontos, este fornecedor específico NUNCA vai entrar sozinho
   enquanto isso não for construído (extrair o zip é tarefa nova, fora do escopo de
   hoje — não é bug do trabalho desta sessão, é um formato que o pipeline de e-mail
   nunca tratou, nem pra NF-e). **Decisão do Matheus: continuar extraindo o XML do zip
   e subindo pelo upload manual todo mês** — é exatamente o que o botão "Adicionar NF →
   Upload XML" resolve. A regra recorrente (`8c0278e4-…`) fica desligada porque ele sabe
   que vai lançar à mão; se algum mês esquecer, não sobra lembrete automático — ele
   está ciente da troca.

   **Decisão do Matheus sobre a conta de agosto (17/08):** fica como está — ele vai
   **pagar ela normalmente e NÃO subir o XML de agosto da SITRACK** (evita o dobro: pagar
   a conta velha + lançar a nota nova pro mesmo mês). A NFS-e só começa a ser enviada a
   partir de **setembro**.
   **⚠️ Se subir o XML de agosto por engano DEPOIS de já ter pago a recorrente:**
   "dispensar" a conta nova NÃO desfaz o pagamento antigo — o lançamento de R$124 já
   pago fica lá do mesmo jeito, e o Financeiro/Dashboard mostram R$248. Antes de
   dispensar qualquer coisa, ir em `/contas`, achar o pagamento da recorrente de agosto e
   clicar **"Desfazer pagamento"** primeiro — só depois disso dispensar sobra sem gasto
   dobrado. Achado [alto] da 5ª revisão do Apolo.

   **As contas de setembro e outubro (ainda sem valor) — AÇÃO COM DATA, não "depois":**
   até **19/09/2026**, antes de pagar a recorrente de setembro, decidir: se a NFS-e de
   setembro já tiver chegado no sistema, **dispensar a conta da recorrente de setembro**
   (mesma lógica de agosto). Se não tiver chegado, pagar a recorrente normalmente e não
   subir a NFS-e de setembro depois. Mesma decisão pra outubro, até **18/10/2026**. Achado
   [alto] da 5ª revisão — a versão anterior deste registro dizia só "decide depois, na
   tela", sem dono nem data, e era justamente aqui que o gasto dobrava de verdade.
10. **[médio, consertado]** O aviso de "confira conta recorrente" só alcançava a coluna
    `observacao` da tela — nunca o WhatsApp, que é o canal que o dono lê primeiro. Nova
    função `linhaServicoSemRecorrencia()` em `avisoBoleto.ts`, mesmo padrão de
    `linhaBoletoContraOCodigo()` já existente. Texto ajustado nas duas pontas (tela e
    WhatsApp) pra nomear a AÇÃO CERTA — "dispense A RECORRENTE (não esta)" — porque a
    tarja irmã termina com "dispense esta conta", e copiar esse padrão aprendido
    dispensaria o lado errado.
11. **[baixo, aceito, sem código]** A tarja de "confira conta recorrente" dispara em
    TODA NFS-e sem vencimento, tenha ou não conta recorrente de verdade — hoje o volume é
    1 fornecedor conhecido (SITRACK), então o barulho é zero na prática. Se aparecer uma
    2ª NFS-e de outro fornecedor, revisitar: mover a decisão pra `gravarDeNota.ts`
    (que já é async) e consultar `contas_a_pagar` por recorrente do mesmo fornecedor/mês
    antes de carimbar — detectar e avisar, não casar automaticamente (casar errado é pior
    que avisar demais).

**Decisão registrada:** NFS-e sem vencimento no XML (a maioria — confirmado que o campo
só existe pra nota de aluguel de imóvel) cai no mesmo comportamento que nota de produto
sem duplicata: vira conta a pagar SEM DATA em Contas a Pagar, o dono confirma a data à
mão. Decisão do Matheus, 17/08 — não programar leitura de vencimento pra esse caso raro.

## ✅ A duplicata passa a vencer o tPag — ENVIADO em 14/08/2026

**Estado:** commit `cb7e531` (+ `4215b0b` de registro) na `main`, enviado ao GitHub pelo
Matheus às ~15:59 de 14/08. Revisado 2x pelo Apolo antes de subir. Deploy do Railway é
automático a partir da `main`.

**Falta a prova em produção:** ninguém viu isto rodando com nota de verdade ainda. A
confirmação vem sozinha na próxima NF-e que chegar com forma de pagamento de cartão ou
crédito da loja — o boleto deve nascer em Contas a Pagar com a tarja âmbar "Conferir
antes de pagar". Até lá, funciona só em teste.

**O defeito, medido com nota real.** A NF-e 76593 (HIGA COMERCIO E DISTRIBUICAO,
R$ 642,22, emitida e processada em 03/08/2026) trazia quadro de cobrança de verdade no
XML — `<dup>` com `dVenc` 2026-09-02 e `vDup` 642,22, e `Cnd.Pag:A PRAZO` no campo
livre. O parser leu a duplicata certinho. Quem jogou fora foi a REGRA: tPag `05`
("crédito da loja") estava em `MOTIVO_SEM_BOLETO` e fora de `CODIGOS_QUE_CEDEM_A_DUPLICATA`
(só `17`/`18`/`20`/`90` cediam). O boleto sumiu e o WhatsApp mandou
*"💳 Sem boleto — a nota diz crédito da loja"* — conclusão errada com cara de certa. O
Matheus só descobriu em 14/08, ao achar o PDF do boleto no e-mail: 11 dias de silêncio.

A regra antiga tinha sido escrita em 04/08 com **uma amostra só** (METAL AGRÍCOLA nota
51843, que usou `05` para o que o texto livre chamava de cartão de crédito). A HIGA usa
o mesmo código para carnê a prazo. É o risco de generalizar de uma amostra: tPag
descreve o MEIO de pagamento, não o MOMENTO, e cada fornecedor preenche do seu jeito.

**A correção (decisão do Matheus, 14/08, escolhida entre 2 opções apresentadas):**
duplicata real vence QUALQUER tPag. `CODIGOS_QUE_CEDEM_A_DUPLICATA` deixou de existir;
`motivoSemBoletoDaNota()` devolve `null` sempre que houver duplicata real. O mapa
`MOTIVO_SEM_BOLETO` continua existindo, mas só decide nota SEM quadro de cobrança.

**A contrapartida, no mesmo trabalho** — troca um erro caro (boleto perdido) por um
barato (boleto a mais), e barato só continua barato se o dono souber na hora. Nova
`motivoVencidoPelaDuplicata()` (`deNotaFiscal.ts`) alimenta **três** lugares, não um:

1. **WhatsApp da nota** — `linhaBoletoContraOCodigo()` (`avisoBoleto.ts`) acrescenta
   *"👀 Confira este boleto: a nota diz crédito da loja, mas veio com cobrança marcada…"*.
   `linhaBoleto()` ganhou um 6º parâmetro opcional para isso.
2. **A própria conta** — `observacaoDoBoletoContraOCodigo()` grava o aviso na coluna
   `observacao` (`gravarDeNota.ts`), e a tela de Contas mostra em âmbar na linha.
3. **Resumo diário** — `marcaConferir()` (`resumo.ts`) põe *"👀 confira antes de pagar"*
   na linha da conta, mais o link da tela no rodapé; a lista de colunas que o job lê
   virou `COLUNAS_CONTA_RESUMO`, exportada de `resumo.ts` e travada por teste.

**O aviso NÃO vale para tPag `17`/`18`/`20`/`90`** (PIX, transferência, "sem pagamento"),
via `CODIGOS_QUE_JA_CEDIAM_ANTES`. Esses já cediam à duplicata desde 06/08 — ali ela
sempre foi cobrança de verdade (revenda que embute o boleto na nota de remessa). Dizer
"pode já ter sido pago, dispense" numa dessas empurraria o Matheus a dispensar o boleto
mais caro do sistema: a SYAGRI de R$ 1.060.000 é tPag `90`, e remessa não tem fatura de
cartão. Achado [alto] da 2ª rodada do Apolo, pego antes de ir pro ar.

**Só o texto que começa com `PREFIXO_CONFERIR`** (`'Conferir antes de pagar:'`) vira
alerta na tela e no resumo — nunca "tem observação". A coluna é campo livre e já guarda
nota de auditoria escrita à mão em produção (conta `c0fbe499…`: *"Dispensada em
04/08/2026: cobrança duplicada"*). A constante está repetida nos dois lados
(`deNotaFiscal.ts` e `web/app/(app)/contas/tipos.ts`) porque o front não importa do back
— **mudar o texto exige mexer nos dois**.

Os itens 2 e 3 vieram do **achado [alto] do Apolo**: a mensagem da nota é enviada uma
vez, para um número só, e a falha de envio é engolida com `console.error`. Sem persistir,
o resumo diário cobraria esse boleto como *"🔴 urgente"* todo dia sem ressalva nenhuma —
e se o Matheus pagasse, o dinheiro sairia duas vezes **sem aparecer em lugar nenhum do
sistema** (`precisaCriarLancamento` devolve `false` para conta de nota, então o Financeiro
continuaria batendo certinho; só o extrato do banco ficaria errado).

`duplicataEhReal()` **não** mudou — o caso SYAGRI (duplicata vazia, R$ 1.060.000)
continua protegido pelo mesmo critério de 06/08.

Arquivos: `api/src/services/contas/deNotaFiscal.ts`, `avisoBoleto.ts`, `gravarDeNota.ts`,
`resumo.ts`, `api/src/jobs/contas.ts`, `api/src/services/nfeProcessor.ts`,
`web/app/(app)/contas/lista-contas.tsx` + testes em `deNotaFiscal.test.ts`,
`gravarDeNota.test.ts`, `avisoBoleto.test.ts` e `nfeProcessor.test.ts`.

HISTÓRIA de 14/08: 265/265 testes da API passando, `tsc --noEmit` limpo nos dois lados.
**Duas rodadas de revisão do Apolo**, a segunda achando 6 problemas na correção da
primeira — inclusive o mais grave de todos (o aviso indo parar em nota de remessa). Ele
mediu as mutações numa cópia isolada para provar quais testes realmente travam o quê:
zerar `marcaConferir` ou tirar `observacao` do `select` passava com a suíte inteira verde
antes desta segunda rodada.
O XML da HIGA foi guardado junto dos outros casos-testemunha em `.tmp/notas-exemplo/`
(pasta **fora do git**, ver `.gitignore:49` — se a máquina for trocada, o arquivo se
perde). Para refazer a medição ponta a ponta com um XML de verdade, em vez de confiar
só em teste de mesa:

O `-r dotenv/config` + `DOTENV_CONFIG_PATH` não são enfeite: `parseXmlNFe` mora em
`nfeProcessor.ts`, que importa `./supabase`, que estoura na carga sem as variáveis — e o
`.env` está na RAIZ, não em `api/`. Sem isso o comando não roda (medido: a primeira
versão escrita aqui em 14/08 estava quebrada, achado do Apolo).

```bash
cd api && DOTENV_CONFIG_PATH=../.env npx tsx -r dotenv/config -e "import {parseXmlNFe} from './src/services/nfeProcessor';import {contasDaNota,motivoVencidoPelaDuplicata,duplicataEhReal} from './src/services/contas/deNotaFiscal';import {readFileSync} from 'fs';const d=parseXmlNFe(readFileSync(process.argv[1],'utf-8'))!;const n={numero:d.numero,emitenteNome:d.emitenteNome,dataEmissao:d.dataEmissao,valorTotal:d.valorTotal,formaPagamento:d.formaPagamento,duplicatas:d.duplicatas,items:d.items.map(i=>({descricao:i.description}))};console.log('tPag',d.formaPagamento,'| boletos',JSON.stringify(contasDaNota(n).map(c=>[c.vencimento,c.valor])),'| aviso:',motivoVencidoPelaDuplicata(d.formaPagamento,d.duplicatas.some(duplicataEhReal)))" ../.tmp/notas-exemplo/31260810476426000170550010000765931015659698-nfe.xml
```

Saída esperada para a HIGA (conferida em 14/08):
`tPag 05 | boletos [["2026-09-02",642.22]] | aviso: a nota diz crédito da loja`

**Aviso que o Apolo deixou e não foi resolvido:** na amostra de 5 XMLs do repositório, a
ÚNICA nota que muda de comportamento com a regra nova é a METAL AGRÍCOLA 51843 — que é
cartão de verdade (`Cnd.Pag:A VISTA;PAGAMENTO CARTAO CREDITO`) e vai gerar boleto
fantasma **já vencido**. Ou seja: o aviso "confira este boleto" pode aparecer com
frequência e quase sempre pedir "dispensar". Aviso que quase sempre é falso alarme é
aviso que se aprende a ignorar. Se isso incomodar na prática, o refinamento está no
backlog abaixo.

**Próximo passo:** confirmar o deploy do Railway e conferir a próxima nota de fornecedor
que chegar com forma de pagamento de cartão.

## 🟡 Boleto da NF 76593 foi gravado À MÃO no banco — 14/08/2026

Enquanto a regra acima não sobe, o boleto que faltava foi inserido direto no Supabase
(`contas_a_pagar`, id `5d6e2ebd-e492-4275-a013-3c9012ab6173`), já com `nota_fiscal_id`
apontando para a NF 76593 — **de propósito**: conta amarrada à nota não cria lançamento
novo ao ser paga (`precisaCriarLancamento`, `contas/pagamento.ts`), então o gasto de
R$ 642,22 que a nota já lançou em 03/08 não é contado duas vezes. Se tivesse sido
cadastrada pela tela como "conta avulsa", nasceria solta e **duplicaria o gasto** no dia
do pagamento.

⚠️ **Lacuna que isto expõe:** a tela "Nova conta avulsa" não tem como vincular a conta a
uma nota fiscal. Sempre que chegar boleto de uma nota já lançada, ou alguém edita o
banco à mão (como hoje), ou o gasto dobra. O Matheus foi avisado e deixou a decisão de
construir o campo para depois.

## ✅ 4 notas de agosto sem boleto — CONFERIDAS pelo Matheus em 14/08, não tinham cobrança mesmo

Medido em 14/08/2026: das 14 notas que entraram de 01/08 em diante, 10 geraram boleto e
4 não, somando R$ 43.870,00 (NF 62473 SYAGRI R$ 29.150; NF 59109 SOLOS R$ 12.000;
NF 59104 SOLOS R$ 2.580; NF 47109 TOTAL METAL R$ 140). Como o XML não é guardado
(`xml_raw` fica vazio — ver memória `nfe-xml-nao-guardado`), o banco não sabe responder
se elas tinham `<dup>`; só o e-mail original. **O Matheus conferiu no mesmo dia: as 4
realmente não tinham boleto.**

Conclusão que isso fecha: o estrago da regra antiga (tPag barrando duplicata real) foi
**1 nota, a HIGA 76593** — não uma safra inteira de boletos perdidos. Vale como
tranquilizador, não como garantia: só cobre 01/08 em diante, e a regra existe desde
31/07. Nota anterior a isso nunca gerou boleto por outro motivo (a feature não existia).

Para refazer a lista depois (comparar notas contra contas vinculadas), consultar
`notas_fiscais` por `created_at` e cruzar com `contas_a_pagar.nota_fiscal_id`.

## 🟡 Pendências de baixo risco do Financeiro, deixadas para depois

Do conserto do botão "Adicionar" (PR #50, ver seção NO AR): índice único de nome de
insumo é **global**, não por fazenda — vira problema no dia em que a segunda fazenda
tiver dados; se o segundo `insert` falhar, sobra insumo "órfão" no catálogo (impacto
baixo); `recarregar()` zera a lista de produtos se a API cair na mesma falha que gerou
o aviso; projeto `web` não tem ESLint configurado, só o `tsc` confere automaticamente.

## 🟡 Achados menores deixados de propósito no PR #55 (Financeiro + Contas)

Nenhum é dinheiro errado — todos foram revisados e classificados como não-bloqueantes.
Detalhe completo em `.superpowers/sdd/2026-08-10-reorganizacao-financeiro-contas/progress.md`
(esse arquivo não é versionado — some se o worktree for limpo; o resumo abaixo é o que sobrevive):
agrupamento na Contas acontece depois da paginação (pode reordenar visualmente ou uma linha
"sumir" ao clicar "Carregar mais" — decisão deliberada, não bug); `aria-label` do botão
"expandir nota" sobrepõe o texto visível pro leitor de tela, igual nas duas telas; item sem
data no Financeiro fica invisível dentro de um filtro de mês específico, sem aviso; lista vazia
da Contas não tem atalho "ver tudo" como o Financeiro já ganhou.

## 🔴 As 66 toneladas da SYAGRI (dele, não do sistema)

466 t entregues contra 400 t faturadas = **66 t, R$ 174.900**. Ele supôs duplicata;
**contestei com evidência**: os 13 números de nota são todos distintos, e duplicata
neste sistema tem assinatura de número REPETIDO (caso provado: nota 58717 da SOLOS,
11 ms de diferença). Nenhum subconjunto das 13 soma 66. **Não é o banco.**

**O estoque NÃO foi baixado para 400 de propósito** — errar para menos é pior que para
mais: para menos ele compra a mais e paga duas vezes.

**Próximo passo, e é dele:** perguntar à SYAGRI + conferir o galpão.

## 🔴 Consulta da ERCAL — pendente desde 03/08, nunca rodada

O XML da nota 82398 (CFOP `5116`, remessa de calcário) diz `NFe Mae:000080930`.
**Se essa nota mãe entrou no sistema, o boleto de R$ 8.258 dela é fantasma.**
Falta ele colar no Supabase o resultado da consulta de notas/lançamentos da ERCAL —
é isso que decide se o calcário também entra no conserto do histórico.

## 🔴 CFOP de RETORNO de depósito (`5906`/`6906`) não mapeado

⚠️ **Correção feita em 04/08/2026, conferindo o código em vez de acreditar no texto:**
o `5905`/`6905` (remessa PARA depósito fechado) **já está mapeado** em
`api/src/services/contas/cfop.ts`, como "remessa sem compra". Quem falta é o **retorno**
— `5906`/`6906` — e os irmãos dele. O painel global e este arquivo diziam "família
`5905`/`5906` não mapeada", o que era meia verdade.

Confira em vez de acreditar: `grep -n "590[56]" api/src/services/contas/cfop.ts`

Sem o retorno mapeado, a nota de retirada de uma compra antiga conta como gasto novo.
**Não mapear às cegas** — a nota de origem pode não estar no sistema, e aí marcar "não
conta" **perde** o gasto em vez de consertá-lo. Precisa decidir caso a caso, com nota
na mão.

## 🟡 Tela de "produtos em carteira" (pedida por ele em 04/08, não para hoje)

Ele quer ver, **por fornecedor**, o que já é dele mas ainda está na loja — comprado e
pago, esperando retirada. Um extrato do tipo "na SYAGRI tenho X t a retirar, na SOLOS
tenho Y sacos".

**Por que ficou barato agora:** o conserto do CFOP construiu exatamente o dado que
faltava. O saldo em carteira é `faturado − entregue`, por insumo e por fornecedor:
- **faturado** = itens de nota com CFOP de faturamento de entrega futura (`5922`/`6922`)
  e, quando o retorno de depósito for mapeado, também a compra que ficou em depósito
- **entregue** = itens com CFOP de remessa (`5116`/`5117`/`6116`/`6117`) e o retorno
  de depósito (`5906`, se a regra confirmar)

Antes do CFOP isso era impossível: o sistema não distinguia "comprei" de "recebi".

**Cuidados já conhecidos, para quem for desenhar:**
- `cfop` é NULO em todo o histórico anterior a 04/08/2026 — a tela nasce cega para o
  passado. Ou aceita isso e mostra só o que veio depois, ou depende de preenchimento
  manual do histórico.
- A conta pode dar NEGATIVA e isso não é defeito: a SYAGRI entregou 466 t contra 400
  faturadas. Saldo negativo significa "recebi mais do que me cobraram" e é sinal de
  que falta nota de faturamento complementar — vale como ALERTA, não como erro.
- `xPed` (número do pedido) veio VAZIO na amostra real, e o vínculo com a nota mãe só
  existe em texto livre no campo de observação. Não dá para agrupar automaticamente
  por pedido — agrupar por fornecedor + insumo é o que é confiável hoje.
- O **retorno** de depósito (`5906`/`6906`) ainda não está mapeado (item acima).

## 🟡 Nota de serviço (NFS-e) não é lida por NENHUM caminho automático — achado em 05/08/2026

`parseXmlNFe` (`api/src/services/nfeProcessor.ts:78`) exige a raiz `<NFe>`/`<infNFe>` —
formato da nota de PRODUTO (SEFAZ, padrão nacional). Nota de serviço (NFS-e) é emitida
pela prefeitura, sem padrão nacional único, e não tem essas tags. Os dois caminhos
automáticos (Make e o job interno `jobs/nfeEmail.ts`) descartam em silêncio — sem erro,
sem aviso, some.

**Frequência, na palavra dele:** nem rara nem comum, "meio termo".

**Decisão de 05/08:** fica no backlog. Enquanto não for construído, lançar à mão pela
tela **Financeiro** (botão Adicionar — não pela tela de NF-e), que grava o gasto sem
precisar de nota vinculada. **Não cria boleto em Contas a Pagar sozinho** — se a nota
de serviço tiver vencimento futuro, lançar isso à parte.

Efeito colateral do lançamento manual: cria uma linha nova em `insumos` para cada
descrição não repetida — pode acumular entrada avulsa no catálogo de insumos, que é
pensado para produto agrícola, não serviço. Não corrigido, não é urgente.

Construir suporte de verdade é trabalho grande (cada prefeitura formata do seu jeito) —
só vale quando a frequência justificar.

## ⚠️ `precisaCriarLancamento` — deliberadamente NÃO consertado

`api/src/services/contas/pagamento.ts`: nota de remessa pode gerar boleto sem gasto;
marcar como paga não cria lançamento, e o dinheiro some da conta de custo.
**Decisão dele, com motivo:** criar o lançamento ali dobraria o gasto se a nota mãe
tiver entrado, e o sistema não tem como saber. Mitigado com aviso no WhatsApp quando o
boleto cobra mais que o gasto lançado.

## Defeitos e pendências menores — nenhum trava nada

- **P1** — nota certa fica vermelha quando a Z-API cai (~4 linhas de conserto).
- **P5** — o botão "Reprocessar" não faz nada.
- Link do WhatsApp perde o filtro no login.
- Falta a tela que mostraria `forma_pagamento`.
- Não há botão de apagar/editar conta fixa (o spec pedia, o plano omitiu).
- `categoria` é texto livre e fragmenta o relatório por categoria.
- `calcularTotais` é puro mas sem teste (o Vitest só foi instalado na API).
- `.superpowers/sdd/.../task-1-report.md` é rascunho que vazou no squash.
- **P2 saiu de urgente:** só a fazenda de MG recebe NF-e hoje. `APP_URL` já configurada
  no Railway.
- Nota misturada (parte compra, parte remessa) lança o gasto só da parte de compra —
  comportamento correto e **travado por teste**.
- **Duplicata parcialmente vazia** (achado [baixo] do Apolo, 14/08/2026, sem ocorrência
  conhecida): nota com 1 duplicata real + 1 só com número de controle gera 2 contas, e a
  segunda nasce sem valor e sem data. A mensagem sai *"2 boletos: 10/09, sem data —
  R$ 500,00 no total"* para uma nota de R$ 1.000. Pré-existente; a mudança de 14/08 só
  estendeu isso a cartão/dinheiro.
- **Refinar o aviso "confira este boleto" pelo campo livre** (sugestão do Apolo, 14/08):
  o `infCpl` separa os dois casos sozinho — HIGA diz `Cnd.Pag:A PRAZO`, METAL AGRÍCOLA diz
  `Cnd.Pag:A VISTA;PAGAMENTO CARTAO CREDITO`. Ler isso permitiria subir o tom só quando
  for cartão de verdade, em vez de pedir conferência em toda nota de cartão. Texto livre é
  frágil (cada fornecedor escreve do seu jeito) — por isso é refinamento, nunca regra.

Detalhe de cada um: `.superpowers/sdd/2026-07-31-contas-a-pagar-fase2/progress.md` e
`.superpowers/sdd/2026-08-03-nfe-cfop-entrega-futura/progress.md`.

---

# 3. HISTÓRICO — do mais novo para o mais velho

## 07/08/2026 — faxina do repositório, e a armadilha do squash merge

Sobravam 4 pastas de worktree órfãs e 9 branches locais de sessões antigas, todas de
trabalho já mergeado. Tudo apagado (local e remoto), `main` sincronizada com o GitHub.
Para reconferir a qualquer momento, em vez de confiar neste parágrafo:

```bash
git worktree list && git branch -a
```

**A lição, que já custou um alarme falso nesta mesma sessão:** os PRs deste repositório
entram por *squash merge* — o GitHub junta todos os commits do ramo num só, com
identificador novo. Por isso `git rev-list --count origin/main..<ramo>` **sempre** acusa
commits "exclusivos" num ramo já mergeado, e `git branch --contains <sha>` não acha nada
na `main`. Isso parece trabalho perdido e não é. Aconteceu com o
`worktree-nfe-upload-manual`: 8 commits pareciam correção de segurança parada há 2 dias,
mas tinham entrado no PR #46 no dia anterior — arquivo por arquivo, idênticos à `main`.

**Antes de declarar que um ramo tem trabalho perdido, confira por CONTEÚDO:**

```bash
gh pr list --state all --head <ramo>
git diff --stat origin/main <ramo> -- <arquivo-chave>
```

PR MERGED, ou diff vazio, significa que o trabalho entrou.

## 04/08/2026 — o que o conserto do CFOP ensinou

### Três erros do plano, achados conferindo contra XML real

1. `tPag` NÃO prova cobrança — a ERCAL 82398 é remessa (`5116`) com `tPag 15`. Seguir
   o plano manteria o calcário dobrando. Só a duplicata prova.
2. Duplicata NÃO vence cartão — a METAL AGRÍCOLA 51843 é cartão (`05`) com duplicata.
   Só o código `90` cede.
3. A Decisão 3 do plano ("compra OU cobrança") virou escada excludente, não OU. Em nota
   misturada a metade "cobrança" ficava inalcançável.

### A tela Financeiro não somava o que o plano consertava

Descoberta que quase passou: `web/app/(app)/financeiro/page.tsx` soma **`itens_nfe`**,
não `lancamentos_financeiros`. O plano inteiro consertaria o Dashboard e deixaria o
fantasma na tela que ele abre todo dia. Virou a Task 6.5. Ver a memória
`financeiro-soma-itens-nao-lancamentos`.

### Histórico da SYAGRI corrigido (sessão com ele, transação com travas)

Estoque de KCl **866 → 466 t** · gasto **R$ 2.294.900 → R$ 1.116.280** · 1 cobrança
fantasma de R$ 29.150 **dispensada com motivo escrito** (não apagada).
Notas de ENGEO PLENO (45993, 46247) não foram tocadas — outro produto, outra série.
Números de 04/08, congelados: para reconferir, medir no banco, não acreditar neste texto.

## 03/08/2026 — a obra do CFOP, enquanto estava em execução

*(Superado pelo 04/08 acima; fica registrado porque explica as decisões.)*

Ramo `feat/nfe-cfop`. Ledger: `.superpowers/sdd/2026-08-03-nfe-cfop-entrega-futura/progress.md`
— lista as decisões P1–P5 e o que foi commitado.

Tasks 1 e 2 no ar (HISTÓRIA de 03/08: 147 testes verdes, `tsc` limpo). Tabela de CFOP
do plano conferida contra a tabela oficial: bateu inteira.

⚠️ **A pré-conferência dos 4 XMLs reais derrubou 4 trechos do plano** — o mais grave:
a ERCAL (nota 82398, CFOP `5116`) também trabalha com duas notas, o campo de
observação diz `NFe Mae:000080930`. O texto do plano consertaria só a SYAGRI e
deixaria a ERCAL dobrando, porque usava a forma de pagamento como prova de cobrança
e a ERCAL preenche `tPag=15`. Decidido com o Matheus: **só o quadro de boletos prova
cobrança.**

## 31/07/2026 — Contas a pagar Fase 2, e a limpeza de dado feita com ele

**Código completo e revisado.** Ramo `feat/contas-a-pagar-fase2`, 27 commits
(HISTÓRIA de 31/07: 128 testes verdes, `tsc` limpo nos dois lados). Spec e plano em
`docs/superpowers/{specs,plans}/2026-07-31-contas-a-pagar-fase2*`.

⚠️ **NÃO foi confirmado de fora que os deploys já servem o código NOVO** — nenhum dos
dois expõe versão. A prova seria a próxima NF-e real.

✅ **Limpeza de dado, na mesma noite:** R$ 45.227,24 de lançamentos de TESTE (de 21 e
25/05) apagados — eram só financeiros, **não encostaram no estoque**. Conferido
movimentação por movimentação: tudo em `movimentacoes_estoque` sem nota é
`saida/operacao` (pulverização real), `entrada/manual` (desfazimento da semana de
desenvolvimento) ou `correcao_unidade`. **Estoque limpo.**

📐 De quebra: as quantidades 111,900 e 223,800 provam que o sistema multiplica dose por
área certo (1 e 2 L/ha sobre 111,9 ha).

🐛 `movimentacoes_estoque.origem` tem valores (`operacao`, `correcao_unidade`) que NÃO
estão no `schema.sql` — mais uma prova de que aquele arquivo é documento velho.

⚠️ Conferência final NÃO pode reenviar os XMLs de `.tmp/notas-exemplo/` — as notas já
foram processadas e seriam ignoradas em silêncio. Só nota nova serve de prova.

## Descobertas que mudaram o desenho (julho/2026)

🐛 **Duplicata REAL, não teórica** (pré-checagem da migração 005): nota 58717 da SOLOS
SOLUÇÕES gravada duas vezes em 08/06/2026, com **11 milissegundos de diferença** — a
corrida entre as duas portas de entrada, provada. Estrago corrigido em produção com
ele: 5 L de TEBURAZ a mais no estoque (22,226 → 17,226) e R$ 4.400 de gasto contado em
dobro. Conferido depois: trava existe, 1 nota só, saldo certo. Memória:
[[nfe-corrida-duas-portas]].

🐛 **Dois defeitos que já estavam no ar**, achados pela sabatina e consertados:
(1) `nfeJaProcessada` deduplicava por número+fazenda e **ignorava o emitente** — número
de NF-e é sequencial POR fornecedor, então dois fornecedores com o mesmo número faziam
o sistema descartar uma compra inteira em silêncio (estoque, gasto e, na Fase 2, o
boleto). (2) as duas portas de entrada (Make + job de 30 min) conferiam e gravavam em
dois passos, e `notas_fiscais` **não tinha UNIQUE nenhum**. Conserto único: a chave
passou a incluir `emitente_cnpj` + índice único no banco.

📏 **Medido em 3 XMLs reais** (`.tmp/notas-exemplo/`): 2 de 3 trazem o vencimento;
a ERCAL (calcário, R$ 8.258) não traz em canto nenhum, nem no campo de observação.
`indPag` é contraditório — o único sinal confiável é a presença de `dVenc`.
Prazos curtíssimos: 7 dias e 1 dia. Nenhuma amostra era parcelada nem de adubo.

⚠️ **"À vista" na boca dele NÃO é "pago na hora"** — é pagamento em parcela única com
data marcada (adubo comprado 31/07, R$ 660 mil no dia 15/08). Ou seja, a nota de valor
alto é o caso PRINCIPAL da Fase 2, não a exceção. Parcelado de verdade é peça e
material, valor menor. Volume: 10 a 30 notas/mês. Memória: [[a-vista-e-parcela-unica]].

⛔ **Bloqueio que existia:** o bloco de cobrança é OPCIONAL na nota fiscal e não dava
para conferir nas notas antigas — o XML nunca foi guardado ([[nfe-xml-nao-guardado]]).
Resolvido na marra: ele salvou XMLs reais do Outlook em `.tmp/notas-exemplo/`
(`.tmp/` está protegida no `.gitignore`). Foram esses arquivos que derrubaram 4 trechos
do plano do CFOP em 03/08.

⚠️ A Fase 2 quebrou a regra de ouro da Fase 1 ("nada altera o fluxo de NF-e"): obrigou
a mexer no `nfeProcessor.ts`, peça que alimenta estoque, financeiro e WhatsApp sozinha.
Se quebrar, quebra calada — vale lembrar disso na próxima mexida ali.

⚠️ Armadilha que já mordeu: [[lancamento-invisivel-sem-origem]] na memória do projeto.
