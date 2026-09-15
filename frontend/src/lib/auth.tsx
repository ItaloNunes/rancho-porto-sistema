import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { getToken, setToken } from "./token";
import type { Corretor } from "../types";

interface AuthState {
  /** Token da sessão do painel (JWT emitido por POST /crm/login). null =
   * não logado. Login próprio, sem Supabase Auth — ver backend/app/security.py. */
  session: string | null;
  /** Perfil do corretor (nome, papel) vindo de GET /crm/me. null enquanto
   * carrega ou se o login não tiver um cadastro de corretor correspondente. */
  perfil: Corretor | null;
  carregando: boolean;
  entrar: (usuario: string, senha: string) => Promise<string | null>;
  sair: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<string | null>(() => getToken());
  const [perfil, setPerfil] = useState<Corretor | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!session) {
      setPerfil(null);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    api
      .meuPerfil()
      .then(setPerfil)
      .catch(() => {
        // token inválido/expirado — encerra a sessão local em vez de deixar
        // o painel preso numa tela de "carregando" pra sempre.
        setToken(null);
        setSession(null);
        setPerfil(null);
      })
      .finally(() => setCarregando(false));
  }, [session]);

  async function entrar(usuario: string, senha: string): Promise<string | null> {
    try {
      const resposta = await api.login(usuario, senha);
      setToken(resposta.access_token);
      setSession(resposta.access_token);
      setPerfil(resposta.corretor);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  function sair() {
    setToken(null);
    setSession(null);
    setPerfil(null);
  }

  return (
    <AuthContext.Provider value={{ session, perfil, carregando, entrar, sair }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
