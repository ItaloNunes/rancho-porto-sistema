import { useState } from "react";
import { api, formatArea, formatMoney } from "../lib/api";
import type { Lote } from "../types";

/** Link direto pro lote — usado no botão de compartilhar. `lote_numero` na
 * query porque é o identificador estável já usado nos filtros da Planta (ver
 * Condominio.tsx); a própria Condominio lê essa query pra reabrir o modal
 * certo quando alguém clica num link recebido. */
function linkDoLote(condominioSlug: string, lote: Lote): string {
  return `${window.location.origin}/condominios/${condominioSlug}?lote=${lote.lote_numero}`;
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

/** Mesma regra do backend (ver backend/app/schemas.py: _valida_contato) — só
 * pra dar o feedback na hora, sem precisar de uma ida e volta ao servidor.
 * A validação que vale de verdade é sempre a da API. */
function validaContato(v: string): string | null {
  const valor = v.trim();
  if (!valor) return "Informe um telefone ou e-mail pra gente confirmar a reserva com você.";
  if (valor.includes("@")) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor) ? null : "E-mail inválido.";
  }
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 11
    ? null
    : "Telefone inválido — informe o DDD + número (ex: (84) 99999-0000).";
}

export default function DetalheLote({
  lote,
  condominioNome,
  condominioSlug,
}: {
  lote: Lote;
  condominioNome: string;
  condominioSlug: string;
}) {
  const [nome, setNome] = useState("");
  const [contato, setContato] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — campo escondido, nenhum humano preenche
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<"ok" | "erro" | null>(null);
  const [erroContato, setErroContato] = useState<string | null>(null);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  // Instante em que o formulário apareceu — junto com o honeypot, ajuda o
  // backend a distinguir gente de bot (ver backend/app/antispam.py).
  const [carregadoEm] = useState(() => Date.now());

  async function reservar() {
    const problema = validaContato(contato);
    if (problema) {
      setErroContato(problema);
      return;
    }
    setErroContato(null);
    setErroMsg(null);
    setEnviando(true);
    setResultado(null);
    try {
      await api.reservarLote(lote.id, {
        nome: nome || undefined,
        contato: contato.trim(),
        website: website || undefined,
        carregado_em: carregadoEm,
      });
      setResultado("ok");
    } catch (e) {
      setErroMsg(e instanceof Error ? e.message : String(e));
      setResultado("erro");
    } finally {
      setEnviando(false);
    }
  }

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
        <div className="mt-6">
          {resultado === "ok" ? (
            <div className="rounded-lg bg-sage/10 text-sage text-sm p-4 leading-relaxed">
              Pedido de reserva enviado! A imobiliária vai confirmar a disponibilidade e entrar em
              contato com você.
            </div>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-ink mb-3">Reservar este lote</h3>
              <div className="grid gap-3">
                {/* Honeypot: escondido de verdade (não é display:none — alguns bots ignoram
                    isso), fora da ordem de tabulação e sem rótulo lido por leitor de tela. Um
                    humano nunca vê nem preenche; se vier preenchido, é bot (ver antispam.py). */}
                <label
                  aria-hidden="true"
                  className="absolute left-[-9999px] w-px h-px overflow-hidden"
                  tabIndex={-1}
                >
                  Site
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-ink-soft">Nome (opcional)</span>
                  <input
                    className="input"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="ex: Maria Silva"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-ink-soft">Telefone ou e-mail *</span>
                  <input
                    className="input"
                    value={contato}
                    onChange={(e) => {
                      setContato(e.target.value);
                      if (erroContato) setErroContato(null);
                    }}
                    placeholder="ex: (84) 99999-0000"
                    required
                  />
                  {erroContato && <span className="text-rust text-xs">{erroContato}</span>}
                </label>
              </div>
              <button className="btn btn-primary w-full mt-4" disabled={enviando} onClick={reservar}>
                {enviando ? "Enviando..." : "Reservar este lote"}
              </button>
              {resultado === "erro" && (
                <p className="text-rust text-xs mt-2">
                  {erroMsg || "Não foi possível enviar o pedido. Tente novamente."}
                </p>
              )}
              <p className="text-xs text-ink-soft mt-3 leading-relaxed">
                Isso registra um pedido de reserva com a imobiliária — ela confirma a disponibilidade
                antes de formalizar qualquer contrato.
              </p>
            </>
          )}
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
