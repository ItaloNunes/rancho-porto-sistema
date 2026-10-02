import { useEffect, useState } from "react";
import { Field } from "./qualificacaoCampos";
import {
  MAX_PARCELAS_ENTRADA,
  MEIOS_PAGAMENTO,
  dividirEmParcelas,
  fmtBRL,
  fmtData,
  fmtDataExtenso,
  lerData,
  lerPlano,
  lerValor,
  textoMeio,
  tolerancia,
  valorPorExtenso,
} from "../lib/pagamento";
import type { FormaPagamentoDados, LoteComCondominio, MeioPagamento } from "../types";

/** Qualquer mudança nos valores derruba as confirmações da revisão — o
 * corretor tem que conferir de novo o que mudou (dupla confirmação). */
function semConfirmacao(fp: FormaPagamentoDados): FormaPagamentoDados {
  return { ...fp, confirmado: false, confirma_valor_fora_tabela: false };
}

/** Plano de tabela do lote (entrada + parcelas + chave), já formatado. A
 * chave fecha a conta no centavo (o plano de tabela de alguns lotes tem
 * centavos de arredondamento: entrada + parcelas + entrega ≠ total). */
export function planoDeTabela(lote: LoteComCondominio, fp: FormaPagamentoDados): FormaPagamentoDados {
  let chave = lote.entrega ?? null;
  if (lote.valor_total != null && lote.entrada != null && lote.qtd_parcelas != null && lote.parcela_mensal != null) {
    const resto = Math.round((lote.valor_total - lote.entrada - lote.qtd_parcelas * lote.parcela_mensal) * 100) / 100;
    if (resto >= 0 && (chave == null || Math.abs(resto - chave) <= 1)) chave = resto;
  }
  return semConfirmacao({
    ...fp,
    valor_proposto: lote.valor_total ?? fp.valor_proposto ?? null,
    sinal: lote.entrada != null ? fmtBRL(lote.entrada) : fp.sinal ?? null,
    dividido_em_parcelas: lote.qtd_parcelas ?? fp.dividido_em_parcelas ?? null,
    valor_parcela: lote.parcela_mensal != null ? fmtBRL(lote.parcela_mensal) : fp.valor_parcela ?? null,
    chave_valor: chave != null ? fmtBRL(chave) : fp.chave_valor ?? null,
  });
}

/** Campo de dinheiro: aceita "8999", "8.999", "8.999,00"; ao sair do campo
 * vira "8.999,00", e mostra o valor por extenso embaixo pra pegar dígito a
 * mais/a menos na hora (ex.: 89,99 x 89.990,00). */
export function CampoDinheiro({
  id,
  label,
  valor,
  onChange,
  ajuda,
}: {
  id: string;
  label: string;
  valor: string | null | undefined;
  onChange: (v: string) => void;
  ajuda?: string;
}) {
  const n = lerValor(valor ?? "");
  const invalido = !!valor && n === null;
  return (
    <Field label={label}>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">R$</span>
        <input
          id={id}
          className={`input !pl-9 tabular-nums ${invalido ? "!border-rust" : ""}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={valor ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (n !== null) onChange(fmtBRL(n));
          }}
        />
      </div>
      {invalido ? (
        <span className="text-[11px] text-rust">Valor inválido — use só números (ex.: 8.999,00).</span>
      ) : n !== null && n > 0 ? (
        <span className="text-[11px] text-ink-soft">{valorPorExtenso(n)}</span>
      ) : ajuda ? (
        <span className="text-[11px] text-ink-soft">{ajuda}</span>
      ) : null}
    </Field>
  );
}

function CampoData({
  id,
  label,
  valor,
  onChange,
  ajuda,
}: {
  id: string;
  label: string;
  valor: string | null | undefined;
  onChange: (v: string | null) => void;
  ajuda?: string;
}) {
  const invalido = !!valor && !lerData(valor);
  return (
    <Field label={label}>
      <input
        id={id}
        type="date"
        min="2020-01-01"
        max="2100-12-31"
        className={`input ${invalido ? "!border-rust" : ""}`}
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {invalido ? (
        <span className="text-[11px] text-rust">Data inválida — confira dia, mês e ano.</span>
      ) : valor ? (
        <span className="text-[11px] text-ink-soft">
          {fmtDataExtenso(valor)}
          {ajuda ? ` — ${ajuda}` : ""}
        </span>
      ) : ajuda ? (
        <span className="text-[11px] text-ink-soft">{ajuda}</span>
      ) : null}
    </Field>
  );
}

function SeletorMeio({
  id,
  label,
  valor,
  onChange,
}: {
  id: string;
  label: string;
  valor: MeioPagamento | null | undefined;
  onChange: (v: MeioPagamento | null) => void;
}) {
  return (
    <Field label={label}>
      <select id={id} className="input" value={valor ?? ""} onChange={(e) => onChange((e.target.value || null) as MeioPagamento | null)}>
        <option value="">Selecione...</option>
        {MEIOS_PAGAMENTO.map((m) => (
          <option key={m.valor} value={m.valor}>
            {m.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Opcoes<T extends string | boolean>({
  opcoes,
  valor,
  onChange,
}: {
  opcoes: { valor: T; label: string }[];
  valor: T | null | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {opcoes.map((o) => (
        <button
          key={String(o.valor)}
          type="button"
          className={`btn flex-1 !py-2 !text-sm ${valor === o.valor ? "btn-primary" : "btn-outline"}`}
          onClick={() => onChange(o.valor)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Bloco({ titulo, children, destaque }: { titulo: string; children: React.ReactNode; destaque?: boolean }) {
  return (
    <section className={`rounded-lg border p-3 sm:p-4 grid gap-3 ${destaque ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <h3 className="text-sm font-bold text-ink">{titulo}</h3>
      {children}
    </section>
  );
}

/** Quadro "a conta fecha?" — mostrado na etapa de pagamento e na revisão. */
export function ConferenciaPlano({
  fp,
  valorTabela,
  onAjustarCentavos,
}: {
  fp: FormaPagamentoDados;
  valorTabela?: number | null;
  /** Diferença de até R$ 1,00 (arredondamento): oferece fechar no centavo. */
  onAjustarCentavos?: (fp: FormaPagamentoDados) => void;
}) {
  const p = lerPlano(fp);
  const vp = p.valorProposto;
  if (!vp) return null;
  if (fp.a_vista) {
    return (
      <div className="rounded-lg border border-sage/40 bg-sage/10 p-3 text-sm">
        <p className="font-semibold text-ink">À vista: R$ {fmtBRL(vp)}</p>
        <p className="text-xs text-ink-soft">{valorPorExtenso(vp)}</p>
        <p className="text-xs text-ink-soft mt-1">
          Via {textoMeio(fp.avista_meio)} em {fmtData(fp.avista_data)}
        </p>
      </div>
    );
  }
  if (fp.a_vista !== false) return null;
  const diff = p.total - vp;
  const fecha = Math.abs(diff) <= tolerancia(p);
  const linhas: [string, string][] = [
    [
      p.entradaParcelas > 1
        ? `Entrada (${p.entradaParcelas}x de R$ ${fmtBRL(p.entradaValores[0])})`
        : "Entrada (pagamento único)",
      fmtBRL(p.entrada ?? 0),
    ],
    [`Parcelas mensais (${p.parcelas ?? 0} x R$ ${fmtBRL(p.parcelaValor ?? 0)})`, fmtBRL((p.parcelas ?? 0) * (p.parcelaValor ?? 0))],
    ["Chave (entrega das chaves)", fmtBRL(p.chave)],
  ];
  return (
    <div className={`rounded-lg border p-3 text-sm ${fecha ? "border-sage/40 bg-sage/10" : "border-rust/40 bg-rust/5"}`}>
      <table className="w-full tabular-nums">
        <tbody>
          {linhas.map(([rot, v]) => (
            <tr key={rot}>
              <td className="py-0.5 text-ink-soft">{rot}</td>
              <td className="py-0.5 text-right text-ink">R$ {v}</td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="pt-1 font-semibold text-ink">Total (entrada + parcelas + chave)</td>
            <td className="pt-1 text-right font-semibold text-ink">R$ {fmtBRL(p.total)}</td>
          </tr>
          <tr>
            <td className="font-semibold text-ink">Valor proposto</td>
            <td className="text-right font-semibold text-ink">R$ {fmtBRL(vp)}</td>
          </tr>
        </tbody>
      </table>
      <p className={`mt-2 text-xs font-semibold ${fecha ? "text-sage" : "text-rust"}`}>
        {fecha
          ? "✓ A conta fecha: entrada + parcelas + chave = valor proposto."
          : `✗ A conta não fecha: diferença de R$ ${fmtBRL(Math.abs(diff))} (${diff > 0 ? "sobrando" : "faltando"}). Ajuste a entrada, as parcelas ou a chave.`}
      </p>
      {!fecha && onAjustarCentavos && Math.abs(diff) <= 1 && (
        <button
          type="button"
          className="btn-row btn-row-primary mt-2"
          onClick={() => {
            // a diferença de centavos vai pra chave (ou pra entrada, se não houver chave)
            if (p.chave > 0) onAjustarCentavos({ ...fp, chave_valor: fmtBRL(Math.round((p.chave - diff) * 100) / 100) });
            else onAjustarCentavos({ ...fp, sinal: fmtBRL(Math.round(((p.entrada ?? 0) - diff) * 100) / 100) });
          }}
        >
          ajustar os R$ {fmtBRL(Math.abs(diff))} de arredondamento {p.chave > 0 ? "na chave" : "na entrada"}
        </button>
      )}
      {valorTabela != null && Math.abs(vp - valorTabela) > 1 && (
        <p className="mt-1 text-xs text-amber-700">
          Valor proposto {vp < valorTabela ? "abaixo" : "acima"} da tabela (R$ {fmtBRL(valorTabela)}) em{" "}
          {Math.abs(((vp - valorTabela) / valorTabela) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%.
        </p>
      )}
    </div>
  );
}

/** Etapa "Forma de pagamento" do formulário da proposta. */
export default function FormaPagamentoEtapa({
  fp,
  onChange,
  lote,
}: {
  fp: FormaPagamentoDados;
  onChange: (fp: FormaPagamentoDados) => void;
  lote: LoteComCondominio | null;
}) {
  const set = (parcial: Partial<FormaPagamentoDados>) => onChange(semConfirmacao({ ...fp, ...parcial }));
  const [valorPropostoTxt, setValorPropostoTxt] = useState(fp.valor_proposto != null ? fmtBRL(fp.valor_proposto) : "");

  // Primeira vez nesta etapa: já traz o plano de tabela do lote preenchido
  // (o corretor só ajusta o que foi negociado).
  useEffect(() => {
    if (lote && fp.valor_proposto == null && !fp.sinal && fp.dividido_em_parcelas == null) {
      const novo = planoDeTabela(lote, fp);
      onChange(novo);
      setValorPropostoTxt(novo.valor_proposto != null ? fmtBRL(novo.valor_proposto) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lote?.id]);

  const entrada = lerValor(fp.sinal);
  const nEnt = Number(fp.sinal_parcelas);
  const valoresEntrada =
    fp.sinal_forma === "parcelada" && entrada && Number.isInteger(nEnt) && nEnt >= 2 ? dividirEmParcelas(entrada, nEnt) : [];
  const diaVenc = lerData(fp.primeiro_mes)?.getDate();

  return (
    <div className="grid gap-4">
      <Bloco titulo="Valor">
        {lote?.valor_total != null && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink-soft">
              Valor de tabela do lote: <strong className="text-ink">R$ {fmtBRL(lote.valor_total)}</strong>
            </span>
            <button
              type="button"
              className="btn-row btn-row-neutral"
              onClick={() => {
                const novo = planoDeTabela(lote, fp);
                onChange(novo);
                setValorPropostoTxt(novo.valor_proposto != null ? fmtBRL(novo.valor_proposto) : "");
              }}
            >
              usar o plano de tabela
            </button>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3 items-start">
          <CampoDinheiro
            id="fp-valor-proposto"
            label="Valor proposto *"
            valor={valorPropostoTxt}
            onChange={(v) => {
              setValorPropostoTxt(v);
              set({ valor_proposto: lerValor(v) });
            }}
          />
          <CampoDinheiro id="fp-renda" label="Renda informada do cliente *" valor={fp.renda} onChange={(v) => set({ renda: v })} />
        </div>
      </Bloco>

      <Field label="Modalidade *">
        <Opcoes<boolean>
          opcoes={[
            { valor: false, label: "Parcelado (entrada + parcelas)" },
            { valor: true, label: "À vista" },
          ]}
          valor={fp.a_vista}
          onChange={(v) => set({ a_vista: v })}
        />
      </Field>

      {fp.a_vista === true && (
        <Bloco titulo="Pagamento à vista" destaque>
          <div className="grid sm:grid-cols-2 gap-3 items-start">
            <SeletorMeio id="fp-avista-meio" label="Como será pago? *" valor={fp.avista_meio} onChange={(v) => set({ avista_meio: v })} />
            <CampoData id="fp-avista-data" label="Data do pagamento *" valor={fp.avista_data} onChange={(v) => set({ avista_data: v })} />
          </div>
        </Bloco>
      )}

      {fp.a_vista === false && (
        <>
          <Bloco titulo="1. Entrada (sinal / arras) — obrigatória" destaque>
            <CampoDinheiro id="fp-entrada" label="Valor da entrada *" valor={fp.sinal} onChange={(v) => set({ sinal: v })} />
            <Field label="Como a entrada será paga? *">
              <Opcoes<"unica" | "parcelada">
                opcoes={[
                  { valor: "unica", label: "De uma vez" },
                  { valor: "parcelada", label: "Parcelada" },
                ]}
                valor={fp.sinal_forma}
                onChange={(v) => set({ sinal_forma: v, sinal_parcelas: v === "unica" ? 1 : fp.sinal_parcelas && fp.sinal_parcelas > 1 ? fp.sinal_parcelas : 2 })}
              />
            </Field>
            {fp.sinal_forma === "parcelada" && (
              <Field label={`Em quantas vezes? * (2 a ${MAX_PARCELAS_ENTRADA})`}>
                <input
                  id="fp-entrada-parcelas"
                  className="input"
                  type="number"
                  min={2}
                  max={MAX_PARCELAS_ENTRADA}
                  value={fp.sinal_parcelas ?? ""}
                  onChange={(e) => set({ sinal_parcelas: e.target.value ? Number(e.target.value) : null })}
                />
                {valoresEntrada.length > 0 && (
                  <span className="text-[11px] text-ink-soft">
                    {new Set(valoresEntrada).size === 1
                      ? `${valoresEntrada.length}x de R$ ${fmtBRL(valoresEntrada[0])}`
                      : `${valoresEntrada.filter((v) => v === valoresEntrada[0]).length}x de R$ ${fmtBRL(valoresEntrada[0])} e ${
                          valoresEntrada.filter((v) => v !== valoresEntrada[0]).length
                        }x de R$ ${fmtBRL(valoresEntrada[valoresEntrada.length - 1])}`}
                    , uma por mês
                  </span>
                )}
              </Field>
            )}
            <div className="grid sm:grid-cols-2 gap-3 items-start">
              <SeletorMeio id="fp-entrada-meio" label="Forma de pagamento da entrada *" valor={fp.sinal_meio} onChange={(v) => set({ sinal_meio: v })} />
              <CampoData
                id="fp-entrada-data"
                label={fp.sinal_forma === "parcelada" ? "Vencimento da 1ª parcela da entrada *" : "Data de pagamento da entrada *"}
                valor={fp.sinal_vencimento}
                onChange={(v) => set({ sinal_vencimento: v })}
              />
            </div>
            {(fp.sinal_meio === "transferencia" || fp.sinal_meio === "cheque") && (
              <div className="grid grid-cols-2 gap-3 items-start">
                <Field label="Banco">
                  <input className="input" value={fp.sinal_banco ?? ""} onChange={(e) => set({ sinal_banco: e.target.value })} />
                </Field>
                <Field label={fp.sinal_meio === "cheque" ? "Nº do cheque" : "Agência"}>
                  <input
                    className="input"
                    value={(fp.sinal_meio === "cheque" ? fp.sinal_cheque_numero : fp.sinal_agencia) ?? ""}
                    onChange={(e) =>
                      set(fp.sinal_meio === "cheque" ? { sinal_cheque_numero: e.target.value } : { sinal_agencia: e.target.value })
                    }
                  />
                </Field>
              </div>
            )}
          </Bloco>

          <Bloco titulo="2. Parcelas mensais">
            <div className="grid sm:grid-cols-2 gap-3 items-start">
              <Field label="Quantidade de parcelas *">
                <input
                  id="fp-parcelas"
                  className="input"
                  type="number"
                  min={1}
                  value={fp.dividido_em_parcelas ?? ""}
                  onChange={(e) => set({ dividido_em_parcelas: e.target.value ? Number(e.target.value) : null })}
                />
              </Field>
              <CampoDinheiro id="fp-parcela-valor" label="Valor de cada parcela *" valor={fp.valor_parcela} onChange={(v) => set({ valor_parcela: v })} />
            </div>
            <CampoData
              id="fp-primeira-parcela"
              label="Vencimento da 1ª parcela mensal *"
              valor={fp.primeiro_mes}
              onChange={(v) => set({ primeiro_mes: v, vencimento: v ? String(lerData(v)?.getDate() ?? "") : null })}
              ajuda={diaVenc ? `As demais vencem todo dia ${diaVenc}.` : undefined}
            />
          </Bloco>

          <Bloco titulo="3. Chave (paga na entrega das chaves)">
            <div className="grid sm:grid-cols-2 gap-3 items-start">
              <CampoDinheiro
                id="fp-chave"
                label="Valor da chave"
                valor={fp.chave_valor}
                onChange={(v) => set({ chave_valor: v })}
                ajuda="Deixe 0,00 se não houver."
              />
              <CampoData
                id="fp-chave-data"
                label="Pagar até (opcional)"
                valor={fp.chave_vencimento}
                onChange={(v) => set({ chave_vencimento: v })}
              />
            </div>
          </Bloco>
        </>
      )}

      <ConferenciaPlano fp={fp} valorTabela={lote?.valor_total} onAjustarCentavos={(novo) => onChange(semConfirmacao(novo))} />

      <Field label="Observações">
        <textarea className="input" rows={3} value={fp.observacoes ?? ""} onChange={(e) => onChange({ ...fp, observacoes: e.target.value })} />
      </Field>
    </div>
  );
}
