-- Segunda fase do "prazo de análise" (a primeira é reservas.analise_prazo_em,
-- ver migration 0018 + qualificacao.py::enviar_para_analise): quando o
-- corretor termina de anexar todos os documentos obrigatórios de uma
-- proposta, o backend marca o instante aqui (ver
-- routers/crm.py::_atualizar_documentos_completos_em) e o painel mostra
-- isso + 72h como o prazo da análise financeira dessa etapa — pro corretor
-- não precisar perguntar ao admin se já saiu o resultado.
alter table propostas add column if not exists documentos_completos_em timestamptz;

-- Backfill: propostas que já estão com todos os documentos obrigatórios
-- anexados (mesma lista/regra do cônjuge usada pelo checklist do painel)
-- recebem o instante em que o último documento obrigatório foi enviado, em
-- vez de ficar sem nenhuma marca só porque isso aconteceu antes desta coluna
-- existir.
with obrigatorios as (
  select
    p.id as proposta_id,
    case
      when (p.dados_qualificacao ->> 'estado_civil') = 'casado' then
        array['rg', 'cpf', 'comprovante_residencia', 'certidao_nascimento_casamento',
              'comprovante_renda', 'conjuge_rg', 'conjuge_cpf']
      else
        array['rg', 'cpf', 'comprovante_residencia', 'certidao_nascimento_casamento',
              'comprovante_renda']
    end as tipos_obrigatorios
  from propostas p
  where p.documentos_completos_em is null
),
completas as (
  select
    o.proposta_id,
    array_length(o.tipos_obrigatorios, 1) as total_obrigatorios,
    count(distinct dp.tipo) filter (where dp.tipo::text = any(o.tipos_obrigatorios)) as enviados,
    max(dp.enviado_em) filter (where dp.tipo::text = any(o.tipos_obrigatorios)) as completou_em
  from obrigatorios o
  left join documentos_proposta dp on dp.proposta_id = o.proposta_id
  group by o.proposta_id, o.tipos_obrigatorios
)
update propostas p
set documentos_completos_em = c.completou_em
from completas c
where p.id = c.proposta_id
  and c.enviados = c.total_obrigatorios
  and c.completou_em is not null;
