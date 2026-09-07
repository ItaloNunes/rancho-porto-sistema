import { useState } from "react";
import { api, formatArea, formatMoney } from "../lib/api";
import type { Lote } from "../types";

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

export default function DetalheLote({ lote }: { lote: Lote }) {
  const [nome, setNome] = useState("");
  const [contato, setContato] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<"ok" | "erro" | null>(null);
  const [erroContato, setErroContato] = useState<string | null>(null);
  const [erroMsg, setErroMsg] = useState<string | null>(null);

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
      await api.reservarLote(lote.id, { nome: nome || undefined, contato: contato.trim() });
      setResultado("ok");
    } catch (e) {
      setErroMsg(e instanceof Error ? e.message : String(e));
      setResultado("erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="p-6 sm:p-7">
      <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Quadra {lote.quadra}</p>
      <div className="flex items-center gap-3 mt-1">
        <h2 id="lote-modal-title" className="text-2xl font-bold text-ink tracking-tight">
          {lote.identificador}
        </h2>
        <span className={`badge badge-${lote.status}`}>{STATUS_LABEL[lote.status]}</span>
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
