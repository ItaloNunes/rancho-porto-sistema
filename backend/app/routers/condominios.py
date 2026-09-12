from fastapi import APIRouter, Depends, HTTPException

from ..database import get_supabase
from ..schemas import CondominioDetalhe, CondominioResumo, Lote, LotePoligonoUpdate, LoteStatusUpdate
from ..security import get_current_corretor, require_admin

router = APIRouter(prefix="/condominios", tags=["condominios"])


@router.get("", response_model=list[CondominioResumo])
def listar_condominios():
    """Tela inicial (seletor): um card por condomínio ativo."""
    sb = get_supabase()
    condos = sb.table("condominios").select("*").eq("ativo", True).order("nome").execute().data
    result = []
    for c in condos:
        lotes = (
            sb.table("lotes")
            .select("status", count="exact")
            .eq("condominio_id", c["id"])
            .execute()
        )
        total = lotes.count or 0
        disponiveis = sum(1 for l in lotes.data if l["status"] == "disponivel")
        result.append({**c, "total_lotes": total, "total_disponiveis": disponiveis})
    return result


@router.get("/{slug}", response_model=CondominioDetalhe)
def obter_condominio(slug: str):
    """Tela do condomínio: planta técnica + lista completa de lotes."""
    sb = get_supabase()
    condo = sb.table("condominios").select("*").eq("slug", slug).eq("ativo", True).limit(1).execute().data
    if not condo:
        raise HTTPException(404, "Condomínio não encontrado.")
    condo = condo[0]
    lotes = (
        sb.table("lotes")
        .select("*")
        .eq("condominio_id", condo["id"])
        .order("lote_numero")
        .execute()
        .data
    )
    disponiveis = sum(1 for l in lotes if l["status"] == "disponivel")
    return {**condo, "total_lotes": len(lotes), "total_disponiveis": disponiveis, "lotes": lotes}


@router.patch("/lotes/{lote_id}/status", response_model=Lote)
def atualizar_status_lote(lote_id: str, payload: LoteStatusUpdate, _corretor=Depends(get_current_corretor)):
    """Painel interno: marcar um lote como vendido/reservado/disponível manualmente.
    Qualquer corretor logado pode fazer isso (não só admin) — é uma ação de
    vendas do dia a dia, não gestão de conta."""
    sb = get_supabase()
    existing = sb.table("lotes").select("id").eq("id", lote_id).limit(1).execute().data
    if not existing:
        raise HTTPException(404, "Lote não encontrado.")
    updated = (
        sb.table("lotes").update({"status": payload.status}).eq("id", lote_id).execute().data
    )
    return updated[0]


@router.patch("/lotes/{lote_id}/poligono", response_model=Lote)
def atualizar_poligono_lote(lote_id: str, payload: LotePoligonoUpdate, _admin=Depends(require_admin)):
    """Ferramenta de marcação manual (painel, só admin): salva os cantos do
    lote traçados sobre a planta real. Só admin porque é uma tarefa de
    configuração pontual, não uma ação de vendas do dia a dia. Lista vazia
    "desmarca" o lote (poligono_definido volta a False)."""
    sb = get_supabase()
    existing = sb.table("lotes").select("id").eq("id", lote_id).limit(1).execute().data
    if not existing:
        raise HTTPException(404, "Lote não encontrado.")
    if payload.poligono and len(payload.poligono) < 3:
        raise HTTPException(422, "Um polígono precisa de pelo menos 3 pontos.")
    updated = (
        sb.table("lotes")
        .update({"poligono": payload.poligono, "poligono_definido": bool(payload.poligono)})
        .eq("id", lote_id)
        .execute()
        .data
    )
    return updated[0]
