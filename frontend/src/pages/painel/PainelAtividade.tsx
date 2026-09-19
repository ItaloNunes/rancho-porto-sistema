import { useEffect, useState } from "react";
import { api, formatDateTime } from "../../lib/api";
import type { AtividadeItem } from "../../types";

// Atualiza sozinho, sem precisar recarregar a página — não é "ao vivo" de
// verdade (não usa websocket/Supabase Realtime), mas 20s já dá pra
// acompanhar o painel de longe sem ficar apertando F5.
const INTERVALO_MS = 20_000;

const ICONE_POR_TIPO: Record<AtividadeItem["tipo"], string> = {
  reserva: "🔖",
  proposta: "📝",
  cliente: "👤",
};

const TITULO_POR_TIPO: Record<AtividadeItem["tipo"], string> = {
  reserva: "Reservou",
  proposta: "Gerou proposta",
  cliente: "Cadastrou cliente",
};

function formatMoney(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function descricao(item: AtividadeItem): string {
  const pessoa = item.nome_pessoa || "sem nome";
  if (item.tipo === "cliente") return pessoa;
  const lote = item.lote_identificador || "lote";
  if (item.tipo === "reserva") return `${lote} — ${pessoa}`;
  const valor = item.valor_proposto != null ? ` — ${formatMoney(item.valor_proposto)}` : "";
  return `${lote} — ${pessoa}${valor}`;
}

export default function PainelAtividade() {
  const [itens, setItens] = useState<AtividadeItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  function carregar(mostrarSpinner: boolean) {
    if (mostrarSpinner) setAtualizando(true);
    api
      .listarAtividade()
      .then((r) => {
        setItens(r);
        setErro(null);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setAtualizando(false));
  }

  useEffect(() => {
    carregar(false);
    const id = setInterval(() => carregar(false), INTERVALO_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Atividade</h1>
          <p className="text-xs text-ink-soft mt-1">
            Reservas, propostas e clientes criados recentemente — atualiza sozinho a cada{" "}
            {INTERVALO_MS / 1000}s. Acesso restrito a este login.
          </p>
        </div>
        <button className="btn btn-outline shrink-0" onClick={() => carregar(true)} disabled={atualizando}>
          {atualizando ? "Atualizando..." : "Atualizar agora"}
        </button>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!itens ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : itens.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhuma atividade registrada ainda.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">O quê</th>
                <th className="px-4 py-3 font-medium">Detalhe</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Corretor</th>
                <th className="px-4 py-3 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink whitespace-nowrap">
                    <span className="mr-1.5" aria-hidden="true">
                      {ICONE_POR_TIPO[item.tipo]}
                    </span>
                    {TITULO_POR_TIPO[item.tipo]}
                  </td>
                  <td className="px-4 py-3 text-ink">{descricao(item)}</td>
                  <td className="px-4 py-3 text-ink-soft text-xs uppercase">{item.status || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {item.corretor_nome || <span className="italic">sem corretor</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-soft whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
