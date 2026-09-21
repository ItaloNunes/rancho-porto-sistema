-- A janela de 24h (migration 0009) estava expirando reservas antes do
-- corretor conseguir terminar a qualificação do cliente e gerar a proposta
-- (caso real: reserva do dia 19 expirou sozinha no dia 20, e no dia 21 o
-- corretor foi gerar a proposta a partir dela e levou "Esta reserva já foi
-- cancelada"). Amplia pra 72h — tempo real de sobra pra reunir documento e
-- fechar a proposta, sem travar o lote indefinidamente se ninguém mais
-- mexer no pedido.
alter table reservas alter column expira_em set default (now() + interval '72 hours');
