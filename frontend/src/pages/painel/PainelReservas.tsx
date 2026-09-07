import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ReservaComLote, ReservaStatus } from "../../types";

const STATUS_LABEL: Record<ReservaStatus, string> = {
  pendente: "Pendente",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
};

export default function PainelReservas() {
  const [reservas, setReservas] = useState<ReservaComLote[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function recarregar() {
    setErro(null);
    api.listarReservas().then(setReservas).catch((e) => setErro(e.message));
  }

  useEffect(recarregar, []);

  async function mudarStatus(r: ReservaComLote, status: ReservaStatus) {
    try {
      await api.atualizarStatusReserva(r.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-5">Pedidos de reserva</h1>
      <p className="text-xs text-ink-soft -mt-3 mb-5">
        Pedidos feitos direto pelo cliente no catálogo público. Confirmar mantém o lote reservado; cancelar
        libera o lote de volta pra "disponível".
      </p>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!reservas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : reservas.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhum pedido de reserva no momento.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Interessado</th>
                <th className="px-4 py-3 font-medium">Contato</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink">{r.lote ? r.lote.identificador : "—"}</td>
                  <td className="px-4 py-3 text-ink">{r.nome || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.contato || "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input !py-1.5 !text-xs w-auto"
                      value={r.status}
                      onChange={(e) => mudarStatus(r, e.target.value as ReservaStatus)}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
