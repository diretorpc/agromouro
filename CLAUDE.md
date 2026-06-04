# AgroMouro — Plataforma de Gestão Agrícola

## LEITURA OBRIGATÓRIA AO INICIAR QUALQUER SESSÃO

Antes de qualquer resposta, leia sempre estes arquivos:
1. `C:/Users/Dib/.claude/projects/c--Agromouro-base/memory/MEMORY.md` — índice de memórias ativas
2. Cada arquivo listado no MEMORY.md (não ler a pasta inteira — só os listados)
3. `PLAN.md` na raiz do projeto
4. Este arquivo (CLAUDE.md)

Isso garante contexto completo sem carregar histórico obsoleto.

## NF-e — informação crítica
NF-e é processada **automaticamente** via Make (make.com), que monitora dois emails Outlook
(matheusmouro@hotmail.com e ivanmouro@hotmail.com) a cada 15 min e envia o XML para
`/webhook/nfe-email` no Railway. **NÃO é manual.** NFE.io foi descartado (exige CNPJ).

## O que é este projeto

Sistema de gestão agrícola para fazenda de grãos (soja, milho, trigo).
O agricultor não tem experiência técnica — o sistema deve funcionar
pelo WhatsApp com o mínimo de interação possível.

O sistema coleta dados automaticamente (NF-e, John Deere, satélite)
e só incomoda o agricultor quando não tem outro jeito.

## Stack

- **api/** → Node.js + Express + TypeScript (deploy: Railway)
- **web/** → Next.js 14 App Router + Tailwind CSS + shadcn/ui (deploy: Vercel)
- **Banco** → Supabase (PostgreSQL + Auth + Realtime)
- **WhatsApp** → Z-API + Claude Haiku (parsing de mensagens)
- **NF-e** → Make (make.com) monitora emails Outlook → POST `/webhook/nfe-email` no Railway
- **IA** → Anthropic Claude (Haiku para parsing rápido, Sonnet para prescrições de solo)

## Convenções de código

- Sempre TypeScript — nunca JavaScript puro
- Nomes de funções e variáveis em inglês (camelCase)
- Nomes de rotas da API usando o nome do recurso em português (ex: `/talhoes`, `/estoque`, `/operacoes`)
- Mensagens ao usuário final sempre em português brasileiro
- Validação de entrada com Zod em todas as rotas POST/PATCH
- Erros sempre logados com contexto (não apenas console.log)
- Variáveis de ambiente via process.env — nunca hardcoded
- Responder sempre 200 imediatamente em webhooks externos, processar em background

## Estrutura da API

```
api/src/
├── routes/       ← rotas Express (um arquivo por domínio: talhoes, estoque, operacoes, alertas)
├── services/     ← lógica de negócio (supabase.ts, zapi.ts)
├── webhooks/     ← eventos externos: whatsapp.ts, nfe.ts, ttn.ts (IoT sensores)
├── jobs/         ← tarefas agendadas com node-cron (clima, NDVI, commodities, resumo diário)
├── middleware/   ← auth.ts, errorHandler.ts, requestLogger.ts
└── index.ts      ← entrada da aplicação
```

## Estrutura do Frontend

```
web/src/
├── app/
│   ├── (auth)/login/        ← página de login
│   ├── dashboard/           ← página inicial com resumo
│   ├── estoque/             ← gestão de estoque de insumos
│   ├── operacoes/           ← histórico de operações no campo
│   ├── nfe/                 ← notas fiscais recebidas e processadas
│   └── alertas/             ← central de alertas
├── components/              ← componentes reutilizáveis (shadcn/ui + customizados)
├── lib/
│   └── supabase.ts          ← cliente Supabase para o frontend
└── middleware.ts             ← proteção de rotas autenticadas
```

## Banco de dados (Supabase) — MVP

Tabelas ativas no MVP (10 + 1):
- `fazenda` — dados da propriedade
- `talhoes` — talhões com cultura atual e status
- `safras` — ciclo de cada cultura por talhão
- `operacoes` — plantio, pulverização, adubação, colheita (fonte: whatsapp/manual/jd)
- `insumos` — catálogo de produtos (herbicidas, fertilizantes, sementes, etc.)
- `estoque` — quantidade atual por insumo + alerta de mínimo
- `movimentacoes_estoque` — entradas e saídas com origem rastreada
- `notas_fiscais` — NF-e recebidas com status de processamento
- `itens_nfe` — itens de cada NF-e vinculados ao insumo correspondente
- `lancamentos_financeiros` — despesas geradas automaticamente via NF-e
- `alertas` — central de notificações (estoque baixo, operação detectada, erro)

## Contexto do negócio

- Fazenda de grãos (soja, milho, trigo) com talhões identificados por número/nome
- Máquinas: pulverizador John Deere M4030, distribuidor de adubo Stara Hércules 6.0, plantadeira JD, colhedora JD, tratores JD
- O agricultor usa WhatsApp no dia a dia para registrar o que aconteceu no campo
- NF-e chega dos fornecedores de insumos (defensivos, fertilizantes, sementes, combustível)
- O sistema deve cruzar NF-e + estoque + operações para dar visibilidade total sem esforço manual

## Roadmap de expansão (pós-MVP)

Estas integrações NÃO fazem parte do MVP. Implementar somente após validação do core:

1. **John Deere Operations Center** — OAuth2, sincronização de operações, importar as-applied, exportar prescrições ISO-XML
2. **Stara Hércules 6.0** — verificar compatibilidade ISO-XML com Stara (0800 647 8272) antes de construir
3. **Open Finance / Pluggy** — importar extrato bancário e reconciliar com NF-es
4. **NDVI via Sentinel Hub** — imagem de satélite semanal por talhão, alerta de queda
5. **Preços de commodities** — cotação CEPEA diária (soja, milho, trigo)
6. **Clima Open-Meteo** — previsão 7 dias, alertas de geada e janela de pulverização
7. **Sensores IoT / TTN** — webhook `/webhook/ttn` já existe na API para receber dados LoRaWAN

## Como rodar localmente

```bash
# API
cd api
cp ../.env.example .env   # preencher com suas credenciais
npm install
npm run dev               # http://localhost:3001/health

# Web (após criar o projeto Next.js)
cd web
npm install
npm run dev               # http://localhost:3000
```
