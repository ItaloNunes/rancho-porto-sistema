-- Suporte a planta real em imagem (usado pelo Porto Franco, cuja planta técnica
-- não tem dados vetoriais por lote — só a imagem do desenho oficial). Nesse modo,
-- em vez de um polígono clicável por lote, guardamos zonas clicáveis aproximadas
-- por quadra (plan_quadras), que ao serem clicadas filtram a lista de lotes.
-- Rancho Texas continua no modo antigo (plan_image_url nulo → polígono por lote).

alter table condominios
  add column if not exists plan_image_url text,
  add column if not exists plan_quadras jsonb;

comment on column condominios.plan_image_url is
  'Se preenchido, a planta é exibida como esta imagem de fundo (com zonas clicáveis por quadra em plan_quadras) em vez do modo polígono-por-lote.';
comment on column condominios.plan_quadras is
  'Array de {quadra, x, y, w, h} (mesmo espaço de coordenadas de plan_w/plan_h) — zonas aproximadas, uma por quadra, usadas apenas quando plan_image_url está preenchido.';
