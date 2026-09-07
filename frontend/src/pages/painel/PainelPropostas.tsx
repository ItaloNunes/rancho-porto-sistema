import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api, formatMoney } from "../../lib/api";
import type { Cliente, LoteComCondominio, PropostaDetalhe, PropostaStatus } from "../../types";

const STATUS_LABEL: Record<PropostaStatus, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
  cancelada: "Cancelada",
};

export default function PainelPropostas() {
  const [propostas, setPropostas] = useState<PropostaDetalhe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [lotes, setLotes] = useState<LoteComCondominio[]>([]);

  function recarregar() {
    setErro(null);
    api.listarPropostas().then(setPropostas).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    recarregar();
    api.listarClientes().then(setClientes).catch(() => {});
    api.listarTodosLotes().then(setLotes).catch(() => {});
  }, []);

  async function mudarStatus(p: PropostaDetalhe, status: PropostaStatus) {
    try {
      await api.atualizarStatusProposta(p.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-xl font-bold text-ink">Propostas de compra e venda</h1>
        <button className="btn btn-primary" onClick={() => setCriando(true)}>
          + Nova proposta
        </button>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!propostas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : propostas.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhuma proposta ainda.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Valor proposto</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {propostas.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink">{p.lote ? p.lote.identificador : "—"}</td>
                  <td className="px-4 py-3 text-ink">{p.cliente?.nome ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{formatMoney(p.valor_proposto)}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input !py-1.5 !text-xs w-auto"
                      value={p.status}
                      onChange={(e) => mudarStatus(p, e.target.value as PropostaStatus)}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {criando && (
        <Modal onClose={() => setCriando(false)} labelledBy="proposta-modal-title">
          <PropostaForm
            clientes={clientes}
            lotes={lotes}
            onSalvo={() => {
              setCriando(false);
              recarregar();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function PropostaForm({
  clientes,
  lotes,
  onSalvo,
}: {
  clientes: Cliente[];
  lotes: LoteComCondominio[];
  onSalvo: () => void;
}) {
  const [loteId, setLoteId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [valor, setValor] = useState("");
  const [condicoes, setCondicoes] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!loteId || !clienteId || !valor) {
      setErro("Preencha lote, cliente e valor.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      await api.criarProposta({
        lote_id: loteId,
        cliente_id: clienteId,
        valor_proposto: Number(valor),
        condicoes_pagamento: condicoes || null,
        observacoes: observacoes || null,
      });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8 grid gap-3">
      <h2 id="proposta-modal-title" className="text-lg font-bold text-ink mb-1">
        Nova proposta
      </h2>
      <select className="input" value={loteId} onChange={(e) => setLoteId(e.target.value)} required>
        <option value="">Selecione o lote...</option>
        {lotes.map((l) => (
          <option key={l.id} value={l.id}>
            {l.condominio_nome} — {l.identificador}
          </option>
        ))}
      </select>
      <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
        <option value="">Selecione o cliente...</option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
      <input
        className="input"
        type="number"
        step="0.01"
        placeholder="Valor proposto (R$) *"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        required
      />
      <input
        className="input"
        placeholder="Condições de pagamento"
        value={condicoes}
        onChange={(e) => setCondicoes(e.target.value)}
      />
      <textarea
        className="input"
        placeholder="Observações"
        rows={3}
        value={observacoes}
        onChange={(e) => setObservacoes(e.target.value)}
      />
      {erro && <p className="text-rust text-sm">{erro}</p>}
      <button className="btn btn-primary mt-2" disabled={salvando}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
