import { useEffect, useMemo, useState } from "react";
import { api, formatMoney, horasRestantes } from "../../lib/api";
import type { ReservaComLote, ReservaStatus, VisaoGeralCondominio } from "../../types";

// Status que ainda contam como "reserva ativa" pro contador do topo — mesmo
// conjunto que o backend usa pra checar expiração das 24h (ver _STATUS_ATIVOS
// em backend/app/routers/reservas.py).
const STATUS_ATIVOS: ReservaStatus[] = ["pendente", "em_atendimento", "aguardando_qualificacao", "em_analise_financeira"];

// Limite pra contar uma reserva ativa como "expirando em breve" no card do topo.
const LIMITE_EXPIRANDO_HORAS = 3;

type SegmentoEstoque = "disponivel" | "reservado" | "vendido";

const SEGMENTO_LABEL: Record<SegmentoEstoque, string> = {
  disponivel: "Disponíveis",
  reservado: "Reservados",
  vendido: "Vendidos",
};

const SEGMENTO_COR: Record<SegmentoEstoque, string> = {
  disponivel: "bg-sage",
  reservado: "bg-ochre",
  vendido: "bg-rust",
};

const SEGMENTO_COR_TEXTO: Record<SegmentoEstoque, string> = {
  disponivel: "text-sage",
  reservado: "text-ochre",
  vendido: "text-rust",
};

export default function PainelVisaoGeral() {
  const [itens, setItens] = useState<VisaoGeralCondominio[] | null>(null);
  const [reservas, setReservas] = useState<ReservaComLote[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [empreendimentoPdf, setEmpreendimentoPdf] = useState<string>("todos");
  // Filtro executivo: "todos" ou o id de um empreendimento — recorta o
  // resumo do topo, o gráfico de estoque e o ranking, tudo junto (ver
  // dataviz: filtros escopam tudo abaixo deles, nunca por gráfico).
  const [filtro, setFiltro] = useState<string>("todos");

  function recarregar() {
    setErro(null);
    api.visaoGeral().then(setItens).catch((e) => setErro(e.message));
    api.listarReservas().then(setReservas).catch(() => {});
  }

  useEffect(recarregar, []);

  async function exportarPdf() {
    setExportando(true);
    try {
      const blob = await api.exportarVisaoGeralPdf(empreendimentoPdf === "todos" ? undefined : empreendimentoPdf);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExportando(false);
    }
  }

  const escopo = useMemo(
    () => (filtro === "todos" ? itens ?? [] : (itens ?? []).filter((i) => i.condominio_id === filtro)),
    [itens, filtro],
  );

  const totais = useMemo(() => {
    const base = {
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
  const reservasAtivas = useMemo(
    () => reservasEscopo.filter((r) => STATUS_ATIVOS.includes(r.status)),
    [reservasEscopo],
  );
  const reservasExpirandoEmBreve = useMemo(
    () =>
      reservasAtivas.filter((r) => {
        const h = horasRestantes(r.expira_em);
        return h !== null && h > 0 && h <= LIMITE_EXPIRANDO_HORAS;
      }),
    [reservasAtivas],
  );

  const escopoLabel = filtro === "todos" ? "Todos os empreendimentos" : escopo[0]?.nome ?? "Empreendimento";

  return (
    <div>
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
          {/* Filtro executivo — uma linha só, acima de tudo, recorta o resumo
              inteiro (ver dataviz: filtros escopam tudo abaixo deles). */}
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

          {/* Resumo executivo — número principal + estoque, tudo recortado
              pelo filtro selecionado acima. */}
          <div className="card p-5 sm:p-6 mb-5">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft mb-1">{escopoLabel}</p>
                <p className="text-5xl font-bold text-ink leading-none">
                  {pctVendido.toFixed(1)}
                  <span className="text-2xl text-ink-soft">%</span>
                </p>
                <p className="text-xs text-ink-soft mt-1.5">
                  vendido · {totais.vendidos} de {totais.total_lotes} lotes
                </p>
              </div>
              <div className="flex gap-6 flex-wrap">
                <MiniStat label="Valor vendido" valor={formatMoney(totais.valor_total_vendido)} />
                <MiniStat label="Ticket médio" valor={formatMoney(ticketMedio)} />
                <MiniStat
                  label={`Em propostas (${totais.propostas_abertas})`}
                  valor={formatMoney(totais.valor_em_propostas_abertas)}
                />
              </div>
            </div>

            <div className="mt-6">
              <BarraEstoqueInterativa
                disponiveis={totais.disponiveis}
                reservados={totais.reservados}
                vendidos={totais.vendidos}
              />
            </div>
          </div>

          {/* Reservas ativas — o único indicador operacional que sobrevive
              aqui (o funil detalhado por status saiu: informação demais pro
              nível executivo, sem ação direta associada). */}
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 mb-5">
            <StatTile label="Total de lotes" valor={totais.total_lotes} cor="text-ink" />
            <StatTile label="Disponíveis" valor={totais.disponiveis} cor="text-sage" />
            <StatTile label="Reservados" valor={totais.reservados} cor="text-ochre" />
            <StatTile
              label="Reservas ativas"
              valor={reservasAtivas.length}
              cor="text-primary"
              destaque={reservasExpirandoEmBreve.length > 0 ? `${reservasExpirandoEmBreve.length} expirando em breve` : undefined}
            />
          </div>

          {/* Ranking entre empreendimentos — barras clicáveis: clicar aplica
              o mesmo filtro dos chips acima. */}
          {itens.length > 1 && (
            <div className="card p-5 sm:p-6 mb-5">
              <h2 className="text-sm font-bold text-ink uppercase tracking-wide mb-4">Desempenho por empreendimento</h2>
              <div className="flex flex-col gap-3">
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
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {itens.map((item) => {
              const pct = item.total_lotes > 0 ? (item.vendidos / item.total_lotes) * 100 : 0;
              const ticket = item.vendidos > 0 ? item.valor_total_vendido / item.vendidos : null;
              const selecionado = filtro === item.condominio_id;
              return (
                <div
                  key={item.condominio_id}
                  className={`card p-5 sm:p-6 cursor-pointer transition-shadow ${selecionado ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setFiltro(selecionado ? "todos" : item.condominio_id)}
                >
                  <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-ink">{item.nome}</h2>
                    <span className="text-xs text-ink-soft">{pct.toFixed(1)}% vendido</span>
                  </div>
                  <BarraEstoqueInterativa disponiveis={item.disponiveis} reservados={item.reservados} vendidos={item.vendidos} compacta />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
                    <StatTile label="Total de lotes" valor={item.total_lotes} cor="text-ink" />
                    <StatTile label="Disponíveis" valor={item.disponiveis} cor="text-sage" />
                    <StatTile label="Reservados" valor={item.reservados} cor="text-ochre" />
                    <StatTile label="Vendidos" valor={item.vendidos} cor="text-rust" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-border">
                    <div className="col-span-2 sm:col-span-1 min-w-0">
                      <p className="text-xs text-ink-soft">Valor total vendido</p>
                      <p className="text-lg font-bold text-primary truncate" title={formatMoney(item.valor_total_vendido)}>
                        {formatMoney(item.valor_total_vendido)}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-ink-soft">Ticket médio</p>
                      <p className="text-lg font-bold text-ink truncate" title={formatMoney(ticket)}>
                        {formatMoney(ticket)}
                      </p>
                    </div>
                    <div className="col-span-2 sm:col-span-2 min-w-0">
                      <p className="text-xs text-ink-soft">
                        Propostas em andamento ({item.propostas_abertas})
                      </p>
                      <p
                        className="text-lg font-bold text-ink truncate"
                        title={formatMoney(item.valor_em_propostas_abertas)}
                      >
                        {formatMoney(item.valor_em_propostas_abertas)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
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

function MiniStat({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="min-w-[7rem]">
      <p className="text-lg font-bold text-ink truncate" title={valor}>
        {valor}
      </p>
      <p className="text-[11px] text-ink-soft mt-0.5">{label}</p>
    </div>
  );
}

/** Barra horizontal empilhada com hover por segmento (tooltip com valor e
 * %) e legenda com rótulo direto — a mesma leitura de sempre, só que agora
 * interativa (ver dataviz: hover por marca + legenda sempre presente). */
function BarraEstoqueInterativa({
  disponiveis,
  reservados,
  vendidos,
  compacta = false,
}: {
  disponiveis: number;
  reservados: number;
  vendidos: number;
  compacta?: boolean;
}) {
  const [hover, setHover] = useState<SegmentoEstoque | null>(null);
  const total = disponiveis + reservados + vendidos;
  const valores: Record<SegmentoEstoque, number> = { disponivel: disponiveis, reservado: reservados, vendido: vendidos };
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const segmentos: SegmentoEstoque[] = ["disponivel", "reservado", "vendido"];

  return (
    <div>
      <div className={`relative w-full rounded-full overflow-hidden bg-surface-alt flex ${compacta ? "h-2" : "h-3"}`}>
        {segmentos.map((seg) =>
          valores[seg] > 0 ? (
            <div
              key={seg}
              role="img"
              aria-label={`${SEGMENTO_LABEL[seg]}: ${valores[seg]} (${pct(valores[seg]).toFixed(1)}%)`}
              tabIndex={0}
              onMouseEnter={() => setHover(seg)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(seg)}
              onBlur={() => setHover(null)}
              className={`h-full ${SEGMENTO_COR[seg]} transition-opacity outline-none ${
                hover && hover !== seg ? "opacity-50" : "opacity-100"
              }`}
              style={{ width: `${pct(valores[seg])}%` }}
            />
          ) : null,
        )}
      </div>
      {!compacta && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5">
          {segmentos.map((seg) => (
            <div key={seg} className="flex items-center gap-1.5 text-xs">
              <span className={`inline-block h-2 w-2 rounded-full ${SEGMENTO_COR[seg]}`} />
              <span className="text-ink-soft">{SEGMENTO_LABEL[seg]}</span>
              <span className={`font-semibold ${SEGMENTO_COR_TEXTO[seg]}`}>
                {valores[seg]} ({pct(valores[seg]).toFixed(0)}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Uma linha do ranking entre empreendimentos — barra proporcional ao valor
 * vendido, clicável (aplica o filtro executivo) e com tooltip no hover
 * trazendo a composição completa do estoque. */
function BarraRanking({
  item,
  selecionado,
  onClick,
}: {
  item: VisaoGeralCondominio;
  selecionado: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const maiorValor = item.valor_total_vendido || 1;
  const pctVendido = item.total_lotes > 0 ? (item.vendidos / item.total_lotes) * 100 : 0;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`text-left rounded-sm p-2.5 -mx-2.5 transition-colors ${
        selecionado ? "bg-primary-tint" : hover ? "bg-surface-alt" : ""
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
      {hover && (
        <div className="flex gap-4 mt-2 text-[11px] text-ink-soft">
          <span>
            <span className="text-sage font-semibold">{item.disponiveis}</span> disponíveis
          </span>
          <span>
            <span className="text-ochre font-semibold">{item.reservados}</span> reservados
          </span>
          <span>
            <span className="text-rust font-semibold">{item.vendidos}</span> vendidos
          </span>
          <span>
            <span className="text-ink font-semibold">{item.propostas_abertas}</span> propostas em andamento
          </span>
        </div>
      )}
    </button>
  );
}

function StatTile({
  label,
  valor,
  cor,
  destaque,
}: {
  label: string;
  valor: number;
  cor: string;
  destaque?: string;
}) {
  return (
    <div className="rounded-sm bg-surface-alt p-3 min-w-0">
      <p className={`text-xl font-bold ${cor} truncate`}>{valor}</p>
      <p className="text-[11px] text-ink-soft mt-0.5">{label}</p>
      {destaque && <p className="text-[11px] font-semibold text-ochre mt-0.5">{destaque}</p>}
    </div>
  );
}
