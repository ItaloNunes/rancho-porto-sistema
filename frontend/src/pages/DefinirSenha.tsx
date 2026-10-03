import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import FormTrocaSenha from "../components/FormTrocaSenha";

/** Tela de "Trocar senha" (link no topo do painel). Login próprio, sem
 * e-mail: só acessível já logado (ver RequireAuth em main.tsx) e pede a
 * senha atual pra confirmar quem está trocando. */
export default function DefinirSenha() {
  const navigate = useNavigate();
  const [sucesso, setSucesso] = useState(false);
  return (
    <div data-clarity-mask="True" className="min-h-screen grid place-items-center bg-bg px-4 py-10">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <Link to="/painel" className="text-xs font-medium text-ink-soft hover:text-ink">
          ← Voltar ao painel
        </Link>
        <h1 className="text-xl font-bold text-ink mt-4 mb-1">Trocar senha</h1>
        <p className="text-sm text-ink-soft mb-6">Confirme a senha atual e escolha a nova.</p>
        {sucesso ? (
          <p className="text-sage text-sm">Senha alterada! Voltando pro painel...</p>
        ) : (
          <FormTrocaSenha
            onConcluido={() => {
              setSucesso(true);
              setTimeout(() => navigate("/painel", { replace: true }), 1200);
            }}
          />
        )}
      </div>
    </div>
  );
}
