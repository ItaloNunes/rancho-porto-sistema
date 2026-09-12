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

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ..config import settings
from ..database import get_supabase
from ..pdf import gerar_proposta_pdf, gerar_visao_geral_pdf
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
    VisaoGeralCondominio,
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


@router.get("/propostas/{proposta_id}/pdf")
def gerar_pdf_proposta(proposta_id: str, corretor: dict = Depends(get_current_corretor)):
    """Gera o PDF da proposta em papel timbrado (logo Castel), com os dados do
    lote, cliente, corretor e as condições comerciais — pra enviar ao cliente.
    """
    sb = get_supabase()
    proposta = (
        sb.table("propostas").select("*, lote:lotes(*), cliente:clientes(*)").eq("id", proposta_id).limit(1).execute().data
    )
    if not proposta:
        raise HTTPException(404, "Proposta não encontrada.")
    proposta = proposta[0]
    if not _pode_mexer_na_proposta(corretor, proposta):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    if proposta["status"] not in ("aprovada", "enviada", "aceita"):
        raise HTTPException(
            403,
            "Esta proposta ainda não foi aprovada por um administrador — o PDF só pode ser gerado depois da aprovação.",
        )
    lote = proposta.get("lote")
    cliente = proposta.get("cliente")
    if not lote or not cliente:
        raise HTTPException(409, "Proposta com lote ou cliente ausente — não é possível gerar o PDF.")

    condominio = (
        sb.table("condominios").select("nome").eq("id", lote["condominio_id"]).limit(1).execute().data
    )
    condominio_nome = condominio[0]["nome"] if condominio else "-"

    responsavel = None
    if proposta.get("corretor_id"):
        resp = sb.table("corretores").select("nome, email, telefone").eq("id", proposta["corretor_id"]).limit(1).execute().data
        responsavel = resp[0] if resp else None
    elif corretor["papel"] != "admin":
        responsavel = corretor

    dados_qualificacao = None
    if proposta.get("formulario_id"):
        form = (
            sb.table("formularios_qualificacao")
            .select("dados")
            .eq("id", proposta["formulario_id"])
            .limit(1)
            .execute()
            .data
        )
        dados_qualificacao = form[0]["dados"] if form else None

    pdf_bytes = gerar_proposta_pdf(
        proposta=proposta,
        lote=lote,
        cliente=cliente,
        corretor=responsavel,
        condominio_nome=condominio_nome,
        gerado_por=corretor,
        dados_qualificacao=dados_qualificacao,
    )
    nome_arquivo = f"proposta-{lote.get('identificador', proposta_id)}.pdf".replace(" ", "-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nome_arquivo}"'},
    )


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
    if payload.status == "aprovada" and corretor["papel"] != "admin":
        raise HTTPException(403, "Só um administrador pode aprovar a proposta.")
    atualizado = sb.table("propostas").update({"status": payload.status}).eq("id", proposta_id).execute().data[
        0
    ]
    if payload.status == "aceita":
        sb.table("lotes").update({"status": "vendido"}).eq("id", existente["lote_id"]).execute()
    return atualizado


# ---------------------------------------------------------------------------
# Visão geral (só admin): números consolidados por empreendimento + relatório
# em PDF com a tabela de lotes atualizada.
# ---------------------------------------------------------------------------

PROPOSTA_STATUS_ABERTA = ("rascunho", "aguardando_aprovacao", "aprovada", "enviada")


def _montar_visao_geral() -> tuple[list[dict], dict[str, list[dict]]]:
    sb = get_supabase()
    condominios = sb.table("condominios").select("id, nome, slug").order("nome").execute().data
    lotes = (
        sb.table("lotes")
        .select(
            "id, condominio_id, quadra, identificador, tamanho_m2, valor_total, entrada, entrega, "
            "parcela_mensal, qtd_parcelas, prazo_entrega_meses, status"
        )
        .execute()
        .data
    )
    propostas = sb.table("propostas").select("lote_id, status, valor_proposto").execute().data

    lote_condominio = {l["id"]: l["condominio_id"] for l in lotes}
    lotes_por_condominio: dict[str, list[dict]] = {c["id"]: [] for c in condominios}
    for l in lotes:
        lotes_por_condominio.setdefault(l["condominio_id"], []).append(l)

    resumo = []
    for c in condominios:
        do_condo = lotes_por_condominio.get(c["id"], [])
        propostas_do_condo = [
            p for p in propostas if lote_condominio.get(p["lote_id"]) == c["id"] and p["status"] in PROPOSTA_STATUS_ABERTA
        ]
        resumo.append(
            {
                "condominio_id": c["id"],
                "nome": c["nome"],
                "slug": c["slug"],
                "total_lotes": len(do_condo),
                "disponiveis": sum(1 for l in do_condo if l["status"] == "disponivel"),
                "reservados": sum(1 for l in do_condo if l["status"] == "reservado"),
                "vendidos": sum(1 for l in do_condo if l["status"] == "vendido"),
                "valor_total_vendido": sum(l.get("valor_total") or 0 for l in do_condo if l["status"] == "vendido"),
                "propostas_abertas": len(propostas_do_condo),
                "valor_em_propostas_abertas": sum(p["valor_proposto"] for p in propostas_do_condo),
            }
        )
    return resumo, lotes_por_condominio


@router.get("/visao-geral", response_model=list[VisaoGeralCondominio])
def visao_geral(_admin: dict = Depends(require_admin)):
    resumo, _ = _montar_visao_geral()
    return resumo


@router.get("/visao-geral/pdf")
def visao_geral_pdf(condominio_id: str | None = None, admin: dict = Depends(require_admin)):
    """Exporta o relatório em PDF — de todos os empreendimentos, ou só de um
    (`?condominio_id=...`), conforme o seletor do painel."""
    resumo, lotes_por_condominio = _montar_visao_geral()
    sufixo_arquivo = "todos-os-empreendimentos"
    if condominio_id:
        item = next((r for r in resumo if r["condominio_id"] == condominio_id), None)
        if not item:
            raise HTTPException(404, "Empreendimento não encontrado.")
        resumo = [item]
        lotes_por_condominio = {condominio_id: lotes_por_condominio.get(condominio_id, [])}
        sufixo_arquivo = item["slug"]
    pdf_bytes = gerar_visao_geral_pdf(resumo=resumo, lotes_por_condominio=lotes_por_condominio, gerado_por=admin)
    nome_arquivo = f"relatorio-disponibilidade-{sufixo_arquivo}-{datetime.now().strftime('%Y-%m-%d')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nome_arquivo}"'},
    )


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
