alter table condominios add column if not exists landing_page_url text;

comment on column condominios.landing_page_url is
  'URL da landing page de marketing do empreendimento (site externo), separada do catálogo interno de lotes.';
