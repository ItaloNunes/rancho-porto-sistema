-- Novo fluxo interno (uso do corretor, não mais autoatendimento do cliente
-- final): o corretor reserva o lote, cadastra o cliente com o mínimo
-- (nome/telefone/CPF) e gera um link público para o cliente preencher um
-- formulário completo (os mesmos campos da Proposta de Compra/Venda em
-- papel) e anexar os documentos exigidos. Isso vai para análise financeira
-- (manual, por um admin no painel) — aprovado ou reprovado. Aprovado já gera
-- a proposta (pulando a etapa de aprovação separada de propostas, porque a
-- aprovação financeira agora é a aprovação).
--
-- Novos estágios no funil de reserva: depois que o corretor gera o link
-- ("aguardando_qualificacao"), e depois que o cliente envia o formulário
-- ("em_analise_financeira" — é aqui que passa a valer o prazo de 48h de
-- retenção do lote pra análise). Reservas antigas continuam funcionando
-- (pendente -> em_atendimento -> confirmada), o funil novo só se aplica a
-- quem passar pela qualificação.
alter type reserva_status add value if not exists 'aguardando_qualificacao' after 'em_atendimento';
alter type reserva_status add value if not exists 'em_analise_financeira' after 'aguardando_qualificacao';

-- Prazo (alerta, não expira sozinho — ver decisão do produto) da análise
-- financeira: preenchido quando a reserva entra em 'em_analise_financeira'
-- (now() + 48h). O painel só usa isso pra mostrar um contador/alerta; ninguém
-- libera o lote automaticamente por causa dele.
alter table reservas add column if not exists analise_prazo_em timestamptz;

create type qualificacao_status as enum (
  'aguardando_preenchimento', -- link gerado, cliente ainda não terminou
  'em_analise',               -- cliente enviou, aguardando decisão do financeiro
  'aprovada',
  'reprovada'
);

-- Um "formulário de qualificação": o link público que o corretor manda pro
-- cliente final. Um por reserva. O token é a única credencial de acesso —
-- não tem login nenhum do lado do cliente.
create table formularios_qualificacao (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null unique references reservas(id) on delete cascade,
  lote_id uuid not null references lotes(id),
  cliente_id uuid not null references clientes(id),
  corretor_id uuid references corretores(id),
  token text unique not null,
  status qualificacao_status not null default 'aguardando_preenchimento',
  -- Todas as respostas do formulário (mesmos campos da Proposta de
  -- Compra/Venda em papel: RG, órgão expedidor, CPF/CNPJ, data de
  -- nascimento, nacionalidade, e-mail, profissão, estado civil, dados do
  -- cônjuge quando casado, endereços residencial/comercial, telefones,
  -- forma de pagamento, valor proposto, sinal, parcelas etc.) — guardadas
  -- como JSON porque o formulário pode evoluir sem precisar de migração
  -- nova a cada campo.
  dados jsonb not null default '{}'::jsonb,
  enviado_em timestamptz,
  analisado_em timestamptz,
  analisado_por uuid references corretores(id),
  motivo_reprovacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_formularios_qualificacao_token on formularios_qualificacao(token);
create index idx_formularios_qualificacao_status on formularios_qualificacao(status);

-- Documentos anexados pelo cliente (RG, CPF, comprovante de residência,
-- certidão de nascimento/casamento, documentos do cônjuge quando casado,
-- comprovante de renda). Um formulário pode ter várias tentativas do mesmo
-- tipo (reenvio de um documento ilegível), por isso não é chave única em
-- (formulario_id, tipo) — o painel mostra sempre o mais recente de cada tipo.
create type documento_tipo as enum (
  'rg', 'cpf', 'comprovante_residencia', 'certidao_nascimento_casamento',
  'conjuge_rg', 'conjuge_cpf', 'comprovante_renda', 'outro'
);

create table documentos_qualificacao (
  id uuid primary key default gen_random_uuid(),
  formulario_id uuid not null references formularios_qualificacao(id) on delete cascade,
  tipo documento_tipo not null,
  nome_arquivo text not null,
  storage_path text not null,     -- caminho dentro do bucket privado "documentos-clientes"
  tamanho_bytes bigint,
  enviado_em timestamptz not null default now()
);
create index idx_documentos_qualificacao_formulario on documentos_qualificacao(formulario_id);

create trigger trg_formularios_qualificacao_updated before update on formularios_qualificacao
  for each row execute function set_updated_at();

-- Liga a proposta (gerada automaticamente quando a qualificação é aprovada)
-- de volta ao formulário — assim a geração do PDF consegue puxar todos os
-- campos que o cliente preencheu (RG, endereços, cônjuge etc.), sem precisar
-- duplicar tudo isso na tabela de propostas.
alter table propostas add column if not exists formulario_id uuid references formularios_qualificacao(id);

-- Mesmo padrão do resto do CRM: tudo aqui só é lido/gravado pelo backend com
-- a service key (que ignora RLS) — o acesso público por token é validado em
-- código Python, nunca direto pelo Supabase. RLS aqui é só reforço, caso
-- algum dia um cliente Supabase autenticado tente ler direto.
alter table formularios_qualificacao enable row level security;
alter table documentos_qualificacao enable row level security;

create policy "formularios_qualificacao_admin" on formularios_qualificacao
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "documentos_qualificacao_admin" on documentos_qualificacao
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Bucket privado para os documentos (nunca público — são documentos
-- pessoais). Todo acesso passa pelo backend com a service key; não criamos
-- política de storage.objects para anon/authenticated de propósito.
insert into storage.buckets (id, name, public)
values ('documentos-clientes', 'documentos-clientes', false)
on conflict (id) do nothing;
