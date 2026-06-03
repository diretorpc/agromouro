# Design: Compras com Cartão de Crédito

**Data:** 2026-06-03  
**Status:** Aprovado  
**Abordagem escolhida:** C — Importação XLSX (fluxo principal) + Entrada manual (fallback)

---

## Contexto

Gestores da fazenda fazem compras operacionais (peças de máquina, manutenção, alimentação, combustível) com cartões de crédito empresariais em estabelecimentos que frequentemente não emitem NF-e. Essas despesas não entram no sistema automaticamente, criando um gap no controle de custos.

A solução captura essas despesas via importação do relatório de gastos em Excel (.xlsx) consolidado — um arquivo com todos os titulares — e via lançamento manual pontual.

**Escopo:** cartões são usados exclusivamente para despesas operacionais — nunca para insumos agrícolas. Não há atualização de estoque.

---

## Estrutura Real do Arquivo XLSX

Arquivo analisado: `Cartões BB - Matheus, Alexandre, Marcia, Ivan.xlsx`

- **1 aba:** `2026` (458 transações no arquivo atual)
- **Colunas:** `Titular | Bandeira | Dia | Mês | Ano | Descrição | Moeda | Valor`
- **Titulares presentes:** `CC Matheus` (233), `CC Alexandre` (171), `CC Ivan` (39), `CC Marcia` (15)
- **Valor:** já é `number` JavaScript — sem formatação brasileira para parsear
- **Data:** dividida em 3 colunas numéricas (`Dia`, `Mês`, `Ano`) — reconstrução: `new Date(Ano, Mês-1, Dia)`
- **Todos os valores são positivos** — é relatório de gastos puro, sem pagamentos de fatura misturados

Exemplo de linha:
```
["CC Matheus", "Visa", 7, 1, 2026, "HORTIFRUTI MERCES LTDA UBERABA BR", "R$ ", 240]
```

---

## Modelo de Dados

### Nova tabela `cartoes`

```sql
CREATE TABLE cartoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apelido          TEXT NOT NULL,        -- "CC Matheus", "CC Alexandre", etc.
  ultimos_digitos  CHAR(4),
  banco            TEXT DEFAULT 'Banco do Brasil',
  responsavel      TEXT,
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id),
  ativo            BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

RLS: `fazenda_id = get_fazenda_ativa_id()` — isolamento multi-tenant igual às outras tabelas.

> **Nota de mapeamento:** O campo `apelido` deve ser igual ao valor em `Titular` no XLSX  
> (ex: `"CC Matheus"`) para que a importação faça o match automático.

### Alterações em `lancamentos_financeiros`

```sql
ALTER TABLE lancamentos_financeiros
  ADD COLUMN cartao_id   UUID REFERENCES cartoes(id) ON DELETE SET NULL,
  ADD COLUMN origem      TEXT CHECK (origem IN ('nfe', 'cartao', 'manual')),
  ADD COLUMN dedup_hash  TEXT;

CREATE UNIQUE INDEX ON lancamentos_financeiros (cartao_id, dedup_hash)
  WHERE dedup_hash IS NOT NULL;
```

- `origem`: NULL é tratado como 'nfe' (retrocompatibilidade com registros existentes)
- `dedup_hash`: SHA-256 de `(titular + dia + mes + ano + descricao + valor)` — evita duplicatas ao reimportar o mesmo arquivo

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

## Fluxo de Importação XLSX

### Dependência

```
xlsx (SheetJS) — já instalado em api/
npm install xlsx  (na pasta api/)
```

### Parser XLSX (`api/src/services/xlsxParser.ts`)

```typescript
interface TransacaoExtrato {
  titular:   string   // "CC Matheus" — mapeia para cartoes.apelido
  data:      string   // "2026-01-07" (Ano + Mês + Dia reconstruídos)
  descricao: string   // "HORTIFRUTI MERCES LTDA UBERABA BR"
  valor:     number   // 240 (já é number no arquivo)
  dedupHash: string   // SHA-256(titular+dia+mes+ano+descricao+valor)
}

parseXLSX(buffer: Buffer): TransacaoExtrato[]
```

Lógica de parse:
1. Ler aba `2026` (ou primeira aba disponível)
2. Linha 0 é cabeçalho — iterar a partir da linha 1
3. Construir data: `new Date(row[4], row[3] - 1, row[2])` → `YYYY-MM-DD`
4. Valor já é number: `row[7]`
5. Gerar `dedupHash` por transação

### Rotas da API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/cartoes` | Listar cartões da fazenda |
| POST | `/cartoes` | Cadastrar cartão |
| PUT | `/cartoes/:id` | Atualizar cartão |
| DELETE | `/cartoes/:id` | Desativar cartão (soft delete) |
| POST | `/cartoes/importar-preview` | Parseia XLSX completo, retorna preview agrupado por titular |
| POST | `/cartoes/confirmar-importacao` | Salva transações confirmadas |
| POST | `/lancamentos/cartao` | Lançamento manual avulso |

### Fluxo de importação (UX)

O upload é do **arquivo completo** (todos os titulares de uma vez):

1. Usuário clica **Importar Extrato** na página `/cartoes`
2. Faz upload do `.xlsx`
3. API parseia, agrupa por `Titular`, faz match automático com `cartoes.apelido`
4. Frontend exibe seções por cartão:

```
── CC Matheus (233 transações) ─────────────────────
Data  | Estabelecimento           | Valor     | Categoria ▾  | ☑
07/01 | HORTIFRUTI MERCES LTDA    | R$240,00  | Alimentação  | ☑
07/01 | RECANTO DAS LARANJEIRAS   | R$117,05  | Alimentação  | ☑
08/01 | MERCADOLIVRE*11PRODUTOS   | R$486,78  | Outros       | ☑
...

── CC Alexandre (171 transações) ───────────────────
...
```

- Categoria editável por linha (`<Select>`) — usuário corrige antes de confirmar
- Checkbox por linha para incluir/excluir
- Rodapé global: "X de Y selecionados · R$ total"
- Transações com `dedupHash` já existente aparecem desmarcadas com badge "já importado"

5. Usuário revisa, ajusta categorias, clica **Confirmar Importação**
6. API insere lançamentos com `origem: 'cartao'`, `cartao_id`, `dedup_hash`

### Match titular → cartão

- Sistema busca `cartoes` onde `apelido = titular` (case-insensitive)
- Se não encontrar match: exibe aviso "Cartão 'CC X' não cadastrado" — usuário cria o cartão antes de reimportar, ou o sistema cria automaticamente na confirmação

---

## Entrada Manual

Botão **+ Lançamento Manual** disponível na página `/cartoes` e em cada card de cartão.

### Formulário (dialog)

| Campo | Tipo |
|-------|------|
| Data | Date picker (default: hoje) |
| Estabelecimento | Text input |
| Valor | Number (R$) |
| Categoria | Select (6 opções) |
| Cartão | Select (cartões cadastrados) |

### Rota

`POST /lancamentos/cartao` insere com `origem: 'manual'`, `dedup_hash: null`.

Lançamentos manuais podem ser editados e deletados sem restrição.

---

## Frontend

### Nova página `/cartoes`

Entrada na sidebar entre **Financeiro** e **NF-e**.

**Layout:**
- Botão global **Importar Extrato** (arquivo completo) + **+ Cadastrar Cartão**
- Grid de cards (um por cartão): apelido, últimos 4 dígitos, responsável, total de lançamentos
- Cada card tem botão **+ Manual**
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
| `api/src/services/xlsxParser.ts` | Novo — parser XLSX (SheetJS) |
| `api/src/routes/cartoes.ts` | Novo — CRUD + importar-preview + confirmar + manual |
| `api/src/index.ts` | Registrar rotas `/cartoes` e `/lancamentos/cartao` |
| `web/app/(app)/cartoes/page.tsx` | Nova página |
| `web/components/sidebar.tsx` | Adicionar item nav "Cartões" |
| `web/components/mobile-nav.tsx` | Adicionar item nav "Cartões" |
| `web/lib/types.ts` | Adicionar tipo `Cartao` |
| `web/app/(app)/financeiro/page.tsx` | Adicionar filtro por origem |

**Dependência nova:** `xlsx` (SheetJS) — `npm install xlsx` na pasta `api/`

---

## Verificação

1. Cadastrar os 4 cartões com apelido igual ao `Titular` do arquivo (`CC Matheus`, `CC Alexandre`, `CC Marcia`, `CC Ivan`)
2. Upload do arquivo real → prévia exibe 458 transações agrupadas por titular com datas e valores corretos
3. Confirmar importação → lançamentos aparecem em `/financeiro` com badge do cartão e filtro `Cartão`
4. Reimportar o mesmo arquivo → nenhum duplicado criado (dedup por hash)
5. Lançamento manual → aparece imediatamente na listagem com `origem: 'manual'`
6. Troca de fazenda no switcher → cartões e lançamentos mudam conforme a fazenda ativa (RLS)
