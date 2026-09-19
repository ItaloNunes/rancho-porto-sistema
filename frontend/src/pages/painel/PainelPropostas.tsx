import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { abrirAbaComCarregamento, api, formatMoney, mostrarErroNaAba, mostrarPdfNaAba } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import PropostaFormularioCompleto from "./PropostaFormularioCompleto";
import PropostaDocumentos from "./PropostaDocumentos";
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
  const [verDocumentosDe, setVerDocumentosDe] = useState<string | null>(null);

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
    // A aba precisa abrir *na hora do clique* (síncrono) — se esperarmos o
    // fetch do PDF terminar pra só então chamar window.open, o navegador não
    // reconhece mais como resultado direto de um gesto do usuário e bloqueia
    // a aba silenciosamente (sem erro nenhum: parecia que o botão "não fazia
    // nada"). Mesmo padrão já usado em PainelVisaoGeral.tsx/PainelDisponibilidade.tsx.
    const aba = abrirAbaComCarregamento("Gerando PDF da proposta...");
    setGerandoPdf(p.id);
    try {
      const blob = await api.gerarPdfProposta(p.id);
      const nomeArquivo = `proposta-${p.lote?.identificador ?? p.id}.pdf`;
      if (aba) {
        mostrarPdfNaAba(aba, blob, nomeArquivo, `Proposta — ${p.lote?.identificador ?? ""}`);
      } else {
        // Mesmo a abertura em branco pode ser bloqueada (config restritiva do
        // navegador) — nesse caso, baixa o arquivo direto em vez de silenciar.
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = nomeArquivo;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      mostrarErroNaAba(aba, mensagem);
      alert(mensagem);
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
                <th className="px-4 py-3 font-medium">Documentos</th>
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
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button className="btn-row btn-row-neutral" onClick={() => setVerDocumentosDe(p.id)}>
                      {p.documentos.length > 0 ? `${p.documentos.length} anexo(s)` : "anexar"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      className="btn-row btn-row-primary"
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

      {verDocumentosDe &&
        (() => {
          const proposta = propostas?.find((p) => p.id === verDocumentosDe);
          // A proposta pode ter sumido da lista entre um recarregar() e
          // outro (ex.: excluída em outra aba) — nesse caso simplesmente
          // não reabre o modal, em vez de quebrar renderizando undefined.
          if (!proposta) return null;
          return (
            <Modal onClose={() => setVerDocumentosDe(null)} labelledBy="proposta-documentos-title">
              <div className="p-6 sm:p-8">
                <PropostaDocumentos proposta={proposta} onAtualizado={recarregar} />
              </div>
            </Modal>
          );
        })()}
    </div>
  );
}
