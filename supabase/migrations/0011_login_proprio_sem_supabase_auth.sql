-- Substitui o login por Supabase Auth (que dependia de e-mail — e o envio
-- de recuperação de senha por e-mail estava falhando) por um esquema
-- próprio: usuário + senha com hash (bcrypt) guardado direto aqui na
-- tabela, e o backend emite e valida seu próprio JWT (ver app/security.py e
-- app/usuarios.py). Nenhuma etapa do login depende mais de e-mail.
alter table corretores add column if not exists senha_hash text;

-- `auth_user_id`/`email` ficam pra trás (deixados na tabela só por
-- histórico — não são mais lidos nem gravados pelo backend a partir desta
-- migração) e `usuario` passa a ser o identificador de login de fato.

-- ---------------------------------------------------------------------------
-- Contas existentes: como a senha antiga só existe como hash dentro do
-- Supabase Auth (não é possível migrar esse hash pro nosso esquema), cada
-- conta usada até hoje recebe usuário + senha nova abaixo. Ajuste antes de
-- rodar se os dados não baterem com o que você espera (confira pelo e-mail
-- antigo, coluna já existente).
--
--   italooonunes@gmail.com -> usuário "italo.nunes", senha "99106918"
--   italonunesdev@proton.me -> duplicata da conta acima: desativada aqui
--     (histórico de clientes/propostas dela continua intacto, só não loga
--     mais). Se precisar dela ativa, é só rodar
--     `update corretores set ativo = true where email = 'italonunesdev@proton.me';`
--   galdyno@hotmail.com (Sheila Galdino) -> usuário "sheila.galdino", senha
--     "84998142255" (o telefone dela já cadastrado, sem DDD/traço já
--     removidos porque já vinham só em dígitos) — repasse pra ela.

update corretores
set usuario = 'italo.nunes',
    senha_hash = '$2b$12$.BP.dOYznghuq66y6EpTEeX4hEiBG4e/EkfJBH9W.CaP9TbgA6bwi',
    papel = 'admin',
    ativo = true
where email = 'italooonunes@gmail.com';

update corretores
set ativo = false
where email = 'italonunesdev@proton.me';

update corretores
set usuario = 'sheila.galdino',
    senha_hash = '$2b$12$VoPYSlHITjNvz3Z60TeRk./RTP5STdsRE58gbTnZMD0xE3aNPbSsS',
    papel = 'admin'
where email = 'galdyno@hotmail.com';
