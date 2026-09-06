import { formatArea, formatMoney } from "../lib/api";
import type { Lote } from "../types";

const STATUS_LABEL: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

const ROW_COLS = "1.4fr 1fr 1.3fr 1.1fr 1.1fr 1fr";

export default function ListaLotes({ lotes, onSelecionar }: { lotes: Lote[]; onSelecionar: (n: number) => void }) {
  if (lotes.length === 0) {
    return (
      <div className="card p-16 text-center text-ink-soft text-sm">
        Nenhum lote encontrado com esses filtros.
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      <div
        className="hidden md:grid gap-3 px-5 py-3 text-[11px] font-semibold tracking-wide text-ink-soft uppercase
                   bg-surface-alt border-b border-border"
        style={{ gridTemplateColumns: ROW_COLS }}
      >
        <span>Lote</span>
        <span>Área</span>
        <span>Valor total</span>
        <span>Entrada</span>
        <span>Parcela</span>
        <span>Situação</span>
      </div>
      <div className="max-h-[560px] overflow-y-auto scrollbar-thin divide-y divide-border">
        {lotes.map((l) => (
          <button key={l.id} onClick={() => onSelecionar(l.lote_numero)} className="w-full text-left hover:bg-surface-alt transition-colors">
            {/* Linha em tabela — telas médias/grandes */}
            <div className="hidden md:grid items-center gap-3 px-5 py-3.5 text-sm" style={{ gridTemplateColumns: ROW_COLS }}>
              <span className="font-medium text-ink">
                {l.identificador}
                <span className="block text-xs text-ink-soft font-normal">quadra {l.quadra}</span>
              </span>
              <span className="text-ink-soft">{formatArea(l.tamanho_m2)}</span>
              <span className="font-medium">{formatMoney(l.valor_total)}</span>
              <span className="text-ink-soft">{formatMoney(l.entrada)}</span>
              <span className="text-ink-soft">{formatMoney(l.parcela_mensal)}</span>
              <span>
                <span className={`badge badge-${l.status}`}>{STATUS_LABEL[l.status]}</span>
              </span>
            </div>

            {/* Cartão — telas pequenas */}
            <div className="md:hidden px-5 py-4 grid gap-2.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink text-sm">
                  {l.identificador}
                  <span className="block text-xs text-ink-soft font-normal">quadra {l.quadra}</span>
                </span>
                <span className={`badge badge-${l.status}`}>{STATUS_LABEL[l.status]}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                <span className="text-ink-soft">
                  Área <strong className="text-ink font-medium">{formatArea(l.tamanho_m2)}</strong>
                </span>
                <span className="text-ink-soft">
                  Entrada <strong className="text-ink font-medium">{formatMoney(l.entrada)}</strong>
                </span>
                <span className="text-ink-soft col-span-2">
                  Valor total <strong className="text-ink font-medium">{formatMoney(l.valor_total)}</strong>
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
