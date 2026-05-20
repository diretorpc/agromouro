-- ============================================================
-- AgroMouro — Schema MVP do Supabase
-- Execute este arquivo no SQL Editor do Supabase
-- ============================================================

-- ─── FAZENDA ──────────────────────────────────────────────
create table if not exists fazenda (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  hectares    numeric(10,2),
  municipio   text,
  estado      char(2),
  lat         numeric(10,6),
  lng         numeric(10,6),
  created_at  timestamptz default now()
);

-- ─── TALHÕES ──────────────────────────────────────────────
create table if not exists talhoes (
  id            uuid primary key default gen_random_uuid(),
  fazenda_id    uuid references fazenda(id) on delete set null,
  nome          text not null,
  area_ha       numeric(10,2) not null,
  cultura_atual text,
  status        text default 'ativo' check (status in ('ativo', 'pousio', 'colhido')),
  created_at    timestamptz default now()
);

-- ─── SAFRAS ───────────────────────────────────────────────
create table if not exists safras (
  id                    uuid primary key default gen_random_uuid(),
  talhao_id             uuid references talhoes(id) on delete cascade,
  cultura               text not null,
  data_plantio          date,
  data_colheita_prevista date,
  status                text default 'em_andamento' check (status in ('em_andamento', 'colhida', 'perdida')),
  created_at            timestamptz default now()
);

-- ─── OPERAÇÕES ────────────────────────────────────────────
create table if not exists operacoes (
  id          uuid primary key default gen_random_uuid(),
  talhao_id   uuid references talhoes(id) on delete set null,
  safra_id    uuid references safras(id) on delete set null,
  tipo        text not null check (tipo in ('plantio','pulverizacao','adubacao','colheita','outro')),
  data        date not null default current_date,
  descricao   text not null,
  fonte       text default 'manual' check (fonte in ('whatsapp','manual','jd')),
  created_at  timestamptz default now()
);

-- ─── INSUMOS ──────────────────────────────────────────────
create table if not exists insumos (
  id       uuid primary key default gen_random_uuid(),
  nome     text not null,
  tipo     text not null check (tipo in ('herbicida','fungicida','inseticida','biologico','fertilizante_n','fertilizante_p','fertilizante_k','fertilizante_outro','calcario','semente','combustivel','lubrificante','peca_maquina','servico','frete','operacional','rh','outro')),
  unidade  text not null default 'L',
  created_at timestamptz default now()
);

-- ─── ESTOQUE ──────────────────────────────────────────────
create table if not exists estoque (
  id                      uuid primary key default gen_random_uuid(),
  insumo_id               uuid references insumos(id) on delete cascade unique,
  quantidade_atual        numeric(12,3) default 0,
  quantidade_minima_alerta numeric(12,3) default 0,
  preco_medio_unitario    numeric(10,2),
  updated_at              timestamptz default now()
);

-- ─── MOVIMENTAÇÕES DE ESTOQUE ─────────────────────────────
create table if not exists movimentacoes_estoque (
  id              uuid primary key default gen_random_uuid(),
  insumo_id       uuid references insumos(id) on delete cascade,
  tipo            text not null check (tipo in ('entrada','saida')),
  quantidade      numeric(12,3) not null,
  data            date not null default current_date,
  origem          text default 'manual' check (origem in ('nfe','whatsapp','manual')),
  nota_fiscal_id  uuid,
  created_at      timestamptz default now()
);

-- ─── NOTAS FISCAIS ────────────────────────────────────────
create table if not exists notas_fiscais (
  id              uuid primary key default gen_random_uuid(),
  numero          text,
  emitente_nome   text,
  emitente_cnpj   text,
  data_emissao    date,
  valor_total     numeric(12,2),
  status          text default 'recebida' check (status in ('recebida','processando','processada','erro')),
  xml_raw         text,
  created_at      timestamptz default now()
);

-- ─── ITENS DA NF-e ────────────────────────────────────────
create table if not exists itens_nfe (
  id              uuid primary key default gen_random_uuid(),
  nota_fiscal_id  uuid references notas_fiscais(id) on delete cascade,
  descricao       text not null,
  quantidade      numeric(12,3),
  unidade         text,
  valor_unitario  numeric(12,4),
  valor_total     numeric(12,2),
  insumo_id       uuid references insumos(id) on delete set null,
  created_at      timestamptz default now()
);

-- ─── LANÇAMENTOS FINANCEIROS ─────────────────────────────
-- Gerado automaticamente ao processar uma NF-e
create table if not exists lancamentos_financeiros (
  id              uuid primary key default gen_random_uuid(),
  data            date not null default current_date,
  descricao       text not null,
  valor           numeric(12,2) not null,
  tipo            text not null check (tipo in ('receita','despesa')),
  categoria       text,
  nota_fiscal_id  uuid references notas_fiscais(id) on delete set null,
  created_at      timestamptz default now()
);

-- ─── ALERTAS ──────────────────────────────────────────────
create table if not exists alertas (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null,
  titulo              text not null,
  mensagem            text,
  nivel               text default 'info' check (nivel in ('info','aviso','critico')),
  lido                boolean default false,
  enviado_whatsapp    boolean default false,
  created_at          timestamptz default now()
);

-- ─── DADOS INICIAIS — Categorias de insumos comuns ────────
-- (Substitua pelos produtos reais que você usa)
insert into insumos (nome, tipo, unidade) values
  ('Glifosato 480 SL', 'herbicida', 'L'),
  ('Score 250 EC', 'fungicida', 'L'),
  ('Priori Xtra', 'fungicida', 'L'),
  ('Engeo Pleno', 'inseticida', 'L'),
  ('Ureia 46%', 'fertilizante_n', 'kg'),
  ('MAP', 'fertilizante_p', 'kg'),
  ('KCl Vermelho', 'fertilizante_k', 'kg'),
  ('Diesel S10', 'combustivel', 'L')
on conflict do nothing;

-- Criar estoque zerado para cada insumo inserido
insert into estoque (insumo_id, quantidade_atual, quantidade_minima_alerta)
select id, 0, 0 from insumos
on conflict do nothing;

-- ─── TALHÕES DA FAZENDA ────────────────────────────────────
-- Substitua pelos seus talhões reais
-- insert into talhoes (nome, area_ha, cultura_atual) values
--   ('Talhão 1', 45.0, 'Soja'),
--   ('Talhão 2', 38.5, 'Milho'),
--   ('Talhão 3', 52.0, 'Soja');

-- ============================================================
-- Execute o bloco acima, depois adicione seus talhões reais
-- ============================================================

-- ─── RPC ATÔMICA — atualização de estoque sem race condition ──────────────────
-- Substitui o padrão "SELECT + UPDATE em dois passos" que tem race condition.
-- Um único UPDATE atômico no banco garante consistência mesmo com NF-es simultâneas.
create or replace function incrementar_estoque(p_insumo_id uuid, p_quantidade numeric)
returns void
language sql
security definer
as $$
  update estoque
  set    quantidade_atual = quantidade_atual + p_quantidade,
         updated_at       = now()
  where  insumo_id = p_insumo_id;
$$;

-- ─── ROW LEVEL SECURITY (RLS) ────────────────────────────────────────────────
-- Ativar RLS em todas as tabelas (bloqueia acesso sem política definida)
alter table fazenda                  enable row level security;
alter table talhoes                  enable row level security;
alter table safras                   enable row level security;
alter table operacoes                enable row level security;
alter table insumos                  enable row level security;
alter table estoque                  enable row level security;
alter table movimentacoes_estoque    enable row level security;
alter table notas_fiscais            enable row level security;
alter table itens_nfe                enable row level security;
alter table lancamentos_financeiros  enable row level security;
alter table alertas                  enable row level security;

-- Política: leitura e escrita apenas para usuários autenticados.
-- Em produção, adicione um campo user_id às tabelas e filtre por auth.uid()
-- para garantir que cada usuário veja apenas seus próprios dados.
-- Por enquanto, qualquer usuário autenticado acessa tudo (adequado para uso pessoal).

create policy "Usuários autenticados podem ler" on fazenda
  for select using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler" on talhoes
  for select using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler e escrever" on operacoes
  for all using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler" on insumos
  for select using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler" on estoque
  for select using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler" on movimentacoes_estoque
  for select using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler" on notas_fiscais
  for select using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler" on itens_nfe
  for select using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler" on lancamentos_financeiros
  for select using (auth.role() = 'authenticated');
create policy "Usuários autenticados podem ler e marcar" on alertas
  for all using (auth.role() = 'authenticated');

-- IMPORTANTE: O backend usa a SERVICE_KEY que bypassa o RLS por design.
-- O RLS protege o acesso direto ao banco (ex: via Supabase JS no frontend).

