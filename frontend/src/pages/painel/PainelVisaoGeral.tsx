import { useEffect, useMemo, useState } from "react";
import { api, formatMoney, horasRestantes } from "../../lib/api";
import type { ReservaComLote, ReservaStatus, VisaoGeralCondominio } from "../../types";

// Status que ainda contam como "reserva ativa" pro contador do topo — mesmo
// conjunto que o backend usa pra checar expiração das 24h (ver _STATUS_ATIVOS
// em backend/app/routers/reservas.py).
const STATUS_ATIVOS: ReservaStatus[] = ["pendente", "em_atendimento", "aguardando_qualificacao", "em_analise_financeira"];

// Limite pra contar uma reserva ativa como "expirando em breve" no card do topo.
const LIMITE_EXPIRANDO_HORAS = 3;

export default function PainelVisaoGeral() {
  const [itens, setItens] = useState<VisaoGeralCondominio[] | null>(null);
  const [reservas, setReservas] = useState<ReservaComLote[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [empreendimentoPdf, setEmpreendimentoPdf] = useState<string>("todos");

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
    for (const item of itens ?? []) {
      base.total_lotes += item.total_lotes;
      base.disponiveis += item.disponiveis;
      base.reservados += item.reservados;
      base.vendidos += item.vendidos;
      base.valor_total_vendido += item.valor_total_vendido;
      base.propostas_abertas += item.propostas_abertas;
      base.valor_em_propostas_abertas += item.valor_em_propostas_abertas;
    }
    return base;
  }, [itens]);

  const ticketMedioGeral = totais.vendidos > 0 ? totais.valor_total_vendido / totais.vendidos : null;
  const pctVendidoGeral = totais.total_lotes > 0 ? (totais.vendidos / totais.total_lotes) * 100 : 0;

  const reservasAtivas = useMemo(
    () => (reservas ?? []).filter((r) => STATUS_ATIVOS.includes(r.status)),
    [reservas],
  );
  const reservasExpirandoEmBreve = useMemo(
    () =>
      reservasAtivas.filter((r) => {
        const h = horasRestantes(r.expira_em);
        return h !== null && h > 0 && h <= LIMITE_EXPIRANDO_HORAS;
      }),
    [reservasAtivas],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">Visão geral</h1>
          <p className="text-xs text-ink-soft mt-1">
            Números consolidados de todos os empreendimentos, atualizados em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <button className="btn btn-primary" onClick={exportarPdf} disabled={exportando}>
            {exportando ? "Gerando..." : "Exportar PDF"}
          </button>
        </div>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!itens ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <>
          {/* Resumo geral — soma de todos os empreendimentos, pra bater o olho sem
              precisar somar os cards de baixo na mão. */}
          <div className="card p-5 sm:p-6 mb-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm font-bold text-ink uppercase tracking-wide">Total geral</h2>
              <span className="text-xs text-ink-soft">
                {totais.vendidos} de {totais.total_lotes} lotes vendidos ({pctVendidoGeral.toFixed(1)}%)
              </span>
            </div>
            <BarraEstoque disponiveis={totais.disponiveis} reservados={totais.reservados} vendidos={totais.vendidos} />
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mt-4">
              <StatTile label="Total de lotes" valor={totais.total_lotes} cor="text-ink" />
              <StatTile label="Disponíveis" valor={totais.disponiveis} cor="text-sage" />
              <StatTile label="Reservados" valor={totais.reservados} cor="text-ochre" />
              <StatTile label="Vendidos" valor={totais.vendidos} cor="text-rust" />
              <StatTile
                label="Reservas ativas"
                valor={reservasAtivas.length}
                cor="text-ink"
                destaque={reservasExpirandoEmBreve.length > 0 ? `${reservasExpirandoEmBreve.length} expirando` : undefined}
              />
              <StatTileMoeda label="Valor vendido" valor={totais.valor_total_vendido} cor="text-primary" />
              <StatTileMoeda label="Ticket médio" valor={ticketMedioGeral} cor="text-ink" />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {itens.map((item) => {
              const pctVendido = item.total_lotes > 0 ? (item.vendidos / item.total_lotes) * 100 : 0;
              const ticketMedio = item.vendidos > 0 ? item.valor_total_vendido / item.vendidos : null;
              return (
                <div key={item.condominio_id} className="card p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-ink">{item.nome}</h2>
                    <span className="text-xs text-ink-soft">{pctVendido.toFixed(1)}% vendido</span>
                  </div>
                  <BarraEstoque disponiveis={item.disponiveis} reservados={item.reservados} vendidos={item.vendidos} />
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
                      <p className="text-lg font-bold text-ink truncate" title={formatMoney(ticketMedio)}>
                        {formatMoney(ticketMedio)}
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

/** Barra horizontal empilhada — leitura rápida da proporção disponível
 * /reservado/vendido do estoque, mesma paleta usada nos badges de status. */
function BarraEstoque({
  disponiveis,
  reservados,
  vendidos,
}: {
  disponiveis: number;
  reservados: number;
  vendidos: number;
}) {
  const total = disponiveis + reservados + vendidos;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div>
      <div className="h-2.5 w-full rounded-full overflow-hidden bg-surface-alt flex">
        {disponiveis > 0 && <div className="h-full bg-sage" style={{ width: `${pct(disponiveis)}%` }} />}
        {reservados > 0 && <div className="h-full bg-ochre" style={{ width: `${pct(reservados)}%` }} />}
        {vendidos > 0 && <div className="h-full bg-rust" style={{ width: `${pct(vendidos)}%` }} />}
      </div>
    </div>
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

function StatTileMoeda({ label, valor, cor }: { label: string; valor: number | null; cor: string }) {
  const texto = formatMoney(valor);
  return (
    <div className="rounded-sm bg-surface-alt p-3 min-w-0">
      <p className={`text-lg font-bold ${cor} truncate`} title={texto}>
        {texto}
      </p>
      <p className="text-[11px] text-ink-soft mt-0.5">{label}</p>
    </div>
  );
}
