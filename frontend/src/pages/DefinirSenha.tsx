import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/** Página de destino do link enviado por e-mail (convite de um corretor novo
 * ou recuperação de senha). O supabase-js já estabelece a sessão sozinho a
 * partir do token na URL (detectSessionInUrl, padrão) — aqui só checamos se
 * deu certo e pedimos a nova senha. */
export default function DefinirSenha() {
  const navigate = useNavigate();
  const [pronto, setPronto] = useState(false);
  const [linkInvalido, setLinkInvalido] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setLinkInvalido(!data.session);
      setPronto(true);
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) {
      setErro("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setErro("As senhas não conferem.");
      return;
    }
    setErro(null);
    setEnviando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setEnviando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    setSucesso(true);
    setTimeout(() => navigate("/painel", { replace: true }), 1200);
  }

  if (!pronto) {
    return <div className="max-w-6xl mx-auto px-6 py-20 text-ink-soft text-sm">Carregando...</div>;
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg px-6">
      <div className="card w-full max-w-sm p-8">
        <h1 className="text-xl font-bold text-ink mb-1">Defina sua senha</h1>
        <p className="text-sm text-ink-soft mb-6">Essa vai ser a senha do seu login no painel a partir de agora.</p>

        {linkInvalido ? (
          <p className="text-rust text-sm">
            Link inválido ou expirado. Peça um novo convite pro administrador do painel.
          </p>
        ) : sucesso ? (
          <p className="text-sage text-sm">Senha definida! Entrando...</p>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-3">
            <input
              className="input"
              type="password"
              placeholder="Nova senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              minLength={8}
              autoFocus
            />
            <input
              className="input"
              type="password"
              placeholder="Confirmar senha"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              required
              minLength={8}
            />
            {erro && <p className="text-rust text-sm">{erro}</p>}
            <button className="btn btn-primary mt-2" disabled={enviando}>
              {enviando ? "Salvando..." : "Salvar e entrar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
