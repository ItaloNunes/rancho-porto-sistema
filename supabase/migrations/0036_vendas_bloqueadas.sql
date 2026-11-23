-- 0036 — Empreendimento no catálogo com reservas travadas (23/11).
-- Veneza, Riviera e Rota dos Ventos ficam públicos (mapa, lotes, landing
-- page), mas corretor ainda não reserva nem faz proposta até chegar a
-- tabela atualizada. Para liberar: update condominios set
-- vendas_bloqueadas = false where slug = '...';
alter table condominios add column if not exists vendas_bloqueadas boolean not null default false;
update condominios set vendas_bloqueadas = true where slug in ('veneza','riviera','rota-dos-ventos');
