import { useState } from "react";

/** Campo de senha com "mostrar/ocultar" e aviso de Caps Lock ligado — a
 * causa nº 1 de "minha senha não funciona". */
export default function CampoSenha({
  id,
  label,
  valor,
  onChange,
  autoComplete,
  autoFocus,
  placeholder,
}: {
  id: string;
  label: string;
  valor: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [visivel, setVisivel] = useState(false);
  const [caps, setCaps] = useState(false);
  const checarCaps = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-ink-soft">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="input pr-12"
          type={visivel ? "text" : "password"}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={checarCaps}
          onKeyUp={checarCaps}
          onBlur={() => setCaps(false)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-soft hover:text-ink rounded-r"
          aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visivel}
          tabIndex={-1}
        >
          {visivel ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3.1 4.2M6.6 6.6C4.4 8 2.8 10.1 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {caps && <p className="text-xs text-amber-700">Caps Lock está ligado.</p>}
    </div>
  );
}
