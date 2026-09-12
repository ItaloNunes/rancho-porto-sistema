import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api, horasRestantes } from "../../lib/api";
import type { Cliente, LoteComCondominio, Qualificacao, Reserva, ReservaComLote, ReservaStatus } from "../../types";

const STATUS_LABEL: Record<ReservaStatus, string> = {
  pendente: "Pendente",
  em_atendimento: "Em atendimento",
  aguardando_qualificacao: "Aguardando cliente",
  em_analise_financeira: "Análise financeira",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
};

// Reservas nesses status ainda estão "vivas" o suficiente pra fazer sentido
// gerar (ou ver de novo) o link de qualificação do cliente final.
const STATUS_PERMITE_LINK: ReservaStatus[] = [
  "pendente",
  "em_atendimento",
  "aguardando_qualificacao",
  "em_analise_financeira",
];

export default function PainelReservas() {
  const [reservas, setReservas] = useState<ReservaComLote[] | null>(null);
  const [lotes, setLotes] = useState<LoteComCondominio[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<ReservaComLote | "novo" | null>(null);
  const [gerandoLinkPara, setGerandoLinkPara] = useState<ReservaComLote | null>(null);

  function recarregar() {
    setErro(null);
    api.listarReservas().then(setReservas).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    recarregar();
    api.listarTodosLotes().then(setLotes).catch(() => {});
    api.listarClientes().then(setClientes).catch(() => {});
  }, []);

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
            Pedidos feitos direto pelo cliente no catálogo público, mais os cadastrados manualmente aqui (ex.:
            contato por telefone/WhatsApp). A partir de uma reserva, gere o link pro cliente final preencher a
            qualificação — "Link do cliente" logo abaixo.
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
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {r.status === "em_analise_financeira" && <PrazoBadge prazoIso={r.analise_prazo_em} />}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {STATUS_PERMITE_LINK.includes(r.status) && (
                      <button
                        className="text-primary text-xs font-medium hover:underline mr-3"
                        onClick={() => setGerandoLinkPara(r)}
                      >
                        link do cliente
                      </button>
                    )}
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
        <Modal onClose={() => setEditando(null)} labelledBy="reserva-modal-title">
          <ReservaForm
            reserva={editando === "novo" ? null : editando}
            lotes={lotes}
            onSalvo={() => {
              setEditando(null);
              recarregar();
            }}
          />
        </Modal>
      )}

      {gerandoLinkPara && (
        <Modal onClose={() => setGerandoLinkPara(null)} labelledBy="link-qualificacao-title">
          <GerarLinkQualificacao
            reserva={gerandoLinkPara}
            clientes={clientes}
            onGerado={recarregar}
          />
        </Modal>
      )}
    </div>
  );
}

/** Contador/alerta das 48h de retenção do lote durante a análise financeira —
 * não expira nada sozinho, é só pra o corretor/financeiro perceber e decidir. */
function PrazoBadge({ prazoIso }: { prazoIso?: string | null }) {
  const horas = horasRestantes(prazoIso);
  if (horas === null) return null;
  const vencido = horas <= 0;
  const critico = horas > 0 && horas <= 12;
  const texto = vencido
    ? "prazo vencido"
    : horas < 1
      ? `${Math.round(horas * 60)}min restantes`
      : `${Math.round(horas)}h restantes`;
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
  onSalvo,
}: {
  reserva: ReservaComLote | null;
  lotes: LoteComCondominio[];
  onSalvo: () => void;
}) {
  const [loteId, setLoteId] = useState(reserva?.lote_id ?? "");
  const [nome, setNome] = useState(reserva?.nome ?? "");
  const [contato, setContato] = useState(reserva?.contato ?? "");
  const [observacao, setObservacao] = useState(reserva?.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reserva && !loteId) {
      setErro("Selecione o lote.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const payload = { nome: nome || null, contato: contato || null, observacao: observacao || null };
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
        <select className="input" value={loteId} onChange={(e) => setLoteId(e.target.value)} required>
          <option value="">Selecione o lote...</option>
          {lotes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.condominio_nome} — {l.identificador} ({l.status})
            </option>
          ))}
        </select>
      )}
      <input className="input" placeholder="Nome do interessado" value={nome ?? ""} onChange={(e) => setNome(e.target.value)} />
      <input
        className="input"
        placeholder="Contato (telefone/e-mail)"
        value={contato ?? ""}
        onChange={(e) => setContato(e.target.value)}
      />
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

/** Fluxo de gerar o link de qualificação a partir de uma reserva: escolhe um
 * cliente já cadastrado ou cadastra um novo ali mesmo (nome/telefone/CPF —
 * o resto o próprio cliente final preenche pelo link). Chamar de novo numa
 * reserva que já tem link (endpoint é idempotente) só reexibe o mesmo link. */
function GerarLinkQualificacao({
  reserva,
  clientes,
  onGerado,
}: {
  reserva: ReservaComLote;
  clientes: Cliente[];
  onGerado: () => void;
}) {
  const [modo, setModo] = useState<"existente" | "novo">(clientes.length ? "existente" : "novo");
  const [clienteId, setClienteId] = useState("");
  const [nomeNovo, setNomeNovo] = useState(reserva.nome ?? "");
  const [telefoneNovo, setTelefoneNovo] = useState(reserva.contato ?? "");
  const [cpfNovo, setCpfNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [gerada, setGerada] = useState<Qualificacao | null>(null);
  const [copiado, setCopiado] = useState(false);

  const link = gerada ? `${window.location.origin}/qualificacao/${gerada.token}` : "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (modo === "existente" && !clienteId) {
      setErro("Selecione o cliente.");
      return;
    }
    if (modo === "novo" && !nomeNovo.trim()) {
      setErro("Informe ao menos o nome do cliente.");
      return;
    }
    setSalvando(true);
    try {
      const payload =
        modo === "existente"
          ? { cliente_id: clienteId }
          : { cliente_novo: { nome: nomeNovo, telefone: telefoneNovo || null, cpf: cpfNovo || null } };
      const q = await api.gerarLinkQualificacao(reserva.id, payload);
      setGerada(q);
      onGerado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard pode falhar (ex.: sem permissão) — o campo abaixo já deixa selecionável na mão */
    }
  }

  if (gerada) {
    const mensagem = encodeURIComponent(
      `Olá! Pra darmos andamento na reserva do lote ${reserva.lote?.identificador ?? ""}, preencha seus dados e envie os documentos por este link: ${link}`,
    );
    return (
      <div className="p-6 sm:p-8 grid gap-4">
        <h2 className="text-lg font-bold text-ink">Link gerado</h2>
        <p className="text-sm text-ink-soft">
          Envie este link pro cliente final. Ele vai preencher os dados da proposta e anexar os documentos
          exigidos — sem precisar de login.
        </p>
        <div className="flex gap-2">
          <input className="input font-mono text-xs" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn btn-outline shrink-0" onClick={copiar}>
            {copiado ? "Copiado!" : "Copiar"}
          </button>
        </div>
        <a
          className="btn btn-primary"
          href={`https://wa.me/?text=${mensagem}`}
          target="_blank"
          rel="noreferrer"
        >
          Enviar por WhatsApp
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8 grid gap-3">
      <h2 id="link-qualificacao-title" className="text-lg font-bold text-ink mb-1">
        Link de qualificação — lote {reserva.lote?.identificador ?? "—"}
      </h2>
      <p className="text-xs text-ink-soft -mt-1 mb-1">
        Cadastre o cliente com o mínimo (nome, telefone, CPF) — o resto ele preenche pelo link.
      </p>

      <div className="flex gap-2 mb-1">
        <button
          type="button"
          className={`btn ${modo === "existente" ? "btn-primary" : "btn-outline"} !py-2 flex-1`}
          onClick={() => setModo("existente")}
        >
          Cliente já cadastrado
        </button>
        <button
          type="button"
          className={`btn ${modo === "novo" ? "btn-primary" : "btn-outline"} !py-2 flex-1`}
          onClick={() => setModo("novo")}
        >
          Cadastrar novo
        </button>
      </div>

      {modo === "existente" ? (
        <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          <option value="">Selecione o cliente...</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome} {c.telefone ? `— ${c.telefone}` : ""}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input className="input" placeholder="Nome *" value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="input"
              placeholder="Telefone"
              value={telefoneNovo}
              onChange={(e) => setTelefoneNovo(e.target.value)}
            />
            <input className="input" placeholder="CPF" value={cpfNovo} onChange={(e) => setCpfNovo(e.target.value)} />
          </div>
        </>
      )}

      {erro && <p className="text-rust text-sm">{erro}</p>}
      <button className="btn btn-primary mt-2" disabled={salvando}>
        {salvando ? "Gerando..." : "Gerar link"}
      </button>
    </form>
  );
}
