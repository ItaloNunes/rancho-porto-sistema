from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..database import get_supabase
from ..importacao import ler_planilha
from ..schemas import (
    CondominioDetalhe,
    CondominioResumo,
    ImportacaoConfirmarPayload,
    ImportacaoLinha,
    ImportacaoPreview,
    Lote,
    LotePoligonoUpdate,
    LoteStatusUpdate,
)
from ..security import require_admin

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
def atualizar_status_lote(lote_id: str, payload: LoteStatusUpdate, _admin=Depends(require_admin)):
    """Painel interno: marcar um lote como vendido/reservado/disponível manualmente.
    Só admin — o corretor comum controla o estoque indiretamente (reserva +
    qualificação + proposta aprovada), não editando o status do lote na mão."""
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


@router.post("/lotes/importar/preview", response_model=ImportacaoPreview)
async def preview_importacao_lotes(
    condominio_id: str = Form(...),
    arquivo: UploadFile = File(...),
    _admin=Depends(require_admin),
):
    """Painel (só admin) — sobe a planilha de controle do admin (.xlsx/.csv,
    colunas Quadra/Lote/Status) e devolve só o que MUDARIA no estoque, sem
    gravar nada ainda (ver confirmar_importacao_lotes abaixo). Cobre venda ou
    reserva feita fora do sistema: o admin atualiza a própria planilha e sobe
    aqui pra refletir no painel, em vez de marcar lote por lote na mão."""
    sb = get_supabase()
    condo = sb.table("condominios").select("id,nome").eq("id", condominio_id).limit(1).execute().data
    if not condo:
        raise HTTPException(404, "Condomínio não encontrado.")
    condo = condo[0]

    lotes_db = (
        sb.table("lotes")
        .select("id,quadra,lote_numero,identificador,status")
        .eq("condominio_id", condominio_id)
        .execute()
        .data
    )
    if not lotes_db:
        raise HTTPException(404, "Esse condomínio não tem lotes cadastrados.")
    # Só usado quando a planilha é um PDF (ver ler_planilha_pdf) — decide se a
    # tabela tem quadra separada do número do lote (Porto Franco) ou não
    # (Rancho Texas), olhando os lotes que já existem nesse condomínio.
    tem_quadra_propria = any(l["quadra"] != str(l["lote_numero"]) for l in lotes_db)

    linhas_planilha = await ler_planilha(arquivo, tem_quadra_propria)
    if not linhas_planilha:
        raise HTTPException(422, "Não encontrei nenhuma linha válida (com lote e status reconhecidos) na planilha.")

    por_chave = {(l["quadra"], l["lote_numero"]): l for l in lotes_db}

    alteracoes: list[ImportacaoLinha] = []
    nao_encontrados: list[str] = []
    vistos = set()
    for linha in linhas_planilha:
        chave = (linha["quadra"], linha["lote_numero"])
        if chave in vistos:
            continue  # linha duplicada na planilha — considera só a primeira ocorrência
        vistos.add(chave)
        lote = por_chave.get(chave)
        if not lote:
            nao_encontrados.append(f"Quadra {linha['quadra']}, Lote {linha['lote_numero']}")
            continue
        if lote["status"] != linha["status"]:
            alteracoes.append(
                ImportacaoLinha(
                    lote_id=lote["id"],
                    quadra=lote["quadra"],
                    lote_numero=lote["lote_numero"],
                    identificador=lote["identificador"],
                    status_atual=lote["status"],
                    status_planilha=linha["status"],
                )
            )

    def _chave_ordenacao(l: ImportacaoLinha):
        try:
            return (0, int(l.quadra), l.lote_numero)
        except ValueError:
            return (1, l.quadra, l.lote_numero)

    alteracoes.sort(key=_chave_ordenacao)
    return ImportacaoPreview(
        condominio_id=condominio_id,
        condominio_nome=condo["nome"],
        total_linhas_planilha=len(linhas_planilha),
        total_casadas=len(vistos) - len(nao_encontrados),
        total_alteracoes=len(alteracoes),
        linhas=alteracoes,
        nao_encontrados=nao_encontrados,
    )


@router.post("/lotes/importar/confirmar", response_model=list[Lote])
def confirmar_importacao_lotes(payload: ImportacaoConfirmarPayload, _admin=Depends(require_admin)):
    """Aplica só as trocas de status que o admin confirmou na tela de preview
    (ver endpoint acima) — recebe de volta a lista exata de lote_id/status que
    ficou marcada na tela, não reprocessa a planilha."""
    if not payload.itens:
        raise HTTPException(422, "Nenhuma alteração selecionada.")
    if len(payload.itens) > 1000:
        raise HTTPException(422, "Muitos itens de uma vez.")
    sb = get_supabase()
    atualizados = []
    for item in payload.itens:
        r = sb.table("lotes").update({"status": item.status}).eq("id", item.lote_id).execute().data
        if r:
            atualizados.append(r[0])
    return atualizados
