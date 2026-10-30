-- =============================================================================
-- LIMPA todas as propostas atuais (confirmado: é tudo teste, nada real) e
-- insere várias novas propostas de teste, cobrindo os cenários que
-- importam pra geração de PDF: com/sem corretor vinculado, com/sem
-- dados_qualificacao completo, e os 3 status que liberam o PDF (aprovada,
-- enviada, aceita) + 2 que não liberam (pra conferir que o botão continua
-- desabilitado nesses).
--
-- Roda tudo de uma vez só no SQL Editor do Supabase (New query > cola tudo
-- > Run). Usa lotes REAIS "disponível" que já existem — não muda status de
-- lote nem cria reserva (aprovar de verdade pelo painel é que faz isso).
-- =============================================================================

-- 1) Apaga as propostas atuais
-- (antes, desvincula qualquer reserva que aponte pra elas — reservas.proposta_id
-- é só um rastro de "veio de qual proposta"; sem isso o delete abaixo falha com
-- erro de chave estrangeira. A reserva em si NÃO é tocada nem apagada.)
update reservas set proposta_id = null where proposta_id is not null;
delete from propostas;

-- 2) Escolhe até 6 lotes "disponível" reais pra pendurar as propostas novas
create temporary table _teste_lotes as
select id, identificador, condominio_id,
       row_number() over (order by valor_total nulls last, id) as rn
from lotes
where status = 'disponivel'
order by valor_total nulls last, id
limit 6;

-- 3) Clientes fictícios de teste (origem = 'teste', fácil de achar/apagar depois)
insert into clientes (nome, telefone, email, cpf, observacoes, origem)
values
  ('Carlos Eduardo Ramalho',   '(84) 99222-0001', 'teste1@example.com', '222.222.222-01', 'Cliente de teste - geração de PDF.', 'teste'),
  ('Fernanda de Assis Bezerra','(84) 99222-0002', 'teste2@example.com', '222.222.222-02', 'Cliente de teste - geração de PDF.', 'teste'),
  ('João Victor Nascimento',   '(84) 99222-0003', 'teste3@example.com', '222.222.222-03', 'Cliente de teste - geração de PDF.', 'teste'),
  ('Maria das Graças Pontes',  '(84) 99222-0004', 'teste4@example.com', '222.222.222-04', 'Cliente de teste - geração de PDF.', 'teste'),
  ('Paulo Sérgio Wanderley',   '(84) 99222-0005', 'teste5@example.com', '222.222.222-05', 'Cliente de teste - geração de PDF.', 'teste'),
  ('Rita de Cássia Monteiro',  '(84) 99222-0006', 'teste6@example.com', '222.222.222-06', 'Cliente de teste - geração de PDF.', 'teste');

-- 4) Propostas de teste
-- 4.1) aprovada, COM corretor vinculado e dados_qualificacao completo
with lote as (select id from _teste_lotes where rn = 1),
     cli as (select id from clientes where email = 'teste1@example.com'),
     cor as (select id from corretores where ativo and papel = 'corretor' order by nome limit 1)
insert into propostas (lote_id, cliente_id, corretor_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
select lote.id, cli.id, cor.id, 95000, '48x de R$ 1.979,00 após entrada de R$ 15.000,00', 'aprovada',
  'Teste PDF — completo, com corretor vinculado.',
  jsonb_build_object(
    'proponente', jsonb_build_object('nome', 'Carlos Eduardo Ramalho', 'rg', '1122334', 'orgao_expedidor', 'SSP/RN', 'cpf_cnpj', '222.222.222-01', 'profissao', 'Engenheiro Civil'),
    'estado_civil', 'casado',
    'conjuge', jsonb_build_object('nome', 'Ana Paula Ramalho', 'cpf_cnpj', '222.222.222-07'),
    'endereco_residencial', jsonb_build_object('rua', 'Rua Coronel João Pessoa', 'numero', '400', 'bairro', 'Centro', 'cidade', 'Mossoró', 'estado', 'RN', 'cep', '59600-100'),
    'forma_pagamento', jsonb_build_object('a_vista', false, 'renda', 'R$ 8.500,00', 'valor_proposto', 95000, 'sinal', 'R$ 15.000,00', 'dividido_em_parcelas', 48, 'valor_parcela', 'R$ 1.979,00')
  )
from lote, cli, cor;

-- 4.2) enviada, SEM corretor vinculado (cai no admin como responsável) e sem dados_qualificacao
with lote as (select id from _teste_lotes where rn = 2),
     cli as (select id from clientes where email = 'teste2@example.com')
insert into propostas (lote_id, cliente_id, valor_proposto, condicoes_pagamento, status, observacoes)
select lote.id, cli.id, 78000, 'À vista', 'enviada', 'Teste PDF — simples, sem corretor e sem qualificação completa.'
from lote, cli;

-- 4.3) aceita, COM corretor e dados_qualificacao completo (inclui cônjuge e forma de pagamento detalhada)
with lote as (select id from _teste_lotes where rn = 3),
     cli as (select id from clientes where email = 'teste3@example.com'),
     cor as (select id from corretores where ativo and papel = 'corretor' order by nome desc limit 1)
insert into propostas (lote_id, cliente_id, corretor_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
select lote.id, cli.id, cor.id, 112000, 'À vista', 'aceita',
  'Teste PDF — venda concluída, completo.',
  jsonb_build_object(
    'proponente', jsonb_build_object('nome', 'João Victor Nascimento', 'rg', '3344556', 'orgao_expedidor', 'SSP/RN', 'cpf_cnpj', '222.222.222-03', 'profissao', 'Comerciante'),
    'estado_civil', 'solteiro',
    'endereco_residencial', jsonb_build_object('rua', 'Av. Rio Branco', 'numero', '900', 'bairro', 'Abolição', 'cidade', 'Mossoró', 'estado', 'RN', 'cep', '59611-030'),
    'forma_pagamento', jsonb_build_object('a_vista', true, 'renda', 'R$ 11.000,00', 'valor_proposto', 112000)
  )
from lote, cli, cor;

-- 4.4) aprovada, ligada a um formulário de qualificação JÁ existente (testa o
-- caminho que busca dados_qualificacao pelo formulario_id em vez de já vir
-- pronto na proposta) — só roda se existir algum formulário no banco.
with lote as (select id from _teste_lotes where rn = 4),
     cli as (select id from clientes where email = 'teste4@example.com'),
     form as (select id from formularios_qualificacao order by created_at desc limit 1)
insert into propostas (lote_id, cliente_id, formulario_id, valor_proposto, condicoes_pagamento, status, observacoes)
select lote.id, cli.id, form.id, 88000, '36x de R$ 2.166,67', 'aprovada',
  'Teste PDF — dados_qualificacao vêm do formulário vinculado, não da proposta.'
from lote, cli, form
where form.id is not null;

-- 4.5) aguardando_aprovacao — NÃO libera PDF, é só pra conferir que o botão continua desabilitado
with lote as (select id from _teste_lotes where rn = 5),
     cli as (select id from clientes where email = 'teste5@example.com')
insert into propostas (lote_id, cliente_id, valor_proposto, status, observacoes)
select lote.id, cli.id, 65000, 'aguardando_aprovacao', 'Teste — não deve liberar "gerar PDF".'
from lote, cli;

-- 4.6) rascunho — idem, não libera PDF
with lote as (select id from _teste_lotes where rn = 6),
     cli as (select id from clientes where email = 'teste6@example.com')
insert into propostas (lote_id, cliente_id, valor_proposto, status, observacoes)
select lote.id, cli.id, 60000, 'rascunho', 'Teste — não deve liberar "gerar PDF".'
from lote, cli;

-- 5) Resumo: o que foi criado (aparece no painel de "Results" do SQL Editor)
select p.status, c.nome as cliente, l.identificador as lote, p.valor_proposto,
       (p.corretor_id is not null) as tem_corretor, (p.formulario_id is not null) as tem_formulario
from propostas p
join clientes c on c.id = p.cliente_id
join lotes l on l.id = p.lote_id
where c.origem = 'teste'
order by p.status;

-- =============================================================================
-- LIMPEZA — quando terminar os testes, roda isso (tudo de uma vez):
--
-- delete from propostas where cliente_id in (select id from clientes where origem = 'teste');
-- delete from clientes where origem = 'teste';
-- =============================================================================
