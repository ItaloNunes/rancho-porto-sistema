-- Log de auditoria: quem fez o quê, quando e em qual registro, em todo o
-- painel (reservas, propostas, clientes, lotes, corretores, qualificação).
-- Pedido depois de um caso real onde não dava pra saber quem tinha
-- cancelado/alterado o quê sem essa trilha. Ator fica nulo só nas ações
-- automáticas do próprio sistema (ex.: reserva expirando sozinha em 72h).
--
-- ator_nome/ator_papel são uma FOTO do nome/papel no momento da ação (não
-- uma referência viva) de propósito: se o corretor for renomeado ou
-- desativado depois, o log continua legível do jeito que aconteceu.
create table if not exists logs_auditoria (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ator_id uuid references corretores(id) on delete set null,
  ator_nome text,
  ator_papel text,
  acao text not null,
  entidade text not null,
  entidade_id text,
  descricao text not null,
  detalhes jsonb
);

create index if not exists logs_auditoria_created_at_idx on logs_auditoria (created_at desc);
create index if not exists logs_auditoria_entidade_idx on logs_auditoria (entidade, entidade_id);
create index if not exists logs_auditoria_ator_idx on logs_auditoria (ator_id);
