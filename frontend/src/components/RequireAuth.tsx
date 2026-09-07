import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

/** Protege uma rota do painel: manda pro /login se não houver sessão válida
 * (ou pra uma tela de "sem permissão" se `adminOnly` e o papel não for admin). */
export default function RequireAuth({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const { session, perfil, carregando } = useAuth();
  const location = useLocation();

  if (carregando) {
    return <div className="max-w-6xl mx-auto px-6 py-20 text-ink-soft text-sm">Carregando...</div>;
  }

  if (!session || !perfil) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (adminOnly && perfil.papel !== "admin") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <p className="text-rust">Você não tem permissão pra acessar esta página.</p>
      </div>
    );
  }

  return <>{children}</>;
}
