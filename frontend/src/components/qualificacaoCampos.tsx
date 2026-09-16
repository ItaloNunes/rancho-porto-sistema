import type { EstadoCivil, QualificacaoDados } from "../types";

/** Pequenos blocos reutilizados tanto no formulário público de qualificação
 * (QualificacaoPublica.tsx, preenchido pelo cliente final) quanto no
 * formulário completo de proposta do painel (PropostaFormularioCompleto.tsx,
 * preenchido direto pelo corretor) — os dois coletam exatamente os mesmos
 * campos da Proposta de Compra/Venda em papel, só muda quem preenche. */

export const ESTADO_CIVIL_OPCOES: { valor: EstadoCivil; label: string }[] = [
  { valor: "solteiro", label: "Solteiro(a)" },
  { valor: "casado", label: "Casado(a)" },
  { valor: "viuvo", label: "Viúvo(a)" },
  { valor: "divorciado", label: "Divorciado(a)" },
  { valor: "outros", label: "Outros" },
];

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function EnderecoCampos({
  endereco,
  onChange,
  obrigatorio = true,
}: {
  endereco: QualificacaoDados["endereco_residencial"];
  onChange: (e: QualificacaoDados["endereco_residencial"]) => void;
  /** Complemento fica de fora mesmo quando obrigatório — nem todo endereço
   * tem um, e travar o envio por isso não faz sentido. */
  obrigatorio?: boolean;
}) {
  const m = obrigatorio ? " *" : "";
  return (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label={`Rua/Avenida${m}`}>
          <input className="input" value={endereco.rua ?? ""} onChange={(e) => onChange({ ...endereco, rua: e.target.value })} />
        </Field>
        <Field label={`Nº${m}`}>
          <input
            className="input w-20"
            value={endereco.numero ?? ""}
            onChange={(e) => onChange({ ...endereco, numero: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Complemento">
        <input
          className="input"
          value={endereco.complemento ?? ""}
          onChange={(e) => onChange({ ...endereco, complemento: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Bairro${m}`}>
          <input className="input" value={endereco.bairro ?? ""} onChange={(e) => onChange({ ...endereco, bairro: e.target.value })} />
        </Field>
        <Field label={`CEP${m}`}>
          <input className="input" value={endereco.cep ?? ""} onChange={(e) => onChange({ ...endereco, cep: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Cidade${m}`}>
          <input className="input" value={endereco.cidade ?? ""} onChange={(e) => onChange({ ...endereco, cidade: e.target.value })} />
        </Field>
        <Field label={`UF${m}`}>
          <input
            className="input"
            maxLength={2}
            value={endereco.estado ?? ""}
            onChange={(e) => onChange({ ...endereco, estado: e.target.value.toUpperCase() })}
          />
        </Field>
      </div>
    </>
  );
}

/** Toggle "pra qual endereço vai a correspondência" — só faz sentido
 * mostrar quando existe endereço comercial (sem ele, é sempre a
 * residencial). Mesmo campo "Comercial ( ) / Residencial ( )" da lateral do
 * formulário em papel. */
export function CorrespondenciaCampo({
  valor,
  onChange,
}: {
  valor: QualificacaoDados["endereco_correspondencia"];
  onChange: (v: NonNullable<QualificacaoDados["endereco_correspondencia"]>) => void;
}) {
  return (
    <Field label="Endereço para correspondência">
      <div className="flex gap-2">
        <button
          type="button"
          className={`btn flex-1 !py-2 ${valor === "residencial" ? "btn-primary" : "btn-outline"}`}
          onClick={() => onChange("residencial")}
        >
          Residencial
        </button>
        <button
          type="button"
          className={`btn flex-1 !py-2 ${valor === "comercial" ? "btn-primary" : "btn-outline"}`}
          onClick={() => onChange("comercial")}
        >
          Comercial
        </button>
      </div>
    </Field>
  );
}
