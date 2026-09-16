-- Quando um admin aprova uma proposta (PATCH /crm/propostas/{id}/status,
-- status='aprovada'), o backend agora gera a reserva sozinho, reaproveitando
-- os dados que o corretor já digitou no formulário da proposta (nome/
-- telefone/CPF do cliente) — sem precisar abrir o formulário de reserva de
-- novo e preencher tudo outra vez (ver atualizar_status_proposta em
-- routers/crm.py). Essa coluna guarda de qual proposta a reserva veio: além
-- de servir de rastro, evita duplicar a reserva se a aprovação acabar sendo
-- reprocessada (o backend confere se já existe uma reserva com esse
-- proposta_id antes de criar outra).
alter table reservas add column if not exists proposta_id uuid references propostas(id);
