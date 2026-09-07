from fastapi import APIRouter, Depends, HTTPException

from ..database import get_supabase
from ..schemas import (
    Reserva,
    ReservaComLote,
    ReservaCreate,
    ReservaCreateInterna,
    ReservaStatusUpdate,
    ReservaUpdate,
)
from ..security import get_current_corretor

router = APIRouter(prefix="/lotes", tags=["reservas"])
admin_router = APIRouter(prefix="/reservas", tags=["reservas"])


def _pode_mexer_na_reserva(corretor: dict, reserva: dict) -> bool:
    return corretor["papel"] == "admin" or reserva.get("corretor_id") in (None, corretor["id"])


@router.post("/{lote_id}/reservar", response_model=Reserva)
def reservar_lote(lote_id: str, payload: ReservaCreate):
    """Pedido de reserva feito pelo cliente no catálogo público.

    Não é uma reserva confirmada: cria um pedido 'pendente' e marca o lote
    como 'reservado' para tirá-lo da vitrine enquanto a imobiliária confere
    e formaliza (ou libera de volta, se cair).
    """
    sb = get_supabase()
    lote = sb.table("lotes").select("*").eq("id", lote_id).limit(1).execute().data
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")
    lote = lote[0]
    if lote["status"] != "disponivel":
        raise HTTPException(409, "Este lote não está mais disponível.")

    reserva = (
        sb.table("reservas")
        .insert({"lote_id": lote_id, **payload.model_dump()})
        .execute()
        .data[0]
    )
    sb.table("lotes").update({"status": "reservado"}).eq("id", lote_id).execute()
    return reserva


@admin_router.get("", response_model=list[ReservaComLote])
def listar_reservas(corretor: dict = Depends(get_current_corretor)):
    """Painel interno: fila de pedidos de reserva para confirmar/cancelar.

    Admin vê todas; um corretor comum vê só as que já são dele mais as ainda
    sem corretor responsável (leads novos vindos do catálogo público, que
    qualquer um pode assumir)."""
    sb = get_supabase()
    query = sb.table("reservas").select("*, lote:lotes(*)").order("created_at", desc=True)
    if corretor["papel"] != "admin":
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    return query.execute().data


@admin_router.post("", response_model=Reserva)
def criar_reserva(payload: ReservaCreateInterna, corretor: dict = Depends(get_current_corretor)):
    """Cria um pedido manualmente pelo painel (ex.: lead que chegou por telefone
    ou WhatsApp, sem passar pelo formulário público)."""
    sb = get_supabase()
    lote = sb.table("lotes").select("id, status").eq("id", payload.lote_id).limit(1).execute().data
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")
    lote = lote[0]

    data = payload.model_dump()
    if corretor["papel"] != "admin":
        data["corretor_id"] = corretor["id"]
    reserva = sb.table("reservas").insert(data).execute().data[0]
    if lote["status"] == "disponivel":
        sb.table("lotes").update({"status": "reservado"}).eq("id", payload.lote_id).execute()
    return reserva


@admin_router.patch("/{reserva_id}", response_model=Reserva)
def atualizar_reserva(reserva_id: str, payload: ReservaUpdate, corretor: dict = Depends(get_current_corretor)):
    """Edita nome/contato/observação do pedido (o status muda só pelo endpoint abaixo)."""
    sb = get_supabase()
    existente = sb.table("reservas").select("*").eq("id", reserva_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Reserva não encontrada.")
    existente = existente[0]
    if not _pode_mexer_na_reserva(corretor, existente):
        raise HTTPException(403, "Esta reserva é de outro corretor.")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        return existente
    return sb.table("reservas").update(updates).eq("id", reserva_id).execute().data[0]


@admin_router.delete("/{reserva_id}", status_code=204)
def excluir_reserva(reserva_id: str, corretor: dict = Depends(get_current_corretor)):
    """Remove o pedido definitivamente. Se o lote ainda estiver 'reservado' por
    causa dele, libera de volta pra 'disponível' (mesmo efeito de cancelar)."""
    sb = get_supabase()
    existente = sb.table("reservas").select("*").eq("id", reserva_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Reserva não encontrada.")
    existente = existente[0]
    if not _pode_mexer_na_reserva(corretor, existente):
        raise HTTPException(403, "Esta reserva é de outro corretor.")
    sb.table("reservas").delete().eq("id", reserva_id).execute()
    if existente["status"] != "cancelada":
        lote = sb.table("lotes").select("status").eq("id", existente["lote_id"]).limit(1).execute().data
        if lote and lote[0]["status"] == "reservado":
            sb.table("lotes").update({"status": "disponivel"}).eq("id", existente["lote_id"]).execute()


@admin_router.patch("/{reserva_id}/status", response_model=Reserva)
def atualizar_status_reserva(reserva_id: str, payload: ReservaStatusUpdate, corretor: dict = Depends(get_current_corretor)):
    """Confirma ou cancela um pedido de reserva.

    Cancelar libera o lote de volta para 'disponivel' automaticamente;
    confirmar mantém o lote 'reservado' até virar venda (atualizada à parte
    no lote, via PATCH /condominios/lotes/{id}/status). Um corretor comum que
    age numa reserva ainda sem dono a "reivindica" automaticamente.
    """
    sb = get_supabase()
    reserva = sb.table("reservas").select("*").eq("id", reserva_id).limit(1).execute().data
    if not reserva:
        raise HTTPException(404, "Reserva não encontrada.")
    reserva = reserva[0]
    if not _pode_mexer_na_reserva(corretor, reserva):
        raise HTTPException(403, "Esta reserva é de outro corretor.")

    updates: dict = {"status": payload.status}
    if payload.corretor_id:
        updates["corretor_id"] = payload.corretor_id
    elif reserva.get("corretor_id") is None and corretor["papel"] != "admin":
        updates["corretor_id"] = corretor["id"]

    updated = sb.table("reservas").update(updates).eq("id", reserva_id).execute().data[0]
    if payload.status == "cancelada":
        sb.table("lotes").update({"status": "disponivel"}).eq("id", reserva["lote_id"]).execute()
    return updated
