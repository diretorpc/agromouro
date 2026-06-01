# n8n — Setup de NF-e por Filial

## Contexto

Cada filial tem um email dedicado para receber NF-es. O n8n monitora cada caixa de entrada
e envia o XML para a API com o query param `?fazenda=<codigo>`, que roteia para a fazenda correta.

| Fazenda | Código | Email | URL do webhook |
|---------|--------|-------|----------------|
| MG (existente) | `mg` | matheusmouro@hotmail.com / ivanmouro@hotmail.com | `.../webhook/nfe-email?fazenda=mg` |
| Tejuco (novo) | `sp` | nfe.tejuco@hotmail.com *(criar)* | `.../webhook/nfe-email?fazenda=sp` |
| MT (novo) | `mt` | nfe.mt@hotmail.com *(criar)* | `.../webhook/nfe-email?fazenda=mt` |

---

## Passo 1 — Criar as contas de email

Crie as duas contas Hotmail/Outlook:

- `nfe.tejuco@hotmail.com` — NF-es da Fazenda Tejuco (SP)
- `nfe.mt@hotmail.com` — NF-es da Fazenda MT

Elas serão usadas exclusivamente para receber XMLs de fornecedores. Não é necessário
monitorar manualmente — o n8n faz isso automaticamente.

---

## Passo 2 — Criar credenciais Microsoft Outlook no n8n

Para cada nova conta, adicione uma credencial OAuth2 no n8n:

1. No n8n: **Settings → Credentials → New Credential**
2. Tipo: **Microsoft Outlook OAuth2 API**
3. Nome sugerido: `Outlook — nfe.tejuco` / `Outlook — nfe.mt`
4. Faça o OAuth login com a conta correspondente
5. Salve e anote o `id` gerado (será necessário no próximo passo)

---

## Passo 3 — Importar os workflows

Os arquivos JSON dos novos workflows estão na raiz do repositório:

- `n8n-nfe-tejuco.json` — Fazenda Tejuco (SP)
- `n8n-nfe-mt.json` — Fazenda MT

### Como importar

1. No n8n: clique em **+** (New Workflow)
2. Menu ⋮ → **Import from file**
3. Selecione o arquivo `.json`
4. O workflow é importado **inativo** (`active: false`)

---

## Passo 4 — Vincular as credenciais

Após importar, cada nó que usa Outlook precisa apontar para a credencial correta.

Os nodes que precisam ser atualizados em cada workflow:

| Node | Credencial a usar |
|------|-------------------|
| Get XML Emails | `Outlook — nfe.tejuco` ou `Outlook — nfe.mt` |
| Mark as read | idem |
| Get attachments | idem |
| Download attachment | idem |
| Send to API | `Header Auth account` *(já existente — mesmo secret para todos)* |

Para cada node:
1. Clique no node
2. Em **Credential**, selecione a credencial correta
3. Salve

---

## Passo 5 — Ativar os workflows

Após vincular todas as credenciais:

1. Clique no toggle **Active** no topo do workflow
2. Confirme a ativação
3. O workflow passa a rodar a cada **15 minutos**

---

## Passo 6 — Avisar fornecedores

Informe os fornecedores de cada filial para enviar o XML da NF-e para o email correto:

- Fornecedores de MT → `nfe.mt@hotmail.com`
- Fornecedores de Tejuco → `nfe.tejuco@hotmail.com`
- Fornecedores de MG → continuam enviando para `matheusmouro@hotmail.com` ou `ivanmouro@hotmail.com`

---

## Validar com o script de teste

Após ativar, valide o roteamento com o script de teste:

```bash
# Testar todos os cenários (requer API rodando e WEBHOOK_SECRET no .env)
npx tsx tools/test-nfe-webhook.ts

# Testar só Tejuco
npx tsx tools/test-nfe-webhook.ts --fazenda=sp

# Testar só MT
npx tsx tools/test-nfe-webhook.ts --fazenda=mt

# Apontar para produção
npx tsx tools/test-nfe-webhook.ts --url=https://agromouro-production.up.railway.app
```

O script insere NF-es de teste com número prefixado `TEST` — delete-as pelo dashboard depois.

---

## Diferença do workflow MG (referência)

O workflow original (`My workflow 2.json`) foi atualizado nesta branch para usar
`?fazenda=mg` explicitamente na URL. Antes era sem o param e o servidor usava `mg` como padrão.
Reimporte o arquivo se quiser deixar o comportamento explícito também no MG.
