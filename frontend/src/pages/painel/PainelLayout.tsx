import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";

const TABS_BASE = [
  { to: "/painel/clientes", label: "Clientes" },
  { to: "/painel/propostas", label: "Propostas" },
  { to: "/painel/reservas", label: "Reservas" },
  { to: "/painel/lotes", label: "Lotes" },
];

export default function PainelLayout() {
  const { perfil, sair } = useAuth();
  const tabs = perfil?.papel === "admin" ? [...TABS_BASE, { to: "/painel/corretores", label: "Corretores" }] : TABS_BASE;

  return (
    <div className="min-h-screen grid grid-rows-[auto_auto_1fr] min-w-0">
      <header className="border-b border-border bg-surface min-w-0">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between gap-4">
          <img src="/brand/castel-logo.png" alt="Castel Construções e Incorporações" className="h-8 w-auto object-contain" />
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="text-sm text-ink-soft hidden sm:inline">
              {perfil?.nome}{" "}
              <span className="text-[11px] uppercase tracking-wide text-ink-soft/70">({perfil?.papel})</span>
            </span>
            <button onClick={() => sair()} className="btn btn-ghost !px-3 !py-1.5 text-sm">
              Sair
            </button>
          </div>
        </div>
      </header>

      <nav className="border-b border-border bg-surface min-w-0 overflow-x-auto">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 flex gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  isActive ? "border-primary text-primary" : "border-transparent text-ink-soft hover:text-ink"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 sm:px-8 py-6 sm:py-8 w-full min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
