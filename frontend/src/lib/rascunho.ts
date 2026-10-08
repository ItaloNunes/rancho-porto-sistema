/** Rascunho automático dos formulários do painel (08/10): o que o corretor
 * está digitando fica guardado neste navegador enquanto ele preenche — se a
 * sessão cair por inatividade (ou ele fechar a janela sem querer), ao
 * entrar de novo o formulário oferece continuar de onde parou.
 *
 * Fica só neste navegador, separado por usuário, e some sozinho depois de
 * 3 dias, quando a proposta/reserva é criada ou quando a pessoa descarta. */
import { useEffect, useRef } from "react";
import { getToken } from "./token";

const PREFIXO = "rascunho:";
const VALIDADE_MS = 3 * 24 * 60 * 60 * 1000;

export interface Rascunho<T> {
  dados: T;
  salvoEm: number;
}

/** Id do usuário logado (do token), pra um corretor nunca ver o rascunho de outro no mesmo computador. */
function usuarioAtual(): string | null {
  const t = getToken();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function chaveCompleta(chave: string, usuario: string | null = usuarioAtual()): string | null {
  return usuario ? `${PREFIXO}${usuario}:${chave}` : null;
}

export function lerRascunho<T>(chave: string): Rascunho<T> | null {
  const k = chaveCompleta(chave);
  if (!k) return null;
  try {
    const bruto = localStorage.getItem(k);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rascunho<T>;
    if (!r || typeof r.salvoEm !== "number" || Date.now() - r.salvoEm > VALIDADE_MS) {
      localStorage.removeItem(k);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

export function salvarRascunho<T>(chave: string, dados: T): void {
  const k = chaveCompleta(chave);
  if (!k) return;
  try {
    localStorage.setItem(k, JSON.stringify({ dados, salvoEm: Date.now() } satisfies Rascunho<T>));
  } catch {
    // navegador sem espaço/bloqueado: segue sem rascunho
  }
}

export function apagarRascunho(chave: string): void {
  const k = chaveCompleta(chave);
  if (!k) return;
  try {
    localStorage.removeItem(k);
  } catch {
    /* nada */
  }
}

/** Limpa rascunhos vencidos de todo mundo neste navegador. */
export function limparRascunhosVencidos(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIXO)) continue;
      try {
        const r = JSON.parse(localStorage.getItem(k) || "null");
        if (!r || Date.now() - r.salvoEm > VALIDADE_MS) localStorage.removeItem(k);
      } catch {
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* nada */
  }
}

export const EVENTO_SALVAR_AGORA = "painel:salvar-rascunho";

/** Salva `estado` (com uma pausa curta enquanto a pessoa digita) sempre que
 * mudar, e na hora quando a sessão está prestes a cair (EVENTO_SALVAR_AGORA)
 * ou a janela fecha. `ativo=false` não salva (ex.: nada digitado ainda). */
export function useRascunhoAutomatico<T>(chave: string | null, estado: T, ativo: boolean): void {
  const ultimo = useRef(estado);
  ultimo.current = estado;
  useEffect(() => {
    if (!chave || !ativo) return;
    const t = setTimeout(() => salvarRascunho(chave, estado), 600);
    return () => clearTimeout(t);
  }, [chave, estado, ativo]);
  useEffect(() => {
    if (!chave) return;
    const agora = () => ativo && salvarRascunho(chave, ultimo.current);
    window.addEventListener(EVENTO_SALVAR_AGORA, agora);
    window.addEventListener("pagehide", agora);
    return () => {
      window.removeEventListener(EVENTO_SALVAR_AGORA, agora);
      window.removeEventListener("pagehide", agora);
    };
  }, [chave, ativo]);
}

export function quandoFoiSalvo(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} às ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
