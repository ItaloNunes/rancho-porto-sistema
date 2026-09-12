import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { CondominioDetalhe, CondominioResumo, Lote } from "../../types";

const ZOOMS = [75, 100, 150, 200, 300];
const BASE_WIDTH = 760;

/** Ferramenta de marcação manual dos lotes sobre a planta real (só admin):
 * já que a extração automática do polígono a partir do PDF da planta técnica
 * não deu certo (ver decisão do produto — a camada de contorno é feita de
 * milhares de traços curtos e desconectados, não polilinhas fechadas), o
 * jeito confiável é clicar os cantos de cada lote, uma vez, aqui. Uma vez
 * marcado, o lote passa a ser pintado de verdade (por status) em cima da
 * planta, tanto no catálogo público quanto no painel — ver PlantaSVG.tsx. */
export default function PainelPlantas() {
  const [condominios, setCondominios] = useState<CondominioResumo[]>([]);
  const [slug, setSlug] = useState<string>("");
  const [condo, setCondo] = useState<CondominioDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [loteId, setLoteId] = useState<string | null>(null);
  const [pontos, setPontos] = useState<number[][]>([]);
  const [zoom, setZoom] = useState(100);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.listarCondominios().then((cs) => {
      setCondominios(cs);
      if (cs[0]) setSlug(cs[0].slug);
    });
  }, []);

  function recarregarCondo(s: string) {
    setErro(null);
    api
      .obterCondominio(s)
      .then((c) => {
        setCondo(c);
        setLoteId(null);
        setPontos([]);
      })
      .catch((e) => setErro(e.message));
  }

  useEffect(() => {
    if (slug) recarregarCondo(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const loteAtual = condo?.lotes.find((l) => l.id === loteId) ?? null;

  const lotesFiltrados = useMemo(() => {
    if (!condo) return [];
    return condo.lotes
      .filter((l) => !busca.trim() || l.identificador.toLowerCase().includes(busca.trim().toLowerCase()))
      .sort((a, b) => a.lote_numero - b.lote_numero);
  }, [condo, busca]);

  function selecionarLote(l: Lote) {
    setLoteId(l.id);
    setPontos(l.poligono_definido ? l.poligono : []);
  }

  async function salvar() {
    if (!loteAtual) return;
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await api.atualizarPoligonoLote(loteAtual.id, pontos);
      setCondo((c) => (c ? { ...c, lotes: c.lotes.map((l) => (l.id === atualizado.id ? atualizado : l)) } : c));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function limparMarcacao() {
    if (!loteAtual) return;
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await api.atualizarPoligonoLote(loteAtual.id, []);
      setCondo((c) => (c ? { ...c, lotes: c.lotes.map((l) => (l.id === atualizado.id ? atualizado : l)) } : c));
      setPontos([]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  if (!condo) {
    return (
      <div>
        <h1 className="text-xl font-bold text-ink mb-4">Marcar lotes na planta</h1>
        {erro ? <p className="text-rust text-sm">{erro}</p> : <p className="text-ink-soft text-sm">Carregando...</p>}
      </div>
    );
  }

  if (!condo.plan_image_url) {
    return (
      <div>
        <h1 className="text-xl font-bold text-ink mb-4">Marcar lotes na planta</h1>
        <p className="text-ink-soft text-sm">
          Este empreendimento não usa planta em imagem — não há o que marcar aqui.
        </p>
      </div>
    );
  }

  const marcados = condo.lotes.filter((l) => l.poligono_definido).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">Marcar lotes na planta</h1>
          <p className="text-xs text-ink-soft mt-1">
            Selecione um lote na lista, clique nos cantos dele sobre a planta (na ordem do contorno) e salve. Depois
            de marcado, o lote passa a ser pintado de verdade no catálogo e no painel.
          </p>
        </div>
        <select className="input !w-auto" value={slug} onChange={(e) => setSlug(e.target.value)}>
          {condominios.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-ink-soft mb-3">
        {marcados} de {condo.lotes.length} lotes marcados.
      </p>

      {erro && <p className="text-rust text-sm mb-3">{erro}</p>}

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <p className="text-sm text-ink">
              {loteAtual ? (
                <>
                  Marcando: <span className="font-semibold">{loteAtual.identificador}</span>{" "}
                  <span className="text-ink-soft">({pontos.length} ponto{pontos.length === 1 ? "" : "s"})</span>
                </>
              ) : (
                "Selecione um lote na lista ao lado"
              )}
            </p>
            <select className="input !w-auto !py-1.5 !text-xs" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
              {ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
            </select>
          </div>

          <PlantaClicavel condo={condo} zoom={zoom} loteAtualId={loteId} pontos={pontos} setPontos={setPontos} />

          <div className="flex flex-wrap gap-2 mt-3">
            <button
              className="btn btn-outline !py-2 !text-xs"
              disabled={!loteAtual || pontos.length === 0}
              onClick={() => setPontos(pontos.slice(0, -1))}
            >
              Desfazer último ponto
            </button>
            <button
              className="btn btn-outline !py-2 !text-xs"
              disabled={!loteAtual || pontos.length === 0}
              onClick={() => setPontos([])}
            >
              Limpar pontos
            </button>
            <button
              className="btn btn-primary !py-2 !text-xs ml-auto"
              disabled={!loteAtual || pontos.length < 3 || salvando}
              onClick={salvar}
            >
              {salvando ? "Salvando..." : "Salvar polígono"}
            </button>
            {loteAtual?.poligono_definido && (
              <button className="btn btn-outline !py-2 !text-xs !border-rust !text-rust" disabled={salvando} onClick={limparMarcacao}>
                Desmarcar lote
              </button>
            )}
          </div>
        </div>

        <div className="card p-3">
          <input className="input !text-xs mb-2" placeholder="Buscar lote..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="max-h-[60vh] overflow-y-auto scrollbar-thin grid gap-1">
            {lotesFiltrados.map((l) => (
              <button
                key={l.id}
                onClick={() => selecionarLote(l)}
                className={`text-left px-2.5 py-2 rounded text-xs flex items-center justify-between gap-2 transition-colors ${
                  loteId === l.id ? "bg-primary-tint text-primary font-semibold" : "text-ink hover:bg-surface-alt"
                }`}
              >
                <span>{l.identificador}</span>
                <span className={l.poligono_definido ? "text-sage" : "text-ink-soft/50"}>{l.poligono_definido ? "✓" : "—"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlantaClicavel({
  condo,
  zoom,
  loteAtualId,
  pontos,
  setPontos,
}: {
  condo: CondominioDetalhe;
  zoom: number;
  loteAtualId: string | null;
  pontos: number[][];
  setPontos: (p: number[][]) => void;
}) {
  const planW = condo.plan_w ?? 1000;
  const planH = condo.plan_h ?? 1000;
  const planMinX = condo.plan_minx ?? 0;
  const planMinY = condo.plan_miny ?? 0;

  const renderedWidth = (BASE_WIDTH * zoom) / 100;
  const renderedHeight = renderedWidth * (planH / planW);

  function planParaPixel(p: number[]): [number, number] {
    return [((p[0] - planMinX) / planW) * renderedWidth, ((p[1] - planMinY) / planH) * renderedHeight];
  }

  function onClickImagem(e: React.MouseEvent<HTMLDivElement>) {
    if (!loteAtualId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x = planMinX + (px / renderedWidth) * planW;
    const y = planMinY + (py / renderedHeight) * planH;
    setPontos([...pontos, [Math.round(x * 10) / 10, Math.round(y * 10) / 10]]);
  }

  return (
    <div className="overflow-auto border border-border rounded-lg bg-surface-alt/40" style={{ maxHeight: "65vh" }}>
      <div
        className="relative cursor-crosshair select-none"
        style={{ width: renderedWidth, height: renderedHeight }}
        onClick={onClickImagem}
      >
        <img
          src={condo.plan_image_url ?? undefined}
          alt="Planta técnica"
          draggable={false}
          width={renderedWidth}
          height={renderedHeight}
          style={{ display: "block", width: renderedWidth, height: renderedHeight, pointerEvents: "none" }}
        />
        <svg
          width={renderedWidth}
          height={renderedHeight}
          viewBox={`0 0 ${renderedWidth} ${renderedHeight}`}
          className="absolute inset-0 pointer-events-none"
        >
          {/* Lotes já marcados (referência, exceto o que está sendo editado agora) */}
          {condo.lotes
            .filter((l) => l.id !== loteAtualId && l.poligono_definido && l.poligono.length >= 3)
            .map((l) => (
              <polygon
                key={l.id}
                points={l.poligono.map((p) => planParaPixel(p).join(",")).join(" ")}
                fill="#0B3D5C"
                opacity={0.18}
                stroke="#0B3D5C"
                strokeWidth={1}
              />
            ))}

          {/* Polígono em construção do lote selecionado */}
          {pontos.length > 0 && (
            <polygon
              points={pontos.map((p) => planParaPixel(p).join(",")).join(" ")}
              fill="#C1810B"
              opacity={0.3}
              stroke="#C1810B"
              strokeWidth={2}
              strokeDasharray={pontos.length < 3 ? "4 4" : undefined}
            />
          )}
          {pontos.map((p, i) => {
            const [px, py] = planParaPixel(p);
            return <circle key={i} cx={px} cy={py} r={5} fill="#C1810B" stroke="#fff" strokeWidth={1.5} />;
          })}
        </svg>
      </div>
    </div>
  );
}
