"""Painel gerencial (CRM): clientes/leads, corretores e propostas de compra
e venda. Tudo aqui exige login de admin -- nada é exposto no catálogo público.

A geração do PDF da proposta de compra e venda ainda não está implementada:
o texto/modelo do contrato (cláusulas, condições padrão, dados da
incorporadora) precisa vir da imobiliária antes de existir algo confiável
para gerar. Por enquanto o endpoint só guarda os dados da proposta.
"""

from fastapi import APIRouter, Depends, HTTPException

from ..database import get_supabase
from ..schemas import (
    Cliente,
    ClienteCreate,
    Corretor,
    Proposta,
    PropostaCreate,
    PropostaDetalhe,
    PropostaStatusUpdate,
)
from ..security import get_current_admin

router = APIRouter(dependencies=[Depends(get_current_admin)], tags=["crm"])


@router.get("/clientes", response_model=list[Cliente])
def listar_clientes():
    return get_supabase().table("clientes").select("*").order("nome").execute().data


@router.post("/clientes", response_model=Cliente)
def criar_cliente(payload: ClienteCreate):
    return get_supabase().table("clientes").insert(payload.model_dump()).execute().data[0]


@router.get("/corretores", response_model=list[Corretor])
def listar_corretores():
    return get_supabase().table("corretores").select("*").eq("ativo", True).order("nome").execute().data


@router.get("/propostas", response_model=list[PropostaDetalhe])
def listar_propostas():
    sb = get_supabase()
    return (
        sb.table("propostas")
        .select("*, lote:lotes(*), cliente:clientes(*)")
        .order("created_at", desc=True)
        .execute()
        .data
    )


@router.post("/propostas", response_model=Proposta)
def criar_proposta(payload: PropostaCreate):
    sb = get_supabase()
    lote = sb.table("lotes").select("id").eq("id", payload.lote_id).limit(1).execute().data
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")
    cliente = sb.table("clientes").select("id").eq("id", payload.cliente_id).limit(1).execute().data
    if not cliente:
        raise HTTPException(404, "Cliente não encontrado.")
    return sb.table("propostas").insert(payload.model_dump()).execute().data[0]


@router.patch("/propostas/{proposta_id}/status", response_model=Proposta)
def atualizar_status_proposta(proposta_id: str, payload: PropostaStatusUpdate):
    sb = get_supabase()
    existing = sb.table("propostas").select("id, lote_id").eq("id", proposta_id).limit(1).execute().data
    if not existing:
        raise HTTPException(404, "Proposta não encontrada.")
    updated = (
        sb.table("propostas").update({"status": payload.status}).eq("id", proposta_id).execute().data[0]
    )
    if payload.status == "aceita":
        sb.table("lotes").update({"status": "vendido"}).eq("id", existing[0]["lote_id"]).execute()
    return updated
