import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { LoteComCondominio, LoteStatus } from "../../types";
import Modal from "../../components/Modal";

const STATUS_LABEL: Record<LoteStatus, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

export default function PainelLotes() {
  const [lotes, setLotes] = useState<LoteComCondominio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  // Troca pra "Reservado" passa por uma confirmação antes de aplicar (pedido
  // explícito — evita reservar um lote sem querer com um clique errado no
  // select). `pendente` guarda a troca esperando confirmação; `salvandoId`
  // é o lote com a troca em andamento (select trava e mostra "Salvando..."
  // até o backend confirmar, pra não parecer que já mudou antes de mudar
  // de verdade no estoque).
  const [pendente, setPendente] = useState<{ lote: LoteComCondominio; novoStatus: LoteStatus } | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  function recarregar() {
    setErro(null);
    api.listarTodosLotes().then(setLotes).catch((e) => setErro(e.message));
  }

  useEffect(recarregar, []);

  async function mudarStatus(l: LoteComCondominio, status: LoteStatus) {
    setSalvandoId(l.id);
    try {
      await api.atualizarStatusLote(l.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvandoId(null);
    }
  }

  function selecionarStatus(l: LoteComCondominio, status: LoteStatus) {
    if (status === l.status) return;
    if (status === "reservado") {
      setPendente({ lote: l, novoStatus: status });
      return;
    }
    mudarStatus(l, status);
  }

  const filtrados = (lotes ?? []).filter(
    (l) => !busca.trim() || l.identificador.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-xl font-bold text-ink">Lotes</h1>
        <input
          className="input sm:w-64"
          placeholder="Buscar lote..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!lotes ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Empreendimento</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Tamanho</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink-soft">{l.condominio_nome}</td>
                  <td className="px-4 py-3 font-medium text-ink">{l.identificador}</td>
                  <td className="px-4 py-3 text-ink-soft">{l.tamanho_m2.toLocaleString("pt-BR")} m²</td>
                  <td className="px-4 py-3">
                    {salvandoId === l.id ? (
                      <span className="inline-flex items-center gap-2 text-xs text-ink-soft">
                        <span
                          className="h-3.5 w-3.5 rounded-full border-2 border-border border-t-primary animate-spin"
                          aria-hidden="true"
                        />
                        Salvando...
                      </span>
                    ) : (
                      <select
                        className="input !py-1.5 !text-xs w-auto"
                        value={l.status}
                        disabled={salvandoId !== null}
                        onChange={(e) => selecionarStatus(l, e.target.value as LoteStatus)}
                      >
                        {Object.entries(STATUS_LABEL).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendente && (
        <Modal onClose={() => setPendente(null)} labelledBy="confirmar-reserva-titulo">
          <div className="p-6">
            <h2 id="confirmar-reserva-titulo" className="text-lg font-bold text-ink mb-2">
              Confirmar reserva
            </h2>
            <p className="text-sm text-ink-soft mb-1">
              Você está prestes a marcar o lote abaixo como <span className="font-semibold text-ink">Reservado</span>:
            </p>
            <p className="text-sm text-ink mb-5">
              <span className="font-semibold">{pendente.lote.identificador}</span>{" "}
              <span className="text-ink-soft">— {pendente.lote.condominio_nome}</span>
              <br />
              <span className="text-ink-soft">Status atual: {STATUS_LABEL[pendente.lote.status]}</span>
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-outline !text-xs !py-2" onClick={() => setPendente(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary !text-xs !py-2"
                onClick={() => {
                  mudarStatus(pendente.lote, pendente.novoStatus);
                  setPendente(null);
                }}
              >
                Sim, reservar este lote
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
