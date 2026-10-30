-- 0030 — Veneza e Riviera: planta interativa, capa, logo, cidade e tabela do Veneza de 27/10/2026.
-- Gerado a partir do material da pasta CASTEL (MAPA VENEZA P.jpeg, RIVIERA RESIDENCIAL.pdf,
-- TABELA VENEZA 27-10-2026, folder digital e fotos). Os dois continuam OCULTOS (ativo = false):
-- só o admin vê até a liberação. A casa 18 só vira reservada se ainda estiver disponível.
begin;

update condominios set
  cidade = 'Mossoró/RN',
  descricao = 'Casas de 2 e 3 quartos em condomínio fechado, com piscina, salão de festas, espaço gourmet e quadras.',
  logo_url = '/brand/veneza-logo.png', hero_image_url = '/brand/veneza-capa.jpg',
  base_precos_em = '2026-10-27',
  plan_image_url = '/brand/veneza-planta.jpg', plan_w = 1251, plan_h = 1275, plan_minx = 0, plan_miny = 0,
  plan_quadras = '[{"quadra": "1", "x": 475, "y": 1115, "w": 684, "h": 128}, {"quadra": "2", "x": 56, "y": 15, "w": 96, "h": 1200}, {"quadra": "3", "x": 203, "y": 875, "w": 910, "h": 195}, {"quadra": "4", "x": 201, "y": 633, "w": 822, "h": 197}, {"quadra": "5", "x": 199, "y": 395, "w": 736, "h": 198}, {"quadra": "6", "x": 201, "y": 155, "w": 654, "h": 195}, {"quadra": "7", "x": 199, "y": 15, "w": 582, "h": 105}]'::jsonb
where slug = 'veneza';

-- Tabela 27/10: entrada 5%, 36 parcelas mensais, 3 balões anuais e o saldo por financiamento.
-- Balões e financiamento vão em "detalhes" (aparecem na ficha da casa). Mesmos preços da tabela anterior.
update lotes l set entrada = v.entrada, parcela_mensal = v.parcela, qtd_parcelas = 36, entrega = null,
  detalhes = v.detalhes, poligono = v.pol::jsonb, poligono_definido = true
from (values
  ('2', 18, 14950.00, 1245.83, '2 quartos (1 suíte) · 36x + 3 balões anuais de R$ 9.966,67 · saldo por financiamento bancário', '[[56, 1024.0], [152, 1024.0], [152, 1072.0], [56, 1072.0]]'),
  ('2', 30, 17150.00, 1429.17, '3 quartos (1 suíte) · 36x + 3 balões anuais de R$ 11.433,33 · saldo por financiamento bancário', '[[56, 441.0], [152, 441.0], [152, 490.0], [56, 490.0]]'),
  ('2', 31, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[56, 393.5], [152, 393.5], [152, 441.0], [56, 441.0]]'),
  ('2', 32, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[56, 344.5], [152, 344.5], [152, 393.5], [56, 393.5]]'),
  ('2', 35, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[56, 199.0], [152, 199.0], [152, 248.0], [56, 248.0]]'),
  ('2', 36, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[56, 151.0], [152, 151.0], [152, 199.0], [56, 199.0]]'),
  ('2', 37, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[56, 103.0], [152, 103.0], [152, 151.0], [56, 151.0]]'),
  ('2', 38, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[56, 62.0], [152, 62.0], [152, 103.0], [56, 103.0]]'),
  ('2', 39, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[56, 15], [152, 15], [152, 62.0], [56, 62.0]]'),
  ('4', 86, 14950.00, 1245.83, '2 quartos (1 suíte) · 36x + 3 balões anuais de R$ 9.966,67 · saldo por financiamento bancário', '[[542.0, 733], [590.0, 733], [590.0, 830], [542.0, 830]]'),
  ('4', 87, 14950.00, 1245.83, '2 quartos (1 suíte) · 1ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · saldo por financiamento bancário', '[[493.0, 733], [542.0, 733], [542.0, 830], [493.0, 830]]'),
  ('4', 99, 14950.00, 1245.83, '2 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[444.0, 633], [492.0, 633], [492.0, 733], [444.0, 733]]'),
  ('4', 109, 19006.80, 1583.90, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 12.671,20 · financiamento de R$ 266.095,20', '[[934.0, 633], [989, 633], [989, 733], [934.0, 733]]'),
  ('5', 110, 18930.00, 1577.50, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 12.620,00 · financiamento de R$ 265.020,00', '[[882.0, 495], [935, 495], [935, 593], [882.0, 593]]'),
  ('5', 111, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[830.0, 495], [882.0, 495], [882.0, 593], [830.0, 593]]'),
  ('5', 112, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[782.0, 495], [830.0, 495], [830.0, 593], [782.0, 593]]'),
  ('5', 113, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[733.0, 495], [782.0, 495], [782.0, 593], [733.0, 593]]'),
  ('5', 114, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[684.0, 495], [733.0, 495], [733.0, 593], [684.0, 593]]'),
  ('5', 115, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[637.0, 495], [684.0, 495], [684.0, 593], [637.0, 593]]'),
  ('5', 116, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[589.0, 495], [637.0, 495], [637.0, 593], [589.0, 593]]'),
  ('5', 117, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[540.0, 495], [589.0, 495], [589.0, 593], [540.0, 593]]'),
  ('5', 118, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[492.0, 495], [540.0, 495], [540.0, 593], [492.0, 593]]'),
  ('5', 119, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[444.0, 495], [492.0, 495], [492.0, 593], [444.0, 593]]'),
  ('5', 120, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[395.0, 495], [444.0, 495], [444.0, 593], [395.0, 593]]'),
  ('5', 121, 17150.00, 1429.17, '3 quartos (1 suíte) · 2ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[346.0, 495], [395.0, 495], [395.0, 593], [346.0, 593]]'),
  ('5', 131, 17150.00, 1429.17, '3 quartos (1 suíte) · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[492.0, 395], [540.0, 395], [540.0, 495], [492.0, 495]]'),
  ('5', 132, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[540.0, 395], [589.0, 395], [589.0, 495], [540.0, 495]]'),
  ('5', 133, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[589.0, 395], [638.0, 395], [638.0, 495], [589.0, 495]]'),
  ('5', 134, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[638.0, 395], [686.0, 395], [686.0, 495], [638.0, 495]]'),
  ('5', 135, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[686.0, 395], [734.0, 395], [734.0, 495], [686.0, 495]]'),
  ('5', 136, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[734.0, 395], [782.0, 395], [782.0, 495], [734.0, 495]]'),
  ('5', 137, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[782.0, 395], [841.0, 395], [841.0, 495], [782.0, 495]]'),
  ('6', 139, 20109.20, 1675.77, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 13.406,13 · financiamento de R$ 281.528,80', '[[794.0, 253], [855, 253], [855, 350], [794.0, 350]]'),
  ('6', 140, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[732.0, 253], [794.0, 253], [794.0, 350], [732.0, 350]]'),
  ('6', 141, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[683.0, 253], [732.0, 253], [732.0, 350], [683.0, 350]]'),
  ('6', 143, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[587.0, 253], [636.0, 253], [636.0, 350], [587.0, 350]]'),
  ('6', 144, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[539.0, 253], [587.0, 253], [587.0, 350], [539.0, 350]]'),
  ('6', 145, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[492.0, 253], [539.0, 253], [539.0, 350], [492.0, 350]]'),
  ('6', 146, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[444.0, 253], [492.0, 253], [492.0, 350], [444.0, 350]]'),
  ('6', 147, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[395.0, 253], [444.0, 253], [444.0, 350], [395.0, 350]]'),
  ('6', 148, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[346.0, 253], [395.0, 253], [395.0, 350], [346.0, 350]]'),
  ('6', 149, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[298.0, 253], [346.0, 253], [346.0, 350], [298.0, 350]]'),
  ('6', 150, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[250.0, 253], [298.0, 253], [298.0, 350], [250.0, 350]]'),
  ('6', 151, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[201, 253], [250.0, 253], [250.0, 350], [201, 350]]'),
  ('6', 153, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[250.0, 155], [298.0, 155], [298.0, 253], [250.0, 253]]'),
  ('6', 154, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[298.0, 155], [346.0, 155], [346.0, 253], [298.0, 253]]'),
  ('6', 155, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[346.0, 155], [394.0, 155], [394.0, 253], [346.0, 253]]'),
  ('6', 156, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[394.0, 155], [443.0, 155], [443.0, 253], [394.0, 253]]'),
  ('6', 157, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[443.0, 155], [492.0, 155], [492.0, 253], [443.0, 253]]'),
  ('6', 158, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[492.0, 155], [541.0, 155], [541.0, 253], [492.0, 253]]'),
  ('6', 159, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[541.0, 155], [589.0, 155], [589.0, 253], [541.0, 253]]'),
  ('6', 160, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[589.0, 155], [636.0, 155], [636.0, 253], [589.0, 253]]'),
  ('6', 161, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[636.0, 155], [684.0, 155], [684.0, 253], [636.0, 253]]'),
  ('6', 162, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[684.0, 155], [733.0, 155], [733.0, 253], [684.0, 253]]'),
  ('6', 163, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[733.0, 155], [782.0, 155], [782.0, 253], [733.0, 253]]'),
  ('6', 164, 15125.40, 1260.45, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 10.083,60 · financiamento de R$ 211.755,60', '[[782.0, 155], [831, 155], [831, 253], [782.0, 253]]'),
  ('7', 165, 17248.80, 1437.40, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.499,20 · financiamento de R$ 241.483,20', '[[732.0, 15], [781, 15], [781, 120], [732.0, 120]]'),
  ('7', 166, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[684.0, 15], [732.0, 15], [732.0, 120], [684.0, 120]]'),
  ('7', 167, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[636.0, 15], [684.0, 15], [684.0, 120], [636.0, 120]]'),
  ('7', 168, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[587.0, 15], [636.0, 15], [636.0, 120], [587.0, 120]]'),
  ('7', 169, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[538.0, 15], [587.0, 15], [587.0, 120], [538.0, 120]]'),
  ('7', 170, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[490.0, 15], [538.0, 15], [538.0, 120], [490.0, 120]]'),
  ('7', 171, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[442.0, 15], [490.0, 15], [490.0, 120], [442.0, 120]]'),
  ('7', 172, 14950.00, 1245.83, '2 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 9.966,67 · financiamento de R$ 209.300,00', '[[394.0, 15], [442.0, 15], [442.0, 120], [394.0, 120]]'),
  ('7', 173, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[346.0, 15], [394.0, 15], [394.0, 120], [346.0, 120]]'),
  ('7', 174, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[297.0, 15], [346.0, 15], [346.0, 120], [297.0, 120]]'),
  ('7', 175, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[248.0, 15], [297.0, 15], [297.0, 120], [248.0, 120]]'),
  ('7', 176, 17150.00, 1429.17, '3 quartos (1 suíte) · 3ª etapa · 36x + 3 balões anuais de R$ 11.433,33 · financiamento de R$ 240.100,00', '[[199, 15], [248.0, 15], [248.0, 120], [199, 120]]')
) as v(quadra, numero, entrada, parcela, detalhes, pol)
where l.condominio_id = (select id from condominios where slug = 'veneza')
  and l.quadra = v.quadra and l.lote_numero = v.numero;

-- Casa 18 aparece RESERVADA na tabela de 27/10 (antes estava disponível).
update lotes set status = 'reservado'
where condominio_id = (select id from condominios where slug = 'veneza') and lote_numero = 18 and status = 'disponivel';

update condominios set
  cidade = 'Tibau/RN',
  descricao = 'Condomínio de lotes à beira-mar em Tibau, com clube, piscina, academia e área de lazer.',
  logo_url = '/brand/riviera-logo.png', hero_image_url = '/brand/riviera-capa.jpg',
  plan_image_url = '/brand/riviera-planta.jpg', plan_w = 1816, plan_h = 768, plan_minx = 0, plan_miny = 0,
  plan_quadras = '[{"quadra": "A", "x": 4.8, "y": 55.2, "w": 1404.0, "h": 107.2}, {"quadra": "B", "x": 39.2, "y": 228.8, "w": 1128.0, "h": 223.2}, {"quadra": "C", "x": -34.4, "y": 437.6, "w": 1803.2, "h": 290.4}]'::jsonb
where slug = 'riviera';

update lotes l set poligono = v.pol::jsonb, poligono_definido = true
from (values
  ('A', 18, '[[308.8, 55.2], [363.2, 55.2], [363.2, 160.0], [308.8, 160.0]]'),
  ('A', 20, '[[190.4, 55.2], [245.6, 55.2], [245.6, 160.0], [190.4, 160.0]]'),
  ('A', 21, '[[131.2, 55.2], [186.4, 55.2], [186.4, 160.0], [131.2, 160.0]]'),
  ('A', 22, '[[72.0, 55.2], [127.2, 55.2], [127.2, 160.0], [72.0, 160.0]]'),
  ('A', 23, '[[13.6, 160.0], [4.8, 151.2], [11.2, 55.2], [68.0, 55.2], [68.0, 160.0]]'),
  ('B', 5, '[[817.6, 344.8], [872.0, 344.8], [872.0, 452.0], [817.6, 452.0]]'),
  ('B', 21, '[[994.4, 228.8], [1049.6, 228.8], [1049.6, 334.4], [994.4, 334.4]]'),
  ('B', 24, '[[817.6, 228.8], [872.0, 228.8], [872.0, 334.4], [817.6, 334.4]]'),
  ('B', 25, '[[758.4, 228.8], [812.8, 228.8], [812.8, 334.4], [758.4, 334.4]]'),
  ('B', 26, '[[699.2, 228.8], [753.6, 228.8], [753.6, 334.4], [699.2, 334.4]]'),
  ('B', 27, '[[640.0, 228.8], [694.4, 228.8], [694.4, 334.4], [640.0, 334.4]]'),
  ('B', 28, '[[580.8, 228.8], [636.0, 228.8], [636.0, 334.4], [580.8, 334.4]]'),
  ('B', 29, '[[521.6, 228.8], [576.8, 228.8], [576.8, 334.4], [521.6, 334.4]]'),
  ('B', 30, '[[462.4, 228.8], [517.6, 228.8], [517.6, 334.4], [462.4, 334.4]]'),
  ('B', 32, '[[344.8, 228.8], [399.2, 228.8], [399.2, 334.4], [344.8, 334.4]]'),
  ('B', 33, '[[285.6, 228.8], [340.0, 228.8], [340.0, 334.4], [285.6, 334.4]]'),
  ('B', 35, '[[167.2, 228.8], [221.6, 228.8], [221.6, 334.4], [167.2, 334.4]]'),
  ('C', 6, '[[1386.4, 471.2], [1440.8, 465.6], [1450.4, 564.8], [1396.0, 569.6]]'),
  ('C', 12, '[[1028.0, 523.2], [1080.8, 514.4], [1097.6, 608.0], [1044.0, 617.6]]')
) as v(quadra, numero, pol)
where l.condominio_id = (select id from condominios where slug = 'riviera')
  and l.quadra = v.quadra and l.lote_numero = v.numero;

commit;

-- Conferência (deve dar: veneza 68 / 68 na planta / 4 reservadas; riviera 19 / 19 na planta)
select c.slug, c.cidade, c.ativo,
       count(*) as unidades,
       count(*) filter (where l.poligono_definido) as na_planta,
       count(*) filter (where l.status = 'reservado') as reservadas,
       count(*) filter (where l.status = 'disponivel') as disponiveis
from condominios c join lotes l on l.condominio_id = c.id
where c.slug in ('veneza', 'riviera')
group by c.slug, c.cidade, c.ativo order by c.slug;
