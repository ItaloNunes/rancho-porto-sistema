from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException, status

from .config import settings
from .database import get_supabase

ALGORITMO_JWT = "HS256"


def criar_token(corretor_id: str) -> str:
    """Emite o token de sessão do painel — login próprio, sem Supabase Auth.
    `sub` é o id da linha em `corretores` (não um user id de nenhum provedor
    externo)."""
    agora = datetime.now(timezone.utc)
    payload = {
        "sub": corretor_id,
        "iat": agora,
        "exp": agora + timedelta(hours=settings.jwt_validade_horas),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITMO_JWT)


def get_current_corretor(authorization: str | None = Header(default=None)) -> dict:
    """Exige um token válido emitido por POST /crm/login **e** que exista um
    cadastro ativo na tabela `corretores` com esse id.

    Logins são sempre criados pelo admin, pelo painel (POST /crm/corretores),
    nunca por auto-cadastro — por isso ter um token válido não basta: se o
    corretor foi desativado depois que o token foi emitido, o acesso é
    negado mesmo com um token que ainda não expirou (checa `ativo` fresco no
    banco a cada request).

    Retorna a linha completa do corretor (dict, com `id` e `papel`), que os
    endpoints usam pra decidir o que essa pessoa pode ver/editar.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Faça login para acessar o painel.")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITMO_JWT])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada, faça login de novo.")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida.")

    corretor_id = payload.get("sub")
    if not corretor_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida.")

    sb = get_supabase()
    corretor = sb.table("corretores").select("*").eq("id", corretor_id).limit(1).execute().data
    if not corretor or not corretor[0]["ativo"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Este login não tem acesso ao painel.")
    return corretor[0]


def require_admin(corretor: dict = Depends(get_current_corretor)) -> dict:
    """Mais restrito que get_current_corretor: só deixa passar quem tem
    papel='admin' (gestão de logins de outros corretores, por exemplo)."""
    if corretor["papel"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores podem fazer isso.")
    return corretor
