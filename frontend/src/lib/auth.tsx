import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { supabase } from "./supabase";
import type { Corretor } from "../types";

interface AuthState {
  /** Sessão do Supabase Auth (token bruto). null = não logado. */
  session: Session | null;
  /** Perfil do corretor (nome, papel) vindo de GET /crm/me. null enquanto
   * carrega ou se o login não tiver um cadastro de corretor correspondente. */
  perfil: Corretor | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<string | null>;
  sair: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Corretor | null>(null);
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCarregandoSessao(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, novaSessao) => {
      setSession(novaSessao);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setPerfil(null);
      return;
    }
    setCarregandoPerfil(true);
    api
      .meuPerfil()
      .then(setPerfil)
      .catch(() => setPerfil(null))
      .finally(() => setCarregandoPerfil(false));
  }, [session]);

  async function entrar(email: string, senha: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    return error ? error.message : null;
  }

  async function sair() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ session, perfil, carregando: carregandoSessao || carregandoPerfil, entrar, sair }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
