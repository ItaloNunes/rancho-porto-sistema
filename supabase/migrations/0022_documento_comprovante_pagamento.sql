-- Novo tipo de documento: comprovante de PIX/TED de um pagamento (entrada ou
-- parcela) da proposta. Só pode ser anexado depois que a proposta já foi
-- aprovada (ver checagem em backend/app/routers/crm.py::anexar_documento_proposta)
-- e nunca entra na lista de documentos obrigatórios da qualificação. Pedido em 28/09.
alter type documento_tipo add value if not exists 'comprovante_pagamento';
