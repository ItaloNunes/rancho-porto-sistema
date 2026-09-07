import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api } from "../../lib/api";
import type { Corretor, Papel } from "../../types";

export default function PainelCorretores() {
  const [corretores, setCorretores] = useState<Corretor[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Corretor | "novo" | null>(null);

  function recarregar() {
    setErro(null);
    api.listarCorretores().then(setCorretores).catch((e) => setErro(e.message));
  }

  useEffect(recarregar, []);

  async function alternarAtivo(c: Corretor) {
    const acao = c.ativo ? "desativar" : "reativar";
    if (!confirm(`Confirma ${acao} o login de "${c.nome}"?`)) return;
    try {
      await api.atualizarCorretor(c.id, { ativo: !c.ativo });
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-xl font-bold text-ink">Corretores</h1>
        <button className="btn btn-primary" onClick={() => setEditando("novo")}>
          + Novo login
        </button>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!corretores ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">E-mail</th>
                <th className="px-4 py-3 font-medium">Papel</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {corretores.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 font-medium text-ink">{c.nome}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.email || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft uppercase text-xs">{c.papel}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${c.ativo ? "badge-disponivel" : "badge-vendido"}`}>
                      {c.ativo ? "Ativo" : "Desativado"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="text-primary text-xs font-medium hover:underline mr-3" onClick={() => setEditando(c)}>
                      editar
                    </button>
                    <button className="text-rust text-xs font-medium hover:underline" onClick={() => alternarAtivo(c)}>
                      {c.ativo ? "desativar" : "reativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <Modal onClose={() => setEditando(null)} labelledBy="corretor-modal-title">
          <CorretorForm
            corretor={editando === "novo" ? null : editando}
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

function CorretorForm({ corretor, onSalvo }: { corretor: Corretor | null; onSalvo: () => void }) {
  const [nome, setNome] = useState(corretor?.nome ?? "");
  const [email, setEmail] = useState(corretor?.email ?? "");
  const [telefone, setTelefone] = useState(corretor?.telefone ?? "");
  const [papel, setPapel] = useState<Papel>(corretor?.papel ?? "corretor");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      if (corretor) {
        await api.atualizarCorretor(corretor.id, { nome, telefone: telefone || null, papel });
      } else {
        await api.criarCorretor({ nome, email, telefone: telefone || null, papel });
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
      <h2 id="corretor-modal-title" className="text-lg font-bold text-ink mb-1">
        {corretor ? "Editar corretor" : "Novo login de corretor"}
      </h2>
      {!corretor && (
        <p className="text-xs text-ink-soft -mt-1 mb-1">
          A pessoa recebe um e-mail de convite com um link pra definir a própria senha.
        </p>
      )}
      <input className="input" placeholder="Nome *" value={nome} onChange={(e) => setNome(e.target.value)} required />
      <input
        className="input"
        type="email"
        placeholder="E-mail *"
        value={email ?? ""}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={!!corretor}
      />
      <input className="input" placeholder="Telefone" value={telefone ?? ""} onChange={(e) => setTelefone(e.target.value)} />
      <select className="input" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
        <option value="corretor">Corretor</option>
        <option value="admin">Admin</option>
      </select>
      {erro && <p className="text-rust text-sm">{erro}</p>}
      <button className="btn btn-primary mt-2" disabled={salvando}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
