import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import { api, horasRestantes } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { LoteComCondominio, Reserva, ReservaComLote, ReservaStatus } from "../../types";

const STATUS_LABEL: Record<ReservaStatus, string> = {
  pendente: "Pendente",
  em_atendimento: "Em atendimento",
  aguardando_qualificacao: "Aguardando cliente",
  em_analise_financeira: "Análise financeira",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
};

export default function PainelReservas() {
  const { perfil } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [reservas, setReservas] = useState<ReservaComLote[] | null>(null);
  const [lotes, setLotes] = useState<LoteComCondominio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<ReservaComLote | "novo" | null>(null);
  // Quando a tela de Lotes manda reservar um lote específico, ela navega pra
  // cá já passando o id dele — abre o "Novo pedido" sozinho, sem a pessoa
  // precisar procurar o lote de novo no combobox.
  const [loteIdPreSelecionado, setLoteIdPreSelecionado] = useState<string | null>(null);
  // Guarda o id vindo da navegação até a lista de lotes terminar de carregar
  // (ela é buscada à parte, de novo, nesta tela) — só aí abre o formulário,
  // senão o combobox monta antes do lote existir na lista e fica em branco.
  const loteAlvoRef = useRef((location.state as { novoPedidoLoteId?: string } | null)?.novoPedidoLoteId ?? null);

  function recarregar() {
    setErro(null);
    api.listarReservas().then(setReservas).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    recarregar();
    api.listarTodosLotes().then(setLotes).catch(() => {});
    // Limpa o state da navegação já de cara pra não reabrir o modal sozinho
    // se a pessoa recarregar a página ou voltar/avançar pelo histórico.
    if (loteAlvoRef.current) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loteAlvoRef.current && lotes.length > 0) {
      setLoteIdPreSelecionado(loteAlvoRef.current);
      setEditando("novo");
      loteAlvoRef.current = null;
    }
  }, [lotes]);

  async function mudarStatus(r: ReservaComLote, status: ReservaStatus) {
    try {
      await api.atualizarStatusReserva(r.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function excluir(r: ReservaComLote) {
    if (!confirm(`Excluir o pedido do lote "${r.lote?.identificador ?? "—"}"? Isso não pode ser desfeito.`)) return;
    try {
      await api.excluirReserva(r.id);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Pedidos de reserva</h1>
          <p className="text-xs text-ink-soft mt-1">
            Informe o lote, o nome completo do cliente e (se tiver) o CPF. A reserva já tira o lote da
            disponibilidade pros outros corretores; só um admin confirma se a venda foi mesmo concluída.
          </p>
        </div>
        <button className="btn btn-primary shrink-0" onClick={() => setEditando("novo")}>
          + Novo pedido
        </button>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!reservas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : reservas.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhum pedido de reserva no momento.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Interessado</th>
                <th className="px-4 py-3 font-medium">Contato</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink">{r.lote ? r.lote.identificador : "—"}</td>
                  <td className="px-4 py-3 text-ink">{r.nome || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.contato || "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input !py-1.5 !text-xs w-auto"
                      value={r.status}
                      onChange={(e) => mudarStatus(r, e.target.value as ReservaStatus)}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, label]) => (
                        <option key={v} value={v} disabled={v === "confirmada" && perfil?.papel !== "admin"}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {r.status !== "confirmada" && r.status !== "cancelada" && (
                      <PrazoBadge prazoIso={r.expira_em} rotulo="pra expirar" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="text-primary text-xs font-medium hover:underline mr-3" onClick={() => setEditando(r)}>
                      editar
                    </button>
                    <button className="text-rust text-xs font-medium hover:underline" onClick={() => excluir(r)}>
                      excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <Modal
          onClose={() => {
            setEditando(null);
            setLoteIdPreSelecionado(null);
          }}
          labelledBy="reserva-modal-title"
        >
          <ReservaForm
            reserva={editando === "novo" ? null : editando}
            lotes={lotes}
            loteIdInicial={editando === "novo" ? loteIdPreSelecionado : null}
            onSalvo={() => {
              setEditando(null);
              setLoteIdPreSelecionado(null);
              recarregar();
            }}
          />
        </Modal>
      )}

    </div>
  );
}

/** Contador/alerta das 48h de retenção do lote durante a análise financeira —
 * não expira nada sozinho, é só pra o corretor/financeiro perceber e decidir. */
function PrazoBadge({ prazoIso, rotulo = "restantes" }: { prazoIso?: string | null; rotulo?: string }) {
  const horas = horasRestantes(prazoIso);
  if (horas === null) return null;
  const vencido = horas <= 0;
  const critico = horas > 0 && horas <= 3;
  const texto = vencido
    ? "prazo vencido"
    : horas < 1
      ? `${Math.round(horas * 60)}min ${rotulo}`
      : `${Math.round(horas)}h ${rotulo}`;
  return (
    <div
      className={`mt-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-sm inline-block ${
        vencido ? "bg-rust/10 text-rust" : critico ? "bg-ochre/10 text-ochre" : "bg-sage/10 text-sage"
      }`}
    >
      {texto}
    </div>
  );
}

function ReservaForm({
  reserva,
  lotes,
  loteIdInicial,
  onSalvo,
}: {
  reserva: ReservaComLote | null;
  lotes: LoteComCondominio[];
  loteIdInicial?: string | null;
  onSalvo: () => void;
}) {
  const [loteId, setLoteId] = useState(reserva?.lote_id ?? loteIdInicial ?? "");
  const [condominioSlug, setCondominioSlug] = useState(
    () => lotes.find((l) => l.id === loteIdInicial)?.condominio_slug ?? "",
  );
  const [nome, setNome] = useState(reserva?.nome ?? "");
  const [contato, setContato] = useState(reserva?.contato ?? "");
  const [cpf, setCpf] = useState(reserva?.cpf ?? "");
  const [observacao, setObservacao] = useState(reserva?.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const empreendimentos = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const l of lotes) vistos.set(l.condominio_slug, l.condominio_nome);
    return [...vistos.entries()].map(([slug, nome]) => ({ slug, nome }));
  }, [lotes]);

  const lotesDoEmpreendimento = useMemo(
    () => (condominioSlug ? lotes.filter((l) => l.condominio_slug === condominioSlug) : lotes),
    [lotes, condominioSlug],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reserva && !loteId) {
      setErro("Selecione o lote.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const payload = { nome: nome || null, contato: contato || null, cpf: cpf || null, observacao: observacao || null };
      if (reserva) {
        await api.atualizarReserva(reserva.id, payload);
      } else {
        await (api.criarReserva as (p: typeof payload & { lote_id: string }) => Promise<Reserva>)({
          ...payload,
          lote_id: loteId,
        });
      }
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8 grid gap-3">
      <h2 id="reserva-modal-title" className="text-lg font-bold text-ink mb-1">
        {reserva ? "Editar pedido" : "Novo pedido de reserva"}
      </h2>
      {!reserva && (
        <>
          {empreendimentos.length > 1 && (
            <select
              className="input"
              value={condominioSlug}
              onChange={(e) => {
                setCondominioSlug(e.target.value);
                setLoteId("");
              }}
            >
              <option value="">Todos os empreendimentos</option>
              {empreendimentos.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nome}
                </option>
              ))}
            </select>
          )}
          <LoteCombobox key={condominioSlug} lotes={lotesDoEmpreendimento} value={loteId} onChange={setLoteId} />
        </>
      )}
      <input className="input" placeholder="Nome completo do cliente" value={nome ?? ""} onChange={(e) => setNome(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <input
          className="input"
          placeholder="Contato (telefone/e-mail)"
          value={contato ?? ""}
          onChange={(e) => setContato(e.target.value)}
        />
        <input className="input" placeholder="CPF (opcional)" value={cpf ?? ""} onChange={(e) => setCpf(e.target.value)} />
      </div>
      <textarea
        className="input"
        placeholder="Observações"
        rows={3}
        value={observacao ?? ""}
        onChange={(e) => setObservacao(e.target.value)}
      />
      {erro && <p className="text-rust text-sm">{erro}</p>}
      <button className="btn btn-primary mt-2" disabled={salvando}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}

function rotuloLote(l: LoteComCondominio): string {
  return `${l.condominio_nome} — ${l.identificador} (${l.status})`;
}

/** Campo de lote com busca — em vez de rolar um <select> gigante, a pessoa
 * digita (quadra, número, o que aparecer no rótulo) e escolhe da lista
 * filtrada. `key={condominioSlug}` no ponto de uso (ReservaForm) remonta
 * este componente do zero sempre que o filtro de empreendimento muda, então
 * não precisa sincronizar busca/lista aqui. */
function LoteCombobox({
  lotes,
  value,
  onChange,
}: {
  lotes: LoteComCondominio[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selecionado = lotes.find((l) => l.id === value) ?? null;
  const [busca, setBusca] = useState(selecionado ? rotuloLote(selecionado) : "");
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", onClickFora);
    return () => document.removeEventListener("mousedown", onClickFora);
  }, []);

  const termo = busca.trim().toLowerCase();
  // Números soltos (ex.: "4", "04", "004") — compara ignorando zeros à esquerda, já
  // que cada empreendimento numera os lotes com uma quantidade diferente de dígitos
  // (Rancho Texas usa 3, Porto Franco usa 2), então a busca só por texto literal
  // perdia combinações válidas só por causa da formatação do número.
  const termoNumero = termo.replace(/\D/g, "");
  function bate(l: LoteComCondominio): boolean {
    if (rotuloLote(l).toLowerCase().includes(termo)) return true;
    if (!termoNumero) return false;
    const numero = Number(termoNumero);
    return numero === l.lote_numero || (!!l.quadra && numero === Number(l.quadra));
  }

  const encontrados = termo ? lotes.filter(bate) : lotes;
  // Nunca deixa a lista vazia só por causa de uma busca sem match exato — melhor
  // mostrar todos os lotes pra pessoa escolher na mão do que travar numa tela
  // "nenhum lote encontrado" sem saída.
  const semResultadoExato = termo !== "" && encontrados.length === 0;
  const listaExibida = (semResultadoExato ? lotes : encontrados).slice(0, 60);

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="input"
        placeholder="Digite pra buscar o lote (quadra, número...)"
        value={busca}
        onFocus={() => setAberto(true)}
        onChange={(e) => {
          setBusca(e.target.value);
          setAberto(true);
          if (value) onChange("");
        }}
      />
      {aberto && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto card p-1 shadow-lg">
          {semResultadoExato && (
            <p className="px-3 py-2 text-xs text-ink-soft border-b border-border mb-1">
              Nenhum lote bate exatamente com "{busca.trim()}" — veja todos abaixo:
            </p>
          )}
          {listaExibida.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-soft">Nenhum lote cadastrado.</p>
          ) : (
            listaExibida.map((l) => (
              <button
                type="button"
                key={l.id}
                className="w-full text-left px-3 py-2 text-sm rounded hover:bg-surface-alt"
                onClick={() => {
                  onChange(l.id);
                  setBusca(rotuloLote(l));
                  setAberto(false);
                }}
              >
                {rotuloLote(l)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
