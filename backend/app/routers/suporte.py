"""Botão de suporte do painel (corretor e admin) — abre um "chamado" que
vira um e-mail pro desenvolvedor (settings.suporte_email), com print/vídeo
anexados como link assinado do Storage (não como anexo direto no e-mail:
um vídeo passa fácil do limite de anexo da maioria dos provedores)."""

import html as html_lib
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from ..database import get_supabase
from ..email_service import enviar_email
from ..security import get_current_corretor
from ..suporte_anexos import BUCKET, caminho_no_bucket, validar_e_ler_anexo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/suporte", tags=["suporte"])

MAX_ANEXOS = 5
VALIDADE_LINK_SEGUNDOS = 7 * 24 * 3600  # 7 dias — dá tempo de sobra pra abrir o e-mail e ver os anexos


@router.post("/chamados")
async def abrir_chamado(
    assunto: str = Form(...),
    descricao: str = Form(...),
    arquivos: list[UploadFile] = File(default=[]),
    corretor: dict = Depends(get_current_corretor),
):
    assunto = assunto.strip()
    descricao = descricao.strip()
    if not assunto:
        raise HTTPException(400, "Escreva um assunto pro chamado.")
    if not descricao:
        raise HTTPException(400, "Descreva o problema.")

    # O <input type="file" multiple> manda um UploadFile "vazio" (sem nome)
    # quando a pessoa não escolhe nenhum arquivo — filtra isso antes de
    # contar/validar, senão um chamado sem anexo já estoura o limite.
    arquivos_validos = [a for a in arquivos if (a.filename or "").strip()]
    if len(arquivos_validos) > MAX_ANEXOS:
        raise HTTPException(400, f"Envie no máximo {MAX_ANEXOS} anexos por chamado.")

    sb = get_supabase()
    links: list[str] = []
    for arquivo in arquivos_validos:
        conteudo, content_type = await validar_e_ler_anexo(arquivo)
        storage_path = caminho_no_bucket(f"chamado/{corretor['id']}", arquivo.filename, content_type)
        await run_in_threadpool(
            sb.storage.from_(BUCKET).upload, storage_path, conteudo, {"content-type": content_type}
        )
        assinada = await run_in_threadpool(
            sb.storage.from_(BUCKET).create_signed_url, storage_path, VALIDADE_LINK_SEGUNDOS
        )
        url = assinada.get("signedURL") or assinada.get("signed_url")
        if url:
            links.append(url)

    agora_fmt = datetime.now(timezone.utc).strftime("%d/%m/%Y às %H:%M UTC")
    itens_anexo = "".join(
        f'<li><a href="{html_lib.escape(u)}">Anexo {i + 1}</a></li>' for i, u in enumerate(links)
    )
    bloco_anexos = (
        f"<p><b>Anexos</b> (links válidos por 7 dias):</p><ul>{itens_anexo}</ul>" if itens_anexo else ""
    )
    telefone = corretor.get("telefone") or "-"
    html_corpo = f"""
    <h2>Novo chamado de suporte — {html_lib.escape(assunto)}</h2>
    <p><b>Aberto por:</b> {html_lib.escape(corretor['nome'])}
       ({html_lib.escape(corretor['papel'])}) · tel. {html_lib.escape(telefone)}</p>
    <p><b>Quando:</b> {agora_fmt}</p>
    <p><b>Descrição:</b></p>
    <p style="white-space:pre-wrap">{html_lib.escape(descricao)}</p>
    {bloco_anexos}
    """.strip()

    try:
        await enviar_email(
            assunto=f"[Suporte Rancho Porto] {assunto}",
            html=html_corpo,
            reply_to=corretor.get("email") or None,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao enviar e-mail de chamado de suporte")
        raise HTTPException(502, "Não foi possível enviar o chamado. Tente novamente em instantes.")

    return {"status": "enviado"}
