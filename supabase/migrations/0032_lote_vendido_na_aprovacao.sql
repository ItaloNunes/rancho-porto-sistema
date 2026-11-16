-- 0032 — Lote conta como VENDIDO assim que a proposta é aprovada (pedido de 13/11/2026).
-- Antes o lote só virava 'vendido' ao gerar o contrato ou marcar a proposta como 'aceita',
-- e lotes já aprovados/pagos continuavam aparecendo como 'reservado'.
-- Este script acerta os lotes que JÁ têm proposta aprovada/enviada e ainda estão 'reservado'.
-- Pode rodar mais de uma vez.
begin;

-- Conferência antes (quais lotes vão mudar):
select c.nome as empreendimento, l.quadra, l.lote_numero, l.status as status_atual,
       p.numero as proposta, p.status as status_proposta
from lotes l
join condominios c on c.id = l.condominio_id
join propostas p on p.lote_id = l.id
where p.status in ('aprovada', 'enviada') and l.status = 'reservado'
order by c.nome, l.quadra, l.lote_numero;

update lotes l set status = 'vendido'
where l.status = 'reservado'
  and exists (select 1 from propostas p where p.lote_id = l.id and p.status in ('aprovada', 'enviada'));

commit;
