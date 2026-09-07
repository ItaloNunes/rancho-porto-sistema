import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ReservaComLote, ReservaStatus } from "../../types";

/** Ordem do funil "feliz" — cancelada é tratada à parte (ver Stepper). */
const ETAPAS: { status: ReservaStatus; label: string }[] = [
  { status: "pendente", label: "Novo" },
  { status: "em_atendimento", label: "Em atendimento" },
  { status: "confirmada", label: "Confirmada" },
];

export default function PainelAcompanhamento() {
  const [reservas, setReservas] = useState<ReservaComLote[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"abertos" | "todos">("abertos");

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

  const contagem = {
    pendente: reservas?.filter((r) => r.status === "pendente").length ?? 0,
    em_atendimento: reservas?.filter((r) => r.status === "em_atendimento").length ?? 0,
    confirmada: reservas?.filter((r) => r.status === "confirmada").length ?? 0,
    cancelada: reservas?.filter((r) => r.status === "cancelada").length ?? 0,
  };

  const visiveis = (reservas ?? []).filter((r) => filtro === "todos" || r.status !== "cancelada");

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Acompanhamento de leads</h1>
          <p className="text-xs text-ink-soft mt-1">
            Visão geral de todos os pedidos de reserva (de todos os corretores) e em que etapa do atendimento cada
            um está.
          </p>
        </div>
        <select className="input !w-auto text-sm" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
          <option value="abertos">Só em aberto</option>
          <option value="todos">Todos (incl. cancelados)</option>
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile label="Novos" valor={contagem.pendente} cor="text-primary" />
        <StatTile label="Em atendimento" valor={contagem.em_atendimento} cor="text-amber-600" />
        <StatTile label="Confirmados" valor={contagem.confirmada} cor="text-sage" />
        <StatTile label="Cancelados" valor={contagem.cancelada} cor="text-rust" />
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!reservas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : visiveis.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhum lead em aberto no momento.</p>
      ) : (
        <div className="grid gap-3">
          {visiveis.map((r) => (
            <div key={r.id} className="card p-4 sm:p-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold text-ink text-sm">{r.nome || "Interessado sem nome"}</span>
                  <span className="text-xs text-ink-soft">{r.contato || "sem contato"}</span>
                </div>
                <p className="text-xs text-ink-soft mt-0.5">
                  Lote <strong className="text-ink">{r.lote?.identificador ?? "—"}</strong>
                  {r.observacao ? ` · ${r.observacao}` : ""}
                </p>
                <div className="mt-3 max-w-sm">
                  <Stepper status={r.status} />
                </div>
              </div>
              <select
                className="input !py-1.5 !text-xs w-auto justify-self-start sm:justify-self-end"
                value={r.status}
                onChange={(e) => mudarStatus(r, e.target.value as ReservaStatus)}
              >
                {ETAPAS.map((e) => (
                  <option key={e.status} value={e.status}>
                    {e.label}
                  </option>
                ))}
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  return (
    <div className="card p-4">
      <p className={`text-2xl font-bold ${cor}`}>{valor}</p>
      <p className="text-xs text-ink-soft mt-0.5">{label}</p>
    </div>
  );
}

/** Trilha de progresso estilo rastreio de encomenda: um ponto por etapa, linha
 * preenchida até a etapa atual. "Cancelada" quebra a trilha num "x" vermelho
 * na etapa em que o pedido parou. */
function Stepper({ status }: { status: ReservaStatus }) {
  if (status === "cancelada") {
    return (
      <div className="flex items-center gap-2 text-rust">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-rust/15 text-rust text-[11px] font-bold shrink-0">
          ✕
        </span>
        <span className="text-xs font-medium">Cancelado</span>
      </div>
    );
  }

  const idxAtual = ETAPAS.findIndex((e) => e.status === status);

  return (
    <div className="flex items-center">
      {ETAPAS.map((etapa, i) => {
        const concluida = i < idxAtual;
        const atual = i === idxAtual;
        return (
          <div key={etapa.status} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold transition-colors ${
                  concluida
                    ? "bg-sage text-white"
                    : atual
                      ? "bg-primary text-white ring-4 ring-primary/20"
                      : "bg-surface-alt text-ink-soft"
                }`}
              >
                {concluida ? "✓" : i + 1}
              </span>
              <span className={`text-[10px] whitespace-nowrap ${atual ? "text-ink font-semibold" : "text-ink-soft"}`}>
                {etapa.label}
              </span>
            </div>
            {i < ETAPAS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 -mt-4 ${concluida ? "bg-sage" : "bg-surface-alt"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
