# -*- coding: utf-8 -*-
"""Validação e upload de anexos do chamado de suporte (ver
routers/suporte.py) — mesma ideia de app/documentos.py (não confia só no
content-type declarado pelo navegador, confere a assinatura real dos
bytes), mas com regras diferentes: aqui também aceita vídeo curto (gravação
de tela do problema), não só imagem, e o limite de tamanho é maior."""
import mimetypes
import os
import re
import secrets
from typing import Optional

from fastapi import HTTPException, UploadFile

BUCKET = "suporte-anexos"

TAMANHO_MAX_BYTES = 40 * 1024 * 1024  # 40MB — dá folga pra um vídeo curto de tela
TAMANHO_MIN_BYTES = 100

TIPOS_ACEITOS = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/quicktime",
    "video/webm",
}

_EXTENSAO_POR_TIPO = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}


def _bate_assinatura(conteudo: bytes, content_type: str) -> bool:
    if content_type == "image/jpeg":
        return conteudo.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return conteudo.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return conteudo[:4] == b"RIFF" and conteudo[8:12] == b"WEBP"
    if content_type == "image/gif":
        return conteudo[:6] in (b"GIF87a", b"GIF89a")
    if content_type in ("video/mp4", "video/quicktime"):
        # Contêiner ISOBMFF (mp4 e mov são da mesma família) — o "ftyp"
        # aparece no byte 4, não no começo do arquivo.
        return conteudo[4:8] == b"ftyp"
    if content_type == "video/webm":
        return conteudo[:4] == b"\x1a\x45\xdf\xa3"
    return False


def nome_arquivo_seguro(nome_original: Optional[str], tipo: str) -> str:
    """Ver o mesmo comentário em app/documentos.py — nunca usa o nome que
    veio de fora sem tratar, ele vira parte do caminho gravado no bucket."""
    base = os.path.basename((nome_original or "").strip())
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    if not base:
        base = f"anexo{_EXTENSAO_POR_TIPO.get(tipo, '')}"
    return base[-120:]


async def validar_e_ler_anexo(arquivo: UploadFile) -> tuple[bytes, str]:
    """Lê e valida um anexo do chamado por completo. Levanta HTTPException
    (400/413/415) com uma mensagem pronta pra mostrar no painel. Retorna
    (conteúdo, content_type conferido)."""
    nome = arquivo.filename or "arquivo"
    conteudo = await arquivo.read()

    if len(conteudo) < TAMANHO_MIN_BYTES:
        raise HTTPException(400, f'O arquivo "{nome}" chegou vazio — tente selecionar de novo.')
    if len(conteudo) > TAMANHO_MAX_BYTES:
        raise HTTPException(413, f'O arquivo "{nome}" é grande demais — envie até 40MB.')

    content_type = arquivo.content_type or mimetypes.guess_type(nome)[0] or "application/octet-stream"
    if content_type not in TIPOS_ACEITOS:
        raise HTTPException(
            415, f'Formato de "{nome}" não aceito — envie imagem (JPG/PNG/WEBP/GIF) ou vídeo (MP4/MOV/WEBM).'
        )

    if not _bate_assinatura(conteudo, content_type):
        raise HTTPException(415, f'O conteúdo de "{nome}" não bate com o formato informado.')

    return conteudo, content_type


def caminho_no_bucket(prefixo: str, nome_original: Optional[str], tipo: str) -> str:
    """Ex.: "chamado/<corretor_id>/8f3c1a9b2d4e-print_tela.png" — o sufixo
    aleatório evita colisão entre anexos do mesmo chamado."""
    nome_seguro = nome_arquivo_seguro(nome_original, tipo)
    return f"{prefixo}/{secrets.token_hex(6)}-{nome_seguro}"
