-- Anexo de documentos direto numa proposta, pelo corretor logado no painel
-- (POST/GET/DELETE /crm/propostas/{id}/documentos em routers/crm.py) --
-- diferente do fluxo antigo de documentos_qualificacao (0007), que só
-- funciona atrelado a um formulário de qualificação por link público e trava
-- assim que o cliente envia. Aqui a proposta pode ganhar (ou perder) anexos
-- a qualquer momento, é assim que o corretor completa depois o que faltou.
--
-- Reaproveita o enum documento_tipo e o bucket privado "documentos-clientes"
-- já criados em 0007 — caminho no bucket prefixado por "proposta/<id>/" pra
-- não colidir com os caminhos prefixados por formulario_id.
create table documentos_proposta (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references propostas(id) on delete cascade,
  tipo documento_tipo not null,
  nome_arquivo text not null,
  storage_path text not null,
  tamanho_bytes bigint,
  enviado_por uuid references corretores(id),
  enviado_em timestamptz not null default now()
);
create index idx_documentos_proposta_proposta on documentos_proposta(proposta_id);

-- Mesmo padrão do resto do CRM: só o backend (service key, ignora RLS) lê e
-- grava aqui. RLS é só reforço, caso algum dia um cliente Supabase
-- autenticado tente ler direto.
alter table documentos_proposta enable row level security;
create policy "documentos_proposta_admin" on documentos_proposta
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
