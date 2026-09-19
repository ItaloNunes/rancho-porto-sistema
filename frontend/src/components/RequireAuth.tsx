import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { temAcessoAdmin } from "../types";

/** Protege uma rota do painel: manda pro /login se não houver sessão válida,
 * pra uma tela de "sem permissão" se `adminOnly` e o papel não tiver acesso
 * admin (admin ou developer — ver temAcessoAdmin em types.ts), ou se
 * `developerOnly` e não for exatamente a conta developer (ver
 * PainelAtividade.tsx — nem outro admin entra aqui). */
export default function RequireAuth({
  children,
  adminOnly = false,
  developerOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  developerOnly?: boolean;
}) {
  const { session, perfil, carregando } = useAuth();
  const location = useLocation();

  if (carregando) {
    return <div className="max-w-6xl mx-auto px-6 py-20 text-ink-soft text-sm">Carregando...</div>;
  }

  if (!session || !perfil) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if ((adminOnly && !temAcessoAdmin(perfil.papel)) || (developerOnly && perfil.papel !== "developer")) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <p className="text-rust">Você não tem permissão pra acessar esta página.</p>
      </div>
    );
  }

  return <>{children}</>;
}
