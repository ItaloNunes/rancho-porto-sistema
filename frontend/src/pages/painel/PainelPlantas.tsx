import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { CondominioDetalhe, CondominioResumo, Lote, QuadraZona } from "../../types";

// 100% = exatamente a largura disponível (a planta cabe na tela sem rolar de
// lado, celular ou computador). Zoom acima disso é pra ganhar precisão ao
// marcar os cantos — aí sim é esperado rolar dentro da própria moldura.
const ZOOMS = [100, 150, 200, 300];

/** Acha a zona (plan_quadras) correspondente a um lote — mesma regra de
 * casamento usada no catálogo público (ver QuadraZona no schemas.py): por
 * `quadra` quando o empreendimento tem quadras reais (Porto Franco), ou por
 * faixa `lote_min..lote_max` quando cada lote é sua própria "quadra"
 * (Rancho Texas). Usada só pra AJUDAR a pessoa a achar visualmente onde
 * clicar — não decide sozinha qual é o contorno do lote certo. */
function zonaDoLote(lote: Lote, quadras: QuadraZona[] | null | undefined): QuadraZona | null {
  if (!quadras) return null;
  return (
    quadras.find(
      (z) =>
        (z.quadra != null && z.quadra === lote.quadra) ||
        (z.lote_min != null && z.lote_max != null && lote.lote_numero >= z.lote_min && lote.lote_numero <= z.lote_max)
    ) ?? null
  );
}

/** Candidatos de contorno pré-calculados por visão computacional a partir da
 * imagem raster da planta (script backend/scripts/gerar_candidatos_planta.py)
 * — ver comentário longo lá pro histórico completo. Resumo: tentamos extrair
 * o polígono automaticamente a partir do PDF vetorial e não deu certo (traços
 * desconectados); a partir da imagem rasterizada dá certo achar a FORMA do
 * lote, mas não dá pra confiar em OCR pra saber automaticamente QUAL lote é
 * cada forma (texto pequeno, rotacionado, comprimido — testado, não é
 * confiável o bastante pra escrever sozinho em produção). Por isso o modo
 * "Automático" aqui: a pessoa escolhe o lote (como sempre) e só precisa dar
 * UM clique dentro dele na planta — a forma é preenchida sozinha a partir do
 * mapa de candidatos. Nem toda planta tem esses arquivos gerados (só
 * funciona bem em plantas com lotes grandes o bastante em pixels — Rancho
 * Texas; Porto Franco tem lotes pequenos demais na resolução da imagem
 * disponível e cai automaticamente pro modo manual). */
type MapaCandidatos = {
  img: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  poligonos: number[][][];
} | null;

async function carregarMapaCandidatos(slug: string): Promise<MapaCandidatos> {
  try {
    const [img, poligonos] = await Promise.all([
      new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("sem mapa"));
        el.src = `/brand/${slug}-mapa.png`;
      }),
      fetch(`/brand/${slug}-candidatos.json`).then((r) => {
        if (!r.ok) throw new Error("sem candidatos");
        return r.json() as Promise<number[][][]>;
      }),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { img: canvas, ctx, poligonos };
  } catch {
    return null; // planta sem candidatos gerados — cai pro modo manual, normal
  }
}

/** Ferramenta de marcação dos lotes sobre a planta real (só admin). Dois
 * modos: "Automático" (clique 1x dentro do lote — a forma vem do mapa de
 * candidatos, ver acima) e "Manual" (clique nos cantos, um por um — sempre
 * disponível, é o jeito de corrigir um lote que o automático acertou errado
 * ou não tem candidato). Uma vez marcado, o lote passa a ser pintado de
 * verdade (por status) em cima da planta, tanto no catálogo público quanto
 * no painel — ver PlantaSVG.tsx. */
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
  const [mapa, setMapa] = useState<MapaCandidatos>(null);
  const [modo, setModo] = useState<"auto" | "manual">("auto");
  const [aviso, setAviso] = useState<string | null>(null);

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

  useEffect(() => {
    setMapa(null);
    if (!slug) return;
    let cancelado = false;
    carregarMapaCandidatos(slug).then((m) => {
      if (!cancelado) {
        setMapa(m);
        setModo(m ? "auto" : "manual");
      }
    });
    return () => {
      cancelado = true;
    };
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
    setAviso(null);
  }

  /** Clique dentro da planta em modo automático: olha o pixel no mapa de
   * candidatos e, se houver um contorno ali, usa ele inteiro como polígono
   * do lote selecionado — sem precisar clicar cantos. */
  function tentarPreencherAutomatico(planX: number, planY: number) {
    if (!mapa) return;
    const px = Math.round((planX / (condo?.plan_w ?? 1)) * mapa.img.width);
    const py = Math.round((planY / (condo?.plan_h ?? 1)) * mapa.img.height);
    if (px < 0 || py < 0 || px >= mapa.img.width || py >= mapa.img.height) return;
    const [r, g] = mapa.ctx.getImageData(px, py, 1, 1).data;
    const id = r + g * 256;
    if (id === 0) {
      setAviso("Nenhum contorno detectado nesse ponto — clique um pouco mais pro centro do lote, ou marque manualmente.");
      return;
    }
    const poligono = mapa.poligonos[id - 1];
    if (!poligono) return;
    setAviso(null);
    setPontos(poligono);
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
            {mapa
              ? "Selecione um lote na lista, dê um clique dentro dele na planta (modo Automático) e salve. Se o contorno vier errado, mude pra Manual e clique nos cantos."
              : "Selecione um lote na lista, clique nos cantos dele sobre a planta (na ordem do contorno) e salve."}
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
        <div className="card p-4 order-last lg:order-none">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <p className="text-sm text-ink">
              {loteAtual ? (
                <>
                  Marcando: <span className="font-semibold">{loteAtual.identificador}</span>{" "}
                  <span className="text-ink-soft">({pontos.length} ponto{pontos.length === 1 ? "" : "s"})</span>
                </>
              ) : (
                "Selecione um lote na lista abaixo"
              )}
            </p>
            <div className="flex items-center gap-2">
              {mapa && (
                <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                  <button
                    className={`px-2.5 py-1.5 font-medium transition-colors ${modo === "auto" ? "bg-primary text-white" : "text-ink-soft hover:bg-surface-alt"}`}
                    onClick={() => {
                      setModo("auto");
                      setAviso(null);
                    }}
                  >
                    Automático
                  </button>
                  <button
                    className={`px-2.5 py-1.5 font-medium transition-colors border-l border-border ${modo === "manual" ? "bg-primary text-white" : "text-ink-soft hover:bg-surface-alt"}`}
                    onClick={() => {
                      setModo("manual");
                      setAviso(null);
                    }}
                  >
                    Manual
                  </button>
                </div>
              )}
              <select className="input !w-auto !py-1.5 !text-xs" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                {/* Selecionar um lote ajusta o zoom sozinho pra achar a
                    quadra dele (ver PlantaClicavel) — o valor pode não bater
                    com nenhum destes presets, por isso ele entra na lista. */}
                {(ZOOMS.includes(zoom) ? ZOOMS : [...ZOOMS, zoom].sort((a, b) => a - b)).map((z) => (
                  <option key={z} value={z}>
                    {z}%
                  </option>
                ))}
              </select>
            </div>
          </div>

          {aviso && <p className="text-ochre text-xs mb-2">{aviso}</p>}

          <PlantaClicavel
            condo={condo}
            zoom={zoom}
            setZoom={setZoom}
            loteAtualId={loteId}
            pontos={pontos}
            setPontos={setPontos}
            modo={mapa ? modo : "manual"}
            onCliqueAutomatico={tentarPreencherAutomatico}
          />

          <div className="flex flex-wrap gap-2 mt-3">
            {modo === "manual" && (
              <>
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
              </>
            )}
            {modo === "auto" && pontos.length > 0 && (
              <button className="btn btn-outline !py-2 !text-xs" disabled={!loteAtual} onClick={() => setPontos([])}>
                Limpar contorno
              </button>
            )}
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
  setZoom,
  loteAtualId,
  pontos,
  setPontos,
  modo,
  onCliqueAutomatico,
}: {
  condo: CondominioDetalhe;
  zoom: number;
  setZoom: (z: number) => void;
  loteAtualId: string | null;
  pontos: number[][];
  setPontos: (p: number[][]) => void;
  modo: "auto" | "manual";
  onCliqueAutomatico: (planX: number, planY: number) => void;
}) {
  const planW = condo.plan_w ?? 1000;
  const planH = condo.plan_h ?? 1000;
  const planMinX = condo.plan_minx ?? 0;
  const planMinY = condo.plan_miny ?? 0;

  // 100% de zoom = a largura que a moldura tem disponível de verdade (medida
  // com ResizeObserver) — assim a planta cabe certinho tanto num celular
  // estreito quanto numa tela grande, sem rolagem de página nenhuma. Acima de
  // 100% ela passa a ficar mais larga que a moldura de propósito, pra dar
  // precisão ao marcar — aí a rolagem fica contida dentro da moldura mesmo.
  const molduraRef = useRef<HTMLDivElement>(null);
  const [larguraDisponivel, setLarguraDisponivel] = useState(320);
  useEffect(() => {
    const el = molduraRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setLarguraDisponivel(el.clientWidth));
    ro.observe(el);
    setLarguraDisponivel(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const renderedWidth = (larguraDisponivel * zoom) / 100;

  // Ao selecionar um lote, pré-localiza ele sozinho: dá zoom na quadra dele
  // (usando plan_quadras — a mesma zona aproximada do catálogo público) e
  // centraliza a rolagem ali, em vez de deixar a pessoa procurar visualmente
  // entre centenas de lotes minúsculos numa planta de 100%. A IA só ajuda a
  // CHEGAR perto — quem confirma qual contorno é o lote certo continua sendo
  // a pessoa (clique manual ou automático, ver comentário lá em cima).
  useEffect(() => {
    if (!loteAtualId) return;
    const lote = condo.lotes.find((l) => l.id === loteAtualId);
    if (!lote) return;
    const zona = zonaDoLote(lote, condo.plan_quadras);
    if (!zona) return;

    const FRACAO_ALVO = 0.42; // a quadra ocupa ~42% da largura visível da moldura
    const ZOOM_MIN = 100;
    const ZOOM_MAX = 900;
    const zoomIdeal = Math.round(
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (100 * FRACAO_ALVO * planW) / zona.w))
    );
    setZoom(zoomIdeal);

    // Rolagem centralizada na zona: precisa do renderedWidth/Height JÁ com o
    // zoom novo — calcula direto (não espera o próximo render) pra não
    // "piscar" na posição antiga antes de centralizar.
    const larguraNova = (larguraDisponivel * zoomIdeal) / 100;
    const alturaNova = larguraNova * (planH / planW);
    const cx = ((zona.x + zona.w / 2 - planMinX) / planW) * larguraNova;
    const cy = ((zona.y + zona.h / 2 - planMinY) / planH) * alturaNova;
    requestAnimationFrame(() => {
      const el = molduraRef.current;
      if (!el) return;
      el.scrollLeft = cx - el.clientWidth / 2;
      el.scrollTop = cy - el.clientHeight / 2;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loteAtualId]);
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
    if (modo === "auto") {
      onCliqueAutomatico(x, y);
      return;
    }
    setPontos([...pontos, [Math.round(x * 10) / 10, Math.round(y * 10) / 10]]);
  }

  return (
    <div ref={molduraRef} className="overflow-auto border border-border rounded-lg bg-surface-alt/40" style={{ maxHeight: "65vh" }}>
      <div
        className="relative select-none"
        style={{ width: renderedWidth, height: renderedHeight, cursor: loteAtualId ? "crosshair" : "default" }}
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

          {/* Polígono em construção (manual) ou já preenchido (automático) do lote selecionado */}
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
          {modo === "manual" &&
            pontos.map((p, i) => {
              const [px, py] = planParaPixel(p);
              return <circle key={i} cx={px} cy={py} r={5} fill="#C1810B" stroke="#fff" strokeWidth={1.5} />;
            })}
        </svg>
      </div>
    </div>
  );
}
