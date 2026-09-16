import { useEffect, useMemo, useState } from "react";
import { abrirAbaComCarregamento, api, formatMoney, horasRestantes, mostrarErroNaAba } from "../../lib/api";
import type { ReservaComLote, ReservaStatus, VisaoGeralCondominio } from "../../types";

// Status que ainda contam como "reserva ativa" pro contador do topo — mesmo
// conjunto que o backend usa pra checar expiração das 24h (ver _STATUS_ATIVOS
// em backend/app/routers/reservas.py).
const STATUS_ATIVOS: ReservaStatus[] = ["pendente", "em_atendimento", "aguardando_qualificacao", "em_analise_financeira"];

// Limite pra contar uma reserva ativa como "expirando em breve" no card do topo.
const LIMITE_EXPIRANDO_HORAS = 3;

type Segmento = "disponivel" | "reservado" | "vendido";

const SEG_LABEL: Record<Segmento, string> = { disponivel: "Disponíveis", reservado: "Reservados", vendido: "Vendidos" };
const SEG_FILL: Record<Segmento, string> = { disponivel: "fill-sage", reservado: "fill-ochre", vendido: "fill-rust" };
const SEG_BG: Record<Segmento, string> = { disponivel: "bg-sage", reservado: "bg-ochre", vendido: "bg-rust" };
const SEG_TEXT: Record<Segmento, string> = { disponivel: "text-sage", reservado: "text-ochre", vendido: "text-rust" };

interface Totais {
  total_lotes: number;
  disponiveis: number;
  reservados: number;
  vendidos: number;
  valor_total_vendido: number;
  propostas_abertas: number;
  valor_em_propostas_abertas: number;
}

interface TooltipState {
  x: number;
  y: number;
  conteudo: React.ReactNode;
}

export default function PainelVisaoGeral() {
  const [itens, setItens] = useState<VisaoGeralCondominio[] | null>(null);
  const [reservas, setReservas] = useState<ReservaComLote[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [empreendimentoPdf, setEmpreendimentoPdf] = useState<string>("todos");
  // Filtro executivo: "todos" ou o id de um empreendimento — recorta o
  // resumo do topo, o gráfico e o ranking, tudo junto (filtros escopam tudo
  // abaixo deles, nunca por gráfico separado).
  const [filtro, setFiltro] = useState<string>("todos");
  const [tabelaVisivel, setTabelaVisivel] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoverSegmento, setHoverSegmento] = useState<Segmento | null>(null);

  function recarregar() {
    setErro(null);
    api.visaoGeral().then(setItens).catch((e) => setErro(e.message));
    api.listarReservas().then(setReservas).catch(() => {});
  }

  useEffect(recarregar, []);

  async function exportarPdf() {
    // A aba precisa abrir *na hora do clique* (síncrono) — se esperarmos o
    // fetch do PDF terminar pra só então chamar window.open, o navegador não
    // reconhece mais como resultado direto de um gesto do usuário e bloqueia
    // a aba silenciosamente (sem erro nenhum: parecia que o botão "não fazia
    // nada"). Abrindo em branco primeiro e só trocando a URL depois que o
    // blob chega, a aba sempre abre.
    const aba = abrirAbaComCarregamento("Gerando relatório de visão geral...");
    setExportando(true);
    try {
      const blob = await api.exportarVisaoGeralPdf({
        condominioId: empreendimentoPdf === "todos" ? undefined : empreendimentoPdf,
      });
      const url = URL.createObjectURL(blob);
      if (aba) {
        aba.location.href = url;
      } else {
        // Mesmo a abertura em branco pode ser bloqueada (config restritiva do
        // navegador) — nesse caso, baixa o arquivo direto em vez de silenciar.
        const link = document.createElement("a");
        link.href = url;
        link.download = "visao-geral.pdf";
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      mostrarErroNaAba(aba, mensagem);
      alert(mensagem);
    } finally {
      setExportando(false);
    }
  }

  const escopo = useMemo(
    () => (filtro === "todos" ? itens ?? [] : (itens ?? []).filter((i) => i.condominio_id === filtro)),
    [itens, filtro],
  );

  const totais = useMemo<Totais>(() => {
    const base: Totais = {
      total_lotes: 0,
      disponiveis: 0,
      reservados: 0,
      vendidos: 0,
      valor_total_vendido: 0,
      propostas_abertas: 0,
      valor_em_propostas_abertas: 0,
    };
    for (const item of escopo) {
      base.total_lotes += item.total_lotes;
      base.disponiveis += item.disponiveis;
      base.reservados += item.reservados;
      base.vendidos += item.vendidos;
      base.valor_total_vendido += item.valor_total_vendido;
      base.propostas_abertas += item.propostas_abertas;
      base.valor_em_propostas_abertas += item.valor_em_propostas_abertas;
    }
    return base;
  }, [escopo]);

  const ticketMedio = totais.vendidos > 0 ? totais.valor_total_vendido / totais.vendidos : null;
  const pctVendido = totais.total_lotes > 0 ? (totais.vendidos / totais.total_lotes) * 100 : 0;

  const condominioIdsEscopo = useMemo(() => new Set(escopo.map((i) => i.condominio_id)), [escopo]);
  const reservasEscopo = useMemo(
    () =>
      filtro === "todos"
        ? reservas ?? []
        : (reservas ?? []).filter((r) => r.lote && condominioIdsEscopo.has(r.lote.condominio_id)),
    [reservas, filtro, condominioIdsEscopo],
  );
  const reservasAtivas = useMemo(() => reservasEscopo.filter((r) => STATUS_ATIVOS.includes(r.status)), [reservasEscopo]);
  const reservasExpirandoEmBreve = useMemo(
    () =>
      reservasAtivas.filter((r) => {
        const h = horasRestantes(r.expira_em);
        return h !== null && h > 0 && h <= LIMITE_EXPIRANDO_HORAS;
      }),
    [reservasAtivas],
  );

  const escopoLabel = filtro === "todos" ? "Todos os empreendimentos" : escopo[0]?.nome ?? "Empreendimento";

  function mostrarTooltip(e: React.MouseEvent, conteudo: React.ReactNode) {
    setTooltip({ x: e.clientX, y: e.clientY, conteudo });
  }
  function moverTooltip(e: React.MouseEvent) {
    setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t));
  }
  function esconderTooltip() {
    setTooltip(null);
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">Visão geral</h1>
          <p className="text-xs text-ink-soft mt-1">
            Números consolidados de todos os empreendimentos, atualizados em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="input !w-auto text-sm"
            value={empreendimentoPdf}
            onChange={(e) => setEmpreendimentoPdf(e.target.value)}
          >
            <option value="todos">Todos os empreendimentos</option>
            {(itens ?? []).map((item) => (
              <option key={item.condominio_id} value={item.condominio_id}>
                {item.nome}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost whitespace-nowrap"
            aria-pressed={tabelaVisivel}
            onClick={() => setTabelaVisivel((v) => !v)}
          >
            {tabelaVisivel ? "Ocultar tabela" : "Ver tabela"}
          </button>
          <button className="btn btn-primary whitespace-nowrap" onClick={exportarPdf} disabled={exportando}>
            {exportando ? "Gerando..." : "Exportar PDF"}
          </button>
        </div>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!itens ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <>
          {/* Filtro executivo — uma linha só, acima de tudo. */}
          <div className="flex items-center gap-2 flex-wrap mb-5">
            <FiltroChip label="Todos" ativo={filtro === "todos"} onClick={() => setFiltro("todos")} />
            {itens.map((item) => (
              <FiltroChip
                key={item.condominio_id}
                label={item.nome}
                ativo={filtro === item.condominio_id}
                onClick={() => setFiltro(item.condominio_id)}
              />
            ))}
          </div>

          {/* Faixa de KPIs executivos */}
          <div className="grid gap-3 xl:grid-cols-[1.3fr_1fr_1fr_1fr_1fr] mb-5">
            <div className="card p-5 relative overflow-hidden">
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: "linear-gradient(135deg, var(--tw-gradient-from, #E9F0F5), transparent 60%)" }}
              />
              <p className="relative text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1">{escopoLabel}</p>
              <p className="relative text-5xl font-bold text-ink leading-none">
                {pctVendido.toFixed(1)}
                <span className="text-2xl text-ink-soft">%</span>
              </p>
              <p className="relative text-xs text-ink-soft mt-1.5">
                vendido · {totais.vendidos} de {totais.total_lotes} lotes
              </p>
            </div>
            <KpiTile label="Valor vendido" valor={formatMoney(totais.valor_total_vendido)} />
            <KpiTile label="Ticket médio" valor={formatMoney(ticketMedio)} />
            <KpiTile label={`Em propostas (${totais.propostas_abertas})`} valor={formatMoney(totais.valor_em_propostas_abertas)} />
            <KpiTile
              label="Reservas ativas"
              valor={String(reservasAtivas.length)}
              alerta={reservasExpirandoEmBreve.length > 0 ? `${reservasExpirandoEmBreve.length} expirando em breve` : undefined}
            />
          </div>

          {/* Composição do estoque + ranking entre empreendimentos */}
          <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr] mb-5 items-stretch">
            <div className="card p-5 sm:p-6 flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold text-ink uppercase tracking-wide">Composição do estoque</h2>
                <span className="text-xs text-muted">{filtro === "todos" ? "todos" : escopoLabel.toLowerCase()}</span>
              </div>
              <div className="flex items-center gap-6 flex-wrap justify-center flex-1">
                <DonutEstoque
                  disponiveis={totais.disponiveis}
                  reservados={totais.reservados}
                  vendidos={totais.vendidos}
                  hover={hoverSegmento}
                  onHoverSeg={setHoverSegmento}
                  onTooltip={mostrarTooltip}
                  onMoveTooltip={moverTooltip}
                  onLeaveTooltip={esconderTooltip}
                />
                <LegendaEstoque
                  disponiveis={totais.disponiveis}
                  reservados={totais.reservados}
                  vendidos={totais.vendidos}
                  hover={hoverSegmento}
                  onHoverSeg={setHoverSegmento}
                  onTooltip={mostrarTooltip}
                  onMoveTooltip={moverTooltip}
                  onLeaveTooltip={esconderTooltip}
                />
              </div>
            </div>

            <div className="card p-5 sm:p-6 flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold text-ink uppercase tracking-wide">Desempenho por empreendimento</h2>
                <span className="text-xs text-muted">clique numa barra pra filtrar</span>
              </div>
              <div className="flex flex-col gap-2 flex-1 justify-center">
                {[...itens]
                  .sort((a, b) => b.valor_total_vendido - a.valor_total_vendido)
                  .map((item) => (
                    <BarraRanking
                      key={item.condominio_id}
                      item={item}
                      selecionado={filtro === item.condominio_id}
                      onClick={() => setFiltro(filtro === item.condominio_id ? "todos" : item.condominio_id)}
                    />
                  ))}
              </div>
            </div>
          </div>

          {tabelaVisivel && (
            <div className="card p-5 sm:p-6 mb-5">
              <h2 className="text-sm font-bold text-ink uppercase tracking-wide mb-4">Detalhe por empreendimento</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-ink-soft border-b border-border">
                      <th className="pb-2.5 pr-3">Empreendimento</th>
                      <th className="pb-2.5 px-3 text-right">Total</th>
                      <th className="pb-2.5 px-3 text-right">Disponíveis</th>
                      <th className="pb-2.5 px-3 text-right">Reservados</th>
                      <th className="pb-2.5 px-3 text-right">Vendidos</th>
                      <th className="pb-2.5 px-3 text-right">% vendido</th>
                      <th className="pb-2.5 px-3 text-right">Valor vendido</th>
                      <th className="pb-2.5 pl-3 text-right">Ticket médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item) => {
                      const pct = item.total_lotes > 0 ? (item.vendidos / item.total_lotes) * 100 : 0;
                      const ticket = item.vendidos > 0 ? item.valor_total_vendido / item.vendidos : null;
                      const selecionado = filtro === item.condominio_id;
                      return (
                        <tr
                          key={item.condominio_id}
                          onClick={() => setFiltro(selecionado ? "todos" : item.condominio_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setFiltro(selecionado ? "todos" : item.condominio_id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selecionado}
                          className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface-alt transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 ${
                            selecionado ? "bg-primary-tint" : ""
                          }`}
                        >
                          <td className="py-3 pr-3 font-bold text-ink">{item.nome}</td>
                          <td className="py-3 px-3 text-right">{item.total_lotes}</td>
                          <td className="py-3 px-3 text-right text-sage font-semibold">{item.disponiveis}</td>
                          <td className="py-3 px-3 text-right text-ochre font-semibold">{item.reservados}</td>
                          <td className="py-3 px-3 text-right text-rust font-semibold">{item.vendidos}</td>
                          <td className="py-3 px-3 text-right">{pct.toFixed(1)}%</td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">{formatMoney(item.valor_total_vendido)}</td>
                          <td className="py-3 pl-3 text-right whitespace-nowrap">{formatMoney(ticket)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-ink text-white text-xs leading-relaxed rounded-lg px-3 py-2 shadow-modal max-w-[220px]"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, calc(-100% - 10px))" }}
        >
          {tooltip.conteudo}
        </div>
      )}
    </div>
  );
}

function FiltroChip({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        ativo
          ? "bg-primary text-white border-primary"
          : "bg-surface text-ink-soft border-border hover:border-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function KpiTile({ label, valor, alerta }: { label: string; valor: string; alerta?: string }) {
  return (
    <div className={`card p-4 flex flex-col justify-center gap-0.5 ${alerta ? "bg-ochre/10 !border-ochre" : ""}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={`text-xl font-bold truncate ${alerta ? "text-ochre" : "text-ink"}`} title={valor}>
        {valor}
      </p>
      {alerta && <p className="text-[11px] font-semibold text-ochre mt-0.5">{alerta}</p>}
    </div>
  );
}

// ---- Gráfico de composição do estoque (rosca em SVG, sem dependências) ----

function arcoPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const polar = (r: number, ang: number) => {
    const rad = ((ang - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const largeArc = a1 - a0 > 180 ? 1 : 0;
  const p0 = polar(rOuter, a0);
  const p1 = polar(rOuter, a1);
  const p2 = polar(rInner, a1);
  const p3 = polar(rInner, a0);
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p3.x} ${p3.y}`,
    "Z",
  ].join(" ");
}

interface EstoqueProps {
  disponiveis: number;
  reservados: number;
  vendidos: number;
  hover: Segmento | null;
  onHoverSeg: (s: Segmento | null) => void;
  onTooltip: (e: React.MouseEvent, conteudo: React.ReactNode) => void;
  onMoveTooltip: (e: React.MouseEvent) => void;
  onLeaveTooltip: () => void;
}

function tooltipSegmento(seg: Segmento, valor: number, pct: number) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-sm ${SEG_BG[seg]}`} />
      <span>{SEG_LABEL[seg]}</span>
      <span className="font-bold ml-auto">
        {valor} · {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function DonutEstoque({ disponiveis, reservados, vendidos, hover, onHoverSeg, onTooltip, onMoveTooltip, onLeaveTooltip }: EstoqueProps) {
  const total = disponiveis + reservados + vendidos;
  const dados: { key: Segmento; valor: number }[] = [
    { key: "disponivel", valor: disponiveis },
    { key: "reservado", valor: reservados },
    { key: "vendido", valor: vendidos },
  ];
  const cx = 75;
  const cy = 75;
  const rOuter = 70;
  const rInner = 46;
  let acumulado = 0;
  const arcos = dados
    .filter((d) => d.valor > 0)
    .map((d) => {
      const sweep = total > 0 ? (d.valor / total) * 360 : 0;
      const gap = total > 0 ? 1.4 : 0;
      const a0 = acumulado + gap / 2;
      const a1 = acumulado + sweep - gap / 2;
      acumulado += sweep;
      return { ...d, path: arcoPath(cx, cy, rOuter, rInner, a0, a1), pct: total > 0 ? (d.valor / total) * 100 : 0 };
    });

  return (
    <svg width={150} height={150} viewBox="0 0 150 150" role="img" aria-label="Composição do estoque por status" className="flex-none">
      {arcos.map((a) => (
        <path
          key={a.key}
          d={a.path}
          className={`${SEG_FILL[a.key]} cursor-pointer transition-opacity`}
          style={{ opacity: hover && hover !== a.key ? 0.35 : 1 }}
          tabIndex={0}
          onMouseEnter={(e) => {
            onHoverSeg(a.key);
            onTooltip(e, tooltipSegmento(a.key, a.valor, a.pct));
          }}
          onMouseMove={onMoveTooltip}
          onMouseLeave={() => {
            onHoverSeg(null);
            onLeaveTooltip();
          }}
          onFocus={(e) => {
            onHoverSeg(a.key);
            onTooltip(e as unknown as React.MouseEvent, tooltipSegmento(a.key, a.valor, a.pct));
          }}
          onBlur={() => {
            onHoverSeg(null);
            onLeaveTooltip();
          }}
        />
      ))}
      <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink font-bold" style={{ fontSize: 24 }}>
        {total}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="fill-ink-soft" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        lotes
      </text>
    </svg>
  );
}

function LegendaEstoque({ disponiveis, reservados, vendidos, hover, onHoverSeg, onTooltip, onMoveTooltip, onLeaveTooltip }: EstoqueProps) {
  const total = disponiveis + reservados + vendidos;
  const valores: Record<Segmento, number> = { disponivel: disponiveis, reservado: reservados, vendido: vendidos };
  const segmentos: Segmento[] = ["disponivel", "reservado", "vendido"];

  return (
    <div className="flex flex-col gap-1.5 min-w-[9rem]">
      {segmentos.map((seg) => {
        const pct = total > 0 ? (valores[seg] / total) * 100 : 0;
        return (
          <div
            key={seg}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors ${
              hover === seg ? "bg-surface-alt" : ""
            }`}
            onMouseEnter={(e) => {
              onHoverSeg(seg);
              onTooltip(e, tooltipSegmento(seg, valores[seg], pct));
            }}
            onMouseMove={onMoveTooltip}
            onMouseLeave={() => {
              onHoverSeg(null);
              onLeaveTooltip();
            }}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-sm flex-none ${SEG_BG[seg]}`} />
            <span className="text-xs text-ink-soft">{SEG_LABEL[seg]}</span>
            <span className={`text-sm font-bold ml-auto ${SEG_TEXT[seg]}`}>
              {valores[seg]} <span className="text-ink-soft font-medium">({pct.toFixed(0)}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Uma linha do ranking entre empreendimentos — barra proporcional ao valor
 * vendido, clicável (aplica o filtro executivo) e com o detalhe do estoque
 * revelado no hover/foco (sem depender de posição de mouse, acessível por
 * teclado). */
function BarraRanking({
  item,
  selecionado,
  onClick,
}: {
  item: VisaoGeralCondominio;
  selecionado: boolean;
  onClick: () => void;
}) {
  const maiorValor = item.valor_total_vendido || 1;
  const pctVendido = item.total_lotes > 0 ? (item.vendidos / item.total_lotes) * 100 : 0;

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-sm p-2.5 -mx-2.5 transition-colors group ${
        selecionado ? "bg-primary-tint" : "hover:bg-surface-alt"
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className={`text-sm font-semibold ${selecionado ? "text-primary" : "text-ink"}`}>{item.nome}</span>
        <span className="text-xs text-ink-soft whitespace-nowrap">
          {formatMoney(item.valor_total_vendido)} · {pctVendido.toFixed(1)}% vendido
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-surface-alt overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${selecionado ? "bg-primary" : "bg-accent"}`}
          style={{ width: `${Math.max(2, (item.valor_total_vendido / maiorValor) * 100)}%` }}
        />
      </div>
      <div className="flex gap-4 mt-0 max-h-0 opacity-0 overflow-hidden group-hover:max-h-8 group-hover:opacity-100 group-focus-within:max-h-8 group-focus-within:opacity-100 transition-all">
        <span className="text-[11px] text-ink-soft mt-2">
          <span className="text-sage font-semibold">{item.disponiveis}</span> disponíveis
        </span>
        <span className="text-[11px] text-ink-soft mt-2">
          <span className="text-ochre font-semibold">{item.reservados}</span> reservados
        </span>
        <span className="text-[11px] text-ink-soft mt-2">
          <span className="text-rust font-semibold">{item.vendidos}</span> vendidos
        </span>
        <span className="text-[11px] text-ink-soft mt-2">
          <span className="text-ink font-semibold">{item.propostas_abertas}</span> propostas
        </span>
      </div>
    </button>
  );
}
