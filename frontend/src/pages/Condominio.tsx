import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { CondominioDetalhe, LoteStatus } from "../types";
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
  const [selecionado, setSelecionado] = useState<number | null>(null);

  useEffect(() => {
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
      .filter((l) => !busca.trim() || l.identificador.toLowerCase().includes(busca.trim().toLowerCase()))
      .sort((a, b) => a.lote_numero - b.lote_numero);
  }, [condo, statusFiltro, busca]);

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
    <div className="min-h-screen grid grid-rows-[auto_1fr]">
      <header className="border-b border-border bg-surface">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-3.5">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Todos os empreendimentos
          </Link>
        </div>
        <div className="max-w-6xl mx-auto px-6 sm:px-8 pb-6 grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="text-2xl sm:text-[1.75rem] font-bold text-ink tracking-tight">{condo.nome}</h1>
            <p className="text-ink-soft text-sm mt-1">
              {condo.segmento} · {condo.cidade}
              {condo.base_precos_em &&
                ` · base de preços: ${new Date(condo.base_precos_em).toLocaleDateString("pt-BR")}`}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 sm:gap-6">
            <Stat value={counts.disponivel} label="disponíveis" color="text-sage" />
            <Stat value={counts.reservado} label="reservados" color="text-ochre" />
            <Stat value={counts.vendido} label="vendidos" color="text-rust" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 sm:px-8 py-6 sm:py-8 w-full">
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-3 mb-6">
          <div className="inline-grid grid-cols-2 rounded border border-border overflow-hidden w-full sm:w-auto">
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
        </div>

        {view === "planta" ? (
          <PlantaSVG condo={condo} selecionado={selecionado} onSelecionar={setSelecionado} />
        ) : (
          <ListaLotes lotes={filtrados} onSelecionar={setSelecionado} />
        )}
      </main>

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
