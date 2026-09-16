import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api, formatMoney } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import PropostaFormularioCompleto from "./PropostaFormularioCompleto";
import type { LoteComCondominio, PropostaDetalhe, PropostaStatus } from "../../types";

const STATUS_LABEL: Record<PropostaStatus, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
  cancelada: "Cancelada",
};

/** Só a partir daqui o PDF em papel timbrado pode ser gerado — ver mesma
 * regra no backend (routers/crm.py: gerar_pdf_proposta). */
const STATUS_LIBERA_PDF: PropostaStatus[] = ["aprovada", "enviada", "aceita"];

export default function PainelPropostas() {
  const { perfil } = useAuth();
  const [propostas, setPropostas] = useState<PropostaDetalhe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [lotes, setLotes] = useState<LoteComCondominio[]>([]);

  function recarregar() {
    setErro(null);
    api.listarPropostas().then(setPropostas).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    recarregar();
    api.listarTodosLotes().then(setLotes).catch(() => {});
  }, []);

  async function mudarStatus(p: PropostaDetalhe, status: PropostaStatus) {
    try {
      await api.atualizarStatusProposta(p.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const [gerandoPdf, setGerandoPdf] = useState<string | null>(null);

  async function abrirPdf(p: PropostaDetalhe) {
    setGerandoPdf(p.id);
    try {
      const blob = await api.gerarPdfProposta(p.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setGerandoPdf(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-xl font-bold text-ink">Propostas de compra e venda</h1>
        <button className="btn btn-primary" onClick={() => setCriando(true)}>
          + Nova proposta
        </button>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!propostas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : propostas.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhuma proposta ainda.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Valor proposto</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {propostas.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink">{p.lote ? p.lote.identificador : "—"}</td>
                  <td className="px-4 py-3 text-ink">{p.cliente?.nome ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{formatMoney(p.valor_proposto)}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input !py-1.5 !text-xs w-auto"
                      value={p.status}
                      onChange={(e) => mudarStatus(p, e.target.value as PropostaStatus)}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, label]) => (
                        <option key={v} value={v} disabled={v === "aprovada" && perfil?.papel !== "admin"}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      className="text-primary text-xs font-medium hover:underline disabled:opacity-50"
                      disabled={gerandoPdf === p.id || !p.lote || !p.cliente || !STATUS_LIBERA_PDF.includes(p.status)}
                      title={
                        !p.lote || !p.cliente
                          ? "Proposta sem lote ou cliente vinculado"
                          : !STATUS_LIBERA_PDF.includes(p.status)
                            ? "Aguardando aprovação de um administrador"
                            : undefined
                      }
                      onClick={() => abrirPdf(p)}
                    >
                      {gerandoPdf === p.id ? "Gerando..." : "gerar PDF"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {criando && (
        <Modal onClose={() => setCriando(false)} labelledBy="proposta-modal-title">
          <PropostaFormularioCompleto
            lotes={lotes}
            onSalvo={() => {
              setCriando(false);
              recarregar();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
