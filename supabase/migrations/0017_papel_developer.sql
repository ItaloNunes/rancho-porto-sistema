-- 'developer' e uma conta admin "e mais um pouco" -- tem todo o acesso de
-- admin (ver backend/app/security.py::eh_admin), mais uma tela extra de
-- Atividade que nem os outros admins veem (ver require_developer no mesmo
-- arquivo, e a aba condicional em frontend/src/pages/painel/PainelLayout.tsx).
--
-- De proposito, NAO da pra escolher esse papel em nenhum formulario do
-- painel -- criar_corretor e atualizar_corretor (routers/crm.py) recusam
-- payload.papel == 'developer' com 400. So fica disponivel rodando um
-- UPDATE direto aqui no banco, o que mantem esse papel "so pra uma conta"
-- mesmo com o codigo do projeto aberto pra qualquer admin ler.
alter table corretores drop constraint corretores_papel_check;
alter table corretores add constraint corretores_papel_check
  check (papel in ('admin', 'corretor', 'developer'));

-- Depois de rodar o ALTER acima, marque sua propria conta como developer
-- (troque 'italo.nunes' se o seu usuario de login for outro):
--
-- update corretores set papel = 'developer' where usuario = 'italo.nunes';
