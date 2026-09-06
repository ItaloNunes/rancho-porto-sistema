-- Extensão do schema para o painel gerencial (CRM de vendas): corretores,
-- clientes/leads e propostas de compra e venda. Rode depois do 0001_init.sql.

create type proposta_status as enum ('rascunho', 'enviada', 'aceita', 'recusada', 'cancelada');

create table corretores (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,             -- vincula ao usuário do Supabase Auth (login do painel)
  nome text not null,
  email text,
  telefone text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  email text,
  cpf text,
  observacoes text,
  origem text,                          -- ex: "site", "indicação", "corretor X"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_clientes_nome on clientes(nome);

-- Uma reserva passa a poder ser ligada a um cliente e a um corretor
-- responsável (mantendo nome/contato soltos para reservas feitas direto
-- pelo cliente no catálogo público, sem cadastro).
alter table reservas add column cliente_id uuid references clientes(id);
alter table reservas add column corretor_id uuid references corretores(id);

-- Proposta de compra e venda de um lote específico.
create table propostas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references lotes(id) on delete cascade,
  cliente_id uuid not null references clientes(id),
  corretor_id uuid references corretores(id),
  valor_proposto numeric not null,
  condicoes_pagamento text,             -- texto livre: entrada, nº parcelas, etc.
  status proposta_status not null default 'rascunho',
  documento_url text,                   -- PDF gerado (Supabase Storage), quando existir
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_propostas_lote on propostas(lote_id);
create index idx_propostas_cliente on propostas(cliente_id);

create trigger trg_clientes_updated before update on clientes
  for each row execute function set_updated_at();
create trigger trg_propostas_updated before update on propostas
  for each row execute function set_updated_at();

-- Tudo aqui é gerenciado só pelo painel interno (usuários autenticados) —
-- nenhuma leitura pública, ao contrário de condominios/lotes.
alter table corretores enable row level security;
alter table clientes enable row level security;
alter table propostas enable row level security;

create policy "corretores_admin" on corretores
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "clientes_admin" on clientes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "propostas_admin" on propostas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
