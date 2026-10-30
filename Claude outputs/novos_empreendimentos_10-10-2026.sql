-- 0029 — Cinco empreendimentos novos da Castel (pedido de 10/10/2026):
-- Boulevard, Praia Mar, Rota dos Ventos, Riviera e Veneza, a partir das
-- tabelas de disponibilidade enviadas (PDF). Entram OCULTOS (ativo = false):
-- não aparecem no site nem para os corretores até o financeiro conferir e
-- liberar (update condominios set ativo = true where slug = '...').
-- Só as unidades que constam nas tabelas (disponíveis e reservadas) entram;
-- linha amarela da tabela = reservado. Pode rodar mais de uma vez.

-- Mesmo número de lote em quadras diferentes (ex.: Boulevard Q2-L1 e Q6-L1).
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'lotes'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) ilike 'UNIQUE (condominio_id, lote_numero)'
  loop
    execute format('alter table lotes drop constraint %I', r.conname);
  end loop;
end $$;

-- Características que a tabela traz e o sistema não tinha onde guardar.
alter table lotes add column if not exists detalhes text;
alter table lotes add column if not exists area_construida_m2 numeric(10,2);

insert into condominios (slug, nome, incorporadora, cidade, segmento, descricao, base_precos_em, ativo)
select v.slug, v.nome, v.incorporadora, v.cidade, v.segmento, v.descricao, v.base, false
from (values
  ('boulevard', 'Boulevard Residence', 'Castel Construções e Incorporações', null, 'Lotes residenciais', 'Tabela de disponibilidade de 03/09/2026: 5 lotes (sol e sombra).', '2026-09-03'::date),
  ('praia-mar', 'Praia Mar', 'Castel Construções e Incorporações', null, 'Lotes residenciais', 'Tabela de disponibilidade: 4 lotes, planos de 12 a 100 meses.', null::date),
  ('rota-dos-ventos', 'Rota dos Ventos', 'Castel Construções e Incorporações', null, 'Lotes residenciais', 'Tabela de disponibilidade: 16 lotes, preço por posição (esquina, sol, sombra).', null::date),
  ('riviera', 'Riviera Residence Beach', 'Castel Construções e Incorporações', 'Tibau/RN', 'Lotes residenciais', 'Tabela de disponibilidade de 02/10/2026 (preços de 04/08/2026): R$ 550,00/m².', '2026-08-04'::date),
  ('veneza', 'Veneza Residencial', 'Castel Construções e Incorporações', null, 'Casas', 'Tabela de vendas de 14/09/2026: casas de 67 m² e 75,77 m², autofinanciamento de 36 meses.', '2026-09-14'::date)
) as v(slug, nome, incorporadora, cidade, segmento, descricao, base)
where not exists (select 1 from condominios c where c.slug = v.slug);

insert into lotes (condominio_id, quadra, lote_numero, identificador, tamanho_m2, valor_total,
                   entrada, qtd_parcelas, parcela_mensal, status, poligono, detalhes, area_construida_m2)
select c.id, v.quadra, v.lote, v.identificador, v.m2, v.valor, v.entrada, v.qtd, v.parcela,
       v.status::lote_status, '[]'::jsonb, v.detalhes, v.area_construida
from (values
  ('boulevard', '2', 1, 'LOTE 01 - QUADRA 2', 389.03, 321000.00, null, null, null, 'disponivel', 'Lote sombra', null),
  ('boulevard', '6', 1, 'LOTE 01 - QUADRA 6', 308.62, 247000.00, null, null, null, 'disponivel', 'Lote sol', null),
  ('boulevard', '13', 15, 'LOTE 15 - QUADRA 13', 200.00, 175000.00, null, null, null, 'disponivel', 'Lote sombra', null),
  ('boulevard', '14', 12, 'LOTE 12 - QUADRA 14', 200.00, 230000.00, null, null, null, 'disponivel', 'Lote sol', null),
  ('boulevard', '16', 1, 'LOTE 01 - QUADRA 16', 301.61, 241500.00, null, null, null, 'disponivel', 'Lote sol', null),
  ('praia-mar', 'ÚNICA', 1, 'LOTE 01', 451.29, 383596.50, 76719.30, 100, 3068.77, 'disponivel', null, null),
  ('praia-mar', 'ÚNICA', 7, 'LOTE 07', 281.11, 238943.50, 47788.70, 100, 1911.54, 'disponivel', null, null),
  ('praia-mar', 'ÚNICA', 8, 'LOTE 08', 273.50, 232475.00, 46495.00, 100, 1859.80, 'disponivel', null, null),
  ('praia-mar', 'ÚNICA', 19, 'LOTE 19', 270.85, 230222.50, 46044.50, 100, 1841.78, 'disponivel', null, null),
  ('rota-dos-ventos', '1', 27, 'LOTE 27 - QUADRA 1', 277.36, 104010.00, null, null, null, 'disponivel', 'Esquina · sombra', null),
  ('rota-dos-ventos', '1', 28, 'LOTE 28 - QUADRA 1', 276.04, 103515.00, null, null, null, 'disponivel', 'Esquina · sombra', null),
  ('rota-dos-ventos', '1', 46, 'LOTE 46 - QUADRA 1', 200.00, 55000.00, null, null, null, 'disponivel', null, null),
  ('rota-dos-ventos', '2', 27, 'LOTE 27 - QUADRA 2', 273.94, 102727.50, null, null, null, 'disponivel', 'Esquina · sombra', null),
  ('rota-dos-ventos', '3', 27, 'LOTE 27 - QUADRA 3', 270.62, 101482.50, null, null, null, 'disponivel', 'Esquina · sombra', null),
  ('rota-dos-ventos', '3', 28, 'LOTE 28 - QUADRA 3', 269.30, 100987.50, null, null, null, 'disponivel', 'Esquina · sombra', null),
  ('rota-dos-ventos', '3', 29, 'LOTE 29 - QUADRA 3', 200.00, 45000.00, null, null, null, 'disponivel', null, null),
  ('rota-dos-ventos', '5', 1, 'LOTE 01 - QUADRA 5', 214.72, 80520.00, null, null, null, 'disponivel', 'Esquina · sombra', null),
  ('rota-dos-ventos', '5', 2, 'LOTE 02 - QUADRA 5', 215.11, 80666.25, null, null, null, 'disponivel', 'Esquina · sol', null),
  ('rota-dos-ventos', '5', 3, 'LOTE 03 - QUADRA 5', 214.91, 80591.25, null, null, null, 'disponivel', 'Sol', null),
  ('rota-dos-ventos', '5', 25, 'LOTE 25 - QUADRA 5', 263.98, 98992.50, null, null, null, 'disponivel', 'Esquina · sombra', null),
  ('rota-dos-ventos', '5', 26, 'LOTE 26 - QUADRA 5', 262.66, 98497.50, null, null, null, 'disponivel', 'Esquina · sombra', null),
  ('rota-dos-ventos', '5', 27, 'LOTE 27 - QUADRA 5', 200.00, 45000.00, null, null, null, 'disponivel', 'Sombra', null),
  ('rota-dos-ventos', '5', 28, 'LOTE 28 - QUADRA 5', 200.00, 45000.00, null, null, null, 'disponivel', 'Sombra', null),
  ('rota-dos-ventos', '5', 29, 'LOTE 29 - QUADRA 5', 200.00, 45000.00, null, null, null, 'disponivel', 'Sombra', null),
  ('rota-dos-ventos', '5', 34, 'LOTE 34 - QUADRA 5', 200.00, 45000.00, null, null, null, 'disponivel', 'Sombra', null),
  ('riviera', 'A', 18, 'LOTE 18 - QUADRA A', 200.00, 195000.00, 9750.00, 100, 1852.50, 'reservado', null, null),
  ('riviera', 'A', 20, 'LOTE 20 - QUADRA A', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'A', 21, 'LOTE 21 - QUADRA A', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'A', 22, 'LOTE 22 - QUADRA A', 200.00, 195000.00, 9750.00, 100, 1852.50, 'reservado', null, null),
  ('riviera', 'A', 23, 'LOTE 23 - QUADRA A', 233.94, 228091.50, 11404.58, 100, 2166.87, 'reservado', null, null),
  ('riviera', 'B', 5, 'LOTE 05 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 21, 'LOTE 21 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 24, 'LOTE 24 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 25, 'LOTE 25 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 26, 'LOTE 26 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 27, 'LOTE 27 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 28, 'LOTE 28 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 29, 'LOTE 29 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 30, 'LOTE 30 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 32, 'LOTE 32 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 33, 'LOTE 33 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'B', 35, 'LOTE 35 - QUADRA B', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'C', 6, 'LOTE 06 - QUADRA C', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('riviera', 'C', 12, 'LOTE 12 - QUADRA C', 200.00, 195000.00, 9750.00, 100, 1852.50, 'disponivel', null, null),
  ('veneza', '2', 18, 'CASA 18 - QUADRA 2', 200.00, 299000.00, null, null, null, 'disponivel', '1ª etapa · saldo só por financiamento bancário', 67.00),
  ('veneza', '2', 30, 'CASA 30 - QUADRA 2', 200.00, 343000.00, null, null, null, 'reservado', 'saldo só por financiamento bancário', 75.77),
  ('veneza', '2', 31, 'CASA 31 - QUADRA 2', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '2', 32, 'CASA 32 - QUADRA 2', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '2', 35, 'CASA 35 - QUADRA 2', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '2', 36, 'CASA 36 - QUADRA 2', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '2', 37, 'CASA 37 - QUADRA 2', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '2', 38, 'CASA 38 - QUADRA 2', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '2', 39, 'CASA 39 - QUADRA 2', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '4', 86, 'CASA 86 - QUADRA 4', 200.00, 299000.00, null, null, null, 'reservado', 'saldo só por financiamento bancário', 67.00),
  ('veneza', '4', 87, 'CASA 87 - QUADRA 4', 200.00, 299000.00, null, null, null, 'disponivel', '1ª etapa · saldo só por financiamento bancário', 67.00),
  ('veneza', '4', 99, 'CASA 99 - QUADRA 4', 200.00, 299000.00, null, null, null, 'disponivel', '2ª etapa', 67.00),
  ('veneza', '4', 109, 'CASA 109 - QUADRA 4', 292.84, 380136.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 110, 'CASA 110 - QUADRA 5', 289.00, 378600.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 111, 'CASA 111 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 112, 'CASA 112 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 113, 'CASA 113 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 114, 'CASA 114 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 115, 'CASA 115 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 116, 'CASA 116 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 117, 'CASA 117 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 118, 'CASA 118 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 119, 'CASA 119 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 120, 'CASA 120 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 121, 'CASA 121 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '2ª etapa', 75.77),
  ('veneza', '5', 131, 'CASA 131 - QUADRA 5', 200.00, 343000.00, null, null, null, 'reservado', null, 75.77),
  ('veneza', '5', 132, 'CASA 132 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '5', 133, 'CASA 133 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '5', 134, 'CASA 134 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '5', 135, 'CASA 135 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '5', 136, 'CASA 136 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '5', 137, 'CASA 137 - QUADRA 5', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '6', 139, 'CASA 139 - QUADRA 6', 347.96, 402184.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '6', 140, 'CASA 140 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 141, 'CASA 141 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 143, 'CASA 143 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 144, 'CASA 144 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 145, 'CASA 145 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 146, 'CASA 146 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 147, 'CASA 147 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 148, 'CASA 148 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 149, 'CASA 149 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 150, 'CASA 150 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 151, 'CASA 151 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 153, 'CASA 153 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 154, 'CASA 154 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 155, 'CASA 155 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 156, 'CASA 156 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 157, 'CASA 157 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 158, 'CASA 158 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 159, 'CASA 159 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 160, 'CASA 160 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 161, 'CASA 161 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 162, 'CASA 162 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 163, 'CASA 163 - QUADRA 6', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '6', 164, 'CASA 164 - QUADRA 6', 208.77, 302508.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '7', 165, 'CASA 165 - QUADRA 7', 204.94, 344976.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 166, 'CASA 166 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 167, 'CASA 167 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 168, 'CASA 168 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 169, 'CASA 169 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 170, 'CASA 170 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 171, 'CASA 171 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 172, 'CASA 172 - QUADRA 7', 200.00, 299000.00, null, null, null, 'disponivel', '3ª etapa', 67.00),
  ('veneza', '7', 173, 'CASA 173 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 174, 'CASA 174 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 175, 'CASA 175 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77),
  ('veneza', '7', 176, 'CASA 176 - QUADRA 7', 200.00, 343000.00, null, null, null, 'disponivel', '3ª etapa', 75.77)
) as v(slug, quadra, lote, identificador, m2, valor, entrada, qtd, parcela, status, detalhes, area_construida)
join condominios c on c.slug = v.slug
where not exists (
  select 1 from lotes l where l.condominio_id = c.id and l.quadra = v.quadra and l.lote_numero = v.lote
);

-- Primeira linha do histórico de preço (migration 0025) pros lotes novos.
insert into lotes_precos_historico
  (lote_id, valor_total, entrada, entrega, parcela_mensal, qtd_parcelas, prazo_entrega_meses, vigente_desde, vigente_ate)
select l.id, l.valor_total, l.entrada, l.entrega, l.parcela_mensal, l.qtd_parcelas, l.prazo_entrega_meses, now(), null
from lotes l
join condominios c on c.id = l.condominio_id
where c.slug in ('boulevard', 'praia-mar', 'rota-dos-ventos', 'riviera', 'veneza')
  and not exists (select 1 from lotes_precos_historico h where h.lote_id = l.id);

-- Conferência: uma linha por empreendimento novo.
select c.nome as empreendimento,
       case when c.ativo then 'visível' else 'oculto' end as situacao,
       count(l.id) as unidades,
       count(l.id) filter (where l.status = 'disponivel') as disponiveis,
       count(l.id) filter (where l.status = 'reservado') as reservadas,
       'R$ ' || translate(to_char(sum(l.valor_total), 'FM999,999,990.00'), ',.', '.,') as valor_total
from condominios c
left join lotes l on l.condominio_id = c.id
where c.slug in ('boulevard', 'praia-mar', 'rota-dos-ventos', 'riviera', 'veneza')
group by c.nome, c.ativo
order by c.nome;
