-- Dois papeis de login no painel: "admin" (cria/gerencia os logins dos
-- corretores e ve tudo) e "corretor" (ve e edita so os proprios
-- clientes/propostas, mais os "leads" ainda sem dono).

alter table corretores add column papel text not null default 'corretor'
  check (papel in ('admin', 'corretor'));

-- Dono do cliente/lead (nulo = lead ainda sem corretor responsavel,
-- visivel e "reivindicavel" por qualquer corretor).
alter table clientes add column corretor_id uuid references corretores(id);
create index idx_clientes_corretor on clientes(corretor_id);

-- -----------------------------------------------------------------------
-- Depois de rodar esta migration, crie o primeiro admin manualmente:
--
-- 1. No painel do Supabase: Authentication > Users > Add user (com e-mail
--    e senha que voce mesmo escolhe, ja confirmado).
-- 2. Copie o UUID desse usuario criado e rode (trocando os valores):
--
--    insert into corretores (auth_user_id, nome, email, papel, ativo)
--    values ('<uuid-do-usuario>', 'Seu Nome', 'seu@email.com', 'admin', true);
--
-- A partir dai, esse login acessa o painel como admin e pode cadastrar
-- os demais corretores por la (que recebem convite por e-mail).
-- -----------------------------------------------------------------------
