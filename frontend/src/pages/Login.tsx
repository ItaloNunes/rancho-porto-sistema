import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { emailInterno } from "../lib/usuarios";

export default function Login() {
  const { session, entrar } = useAuth();
  const location = useLocation();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (session) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? "/painel";
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    // Login é por "usuário" (ex.: italo.nunes), não por e-mail — por baixo o
    // Supabase Auth continua usando um e-mail fabricado (ver lib/usuarios.ts),
    // mas isso é invisível pra quem está logando.
    const msg = await entrar(emailInterno(usuario), senha);
    setEnviando(false);
    if (msg) {
      // "Invalid login credentials" é o erro genérico do Supabase pra login/senha
      // errados. Qualquer outra mensagem (erro de rede, projeto mal configurado
      // etc.) é mostrada como veio, pra não esconder o problema real.
      setErro(msg.toLowerCase().includes("invalid login credentials") ? "Usuário ou senha incorretos." : msg);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg px-6">
      <div className="card w-full max-w-sm p-8">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-xs font-medium text-ink-soft hover:text-ink mb-6 -mt-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Voltar ao catálogo
        </Link>
        <Link to="/" className="block w-fit opacity-90 hover:opacity-100 transition-opacity mb-8">
          <img
            src="/brand/castel-logo.png"
            alt="Castel Construções e Incorporações"
            className="h-9 w-auto object-contain"
          />
        </Link>
        <h1 className="text-xl font-bold text-ink mb-1">Painel interno</h1>
        <p className="text-sm text-ink-soft mb-6">Entre com o usuário e a senha que o administrador criou pra você.</p>
        <form onSubmit={onSubmit} className="grid gap-3">
          <input
            className="input"
            type="text"
            placeholder="Usuário"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
          <input
            className="input"
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
          {erro && <p className="text-rust text-sm">{erro}</p>}
          <button className="btn btn-primary mt-2" disabled={enviando}>
            {enviando ? "Entrando..." : "Entrar"}
          </button>
        </form>
        <p className="text-xs text-ink-soft mt-6">Não tem login? Peça pro administrador cadastrar seu acesso.</p>
      </div>
    </div>
  );
}
