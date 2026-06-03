# Design: Compras com Cartão de Crédito

**Data:** 2026-06-03  
**Status:** Aprovado  
**Abordagem escolhida:** C — Importação OFX (fluxo principal) + Entrada manual (fallback)

---

## Contexto

Gestores da fazenda fazem compras operacionais (peças de máquina, manutenção, alimentação, combustível) com cartões de crédito empresariais em estabelecimentos que frequentemente não emitem NF-e. Essas despesas não entram no sistema automaticamente, criando um gap no controle de custos. A solução captura essas despesas via importação do extrato OFX do Banco do Brasil e via lançamento manual pontual.

**Escopo:** cartões são usados exclusivamente para despesas operacionais — nunca para insumos agrícolas. Não há atualização de estoque.

---

## Modelo de Dados

### Nova tabela `cartoes`

```sql
CREATE TABLE cartoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apelido          TEXT NOT NULL,
  ultimos_digitos  CHAR(4),
  banco            TEXT DEFAULT 'Banco do Brasil',
  responsavel      TEXT,
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id),
  ativo            BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

RLS: `fazenda_id = get_fazenda_ativa_id()` — isolamento multi-tenant igual às outras tabelas.

### Alterações em `lancamentos_financeiros`

```sql
ALTER TABLE lancamentos_financeiros
  ADD COLUMN cartao_id  UUID REFERENCES cartoes(id) ON DELETE SET NULL,
  ADD COLUMN origem     TEXT CHECK (origem IN ('nfe', 'cartao', 'manual')),
  ADD COLUMN ofx_fitid  TEXT;

CREATE UNIQUE INDEX ON lancamentos_financeiros (cartao_id, ofx_fitid)
  WHERE ofx_fitid IS NOT NULL;
```

- `origem`: NULL é tratado como 'nfe' (retrocompatibilidade)
- `ofx_fitid`: ID único da transação no banco — garante deduplicação ao reimportar o mesmo extrato

### Categorias para despesas de cartão

Valores usados no campo `categoria` de `lancamentos_financeiros`:

| Valor | Exibição |
|-------|----------|
| `peca_maquina` | Peça de máquina |
| `manutencao` | Manutenção |
| `alimentacao` | Alimentação |
| `combustivel` | Combustível |
| `servico` | Serviço |
| `outros` | Outros |

---

## Fluxo de Importação OFX

### Parser OFX (`api/src/services/ofxParser.ts`)

O Banco do Brasil exporta OFX 1.x (SGML). Parse manual sem dependência externa.

```typescript
interface TransacaoOFX {
  fitid:    string   // ID único — usado para deduplicação
  data:     string   // "2026-05-30"
  descricao: string  // "POSTO SHELL UBERABA"
  valor:    number   // sempre positivo (absoluto)
}

parseOFX(fileContent: string): TransacaoOFX[]
```

Todas as transações são retornadas. Transações com `TRNAMT > 0` (pagamentos de fatura, reembolsos) chegam ao frontend com `incluir: false` por padrão — o usuário pode reativar caso queira registrar um crédito/reembolso.

### Rotas da API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/cartoes` | Listar cartões da fazenda |
| POST | `/cartoes` | Cadastrar cartão |
| PUT | `/cartoes/:id` | Atualizar cartão |
| DELETE | `/cartoes/:id` | Desativar cartão (soft delete) |
| POST | `/cartoes/:id/importar-preview` | Parseia OFX, retorna prévia com flag `ja_importado` |
| POST | `/cartoes/:id/confirmar-importacao` | Salva transações confirmadas |
| POST | `/lancamentos/cartao` | Lançamento manual avulso |

### Fluxo de importação (UX)

1. Usuário seleciona cartão → clica **Importar Extrato**
2. Faz upload do arquivo `.OFX`
3. API parseia e retorna lista de transações com `ja_importado: true/false`
4. Frontend exibe tabela de revisão editável:

```
Data  | Estabelecimento  | Valor    | Categoria ▾   | ☑ Incluir
30/05 | POSTO SHELL      | R$185,90 | Combustível   | ☑
28/05 | MERCADO CENTRO   | R$320,00 | Alimentação   | ☑
27/05 | PAGAMENTO FATURA | R$900,00 | Outros        | ☐
```

- Categoria é um `<Select>` editável por linha antes de confirmar
- Transações com `TRNAMT > 0` (créditos) chegam desmarcadas por padrão
- Rodapé mostra: "X selecionados · R$ valor total"

5. Usuário clica **Confirmar** → API insere lançamentos com `origem: 'cartao'`, `ofx_fitid`
6. Se o mesmo FITID já existe para aquele cartão → ignorado silenciosamente (dedup)

---

## Entrada Manual

Botão **+ Lançamento Manual** disponível em cada card de cartão e na listagem geral.

### Formulário (dialog)

| Campo | Tipo |
|-------|------|
| Data | Date picker (default: hoje) |
| Estabelecimento | Text input |
| Valor | Number (R$) |
| Categoria | Select (6 opções) |
| Cartão | Select (cartões cadastrados) |

### Rota

`POST /lancamentos/cartao` insere com `origem: 'manual'`, `ofx_fitid: null`.

Lançamentos manuais podem ser editados e deletados sem restrição.

---

## Frontend

### Nova página `/cartoes`

Entrada na sidebar entre **Financeiro** e **NF-e**.

**Layout:**
- Grid de cards (um por cartão): apelido, últimos 4 dígitos, banco, responsável
- Cada card tem: botão **Importar Extrato** + botão **+ Manual**
- Botão global **+ Cadastrar Cartão**
- Tabela "Lançamentos Recentes" abaixo do grid (todos os cartões, ordenado por data desc)

### Ajuste na página `/financeiro`

Adiciona filtro de origem no topo da listagem:

```
[Todos] [NF-e] [Cartão] [Manual]
```

Lançamentos de cartão exibem um badge com o apelido do cartão. Nenhuma outra mudança estrutural.

---

## Arquivos Modificados/Criados

| Arquivo | Ação |
|---------|------|
| `supabase/migrations/002_cartoes.sql` | Criar tabela `cartoes` + alterar `lancamentos_financeiros` |
| `api/src/services/ofxParser.ts` | Novo — parser OFX do BB |
| `api/src/routes/cartoes.ts` | Novo — CRUD + importar-preview + confirmar |
| `api/src/index.ts` | Registrar rota `/cartoes` e `/lancamentos/cartao` |
| `web/app/(app)/cartoes/page.tsx` | Nova página |
| `web/components/sidebar.tsx` | Adicionar item nav "Cartões" |
| `web/components/mobile-nav.tsx` | Adicionar item nav "Cartões" |
| `web/lib/types.ts` | Adicionar tipo `Cartao` |
| `web/app/(app)/financeiro/page.tsx` | Adicionar filtro por origem |

---

## Verificação

1. Cadastrar um cartão → aparece no grid da página `/cartoes`
2. Upload de arquivo OFX real do BB → tabela de prévia exibe transações corretas
3. Confirmar importação → lançamentos aparecem em `/financeiro` com badge do cartão e filtro `Cartão`
4. Reimportar o mesmo OFX → nenhum duplicado criado (dedup por FITID)
5. Lançamento manual → aparece imediatamente na listagem com `origem: 'manual'`
6. Troca de fazenda no switcher → cartões e lançamentos mudam conforme a fazenda ativa (RLS)
