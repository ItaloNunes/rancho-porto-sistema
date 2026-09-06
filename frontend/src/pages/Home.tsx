import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { CondominioResumo } from "../types";

export default function Home() {
  const [condos, setCondos] = useState<CondominioResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .listarCondominios()
      .then(setCondos)
      .catch((e) => setErro(e.message));
  }, []);

  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr_auto] min-w-0">
      <header className="border-b border-border bg-surface min-w-0">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 h-16 grid grid-cols-[1fr_auto] items-center gap-4">
          <img
            src="/brand/castel-logo.png"
            alt="Castel Construções e Incorporações"
            className="h-8 sm:h-9 w-auto object-contain"
          />
          <span className="hidden sm:block text-xs font-medium tracking-wide text-ink-soft uppercase">
            Catálogo de Empreendimentos
          </span>
        </div>
      </header>

      <main className="min-w-0">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-14 sm:py-24">
          <div className="max-w-2xl">
            <h1 className="text-[1.6rem] leading-[1.2] sm:text-3xl font-bold text-ink tracking-tight">
              Escolha um empreendimento
            </h1>
          </div>

          {erro && (
            <p className="mt-10 text-rust text-sm">
              Não foi possível carregar os empreendimentos ({erro}). Confirme se a API está no ar.
            </p>
          )}

          <div className="grid sm:grid-cols-2 gap-5 sm:gap-6 mt-12 sm:mt-16">
            {(condos ?? [1, 2]).map((c, i) =>
              typeof c === "number" ? (
                <div key={i} className="h-[26rem] rounded-lg bg-surface-alt animate-pulse" />
              ) : (
                <CondoCard key={c.id} condo={c} />
              ),
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border min-w-0">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-6 text-xs text-ink-soft leading-relaxed">
          Este material tem caráter informativo. Confirme disponibilidade e condições diretamente
          com a imobiliária antes de formalizar qualquer negociação.
        </div>
        <p className="text-center text-[10px] text-ink-soft/40 tracking-wide pb-4 select-none">
          italonunesdev@proton.me
        </p>
      </footer>
    </div>
  );
}

function CondoCard({ condo }: { condo: CondominioResumo }) {
  const pct = condo.total_lotes > 0 ? Math.round((condo.total_disponiveis / condo.total_lotes) * 100) : 0;

  return (
    <Link
      to={`/condominios/${condo.slug}`}
      className="group card overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5
                 transition-all duration-200 grid grid-rows-[13rem_1fr]"
    >
      <div className="relative overflow-hidden bg-primary">
        {condo.hero_image_url && (
          <img
            src={condo.hero_image_url}
            alt={condo.nome}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
        {condo.logo_url && (
          <img
            src={condo.logo_url}
            alt=""
            className="absolute left-5 bottom-4 h-10 max-w-[55%] object-contain object-left drop-shadow-lg brightness-0 invert"
          />
        )}
      </div>

      <div className="p-6 grid grid-rows-[auto_auto_1fr_auto] gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink tracking-tight">{condo.nome}</h2>
          <p className="text-[13px] text-ink-soft mt-0.5">
            {condo.segmento} · {condo.cidade}
          </p>
        </div>

        <p className="text-[13px] text-ink-soft leading-relaxed">{condo.descricao}</p>

        <div className="self-end">
          <div className="grid grid-cols-[1fr_auto] items-baseline text-[13px] mb-1.5">
            <span className="text-ink-soft">
              <strong className="text-ink font-semibold">{condo.total_disponiveis}</strong> de{" "}
              {condo.total_lotes} lotes disponíveis
            </span>
            <span className="text-ink-soft font-medium">{pct}%</span>
          </div>
          <div className="h-1 rounded-full bg-surface-alt overflow-hidden">
            <div className="h-full bg-sage rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 mt-1 border-t border-border">
          <span className="text-sm font-semibold text-primary group-hover:text-primary-dark">
            Ver catálogo
          </span>
          <span
            className="grid h-8 w-8 place-items-center rounded-full bg-surface-alt text-ink-soft
                       group-hover:bg-primary group-hover:text-white transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}
