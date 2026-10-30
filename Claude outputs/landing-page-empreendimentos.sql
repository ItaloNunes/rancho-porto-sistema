-- Rodar isso tudo de uma vez no SQL Editor do Supabase.

-- 1) Migration: adiciona a coluna nova (idempotente, seguro rodar de novo)
alter table condominios add column if not exists landing_page_url text;

comment on column condominios.landing_page_url is
  'URL da landing page de marketing do empreendimento (site externo), separada do catálogo interno de lotes.';

-- 2) Preenche os dois empreendimentos existentes
update condominios
set landing_page_url = 'https://ranchotexasmossoro.com/'
where nome ilike '%rancho texas%';

update condominios
set landing_page_url = 'https://portofraco.jozeildo.workers.dev/'
where nome ilike '%porto franco%';

-- 3) Confere o resultado
select nome, slug, landing_page_url from condominios order by nome;
