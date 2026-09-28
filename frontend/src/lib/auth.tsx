import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { getToken, setToken } from "./token";
import type { Corretor } from "../types";

// 15 min sem nenhuma interacao (mouse, teclado, toque, scroll) derruba a
// sessao sozinho e manda pro /login de novo -- pedido em 28/09 (painel
// fica aberto em computador compartilhado da imobiliaria/financeiro, e o
// JWT em si dura 30 dias -- ver backend/app/config.py -- entao sem isso a
// sessao continuava valida indefinidamente enquanto a aba ficasse aberta).
const LIMITE_INATIVIDADE_MS = 15 * 60 * 1000;
const EVENTOS_ATIVIDADE = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"] as const;

interface AuthState {
  /** Token da sessao do painel (JWT emitido por POST /crm/login). null =
   * nao logado. Login proprio, sem Supabase Auth -- ver backend/app/security.py. */
  session: string | null;
  /** Perfil do corretor (nome, papel, perfil_completo...) vindo de GET
   * /crm/me. null enquanto carrega ou se o login nao tiver um cadastro de
   * corretor correspondente. */
  perfil: Corretor | null;
  carregando: boolean;
  /** Mensagem a mostrar na tela de login depois de um `sair()` com motivo
   * (ex.: sessao encerrada por inatividade) -- null em um logout comum
   * (botao "Sair") ou quando nao ha nada pra avisar. Some sozinho assim
   * que o login seguinte da certo. */
  motivoSaida: string | null;
  entrar: (usuario: string, senha: string) => Promise<string | null>;
  /** `motivo`, se passado, fica em `motivoSaida` pra tela de login explicar
   * por que a sessao caiu (ex.: inatividade) -- omitido num logout manual
   * comum (botao "Sair"), que nao precisa de explicacao nenhuma. */
  sair: (motivo?: string) => void;
  /** Recarrega `perfil` a partir de GET /crm/me -- usado depois que o
   * proprio corretor completa o cadastro (PATCH /crm/me, ver
   * GateCompletarCadastro.tsx) pra `perfil_completo` virar true sem
   * precisar de um F5. */
  recarregarPerfil: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<string | null>(() => getToken());
  const [perfil, setPerfil] = useState<Corretor | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [motivoSaida, setMotivoSaida] = useState<string | null>(null);

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
        // token invalido/expirado -- encerra a sessao local em vez de deixar
        // o painel preso numa tela de "carregando" pra sempre.
        setToken(null);
        setSession(null);
        setPerfil(null);
      })
      .finally(() => setCarregando(false));
  }, [session]);

  // Timer de inatividade: so roda com sessao ativa. Qualquer evento de
  // atividade reinicia o contador; sem nenhum por 15 min, desloga sozinho
  // com um motivo (a tela de login mostra pro usuario por que caiu).
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!session) return;

    function reiniciarContador() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        sair("Sua sessao foi encerrada apos 15 minutos sem uso. Faca login de novo.");
      }, LIMITE_INATIVIDADE_MS);
    }

    reiniciarContador();
    EVENTOS_ATIVIDADE.forEach((ev) => window.addEventListener(ev, reiniciarContador, { passive: true }));

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      EVENTOS_ATIVIDADE.forEach((ev) => window.removeEventListener(ev, reiniciarContador));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function entrar(usuario: string, senha: string): Promise<string | null> {
    try {
      const resposta = await api.login(usuario, senha);
      setToken(resposta.access_token);
      setSession(resposta.access_token);
      setPerfil(resposta.corretor);
      setMotivoSaida(null);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  function sair(motivo?: string) {
    setToken(null);
    setSession(null);
    setPerfil(null);
    if (motivo) setMotivoSaida(motivo);
  }

  async function recarregarPerfil() {
    try {
      setPerfil(await api.meuPerfil());
    } catch {
      // se falhar, mantem o perfil anterior em memoria -- o proximo request
      // autenticado que falhar de verdade ja cuida de encerrar a sessao.
    }
  }

  return (
    <AuthContext.Provider value={{ session, perfil, carregando, motivoSaida, entrar, sair, recarregarPerfil }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
