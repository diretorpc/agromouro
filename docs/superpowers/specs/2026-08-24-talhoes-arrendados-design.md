# Talhões arrendados — design

**Data:** 24/08/2026
**Estado:** aprovado no brainstorming, aguardando plano de implementação

---

## O problema

A família tem áreas **arrendadas para a Usina Uberaba**: terra própria, operada por
terceiro. Hoje elas não existem no sistema. Quem olha o AgroMouro vê menos terra do que
a família tem.

Cadastrá-las como talhão comum resolveria a listagem e criaria três mentiras:

1. **Custo por hectare** dividiria o gasto por uma área que não é trabalhada — barateando
   artificialmente todos os talhões.
2. **Culturas por Área** somaria a cana da usina à cana própria, inflando a cultura.
3. **Operações** ofereceria a área arrendada no seletor de talhão, permitindo lançar
   pulverização e gasto em terra que a usina opera.

## Objetivo, e o que fica de fora

**Objetivo (decidido pelo dono):** enxergar o **patrimônio completo** — quanta terra a
família tem, separando com clareza o que ela opera do que está arrendado.

**Fora de escopo, explicitamente:** contrato de arrendamento, valor, forma de pagamento,
vencimento e aviso de cobrança. Nada toca Financeiro nem Contas. Se um dia essa
necessidade aparecer, é outra entrega, com outra spec.

---

## Modelagem

### `arrendado` entra como valor de `status`, não como coluna própria

`talhoes.status` hoje é `ativo | pousio | colhido`, com CHECK no banco. Passa a aceitar
`arrendado`.

**A alternativa considerada e descartada:** uma coluna `arrendado boolean` seria mais
ortogonal — regime de posse e estado da lavoura são conceitos independentes, e misturá-los
impede um dia representar "arrendado e em pousio".

Descartada por uma razão concreta: com coluna separada, **qual seria o `status` de uma
área arrendada?** `ativo` seria falso (não é área ativa nossa), `pousio` e `colhido`
também. Sobraria um campo obrigatório sem resposta honesta, ou um `status` que ninguém
pode confiar. O ganho teórico de ortogonalidade custaria dois campos a manter em acordo.
O cenário que a coluna separada protege ("arrendado E em pousio") não interessa a este
negócio: o que a usina faz com a lavoura dela não é dado nosso.

### Nova coluna `arrendatario text`

Nullable, só faz sentido quando `status = 'arrendado'` — e o banco impõe isso.

**Preenchimento é opcional.** Marcar a área como arrendada já entrega o objetivo; exigir
o nome criaria atrito num cadastro que pode acontecer antes de o dono ter o dado à mão.

### Caixa do arrendatário NÃO é normalizada

A cultura passou a ser gravada em minúsculas em 24/08/2026, porque `Cana` e `cana` viravam
duas culturas nas agregações (ver `web/lib/cultura.ts`).

**O arrendatário não recebe o mesmo tratamento**, e a diferença é deliberada: é nome
próprio. Minusculizar quebraria nomes com preposição — a exibição usa CSS `capitalize`,
que transformaria `usina de uberaba` em `Usina De Uberaba`. Aplicar só `.trim()`.

O risco de grafia dupla existe e é aceito: o campo **não agrupa nada**, só é exibido. No
dia em que alguém quiser somar área por arrendatário, aí sim é preciso normalizar — e
provavelmente virar tabela própria.

---

## Comportamento por tela

### Talhões (`web/app/(app)/talhoes/page.tsx`)

- `STATUS_OPTIONS` (linha 29) ganha `arrendado`; `STATUS_STYLE` (linha 31) ganha uma cor
  visualmente distinta das três atuais.
- O campo **Arrendatário** aparece no diálogo somente quando o status escolhido é
  `arrendado`.
- KPI **Área Total** passa a somar tudo (próprio + arrendado) — decisão do dono: o número
  grande responde "quanta terra nós temos". A sublinha diz `N talhões · sendo X ha
  arrendados`. Sem arrendado nenhum, a sublinha volta ao texto de hoje.
- KPI **Talhões Cadastrados**: a sublinha deixa de ser `N ativos` e passa a
  `N em operação · M arrendados`.
- KPI **Culturas Ativas** (linha 320) **ignora talhões arrendados** — a cana plantada lá é
  da usina, não da família.

> **Isto não contradiz a fatia "Arrendado" do Dashboard**, embora pareça. São perguntas
> diferentes: "Culturas Ativas" conta *quais culturas nós plantamos* — a cana da usina não
> é uma delas. "Culturas por Área" reparte *hectares*, e todo hectare precisa aparecer em
> algum lugar para o gráfico bater com o total. Por isso um exclui e o outro nomeia.
- Tabela: o badge de status já cobre a marcação. O nome do arrendatário aparece em texto
  secundário junto ao nome do talhão.

### Dashboard (`web/app/(app)/dashboard/page.tsx`)

- `haTotal` (linha 158) continua somando tudo — coerente com a decisão da Área Total.
- `talhoesAtivos` (linha 157) já exclui arrendados sozinho, porque filtra `status ===
  'ativo'`. Nada a mudar.
- **Culturas por Área** (linha 174): talhão arrendado **não entra pela cultura**; entra
  numa fatia própria chamada **"Arrendado"**.

  Por que fatia própria e não exclusão: o gráfico calcula a porcentagem sobre a soma das
  próprias fatias. Excluir os arrendados faria o gráfico deixar de bater com o `haTotal`
  exibido logo acima, e a tela passaria a se contradizer. A fatia nomeada mantém a soma
  correta **e** impede confundir a cana da usina com a nossa.

### Operações (`web/app/(app)/operacoes/page.tsx`)

- O seletor de talhão (linha ~668) **deixa de listar** talhões arrendados. É a trava que
  impede lançar operação e gasto em terra operada por terceiro.
- Talhão já arrendado que tenha operação antiga continua exibindo normalmente no
  histórico — a mudança é só de cadastro novo, nunca retroativa.

### Custos (`web/app/(app)/custos/page.tsx`)

**Nada a fazer, e isso foi verificado, não presumido.** A tela monta `talhaoMap` a partir
de `operacoes`; talhão sem operação nunca aparece. Como Operações passa a não aceitar
arrendados, eles nunca chegam ao Custos. O KPI "X ha no total" (linha 236) soma apenas os
talhões que entraram no mapa, então também sai correto sozinho.

### Tipos (`web/lib/types.ts`)

`Talhao.status` (linha 6) ganha `'arrendado'` na união; nova propriedade
`arrendatario: string | null`.

Consequência útil: o TypeScript vai apontar sozinho todo `Record<Talhao['status'], …>` que
ficou sem o caso novo — é o caso de `STATUS_STYLE`.

---

## Migration

O nome da constraint de CHECK em produção **não pode ser presumido** — `schema.sql` está
desatualizado e as migrations foram coladas à mão no SQL Editor. A migration descobre o
nome em vez de cravá-lo:

```sql
-- 1. Trocar o CHECK de status, seja qual for o nome dele em produção
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'talhoes'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then
    execute format('alter table talhoes drop constraint %I', c);
  end if;
end $$;

alter table talhoes add constraint talhoes_status_check
  check (status in ('ativo','pousio','colhido','arrendado'));

-- 2. Arrendatário, só preenchível quando a área está arrendada
alter table talhoes add column if not exists arrendatario text;

alter table talhoes add constraint talhoes_arrendatario_so_se_arrendado
  check (arrendatario is null or status = 'arrendado');
```

**Conferir depois de aplicar:**

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'talhoes'::regclass and contype = 'c';
```

**RLS:** nada a fazer. A policy `talhoes_tenant` é `FOR ALL` e não olha `status`.

---

## Testes

Lógica pura, no padrão já estabelecido em `web/app/(app)/talhoes/salvar-talhao.ts`:

- `prepararTalhao` grava `arrendatario` aparado, e **null quando o status não é
  arrendado** — mesmo que o formulário traga texto (o usuário pode digitar o arrendatário
  e depois trocar o status; sem essa limpeza o INSERT bate na CHECK do banco).
- Agregações: uma função pura que separa área própria de arrendada, com teste provando que
  a soma das duas é igual ao total.
- Culturas por área: teste provando que talhão arrendado vai para a fatia "Arrendado" e
  **não** para a cultura dele.

Comando que mede: `cd web && npx tsc --noEmit && npx vitest run && npm run build`

---

## O que pode dar errado

- **A migration falha se já existir linha com status inválido.** Não existe hoje, mas a
  ordem importa: trocar o CHECK antes de qualquer INSERT com `arrendado`.
- **`arrendatario` preenchido com status não-arrendado** é recusado pelo banco. Por isso a
  limpeza no `prepararTalhao` é obrigatória, não cosmética.
- **A fatia "Arrendado" colide com uma cultura chamada "arrendado".** Improvável, mas o
  código deve comparar por status, nunca pelo texto da cultura.
- **Área Total cresce de uma vez** quando as áreas forem cadastradas. Esperado, e é o
  ponto da mudança — mas vale avisar quem olha o painel, para ninguém achar que é bug.
