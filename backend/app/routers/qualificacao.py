"""Qualificação do cliente final: o corretor reserva o lote, cadastra o
cliente com o mínimo (nome/telefone/CPF) e gera um link público. O cliente
final abre esse link (sem login) e preenche, em etapas, os mesmos campos da
Proposta de Compra/Venda em papel — e anexa os documentos exigidos (RG, CPF,
comprovante de residência, certidão de nascimento/casamento, documentos do
cônjuge se casado, comprovante de renda). O financeiro (admin) revisa no
painel e aprova ou reprova; aprovado já gera a proposta (pulando a etapa de
aprovação separada de propostas — a aprovação financeira É a aprovação).

Duas famílias de rotas neste arquivo:
- `router` (prefixo /qualificacao): público, sem login, autenticado só pela
  posse do token (igual a um link de convite — 192 bits de entropia,
  impraticável de adivinhar).
- `admin_router` (prefixo /crm/qualificacoes): painel interno, exige login.
"""

import mimetypes
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..database import get_supabase
from ..schemas import (
    DOCUMENTOS_CONJUGE,
    DOCUMENTOS_OBRIGATORIOS,
    Cliente,
    DocumentoQualificacao,
    Qualificacao,
    QualificacaoComRelacoes,
    QualificacaoCreate,
    QualificacaoDados,
    QualificacaoDecisao,
    QualificacaoPublica,
)
from ..security import get_current_corretor, require_admin

router = APIRouter(prefix="/qualificacao", tags=["qualificacao"])
admin_router = APIRouter(prefix="/qualificacoes", tags=["qualificacao"])

BUCKET = "documentos-clientes"
TAMANHO_MAX_BYTES = 12 * 1024 * 1024  # 12MB por arquivo — dá folga pra foto de celular
TIPOS_ACEITOS = {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"}


def _gerar_token() -> str:
    return secrets.token_urlsafe(24)


def _pode_mexer(corretor: dict, registro: dict) -> bool:
    return corretor["papel"] == "admin" or registro.get("corretor_id") in (None, corretor["id"])


# ---------------------------------------------------------------------------
# Painel interno (autenticado)
# ---------------------------------------------------------------------------


@admin_router.post("/gerar/{reserva_id}", response_model=Qualificacao)
def gerar_link_qualificacao(
    reserva_id: str, payload: QualificacaoCreate, corretor: dict = Depends(get_current_corretor)
):
    """Cria (ou reaproveita, se já existir) o link de qualificação de uma
    reserva. O corretor escolhe um cliente já cadastrado (`cliente_id`) ou
    cadastra um novo ali mesmo (`cliente_novo`, só nome/telefone/CPF)."""
    sb = get_supabase()
    reserva = sb.table("reservas").select("*").eq("id", reserva_id).limit(1).execute().data
    if not reserva:
        raise HTTPException(404, "Reserva não encontrada.")
    reserva = reserva[0]
    if not _pode_mexer(corretor, reserva):
        raise HTTPException(403, "Esta reserva é de outro corretor.")

    existente = sb.table("formularios_qualificacao").select("*").eq("reserva_id", reserva_id).limit(1).execute().data
    if existente:
        return existente[0]

    if payload.cliente_id:
        cliente = sb.table("clientes").select("id").eq("id", payload.cliente_id).limit(1).execute().data
        if not cliente:
            raise HTTPException(404, "Cliente não encontrado.")
        cliente_id = payload.cliente_id
    elif payload.cliente_novo:
        dados_cliente = payload.cliente_novo.model_dump()
        if corretor["papel"] != "admin":
            dados_cliente["corretor_id"] = corretor["id"]
        cliente_id = sb.table("clientes").insert(dados_cliente).execute().data[0]["id"]
    else:
        raise HTTPException(400, "Informe cliente_id ou cliente_novo.")

    row = {
        "reserva_id": reserva_id,
        "lote_id": reserva["lote_id"],
        "cliente_id": cliente_id,
        "corretor_id": reserva.get("corretor_id") or (corretor["id"] if corretor["papel"] != "admin" else None),
        "token": _gerar_token(),
    }
    qualificacao = sb.table("formularios_qualificacao").insert(row).execute().data[0]
    sb.table("reservas").update({"status": "aguardando_qualificacao"}).eq("id", reserva_id).execute()
    return qualificacao


def _carregar_qualificacao_completa(sb, qualificacao_id: str) -> dict:
    q = (
        sb.table("formularios_qualificacao")
        .select("*, lote:lotes(*), cliente:clientes(*), corretor:corretores(*)")
        .eq("id", qualificacao_id)
        .limit(1)
        .execute()
        .data
    )
    if not q:
        raise HTTPException(404, "Qualificação não encontrada.")
    q = q[0]
    q["documentos"] = (
        sb.table("documentos_qualificacao")
        .select("id, formulario_id, tipo, nome_arquivo, tamanho_bytes, enviado_em")
        .eq("formulario_id", qualificacao_id)
        .order("enviado_em")
        .execute()
        .data
    )
    return q


@admin_router.get("", response_model=list[QualificacaoComRelacoes])
def listar_qualificacoes(corretor: dict = Depends(get_current_corretor)):
    """Fila de análise financeira — admin vê todas; corretor comum só as
    próprias (mesmo padrão de reservas/propostas)."""
    sb = get_supabase()
    query = sb.table("formularios_qualificacao").select(
        "*, lote:lotes(*), cliente:clientes(*), corretor:corretores(*)"
    ).order("created_at", desc=True)
    if corretor["papel"] != "admin":
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    resultado = query.execute().data
    ids = [r["id"] for r in resultado]
    docs_por_form: dict[str, list] = {i: [] for i in ids}
    if ids:
        docs = (
            sb.table("documentos_qualificacao")
            .select("id, formulario_id, tipo, nome_arquivo, tamanho_bytes, enviado_em")
            .in_("formulario_id", ids)
            .execute()
            .data
        )
        for d in docs:
            docs_por_form.setdefault(d["formulario_id"], []).append(d)
    for r in resultado:
        r["documentos"] = docs_por_form.get(r["id"], [])
    return resultado


@admin_router.get("/{qualificacao_id}", response_model=QualificacaoComRelacoes)
def detalhe_qualificacao(qualificacao_id: str, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    q = _carregar_qualificacao_completa(sb, qualificacao_id)
    if not _pode_mexer(corretor, q):
        raise HTTPException(403, "Esta qualificação é de outro corretor.")
    return q


@admin_router.get("/{qualificacao_id}/documentos/{documento_id}/arquivo")
def baixar_documento(qualificacao_id: str, documento_id: str, corretor: dict = Depends(get_current_corretor)):
    """Gera uma URL assinada (curta duração) pro documento — o painel nunca
    fala direto com o Storage, sempre passa por aqui, autenticado."""
    sb = get_supabase()
    q = sb.table("formularios_qualificacao").select("*").eq("id", qualificacao_id).limit(1).execute().data
    if not q:
        raise HTTPException(404, "Qualificação não encontrada.")
    if not _pode_mexer(corretor, q[0]):
        raise HTTPException(403, "Esta qualificação é de outro corretor.")
    doc = (
        sb.table("documentos_qualificacao")
        .select("*")
        .eq("id", documento_id)
        .eq("formulario_id", qualificacao_id)
        .limit(1)
        .execute()
        .data
    )
    if not doc:
        raise HTTPException(404, "Documento não encontrado.")
    assinada = sb.storage.from_(BUCKET).create_signed_url(doc[0]["storage_path"], 300)
    url = assinada.get("signedURL") or assinada.get("signed_url")
    if not url:
        raise HTTPException(502, "Não foi possível gerar o link do documento.")
    return {"url": url}


@admin_router.patch("/{qualificacao_id}/decisao", response_model=Qualificacao)
def decidir_qualificacao(
    qualificacao_id: str, payload: QualificacaoDecisao, admin: dict = Depends(require_admin)
):
    """Só admin: aprova ou reprova a análise financeira. Aprovado já cria a
    proposta (com status 'aprovada' direto — a análise financeira substitui a
    aprovação separada de propostas) pronta pra gerar o PDF e mandar pro
    cliente assinar."""
    sb = get_supabase()
    q = sb.table("formularios_qualificacao").select("*").eq("id", qualificacao_id).limit(1).execute().data
    if not q:
        raise HTTPException(404, "Qualificação não encontrada.")
    q = q[0]
    if q["status"] != "em_analise":
        raise HTTPException(409, "Esta qualificação não está em análise (já foi decidida, ou o cliente ainda não enviou).")

    novo_status = "aprovada" if payload.aprovado else "reprovada"
    updates = {
        "status": novo_status,
        "analisado_em": datetime.now(timezone.utc).isoformat(),
        "analisado_por": admin["id"],
        "motivo_reprovacao": payload.motivo_reprovacao if not payload.aprovado else None,
    }
    atualizado = sb.table("formularios_qualificacao").update(updates).eq("id", qualificacao_id).execute().data[0]

    if payload.aprovado:
        dados = q.get("dados") or {}
        forma_pgto = dados.get("forma_pagamento") or {}
        valor_proposto = forma_pgto.get("valor_proposto")
        if valor_proposto is None:
            lote = sb.table("lotes").select("valor_total").eq("id", q["lote_id"]).limit(1).execute().data
            valor_proposto = lote[0]["valor_total"] if lote else 0
        condicoes = None
        if forma_pgto.get("dividido_em_parcelas"):
            condicoes = f"{forma_pgto['dividido_em_parcelas']}x de {forma_pgto.get('valor_parcela') or '-'}"
        elif forma_pgto.get("a_vista"):
            condicoes = "À vista"
        proposta = {
            "lote_id": q["lote_id"],
            "cliente_id": q["cliente_id"],
            "corretor_id": q.get("corretor_id"),
            "formulario_id": q["id"],
            "valor_proposto": valor_proposto,
            "condicoes_pagamento": condicoes,
            "status": "aprovada",
        }
        sb.table("propostas").insert(proposta).execute()
        sb.table("reservas").update({"status": "confirmada"}).eq("id", q["reserva_id"]).execute()
    else:
        sb.table("reservas").update({"status": "cancelada"}).eq("id", q["reserva_id"]).execute()
        sb.table("lotes").update({"status": "disponivel"}).eq("id", q["lote_id"]).execute()

    return atualizado


# ---------------------------------------------------------------------------
# Público (sem login — só o token)
# ---------------------------------------------------------------------------


def _buscar_por_token(sb, token: str) -> dict:
    q = sb.table("formularios_qualificacao").select("*, lote:lotes(*)").eq("token", token).limit(1).execute().data
    if not q:
        raise HTTPException(404, "Link inválido ou expirado.")
    return q[0]


@router.get("/{token}", response_model=QualificacaoPublica)
def abrir_formulario(token: str):
    sb = get_supabase()
    q = _buscar_por_token(sb, token)
    condominio = sb.table("condominios").select("nome").eq("id", q["lote"]["condominio_id"]).limit(1).execute().data
    documentos = (
        sb.table("documentos_qualificacao")
        .select("id, formulario_id, tipo, nome_arquivo, tamanho_bytes, enviado_em")
        .eq("formulario_id", q["id"])
        .order("enviado_em")
        .execute()
        .data
    )
    return {
        "status": q["status"],
        "dados": q.get("dados") or {},
        "documentos": documentos,
        "lote_identificador": q["lote"]["identificador"],
        "condominio_nome": condominio[0]["nome"] if condominio else "-",
        "motivo_reprovacao": q.get("motivo_reprovacao"),
    }


@router.patch("/{token}", response_model=QualificacaoPublica)
def salvar_formulario(token: str, payload: QualificacaoDados):
    """Salva o progresso — chamado a cada etapa do formulário, não só no
    final. Só aceita gravar enquanto ainda não foi enviado pra análise."""
    sb = get_supabase()
    q = _buscar_por_token(sb, token)
    if q["status"] != "aguardando_preenchimento":
        raise HTTPException(409, "Este formulário já foi enviado — não é mais possível editar.")
    sb.table("formularios_qualificacao").update(
        {"dados": payload.model_dump(mode="json")}
    ).eq("id", q["id"]).execute()
    return abrir_formulario(token)


@router.post("/{token}/documentos", response_model=DocumentoQualificacao)
async def enviar_documento(token: str, tipo: str, arquivo: UploadFile = File(...)):
    sb = get_supabase()
    q = _buscar_por_token(sb, token)
    if q["status"] != "aguardando_preenchimento":
        raise HTTPException(409, "Este formulário já foi enviado — não é mais possível anexar documentos.")
    if tipo not in (
        "rg", "cpf", "comprovante_residencia", "certidao_nascimento_casamento",
        "conjuge_rg", "conjuge_cpf", "comprovante_renda", "outro",
    ):
        raise HTTPException(400, "Tipo de documento inválido.")

    conteudo = await arquivo.read()
    if len(conteudo) > TAMANHO_MAX_BYTES:
        raise HTTPException(413, "Arquivo muito grande — envie até 12MB.")
    content_type = arquivo.content_type or mimetypes.guess_type(arquivo.filename or "")[0] or "application/octet-stream"
    if content_type not in TIPOS_ACEITOS:
        raise HTTPException(415, "Formato não aceito — envie PDF, JPG, PNG ou HEIC.")

    storage_path = f"{q['id']}/{tipo}-{secrets.token_hex(6)}-{arquivo.filename}"
    sb.storage.from_(BUCKET).upload(storage_path, conteudo, {"content-type": content_type})

    row = {
        "formulario_id": q["id"],
        "tipo": tipo,
        "nome_arquivo": arquivo.filename or tipo,
        "storage_path": storage_path,
        "tamanho_bytes": len(conteudo),
        "enviado_em": datetime.now(timezone.utc).isoformat(),
    }
    return sb.table("documentos_qualificacao").insert(row).execute().data[0]


@router.post("/{token}/enviar", response_model=QualificacaoPublica)
def enviar_para_analise(token: str):
    """Fecha o formulário e manda pra análise financeira — a partir daqui o
    cliente não pode mais editar. Valida que os campos essenciais e os
    documentos obrigatórios (mais os do cônjuge, se casado) estão presentes."""
    sb = get_supabase()
    q = _buscar_por_token(sb, token)
    if q["status"] != "aguardando_preenchimento":
        raise HTTPException(409, "Este formulário já foi enviado.")

    dados = q.get("dados") or {}
    proponente = dados.get("proponente") or {}
    faltando = []
    for campo, rotulo in [("nome", "nome"), ("cpf_cnpj", "CPF"), ("rg", "RG")]:
        if not proponente.get(campo):
            faltando.append(rotulo)
    if not dados.get("estado_civil"):
        faltando.append("estado civil")

    obrigatorios = list(DOCUMENTOS_OBRIGATORIOS)
    if dados.get("estado_civil") == "casado":
        obrigatorios += list(DOCUMENTOS_CONJUGE)
    documentos = (
        sb.table("documentos_qualificacao").select("tipo").eq("formulario_id", q["id"]).execute().data
    )
    tipos_enviados = {d["tipo"] for d in documentos}
    docs_faltando = [t for t in obrigatorios if t not in tipos_enviados]

    if faltando or docs_faltando:
        detalhes = []
        if faltando:
            detalhes.append("campos: " + ", ".join(faltando))
        if docs_faltando:
            detalhes.append("documentos: " + ", ".join(docs_faltando))
        raise HTTPException(422, "Formulário incompleto — falta preencher " + "; ".join(detalhes) + ".")

    agora = datetime.now(timezone.utc)
    sb.table("formularios_qualificacao").update(
        {"status": "em_analise", "enviado_em": agora.isoformat()}
    ).eq("id", q["id"]).execute()
    sb.table("reservas").update(
        {"status": "em_analise_financeira", "analise_prazo_em": (agora + timedelta(hours=48)).isoformat()}
    ).eq("id", q["reserva_id"]).execute()

    return abrir_formulario(token)
