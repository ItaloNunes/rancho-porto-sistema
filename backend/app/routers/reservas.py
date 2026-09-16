from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..database import get_supabase
from ..schemas import (
    Reserva,
    ReservaComLote,
    ReservaCreateInterna,
    ReservaStatusUpdate,
    ReservaUpdate,
)
from ..security import get_current_corretor

router = APIRouter(prefix="/lotes", tags=["reservas"])
admin_router = APIRouter(prefix="/reservas", tags=["reservas"])

# Status que ainda estão "vivos" — só esses entram na checagem de expiração.
# Confirmada/cancelada já são estados finais, não vencem mais.
_STATUS_ATIVOS = ["pendente", "em_atendimento", "aguardando_qualificacao", "em_analise_financeira"]


def _pode_mexer_na_reserva(corretor: dict, reserva: dict) -> bool:
    return corretor["papel"] == "admin" or reserva.get("corretor_id") in (None, corretor["id"])


def _expirar_vencidas(sb) -> int:
    """Regra de negócio: reserva que passou de 24h sem confirmar a compra
    expira sozinha e libera o lote de volta pra 'disponivel' (só admin pode
    confirmar — ver atualizar_status_reserva). Chamada em toda listagem
    (checagem "preguiçosa" — não depende de ninguém ter o painel aberto);
    POST /reservas/expirar-vencidas existe à parte pra um cron externo
    reforçar isso mesmo sem ninguém abrir o painel."""
    agora = datetime.now(timezone.utc).isoformat()
    vencidas = (
        sb.table("reservas")
        .select("id, lote_id")
        .in_("status", _STATUS_ATIVOS)
        .lt("expira_em", agora)
        .execute()
        .data
    )
    for r in vencidas:
        sb.table("reservas").update({"status": "cancelada"}).eq("id", r["id"]).execute()
        sb.table("lotes").update({"status": "disponivel"}).eq("id", r["lote_id"]).execute()
    return len(vencidas)


@router.post("/{lote_id}/reservar", response_model=Reserva)
def reservar_lote(lote_id: str):
    """DESATIVADO — decisão de negócio: só o corretor pode criar uma reserva
    (pelo painel, ver `criar_reserva` logo abaixo); o cliente não reserva mais
    sozinho pelo catálogo público (formulário removido de DetalheLote.tsx).
    Mantida a rota, em vez de apagada, só pra quem ainda chamar essa URL
    antiga receber uma mensagem clara em vez de um 404 sem explicação.
    """
    raise HTTPException(403, "Reservas não são mais feitas diretamente pelo cliente — fale com um corretor.")


@admin_router.get("", response_model=list[ReservaComLote])
def listar_reservas(corretor: dict = Depends(get_current_corretor)):
    """Painel interno: fila de pedidos de reserva para confirmar/cancelar.

    Admin vê todas; um corretor comum vê só as que já são dele mais as ainda
    sem corretor responsável (leads novos vindos do catálogo público, que
    qualquer um pode assumir)."""
    sb = get_supabase()
    _expirar_vencidas(sb)
    query = sb.table("reservas").select("*, lote:lotes(*)").order("created_at", desc=True)
    if corretor["papel"] != "admin":
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    return query.execute().data


@admin_router.post("/expirar-vencidas")
def expirar_vencidas_endpoint():
    """Reforço da regra de 24h pra fora do painel: sem login de propósito,
    pra dar pra apontar um cron externo gratuito (ex.: cron-job.org) direto
    nessa URL a cada 15-30min e liberar lotes vencidos mesmo sem ninguém com
    o painel aberto. Não expõe nada sensível — só devolve quantas expiraram."""
    sb = get_supabase()
    return {"expiradas": _expirar_vencidas(sb)}


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

    Confirmar (status='confirmada') exige admin — mesmo padrão de aprovar
    proposta (ver PATCH /crm/propostas/{id}/status): é a etapa que retém o
    lote de vez, então passa por uma segunda pessoa antes de valer. O
    corretor comum continua livre pra criar, editar, cancelar e gerar o link
    de qualificação normalmente.
    """
    sb = get_supabase()
    reserva = sb.table("reservas").select("*").eq("id", reserva_id).limit(1).execute().data
    if not reserva:
        raise HTTPException(404, "Reserva não encontrada.")
    reserva = reserva[0]
    if not _pode_mexer_na_reserva(corretor, reserva):
        raise HTTPException(403, "Esta reserva é de outro corretor.")
    if payload.status == "confirmada" and corretor["papel"] != "admin":
        raise HTTPException(403, "Só um administrador pode confirmar a reserva.")

    updates: dict = {"status": payload.status}
    if payload.corretor_id:
        updates["corretor_id"] = payload.corretor_id
    elif reserva.get("corretor_id") is None and corretor["papel"] != "admin":
        updates["corretor_id"] = corretor["id"]

    updated = sb.table("reservas").update(updates).eq("id", reserva_id).execute().data[0]
    if payload.status == "cancelada":
        sb.table("lotes").update({"status": "disponivel"}).eq("id", reserva["lote_id"]).execute()
    return updated
