# Make.com — Setup NF-e por Filial

## Contexto

Cada filial tem um email dedicado. O Make monitora a caixa de entrada e envia o XML para a
API com `?fazenda=<codigo>`. O código já roteia para a fazenda correta.

| Fazenda | Código | Email monitorado | URL do webhook |
|---------|--------|-----------------|----------------|
| MG (existente) | `mg` | matheusmouro@hotmail.com / ivanmouro@hotmail.com | `.../webhook/nfe-email?fazenda=mg` |
| Tejuco (novo) | `tejuco` | nfe.tejuco@hotmail.com *(criar)* | `.../webhook/nfe-email?fazenda=tejuco` |
| MT (novo) | `mt` | nfe.mt@hotmail.com *(criar)* | `.../webhook/nfe-email?fazenda=mt` |

---

## Passo 1 — Criar as contas de email

Crie duas contas Hotmail/Outlook novas:

- `nfe.tejuco@hotmail.com` — NF-es da Fazenda Tejuco (SP)
- `nfe.mt@hotmail.com` — NF-es da Fazenda MT

---

## Passo 2 — Duplicar o cenário MG no Make.com

O cenário MG já está funcionando. Basta duplicá-lo 2x e ajustar email + URL.

### No Make.com

1. Abra o cenário atual (MG)
2. Clique nos **⋮** (três pontos) do cenário → **Clone**
3. Renomeie o clone para `AgroMouro — NF-e Tejuco`
4. Clone novamente o cenário MG e renomeie para `AgroMouro — NF-e MT`

---

## Passo 3 — Configurar o cenário Tejuco

No cenário `AgroMouro — NF-e Tejuco`:

### Módulo de email (Microsoft 365 / Watch Emails)
- Conecte com a conta `nfe.tejuco@hotmail.com`
- Substitua a conexão OAuth existente pela nova conta

### Módulo HTTP (Send to API)
- Altere a URL de:
  ```
  https://agromouro-production.up.railway.app/webhook/nfe-email
  ```
  para:
  ```
  https://agromouro-production.up.railway.app/webhook/nfe-email?fazenda=tejuco
  ```
- Mantenha o header `x-webhook-secret` com o mesmo valor de `WEBHOOK_SECRET`

---

## Passo 4 — Configurar o cenário MT

No cenário `AgroMouro — NF-e MT`:

### Módulo de email
- Conecte com a conta `nfe.mt@hotmail.com`

### Módulo HTTP
- URL:
  ```
  https://agromouro-production.up.railway.app/webhook/nfe-email?fazenda=mt
  ```

---

## Passo 5 — Atualizar o cenário MG (explícito)

No cenário MG existente, atualize a URL do módulo HTTP para ser explícita:

```
https://agromouro-production.up.railway.app/webhook/nfe-email?fazenda=mg
```

Antes estava sem o `?fazenda=mg` e funcionava pelo valor padrão da API. Melhor deixar explícito.

---

## Passo 6 — Ativar os dois novos cenários

Ative os dois cenários novos. O intervalo deve ser o mesmo do MG (15 min).

---

## Passo 7 — Avisar fornecedores

- Fornecedores de MT → enviar XML para `nfe.mt@hotmail.com`
- Fornecedores de Tejuco → enviar XML para `nfe.tejuco@hotmail.com`
- Fornecedores de MG → continuam em `matheusmouro@hotmail.com` / `ivanmouro@hotmail.com`

---

## Validar com o script de teste

```bash
# Testa os 3 cenários contra a API de produção
npx tsx tools/test-nfe-webhook.ts --url=https://agromouro-production.up.railway.app
```

O script insere NF-es de teste com número prefixado `TEST` — delete pelo dashboard depois.
