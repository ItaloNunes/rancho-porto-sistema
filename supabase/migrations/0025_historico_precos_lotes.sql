-- Histórico de preço dos lotes + "congelamento" do preço vigente numa
-- reserva, e um jeito de desfazer a última alteração — pedido explícito do
-- Italo depois do caso da planilha da Sheyla (28/09): "a qualquer hora
-- pode-se mudar os valores de empreendimento, então tem que se estabelecer
-- uma data corte, e também possa voltar ao preço original - se precisar".
--
-- Duas peças:
--
-- 1) `lotes_precos_historico` + trigger: toda vez que valor_total/entrada/
--    entrega/parcela_mensal/qtd_parcelas/prazo_entrega_meses de um lote
--    mudar — por QUALQUER caminho (a planilha de reajuste geral, o processo
--    manual via SQL do reset_e_atualizacao.sql, ou uma futura tela de editar
--    preço) — o valor anterior fica registrado com a data em que deixou de
--    valer. Como é um trigger no Postgres, funciona mesmo pra updates feitos
--    direto no banco, sem passar pelo backend — é a "data corte" pedida.
--
-- 2) `reservas.valor_total_congelado` (+ irmãos): o preço do lote no exato
--    momento em que a reserva nasce fica copiado pra dentro da própria
--    reserva. Isso é o que garante que uma negociação já em andamento não
--    "sente" um reajuste de preço feito depois — ela already carrega o
--    preço que valia quando começou, pra sempre, independente do que
--    acontecer depois com o preço do lote.
--
-- O "voltar ao preço original" é o endpoint POST /condominios/lotes/{id}/
-- preco/reverter (ver condominios.py) que lê a penúltima linha desta tabela
-- e reaplica ela em cima do lote — o que por sua vez, através do MESMO
-- trigger, gera uma nova linha de histórico (nunca apaga nada, só acrescenta
-- outra reversão registrada).

create table if not exists lotes_precos_historico (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references lotes(id) on delete cascade,
  valor_total numeric,
  entrada numeric,
  entrega numeric,
  parcela_mensal numeric,
  qtd_parcelas integer,
  prazo_entrega_meses integer,
  -- Desde quando esse conjunto de valores vale pra este lote.
  vigente_desde timestamptz not null default now(),
  -- Preenchido quando um valor mais novo substitui este (null = "é o
  -- vigente agora"). Só existe UMA linha com vigente_ate null por lote.
  vigente_ate timestamptz,
  -- 'sistema' = mudança normal (planilha, script manual, futura edição);
  -- 'reversao' = admin usou "desfazer última alteração" pra voltar num
  -- valor anterior.
  origem text not null default 'sistema' check (origem in ('sistema', 'reversao')),
  created_at timestamptz not null default now()
);

create index if not exists lotes_precos_historico_lote_idx
  on lotes_precos_historico (lote_id, vigente_desde desc);

-- Só uma linha "vigente" (vigente_ate null) por lote a qualquer momento.
create unique index if not exists lotes_precos_historico_vigente_unico
  on lotes_precos_historico (lote_id)
  where vigente_ate is null;

create or replace function fn_registrar_historico_preco_lote()
returns trigger as $$
begin
  if (
    new.valor_total is distinct from old.valor_total or
    new.entrada is distinct from old.entrada or
    new.entrega is distinct from old.entrega or
    new.parcela_mensal is distinct from old.parcela_mensal or
    new.qtd_parcelas is distinct from old.qtd_parcelas or
    new.prazo_entrega_meses is distinct from old.prazo_entrega_meses
  ) then
    update lotes_precos_historico
       set vigente_ate = now()
     where lote_id = old.id
       and vigente_ate is null;

    insert into lotes_precos_historico
      (lote_id, valor_total, entrada, entrega, parcela_mensal, qtd_parcelas, prazo_entrega_meses, vigente_desde)
    values
      (new.id, new.valor_total, new.entrada, new.entrega, new.parcela_mensal, new.qtd_parcelas, new.prazo_entrega_meses, now());
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lotes_preco_historico on lotes;
create trigger trg_lotes_preco_historico
  after update on lotes
  for each row
  execute function fn_registrar_historico_preco_lote();

-- Backfill: todo lote que já existe ganha sua primeira linha de histórico
-- com o preço atual dele, senão o trigger só teria algo pra comparar a
-- partir da PRÓXIMA mudança em diante.
insert into lotes_precos_historico
  (lote_id, valor_total, entrada, entrega, parcela_mensal, qtd_parcelas, prazo_entrega_meses, vigente_desde, vigente_ate)
select
  l.id, l.valor_total, l.entrada, l.entrega, l.parcela_mensal, l.qtd_parcelas, l.prazo_entrega_meses,
  coalesce(l.created_at, now()), null
from lotes l
where not exists (select 1 from lotes_precos_historico h where h.lote_id = l.id);

-- Preço "congelado" no instante em que a reserva foi criada — ver
-- criar_reserva em reservas.py. Nunca recalculado depois; é a "foto" do
-- preço que valia pra essa negociação específica.
alter table reservas add column if not exists valor_total_congelado numeric;
alter table reservas add column if not exists entrada_congelado numeric;
alter table reservas add column if not exists entrega_congelado numeric;
alter table reservas add column if not exists parcela_mensal_congelada numeric;
alter table reservas add column if not exists qtd_parcelas_congelada integer;
alter table reservas add column if not exists prazo_entrega_meses_congelado integer;
