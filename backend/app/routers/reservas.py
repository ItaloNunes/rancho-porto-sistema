from fastapi import APIRouter, Depends, HTTPException

from ..database import get_supabase
from ..schemas import Reserva, ReservaComLote, ReservaCreate, ReservaStatusUpdate
from ..security import get_current_corretor

router = APIRouter(prefix="/lotes", tags=["reservas"])
admin_router = APIRouter(prefix="/reservas", tags=["reservas"])


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
    if corretor["papel"] != "admin" and reserva.get("corretor_id") not in (None, corretor["id"]):
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
