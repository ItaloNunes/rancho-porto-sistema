import { useEffect, useState } from "react";
import { Field } from "./qualificacaoCampos";
import {
  MAX_BALOES,
  MAX_PARCELAS_ENTRADA,
  MEIOS_PAGAMENTO,
  dividirEmParcelas,
  abatimentoNoPreco,
  entradaLiquida,
  fmtBRL,
  fmtData,
  fmtDataExtenso,
  lerData,
  lerPlano,
  lerValor,
  textoCurtoParcelas,
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
  if (temBaloesNaTabela(lote)) {
    // Casas do Veneza (29/10): entrada + parcelas + balões anuais + saldo por
    // financiamento bancário. O financiamento é o que sobra, no centavo.
    const qtd = lote.qtd_baloes ?? 0;
    const balao = lote.valor_balao ?? 0;
    const fin =
      lote.valor_total != null
        ? Math.round(
            (lote.valor_total - (lote.entrada ?? 0) - (lote.qtd_parcelas ?? 0) * (lote.parcela_mensal ?? 0) - qtd * balao) * 100,
          ) / 100
        : lote.financiamento ?? null;
    return semConfirmacao({
      ...fp,
      valor_proposto: lote.valor_total ?? fp.valor_proposto ?? null,
      sinal: lote.entrada != null ? fmtBRL(lote.entrada) : fp.sinal ?? null,
      dividido_em_parcelas: lote.qtd_parcelas ?? fp.dividido_em_parcelas ?? null,
      valor_parcela: lote.parcela_mensal != null ? fmtBRL(lote.parcela_mensal) : fp.valor_parcela ?? null,
      balao_qtd: qtd || null,
      balao_valor: qtd ? fmtBRL(balao) : null,
      financiamento_valor: fin != null && fin > 0 ? fmtBRL(fin) : null,
      chave_valor: null,
      chave_vencimento: null,
    });
  }
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
    balao_qtd: null,
    balao_valor: null,
    financiamento_valor: null,
  });
}

/** O plano de tabela do lote tem balões / financiamento (casas do Veneza). */
export function temBaloesNaTabela(lote: LoteComCondominio | null | undefined): boolean {
  return !!lote && (!!lote.qtd_baloes || !!lote.financiamento);
}

/** Campo de dinheiro: aceita "8999", "8.999", "8.999,00"; ao sair do campo
 * vira "8.999,00", e mostra o valor por extenso embaixo pra pegar dígito a
 * mais/a menos na hora (ex.: 89,99 x 89.990,00). */
/** Parcelas da entrada digitadas à mão + mudou a entrada ou o desconto:
 * a última parcela vira "o que falta" pra continuar fechando (17/11 -- o
 * financeiro pôs R$ 178,06 de desconto e as parcelas ficaram somando o
 * valor antigo). Se não der (faltaria valor negativo), deixa como está e a
 * tela mostra a diferença. */
function comUltimaParcelaAjustada(fp: FormaPagamentoDados): FormaPagamentoDados {
  const lista = fp.sinal_valores;
  if (!lista || lista.length < 2 || (fp.sinal_forma !== "parcelada" && fp.sinal_forma !== "mista")) return fp;
  const liq = entradaLiquida(fp);
  const av = lerValor(fp.sinal_avista ?? "");
  const alvo = fp.sinal_forma === "parcelada" ? liq : liq && av ? liq - av : null;
  if (!alvo) return fp;
  const outras = lista.slice(0, -1).reduce<number>((t, v) => t + (lerValor(v ?? "") ?? 0), 0);
  const ultima = Math.round((alvo - outras) * 100) / 100;
  return ultima > 0 ? { ...fp, sinal_valores: [...lista.slice(0, -1), fmtBRL(ultima)] } : fp;
}

/** Valor de cada parcela da entrada: partes iguais (padrão) ou digitado à
 * mão, uma por uma (16/11 -- ex.: 2x de 4.000,00 e 1x de 3.670,00). */
function ParcelasEntrada({
  total,
  n,
  valores,
  onChange,
}: {
  total: number | null;
  n: number;
  valores: (string | null)[] | null | undefined;
  onChange: (v: (string | null)[] | null) => void;
}) {
  if (!total || !Number.isInteger(n) || n < 1) return null;
  const iguais = dividirEmParcelas(total, n);
  const editando = !!valores && valores.length > 0;
  if (!editando) {
    return (
      <div className="grid gap-1.5">
        <span className="text-[11px] text-ink-soft">{textoCurtoParcelas(iguais)}, uma por mês</span>
        {n > 1 && (
          <button
            type="button"
            id="fp-entrada-editar-parcelas"
            className="btn-row btn-row-neutral justify-self-start"
            onClick={() => onChange(iguais.map(fmtBRL))}
          >
            editar o valor de cada parcela
          </button>
        )}
      </div>
    );
  }
  const lista = Array.from({ length: n }, (_, i) => valores?.[i] ?? "");
  const nums = lista.map((v) => lerValor(v ?? ""));
  const soma = Math.round(nums.reduce<number>((t, v) => t + (v ?? 0), 0) * 100) / 100;
  const dif = Math.round((total - soma) * 100) / 100;
  const somaOutras = Math.round(nums.slice(0, -1).reduce<number>((t, v) => t + (v ?? 0), 0) * 100) / 100;
  const ultimaPeloQueFalta = Math.round((total - somaOutras) * 100) / 100;
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {lista.map((v, i) => (
          <CampoDinheiro
            key={i}
            id={`fp-entrada-parcela-${i + 1}`}
            label={`${i + 1}ª parcela`}
            valor={v}
            onChange={(novo) => onChange(lista.map((x, j) => (j === i ? novo : x)))}
          />
        ))}
      </div>
      <p className={`text-xs ${Math.abs(dif) <= 0.005 ? "text-ink-soft" : "text-rust font-semibold"}`}>
        Soma: R$ {fmtBRL(soma)} de R$ {fmtBRL(total)}
        {Math.abs(dif) > 0.005 && (dif > 0 ? ` — faltam R$ ${fmtBRL(dif)}` : ` — passou R$ ${fmtBRL(-dif)}`)}
      </p>
      <div className="flex flex-wrap gap-2">
        {n > 1 && Math.abs(dif) > 0.005 && ultimaPeloQueFalta > 0 && (
          <button
            type="button"
            className="btn-row btn-row-neutral"
            onClick={() => onChange(lista.map((x, j) => (j === n - 1 ? fmtBRL(ultimaPeloQueFalta) : x)))}
          >
            última parcela = R$ {fmtBRL(ultimaPeloQueFalta)} (o que falta)
          </button>
        )}
        <button type="button" className="btn-row btn-row-neutral" onClick={() => onChange(null)}>
          voltar para parcelas iguais
        </button>
      </div>
    </div>
  );
}

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
  // com desconto na entrada, o lote sai por (valor proposto - desconto)
  // só mostra/abate quando o valor proposto foi digitado cheio; se já veio
  // com o desconto, não desconta de novo
  const dscEnt = abatimentoNoPreco(fp, p.total, vp);
  const alvo = Math.round((vp - dscEnt) * 100) / 100;
  const diff = p.total - alvo;
  const fecha = Math.abs(diff) <= tolerancia(p);
  const comBaloes = !!(p.balaoQtd || p.balaoValor || p.financiamento);
  const linhas: [string, string][] = [
    [
      fp.sinal_forma === "mista" && p.saldoValores.length
        ? `Entrada (R$ ${fmtBRL(lerValor(fp.sinal_avista) ?? 0)} à vista + ${textoCurtoParcelas(p.saldoValores)})`
        : p.entradaParcelas > 1
          ? `Entrada (${textoCurtoParcelas(p.entradaValores)})`
          : "Entrada (pagamento único)",
      fmtBRL(p.entrada ?? 0),
    ],
    [`Parcelas mensais (${p.parcelas ?? 0} x R$ ${fmtBRL(p.parcelaValor ?? 0)})`, fmtBRL((p.parcelas ?? 0) * (p.parcelaValor ?? 0))],
  ];
  if (comBaloes) {
    linhas.push([`Balões (${p.balaoQtd ?? 0} x R$ ${fmtBRL(p.balaoValor ?? 0)})`, fmtBRL((p.balaoQtd ?? 0) * (p.balaoValor ?? 0))]);
    linhas.push(["Financiamento bancário", fmtBRL(p.financiamento)]);
  }
  if (!comBaloes || p.chave) linhas.push(["Chave (entrega das chaves)", fmtBRL(p.chave)]);
  const partes = comBaloes ? (p.chave ? "entrada + parcelas + balões + financiamento + chave" : "entrada + parcelas + balões + financiamento") : "entrada + parcelas + chave";
  const ajusteEm: "chave" | "financiamento" | "entrada" = p.chave > 0 ? "chave" : p.financiamento > 0 ? "financiamento" : "entrada";
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
            <td className="pt-1 font-semibold text-ink">Total ({partes})</td>
            <td className="pt-1 text-right font-semibold text-ink">R$ {fmtBRL(p.total)}</td>
          </tr>
          <tr>
            <td className={dscEnt ? "text-ink-soft" : "font-semibold text-ink"}>Valor proposto</td>
            <td className={`text-right ${dscEnt ? "text-ink-soft" : "font-semibold text-ink"}`}>R$ {fmtBRL(vp)}</td>
          </tr>
          {dscEnt > 0 && (
            <>
              <tr>
                <td className="text-ink-soft">Desconto na entrada</td>
                <td className="text-right text-ink-soft">− R$ {fmtBRL(dscEnt)}</td>
              </tr>
              <tr>
                <td className="font-semibold text-ink">Valor do lote no contrato</td>
                <td className="text-right font-semibold text-ink">R$ {fmtBRL(alvo)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <p className={`mt-2 text-xs font-semibold ${fecha ? "text-sage" : "text-rust"}`}>
        {fecha
          ? `✓ A conta fecha: ${partes} = ${dscEnt ? "valor do lote no contrato" : "valor proposto"}.`
          : `✗ A conta não fecha: diferença de R$ ${fmtBRL(Math.abs(diff))} (${diff > 0 ? "sobrando" : "faltando"}). Ajuste ${comBaloes ? "a entrada, as parcelas, os balões ou o financiamento" : "a entrada, as parcelas ou a chave"}.`}
      </p>
      {!fecha && onAjustarCentavos && Math.abs(diff) <= 1 && (
        <button
          type="button"
          className="btn-row btn-row-primary mt-2"
          onClick={() => {
            // a diferença de centavos vai pra chave (ou pro financiamento, ou pra entrada)
            if (ajusteEm === "chave") onAjustarCentavos({ ...fp, chave_valor: fmtBRL(Math.round((p.chave - diff) * 100) / 100) });
            else if (ajusteEm === "financiamento")
              onAjustarCentavos({ ...fp, financiamento_valor: fmtBRL(Math.round((p.financiamento - diff) * 100) / 100) });
            else onAjustarCentavos({ ...fp, sinal: fmtBRL(Math.round(((p.entrada ?? 0) - diff) * 100) / 100) });
          }}
        >
          ajustar os R$ {fmtBRL(Math.abs(diff))} de arredondamento {ajusteEm === "chave" ? "na chave" : ajusteEm === "financiamento" ? "no financiamento" : "na entrada"}
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

  // entrada que o cliente paga (já sem o desconto na entrada, se houver)
  const entrada = entradaLiquida(fp);
  const nEnt = Number(fp.sinal_parcelas);
  const valoresEntrada =
    fp.sinal_forma === "parcelada" && entrada && Number.isInteger(nEnt) && nEnt >= 2 ? dividirEmParcelas(entrada, nEnt) : [];
  // Modo "mista": parte à vista + saldo parcelado. O saldo (entrada - à vista)
  // é dividido em nEnt parcelas, calculado ao vivo pra mostrar o valor de cada.
  const avistaVal = lerValor(fp.sinal_avista);
  const valoresSaldo =
    fp.sinal_forma === "mista" && entrada && avistaVal != null && avistaVal > 0 && avistaVal < entrada && Number.isInteger(nEnt) && nEnt >= 1
      ? dividirEmParcelas(entrada - avistaVal, nEnt)
      : [];
  const diaVenc = lerData(fp.primeiro_mes)?.getDate();
  // Mudou a quantidade de parcelas da entrada: se estava editando os
  // valores à mão, recomeça com partes iguais na nova quantidade.
  const trocarQtdEntrada = (n: number | null, totalParcelado: number | null) => {
    const editando = !!fp.sinal_valores && fp.sinal_valores.length > 0;
    set({
      sinal_parcelas: n,
      sinal_valores: editando && n && n >= 1 && totalParcelado ? dividirEmParcelas(totalParcelado, n).map(fmtBRL) : null,
    });
  };
  // Casas do Veneza: balões + financiamento no lugar da chave (o contrato
  // do Veneza não tem chave). Aparece também se a proposta já tiver balões.
  const comBaloes = temBaloesNaTabela(lote) || !!fp.balao_qtd || !!fp.balao_valor || !!fp.financiamento_valor;
  const chaveAtual = lerValor(fp.chave_valor) ?? 0;

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
            <CampoDinheiro id="fp-entrada" label="Valor da entrada *" valor={fp.sinal} onChange={(v) => set(comUltimaParcelaAjustada({ ...fp, sinal: v }))} />
            <div id="fp-bloco-desconto-entrada" className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 grid gap-2">
              <p className="text-sm font-bold text-ink">💲 Desconto na entrada (opcional)</p>
              <CampoDinheiro
                id="fp-desconto-entrada"
                label="Quanto de desconto o cliente tem na entrada?"
                valor={fp.desconto_entrada_valor}
                onChange={(v) => set(comUltimaParcelaAjustada({ ...fp, desconto_entrada_valor: v }))}
                ajuda="Deixe em branco se não houver. Parcelas e chave ficam iguais; o cliente paga a entrada menos esse valor."
              />
              {lerValor(fp.desconto_entrada_valor ?? "") && lerValor(fp.sinal) && entrada !== lerValor(fp.sinal) ? (
                <p id="fp-entrada-liquida" className="text-sm text-ink">
                  O cliente paga de entrada <strong>R$ {fmtBRL(entrada ?? 0)}</strong> (R$ {fmtBRL(lerValor(fp.sinal) ?? 0)} −
                  desconto R$ {fmtBRL(lerValor(fp.desconto_entrada_valor ?? "") ?? 0)}). É esse valor que vai no contrato e nas
                  parcelas da entrada.
                </p>
              ) : null}
            </div>
            <Field label="Como a entrada será paga? *">
              <Opcoes<"unica" | "parcelada" | "mista">
                opcoes={[
                  { valor: "unica", label: "De uma vez" },
                  { valor: "parcelada", label: "Parcelada" },
                  { valor: "mista", label: "Parte à vista + parcelar o resto" },
                ]}
                valor={fp.sinal_forma}
                onChange={(v) =>
                  set({
                    sinal_forma: v,
                    sinal_valores: null,
                    sinal_parcelas:
                      v === "unica"
                        ? 1
                        : v === "mista"
                          ? (fp.sinal_parcelas ?? 1)
                          : fp.sinal_parcelas && fp.sinal_parcelas > 1
                            ? fp.sinal_parcelas
                            : 2,
                  })
                }
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
                  onChange={(e) => trocarQtdEntrada(e.target.value ? Number(e.target.value) : null, entrada)}
                />
              </Field>
            )}
            {fp.sinal_forma === "parcelada" && valoresEntrada.length > 0 && (
              <ParcelasEntrada total={entrada} n={nEnt} valores={fp.sinal_valores} onChange={(v) => set({ sinal_valores: v })} />
            )}
            {fp.sinal_forma === "mista" && (
              <div className="grid gap-3">
                <CampoDinheiro
                  id="fp-entrada-avista"
                  label="Quanto paga à vista agora? *"
                  valor={fp.sinal_avista}
                  onChange={(v) => set({ sinal_avista: v })}
                />
                <Field label={`Parcelar o restante em quantas vezes? * (1 a ${MAX_PARCELAS_ENTRADA})`}>
                  <input
                    id="fp-entrada-saldo-parcelas"
                    className="input"
                    type="number"
                    min={1}
                    max={MAX_PARCELAS_ENTRADA}
                    value={fp.sinal_parcelas ?? ""}
                    onChange={(e) =>
                      trocarQtdEntrada(
                        e.target.value ? Number(e.target.value) : null,
                        entrada && avistaVal != null ? Math.round((entrada - avistaVal) * 100) / 100 : null,
                      )
                    }
                  />
                  {valoresSaldo.length > 0 && entrada && avistaVal != null && (
                    <span className="text-[11px] text-ink-soft">Saldo de R$ {fmtBRL(entrada - avistaVal)}</span>
                  )}
                </Field>
                {valoresSaldo.length > 0 && entrada && avistaVal != null && (
                  <ParcelasEntrada
                    total={Math.round((entrada - avistaVal) * 100) / 100}
                    n={nEnt}
                    valores={fp.sinal_valores}
                    onChange={(v) => set({ sinal_valores: v })}
                  />
                )}
                <CampoData
                  id="fp-entrada-saldo-data"
                  label="Vencimento da 1ª parcela do saldo *"
                  valor={fp.sinal_resto_primeira}
                  onChange={(v) => set({ sinal_resto_primeira: v })}
                />
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3 items-start">
              <SeletorMeio id="fp-entrada-meio" label="Forma de pagamento da entrada *" valor={fp.sinal_meio} onChange={(v) => set({ sinal_meio: v })} />
              <CampoData
                id="fp-entrada-data"
                label={
                  fp.sinal_forma === "parcelada"
                    ? "Vencimento da 1ª parcela da entrada *"
                    : fp.sinal_forma === "mista"
                      ? "Data do pagamento à vista *"
                      : "Data de pagamento da entrada *"
                }
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

          {comBaloes && (
            <>
              <Bloco titulo="3. Balões anuais">
                <div className="grid sm:grid-cols-2 gap-3 items-start">
                  <Field label="Quantidade de balões">
                    <input
                      id="fp-baloes"
                      className="input"
                      type="number"
                      min={0}
                      max={MAX_BALOES}
                      value={fp.balao_qtd ?? ""}
                      onChange={(e) => set({ balao_qtd: e.target.value ? Number(e.target.value) : null })}
                    />
                    <span className="text-[11px] text-ink-soft">Um por ano; no mês do balão também vence a parcela.</span>
                  </Field>
                  <CampoDinheiro id="fp-balao-valor" label="Valor de cada balão" valor={fp.balao_valor} onChange={(v) => set({ balao_valor: v })} />
                </div>
              </Bloco>
              <Bloco titulo="4. Financiamento bancário (saldo)">
                <div className="grid sm:grid-cols-2 gap-3 items-start">
                  <CampoDinheiro
                    id="fp-financiamento"
                    label="Valor financiado"
                    valor={fp.financiamento_valor}
                    onChange={(v) => set({ financiamento_valor: v })}
                    ajuda="Saldo pago pelo banco (Caixa). Deixe 0,00 se não houver."
                  />
                </div>
              </Bloco>
            </>
          )}

          {(!comBaloes || chaveAtual > 0) && (
          <Bloco titulo={`${comBaloes ? "5" : "3"}. Chave (paga na entrega das chaves)`}>
            {/* Sem campo de data (09/10): a chave é paga na entrega das
                chaves, que não tem dia certo -- o contrato não traz data. */}
            <div className="grid sm:grid-cols-2 gap-3 items-start">
              <CampoDinheiro
                id="fp-chave"
                label="Valor da chave"
                valor={fp.chave_valor}
                onChange={(v) => set({ chave_valor: v, chave_vencimento: null })}
                ajuda="Paga na entrega das chaves, sem data. Deixe 0,00 se não houver."
              />
            </div>
          </Bloco>
          )}
        </>
      )}

      <Bloco titulo="Desconto do corretor (opcional)">
        <CampoDinheiro
          id="fp-desconto-corretor"
          label="Desconto do corretor — sai da comissão dele"
          valor={fp.desconto_corretor_valor}
          onChange={(v) => set({ desconto_corretor_valor: v })}
          ajuda="Deixe em branco se não houver. Sai só da comissão do corretor — o preço do lote no contrato continua o valor proposto."
        />
      </Bloco>

      <ConferenciaPlano fp={fp} valorTabela={lote?.valor_total} onAjustarCentavos={(novo) => onChange(semConfirmacao(novo))} />

      <Field label="Observações">
        <textarea className="input" rows={3} value={fp.observacoes ?? ""} onChange={(e) => onChange({ ...fp, observacoes: e.target.value })} />
      </Field>
    </div>
  );
}
