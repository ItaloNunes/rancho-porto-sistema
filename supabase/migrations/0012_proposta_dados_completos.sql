-- Até aqui, o formulário completo (RG, endereços, cônjuge, forma de
-- pagamento detalhada etc. — os mesmos campos da Proposta de Compra/Venda em
-- papel) só existia via o link de qualificação que o cliente final preenche
-- (formularios_qualificacao.dados). Agora o corretor também pode preencher
-- esse formulário completo direto no painel, na hora de criar a proposta
-- (ver PropostaFormularioCompleto.tsx e POST /crm/propostas), sem precisar
-- mandar link nenhum — daí a proposta precisar carregar o próprio JSON,
-- sem depender de um formulario_id.
alter table propostas add column if not exists dados_qualificacao jsonb;
