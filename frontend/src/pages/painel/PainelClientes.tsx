import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { Cliente, Corretor } from "../../types";

export default function PainelClientes() {
  const { perfil } = useAuth();
  const isAdmin = perfil?.papel === "admin";
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Cliente | "novo" | null>(null);

  function recarregar() {
    setErro(null);
    api.listarClientes().then(setClientes).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    recarregar();
    if (isAdmin) api.listarCorretores().then(setCorretores).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function excluir(c: Cliente) {
    if (!confirm(`Excluir o cliente "${c.nome}"? Isso não pode ser desfeito.`)) return;
    try {
      await api.excluirCliente(c.id);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  function nomeCorretor(id?: string | null) {
    if (!id) return "— (lead livre)";
    return corretores.find((c) => c.id === id)?.nome ?? "—";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-xl font-bold text-ink">Clientes</h1>
        <button className="btn btn-primary" onClick={() => setEditando("novo")}>
          + Novo cliente
        </button>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!clientes ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : clientes.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhum cliente cadastrado ainda.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Contato</th>
                <th className="px-4 py-3 font-medium">Origem</th>
                {isAdmin && <th className="px-4 py-3 font-medium">Corretor</th>}
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 font-medium text-ink">{c.nome}</td>
                  <td className="px-4 py-3 text-ink-soft">{[c.telefone, c.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.origem || "—"}</td>
                  {isAdmin && <td className="px-4 py-3 text-ink-soft">{nomeCorretor(c.corretor_id)}</td>}
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="text-primary text-xs font-medium hover:underline mr-3" onClick={() => setEditando(c)}>
                      editar
                    </button>
                    <button className="text-rust text-xs font-medium hover:underline" onClick={() => excluir(c)}>
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
        <Modal onClose={() => setEditando(null)} labelledBy="cliente-modal-title">
          <ClienteForm
            cliente={editando === "novo" ? null : editando}
            corretores={corretores}
            isAdmin={isAdmin}
            onSalvo={() => {
              setEditando(null);
              recarregar();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function ClienteForm({
  cliente,
  corretores,
  isAdmin,
  onSalvo,
}: {
  cliente: Cliente | null;
  corretores: Corretor[];
  isAdmin: boolean;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState(cliente?.nome ?? "");
  const [telefone, setTelefone] = useState(cliente?.telefone ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [cpf, setCpf] = useState(cliente?.cpf ?? "");
  const [origem, setOrigem] = useState(cliente?.origem ?? "");
  const [observacoes, setObservacoes] = useState(cliente?.observacoes ?? "");
  const [corretorId, setCorretorId] = useState(cliente?.corretor_id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const payload: Partial<Cliente> = {
        nome,
        telefone: telefone || null,
        email: email || null,
        cpf: cpf || null,
        origem: origem || null,
        observacoes: observacoes || null,
        ...(isAdmin ? { corretor_id: corretorId || null } : {}),
      };
      if (cliente) await api.atualizarCliente(cliente.id, payload);
      else await api.criarCliente(payload);
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8 grid gap-3">
      <h2 id="cliente-modal-title" className="text-lg font-bold text-ink mb-1">
        {cliente ? "Editar cliente" : "Novo cliente"}
      </h2>
      <input className="input" placeholder="Nome *" value={nome} onChange={(e) => setNome(e.target.value)} required />
      <div className="grid grid-cols-2 gap-3">
        <input className="input" placeholder="Telefone" value={telefone ?? ""} onChange={(e) => setTelefone(e.target.value)} />
        <input className="input" placeholder="E-mail" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input className="input" placeholder="CPF" value={cpf ?? ""} onChange={(e) => setCpf(e.target.value)} />
        <input
          className="input"
          placeholder="Origem (ex.: indicação)"
          value={origem ?? ""}
          onChange={(e) => setOrigem(e.target.value)}
        />
      </div>
      {isAdmin && (
        <select className="input" value={corretorId ?? ""} onChange={(e) => setCorretorId(e.target.value)}>
          <option value="">Sem corretor (lead livre)</option>
          {corretores.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      )}
      <textarea
        className="input"
        placeholder="Observações"
        rows={3}
        value={observacoes ?? ""}
        onChange={(e) => setObservacoes(e.target.value)}
      />
      {erro && <p className="text-rust text-sm">{erro}</p>}
      <button className="btn btn-primary mt-2" disabled={salvando}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
