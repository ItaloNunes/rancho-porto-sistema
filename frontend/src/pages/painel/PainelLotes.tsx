import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { LoteComCondominio, LoteStatus } from "../../types";

const STATUS_LABEL: Record<LoteStatus, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

export default function PainelLotes() {
  const [lotes, setLotes] = useState<LoteComCondominio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  function recarregar() {
    setErro(null);
    api.listarTodosLotes().then(setLotes).catch((e) => setErro(e.message));
  }

  useEffect(recarregar, []);

  async function mudarStatus(l: LoteComCondominio, status: LoteStatus) {
    try {
      await api.atualizarStatusLote(l.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
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
                    <select
                      className="input !py-1.5 !text-xs w-auto"
                      value={l.status}
                      onChange={(e) => mudarStatus(l, e.target.value as LoteStatus)}
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
