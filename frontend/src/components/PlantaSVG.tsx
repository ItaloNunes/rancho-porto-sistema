import { useEffect, useRef, useState } from "react";
import type { CondominioDetalhe, Lote, LoteStatus, QuadraZona } from "../types";

const STATUS_FILL: Record<LoteStatus, string> = {
  disponivel: "#1F8A57",
  reservado: "#C1810B",
  vendido: "#C43C3C",
};
const STATUS_LABEL: Record<LoteStatus, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

const MIN_SCALE = 0.15;
const MAX_SCALE = 3.5;

interface Props {
  condo: CondominioDetalhe;
  selecionado: number | null;
  onSelecionar: (loteNumero: number) => void;
  /** Só é chamado no modo planta-em-imagem (condo.plan_image_url preenchido): clique numa zona. */
  onSelecionarZona?: (zona: QuadraZona) => void;
}

/** Planta técnica navegável (pan/zoom): arraste para mover, roda do mouse ou
 * os botões +/- para dar zoom, clique em um lote (ou, na planta em imagem
 * real, em uma quadra) para ver os detalhes. */
export default function PlantaSVG({ condo, selecionado, onSelecionar, onSelecionarZona }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [hoveredQuadra, setHoveredQuadra] = useState<string | null>(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const planW = condo.plan_w ?? 1000;
  const planH = condo.plan_h ?? 1000;
  const planMinX = condo.plan_minx ?? 0;
  const planMinY = condo.plan_miny ?? 0;
  const decor = condo.plan_decor ?? {};
  const imagemReal = Boolean(condo.plan_image_url);

  function fit() {
    const el = viewportRef.current;
    if (!el) return;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (el.clientWidth / planW) * 0.94));
    const y = Math.max(20, (el.clientHeight - planH * s) / 2);
    setPan({ x: (el.clientWidth - planW * s) / 2 - planMinX * s, y, scale: s });
  }

  // Centraliza a planta ao entrar no condomínio e sempre que a viewport mudar de tamanho
  // (troca de orientação do celular, redimensionar a janela) — assim ela nunca fica cortada.
  useEffect(() => {
    fit();
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condo.id, planW, planH]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { active: true, moved: false, startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.current.moved = true;
    setPan((p) => ({ ...p, x: drag.current.origX + dx, y: drag.current.origY + dy }));
  }
  function onPointerUp() {
    drag.current.active = false;
    setDragging(false);
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    setPan((p) => ({ ...p, scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, p.scale * (1 + delta))) }));
  }
  function zoomBy(mult: number) {
    setPan((p) => ({ ...p, scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, p.scale * mult)) }));
  }

  function poly(points: number[][]) {
    return points.map((p) => `${p[0]},${p[1]}`).join(" ");
  }

  return (
    <div className="card overflow-hidden">
      <div className="relative">
        {/* Controles de zoom */}
        <div className="absolute right-3 top-3 z-10 grid gap-1.5">
          <ZoomBtn onClick={() => zoomBy(1.3)} label="Aproximar">
            +
          </ZoomBtn>
          <ZoomBtn onClick={() => zoomBy(1 / 1.3)} label="Afastar">
            −
          </ZoomBtn>
          <ZoomBtn onClick={fit} label="Centralizar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ZoomBtn>
        </div>

        {/* Legenda */}
        <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5 rounded-lg bg-surface/95 backdrop-blur px-3 py-2.5 shadow-card text-[11px]">
          {imagemReal ? (
            <>
              <span className="text-ink-soft font-medium">Planta técnica real</span>
              <span className="text-ink-soft/70 text-[10.5px] leading-snug max-w-[11rem]">
                Toque numa quadra para filtrar os lotes na lista
              </span>
            </>
          ) : (
            (["disponivel", "reservado", "vendido"] as LoteStatus[]).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_FILL[s] }} />
                <span className="text-ink-soft font-medium">{STATUS_LABEL[s]}</span>
              </div>
            ))
          )}
        </div>

        <div
          ref={viewportRef}
          className={`bg-surface-alt/40 overflow-hidden touch-none select-none
                      ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          style={{
            aspectRatio: `${planW} / ${planH}`,
            minHeight: 260,
            maxHeight: "min(70vh, 640px)",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <svg
            width={planW}
            height={planH}
            viewBox={`${planMinX} ${planMinY} ${planW} ${planH}`}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`,
              transformOrigin: "0 0",
              transition: dragging ? "none" : "transform .15s ease-out",
            }}
          >
            <rect x={planMinX} y={planMinY} width={planW} height={planH} fill="#FFFFFF" />

            {imagemReal ? (
              <>
                <image
                  href={condo.plan_image_url ?? undefined}
                  x={planMinX}
                  y={planMinY}
                  width={planW}
                  height={planH}
                  preserveAspectRatio="none"
                />
                {(condo.plan_quadras ?? []).map((q, i) => {
                  const key = q.quadra ?? (q.lote_min != null ? `${q.lote_min}-${q.lote_max}` : String(i));
                  return (
                    <g
                      key={key}
                      onClick={() => {
                        if (!drag.current.moved) onSelecionarZona?.(q);
                      }}
                      onPointerEnter={() => setHoveredQuadra(key)}
                      onPointerLeave={() => setHoveredQuadra(null)}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        x={q.x}
                        y={q.y}
                        width={q.w}
                        height={q.h}
                        fill="#0B3D5C"
                        opacity={hoveredQuadra === key ? 0.28 : 0.001}
                        stroke={hoveredQuadra === key ? "#0B3D5C" : "transparent"}
                        strokeWidth={3}
                        style={{ transition: "opacity .12s, stroke .12s" }}
                      />
                    </g>
                  );
                })}
              </>
            ) : (
              <>
                {decor.river && decor.river.length > 0 && (
                  <polygon points={poly(decor.river)} fill="#1F8A57" opacity={0.35} stroke="#0F172A" strokeWidth={2} />
                )}
                {decor.lagoon && (
                  <ellipse
                    cx={decor.lagoon.cx} cy={decor.lagoon.cy} rx={decor.lagoon.rx} ry={decor.lagoon.ry}
                    fill="#4A90A4" opacity={0.4} stroke="#0F172A" strokeWidth={2}
                  />
                )}
                {decor.entranceRoad && (
                  <rect
                    x={decor.entranceRoad.x} y={decor.entranceRoad.y} width={decor.entranceRoad.w} height={decor.entranceRoad.h}
                    fill="#E2E6EC" stroke="#C7CED8"
                  />
                )}
                {decor.roundabout1 && (
                  <circle cx={decor.roundabout1.cx} cy={decor.roundabout1.cy} r={decor.roundabout1.r} fill="#1F8A57" opacity={0.5} />
                )}
                {decor.roundabout2 && (
                  <circle cx={decor.roundabout2.cx} cy={decor.roundabout2.cy} r={decor.roundabout2.r} fill="#1F8A57" opacity={0.5} />
                )}

                {condo.lotes.map((l) => (
                  <LotePolygon
                    key={l.id}
                    lote={l}
                    selecionado={selecionado === l.lote_numero}
                    hovered={hovered === l.lote_numero}
                    onHover={setHovered}
                    onSelecionar={onSelecionar}
                    moved={() => drag.current.moved}
                  />
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
      <p className="text-xs text-ink-soft px-5 py-3 border-t border-border">
        Arraste para navegar, use o scroll (ou os botões) pra dar zoom.{" "}
        {imagemReal
          ? "Toque numa quadra pra ver os lotes dela na lista."
          : "Toque em um lote pra ver os detalhes."}
      </p>
    </div>
  );
}

function ZoomBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-full bg-surface shadow-card text-ink-soft
                 hover:text-ink hover:shadow-card-hover transition-all text-base font-medium"
    >
      {children}
    </button>
  );
}

function LotePolygon({
  lote,
  selecionado,
  hovered,
  onHover,
  onSelecionar,
  moved,
}: {
  lote: Lote;
  selecionado: boolean;
  hovered: boolean;
  onHover: (n: number | null) => void;
  onSelecionar: (n: number) => void;
  moved: () => boolean;
}) {
  const points = lote.poligono.map((p) => `${p[0]},${p[1]}`).join(" ");
  const cx = lote.poligono.reduce((s, p) => s + p[0], 0) / lote.poligono.length;
  const cy = lote.poligono.reduce((s, p) => s + p[1], 0) / lote.poligono.length;
  return (
    <g
      onClick={() => {
        if (!moved()) onSelecionar(lote.lote_numero);
      }}
      onPointerEnter={() => onHover(lote.lote_numero)}
      onPointerLeave={() => onHover(null)}
      style={{ cursor: "pointer" }}
    >
      <polygon
        points={points}
        stroke={selecionado ? "#0B3D5C" : "#0F172A"}
        strokeWidth={selecionado ? 4 : hovered ? 3 : 1.5}
        fill={STATUS_FILL[lote.status]}
        opacity={selecionado || hovered ? 1 : 0.88}
        style={{ transition: "opacity .12s, stroke-width .12s" }}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={Math.min(22, Math.max(...lote.poligono.map((p) => p[0])) - Math.min(...lote.poligono.map((p) => p[0])) > 30 ? 20 : 12)}
        fontWeight={600}
        pointerEvents="none"
      >
        {lote.lote_numero}
      </text>
    </g>
  );
}
