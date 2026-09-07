"""Painel gerencial (CRM): clientes/leads, corretores e propostas de compra
e venda. Tudo aqui exige login (ver security.get_current_corretor) — nada é
exposto no catálogo público.

Dois papéis:
- **admin**: gerencia logins de corretores (cria/edita/desativa) e vê tudo.
- **corretor**: vê e edita só os próprios clientes/propostas — mais os
  "leads" ainda sem corretor_id definido, que qualquer um pode reivindicar
  (útil pra reservas feitas direto pelo cliente no catálogo público, sem
  corretor envolvido ainda).

A geração do PDF da proposta de compra e venda ainda não está implementada:
o texto/modelo do contrato (cláusulas, condições padrão, dados da
incorporadora) precisa vir da imobiliária antes de existir algo confiável
para gerar. Por enquanto o endpoint só guarda os dados da proposta.
"""

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..database import get_supabase
from ..schemas import (
    Cliente,
    ClienteCreate,
    ClienteUpdate,
    Corretor,
    CorretorCreate,
    CorretorUpdate,
    LoteComCondominio,
    Proposta,
    PropostaCreate,
    PropostaDetalhe,
    PropostaStatusUpdate,
    PropostaUpdate,
)
from ..security import get_current_corretor, require_admin

router = APIRouter(tags=["crm"])


@router.get("/me", response_model=Corretor)
def meu_perfil(corretor: dict = Depends(get_current_corretor)):
    """O front usa isso pra saber quem está logado e qual o papel (admin ou
    corretor), pra decidir o que mostrar no painel."""
    return corretor


# ---------------------------------------------------------------------------
# Corretores (logins do painel) — só admin gerencia.
# ---------------------------------------------------------------------------


@router.get("/corretores", response_model=list[Corretor])
def listar_corretores(_admin: dict = Depends(require_admin)):
    return get_supabase().table("corretores").select("*").order("nome").execute().data


@router.post("/corretores", response_model=Corretor)
def criar_corretor(payload: CorretorCreate, _admin: dict = Depends(require_admin)):
    sb = get_supabase()
    existente = sb.table("corretores").select("id").eq("email", payload.email).limit(1).execute().data
    if existente:
        raise HTTPException(409, "Já existe um login com esse e-mail.")
    try:
        convite = sb.auth.admin.invite_user_by_email(
            payload.email,
            {"redirect_to": f"{settings.frontend_url}/definir-senha"},
        )
    except Exception as exc:  # e-mail inválido, SMTP não configurado, etc.
        raise HTTPException(400, f"Não foi possível enviar o convite: {exc}") from exc
    row = {
        "auth_user_id": convite.user.id,
        "nome": payload.nome,
        "email": payload.email,
        "telefone": payload.telefone,
        "papel": payload.papel,
        "ativo": True,
    }
    return sb.table("corretores").insert(row).execute().data[0]


@router.patch("/corretores/{corretor_id}", response_model=Corretor)
def atualizar_corretor(corretor_id: str, payload: CorretorUpdate, _admin: dict = Depends(require_admin)):
    sb = get_supabase()
    existente = sb.table("corretores").select("*").eq("id", corretor_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Corretor não encontrado.")
    existente = existente[0]
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        return existente
    atualizado = sb.table("corretores").update(updates).eq("id", corretor_id).execute().data[0]
    # Ativar/desativar aqui também trava (ou destrava) o login no Supabase
    # Auth de fato — não só a linha desta tabela.
    if "ativo" in updates and existente.get("auth_user_id"):
        ban = "876000h" if updates["ativo"] is False else "none"
        try:
            sb.auth.admin.update_user_by_id(existente["auth_user_id"], {"ban_duration": ban})
        except Exception:
            pass
    return atualizado


@router.delete("/corretores/{corretor_id}", status_code=204)
def desativar_corretor(corretor_id: str, admin: dict = Depends(require_admin)):
    """"Excluir" aqui é desativar: mantém o histórico de clientes/propostas
    do corretor intacto e bloqueia o login dele no Supabase Auth."""
    if corretor_id == admin["id"]:
        raise HTTPException(400, "Você não pode desativar o próprio login.")
    sb = get_supabase()
    existente = sb.table("corretores").select("auth_user_id").eq("id", corretor_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Corretor não encontrado.")
    sb.table("corretores").update({"ativo": False}).eq("id", corretor_id).execute()
    if existente[0].get("auth_user_id"):
        try:
            sb.auth.admin.update_user_by_id(existente[0]["auth_user_id"], {"ban_duration": "876000h"})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Clientes / leads
# ---------------------------------------------------------------------------


def _pode_mexer_no_cliente(corretor: dict, cliente: dict) -> bool:
    return corretor["papel"] == "admin" or cliente.get("corretor_id") in (None, corretor["id"])


@router.get("/clientes", response_model=list[Cliente])
def listar_clientes(corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    query = sb.table("clientes").select("*").order("nome")
    if corretor["papel"] != "admin":
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    return query.execute().data


@router.post("/clientes", response_model=Cliente)
def criar_cliente(payload: ClienteCreate, corretor: dict = Depends(get_current_corretor)):
    data = payload.model_dump()
    if corretor["papel"] != "admin":
        data["corretor_id"] = corretor["id"]
    return get_supabase().table("clientes").insert(data).execute().data[0]


@router.patch("/clientes/{cliente_id}", response_model=Cliente)
def atualizar_cliente(cliente_id: str, payload: ClienteUpdate, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    existente = sb.table("clientes").select("*").eq("id", cliente_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Cliente não encontrado.")
    existente = existente[0]
    if not _pode_mexer_no_cliente(corretor, existente):
        raise HTTPException(403, "Este cliente é de outro corretor.")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if corretor["papel"] != "admin":
        updates.pop("corretor_id", None)  # corretor comum não reatribui cliente pra outro
    if not updates:
        return existente
    return sb.table("clientes").update(updates).eq("id", cliente_id).execute().data[0]


@router.delete("/clientes/{cliente_id}", status_code=204)
def excluir_cliente(cliente_id: str, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    existente = sb.table("clientes").select("*").eq("id", cliente_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Cliente não encontrado.")
    if not _pode_mexer_no_cliente(corretor, existente[0]):
        raise HTTPException(403, "Este cliente é de outro corretor.")
    sb.table("clientes").delete().eq("id", cliente_id).execute()


# ---------------------------------------------------------------------------
# Propostas de compra e venda
# ---------------------------------------------------------------------------


def _pode_mexer_na_proposta(corretor: dict, proposta: dict) -> bool:
    return corretor["papel"] == "admin" or proposta.get("corretor_id") in (None, corretor["id"])


@router.get("/propostas", response_model=list[PropostaDetalhe])
def listar_propostas(corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    query = sb.table("propostas").select("*, lote:lotes(*), cliente:clientes(*)").order(
        "created_at", desc=True
    )
    if corretor["papel"] != "admin":
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    return query.execute().data


@router.post("/propostas", response_model=Proposta)
def criar_proposta(payload: PropostaCreate, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    lote = sb.table("lotes").select("id").eq("id", payload.lote_id).limit(1).execute().data
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")
    cliente = sb.table("clientes").select("id").eq("id", payload.cliente_id).limit(1).execute().data
    if not cliente:
        raise HTTPException(404, "Cliente não encontrado.")
    data = payload.model_dump()
    if corretor["papel"] != "admin":
        data["corretor_id"] = corretor["id"]
    return sb.table("propostas").insert(data).execute().data[0]


@router.patch("/propostas/{proposta_id}", response_model=Proposta)
def atualizar_proposta(proposta_id: str, payload: PropostaUpdate, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    existente = sb.table("propostas").select("*").eq("id", proposta_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Proposta não encontrada.")
    existente = existente[0]
    if not _pode_mexer_na_proposta(corretor, existente):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        return existente
    return sb.table("propostas").update(updates).eq("id", proposta_id).execute().data[0]


@router.patch("/propostas/{proposta_id}/status", response_model=Proposta)
def atualizar_status_proposta(
    proposta_id: str, payload: PropostaStatusUpdate, corretor: dict = Depends(get_current_corretor)
):
    sb = get_supabase()
    existente = sb.table("propostas").select("id, lote_id, corretor_id").eq("id", proposta_id).limit(
        1
    ).execute().data
    if not existente:
        raise HTTPException(404, "Proposta não encontrada.")
    existente = existente[0]
    if not _pode_mexer_na_proposta(corretor, existente):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    atualizado = sb.table("propostas").update({"status": payload.status}).eq("id", proposta_id).execute().data[
        0
    ]
    if payload.status == "aceita":
        sb.table("lotes").update({"status": "vendido"}).eq("id", existente["lote_id"]).execute()
    return atualizado


# ---------------------------------------------------------------------------
# Lotes — listagem unificada (gestão rápida de status pelo painel).
# A mudança de status em si continua em PATCH /condominios/lotes/{id}/status.
# ---------------------------------------------------------------------------


@router.get("/lotes", response_model=list[LoteComCondominio])
def listar_todos_lotes(_corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    condos = {c["id"]: c for c in sb.table("condominios").select("id, nome, slug").execute().data}
    lotes = sb.table("lotes").select("*").order("condominio_id").order("lote_numero").execute().data
    resultado = []
    for l in lotes:
        condo = condos.get(l["condominio_id"], {})
        resultado.append({**l, "condominio_nome": condo.get("nome", "?"), "condominio_slug": condo.get("slug", "")})
    return resultado
