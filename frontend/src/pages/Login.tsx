import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import CampoSenha from "../components/CampoSenha";
import { useAuth } from "../lib/auth";

/** Login do painel (redesenho de 03/10): mostrar/ocultar senha, aviso de
 * Caps Lock, mensagem clara quando o acesso fica bloqueado por excesso de
 * tentativas, e o caminho pra quem esqueceu a senha (o admin redefine). */
export default function Login() {
  const { session, entrar, motivoSaida } = useAuth();
  const location = useLocation();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ajuda, setAjuda] = useState(false);

  if (session) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? "/painel";
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario.trim() || !senha) {
      setErro("Preencha o usuário e a senha.");
      return;
    }
    setErro(null);
    setEnviando(true);
    const msg = await entrar(usuario, senha);
    setEnviando(false);
    if (msg) {
      setErro(msg);
      setSenha("");
    }
  }

  const bloqueado = !!erro && /Muitas tentativas/.test(erro);

  return (
    <div data-clarity-mask="True" className="min-h-screen bg-bg lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Lado da marca (só em tela grande) */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-primary-dark text-white p-12">
        <img
          src="/brand/porto-franco-aerial.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-25"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-primary-dark via-primary-dark/70 to-primary-dark/30" />
        <Link to="/" className="relative w-fit">
          <span className="inline-block rounded-lg bg-white px-4 py-3">
            <img src="/brand/castel-logo.png" alt="Castel Construções e Incorporações" className="h-8 w-auto object-contain" />
          </span>
        </Link>
        <div className="relative max-w-md">
          <p className="text-xs uppercase tracking-[0.18em] text-white/70 mb-3">Painel interno</p>
          <h2 className="text-3xl font-bold leading-tight text-balance">
            Reservas, propostas e contratos do Porto Franco e do Rancho Texas.
          </h2>
          <p className="mt-4 text-sm text-white/75">
            Acesso só para corretores e equipe Castel com login criado pelo administrador.
          </p>
        </div>
      </aside>

      {/* Formulário */}
      <main className="min-h-screen lg:min-h-0 grid place-items-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft hover:text-ink mb-8">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Voltar ao catálogo
          </Link>
          <img
            src="/brand/castel-logo.png"
            alt="Castel Construções e Incorporações"
            className="h-9 w-auto object-contain mb-8 lg:hidden"
          />
          <h1 className="text-2xl font-bold text-ink">Entrar no painel</h1>
          <p className="text-sm text-ink-soft mt-1 mb-6">Use o usuário e a senha que o administrador criou para você.</p>

          {motivoSaida && !erro && (
            <p role="status" className="text-sm text-ink bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              {motivoSaida}
            </p>
          )}

          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <div className="grid gap-1.5">
              <label htmlFor="login-usuario" className="text-xs font-semibold text-ink-soft">
                Usuário
              </label>
              <input
                id="login-usuario"
                className="input"
                type="text"
                placeholder="nome.sobrenome"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
              />
            </div>
            <CampoSenha id="login-senha" label="Senha" valor={senha} onChange={setSenha} autoComplete="current-password" />

            {erro && (
              <div
                id="login-erro"
                role="alert"
                className={`text-sm rounded-lg px-3 py-2 border ${
                  bloqueado ? "bg-amber-50 border-amber-200 text-ink" : "bg-rust/10 border-rust/30 text-rust"
                }`}
              >
                {bloqueado && <strong className="block mb-0.5">Acesso bloqueado por 15 minutos</strong>}
                {erro}
              </div>
            )}

            <button className="btn btn-primary mt-1 disabled:opacity-60" disabled={enviando}>
              {enviando ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
                  </svg>
                  Entrando...
                </span>
              ) : (
                "Entrar"
              )}
            </button>
          </form>

          <div className="mt-6 border-t border-border pt-4">
            <button
              type="button"
              className="text-sm font-medium text-primary hover:underline"
              aria-expanded={ajuda}
              onClick={() => setAjuda((v) => !v)}
            >
              Esqueci minha senha / não tenho login
            </button>
            {ajuda && (
              <p className="text-sm text-ink-soft mt-2">
                Fale com o administrador do sistema. Ele redefine o seu acesso, e no próximo login você cria uma senha
                nova, só sua. Por segurança, ninguém da equipe vai pedir a sua senha por telefone ou WhatsApp.
              </p>
            )}
          </div>

          <p className="mt-8 flex items-center gap-1.5 text-[11px] text-ink-soft">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Acesso restrito. Entradas e tentativas são registradas.
          </p>
        </div>
      </main>
    </div>
  );
}
