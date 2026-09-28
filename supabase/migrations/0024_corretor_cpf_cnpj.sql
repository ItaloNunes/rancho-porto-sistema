-- CPF/CNPJ do corretor -- a cláusula de comissão do contrato do Porto Franco
-- qualifica o corretor com "nome/razão social, CPF/CNPJ, CRECI e dados
-- bancários" (ver 0023_corretor_creci_banco.sql, que trouxe o resto).
-- Pedido em 28/09.
alter table corretores add column if not exists cpf_cnpj text;
