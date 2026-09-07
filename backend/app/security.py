from fastapi import Depends, Header, HTTPException, status

from .database import get_supabase


def get_current_corretor(authorization: str | None = Header(default=None)) -> dict:
    """Exige um JWT válido de usuário Supabase Auth **e** que exista um
    cadastro ativo na tabela `corretores` vinculado a esse usuário
    (auth_user_id).

    Logins são sempre criados pelo admin, pelo painel (POST /crm/corretores),
    nunca por auto-cadastro — por isso ter um token válido não basta: se não
    existir corretor correspondente (ou ele estiver desativado), o acesso é
    negado mesmo com uma sessão Supabase Auth válida.

    Retorna a linha completa do corretor (dict, com `id` e `papel`), que os
    endpoints usam pra decidir o que essa pessoa pode ver/editar.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Faça login para acessar o painel.")
    token = authorization.split(" ", 1)[1]
    sb = get_supabase()
    try:
        user = sb.auth.get_user(token)
    except Exception as exc:  # supabase-py levanta erro genérico em token inválido
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida ou expirada.") from exc
    if not user or not user.user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida ou expirada.")

    corretor = (
        sb.table("corretores").select("*").eq("auth_user_id", user.user.id).limit(1).execute().data
    )
    if not corretor or not corretor[0]["ativo"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Este login não tem acesso ao painel.")
    return corretor[0]


def require_admin(corretor: dict = Depends(get_current_corretor)) -> dict:
    """Mais restrito que get_current_corretor: só deixa passar quem tem
    papel='admin' (gestão de logins de outros corretores, por exemplo)."""
    if corretor["papel"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores podem fazer isso.")
    return corretor
