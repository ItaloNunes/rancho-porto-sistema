import { ESTADO_CIVIL_OPCOES } from "../../components/qualificacaoCampos";
import { formatMoney, formatarNumeroProposta } from "../../lib/api";
import type { PropostaDetalhe, QualificacaoDados } from "../../types";

/** Dados da proposta só para leitura (26/10): o corretor consegue conferir o
 * que preencheu a qualquer momento — inclusive numa proposta cancelada ou
 * expirada, que não gera mais PDF. */
export default function PropostaDadosLeitura({ proposta }: { proposta: PropostaDetalhe }) {
  const dq = (proposta.dados_qualificacao ?? {}) as Partial<QualificacaoDados>;
  const pr = dq.proponente ?? {};
  const cj = dq.conjuge ?? null;
  const end = dq.endereco_residencial ?? {};
  const ec = dq.endereco_comercial ?? {};
  const estadoCivil = ESTADO_CIVIL_OPCOES.find((o) => o.valor === dq.estado_civil)?.label;
  const endereco = (e: typeof end) =>
    [e.rua, e.numero && `nº ${e.numero}`, e.complemento, e.bairro, [e.cidade, e.estado].filter(Boolean).join("/"), e.cep && `CEP ${e.cep}`]
      .filter(Boolean)
      .join(" · ") || "—";
  return (
    <div className="grid gap-4 text-sm">
      <div>
        <h2 id="proposta-dados-title" className="text-lg font-bold text-ink">
          Proposta <span className="font-mono text-base">{formatarNumeroProposta(proposta.numero, proposta.versao)}</span>
        </h2>
        <p className="text-ink-soft">
          {[proposta.lote?.identificador, proposta.condominio_nome].filter(Boolean).join(" — ")} · {formatMoney(proposta.valor_proposto)}
        </p>
      </div>
      <Bloco titulo="Comprador">
        <Linha r="Nome" v={pr.nome ?? proposta.cliente?.nome} />
        <Linha r="CPF/CNPJ" v={pr.cpf_cnpj} />
        <Linha r="RG" v={[pr.rg, pr.orgao_expedidor].filter(Boolean).join(" / ")} />
        <Linha r="Nascimento" v={dataBR(pr.data_nascimento)} />
        <Linha r="Profissão" v={pr.profissao} />
        <Linha r="E-mail" v={pr.email} />
        <Linha r="Estado civil" v={estadoCivil} />
      </Bloco>
      {cj && (cj.nome || cj.cpf_cnpj) && (
        <Bloco titulo="Cônjuge / companheiro(a)">
          <Linha r="Nome" v={cj.nome} />
          <Linha r="CPF" v={cj.cpf_cnpj} />
          <Linha r="RG" v={[cj.rg, cj.orgao_expedidor].filter(Boolean).join(" / ")} />
          <Linha r="Nascimento" v={dataBR(cj.data_nascimento)} />
          <Linha r="Profissão" v={cj.profissao} />
        </Bloco>
      )}
      <Bloco titulo="Endereços e contatos">
        <Linha r="Residencial" v={endereco(end)} />
        <Linha r="Comercial" v={dq.endereco_comercial_nao_possui ? "Não possui" : endereco(ec)} />
        <Linha r="Celular" v={dq.telefone_celular} />
      </Bloco>
      <Bloco titulo="Pagamento">
        <Linha r="Condições" v={proposta.condicoes_pagamento} />
        <Linha r="Renda" v={dq.forma_pagamento?.renda ? `R$ ${dq.forma_pagamento.renda}` : null} />
      </Bloco>
    </div>
  );
}

function dataBR(v?: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-3 grid gap-1">
      <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">{titulo}</h3>
      {children}
    </section>
  );
}

function Linha({ r, v }: { r: string; v?: string | null }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-2">
      <span className="text-ink-soft">{r}</span>
      <span className="text-ink break-words">{v || "—"}</span>
    </div>
  );
}
