"""Envio de e-mail via Resend (API HTTP simples — sem precisar configurar
SMTP/servidor de e-mail próprio). Único uso hoje: o botão de suporte do
painel (ver app/routers/suporte.py), que manda o chamado pro e-mail do
desenvolvedor.

Se RESEND_API_KEY não estiver configurada (settings.resend_api_key vazio),
falha alto e claro com um 502 explicando o motivo — melhor isso do que o
corretor achar que o chamado foi aberto e ele nunca chegar em lugar nenhum.
"""

import httpx
from fastapi import HTTPException

from .config import settings

RESEND_URL = "https://api.resend.com/emails"

# Domínio de teste do Resend — funciona sem verificar domínio próprio,
# mas só entrega pro e-mail da conta Resend usada (por isso o botão de
# suporte manda pro mesmo endereço que criou a conta: settings.suporte_email).
REMETENTE = "Suporte Rancho Porto <onboarding@resend.dev>"


async def enviar_email(*, assunto: str, html: str, reply_to: str | None = None) -> None:
    if not settings.resend_api_key:
        raise HTTPException(502, "Envio de e-mail não está configurado no servidor (RESEND_API_KEY ausente).")

    payload: dict = {
        "from": REMETENTE,
        "to": [settings.suporte_email],
        "subject": assunto,
        "html": html,
    }
    if reply_to:
        payload["reply_to"] = reply_to

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            resp = await client.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json=payload,
            )
        except httpx.HTTPError:
            raise HTTPException(502, "Não foi possível conectar ao serviço de e-mail. Tente novamente.")

    if resp.status_code >= 400:
        raise HTTPException(502, "O serviço de e-mail recusou o envio. Tente novamente em instantes.")
