-- 0031 — Veneza: balões anuais e financiamento bancário no plano de pagamento (29/10/2026).
-- A tabela de 27/10 do Veneza é entrada (5%) + 36 parcelas + 3 balões anuais + saldo por financiamento
-- bancário. O sistema só tinha entrada + parcelas + chave; agora o lote guarda os balões e o
-- financiamento, a proposta já vem com esse plano preenchido e o contrato do Veneza imprime cada parte.
-- O financiamento é o saldo exato (valor - entrada - 36 parcelas - 3 balões), pra conta fechar no centavo
-- (a tabela arredonda: ex. R$ 209.300,00 na tabela = R$ 209.300,11 no centavo).
-- RODAR DEPOIS da 0030. Pode rodar mais de uma vez.
begin;

alter table lotes add column if not exists qtd_baloes integer;
alter table lotes add column if not exists valor_balao numeric(12,2);
alter table lotes add column if not exists financiamento numeric(12,2);

update lotes l set qtd_baloes = 3, valor_balao = v.balao, financiamento = v.fin
from (values
  ('2', 18, 9966.67, 209300.11),
  ('2', 30, 11433.33, 240099.89),
  ('2', 31, 11433.33, 240099.89),
  ('2', 32, 11433.33, 240099.89),
  ('2', 35, 11433.33, 240099.89),
  ('2', 36, 11433.33, 240099.89),
  ('2', 37, 11433.33, 240099.89),
  ('2', 38, 11433.33, 240099.89),
  ('2', 39, 11433.33, 240099.89),
  ('4', 86, 9966.67, 209300.11),
  ('4', 87, 9966.67, 209300.11),
  ('4', 99, 9966.67, 209300.11),
  ('4', 109, 12671.20, 266095.20),
  ('5', 110, 12620.00, 265020.00),
  ('5', 111, 11433.33, 240099.89),
  ('5', 112, 11433.33, 240099.89),
  ('5', 113, 11433.33, 240099.89),
  ('5', 114, 11433.33, 240099.89),
  ('5', 115, 11433.33, 240099.89),
  ('5', 116, 11433.33, 240099.89),
  ('5', 117, 11433.33, 240099.89),
  ('5', 118, 11433.33, 240099.89),
  ('5', 119, 11433.33, 240099.89),
  ('5', 120, 11433.33, 240099.89),
  ('5', 121, 11433.33, 240099.89),
  ('5', 131, 11433.33, 240099.89),
  ('5', 132, 11433.33, 240099.89),
  ('5', 133, 11433.33, 240099.89),
  ('5', 134, 11433.33, 240099.89),
  ('5', 135, 11433.33, 240099.89),
  ('5', 136, 11433.33, 240099.89),
  ('5', 137, 11433.33, 240099.89),
  ('6', 139, 13406.13, 281528.69),
  ('6', 140, 9966.67, 209300.11),
  ('6', 141, 9966.67, 209300.11),
  ('6', 143, 9966.67, 209300.11),
  ('6', 144, 9966.67, 209300.11),
  ('6', 145, 9966.67, 209300.11),
  ('6', 146, 9966.67, 209300.11),
  ('6', 147, 9966.67, 209300.11),
  ('6', 148, 9966.67, 209300.11),
  ('6', 149, 9966.67, 209300.11),
  ('6', 150, 9966.67, 209300.11),
  ('6', 151, 9966.67, 209300.11),
  ('6', 153, 9966.67, 209300.11),
  ('6', 154, 9966.67, 209300.11),
  ('6', 155, 9966.67, 209300.11),
  ('6', 156, 9966.67, 209300.11),
  ('6', 157, 9966.67, 209300.11),
  ('6', 158, 9966.67, 209300.11),
  ('6', 159, 9966.67, 209300.11),
  ('6', 160, 9966.67, 209300.11),
  ('6', 161, 9966.67, 209300.11),
  ('6', 162, 9966.67, 209300.11),
  ('6', 163, 9966.67, 209300.11),
  ('6', 164, 10083.60, 211755.60),
  ('7', 165, 11499.20, 241483.20),
  ('7', 166, 11433.33, 240099.89),
  ('7', 167, 11433.33, 240099.89),
  ('7', 168, 11433.33, 240099.89),
  ('7', 169, 11433.33, 240099.89),
  ('7', 170, 11433.33, 240099.89),
  ('7', 171, 11433.33, 240099.89),
  ('7', 172, 9966.67, 209300.11),
  ('7', 173, 11433.33, 240099.89),
  ('7', 174, 11433.33, 240099.89),
  ('7', 175, 11433.33, 240099.89),
  ('7', 176, 11433.33, 240099.89)
) as v(quadra, numero, balao, fin)
where l.condominio_id = (select id from condominios where slug = 'veneza')
  and l.quadra = v.quadra and l.lote_numero = v.numero;

commit;

-- Conferência (deve dar: 68 casas, 68 com balões, 0 que não fecham)
select count(*) as casas,
       count(*) filter (where qtd_baloes = 3) as com_baloes,
       count(*) filter (where abs(valor_total - entrada - qtd_parcelas * parcela_mensal - qtd_baloes * valor_balao - financiamento) > 0.005) as nao_fecham
from lotes
where condominio_id = (select id from condominios where slug = 'veneza');
