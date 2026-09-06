-- Rancho Porto | Catálogo de Lotes — schema inicial
-- Rode este arquivo no SQL Editor do seu projeto Supabase (ou via `supabase db push`).

create extension if not exists "pgcrypto";

create type lote_status as enum ('disponivel', 'reservado', 'vendido');
create type reserva_status as enum ('pendente', 'confirmada', 'cancelada');

-- Um condomínio/empreendimento (ex: Rancho Texas, Porto Franco).
create table condominios (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nome text not null,
  incorporadora text,
  cidade text,
  segmento text,                 -- ex: "Lotes residenciais", "Lotes industriais"
  descricao text,
  logo_url text,                 -- preenchido depois, quando a marca chegar (Supabase Storage)
  hero_image_url text,           -- foto de capa (ex: foto da portaria)
  ativo boolean not null default true,
  -- geometria da planta técnica (viewBox do SVG) e elementos decorativos
  -- (rio, lagoa, rotatórias, av. de entrada) guardados como JSON, no mesmo
  -- formato usado pelo protótipo em HTML/JS.
  plan_w numeric,
  plan_h numeric,
  plan_minx numeric,
  plan_miny numeric,
  plan_decor jsonb,
  base_precos_em date,           -- data de referência da tabela de preços
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um lote dentro de um condomínio.
create table lotes (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  quadra text not null,
  lote_numero int not null,
  identificador text not null,
  tamanho_m2 numeric not null,
  valor_total numeric,
  entrada numeric,
  entrega numeric,
  parcela_mensal numeric,
  qtd_parcelas int,
  prazo_entrega_meses int,
  status lote_status not null default 'disponivel',
  poligono jsonb not null,        -- [[x,y], ...] pontos do polígono na planta SVG
  foto_url text,                  -- foto real do lote (pendente até virem as artes)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condominio_id, lote_numero)
);
create index idx_lotes_condominio on lotes(condominio_id);
create index idx_lotes_status on lotes(condominio_id, status);

-- Pedido de reserva feito por um cliente da imobiliária a partir do catálogo.
create table reservas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references lotes(id) on delete cascade,
  nome text,
  contato text,
  observacao text,
  status reserva_status not null default 'pendente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_reservas_lote on reservas(lote_id);

-- updated_at automático
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_condominios_updated before update on condominios
  for each row execute function set_updated_at();
create trigger trg_lotes_updated before update on lotes
  for each row execute function set_updated_at();
create trigger trg_reservas_updated before update on reservas
  for each row execute function set_updated_at();

-- Row Level Security: o site público só LÊ condomínios ativos e seus lotes.
-- Toda escrita (reservar lote, mudar status, cadastrar lote/condomínio) passa
-- pela API do backend, que usa a service role key e não é afetada pela RLS.
alter table condominios enable row level security;
alter table lotes enable row level security;
alter table reservas enable row level security;

create policy "condominios_leitura_publica" on condominios
  for select using (ativo = true);

create policy "lotes_leitura_publica" on lotes
  for select using (
    exists (select 1 from condominios c where c.id = lotes.condominio_id and c.ativo = true)
  );

-- Reservas não têm política de leitura pública: só o backend (service role)
-- ou um usuário autenticado como admin (ver policy abaixo) acessa.
create policy "reservas_admin" on reservas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
