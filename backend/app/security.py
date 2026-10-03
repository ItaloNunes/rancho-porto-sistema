import hashlib
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException, Request, status

from .config import settings
from .database import get_supabase

ALGORITMO_JWT = "HS256"


# Duração da sessão por papel (03/10): quem mexe em financeiro/contratos
# entra de novo todo dia; corretor em campo, uma vez por semana.
VALIDADE_HORAS = {"admin": 12, "developer": 12, "corretor": 24 * 7}

# Enquanto a senha for a inicial (o telefone), só dá pra ver o próprio
# perfil e trocar a senha -- todo o resto do painel fica bloqueado (03/10).
ROTAS_LIVRES_SEM_TROCA = {("GET", "/crm/me"), ("POST", "/crm/me/senha")}
MSG_TROCA_OBRIGATORIA = "Troque sua senha antes de continuar (a senha inicial é o seu telefone)."


def impressao_senha(senha_hash: str | None) -> str:
    """Impressão digital curta do hash da senha, gravada no token: trocar
    ou resetar a senha invalida TODAS as sessões abertas antes disso
    (inclusive num celular perdido)."""
    return hashlib.sha256((senha_hash or "").encode("utf-8")).hexdigest()[:16]


def criar_token(corretor: dict) -> str:
    """Emite o token de sessão do painel — login próprio, sem Supabase Auth.
    `sub` é o id da linha em `corretores`; `pv` amarra o token à senha atual."""
    agora = datetime.now(timezone.utc)
    horas = VALIDADE_HORAS.get(corretor.get("papel") or "corretor", 24 * 7)
    payload = {
        "sub": corretor["id"],
        "pv": impressao_senha(corretor.get("senha_hash")),
        "iat": agora,
        "exp": agora + timedelta(hours=horas),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITMO_JWT)


def get_current_corretor(request: Request, authorization: str | None = Header(default=None)) -> dict:
    """Exige um token válido emitido por POST /crm/login **e** que exista um
    cadastro ativo na tabela `corretores` com esse id.

    Logins são sempre criados pelo admin, pelo painel (POST /crm/corretores),
    nunca por auto-cadastro — por isso ter um token válido não basta: se o
    corretor foi desativado depois que o token foi emitido, o acesso é
    negado mesmo com um token que ainda não expirou (checa `ativo` fresco no
    banco a cada request). Desde 03/10 também cai se a senha mudou depois
    do login (`pv`), e enquanto a senha for a inicial só libera trocar a senha.

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
    corretor = corretor[0]
    if payload.get("pv") != impressao_senha(corretor.get("senha_hash")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sua senha foi alterada — faça login de novo.")
    if not corretor.get("senha_customizada") and (request.method, request.url.path) not in ROTAS_LIVRES_SEM_TROCA:
        raise HTTPException(status.HTTP_403_FORBIDDEN, MSG_TROCA_OBRIGATORIA)
    return corretor


def eh_admin(corretor: dict) -> bool:
    """'developer' é um admin "e mais um pouco" (ver require_developer) —
    tem todo o acesso de admin, mais a tela de Atividade, só pra essa conta.
    Centraliza aqui pra nenhuma checagem de permissão espalhada pelo código
    (routers/crm.py, reservas.py, qualificacao.py) esquecer de tratar
    'developer' como admin e acabar rebaixando essa conta pra corretor comum
    em alguma ação."""
    return corretor["papel"] in ("admin", "developer")


def require_admin(corretor: dict = Depends(get_current_corretor)) -> dict:
    """Mais restrito que get_current_corretor: só deixa passar quem tem
    papel='admin' (ou 'developer', ver eh_admin) — gestão de logins de
    outros corretores, por exemplo."""
    if not eh_admin(corretor):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores podem fazer isso.")
    return corretor


def require_developer(corretor: dict = Depends(get_current_corretor)) -> dict:
    """Mais restrito ainda que require_admin: só o login pessoal marcado
    papel='developer' passa — usado só pela tela de Atividade (ver
    routers/crm.py::listar_atividade), que nem os outros admins têm acesso.
    Não existe like nenhum jeito de virar 'developer' pelo painel (ver
    criar_corretor/atualizar_corretor) — só é setado direto no banco."""
    if corretor["papel"] != "developer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso restrito.")
    return corretor
