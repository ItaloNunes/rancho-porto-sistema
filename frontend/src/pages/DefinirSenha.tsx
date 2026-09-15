import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

/** Tela de "Trocar senha" — login próprio (usuário + senha), sem Supabase
 * Auth: não existe mais link de convite/recuperação por e-mail, então isso
 * só é acessível já logado (ver RequireAuth em main.tsx), e pede a senha
 * atual pra confirmar quem está trocando. */
export default function DefinirSenha() {
  const navigate = useNavigate();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 6) {
      setErro("A senha nova precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setErro("As senhas não conferem.");
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.trocarMinhaSenha(senhaAtual, senha);
      setSucesso(true);
      setTimeout(() => navigate("/painel", { replace: true }), 1200);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg px-6">
      <div className="card w-full max-w-sm p-8">
        <h1 className="text-xl font-bold text-ink mb-1">Trocar senha</h1>
        <p className="text-sm text-ink-soft mb-6">Confirme a senha atual e escolha a nova.</p>

        {sucesso ? (
          <p className="text-sage text-sm">Senha alterada! Voltando pro painel...</p>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-3">
            <input
              className="input"
              type="password"
              placeholder="Senha atual"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              autoComplete="current-password"
              required
              autoFocus
            />
            <input
              className="input"
              type="password"
              placeholder="Nova senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
            <input
              className="input"
              type="password"
              placeholder="Confirmar nova senha"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
            {erro && <p className="text-rust text-sm">{erro}</p>}
            <button className="btn btn-primary mt-2" disabled={enviando}>
              {enviando ? "Salvando..." : "Salvar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
