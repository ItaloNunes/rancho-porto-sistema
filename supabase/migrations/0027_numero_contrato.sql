-- 0027 — Numeração própria dos contratos (pedido de 09/10).
-- O 1º contrato emitido pelo sistema recebe o nº 91 (os até 90 já existem
-- fora do sistema), o seguinte 92, e assim por diante. O número é dado na
-- 1ª emissão e fica gravado na proposta: emitir de novo (nova versão) mantém
-- o mesmo número. Proposta que nunca vira contrato não gasta número.

create sequence if not exists contrato_numero_seq start with 91 minvalue 1;

alter table propostas add column if not exists numero_contrato integer unique;

create or replace function atribuir_numero_contrato(p_proposta uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select numero_contrato into n from propostas where id = p_proposta for update;
  if not found then
    raise exception 'proposta % não encontrada', p_proposta;
  end if;
  if n is null then
    n := nextval('contrato_numero_seq');
    update propostas set numero_contrato = n where id = p_proposta;
  end if;
  return n;
end;
$$;

revoke all on function atribuir_numero_contrato(uuid) from public, anon, authenticated;
grant execute on function atribuir_numero_contrato(uuid) to service_role;

-- Conferência: deve mostrar a coluna nova (vazia) e o próximo número = 91.
select
  (select count(*) from propostas where numero_contrato is not null) as contratos_numerados,
  (select last_value from contrato_numero_seq) as proximo_numero;
