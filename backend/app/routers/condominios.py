from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..database import get_supabase
from ..importacao import ler_planilha
from ..schemas import (
    CondominioDetalhe,
    CondominioResumo,
    ImportacaoConfirmarPayload,
    ImportacaoConfirmarResultado,
    ImportacaoLinha,
    ImportacaoPreview,
    Lote,
    LotePoligonoUpdate,
    LoteStatusUpdate,
)
from ..auditoria import registrar_log
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
def atualizar_status_lote(lote_id: str, payload: LoteStatusUpdate, admin: dict = Depends(require_admin)):
    """Painel interno: marcar um lote como vendido/reservado/disponível manualmente.
    Só admin — o corretor comum controla o estoque indiretamente (reserva +
    qualificação + proposta aprovada), não editando o status do lote na mão.

    Ação sensível: mudar o status por aqui NÃO cria nem mexe em nenhuma
    reserva/proposta — é só a etiqueta do lote. Usar isso pra "reservar" ou
    "vender" sem uma reserva/proposta por trás deixa o lote sem histórico
    (foi exatamente essa combinação que causou um caso real de lote preso
    sem ninguém saber por quê — daí o log abaixo).

    Trava por pendência (bug real de 28/09): a importação de planilha já
    recusa incondicionalmente sobrescrever um lote com reserva/proposta
    ATIVA (ver confirmar_importacao_lotes / _pendencias_ativas) — mas esse
    endpoint aqui, usado pelo select de status rápido na tela de Lotes,
    não tinha a mesma trava. Foi por essa porta que a planilha da Sheyla
    (25/09) acabou destravando dois lotes reservados: ela subiu a planilha
    pra atualizar o estoque geral e, pra bater com a tabela dela, também
    foi ajustando lote por lote direto nesse select — sem passar pela tela
    de importação, sem ver nenhum aviso, porque este select não mostrava
    pendência nenhuma. Igual à planilha, o sistema (reserva/proposta ativa)
    sempre vence por padrão; `forcar=True` é a única saída, e só chega aqui
    depois de uma segunda confirmação explícita no painel (ver
    PainelLotes.tsx)."""
    sb = get_supabase()
    existing = sb.table("lotes").select("id, identificador, status").eq("id", lote_id).limit(1).execute().data
    if not existing:
        raise HTTPException(404, "Lote não encontrado.")
    status_anterior = existing[0]["status"]

    pendencia = _pendencias_ativas(sb, [lote_id]).get(lote_id)
    if pendencia and not payload.forcar:
        tipo, corretor, desde = pendencia
        raise HTTPException(
            409,
            detail={
                "pendencia": True,
                "tipo": tipo,
                "corretor": corretor,
                "desde": desde,
                "mensagem": (
                    f"Este lote tem uma {tipo} ATIVA com {corretor} desde "
                    f"{desde} — a mudança não foi aplicada."
                ),
            },
        )

    updated = (
        sb.table("lotes").update({"status": payload.status}).eq("id", lote_id).execute().data
    )
    descricao = (
        f"Mudou manualmente o status do lote {existing[0]['identificador']} de "
        f"'{status_anterior}' pra '{payload.status}' (fora do fluxo normal de reserva/proposta)."
    )
    detalhes = {"status_anterior": status_anterior, "status_novo": payload.status}
    if pendencia:
        tipo, corretor, desde = pendencia
        descricao += (
            f" Forçado por cima de uma {tipo} ATIVA com {corretor} desde {desde} "
            "(admin confirmou explicitamente mesmo com o aviso)."
        )
        detalhes.update({"forcado_por_cima_de_pendencia": True, "pendencia_tipo": tipo, "pendencia_corretor": corretor})
    registrar_log(sb, admin, "mudou_status_lote_manualmente", "lote", lote_id, descricao, detalhes)
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


def _pendencias_ativas(sb, lote_ids: list[str]) -> dict[str, tuple[str, str, str]]:
    """Mapeia lote_id -> (tipo, corretor, desde) pra todo lote que já tem uma
    reserva ou proposta ATIVA por dentro do painel — usada tanto pra avisar
    na tela de preview quanto pra BLOQUEAR de verdade na hora de confirmar
    (ver confirmar_importacao_lotes). Reserva/proposta "cancelada"/"recusada"
    já são estado morto, não contam como pendência.

    Fonte única pras duas pontas de propósito: um lote "travado" no sistema
    (negociação em andamento por um corretor) nunca pode ser sobrescrito pela
    planilha — nem preview nem confirmar podem discordar sobre isso (ver
    incidente de 28/09: a planilha da Sheyla marcou dois lotes com
    reserva/proposta ativa como "disponível" e o admin conseguiu confirmar
    mesmo com o aviso na tela — o bug era confiar só no aviso do front; agora
    o backend recusa a mudança sozinho, sem depender de ninguém ter lido o
    aviso)."""
    if not lote_ids:
        return {}
    pendencia_por_lote: dict[str, tuple[str, str, str]] = {}
    reservas_ativas = (
        sb.table("reservas")
        .select("lote_id, created_at, corretor:corretores(nome)")
        .in_("lote_id", lote_ids)
        .neq("status", "cancelada")
        .order("created_at")
        .execute()
        .data
    )
    for r in reservas_ativas:
        corretor_nome = (r.get("corretor") or {}).get("nome") or "corretor não identificado"
        pendencia_por_lote[r["lote_id"]] = ("reserva", corretor_nome, r["created_at"])
    propostas_abertas = (
        sb.table("propostas")
        .select("lote_id, created_at, corretor:corretores(nome)")
        .in_("lote_id", lote_ids)
        .not_.in_("status", ["recusada", "cancelada"])
        .order("created_at")
        .execute()
        .data
    )
    for p in propostas_abertas:
        if p["lote_id"] in pendencia_por_lote:
            continue  # já tem reserva ativa marcada pra esse lote — não sobrescreve
        corretor_nome = (p.get("corretor") or {}).get("nome") or "corretor não identificado"
        pendencia_por_lote[p["lote_id"]] = ("proposta", corretor_nome, p["created_at"])
    return pendencia_por_lote


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
    aqui pra refletir no painel, em vez de marcar lote por lote na mão.

    Lote com reserva/proposta ATIVA no sistema (pendencia_tipo preenchido)
    aparece aqui só de forma informativa — o admin vê que a planilha queria
    mudar aquele status, mas confirmar_importacao_lotes recusa a troca
    incondicionalmente pra esses lotes (ver _pendencias_ativas). O sistema
    sempre vence a planilha nesse caso; não existe "confirmar mesmo assim"."""
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

    # Avisa o admin, ANTES de confirmar, quando um lote que a planilha quer
    # mudar já tem uma reserva ou proposta ATIVA por dentro do painel — sem
    # isso, a importação sobrescreveria silenciosamente o status por cima de
    # uma negociação em andamento (ex.: planilha diz "disponível" mas um
    # corretor já reservou esse lote no sistema há 2 dias).
    lote_ids = [l["id"] for l in lotes_db]
    pendencia_por_lote = _pendencias_ativas(sb, lote_ids)

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
            pendencia = pendencia_por_lote.get(lote["id"])
            alteracoes.append(
                ImportacaoLinha(
                    lote_id=lote["id"],
                    quadra=lote["quadra"],
                    lote_numero=lote["lote_numero"],
                    identificador=lote["identificador"],
                    status_atual=lote["status"],
                    status_planilha=linha["status"],
                    pendencia_tipo=pendencia[0] if pendencia else None,
                    pendencia_corretor=pendencia[1] if pendencia else None,
                    pendencia_desde=pendencia[2] if pendencia else None,
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


@router.post("/lotes/importar/confirmar", response_model=ImportacaoConfirmarResultado)
def confirmar_importacao_lotes(payload: ImportacaoConfirmarPayload, admin: dict = Depends(require_admin)):
    """Aplica só as trocas de status que o admin confirmou na tela de preview
    (ver endpoint acima) — recebe de volta a lista exata de lote_id/status que
    ficou marcada na tela, não reprocessa a planilha.

    Escrita condicional (mesmo padrão de reservas.py::criar_reserva e
    crm.py::criar_proposta): só aplica a troca se o lote AINDA estiver no
    status que a tela de preview mostrou (`item.status_atual`) — pode ter
    passado minutos entre o admin analisar a planilha e clicar em
    "Confirmar", tempo de sobra pra um corretor reservar/vender esse mesmo
    lote pelo fluxo normal do painel. Sem essa checagem, a importação
    sobrescreveria esse status novo às cegas. Item que não bate mais entra em
    `ignorados` — o front avisa o admin pra reanalisar a planilha.

    Trava incondicional (bug real de 28/09 — ver _pendencias_ativas): lote
    com reserva ou proposta ATIVA no sistema nunca é sobrescrito por aqui,
    mesmo que o item tenha vindo marcado no payload (ex.: front desatualizado,
    ou alguém clicou "estou ciente" na tela). O sistema é sempre a fonte da
    verdade pra um lote travado — a planilha nunca vence essa disputa. Esses
    itens entram em `bloqueados_por_pendencia`, contados à parte de
    `ignorados` (motivo diferente: aqui não é uma corrida perdida, é uma
    trava deliberada)."""
    if not payload.itens:
        raise HTTPException(422, "Nenhuma alteração selecionada.")
    if len(payload.itens) > 1000:
        raise HTTPException(422, "Muitos itens de uma vez.")
    sb = get_supabase()

    lote_ids = [item.lote_id for item in payload.itens]
    pendencia_por_lote = _pendencias_ativas(sb, lote_ids)

    atualizados = []
    ignorados = 0
    bloqueados_por_pendencia = 0
    for item in payload.itens:
        pendencia = pendencia_por_lote.get(item.lote_id)
        if pendencia:
            bloqueados_por_pendencia += 1
            registrar_log(
                sb, admin, "bloqueou_importacao_planilha_por_pendencia", "lote", item.lote_id,
                f"Recusou a mudança de status vinda da planilha (pra '{item.status}') porque o lote tem uma "
                f"{pendencia[0]} ATIVA com {pendencia[1]} desde {pendencia[2]} — o sistema continua "
                "valendo, a planilha não sobrescreve.",
                {"status_planilha": item.status, "pendencia_tipo": pendencia[0], "pendencia_corretor": pendencia[1]},
            )
            continue
        r = (
            sb.table("lotes")
            .update({"status": item.status})
            .eq("id", item.lote_id)
            .eq("status", item.status_atual)
            .execute()
            .data
        )
        if r:
            atualizados.append(r[0])
        else:
            ignorados += 1
    return ImportacaoConfirmarResultado(
        atualizados=atualizados, ignorados=ignorados, bloqueados_por_pendencia=bloqueados_por_pendencia
    )
