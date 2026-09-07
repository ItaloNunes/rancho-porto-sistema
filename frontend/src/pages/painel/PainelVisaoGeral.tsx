import { useEffect, useState } from "react";
import { api, formatMoney } from "../../lib/api";
import type { VisaoGeralCondominio } from "../../types";

export default function PainelVisaoGeral() {
  const [itens, setItens] = useState<VisaoGeralCondominio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [empreendimentoPdf, setEmpreendimentoPdf] = useState<string>("todos");

  function recarregar() {
    setErro(null);
    api.visaoGeral().then(setItens).catch((e) => setErro(e.message));
  }

  useEffect(recarregar, []);

  async function exportarPdf() {
    setExportando(true);
    try {
      const blob = await api.exportarVisaoGeralPdf(empreendimentoPdf === "todos" ? undefined : empreendimentoPdf);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">Visão geral</h1>
          <p className="text-xs text-ink-soft mt-1">
            Números consolidados dos dois empreendimentos, atualizados em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input !w-auto text-sm"
            value={empreendimentoPdf}
            onChange={(e) => setEmpreendimentoPdf(e.target.value)}
          >
            <option value="todos">Todos os empreendimentos</option>
            {(itens ?? []).map((item) => (
              <option key={item.condominio_id} value={item.condominio_id}>
                {item.nome}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={exportarPdf} disabled={exportando}>
            {exportando ? "Gerando..." : "Exportar PDF"}
          </button>
        </div>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!itens ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {itens.map((item) => (
            <div key={item.condominio_id} className="card p-5 sm:p-6">
              <h2 className="text-base font-bold text-ink mb-4">{item.nome}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <StatTile label="Total de lotes" valor={item.total_lotes} cor="text-ink" />
                <StatTile label="Disponíveis" valor={item.disponiveis} cor="text-sage" />
                <StatTile label="Reservados" valor={item.reservados} cor="text-ochre" />
                <StatTile label="Vendidos" valor={item.vendidos} cor="text-ink-soft" />
              </div>
              <div className="grid sm:grid-cols-2 gap-3 pt-4 border-t border-border">
                <div>
                  <p className="text-xs text-ink-soft">Valor total vendido</p>
                  <p className="text-lg font-bold text-primary">{formatMoney(item.valor_total_vendido)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-soft">
                    Propostas em andamento ({item.propostas_abertas})
                  </p>
                  <p className="text-lg font-bold text-ink">{formatMoney(item.valor_em_propostas_abertas)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  return (
    <div className="rounded-sm bg-surface-alt p-3">
      <p className={`text-xl font-bold ${cor}`}>{valor}</p>
      <p className="text-[11px] text-ink-soft mt-0.5">{label}</p>
    </div>
  );
}
