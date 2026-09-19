import { formatArea, formatMoney } from "../lib/api";
import type { Lote } from "../types";

/** Link direto pro lote — usado no botão de compartilhar. `lote_numero` na
 * query porque é o identificador estável já usado nos filtros da Planta (ver
 * Condominio.tsx); a própria Condominio lê essa query pra reabrir o modal
 * certo quando alguém clica num link recebido. */
function linkDoLote(condominioSlug: string, lote: Lote): string {
  // Número do lote sozinho não é único entre quadras (ver Condominio.tsx) — o
  // link carrega a quadra também pra abrir exatamente o lote certo.
  return `${window.location.origin}/condominios/${condominioSlug}?lote=${lote.lote_numero}&quadra=${encodeURIComponent(lote.quadra)}`;
}

function mensagemWhatsApp(condominioNome: string, condominioSlug: string, lote: Lote): string {
  const linhas = [
    `Lote ${lote.identificador} — ${condominioNome}`,
    `Área: ${formatArea(lote.tamanho_m2)}`,
    `Valor total: ${formatMoney(lote.valor_total)}`,
    lote.entrada != null ? `Entrada: ${formatMoney(lote.entrada)}` : null,
    lote.parcela_mensal != null
      ? `Parcela: ${formatMoney(lote.parcela_mensal)}${lote.qtd_parcelas ? ` × ${lote.qtd_parcelas}` : ""}`
      : null,
    "",
    `Veja mais detalhes: ${linkDoLote(condominioSlug, lote)}`,
  ].filter((l): l is string => l !== null);
  return linhas.join("\n");
}

const STATUS_LABEL: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

export default function DetalheLote({
  lote,
  condominioNome,
  condominioSlug,
}: {
  lote: Lote;
  condominioNome: string;
  condominioSlug: string;
}) {
  function compartilharWhatsApp() {
    const texto = mensagemWhatsApp(condominioNome, condominioSlug, lote);
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="p-6 sm:p-7">
      <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Quadra {lote.quadra}</p>
      <div className="flex items-center gap-3 mt-1">
        <h2 id="lote-modal-title" className="text-2xl font-bold text-ink tracking-tight">
          {lote.identificador}
        </h2>
        <span className={`badge badge-${lote.status}`}>{STATUS_LABEL[lote.status]}</span>
        <button
          onClick={compartilharWhatsApp}
          className="ml-auto flex items-center gap-1.5 min-h-11 px-3.5 rounded text-sm font-medium
                     text-sage hover:bg-sage/10 active:scale-[0.98] transition-colors shrink-0"
          title="Compartilhar este lote no WhatsApp"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.2h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm5.8 14.02c-.24.68-1.4 1.32-1.93 1.4-.5.08-1.12.11-1.8-.11-.42-.13-.95-.31-1.64-.6-2.88-1.24-4.76-4.14-4.9-4.33-.14-.19-1.17-1.56-1.17-2.98 0-1.42.74-2.11 1-2.4.26-.29.57-.36.76-.36h.55c.18 0 .41-.07.64.49.24.58.81 2 .88 2.15.07.15.12.32.02.51-.1.19-.15.31-.29.48-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.35 1.46.29.15.46.13.63-.08.17-.2.72-.84.92-1.13.19-.29.38-.24.64-.14.26.1 1.64.77 1.92.91.29.14.48.21.55.33.07.12.07.68-.17 1.35Z" />
          </svg>
          <span className="hidden sm:inline">Compartilhar</span>
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 mt-6 pb-6 border-b border-border">
        <Field label="Área" value={formatArea(lote.tamanho_m2)} />
        <Field label="Valor total à prazo" value={formatMoney(lote.valor_total)} highlight />
        <Field label="Entrada" value={formatMoney(lote.entrada)} />
        <Field label="Na entrega" value={formatMoney(lote.entrega)} />
        <Field
          label="Parcela mensal"
          value={`${formatMoney(lote.parcela_mensal)}${lote.qtd_parcelas ? ` × ${lote.qtd_parcelas}` : ""}`}
          span2
        />
      </dl>

      {lote.status === "disponivel" && (
        // Reserva não é mais feita pelo cliente aqui — só o corretor cria pelo
        // painel (decisão de negócio; ver backend/app/routers/reservas.py:
        // reservar_lote, desativado de propósito). O botão "Compartilhar" ali
        // em cima já cobre o caminho de levar o interessado até um corretor.
        <div className="mt-6 rounded-lg bg-surface-alt text-ink-soft text-sm p-4 leading-relaxed">
          Interessado neste lote? Fale com um dos nossos corretores pelo botão "Compartilhar" acima
          ou pelos canais de contato da Castel — só um corretor pode formalizar a reserva.
        </div>
      )}
    </div>
  );
}

function Field({ label, value, highlight, span2 }: { label: string; value: string; highlight?: boolean; span2?: boolean }) {
  return (
    <div className={span2 ? "col-span-2" : undefined}>
      <dt className="text-xs text-ink-soft mb-1">{label}</dt>
      <dd className={`text-[15px] font-semibold ${highlight ? "text-primary" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
