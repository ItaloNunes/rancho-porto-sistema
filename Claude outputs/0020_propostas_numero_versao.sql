-- Número sequencial de proposta (rastreabilidade — pedido explícito do
-- cliente pra identificar cada proposta por um número, não só pelo lote) +
-- versão, que sobe a cada edição via PATCH /crm/propostas/{id} (ver
-- routers/crm.py::atualizar_proposta). Sequência própria (não usa o id da
-- linha, que é um uuid) pra dar um número curto e sequencial ("Nº 0001",
-- "Nº 0002"...), estável mesmo se uma proposta antiga for excluída.
create sequence if not exists propostas_numero_seq;

alter table propostas add column if not exists numero integer;
alter table propostas add column if not exists versao integer not null default 1;

-- Backfill: numera as propostas já existentes na ordem em que foram criadas,
-- pra quem já tem proposta no sistema não ficar com "numero" vazio.
with numeradas as (
  select id, row_number() over (order by created_at) as rn
  from propostas
  where numero is null
)
update propostas p
set numero = n.rn
from numeradas n
where p.id = n.id;

-- Sequência continua a partir do maior número já usado no backfill, pra
-- toda proposta NOVA a partir daqui ganhar o próximo número da fila.
select setval('propostas_numero_seq', coalesce((select max(numero) from propostas), 0), true);

alter table propostas alter column numero set default nextval('propostas_numero_seq');
alter table propostas alter column numero set not null;

create unique index if not exists propostas_numero_idx on propostas (numero);
