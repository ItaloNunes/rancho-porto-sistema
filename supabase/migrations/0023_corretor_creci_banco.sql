-- Dados de CRECI e conta bancária do corretor, usados pra preencher a
-- cláusula de comissão do contrato do Porto Franco (ver
-- backend/app/documentos_gerados.py). Ficam no cadastro do corretor
-- (PainelCorretores.tsx) pra preencher sozinho em todo contrato gerado a
-- partir de agora, em vez de digitar na mão a cada proposta. Pedido em 28/09.
alter table corretores add column if not exists creci text;
alter table corretores add column if not exists banco text;
alter table corretores add column if not exists agencia text;
alter table corretores add column if not exists conta text;
