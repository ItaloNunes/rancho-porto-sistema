-- =============================================================================
-- DADOS FICTÍCIOS PARA DEMONSTRAÇÃO COMPLETA DO SISTEMA
-- (usa lotes REAIS já cadastrados — não cria nenhum empreendimento novo)
-- =============================================================================
-- Roda inteiro, de uma vez só, no SQL Editor do Supabase (New query > cola
-- tudo > Run).
--
-- O QUE ISSO FAZ:
--   Pega até 13 lotes REAIS que estão "disponível" agora (de qualquer
--   empreendimento já cadastrado) e pendura em cima deles clientes e
--   propostas/reservas 100% fictícios, cobrindo TODOS os status possíveis:
--     - 7 propostas (rascunho, aguardando_aprovacao, aprovada, enviada,
--       aceita, recusada, cancelada)
--     - 6 reservas (pendente, em_atendimento, aguardando_qualificacao,
--       em_analise_financeira, confirmada, cancelada)
--     - 2 formulários de qualificação (aguardando preenchimento / em análise)
--   Os clientes ficam marcados com origem = 'demo' pra dar pra achar e
--   apagar tudo depois num clique só (comando lá embaixo).
--
-- ATENÇÃO — ISSO MUDA O STATUS DE LOTES REAIS (foi combinado assim):
--   Igual o sistema faz de verdade, aprovar proposta / criar reserva deixa
--   o lote "reservado", e aceitar proposta deixa "vendido". Como estou
--   usando lotes reais (não um empreendimento fake), enquanto a demonstração
--   durar, uns 6 lotes reais vão aparecer "reservado" e 1 vai aparecer
--   "vendido" pros visitantes do catálogo público — mesmo eles continuando
--   disponíveis de verdade. Rode a query de limpeza (no fim deste arquivo)
--   assim que terminar a demonstração pra devolver todos ao normal.
--
-- Se o sistema tiver menos de 13 lotes "disponível" no momento, a demo sai
-- só com o que der (nenhum erro — os papéis que sobrarem sem lote real
-- disponível simplesmente não são criados).
-- =============================================================================

-- 0) Escolhe 13 lotes reais "disponível" e fixa a escolha numa tabela
--    temporária (dura só durante essa execução) — assim cada bloco abaixo
--    pega sempre o MESMO lote pelo número de ordem (rn), sem repetir.
create temporary table _demo_lotes as
select id, identificador, condominio_id,
       row_number() over (order by valor_total nulls last, id) as rn
from lotes
where status = 'disponivel'
order by valor_total nulls last, id
limit 13;

-- 1) Clientes fictícios (origem = 'demo' pra filtrar/apagar fácil depois)
insert into clientes (nome, telefone, email, cpf, observacoes, origem)
values
  ('Fernando Oliveira Souza',   '(84) 99111-0001', 'fernando.demo@example.com',  '111.111.111-01', 'Cliente fictício de demonstração.', 'demo'),
  ('Patrícia Regina Lima',      '(84) 99111-0002', 'patricia.demo@example.com',  '111.111.111-02', 'Cliente fictício de demonstração.', 'demo'),
  ('Roberto Carlos Nunes',      '(84) 99111-0003', 'roberto.demo@example.com',   '111.111.111-03', 'Cliente fictício de demonstração.', 'demo'),
  ('Juliana Mendes Castro',     '(84) 99111-0004', 'juliana.demo@example.com',   '111.111.111-04', 'Cliente fictício de demonstração.', 'demo'),
  ('Marcelo Henrique Diniz',    '(84) 99111-0005', 'marcelo.demo@example.com',   '111.111.111-05', 'Cliente fictício de demonstração.', 'demo'),
  ('Camila Torres Vasconcelos', '(84) 99111-0006', 'camila.demo@example.com',    '111.111.111-06', 'Cliente fictício de demonstração.', 'demo'),
  ('Thiago Almeida Rocha',      '(84) 99111-0007', 'thiago.demo@example.com',    '111.111.111-07', 'Cliente fictício de demonstração.', 'demo'),
  ('Larissa Fontes Barreto',    '(84) 99111-0008', 'larissa.demo@example.com',   '111.111.111-08', 'Cliente fictício de demonstração.', 'demo'),
  ('Rodrigo Peixoto Farias',    '(84) 99111-0009', 'rodrigo.demo@example.com',   '111.111.111-09', 'Cliente fictício de demonstração.', 'demo'),
  ('Beatriz Cavalcanti Moura',  '(84) 99111-0010', 'beatriz.demo@example.com',   '111.111.111-10', 'Cliente fictício de demonstração.', 'demo'),
  ('Vanessa Prado Lins',        '(84) 99111-0011', 'vanessa.demo@example.com',   '111.111.111-11', 'Cliente fictício de demonstração.', 'demo'),
  ('Gustavo Aragão Bezerra',    '(84) 99111-0012', 'gustavo.demo@example.com',   '111.111.111-12', 'Cliente fictício de demonstração.', 'demo'),
  ('Simone Batista Cordeiro',   '(84) 99111-0013', 'simone.demo@example.com',    '111.111.111-13', 'Cliente fictício de demonstração.', 'demo');

-- 2) Propostas — uma em cada status do enum
-- 2.1) rascunho (rn=1, lote continua disponível)
with lote as (select id from _demo_lotes where rn = 1),
     cli as (select id from clientes where email = 'fernando.demo@example.com')
insert into propostas (lote_id, cliente_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
select lote.id, cli.id, 85000, null, 'rascunho', 'Proposta fictícia de demonstração — ainda em rascunho (cadastro rápido).',
  jsonb_build_object(
    'proponente', jsonb_build_object('nome', 'Fernando Oliveira Souza', 'profissao', 'Autônomo'),
    'forma_pagamento', jsonb_build_object('a_vista', false, 'renda', 'R$ 4.500,00', 'valor_proposto', 85000)
  )
from lote, cli;

-- 2.2) aguardando_aprovacao (rn=2, lote continua disponível)
with lote as (select id from _demo_lotes where rn = 2),
     cli as (select id from clientes where email = 'patricia.demo@example.com')
insert into propostas (lote_id, cliente_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
select lote.id, cli.id, 89000, '60x de R$ 1.233,33 após entrada de R$ 15.000,00', 'aguardando_aprovacao',
  'Proposta fictícia de demonstração — aguardando aprovação do admin.',
  jsonb_build_object(
    'proponente', jsonb_build_object(
      'nome', 'Patrícia Regina Lima', 'rg', '2233445', 'orgao_expedidor', 'SSP/RN', 'cpf_cnpj', '111.111.111-02',
      'data_nascimento', '1988-03-10', 'nacionalidade', 'Brasileira', 'email', 'patricia.demo@example.com', 'profissao', 'Enfermeira'
    ),
    'estado_civil', 'solteiro',
    'endereco_residencial', jsonb_build_object('rua', 'Rua Ceará', 'numero', '210', 'bairro', 'Alto de São Manoel', 'cidade', 'Mossoró', 'estado', 'RN', 'cep', '59628-000'),
    'endereco_comercial_nao_possui', true,
    'telefone_celular', '(84) 99111-0002',
    'forma_pagamento', jsonb_build_object('a_vista', false, 'renda', 'R$ 3.800,00', 'valor_proposto', 89000, 'dividido_em_parcelas', 60, 'valor_parcela', 'R$ 1.233,33')
  )
from lote, cli;

-- 2.3) aprovada (rn=3) -> igual o sistema faz de verdade: gera a reserva
-- automática e deixa o lote "reservado"
with lote as (select id from _demo_lotes where rn = 3),
     cli as (select id from clientes where email = 'roberto.demo@example.com'),
     prop as (
       insert into propostas (lote_id, cliente_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
       select lote.id, cli.id, 142000, '60x de R$ 2.000,00 após entrada de R$ 25.000,00', 'aprovada',
         'Proposta fictícia de demonstração — já aprovada pelo admin.',
         jsonb_build_object(
           'proponente', jsonb_build_object(
             'nome', 'Roberto Carlos Nunes', 'rg', '3344556', 'orgao_expedidor', 'SSP/RN', 'cpf_cnpj', '111.111.111-03',
             'data_nascimento', '1979-11-22', 'nacionalidade', 'Brasileira', 'email', 'roberto.demo@example.com', 'profissao', 'Comerciante'
           ),
           'estado_civil', 'casado',
           'conjuge', jsonb_build_object('nome', 'Rosana Nunes', 'rg', '3344557', 'cpf_cnpj', '111.111.111-14', 'profissao', 'Professora'),
           'endereco_residencial', jsonb_build_object('rua', 'Av. Presidente Dutra', 'numero', '1500', 'bairro', 'Centro', 'cidade', 'Mossoró', 'estado', 'RN', 'cep', '59600-000'),
           'telefone_celular', '(84) 99111-0003',
           'forma_pagamento', jsonb_build_object('a_vista', false, 'renda', 'R$ 9.000,00', 'valor_proposto', 142000, 'sinal', 'R$ 25.000,00', 'dividido_em_parcelas', 60, 'valor_parcela', 'R$ 2.000,00')
         )
       from lote, cli
       returning id, lote_id, cliente_id
     ),
     lote_upd as (
       update lotes set status = 'reservado' where id in (select lote_id from prop) and status = 'disponivel'
       returning id
     )
insert into reservas (lote_id, cliente_id, nome, contato, cpf, status, observacao, proposta_id)
select prop.lote_id, prop.cliente_id, 'Roberto Carlos Nunes', '(84) 99111-0003', '111.111.111-03', 'pendente',
  'Reserva gerada automaticamente pela aprovação da proposta (demonstração).', prop.id
from prop;

-- 2.4) enviada (rn=4, lote continua disponível)
with lote as (select id from _demo_lotes where rn = 4),
     cli as (select id from clientes where email = 'juliana.demo@example.com')
insert into propostas (lote_id, cliente_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
select lote.id, cli.id, 94000, '60x de R$ 1.333,33 após entrada de R$ 16.000,00', 'enviada',
  'Proposta fictícia de demonstração — PDF já enviado ao cliente.',
  jsonb_build_object(
    'proponente', jsonb_build_object(
      'nome', 'Juliana Mendes Castro', 'rg', '4455667', 'orgao_expedidor', 'SSP/RN', 'cpf_cnpj', '111.111.111-04',
      'data_nascimento', '1992-07-05', 'nacionalidade', 'Brasileira', 'email', 'juliana.demo@example.com', 'profissao', 'Designer'
    ),
    'estado_civil', 'divorciado',
    'endereco_residencial', jsonb_build_object('rua', 'Rua Felipe Camarão', 'numero', '88', 'bairro', 'Aeroporto', 'cidade', 'Mossoró', 'estado', 'RN', 'cep', '59607-100'),
    'telefone_celular', '(84) 99111-0004',
    'forma_pagamento', jsonb_build_object('a_vista', false, 'renda', 'R$ 5.200,00', 'valor_proposto', 94000, 'dividido_em_parcelas', 60, 'valor_parcela', 'R$ 1.333,33')
  )
from lote, cli;

-- 2.5) aceita (rn=5) -> igual o sistema faz de verdade: deixa o lote "vendido"
with lote as (select id from _demo_lotes where rn = 5),
     cli as (select id from clientes where email = 'marcelo.demo@example.com'),
     prop as (
       insert into propostas (lote_id, cliente_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
       select lote.id, cli.id, 130000, 'À vista', 'aceita',
         'Proposta fictícia de demonstração — cliente aceitou, venda concluída.',
         jsonb_build_object(
           'proponente', jsonb_build_object(
             'nome', 'Marcelo Henrique Diniz', 'rg', '5566778', 'orgao_expedidor', 'SSP/RN', 'cpf_cnpj', '111.111.111-05',
             'data_nascimento', '1985-01-18', 'nacionalidade', 'Brasileira', 'email', 'marcelo.demo@example.com', 'profissao', 'Engenheiro Agrônomo'
           ),
           'estado_civil', 'solteiro',
           'endereco_residencial', jsonb_build_object('rua', 'Rua Rio Branco', 'numero', '345', 'bairro', 'Doze Anos', 'cidade', 'Mossoró', 'estado', 'RN', 'cep', '59611-020'),
           'telefone_celular', '(84) 99111-0005',
           'forma_pagamento', jsonb_build_object('a_vista', true, 'renda', 'R$ 12.000,00', 'valor_proposto', 130000)
         )
       from lote, cli
       returning lote_id
     )
update lotes set status = 'vendido' where id in (select lote_id from prop);

-- 2.6) recusada (rn=6, lote continua disponível)
with lote as (select id from _demo_lotes where rn = 6),
     cli as (select id from clientes where email = 'camila.demo@example.com')
insert into propostas (lote_id, cliente_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
select lote.id, cli.id, 70000, null, 'recusada', 'Proposta fictícia de demonstração — valor abaixo da tabela, recusada pelo admin.',
  jsonb_build_object('proponente', jsonb_build_object('nome', 'Camila Torres Vasconcelos', 'profissao', 'Autônoma'))
from lote, cli;

-- 2.7) cancelada (rn=7, lote continua disponível)
with lote as (select id from _demo_lotes where rn = 7),
     cli as (select id from clientes where email = 'thiago.demo@example.com')
insert into propostas (lote_id, cliente_id, valor_proposto, condicoes_pagamento, status, observacoes, dados_qualificacao)
select lote.id, cli.id, 108000, null, 'cancelada', 'Proposta fictícia de demonstração — cliente desistiu.',
  jsonb_build_object('proponente', jsonb_build_object('nome', 'Thiago Almeida Rocha', 'profissao', 'Motorista'))
from lote, cli;

-- 3) Reservas — uma em cada status do enum (criar reserva já deixa o lote
-- "reservado", igual o sistema faz de verdade — só "cancelada" libera de volta)
-- 3.1) pendente (rn=8)
with lote as (select id from _demo_lotes where rn = 8),
     cli as (select id from clientes where email = 'larissa.demo@example.com'),
     res as (
       insert into reservas (lote_id, cliente_id, nome, contato, cpf, status, observacao)
       select lote.id, cli.id, 'Larissa Fontes Barreto', '(84) 99111-0008', '111.111.111-08', 'pendente',
         'Reserva fictícia de demonstração — acabou de chegar.'
       from lote, cli
       returning lote_id
     )
update lotes set status = 'reservado' where id in (select lote_id from res) and status = 'disponivel';

-- 3.2) em_atendimento (rn=9)
with lote as (select id from _demo_lotes where rn = 9),
     cli as (select id from clientes where email = 'rodrigo.demo@example.com'),
     res as (
       insert into reservas (lote_id, cliente_id, nome, contato, cpf, status, observacao)
       select lote.id, cli.id, 'Rodrigo Peixoto Farias', '(84) 99111-0009', '111.111.111-09', 'em_atendimento',
         'Reserva fictícia de demonstração — corretor já entrou em contato.'
       from lote, cli
       returning lote_id
     )
update lotes set status = 'reservado' where id in (select lote_id from res) and status = 'disponivel';

-- 3.3) cancelada (rn=10) -> igual o sistema faz de verdade: lote fica "disponivel"
with lote as (select id from _demo_lotes where rn = 10),
     cli as (select id from clientes where email = 'simone.demo@example.com')
insert into reservas (lote_id, cliente_id, nome, contato, cpf, status, observacao)
select lote.id, cli.id, 'Simone Batista Cordeiro', '(84) 99111-0013', '111.111.111-13', 'cancelada',
  'Reserva fictícia de demonstração — cliente desistiu, lote liberado.'
from lote, cli;

-- 3.4) confirmada (rn=11)
with lote as (select id from _demo_lotes where rn = 11),
     cli as (select id from clientes where email = 'vanessa.demo@example.com'),
     res as (
       insert into reservas (lote_id, cliente_id, nome, contato, cpf, status, observacao)
       select lote.id, cli.id, 'Vanessa Prado Lins', '(84) 99111-0011', '111.111.111-11', 'confirmada',
         'Reserva fictícia de demonstração — compra confirmada.'
       from lote, cli
       returning lote_id
     )
update lotes set status = 'reservado' where id in (select lote_id from res) and status = 'disponivel';

-- 3.5) aguardando_qualificacao (rn=12) — corretor já gerou o link do formulário
with lote as (select id from _demo_lotes where rn = 12),
     cli as (select id from clientes where email = 'beatriz.demo@example.com'),
     res as (
       insert into reservas (lote_id, cliente_id, nome, contato, cpf, status, observacao)
       select lote.id, cli.id, 'Beatriz Cavalcanti Moura', '(84) 99111-0010', '111.111.111-10', 'aguardando_qualificacao',
         'Reserva fictícia de demonstração — link de qualificação enviado ao cliente.'
       from lote, cli
       returning lote_id
     )
update lotes set status = 'reservado' where id in (select lote_id from res) and status = 'disponivel';

-- 3.6) em_analise_financeira (rn=13) — cliente já enviou o formulário
with lote as (select id from _demo_lotes where rn = 13),
     cli as (select id from clientes where email = 'gustavo.demo@example.com'),
     res as (
       insert into reservas (lote_id, cliente_id, nome, contato, cpf, status, observacao, analise_prazo_em)
       select lote.id, cli.id, 'Gustavo Aragão Bezerra', '(84) 99111-0012', '111.111.111-12', 'em_analise_financeira',
         'Reserva fictícia de demonstração — formulário enviado, em análise financeira.', now() + interval '48 hours'
       from lote, cli
       returning lote_id
     )
update lotes set status = 'reservado' where id in (select lote_id from res) and status = 'disponivel';

-- 4) Formulários de qualificação (link público) — nas reservas rn=12 e rn=13
-- 4.1) aguardando_preenchimento (Beatriz, rn=12)
with r as (
  select res.id as reserva_id, res.lote_id, res.cliente_id
  from reservas res
  join clientes c on c.id = res.cliente_id
  where c.email = 'beatriz.demo@example.com'
)
insert into formularios_qualificacao (reserva_id, lote_id, cliente_id, token, status, dados)
select r.reserva_id, r.lote_id, r.cliente_id, 'demo-token-' || substr(md5(random()::text), 1, 16), 'aguardando_preenchimento', '{}'::jsonb
from r;

-- 4.2) em_analise (Gustavo, rn=13) — já preencheu o formulário completo
with r as (
  select res.id as reserva_id, res.lote_id, res.cliente_id
  from reservas res
  join clientes c on c.id = res.cliente_id
  where c.email = 'gustavo.demo@example.com'
)
insert into formularios_qualificacao (reserva_id, lote_id, cliente_id, token, status, dados, enviado_em)
select r.reserva_id, r.lote_id, r.cliente_id, 'demo-token-' || substr(md5(random()::text), 1, 16), 'em_analise',
  jsonb_build_object(
    'proponente', jsonb_build_object(
      'nome', 'Gustavo Aragão Bezerra', 'rg', '6677889', 'orgao_expedidor', 'SSP/RN', 'cpf_cnpj', '111.111.111-12',
      'data_nascimento', '1990-09-30', 'nacionalidade', 'Brasileira', 'email', 'gustavo.demo@example.com', 'profissao', 'Contador'
    ),
    'estado_civil', 'solteiro',
    'endereco_residencial', jsonb_build_object('rua', 'Rua João Pessoa', 'numero', '77', 'bairro', 'Santo Antônio', 'cidade', 'Mossoró', 'estado', 'RN', 'cep', '59610-090'),
    'telefone_celular', '(84) 99111-0012',
    'forma_pagamento', jsonb_build_object('a_vista', false, 'renda', 'R$ 6.500,00', 'valor_proposto', 115000, 'dividido_em_parcelas', 60, 'valor_parcela', 'R$ 1.583,33')
  ),
  now() - interval '3 hours'
from r;

-- 5) Resumo final: quais lotes reais foram usados (guarda essa lista!) —
-- aparece no painel de "Results" do SQL Editor depois de rodar tudo.
select dl.rn, dl.identificador, c.nome as condominio, l.status as status_atual_do_lote
from _demo_lotes dl
join lotes l on l.id = dl.id
join condominios c on c.id = dl.condominio_id
order by dl.rn;

-- =============================================================================
-- LIMPEZA — roda isso quando terminar a demonstração (também tudo de uma vez):
--
-- update lotes set status = 'disponivel'
-- where id in (
--   select lote_id from reservas r join clientes c on c.id = r.cliente_id where c.origem = 'demo'
--   union
--   select lote_id from propostas p join clientes c on c.id = p.cliente_id where c.origem = 'demo'
-- );
-- delete from formularios_qualificacao where cliente_id in (select id from clientes where origem = 'demo');
-- delete from reservas where cliente_id in (select id from clientes where origem = 'demo');
-- delete from propostas where cliente_id in (select id from clientes where origem = 'demo');
-- delete from clientes where origem = 'demo';
-- =============================================================================
