import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { CondominioDetalhe, LoteStatus, QuadraZona } from "../types";
import PlantaSVG from "../components/PlantaSVG";
import ListaLotes from "../components/ListaLotes";
import DetalheLote from "../components/DetalheLote";
import Modal from "../components/Modal";

type View = "planta" | "lista";
type StatusFiltro = "todos" | LoteStatus;

export default function Condominio() {
  const { slug } = useParams<{ slug: string }>();
  const [condo, setCondo] = useState<CondominioDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [view, setView] = useState<View>("planta");
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("todos");
  const [zonaFiltro, setZonaFiltro] = useState<QuadraZona | null>(null);
  const [selecionado, setSelecionado] = useState<number | null>(null);

  useEffect(() => {
    // Troca de empreendimento (ex.: veio de outro /condominios/:slug sem recarregar a
    // página) — limpa tudo que é específico do condomínio anterior antes de buscar o novo,
    // senão um filtro (planta, busca, status) de um condomínio "vaza" pro próximo.
    setCondo(null);
    setErro(null);
    setView("planta");
    setBusca("");
    setStatusFiltro("todos");
    setZonaFiltro(null);
    setSelecionado(null);
    if (!slug) return;
    api
      .obterCondominio(slug)
      .then(setCondo)
      .catch((e) => setErro(e.message));
  }, [slug]);

  const filtrados = useMemo(() => {
    if (!condo) return [];
    return condo.lotes
      .filter((l) => statusFiltro === "todos" || l.status === statusFiltro)
      .filter((l) => {
        if (!zonaFiltro) return true;
        if (zonaFiltro.lote_min != null && zonaFiltro.lote_max != null) {
          return l.lote_numero >= zonaFiltro.lote_min && l.lote_numero <= zonaFiltro.lote_max;
        }
        return l.quadra === zonaFiltro.quadra;
      })
      .filter((l) => !busca.trim() || l.identificador.toLowerCase().includes(busca.trim().toLowerCase()))
      .sort((a, b) => a.lote_numero - b.lote_numero);
  }, [condo, statusFiltro, zonaFiltro, busca]);

  const loteSelecionado = condo?.lotes.find((l) => l.lote_numero === selecionado) ?? null;

  if (erro) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <p className="text-rust">Não foi possível carregar este empreendimento ({erro}).</p>
        <Link to="/" className="text-primary underline mt-4 inline-block">
          Voltar para a seleção
        </Link>
      </div>
    );
  }

  if (!condo) {
    return <div className="max-w-6xl mx-auto px-6 py-20 text-ink-soft text-sm">Carregando...</div>;
  }

  const counts = {
    disponivel: condo.lotes.filter((l) => l.status === "disponivel").length,
    reservado: condo.lotes.filter((l) => l.status === "reservado").length,
    vendido: condo.lotes.filter((l) => l.status === "vendido").length,
  };

  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr_auto] min-w-0">
      <header className="border-b border-border bg-surface min-w-0">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-3.5">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Todos os empreendimentos
          </Link>
        </div>
        <div className="max-w-6xl mx-auto px-6 sm:px-8 pb-6 grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div className="flex items-center gap-4">
            {condo.logo_url && (
              <img
                src={condo.logo_url}
                alt={`Logo ${condo.nome}`}
                className="h-12 sm:h-14 w-auto object-contain shrink-0"
              />
            )}
            <div>
              <h1 className="text-2xl sm:text-[1.75rem] font-bold text-ink tracking-tight">{condo.nome}</h1>
              <p className="text-ink-soft text-sm mt-1">
                {condo.segmento} · {condo.cidade}
                {condo.base_precos_em &&
                  ` · base de preços: ${new Date(condo.base_precos_em).toLocaleDateString("pt-BR")}`}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 sm:gap-6">
            <Stat value={counts.disponivel} label="disponíveis" color="text-sage" />
            <Stat value={counts.reservado} label="reservados" color="text-ochre" />
            <Stat value={counts.vendido} label="vendidos" color="text-rust" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 sm:px-8 py-6 sm:py-8 w-full min-w-0">
        <div className={`grid grid-cols-1 gap-3 mb-6 ${view === "lista" ? "sm:grid-cols-[auto_1fr_auto]" : ""}`}>
          <div className="inline-grid grid-cols-2 rounded border border-border overflow-hidden w-full sm:w-auto sm:justify-self-start">
            {(["planta", "lista"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-5 py-2.5 text-sm font-medium transition-colors ${
                  view === v ? "bg-primary text-white" : "bg-surface text-ink hover:bg-surface-alt"
                }`}
              >
                {v === "planta" ? "Planta" : "Lista"}
              </button>
            ))}
          </div>
          {/* Busca e status só filtram a Lista — na Planta eles não têm nenhum efeito visual
              (a planta não é colorida por status), então ficam escondidos pra não confundir. */}
          {view === "lista" && (
            <>
              <input
                className="input"
                placeholder="Buscar lote..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              <select
                className="input sm:w-48"
                value={statusFiltro}
                onChange={(e) => setStatusFiltro(e.target.value as StatusFiltro)}
              >
                <option value="todos">Todos os status</option>
                <option value="disponivel">Disponível</option>
                <option value="reservado">Reservado</option>
                <option value="vendido">Vendido</option>
              </select>
            </>
          )}
        </div>

        {zonaFiltro && (
          <div className="flex items-center gap-2 mb-5 -mt-2">
            <span className="badge bg-primary-tint text-primary">
              {zonaFiltro.label ?? `Quadra ${zonaFiltro.quadra}`}
            </span>
            <button
              onClick={() => setZonaFiltro(null)}
              className="text-xs text-ink-soft hover:text-ink underline underline-offset-2"
            >
              limpar filtro
            </button>
          </div>
        )}

        {view === "planta" ? (
          <PlantaSVG
            condo={condo}
            selecionado={selecionado}
            onSelecionar={setSelecionado}
            onSelecionarZona={(zona) => {
              setZonaFiltro(zona);
              setStatusFiltro("todos");
              setBusca("");
              setView("lista");
            }}
          />
        ) : (
          <ListaLotes lotes={filtrados} onSelecionar={setSelecionado} />
        )}
      </main>

      <footer className="border-t border-border min-w-0">
        <p className="text-center text-[10px] text-ink-soft/40 tracking-wide py-4 select-none">
          italonunesdev@proton.me
        </p>
      </footer>

      {loteSelecionado && (
        <Modal onClose={() => setSelecionado(null)} labelledBy="lote-modal-title">
          <DetalheLote lote={loteSelecionado} />
        </Modal>
      )}
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="text-right sm:text-left">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-ink-soft uppercase tracking-wide">{label}</div>
    </div>
  );
}
