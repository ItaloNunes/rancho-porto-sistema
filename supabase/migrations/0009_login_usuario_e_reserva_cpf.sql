-- Mudança de arquitetura de login: os corretores deixam de ser convidados
-- por e-mail (fluxo antigo em criar_corretor) e passam a ter um login por
-- "usuário" (ex.: italo.nunes), com senha inicial = o próprio telefone (só
-- dígitos). O Supabase Auth continua exigindo um e-mail por baixo de todo
-- usuário — a gente fabrica um (usuario@corretor.login) que a pessoa nunca
-- vê nem usa; ver backend/app/usuarios.py, que é a única fonte de verdade
-- pra esse domínio (front e back têm que combinar).
alter table corretores add column if not exists usuario text unique;

-- Fluxo novo não passa mais pelo Cadastro de Cliente/Qualificação pra saber
-- quem é o interessado: o corretor informa nome + CPF (opcional) direto no
-- pedido de reserva (reservas.nome/contato já existiam; só faltava o CPF).
alter table reservas add column if not exists cpf text;

-- Regra nova: toda reserva expira sozinha em 24h se ninguém confirmar a
-- compra até lá (só admin confirma — ver atualizar_status_reserva). O
-- default calcula "daqui a 24h" no momento de cada INSERT; quem já tinha
-- reserva antes desta migração recebe expira_em = now()+24h só pra não
-- ficar null (na prática o painel só passa a expirar reserva criada daqui
-- pra frente, porque reserva antiga que já está confirmada/cancelada nunca
-- entra na checagem — ver _expirar_vencidas em routers/reservas.py).
alter table reservas add column if not exists expira_em timestamptz default (now() + interval '24 hours');
update reservas set expira_em = created_at + interval '24 hours' where expira_em is null;
