import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import BotaoSuporte from "../../components/BotaoSuporte";
import { temAcessoAdmin } from "../../types";

// Mudança de setembro/2026: não tem mais Cadastro de Cliente nem
// Qualificação de Leads (o corretor informa nome/CPF direto no pedido de
// reserva) — as duas telas saíram da navegação, mas o código continua no
// projeto (PainelClientes.tsx, PainelQualificacoes.tsx e as rotas do
// backend), só não estão mais roteadas em main.tsx.
//
// Mesma coisa com Acompanhamento (o funil que ele mostrava virou uma seção
// dentro da Visão geral, pra não duplicar com a aba Reservas) e Marcar
// plantas (não é mais usado no dia a dia) — PainelAcompanhamento.tsx e
// PainelPlantas.tsx continuam no projeto, só desroteados.
//
// Corretor comum: gera reserva e acompanha propostas (só sem aprovar
// nada). O resto (mexer direto no estoque de lotes, números consolidados,
// gestão de outros corretores) é só admin — ver TABS_ADMIN.
const TABS_BASE = [
  { to: "/painel/reservas", label: "Reservas" },
  { to: "/painel/propostas", label: "Propostas" },
  { to: "/painel/disponibilidade", label: "Disponibilidade" },
];

const TABS_ADMIN = [
  { to: "/painel/lotes", label: "Lotes" },
  { to: "/painel/visao-geral", label: "Visão geral" },
  { to: "/painel/corretores", label: "Corretores" },
  { to: "/painel/importar", label: "Importar planilha" },
  { to: "/painel/financeiro", label: "Financeiro" },
];

// Intervalo de checagem do indicador de "reserva nova" na aba Reservas —
// não precisa ser em tempo real, só não deixar o corretor sem perceber por
// muito tempo que chegou um pedido novo do catálogo público.
const INTERVALO_RESERVAS_MS = 45_000;

export default function PainelLayout() {
  const { perfil, sair } = useAuth();
  const tabs = temAcessoAdmin(perfil?.papel) ? [...TABS_BASE, ...TABS_ADMIN] : TABS_BASE;
  // Aba de Atividade e Logs: só a conta developer vê — nem os outros admins
  // (ver security.py::require_developer no backend, mesma regra espelhada
  // aqui).
  const tabsComAtividade =
    perfil?.papel === "developer"
      ? [...tabs, { to: "/painel/atividade", label: "Atividade" }, { to: "/painel/logs", label: "Logs" }]
      : tabs;
  const [menuAberto, setMenuAberto] = useState(false);
  const [reservasPendentes, setReservasPendentes] = useState(0);

  useEffect(() => {
    let cancelado = false;
    function carregar() {
      api
        .listarReservas()
        .then((reservas) => {
          if (!cancelado) setReservasPendentes(reservas.filter((r) => r.status === "pendente").length);
        })
        .catch(() => {
          /* falha silenciosa — é só um indicador, não vale interromper o painel por isso */
        });
    }
    carregar();
    const id = setInterval(carregar, INTERVALO_RESERVAS_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!menuAberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAberto(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuAberto]);

  return (
    <div className="min-h-screen grid grid-rows-[auto_auto_1fr] min-w-0">
      <header className="border-b border-border bg-surface min-w-0">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMenuAberto(true)}
              className="sm:hidden grid h-11 w-11 place-items-center -ml-2 rounded text-ink-soft hover:bg-surface-alt active:scale-[0.96] transition-colors shrink-0"
              aria-label="Abrir menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </button>
            <Link to="/" className="shrink-0 opacity-90 hover:opacity-100 transition-opacity" title="Voltar ao catálogo">
              <img src="/brand/castel-logo.png" alt="Castel Construções e Incorporações — voltar ao catálogo" className="h-8 w-auto object-contain" />
            </Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-sm text-ink-soft hidden sm:inline">
              {perfil?.nome}{" "}
              <span className="text-[11px] uppercase tracking-wide text-ink-soft/70">({perfil?.papel})</span>
            </span>
            <Link to="/definir-senha" className="btn btn-ghost hidden sm:inline-flex">
              Trocar senha
            </Link>
            <button onClick={() => sair()} className="btn btn-ghost">
              Sair
            </button>
          </div>
        </div>
      </header>

      <nav className="hidden sm:block border-b border-border bg-surface min-w-0 overflow-x-auto">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 flex gap-1">
          {tabsComAtividade.map((t) => (
            <TabLink key={t.to} to={t.to} label={t.label} badge={badgeDe(t.to, reservasPendentes)} />
          ))}
        </div>
      </nav>

      {/* Menu lateral (mobile): mesma navegação da barra de abas de desktop, só que
          em drawer — a barra horizontal fica apertada demais com 7 abas num celular. */}
      {menuAberto && (
        <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-[2px] animate-fade-in"
            onClick={() => setMenuAberto(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-2xl animate-slide-in-left overflow-y-auto">
            <div className="flex items-center justify-between px-5 h-16 border-b border-border">
              <img src="/brand/castel-logo.png" alt="Castel Construções e Incorporações" className="h-7 w-auto object-contain" />
              <button
                onClick={() => setMenuAberto(false)}
                aria-label="Fechar menu"
                className="grid h-11 w-11 place-items-center -mr-2 rounded-full text-ink-soft hover:bg-surface-alt active:scale-[0.96] transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="px-3 py-3 grid gap-1">
              {tabsComAtividade.map((t) => (
                <TabLink
                  key={t.to}
                  to={t.to}
                  label={t.label}
                  badge={badgeDe(t.to, reservasPendentes)}
                  vertical
                  onClick={() => setMenuAberto(false)}
                />
              ))}
            </div>
            <div className="px-5 py-4 border-t border-border mt-2 grid gap-2">
              <p className="text-sm text-ink-soft">
                {perfil?.nome}{" "}
                <span className="text-[11px] uppercase tracking-wide text-ink-soft/70">({perfil?.papel})</span>
              </p>
              <Link to="/definir-senha" className="btn-row btn-row-primary w-fit" onClick={() => setMenuAberto(false)}>
                Trocar senha
              </Link>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 sm:px-8 py-6 sm:py-8 w-full min-w-0">
        <Outlet />
      </main>

      <BotaoSuporte />
    </div>
  );
}

function badgeDe(to: string, reservasPendentes: number): number {
  if (to === "/painel/reservas") return reservasPendentes;
  return 0;
}

function TabLink({
  to,
  label,
  badge,
  vertical,
  onClick,
}: {
  to: string;
  label: string;
  badge: number;
  vertical?: boolean;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        vertical
          ? `flex items-center justify-between gap-2 min-h-11 px-3 rounded text-sm font-medium transition-colors ${
              isActive ? "bg-primary-tint text-primary" : "text-ink-soft hover:bg-surface-alt hover:text-ink"
            }`
          : `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              isActive ? "border-primary text-primary" : "border-transparent text-ink-soft hover:text-ink"
            }`
      }
    >
      {label}
      {badge > 0 && (
        <span className="grid place-items-center min-w-[1.25rem] h-5 px-1 rounded-full bg-rust text-white text-[10px] font-bold">
          {badge}
        </span>
      )}
    </NavLink>
  );
}
