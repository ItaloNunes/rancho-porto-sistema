# -*- coding: utf-8 -*-
"""Validação e upload de documentos anexados por alguém sem passar por
revisão humana antes de virar um arquivo gravado no Storage — hoje isso
acontece em dois lugares: o formulário público de qualificação (o cliente
final anexa RG, CPF etc. sem login — routers/qualificacao.py) e o anexo
direto numa proposta pelo corretor logado (routers/crm.py). Centralizado
aqui pra garantir que as duas rotas apliquem exatamente a mesma validação, em
vez de duas implementações que divergem com o tempo.

Camadas de validação, na ordem em que rodam (a mais barata primeiro, pra não
gastar tempo lendo/validando um arquivo que já falhou num teste simples):
1. Tem arquivo e tem nome?
2. Tamanho (nem vazio, nem grande demais).
3. Content-type declarado está na lista aceita?
4. Os bytes do arquivo *realmente* começam com a assinatura desse formato?
   (o content-type que vem da requisição é só o que o navegador/app do
   cliente alega — é trivial de falsificar trocando a extensão; conferir a
   assinatura real evita que um executável ou script disfarçado de ".pdf"
   pare no bucket.)
"""
import mimetypes
import os
import re
import secrets
from typing import Optional

from fastapi import HTTPException, UploadFile

BUCKET = "documentos-clientes"

TAMANHO_MAX_BYTES = 12 * 1024 * 1024  # 12MB — dá folga pra foto de celular
TAMANHO_MIN_BYTES = 100  # abaixo disso é lixo/arquivo vazio, não um documento de verdade

TIPOS_ACEITOS = {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"}

_EXTENSAO_POR_TIPO = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
}


def _bate_assinatura(conteudo: bytes, content_type: str) -> bool:
    """Confere os primeiros bytes do arquivo contra a assinatura real do
    formato (magic bytes) — não confia só no content-type declarado."""
    if content_type == "application/pdf":
        return conteudo.startswith(b"%PDF-")
    if content_type == "image/jpeg":
        return conteudo.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return conteudo.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return conteudo[:4] == b"RIFF" and conteudo[8:12] == b"WEBP"
    if content_type == "image/heic":
        # Contêiner ISOBMFF (mesma família do .mp4): bytes 4-7 = "ftyp".
        # Não trava na marca exata (heic/heix/mif1/...) porque varia demais
        # entre fabricante/app — o objetivo aqui é só barrar um arquivo que
        # claramente não é nada disso, não validar o HEIC a fundo.
        return conteudo[4:8] == b"ftyp"
    return False


def nome_arquivo_seguro(nome_original: Optional[str], tipo: str) -> str:
    """Nunca usa o nome que veio de fora sem tratar — ele vira parte do
    caminho gravado no bucket. Sem isso, um nome tipo "../segredo" ou com
    barra quebraria o caminho esperado (ou, na pior hipótese, escreveria
    fora da pasta do documento)."""
    base = os.path.basename((nome_original or "").strip())
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    if not base:
        base = f"{tipo}{_EXTENSAO_POR_TIPO.get(tipo, '')}"
    return base[-120:]  # nome absurdamente longo não quebra nada, só encurta


async def validar_e_ler(arquivo: Optional[UploadFile]) -> tuple[bytes, str]:
    """Lê e valida um upload por completo. Levanta HTTPException (400/413/
    415) com uma mensagem pronta pra mostrar pro corretor/cliente. Retorna
    (conteúdo, content_type conferido)."""
    if arquivo is None or not (arquivo.filename or "").strip():
        raise HTTPException(400, "Nenhum arquivo foi enviado.")

    conteudo = await arquivo.read()

    if len(conteudo) == 0:
        raise HTTPException(400, "O arquivo chegou vazio — tente selecionar de novo.")
    if len(conteudo) < TAMANHO_MIN_BYTES:
        raise HTTPException(400, "Esse arquivo é pequeno demais pra ser um documento válido.")
    if len(conteudo) > TAMANHO_MAX_BYTES:
        raise HTTPException(413, "Arquivo muito grande — envie até 12MB.")

    content_type = arquivo.content_type or mimetypes.guess_type(arquivo.filename)[0] or "application/octet-stream"
    if content_type not in TIPOS_ACEITOS:
        raise HTTPException(415, "Formato não aceito — envie PDF, JPG, PNG, WEBP ou HEIC.")

    if not _bate_assinatura(conteudo, content_type):
        raise HTTPException(
            415,
            "O conteúdo do arquivo não bate com o formato informado — pode estar corrompido, "
            "ou a extensão foi trocada. Tente reenviar o documento original.",
        )

    return conteudo, content_type


def caminho_no_bucket(prefixo: str, tipo: str, nome_original: Optional[str]) -> str:
    """Ex.: "proposta/<id>/rg-8f3c1a9b2d4e-rg_frente.jpg" — o sufixo
    aleatório evita colisão entre reenvios do mesmo tipo de documento."""
    nome_seguro = nome_arquivo_seguro(nome_original, tipo)
    return f"{prefixo}/{tipo}-{secrets.token_hex(6)}-{nome_seguro}"


def excluir_do_storage_silenciosamente(sb, storage_path: str) -> None:
    """Usado só como limpeza de compensação (ex.: o upload pro Storage deu
    certo mas a gravação da linha no banco falhou depois) — se a exclusão
    também falhar, não deve mascarar o erro original, só fica um arquivo
    órfão no bucket privado (inofensivo, sem link nenhum apontando pra ele)."""
    try:
        sb.storage.from_(BUCKET).remove([storage_path])
    except Exception:
        pass
