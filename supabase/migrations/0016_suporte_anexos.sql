-- Bucket privado para os anexos do chamado de suporte (print/vídeo enviados
-- pelo botão de suporte no painel — ver backend/app/routers/suporte.py e
-- app/suporte_anexos.py). Igual ao "documentos-clientes" (0007): nunca
-- público, todo acesso passa pelo backend com a service key (link assinado
-- com validade curta, mandado por e-mail pro chamado).
--
-- Esse insert já foi aplicado direto via API (Storage Management API) na
-- primeira vez que o botão de suporte foi criado — este arquivo só
-- documenta a mudança e garante que um ambiente novo (ex.: outro projeto
-- Supabase) fique com o bucket certo ao rodar as migrations em ordem.
insert into storage.buckets (id, name, public)
values ('suporte-anexos', 'suporte-anexos', false)
on conflict (id) do nothing;
