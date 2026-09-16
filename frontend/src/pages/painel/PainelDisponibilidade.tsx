import { useEffect, useMemo, useState } from "react";
import { abrirAbaComCarregamento, api, formatMoney, mostrarErroNaAba } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { Corretor, LoteComCondominio, LoteStatus, ReservaComLote } from "../../types";

// Reserva ainda conta como responsável pela indisponibilidade do lote em
// qualquer status que não seja "cancelada" — cancelar é o único que libera o
// lote de volta pra disponível (mesma regra do backend, ver reservas.py).
const STATUS_RESERVA_QUE_SEGURA_LOTE = ["pendente", "em_atendimento", "aguardando_qualificacao", "em_analise_financeira", "confirmada"];

/** "há 3 dias", "há 5h", "há 20min" — tempo corrido desde a criação da reserva. */
function tempoDesde(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "agora";
  const minutos = ms / 60_000;
  if (minutos < 60) return `há ${Math.max(1, Math.round(minutos))}min`;
  const horas = minutos / 60;
  if (horas < 24) return `há ${Math.round(horas)}h`;
  const dias = Math.round(horas / 24);
  return `há ${dias} dia${dias === 1 ? "" : "s"}`;
}

const STATUS_LABEL: Record<LoteStatus, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

// Linha inteira tingida pela cor do status — mesma paleta dos badges usados
// no resto do painel (ver badge-disponivel/reservado/vendido em index.css),
// só que aplicada de leve na linha toda em vez de só num selo, pra dar de
// relance a mesma leitura visual da tabela de preços original em Excel.
const LINHA_COR: Record<LoteStatus, string> = {
  disponivel: "bg-sage/10 hover:bg-sage/15",
  reservado: "bg-ochre/10 hover:bg-ochre/15",
  vendido: "bg-rust/10 hover:bg-rust/15",
};

// Mapa literal separado pro pontinho da legenda — o Tailwind só gera a
// classe CSS de uma cor se ela aparecer como texto completo em algum lugar
// do arquivo; derivar "bg-sage" a partir de LINHA_COR em tempo de execução
// (split/replace) nunca aparece como literal e nunca seria gerado.
const PONTO_COR: Record<LoteStatus, string> = {
  disponivel: "bg-sage",
  reservado: "bg-ochre",
  vendido: "bg-rust",
};

const STATUS_FILTROS: (LoteStatus | "todos")[] = ["todos", "disponivel", "reservado", "vendido"];

export default function PainelDisponibilidade() {
  const { perfil } = useAuth();
  const [lotes, setLotes] = useState<LoteComCondominio[] | null>(null);
  const [reservas, setReservas] = useState<ReservaComLote[]>([]);
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [condominioSlug, setCondominioSlug] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<LoteStatus | "todos">("todos");
  const [exportando, setExportando] = useState(false);

  const ehAdmin = perfil?.papel === "admin";

  function recarregar() {
    setErro(null);
    api.listarTodosLotes().then(setLotes).catch((e) => setErro(e.message));
    // Quem reservou e há quanto tempo só faz sentido pro admin: um corretor
    // comum só enxerga as próprias reservas + leads sem dono (ver GET
    // /reservas), então a lista ficaria incompleta/enganosa pra ele.
    if (ehAdmin) {
      api.listarReservas().then(setReservas).catch(() => {});
      api.listarCorretores().then(setCorretores).catch(() => {});
    }
  }

  useEffect(recarregar, [ehAdmin]);

  // Pra cada lote reservado, a reserva mais recente (não cancelada) que ainda
  // está "segurando" ele — dá o nome do corretor e desde quando.
  const reservaPorLote = useMemo(() => {
    const mapa = new Map<string, ReservaComLote>();
    for (const r of reservas) {
      if (!STATUS_RESERVA_QUE_SEGURA_LOTE.includes(r.status)) continue;
      const atual = mapa.get(r.lote_id);
      if (!atual || new Date(r.created_at) > new Date(atual.created_at)) mapa.set(r.lote_id, r);
    }
    return mapa;
  }, [reservas]);

  const corretorPorId = useMemo(() => new Map(corretores.map((c) => [c.id, c.nome])), [corretores]);

  const empreendimentos = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const l of lotes ?? []) vistos.set(l.condominio_slug, l.condominio_nome);
    return [...vistos.entries()].map(([slug, nome]) => ({ slug, nome }));
  }, [lotes]);

  // Lotes só do empreendimento escolhido no filtro de cima (sem aplicar ainda
  // o filtro de status/busca) — é a base tanto da legenda de contagem quanto
  // do PDF exportado, pra sempre baterem com o que está selecionado ali.
  const lotesDoEmpreendimento = useMemo(
    () => (condominioSlug ? (lotes ?? []).filter((l) => l.condominio_slug === condominioSlug) : lotes ?? []),
    [lotes, condominioSlug],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lotesDoEmpreendimento.filter((l) => {
      if (statusFiltro !== "todos" && l.status !== statusFiltro) return false;
      if (termo && !`${l.identificador} ${l.quadra}`.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [lotesDoEmpreendimento, busca, statusFiltro]);

  // Reflete o empreendimento selecionado (não trava pelo status escolhido,
  // senão os outros status da legenda cairiam pra zero ao filtrar por um só).
  const contagem = useMemo(() => {
    const base = { disponivel: 0, reservado: 0, vendido: 0 };
    for (const l of lotesDoEmpreendimento) base[l.status]++;
    return base;
  }, [lotesDoEmpreendimento]);

  // O PDF sai batendo com o que está na tela: mesmo empreendimento, mesmo
  // status e mesma busca escolhidos nos filtros de cima (ver `status`/`busca`
  // em backend/app/routers/crm.py::visao_geral_pdf).
  async function exportarPdf() {
    // Abre a aba já no clique (síncrono) — esperar o PDF terminar de gerar
    // pra só então abrir faz o navegador bloquear a aba sem avisar nada
    // (mesmo ajuste feito na Visão Geral).
    const aba = abrirAbaComCarregamento("Gerando relatório de disponibilidade...");
    setExportando(true);
    try {
      const condominioId = condominioSlug ? lotesDoEmpreendimento[0]?.condominio_id : undefined;
      const blob = await api.exportarVisaoGeralPdf({
        condominioId,
        status: statusFiltro === "todos" ? undefined : statusFiltro,
        busca: busca.trim() || undefined,
      });
      const url = URL.createObjectURL(blob);
      if (aba) {
        aba.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = "disponibilidade.pdf";
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

  const rotuloExportar = [
    condominioSlug ? empreendimentos.find((c) => c.slug === condominioSlug)?.nome : null,
    statusFiltro !== "todos" ? STATUS_LABEL[statusFiltro] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">Disponibilidade</h1>
          <p className="text-xs text-ink-soft mt-1">
            Estoque completo dos lotes — a linha inteira segue a cor do status, igual à tabela de preços.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {(["disponivel", "reservado", "vendido"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                <span className={`h-2.5 w-2.5 rounded-full ${PONTO_COR[s]}`} />
                {STATUS_LABEL[s]} ({contagem[s]})
              </span>
            ))}
          </div>
          {ehAdmin && (
            <button className="btn btn-primary text-center leading-tight" onClick={exportarPdf} disabled={exportando}>
              {exportando ? "Gerando..." : rotuloExportar ? `Exportar PDF (${rotuloExportar})` : "Exportar PDF (todos)"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="input sm:w-64"
          placeholder="Buscar por lote ou quadra..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        {empreendimentos.length > 1 && (
          <select className="input !w-auto" value={condominioSlug} onChange={(e) => setCondominioSlug(e.target.value)}>
            <option value="">Todos os empreendimentos</option>
            {empreendimentos.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
        <select
          className="input !w-auto"
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value as LoteStatus | "todos")}
        >
          {STATUS_FILTROS.map((s) => (
            <option key={s} value={s}>
              {s === "todos" ? "Todos os status" : STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!lotes ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : filtrados.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhum lote encontrado.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Empreendimento</th>
                <th className="px-4 py-3 font-medium">Quadra</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Tamanho</th>
                <th className="px-4 py-3 font-medium">Valor total</th>
                <th className="px-4 py-3 font-medium">Entrada</th>
                <th className="px-4 py-3 font-medium">Parcela</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <tr key={l.id} className={`border-b border-border last:border-0 transition-colors ${LINHA_COR[l.status]}`}>
                  <td className="px-4 py-3 text-ink-soft">{l.condominio_nome}</td>
                  <td className="px-4 py-3 text-ink-soft">{l.quadra}</td>
                  <td className="px-4 py-3 font-medium text-ink">{l.identificador}</td>
                  <td className="px-4 py-3 text-ink-soft">{l.tamanho_m2.toLocaleString("pt-BR")} m²</td>
                  <td className="px-4 py-3 text-ink">{l.valor_total ? formatMoney(l.valor_total) : "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{l.entrada ? formatMoney(l.entrada) : "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {l.parcela_mensal ? `${formatMoney(l.parcela_mensal)}${l.qtd_parcelas ? ` × ${l.qtd_parcelas}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge badge-${l.status}`}>{STATUS_LABEL[l.status]}</span>
                    {ehAdmin && l.status === "reservado" && (
                      <ReservadoPor reserva={reservaPorLote.get(l.id)} nomeCorretor={corretorPorId} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Sub-linha discreta embaixo do badge "Reservado", só pro admin: quem
 * reservou e há quanto tempo. Some sozinha se a reserva não for encontrada
 * (ex.: lote marcado reservado manualmente pelo admin, sem reserva vinculada). */
function ReservadoPor({ reserva, nomeCorretor }: { reserva?: ReservaComLote; nomeCorretor: Map<string, string> }) {
  if (!reserva) return null;
  const nome = reserva.corretor_id ? nomeCorretor.get(reserva.corretor_id) : null;
  return (
    <p className="text-[11px] text-ink-soft mt-1">
      {nome ?? "Sem corretor definido"} · {tempoDesde(reserva.created_at)}
    </p>
  );
}
