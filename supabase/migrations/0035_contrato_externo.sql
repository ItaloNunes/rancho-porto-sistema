-- 0035 — Contratos feitos fora do sistema / numeração antiga (23/11).
-- Propostas antigas (ex.: 1, 2 e 22) já têm contrato em papel, mas sem
-- numero_contrato da sequência (91+), então ficavam para sempre "em
-- andamento" no Financeiro. Este campo marca o contrato externo sem gastar
-- número da sequência oficial.
alter table propostas add column if not exists contrato_externo text;
