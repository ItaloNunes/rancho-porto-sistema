-- Corrige o identificador dos lotes do Porto Franco: hoje ele repete "LOTE 01",
-- "LOTE 02" etc. em cada uma das 16 quadras (colisão), o que deixa a lista de
-- lotes (painel, "Marcar plantas" etc.) sem informação suficiente pra
-- distinguir um lote do outro. Passa a incluir a quadra: "LOTE 01 - QUADRA 1".
update lotes l
set identificador = 'LOTE ' || lpad(l.lote_numero::text, 2, '0') || ' - QUADRA ' || l.quadra
from condominios c
where l.condominio_id = c.id
  and c.slug = 'porto-franco';
