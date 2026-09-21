import { useEffect, useMemo, useState } from "react";
import { api, formatDateTime } from "../../lib/api";
import type { LogAuditoria } from "../../types";

const PAGINA = 100;

const ENTIDADES: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "reserva", label: "Reservas" },
  { value: "proposta", label: "Propostas" },
  { value: "cliente", label: "Clientes" },
  { value: "lote", label: "Lotes" },
  { value: "corretor", label: "Corretores (logins)" },
  { value: "qualificacao", label: "Qualificação" },
];

const ROTULO_ACAO: Record<string, string> = {
  login: "Login",
  criou_reserva: "Criou reserva",
  editou_reserva: "Editou reserva",
  excluiu_reserva: "Excluiu reserva",
  confirmou_reserva: "Confirmou reserva",
  cancelou_reserva: "Cancelou reserva",
  mudou_status_reserva: "Mudou status da reserva",
  reserva_expirou: "Reserva expirou (automático)",
  criou_proposta: "Criou proposta",
  editou_proposta: "Editou proposta",
  mudou_status_proposta: "Mudou status da proposta",
  anexou_documento: "Anexou documento",
  removeu_documento: "Removeu documento",
  criou_cliente: "Cadastrou cliente",
  editou_cliente: "Editou cliente",
  excluiu_cliente: "Excluiu cliente",
  criou_corretor: "Criou login de corretor",
  editou_corretor: "Editou corretor",
  desativou_corretor: "Desativou corretor",
  mudou_status_lote_manualmente: "Mudou status do lote (manual)",
  gerou_link_qualificacao: "Gerou link de qualificação",
  decidiu_qualificacao: "Decidiu qualificação",
};

function rotuloAcao(acao: string): string {
  return ROTULO_ACAO[acao] || acao.split("_").join(" ");
}

// Ações que mexem em algo sensível (cancelamento, exclusão, desativação) —
// destacadas em vermelho suave pra pular aos olhos numa lista longa.
function ehAcaoCritica(acao: string): boolean {
  return /cancel|exclui|desativ|remov|expirou|reprov/.test(acao);
}

export default function PainelLogs() {
  const [logs, setLogs] = useState<LogAuditoria[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [temMais, setTemMais] = useState(true);
  const [filtroEntidade, setFiltroEntidade] = useState("");
  const [busca, setBusca] = useState("");

  function carregarPrimeiraPagina() {
    setCarregando(true);
    setErro(null);
    api
      .listarLogs({ entidade: filtroEntidade || undefined })
      .then((r) => {
        setLogs(r);
        setTemMais(r.length === PAGINA);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregando(false));
  }

  function carregarMais() {
    if (logs.length === 0) return;
    setCarregandoMais(true);
    const ultimo = logs[logs.length - 1];
    api
      .listarLogs({ entidade: filtroEntidade || undefined, antesDe: ultimo.created_at })
      .then((r) => {
        setLogs((atual) => [...atual, ...r]);
        setTemMais(r.length === PAGINA);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregandoMais(false));
  }

  useEffect(() => {
    carregarPrimeiraPagina();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEntidade]);

  const logsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return logs;
    return logs.filter(
      (l) =>
        (l.ator_nome || "").toLowerCase().includes(termo) ||
        l.descricao.toLowerCase().includes(termo) ||
        rotuloAcao(l.acao).toLowerCase().includes(termo),
    );
  }, [logs, busca]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">Logs</h1>
          <p className="text-xs text-ink-soft mt-1">
            Toda ação relevante do painel — quem fez, o quê, quando e em qual registro. Acesso restrito a este
            login.
          </p>
        </div>
        <button className="btn btn-outline shrink-0" onClick={carregarPrimeiraPagina} disabled={carregando}>
          {carregando ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          className="input w-auto"
          value={filtroEntidade}
          onChange={(e) => setFiltroEntidade(e.target.value)}
        >
          {ENTIDADES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Buscar por corretor, ação ou descrição..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {carregando ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : logsFiltrados.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhum log encontrado.</p>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Quando</th>
                  <th className="px-4 py-3 font-medium">Quem</th>
                  <th className="px-4 py-3 font-medium">Ação</th>
                  <th className="px-4 py-3 font-medium">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {logsFiltrados.map((log) => (
                  <tr key={log.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60 align-top">
                    <td className="px-4 py-3 text-ink-soft whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    <td className="px-4 py-3 text-ink whitespace-nowrap">
                      {log.ator_nome || <span className="italic text-ink-soft">Sistema</span>}
                      {log.ator_papel && log.ator_papel !== "corretor" && (
                        <span className="ml-1.5 text-[10px] uppercase text-ink-soft/70">
                          ({log.ator_papel === "developer" ? "admin" : log.ator_papel})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={
                          ehAcaoCritica(log.acao)
                            ? "text-rust font-medium"
                            : "text-ink"
                        }
                      >
                        {rotuloAcao(log.acao)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{log.descricao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {temMais && !busca && (
            <div className="flex justify-center mt-4">
              <button className="btn btn-outline" onClick={carregarMais} disabled={carregandoMais}>
                {carregandoMais ? "Carregando..." : "Carregar mais"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
