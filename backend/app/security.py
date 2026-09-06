from fastapi import Depends, Header, HTTPException, status

from .database import get_supabase


def get_current_admin(authorization: str | None = Header(default=None)):
    """Exige um JWT válido de usuário Supabase Auth (login do painel interno).

    O front-end faz login com supabase-js (email/senha) e manda o access
    token aqui como `Authorization: Bearer <token>`. Qualquer usuário
    cadastrado no projeto Supabase Auth conta como "admin" — se no futuro
    for preciso diferenciar papéis, dá pra checar uma tabela `admins`
    aqui dentro.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Faça login para acessar o painel.")
    token = authorization.split(" ", 1)[1]
    try:
        user = get_supabase().auth.get_user(token)
    except Exception as exc:  # supabase-py levanta erro genérico em token inválido
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida ou expirada.") from exc
    if not user or not user.user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida ou expirada.")
    return user.user
