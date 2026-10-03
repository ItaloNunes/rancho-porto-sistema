-- 0026 — Fecha o acesso direto ao banco (revisão de segurança de 03/10/2026)
--
-- Problema: o cadastro do Supabase Auth estava aberto e as políticas
-- antigas (da época do login por e-mail) liberavam leitura e escrita de
-- corretores, clientes, propostas, reservas e formulários para QUALQUER
-- conta "authenticated". Alguém de fora podia criar uma conta e ler CPFs,
-- dados bancários e propostas direto pela API do Supabase.
--
-- O sistema não usa mais o Supabase Auth: o backend acessa o banco com a
-- service key, que ignora RLS. Então é seguro tirar essas políticas.
--
-- Pode rodar mais de uma vez sem problema.

-- 1) Remove toda política do schema public que libere acesso para "authenticated"
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ilike '%authenticated%' or coalesce(with_check, '') ilike '%authenticated%')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    raise notice 'Política removida: %.%', r.tablename, r.policyname;
  end loop;
end $$;

-- 2) RLS ligado em TODAS as tabelas do schema public (inclusive logs_auditoria
--    e lotes_precos_historico, que estavam sem). Sem política = ninguém de
--    fora acessa; o backend continua funcionando normalmente.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- 3) Arquivos (documentos dos clientes e anexos do suporte): remove qualquer
--    política que dê acesso a esses buckets por fora do backend.
do $$
declare r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~* '(documentos-clientes|suporte-anexos|authenticated)'
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
    raise notice 'Política de arquivos removida: %', r.policyname;
  end loop;
end $$;

-- 4) Conferência (o resultado aparece embaixo, no SQL Editor):
--    todas as tabelas com rls = true, e as únicas políticas que sobram são
--    as de leitura pública do catálogo (condominios/lotes).
select t.tablename, t.rowsecurity as rls,
       coalesce(string_agg(p.policyname, ', '), '(nenhuma política)') as politicas
from pg_tables t
left join pg_policies p on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename, t.rowsecurity
order by t.tablename;
