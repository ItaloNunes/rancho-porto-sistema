-- Atualiza Porto Franco pra usar a planta nova (alta resolução, extraída
-- direto do PDF original) no lugar da imagem antiga de baixa resolução.
-- Necessário pro modo "Automático" de marcação funcionar em Porto Franco.

update condominios
set
  plan_w = 4538,
  plan_h = 1703,
  plan_quadras = '[{"quadra": "1", "x": 3517.0, "y": 294.8, "w": 131.6, "h": 510.2}, {"quadra": "2", "x": 3517.0, "y": 918.4, "w": 131.6, "h": 555.6}, {"quadra": "3", "x": 3358.1, "y": 294.8, "w": 147.5, "h": 612.3}, {"quadra": "4", "x": 3358.1, "y": 918.4, "w": 136.1, "h": 555.6}, {"quadra": "5", "x": 3187.9, "y": 306.1, "w": 140.7, "h": 612.3}, {"quadra": "6", "x": 3187.9, "y": 918.4, "w": 140.7, "h": 555.6}, {"quadra": "7", "x": 3017.8, "y": 328.8, "w": 140.7, "h": 589.6}, {"quadra": "8", "x": 3017.8, "y": 918.4, "w": 147.5, "h": 555.6}, {"quadra": "9", "x": 2863.5, "y": 328.8, "w": 154.3, "h": 600.9}, {"quadra": "10", "x": 2863.5, "y": 918.4, "w": 154.3, "h": 555.6}, {"quadra": "11", "x": 2722.8, "y": 317.5, "w": 136.1, "h": 657.6}, {"quadra": "12", "x": 2711.5, "y": 1043.1, "w": 147.5, "h": 430.9}, {"quadra": "13", "x": 2552.6, "y": 306.1, "w": 158.8, "h": 623.6}, {"quadra": "14", "x": 2564.0, "y": 680.3, "w": 124.8, "h": 793.7}, {"quadra": "15", "x": 2416.5, "y": 385.5, "w": 124.8, "h": 340.1}, {"quadra": "16", "x": 2382.5, "y": 680.3, "w": 136.1, "h": 805.0}]'::jsonb
where slug = 'porto-franco';

-- O lote que você já marcou manualmente (LOTE 01 - QUADRA 11) foi desenhado
-- nas coordenadas da imagem antiga (2000x751) — com a imagem nova (4538x1703)
-- ele ficaria fora de lugar. Mais simples desmarcar e remarcar esse único
-- lote (agora pode usar o modo Automático, é rapidinho) do que tentar
-- reescalar o polígono salvo:
update lotes l
set poligono = '[]'::jsonb, poligono_definido = false
from condominios c
where l.condominio_id = c.id
  and c.slug = 'porto-franco'
  and l.poligono_definido = true;
