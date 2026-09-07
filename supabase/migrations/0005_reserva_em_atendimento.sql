-- Adiciona a etapa "em_atendimento" ao funil de pedidos de reserva, usada na
-- tela de acompanhamento do painel (admin): Novo (pendente) -> Em atendimento
-- -> Confirmada, com Cancelada como saída fora do fluxo feliz.
alter type reserva_status add value if not exists 'em_atendimento' before 'confirmada';
