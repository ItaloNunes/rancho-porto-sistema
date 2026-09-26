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
from ..auditoria import registrar_log
from ..security import eh_admin, get_current_corretor

router = APIRouter(prefix="/lotes", tags=["reservas"])
admin_router = APIRouter(prefix="/reservas", tags=["reservas"])

# Status que ainda estão "vivos" — só esses entram na checagem de expiração.
# Confirmada/cancelada já são estados finais, não vencem mais.
_STATUS_ATIVOS = ["pendente", "em_atendimento", "aguardando_qualificacao", "em_analise_financeira"]


def _pode_mexer_na_reserva(corretor: dict, reserva: dict) -> bool:
    return eh_admin(corretor) or reserva.get("corretor_id") in (None, corretor["id"])


def _expirar_vencidas(sb) -> int:
    """Regra de negócio: reserva que passou de 72h sem confirmar a compra
    expira sozinha e libera o lote de volta pra 'disponivel' (só admin pode
    confirmar — ver atualizar_status_reserva). O prazo em si é o DEFAULT da
    coluna reservas.expira_em no banco (ver migration 0018) — não um valor
    fixo aqui no Python; já foi 24h (migration 0009) e subiu pra 72h depois
    de um caso real onde a reserva expirou antes do corretor terminar a
    qualificação e tentar gerar a proposta a partir dela. Chamada em toda
    listagem (checagem "preguiçosa" — não depende de ninguém ter o painel
    aberto); POST /reservas/expirar-vencidas existe à parte pra um cron
    externo reforçar isso mesmo sem ninguém abrir o painel."""
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
        registrar_log(
            sb, None, "reserva_expirou", "reserva", r["id"],
            "Reserva expirou sozinha (venceu o prazo sem confirmação) e o lote voltou a ficar disponível.",
        )
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
    query = sb.table("reservas").select("*, lote:lotes(*), corretor:corretores(nome)").order("created_at", desc=True)
    if not eh_admin(corretor):
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
    ou WhatsApp, sem passar pelo formulário público).

    Trava o lote de forma atômica: o UPDATE abaixo só marca 'reservado' se o
    lote AINDA estiver 'disponivel' no exato instante da escrita — quem
    resolve a corrida é o Postgres (uma única instrução SQL), não uma
    checagem em Python. Antes desta correção, o código lia o status, sempre
    inseria a reserva e só atualizava o lote se ele *tivesse estado*
    disponível na leitura lá em cima — deixando uma janela em que dois
    corretores clicando "reservar" no mesmo lote quase ao mesmo tempo
    conseguiam criar duas reservas ativas pro mesmo lote (double booking)."""
    sb = get_supabase()
    lote = sb.table("lotes").select("id, status").eq("id", payload.lote_id).limit(1).execute().data
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")
    if lote[0]["status"] != "disponivel":
        raise HTTPException(409, f"Este lote não está disponível (status atual: {lote[0]['status']}).")

    travou = (
        sb.table("lotes")
        .update({"status": "reservado"})
        .eq("id", payload.lote_id)
        .eq("status", "disponivel")
        .execute()
        .data
    )
    if not travou:
        # A checagem lá em cima passou, mas alguém "ganhou" o lote entre a
        # leitura e esta escrita — 0 linhas afetadas é exatamente esse caso.
        raise HTTPException(409, "Este lote acabou de ser reservado por outra pessoa — atualize a página.")

    data = payload.model_dump()
    if not eh_admin(corretor):
        data["corretor_id"] = corretor["id"]
    try:
        criada = sb.table("reservas").insert(data).execute().data[0]
    except Exception:
        # Já travamos o lote como 'reservado' antes de tentar gravar a
        # reserva em si — se essa gravação falhar, desfaz a trava pra não
        # deixar o lote preso em 'reservado' sem nenhuma reserva por trás.
        sb.table("lotes").update({"status": "disponivel"}).eq("id", payload.lote_id).execute()
        raise
    registrar_log(
        sb, corretor, "criou_reserva", "reserva", criada["id"],
        f"Criou reserva pro lote (cliente: {criada.get('nome') or 'sem nome'}).",
        {"lote_id": payload.lote_id},
    )
    return criada


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
    atualizado = sb.table("reservas").update(updates).eq("id", reserva_id).execute().data[0]
    registrar_log(
        sb, corretor, "editou_reserva", "reserva", reserva_id,
        f"Editou dados da reserva (campos: {', '.join(updates.keys())}).",
        {"campos_alterados": list(updates.keys())},
    )
    return atualizado


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
    registrar_log(
        sb, corretor, "excluiu_reserva", "reserva", reserva_id,
        f"Excluiu a reserva (cliente: {existente.get('nome') or 'sem nome'}).",
    )


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
    if payload.status == "confirmada" and not eh_admin(corretor):
        raise HTTPException(403, "Só um administrador pode confirmar a reserva.")

    updates: dict = {"status": payload.status}
    if payload.corretor_id:
        updates["corretor_id"] = payload.corretor_id
    elif reserva.get("corretor_id") is None and not eh_admin(corretor):
        updates["corretor_id"] = corretor["id"]

    updated = sb.table("reservas").update(updates).eq("id", reserva_id).execute().data[0]
    if payload.status == "cancelada":
        sb.table("lotes").update({"status": "disponivel"}).eq("id", reserva["lote_id"]).execute()
    elif payload.status == "confirmada":
        # Re-trava o lote mesmo se ele já tiver voltado a 'disponivel'
        # sozinho antes disso (ex.: a reserva expirou pelas 72h — ver
        # _expirar_vencidas — e foi confirmada na mão depois). Sem isso,
        # confirmar uma reserva "revivida" não garante que o lote está
        # realmente travado (bug real visto em 26/09 — ver comentário
        # equivalente em crm.py::_gerar_reserva_da_proposta_aprovada).
        sb.table("lotes").update({"status": "reservado"}).eq("id", reserva["lote_id"]).eq(
            "status", "disponivel"
        ).execute()
    acao = "confirmou_reserva" if payload.status == "confirmada" else (
        "cancelou_reserva" if payload.status == "cancelada" else "mudou_status_reserva"
    )
    registrar_log(
        sb, corretor, acao, "reserva", reserva_id,
        f"Mudou status da reserva (cliente: {reserva.get('nome') or 'sem nome'}) pra '{payload.status}'.",
        {"status_anterior": reserva["status"], "status_novo": payload.status},
    )
    return updated
