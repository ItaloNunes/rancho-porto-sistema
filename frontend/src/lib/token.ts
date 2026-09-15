// Guarda o token de sessão do painel (JWT emitido por POST /crm/login) —
// login próprio, sem Supabase Auth. Só o `localStorage`, então a sessão
// persiste entre abas/recarregamentos até o token expirar ou a pessoa sair.
const CHAVE = "painel_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    // localStorage indisponível (aba anônima com armazenamento bloqueado,
    // etc.) — a sessão simplesmente não persiste entre recarregamentos.
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(CHAVE, token);
    else localStorage.removeItem(CHAVE);
  } catch {
    // idem — melhor esforço, não trava o login/logout por causa disso.
  }
}
