import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api, formatDateTime, formatMoney } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { DOCUMENTO_LABEL, DOCUMENTOS_CONJUGE, DOCUMENTOS_OBRIGATORIOS } from "../../types";
import type { DocumentoTipo, EstadoCivil, QualificacaoComRelacoes, QualificacaoStatus } from "../../types";

const STATUS_LABEL: Record<QualificacaoStatus, string> = {
  aguardando_preenchimento: "Aguardando cliente",
  em_analise: "Em análise",
  aprovada: "Aprovada",
  reprovada: "Reprovada",
};

const STATUS_BADGE: Record<QualificacaoStatus, string> = {
  aguardando_preenchimento: "bg-surface-alt text-ink-soft",
  em_analise: "bg-ochre/10 text-ochre",
  aprovada: "bg-sage/10 text-sage",
  reprovada: "bg-rust/10 text-rust",
};

const ESTADO_CIVIL_LABEL: Record<EstadoCivil, string> = {
  solteiro: "Solteiro(a)",
  casado: "Casado(a)",
  viuvo: "Viúvo(a)",
  divorciado: "Divorciado(a)",
  outros: "Outros",
};

export default function PainelQualificacoes() {
  const { perfil } = useAuth();
  const isAdmin = perfil?.papel === "admin";
  const [lista, setLista] = useState<QualificacaoComRelacoes[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<QualificacaoComRelacoes | null>(null);

  function recarregar() {
    setErro(null);
    api.listarQualificacoes().then(setLista).catch((e) => setErro(e.message));
  }

  useEffect(recarregar, []);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink">Qualificação de clientes</h1>
        <p className="text-xs text-ink-soft mt-1">
          Formulários enviados pelos clientes finais (dados da proposta + documentos), aguardando ou já decididos
          pela análise financeira.
        </p>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!lista ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : lista.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhuma qualificação gerada ainda — gere o link em "Reservas".</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Enviado em</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {lista.map((q) => (
                <tr key={q.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink">{q.lote?.identificador ?? "—"}</td>
                  <td className="px-4 py-3 text-ink">{q.cliente?.nome ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{formatDateTime(q.enviado_em)}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_BADGE[q.status]}`}>{STATUS_LABEL[q.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="text-primary text-xs font-medium hover:underline" onClick={() => setAberta(q)}>
                      ver detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aberta && (
        <Modal onClose={() => setAberta(null)} labelledBy="qualificacao-modal-title">
          <DetalheQualificacao
            qualificacao={aberta}
            isAdmin={isAdmin}
            onDecidido={() => {
              setAberta(null);
              recarregar();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor?: string | number | null }) {
  if (valor === undefined || valor === null || valor === "") return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">{label}</div>
      <div className="text-sm text-ink">{valor}</div>
    </div>
  );
}

function DetalheQualificacao({
  qualificacao: q,
  isAdmin,
  onDecidido,
}: {
  qualificacao: QualificacaoComRelacoes;
  isAdmin: boolean;
  onDecidido: () => void;
}) {
  const dados = q.dados ?? {};
  const proponente = dados.proponente ?? {};
  const conjuge = dados.conjuge ?? {};
  const enderecoRes = dados.endereco_residencial ?? {};
  const enderecoCom = dados.endereco_comercial ?? {};
  const fp = dados.forma_pagamento ?? {};
  const casado = dados.estado_civil === "casado";

  const obrigatorios: DocumentoTipo[] = [...DOCUMENTOS_OBRIGATORIOS, ...(casado ? DOCUMENTOS_CONJUGE : [])];
  const tiposEnviados = new Set(q.documentos.map((d) => d.tipo));

  const [motivo, setMotivo] = useState("");
  const [decidindo, setDecidindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  async function baixar(documentoId: string) {
    setBaixando(documentoId);
    try {
      const { url } = await api.baixarDocumentoQualificacao(q.id, documentoId);
      window.open(url, "_blank");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBaixando(null);
    }
  }

  async function decidir(aprovado: boolean) {
    if (!aprovado && !motivo.trim()) {
      setErro("Informe o motivo da reprovação.");
      return;
    }
    setErro(null);
    setDecidindo(true);
    try {
      await api.decidirQualificacao(q.id, { aprovado, motivo_reprovacao: aprovado ? null : motivo });
      onDecidido();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setDecidindo(false);
    }
  }

  return (
    <div className="p-6 sm:p-8 grid gap-5">
      <div>
        <h2 id="qualificacao-modal-title" className="text-lg font-bold text-ink">
          {q.lote?.identificador ?? "Lote"} — {q.cliente?.nome ?? "Cliente"}
        </h2>
        <span className={`badge mt-1 inline-block ${STATUS_BADGE[q.status]}`}>{STATUS_LABEL[q.status]}</span>
      </div>

      {q.status === "reprovada" && q.motivo_reprovacao && (
        <div className="bg-rust/10 text-rust text-sm rounded px-3 py-2">Motivo da reprovação: {q.motivo_reprovacao}</div>
      )}

      {q.status === "aguardando_preenchimento" ? (
        <p className="text-sm text-ink-soft">O cliente ainda não terminou de preencher o formulário.</p>
      ) : (
        <>
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">Proponente</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Campo label="Nome" valor={proponente.nome} />
              <Campo label="CPF/CNPJ" valor={proponente.cpf_cnpj} />
              <Campo label="RG" valor={proponente.rg} />
              <Campo label="Órgão expedidor" valor={proponente.orgao_expedidor} />
              <Campo label="Data de nascimento" valor={proponente.data_nascimento} />
              <Campo label="Nacionalidade" valor={proponente.nacionalidade} />
              <Campo label="Profissão" valor={proponente.profissao} />
              <Campo label="E-mail" valor={proponente.email} />
              <Campo label="Estado civil" valor={dados.estado_civil ? ESTADO_CIVIL_LABEL[dados.estado_civil] : null} />
              <Campo label="Celular" valor={dados.telefone_celular} />
              <Campo label="Telefone residencial" valor={dados.telefone_residencial} />
              <Campo label="Telefone comercial" valor={dados.telefone_comercial} />
            </div>
          </section>

          {casado && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">Cônjuge</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Campo label="Nome" valor={conjuge.nome} />
                <Campo label="CPF/CNPJ" valor={conjuge.cpf_cnpj} />
                <Campo label="RG" valor={conjuge.rg} />
                <Campo label="Data de nascimento" valor={conjuge.data_nascimento} />
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">Endereço residencial</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Campo label="Rua" valor={enderecoRes.rua} />
              <Campo label="Número" valor={enderecoRes.numero} />
              <Campo label="Bairro" valor={enderecoRes.bairro} />
              <Campo label="Cidade/UF" valor={[enderecoRes.cidade, enderecoRes.estado].filter(Boolean).join("/")} />
              <Campo label="CEP" valor={enderecoRes.cep} />
            </div>
          </section>

          {(enderecoCom.rua || enderecoCom.cidade) && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">Endereço comercial</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Campo label="Rua" valor={enderecoCom.rua} />
                <Campo label="Número" valor={enderecoCom.numero} />
                <Campo label="Cidade/UF" valor={[enderecoCom.cidade, enderecoCom.estado].filter(Boolean).join("/")} />
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">Forma de pagamento</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Campo label="À vista" valor={fp.a_vista ? "Sim" : "Não"} />
              <Campo label="Renda informada" valor={fp.renda} />
              <Campo label="Valor proposto" valor={fp.valor_proposto != null ? formatMoney(fp.valor_proposto) : null} />
              <Campo label="Sinal" valor={fp.sinal} />
              <Campo label="Parcelas" valor={fp.dividido_em_parcelas ? `${fp.dividido_em_parcelas}x de ${fp.valor_parcela ?? "-"}` : null} />
              <Campo label="Vencimento" valor={fp.vencimento} />
            </div>
            {fp.observacoes && <p className="text-sm text-ink-soft mt-2">{fp.observacoes}</p>}
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">Documentos</h3>
            <div className="grid gap-1.5">
              {obrigatorios.map((tipo) => {
                const doc = [...q.documentos].reverse().find((d) => d.tipo === tipo);
                return (
                  <div key={tipo} className="flex items-center justify-between gap-3 text-sm">
                    <span className={doc ? "text-ink" : "text-rust"}>
                      {DOCUMENTO_LABEL[tipo]} {!doc && "— faltando"}
                    </span>
                    {doc && (
                      <button
                        className="text-primary text-xs font-medium hover:underline shrink-0 disabled:opacity-50"
                        disabled={baixando === doc.id}
                        onClick={() => baixar(doc.id)}
                      >
                        {baixando === doc.id ? "abrindo..." : "baixar"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {q.status === "em_analise" && isAdmin && (
            <section className="border-t border-border pt-4 grid gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Decisão financeira</h3>
              <textarea
                className="input"
                placeholder="Motivo da reprovação (obrigatório só se reprovar)"
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              {erro && <p className="text-rust text-sm">{erro}</p>}
              <div className="flex gap-3">
                <button className="btn btn-primary flex-1" disabled={decidindo} onClick={() => decidir(true)}>
                  {decidindo ? "Aprovando..." : "Aprovar"}
                </button>
                <button
                  className="btn btn-outline flex-1 !border-rust !text-rust"
                  disabled={decidindo}
                  onClick={() => decidir(false)}
                >
                  {decidindo ? "Reprovando..." : "Reprovar"}
                </button>
              </div>
            </section>
          )}
          {q.status === "em_analise" && !isAdmin && (
            <p className="text-xs text-ink-soft border-t border-border pt-4">
              Só um administrador pode aprovar ou reprovar a análise financeira.
            </p>
          )}
        </>
      )}
    </div>
  );
}
