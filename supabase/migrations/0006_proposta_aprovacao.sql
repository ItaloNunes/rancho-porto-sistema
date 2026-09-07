-- Fluxo de aprovação de propostas: o corretor monta a proposta, mas só um
-- admin pode "aprovar" — e só a partir daí o PDF (papel timbrado) pode ser
-- gerado (ver regra em app/routers/crm.py: gerar_pdf_proposta).
--
-- Ordem final do enum: rascunho -> aguardando_aprovacao -> aprovada ->
-- enviada -> aceita | recusada | cancelada.
alter type proposta_status add value if not exists 'aguardando_aprovacao' before 'enviada';
alter type proposta_status add value if not exists 'aprovada' before 'enviada';
