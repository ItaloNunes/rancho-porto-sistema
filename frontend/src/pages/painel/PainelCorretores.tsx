import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api } from "../../lib/api";
import type { Corretor, CorretorImportadoItem, Papel } from "../../types";

export default function PainelCorretores() {
  const [corretores, setCorretores] = useState<Corretor[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Corretor | "novo" | null>(null);
  const [criado, setCriado] = useState<{ usuario: string; senha: string; motivo: "criado" | "resetado" } | null>(
    null,
  );
  const [importando, setImportando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState<CorretorImportadoItem[] | null>(null);

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

  async function importarDaPlanilha() {
    if (
      !confirm(
        "Isso cadastra de uma vez todos os corretores da planilha inicial (quem já tem login é pulado — pode rodar de novo com segurança). Continuar?",
      )
    )
      return;
    setImportando(true);
    setErro(null);
    try {
      const resultado = await api.importarCorretores();
      setResultadoImportacao(resultado);
      recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setImportando(false);
    }
  }

  function baixarCsvImportacao() {
    if (!resultadoImportacao) return;
    const linhas = [
      ["nome", "usuario", "senha", "ativo", "status"],
      ...resultadoImportacao.map((r) => [r.nome, r.usuario, r.senha ?? "", r.ativo ? "sim" : "não", r.status]),
    ];
    const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "corretores-login.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const criadosNaImportacao = resultadoImportacao?.filter((r) => r.status === "criado") ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-ink">Corretores</h1>
        <div className="flex gap-2">
          <button className="btn btn-outline" onClick={importarDaPlanilha} disabled={importando}>
            {importando ? "Importando..." : "Importar da planilha"}
          </button>
          <button className="btn btn-primary" onClick={() => setEditando("novo")}>
            + Novo login
          </button>
        </div>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {resultadoImportacao && (
        <div className="card p-4 mb-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm text-ink">
              Importação concluída: <strong>{criadosNaImportacao.length}</strong> login(s) criado(s) de{" "}
              {resultadoImportacao.length} linha(s) ({resultadoImportacao.filter((r) => r.status === "ja_existia").length} já
              existiam, {resultadoImportacao.filter((r) => r.status === "erro").length} com erro).
            </p>
            <div className="flex gap-2 shrink-0">
              <button className="btn btn-outline !py-1.5 !px-3 text-xs" onClick={baixarCsvImportacao}>
                Baixar tabela (CSV)
              </button>
              <button className="text-ink-soft text-xs hover:text-ink" onClick={() => setResultadoImportacao(null)}>
                fechar
              </button>
            </div>
          </div>
          {criadosNaImportacao.length > 0 && (
            <p className="text-xs text-ink-soft">
              Usuário = login; senha inicial = telefone da pessoa (só números). Baixe a tabela agora — essa é a única
              vez que as senhas aparecem em texto puro.
            </p>
          )}
        </div>
      )}

      {!corretores ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Usuário</th>
                <th className="px-4 py-3 font-medium">Papel</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {corretores.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 font-medium text-ink">{c.nome}</td>
                  <td className="px-4 py-3 text-ink-soft font-mono text-xs">{c.usuario || "—"}</td>
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
            onSalvo={(loginCriado) => {
              setEditando(null);
              if (loginCriado) setCriado(loginCriado);
              recarregar();
            }}
          />
        </Modal>
      )}

      {criado && (
        <Modal onClose={() => setCriado(null)} labelledBy="login-criado-title">
          <div className="p-6 sm:p-8 grid gap-3">
            <h2 id="login-criado-title" className="text-lg font-bold text-ink mb-1">
              {criado.motivo === "resetado" ? "Senha atualizada" : "Login criado"}
            </h2>
            <p className="text-sm text-ink-soft">
              Repasse esses dados pro corretor — a senha não aparece de novo depois que essa janela fechar.
            </p>
            <div className="card p-4 grid gap-1 font-mono text-sm">
              <span>
                usuário: <strong>{criado.usuario}</strong>
              </span>
              <span>
                senha: <strong>{criado.senha}</strong>
              </span>
            </div>
            <button className="btn btn-primary mt-2" onClick={() => setCriado(null)}>
              Entendi
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CorretorForm({
  corretor,
  onSalvo,
}: {
  corretor: Corretor | null;
  onSalvo: (loginCriado?: { usuario: string; senha: string; motivo: "criado" | "resetado" }) => void;
}) {
  const [nome, setNome] = useState(corretor?.nome ?? "");
  const [usuario, setUsuario] = useState(corretor?.usuario ?? "");
  const [telefone, setTelefone] = useState(corretor?.telefone ?? "");
  const [papel, setPapel] = useState<Papel>(corretor?.papel ?? "corretor");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [resetando, setResetando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      if (corretor) {
        const atualizado = await api.atualizarCorretor(corretor.id, { nome, telefone: telefone || null, papel });
        // Backend só devolve `senha` quando ela acabou de ser (re)sincronizada
        // com o telefone (ex.: telefone mudou e a senha ainda era a padrão) —
        // se o corretor já tinha customizado a própria senha, nada muda aqui.
        onSalvo(atualizado.senha ? { usuario: corretor.usuario ?? "", senha: atualizado.senha, motivo: "resetado" } : undefined);
      } else {
        const criado = await api.criarCorretor({ nome, telefone, usuario: usuario || null, papel });
        onSalvo({ usuario: criado.usuario ?? "", senha: criado.senha, motivo: "criado" });
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function resetarSenha() {
    if (!corretor) return;
    if (
      !confirm(
        `Voltar a senha de "${corretor.nome}" pro telefone atual (${corretor.telefone || "—"}, só números)? A senha customizada por ele, se houver, deixa de valer.`,
      )
    )
      return;
    setErro(null);
    setResetando(true);
    try {
      const atualizado = await api.atualizarCorretor(corretor.id, { resetar_senha: true });
      if (atualizado.senha) {
        onSalvo({ usuario: corretor.usuario ?? "", senha: atualizado.senha, motivo: "resetado" });
      } else {
        onSalvo();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setResetando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8 grid gap-3">
      <h2 id="corretor-modal-title" className="text-lg font-bold text-ink mb-1">
        {corretor ? "Editar corretor" : "Novo login de corretor"}
      </h2>
      {!corretor && (
        <p className="text-xs text-ink-soft -mt-1 mb-1">
          A senha inicial é o telefone (só números). Deixe "usuário" em branco pra gerar automático a partir do nome.
        </p>
      )}
      {corretor && (
        <p className="text-xs text-ink-soft -mt-1 mb-1">
          {corretor.senha_customizada
            ? "Esse corretor já trocou a própria senha — mudar o telefone aqui não altera o login dele."
            : "Mudar o telefone também troca a senha de login pra ele (só números) — avise o corretor."}
        </p>
      )}
      <input className="input" placeholder="Nome *" value={nome} onChange={(e) => setNome(e.target.value)} required />
      {!corretor && (
        <input
          className="input"
          placeholder="Usuário (opcional — ex.: italo.nunes)"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
        />
      )}
      <input
        className="input"
        placeholder={corretor ? "Telefone" : "Telefone * (vira a senha)"}
        value={telefone ?? ""}
        onChange={(e) => setTelefone(e.target.value)}
        required={!corretor}
      />
      <select className="input" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
        <option value="corretor">Corretor</option>
        <option value="admin">Admin</option>
      </select>
      {corretor && (
        <button
          type="button"
          className="btn btn-outline text-xs justify-self-start"
          onClick={resetarSenha}
          disabled={resetando || salvando}
        >
          {resetando ? "Resetando..." : "Resetar senha (usar o telefone atual)"}
        </button>
      )}
      {erro && <p className="text-rust text-sm">{erro}</p>}
      <button className="btn btn-primary mt-2" disabled={salvando}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
