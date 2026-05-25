# AgroMouro — Plataforma Digital
## PLAN.md — Abordagem MVP

> **Princípio:** Entregar valor real o mais rápido possível.
> Construir só o que é necessário agora. Validar antes de expandir.

---

## O que é o MVP desta plataforma?

**Uma frase:** O agricultor manda uma mensagem no WhatsApp e o sistema
registra tudo — e o que não precisar de mensagem, entra sozinho via NF-e.

**O MVP está pronto quando:**
- [ ] NF-e chega automaticamente e o estoque é atualizado sozinho
- [ ] Você manda uma mensagem no WhatsApp e a operação é salva
- [ ] Você consegue ver no dashboard quanto gastou e o que tem em estoque
- [ ] Você recebe alertas úteis no WhatsApp sem precisar fazer nada

**O que NÃO é MVP (fica para depois de validar):**
- John Deere Operations Center (OAuth2 burocrático, pode ser substituído por mensagem no WhatsApp por enquanto)
- Open Finance / Pluggy (extrato bancário pode ser digitado manualmente no início)
- NDVI de satélite (dado útil mas não é bloqueante)
- Prescrições com IA (precisa de base de dados antes)
- Stara / ISO-XML (confirmar compatibilidade antes de construir)

---

## Stack MVP (simples e funcional)

| Camada | Tecnologia | Por quê |
|---|---|---|
| Banco | **Supabase** | PostgreSQL + Auth + Realtime gratuito |
| Backend | **Node.js + Express** no Railway | Deploy simples, barato |
| Frontend | **Next.js 14 + Tailwind** no Vercel | Gratuito, rápido de construir |
| WhatsApp | **Z-API** + Claude Haiku | Barato para parsing |
| NF-e | **SEFAZ NFeDistribuicaoDFe** + e-CPF A1 | Gratuito, sem CNPJ, polling a cada 30min |
| IA parsing | **Claude Haiku** | Rápido e barato (mensagens WhatsApp) |

---

## FASE 1 — Fundação (Semana 1)
> Meta: ambiente configurado, banco rodando, projeto aberto no Cursor.

### 1.1 Criar contas essenciais (só as do MVP)
- [x] **Supabase** → supabase.com → criar projeto `agrofazenda` (região São Paulo)
- [x] **Railway** → railway.app → criar conta
- [x] **Vercel** → vercel.com → criar conta (gratuito)
- [x] **Z-API** → z-api.io → criar instância e conectar número WhatsApp *(usando número pessoal até chip dedicado chegar)*
- [x] **e-CPF A1** → garantir que o arquivo `.pfx` ou `.p12` está acessível para converter em base64 e subir no Railway como variável de ambiente
- [x] **Anthropic** → console.anthropic.com → gerar API Key

> As demais (JD Developer, Pluggy, Sentinel Hub) ficam para as fases de expansão.

### 1.2 Criar repositório e estrutura
- [x] Criar repositório no GitHub: `agromouro`
- [x] Criar estrutura de pastas:
  ```
  agromouro/
  ├── api/          ← Node.js + Express (Railway)
  ├── web/          ← Next.js 14 (Vercel)
  ├── .env.example
  ├── PLAN.md
  └── README.md
  ```
- [x] Criar `.env.example` com as variáveis:
  ```
  SUPABASE_URL=
  SUPABASE_SERVICE_KEY=
  ZAPI_INSTANCE=
  ZAPI_TOKEN=
  ZAPI_PHONE=
  ANTHROPIC_API_KEY=
  ECPF_CERT_BASE64=
  ECPF_CERT_PASSWORD=
  ```
- [x] Criar `.gitignore` (nunca commitar `.env`)
- [x] **Abrir no Cursor** e criar `CLAUDE.md` na raiz:
  ```
  # AgroFazenda

  Sistema de gestão agrícola para fazenda de grãos (soja, milho, trigo).
  O agricultor não tem experiência técnica — o sistema deve funcionar
  pelo WhatsApp com o mínimo de interação possível.

  Stack: Node.js + Express (api/), Next.js 14 (web/), Supabase, Railway, Vercel.
  Sempre usar TypeScript. Variáveis de ambiente via process.env.
  Nomes de rotas em inglês, mensagens ao usuário em português.
  ```

### 1.3 Banco de dados MVP — só o essencial
> 10 tabelas. Nada mais por enquanto.

- [x] Criar tabela `fazenda`
  ```sql
  id, nome, hectares, municipio, estado, lat, lng
  ```
- [x] Criar tabela `talhoes`
  ```sql
  id, nome, area_ha, cultura_atual, status [ativo/pousio/colhido]
  ```
- [x] Criar tabela `safras`
  ```sql
  id, talhao_id, cultura, data_plantio, data_colheita_prevista, status
  ```
- [x] Criar tabela `operacoes`
  ```sql
  id, talhao_id, safra_id, tipo, data, descricao, fonte [whatsapp/manual/jd]
  ```
- [x] Criar tabela `insumos`
  ```sql
  id, nome, tipo [herbicida/fungicida/fertilizante/combustivel/semente/outro], unidade
  ```
- [x] Criar tabela `estoque`
  ```sql
  id, insumo_id, quantidade_atual, quantidade_minima_alerta, preco_medio_unitario
  ```
- [x] Criar tabela `movimentacoes_estoque`
  ```sql
  id, insumo_id, tipo [entrada/saida], quantidade, data, origem [nfe/whatsapp/manual], nota_fiscal_id
  ```
- [x] Criar tabela `notas_fiscais`
  ```sql
  id, numero, emitente_nome, emitente_cnpj, data_emissao, valor_total, status [recebida/processando/processada/erro], xml_raw
  ```
- [x] Criar tabela `lancamentos_financeiros` *(gerado automaticamente pela NF-e)*
  ```sql
  id, data, descricao, valor, tipo [receita/despesa], categoria, nota_fiscal_id
  ```
- [x] Criar tabela `itens_nfe`
  ```sql
  id, nota_fiscal_id, descricao, quantidade, unidade, valor_unitario, valor_total, insumo_id (nullable)
  ```
- [x] Criar tabela `alertas`
  ```sql
  id, tipo, titulo, mensagem, nivel [info/aviso/critico], lido, enviado_whatsapp, created_at
  ```

- [x] Ativar **Row Level Security** no Supabase em todas as tabelas
- [x] Popular `fazenda` com os dados reais da propriedade
- [x] Popular `talhoes` com os talhões existentes
- [x] Popular `insumos` com os produtos que já usa na fazenda
  > ✅ **Mudança de abordagem:** insumos não precisam ser pré-cadastrados manualmente.
  > O sistema cria automaticamente qualquer produto novo que chegar via NF-e (nome da nota + tipo classificado pelo Claude + unidade da nota).
  > 8 insumos placeholder foram mantidos como ponto de partida.
- [x] Popular `estoque` com as quantidades atuais
  > ✅ Estoque inicializado zerado. Atualizado automaticamente a cada NF-e processada via webhook.

---

## FASE 2 — Backend + WhatsApp (Semana 2)
> Meta: mandar mensagem no WhatsApp e ver o dado salvo no banco.

> ⚠️ **Aviso Z-API:** A Z-API usa automação do WhatsApp Web (não é a API oficial do Meta).
> Existe risco de o número ser banado temporariamente se o WhatsApp detectar padrão automatizado.
> Para MVP pessoal/uso próprio, o risco é baixo. Mantenha volume de mensagens moderado.
> Se o número for crítico para o negócio, considere usar um número dedicado só para o bot.

### 2.1 Setup do backend Node.js
- [x] Inicializar projeto: `cd api && npm init -y`
- [x] Instalar dependências:
  ```
  express cors helmet dotenv
  @supabase/supabase-js
  zod
  ```
- [x] Configurar TypeScript (`tsconfig.json`)
- [x] Criar estrutura:
  ```
  api/src/
  ├── routes/
  ├── services/
  ├── webhooks/
  ├── middleware/
  └── index.ts
  ```
- [x] Criar rota de saúde: `GET /health → { status: "ok" }`
- [x] Criar middleware de autenticação (token Supabase)

### 2.2 Rotas básicas do CRUD
- [x] `GET  /talhoes` — listar talhões com cultura atual
- [x] `GET  /estoque` — estoque atual de todos os insumos
- [x] `GET  /operacoes` — últimas operações (com filtro por talhão)
- [x] `GET  /alertas` — alertas ativos não lidos
- [x] `POST /operacoes` — registrar operação manualmente
- [x] `PATCH /alertas/:id/lida` — marcar alerta como lido

### 2.3 Webhook do WhatsApp (Z-API)
- [x] Criar rota: `POST /webhook/whatsapp`
- [ ] Configurar Z-API para enviar mensagens para essa rota *(pendente — aguardando chip dedicado)*
- [ ] Testar recebimento: mandar "oi" no WhatsApp e ver o log no Railway

### 2.4 Agente WhatsApp com Claude Haiku
- [x] Criar serviço `whatsapp.service.ts`
- [x] Montar prompt de classificação para Claude Haiku:
  ```
  Você é um assistente de gestão agrícola. Classifique a mensagem abaixo em uma das categorias:
  OPERACAO, APLICACAO_INSUMO, CONSULTA, DESCONHECIDO

  Responda SOMENTE em JSON:
  { "tipo": "...", "dados": { ... } }
  ```
- [x] Implementar parser para `CONSULTA`:
  - Entrada: `"Quanto de glifosato tem em estoque?"`
  - Saída: consulta banco e responde com o número
- [x] Resposta padrão para `DESCONHECIDO`:
  - `"Não entendi bem. Pode reformular? Exemplos: 'pulverizei o talhão 2', 'qual o estoque de ureia'"`
- [x] Tratar erros com graciosidade (nunca deixar mensagem sem resposta)
- [ ] Implementar parser para `APLICACAO_INSUMO`:
  - Entrada: `"Plantei a soja no talhão 5 ontem, variedade NS 7338"`
  - Saída: salva operação de plantio + atualiza safra
  - Confirmação: `"✅ Plantio registrado — Talhão 5, Soja NS 7338."`
  - ⚠️ Salva em `operacoes` ✅ — falta criar/atualizar registro na tabela `safras`

### 2.5 WhatsApp seguro + saída de estoque automática
> Pré-requisito: número pessoal conectado — qualquer conversa acionaria o bot sem proteção.

#### Passo 0 — Dupla proteção (whitelist + prefixo de ativação) ✅
- [x] Adicionar variáveis de ambiente no Railway:
  - `WHATSAPP_AUTHORIZED_PHONES` — números autorizados separados por vírgula (ex: `5544999990000,5544988880000`)
  - `WHATSAPP_TRIGGER_PREFIX` — prefixo que ativa o bot (ex: `!agro`)
- [x] No webhook, antes de qualquer processamento:
  1. Verificar se `phone` está na whitelist → se não, retornar 200 silenciosamente
  2. Verificar se mensagem começa com o prefixo → se não, retornar 200 silenciosamente
  3. Fazer strip do prefixo antes de passar ao Claude
- [x] Resultado: conversas normais nunca são interceptadas; bot só age com `!agro <mensagem>`
- [ ] **Pendente:** configurar `WHATSAPP_AUTHORIZED_PHONES` e `WHATSAPP_TRIGGER_PREFIX` no Railway com os valores reais

#### Passo 1 — Melhorar extração do Claude Haiku (suporte a múltiplos insumos) ✅
> **Realidade do campo:** 99% das aplicações usam 3–4 insumos numa mesma calda (defensivo + adjuvante + fertilizante foliar). Tratar como insumo único seria irreal.

- [x] Atualizar prompt para retornar **array de insumos** com dose estruturada por item:
  ```json
  {
    "tipo": "OPERACAO",
    "dados": {
      "talhao": "Lagoa",
      "operacao_tipo": "pulverizacao",
      "data": "2026-05-25",
      "insumos": [
        { "nome": "Score",  "dose_valor": 2,   "dose_unidade": "L",  "dose_tipo": "por_ha" },
        { "nome": "Priori", "dose_valor": 300, "dose_unidade": "ml", "dose_tipo": "por_ha" },
        { "nome": "ureia",  "dose_valor": 50,  "dose_unidade": "kg", "dose_tipo": "por_ha" }
      ]
    }
  }
  ```
  - `dose_tipo`: `"por_ha"` (ex: 2L/ha) ou `"total"` (ex: 50L direto) ou `null`
  - Para `CONSULTA_ESTOQUE`: `insumos[]` com 1+ produtos (permite "quanto tem de glifosato e ureia?")
  - Adicionar exemplo de múltiplos insumos no prompt para ensinar o padrão ao Haiku

#### Passo 2 — Buscar insumo no banco ✅
> **Decisão:** sem auto-criação no MVP. Se não achar, avisa o agricultor no WhatsApp para reformular. Mantém o banco limpo evitando duplicatas por typo ("Scoore" vs "Score") ou abreviação ("ureia" vs "Ureia 45N"). Fluxo fuzzy match + confirmação interativa fica para pós-MVP.

- [x] Adicionar função `buscarInsumo(nome)` — busca por `ilike` (case-insensitive, tolerante a sufixos)
- [x] Retorna `{ id, nome, unidade }` ou `null` quando não encontra
- [ ] Será chamada em loop sobre `dados.insumos[]` no Passo 3
- [ ] Insumos não encontrados → marcar como falha parcial (Passo 7 lista no WA)

**Pós-MVP (Passo 8 ou depois):** fluxo de fuzzy match — se não achar exato, busca por similaridade, sugere candidatos via WhatsApp, agricultor confirma com número. Permite "criar como novo" como última opção, mas via confirmação explícita.

#### Passo 3 — Calcular quantidade total (por insumo)
> **Inferência de dose_tipo (atualização):** o agricultor raramente digita "/ha". Por convenção brasileira, em pulverização/adubação/calagem/plantio dose é sempre por hectare implícita. Em combustível é sempre total. O Haiku infere isso automaticamente pelo `operacao_tipo` e nome do insumo. Override explícito (`"/ha"`, `"no total"`) sempre vence.

- [ ] Função `resolverInsumos(insumos, talhao)` em `whatsapp.ts` — função **pura** (não escreve no banco)
- [ ] Para cada item de `dados.insumos[]`:
  - Resolve o nome via `buscarInsumo()` → se não acha, marca como falha
  - Valida `dose_valor` e `dose_tipo` → se faltar, marca como falha
  - Se `dose_tipo = "por_ha"` e talhão com `area_ha` → `quantidade = dose_valor × area_ha`
  - Se `dose_tipo = "total"` → `quantidade = dose_valor` direto
  - Se `dose_tipo = "por_ha"` sem talhão ou `area_ha = 0` → falha
- [ ] Retorna array de `{ ok: true, insumo_id, nome, quantidade, unidade } | { ok: false, nome, erro }`
- [ ] Roda em paralelo com `Promise.all` (N round-trips ao banco viram 1)

> **Pós-MVP — Adubação com taxa variável:** agricultura de precisão usa mapas de prescrição (shapefile/ISO-XML), não dose homogênea. O fluxo WhatsApp atual não cobre isso — virá da integração John Deere ou import de prescrição em fase posterior.

#### Passo 4 — Inserir em `itens_operacao` (loop)
- [ ] **N inserts**, um por insumo, todos com o mesmo `operacao_id` (guarda-chuva)
  ```ts
  for (const item of insumosResolvidos) {
    supabase.from('itens_operacao').insert({
      operacao_id, insumo_id: item.insumo_id, descricao: item.nome,
      quantidade: item.quantidade, unidade: item.unidade,
    })
  }
  ```
- [ ] Custo total da operação na página /custos = soma de todos os itens

#### Passo 5 — Inserir em `movimentacoes_estoque` (loop)
- [ ] **N inserts**, um por insumo, todos com o mesmo `operacao_id`
- [ ] Cada linha aparece separada no histórico de estoque

#### Passo 6 — Decrementar `estoque.quantidade_atual` (loop)
- [ ] **N updates**, um por insumo, subtraindo a quantidade usada de cada um

#### Passo 7 — Resposta final no WA — lista por insumo
- [ ] Resposta consolidada com saída + estoque restante de cada item:
  ```
  ✅ Pulverização registrada!
  📍 Talhão Lagoa (35ha) — 25/05

  📦 Score:  70L     (estoque: 130L)
  📦 Priori: 10500ml (estoque: 9500ml)
  📦 ureia:  1750kg  (estoque: 8250kg)
  ⚠️ Priori abaixo do mínimo! (mín: 15000ml)
  ```
- [ ] Sucesso parcial: se 2 de 3 insumos foram OK, listar quais falharam:
  ```
  ✅ Operação registrada (2 de 3 insumos)
  📦 Score:  70L OK
  📦 ureia:  1750kg OK
  ❌ "Priorii" não encontrado no estoque — verifique o nome
  ```

#### Edge cases a tratar
- Insumo não encontrado no banco → marca esse item como falha, processa os outros, lista no WA
- Dose L/ha sem talhão identificado → salva operação sem itens, avisa
- Estoque insuficiente em algum item → registra normalmente (não bloqueia), avisa no resumo
- Array vazio de insumos numa OPERACAO → salva só a operação (ex: "colhi o talhão 5" — sem produto)

### 2.5 Deploy no Railway
- [x] **Antes:** garantir que o código está commitado e enviado para o GitHub (`git push`)
  > O Railway puxa o código direto do GitHub — sem push, o deploy não pega as últimas mudanças.
- [x] Gerar valor para `WEBHOOK_SECRET` (copiar e salvar no `.env`):
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- [x] Criar projeto no Railway conectado ao repositório GitHub
- [x] Configurar variáveis de ambiente (copiar do `.env`) — incluindo o `WEBHOOK_SECRET` gerado acima
- [x] Configurar deploy automático no push para `main`
- [x] Testar: `GET /health → {"status":"ok","timestamp":"..."}` ✅ API em produção
- [ ] Configurar URL do Railway no Z-API como webhook *(pendente — aguardando chip Z-API)*

### ✅ Checkpoint da Fase 2
- [ ] Mandar 5 tipos de mensagem no WhatsApp e verificar se foram salvas corretamente
- [ ] Consultar estoque pelo WhatsApp e receber resposta correta
- [ ] Confirmar que o Railway não cai (verificar logs por 24h)

---

## FASE 3 — NF-e Automática (Semana 3)
> Meta: NF-e chega, estoque atualiza, WhatsApp confirma. Sem nenhuma ação manual.
> **Esta é a integração com maior ROI do projeto.**
>
> ✅ **Abordagem adotada:** Make (make.com) monitora as caixas de entrada do Outlook a cada 15min,
> filtra anexos .xml e envia para o webhook `/webhook/nfe-email` no Railway.
> Dois cenários ativos: matheusmouro@hotmail.com e ivanmouro@hotmail.com.
> A abordagem SEFAZ e-CPF foi descartada (fazenda só tem CPF, NFE.io não suporta).

### 3.1 Preparar certificado e-CPF no Railway
> ~~Descartado~~ — substituído por Make + email. Fazenda só tem CPF (não CNPJ), NFE.io não suporta CPF.

### 3.2 Implementar job de polling SEFAZ
> ~~Descartado~~ — substituído por Make + monitoramento de email Outlook.

### 3.3 Processar NF-e
- [x] Criar serviço `nfeProcessor.ts`
- [x] Ao receber NF-e nova via webhook:
  - [x] Salvar registro em `notas_fiscais` com status `recebida`
  - [x] Parsear itens do XML → salvar em `itens_nfe`
  - [x] Criar lançamento financeiro (despesa) com valor total da NF-e
- [x] Usar Claude Haiku para categorizar cada item
- [x] Tentar vincular item ao `insumos` cadastrado (busca por nome similar)
- [x] **Se vinculou:** entrada automática no estoque + WhatsApp confirmando
- [x] **Se não vinculou:** auto-cria novo insumo com o nome da nota + notifica WhatsApp
- [x] Atualizar status para `processada` ou `erro`

### 3.4 Testes com NF-e real
- [ ] Testar com 1 NF-e real de defensivo agrícola
- [ ] Testar com 1 NF-e real de fertilizante
- [ ] Testar com 1 NF-e real de combustível
- [ ] Verificar se estoque reflete corretamente após cada uma

### ✅ Checkpoint da Fase 3
- [x] NF-e chegou → processou → estoque correto → WhatsApp confirmou (fluxo completo)
- [x] Taxa de acerto na categorização automática > 80%
- [x] Nenhuma NF-e ficou travada sem processamento

---

## FASE 4 — Dashboard Web MVP (Semana 4)
> Meta: visualizar no browser o que está no banco. Simples, funcional, sem firulas.

### 4.1 Setup do Next.js
- [x] Criar projeto: `cd web && npx create-next-app@latest . --typescript --tailwind --app`
- [x] Instalar dependências essenciais:
  ```
  @supabase/supabase-js @supabase/auth-ui-react
  recharts
  shadcn/ui (npx shadcn@latest init)
  lucide-react
  ```
- [x] Configurar autenticação com Supabase Auth (login + AuthProvider + AuthGuard)
- [x] Criar layout com sidebar simples: Dashboard | Estoque | Operações | NF-e | Alertas

### 4.2 Tela — Dashboard (página inicial)
- [x] Card: Total de alertas ativos (com link para lista)
- [x] Card: Últimas 5 operações registradas
- [x] Card: Estoque crítico (insumos abaixo do mínimo)
- [x] Resumo: talhões ativos com cultura atual e status da safra

### 4.3 Tela — Estoque
- [x] Tabela de todos os insumos com quantidade atual
- [x] Destacar em vermelho os que estão abaixo do mínimo
- [x] Histórico de movimentações (entradas e saídas) por insumo
- [x] Botão para ajuste manual de estoque (caso haja diferença)

### 4.4 Tela — Operações
- [x] Lista de operações com filtros por talhão
- [x] Indicar a fonte (WhatsApp 💬 / NF-e 📄 / John Deere 🚜 / Manual ✏️)
- [x] Formulário simples para adicionar operação manualmente (backup do WhatsApp)

### 4.5 Tela — NF-e
- [x] Lista de todas as NF-e recebidas com status e valor
- [x] Botão para reprocessar NF-e com erro
- [x] Detalhe da NF-e com itens e vínculo ao insumo
- [x] Itens não vinculados destacados para revisão manual

### 4.6 Tela — Alertas
- [x] Lista de todos os alertas com nível (info / aviso / crítico)
- [x] Marcar como lido (individual ou todos)
- [x] Filtro por tipo e nível

### 4.7 Deploy no Vercel
- [ ] Conectar repositório GitHub ao Vercel
- [ ] Configurar variáveis de ambiente (SUPABASE_URL, SUPABASE_ANON_KEY)
- [ ] Após o Vercel gerar a URL de produção (ex: `https://agromouro.vercel.app`):
  - [ ] **Atualizar** a variável `FRONTEND_URL` no Railway com essa URL
  - [ ] Isso é necessário para o CORS do backend aceitar requisições do frontend em produção
- [ ] Testar acesso em produção pelo celular e computador

### ✅ Checkpoint da Fase 4 — MVP completo
> **Aqui o MVP está pronto.** Antes de continuar, validar por pelo menos 2 semanas de uso real.

- [ ] Usar o sistema no dia a dia por 14 dias
- [ ] Anotar o que falta, o que incomoda, o que não foi útil
- [ ] Medir: quantas NF-e foram processadas automaticamente?
- [ ] Medir: quantas mensagens o WhatsApp entendeu corretamente?
- [ ] Medir: o dashboard está sendo acessado? O que mais é consultado?
- [ ] **Só continuar para Fase 5 após essa validação**

---

## FASE 5 — John Deere Operations Center (Expansão 1)
> Adicionar após validar o MVP. Não é bloqueante.

### 5.1 OAuth2 com John Deere
- [ ] Criar conta em developer.deere.com e criar app (processo leva 2-5 dias úteis)
- [ ] Implementar fluxo OAuth2:
  - `GET /auth/jd` → redireciona para login JD
  - `GET /auth/jd/callback` → salva access_token e refresh_token no banco
- [ ] Implementar renovação automática do token (expira em 1h)

### 5.2 Sincronizar dados do JD
- [ ] Criar tabela `operacoes_jd` (id, maquina, talhao_id, tipo, data_inicio, data_fim, area_ha)
- [ ] Criar tabela `telemetria_jd` (id, maquina, timestamp, horas_motor, lat, lng, consumo)
- [ ] Job diário (09:00): buscar operações novas das últimas 24h
- [ ] Vincular operação ao talhão via coordenadas GPS vs. polígono do talhão
- [ ] Se não identificar: WhatsApp → `"🚜 JD M4030: pulverização 42ha detectada. Qual talhão?"`
- [ ] Importar as-applied (arquivo pós-operação) para cada operação

### 5.3 Exportar prescrição ISO-XML
- [ ] Criar serviço de geração de arquivo ISO-XML (ISOBUS)
- [ ] Rota: `GET /prescricoes/:id/isoxml` → download
- [ ] Rota: `GET /prescricoes/:id/shapefile` → download
- [ ] **Confirmar com Stara (0800 647 8272) compatibilidade do Hércules 6.0 antes de construir a parte Stara**

---

## FASE 6 — IA para Prescrições de Solo (Expansão 2)
> Adicionar após ter pelo menos 1 ciclo de análise de solo no sistema.

### 6.1 Upload e leitura de análise de solo
- [ ] Criar tabela `analises_solo` (id, talhao_id, data_coleta, laboratorio, pdf_url)
- [ ] Criar tabela `resultados_solo` (id, analise_id, grid_id, ph, p, k, ca, mg, v_pct, mo)
- [ ] Criar rota: `POST /analises-solo/upload` (recebe PDF)
- [ ] Usar Claude Sonnet para extrair dados do PDF:
  - Prompt inclui: tabela de exemplo, grids esperados, formato de saída JSON
- [ ] Confirmar extração via WhatsApp antes de salvar

### 6.2 Gerar prescrição
- [ ] Prompt para Claude Sonnet com:
  - Resultado do lab por grid
  - Cultura planejada + produtividade esperada
  - Tabelas de recomendação IAC/Embrapa (inseridas diretamente no prompt)
- [ ] IA gera por grid: calcário (t/ha), K2O (kg/ha), P2O5 (kg/ha)
- [ ] Enviar resumo no WhatsApp para aprovação
- [ ] Ao responder "OK": gerar ISO-XML automaticamente

---

## FASE 7 — Dados Externos e Financeiro Completo (Expansão 3)
> Adicionar só quando o core estiver sólido e validado.

### 7.0 Ativar jobs agendados
- [ ] Em `api/src/index.ts`, descomentar (ou adicionar) a linha:
  ```typescript
  import './jobs'
  ```
  > Este import ativa todos os cron jobs (clima, NDVI, cotações, sync JD, resumo diário).
  > O arquivo `src/jobs/index.ts` já existe mas não é importado no MVP — só ativar aqui quando chegar na Fase 7.

### 7.1 Clima automático
- [ ] Integrar Open-Meteo (gratuito, sem conta) para previsão 7 dias
- [ ] Job diário 06:00: salvar previsão e incluir no resumo do WhatsApp
- [ ] Criar alertas: geada, chuva intensa, janela de pulverização

### 7.2 NDVI de satélite
- [ ] Criar conta Sentinel Hub
- [ ] Job semanal: baixar NDVI por talhão
- [ ] Alerta se NDVI cair mais de 15% em 7 dias

### 7.3 Preços de commodities
- [ ] Criar serviço para buscar cotação CEPEA (soja, milho, trigo)
- [ ] Job diário: salvar cotação e incluir no resumo do WhatsApp

### 7.4 Open Finance (Pluggy)
- [ ] Criar conta Pluggy (processo regulatório pode levar semanas)
- [ ] Conectar conta bancária da fazenda
- [ ] Importar e categorizar extrato com Claude Haiku
- [ ] Reconciliar automaticamente com NF-es já processadas

---

## FASE 8 — Dashboard Completo (Expansão 4)
> Só expandir o dashboard quando houver dados reais para mostrar.

- [ ] Mapa interativo dos talhões (Leaflet com polígonos)
- [ ] Camada de NDVI sobre o mapa
- [ ] Camada de sensores IoT (posição + leitura atual)
- [ ] Gráficos financeiros: receita vs. despesa por mês / por safra
- [ ] Custo por hectare por talhão
- [ ] Tela de análise de solo com mapa de prescrição variável
- [ ] Tela de máquinas com heatmap de operações e consumo

---

## Ordem e Tempo Estimado

```
Semana 1  →  Fase 1: Contas + banco de dados + repositório no Cursor
Semana 2  →  Fase 2: Backend + Agente WhatsApp funcionando
Semana 3  →  Fase 3: NF-e automática + estoque
Semana 4  →  Fase 4: Dashboard web MVP + deploy

──── PAUSA: 2 semanas de uso real ────

Semana 7  →  Fase 5: John Deere
Semana 8  →  Fase 6: Prescrições com IA
Semana 9+ →  Fases 7 e 8: dados externos + dashboard completo
```

---

## Custos do MVP (Fases 1–4 apenas)

| Serviço | Custo/mês |
|---|---|
| Supabase (Free tier) | R$ 0 |
| Railway (Starter) | R$ 25 – 50 |
| Vercel (Hobby) | R$ 0 |
| Z-API | R$ 90 – 150 |
| SEFAZ NFeDistribuicaoDFe (direto) | R$ 0 |
| Anthropic Claude (Haiku — uso baixo) | R$ 20 – 50 |
| **Total MVP** | **R$ 135 – 250/mês** |

> A partir da Fase 5 (expansões), o custo sobe gradualmente conforme o uso real justificar.

---

## Regra de ouro deste projeto

> **Não construir o que não foi pedido pelo uso real.**
> Cada fase de expansão só começa quando a fase anterior está sendo usada
> e gerando valor comprovado no dia a dia da fazenda.

---

*AgroMouro — Plataforma Digital | 2025*
