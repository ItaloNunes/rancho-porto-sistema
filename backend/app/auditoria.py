# -*- coding: utf-8 -*-
"""Log de auditoria central — quem fez o quê, quando, em qual registro, em
todo o painel. Ver supabase/migrations/0019_logs_auditoria.sql.

Um único ponto de gravação (registrar_log) pra toda ação relevante do
sistema anotar aqui, em vez de cada router reinventar seu próprio jeito de
logar. `ator=None` é só pra ação automática do próprio sistema (ex.: reserva
expirando sozinha) — toda ação disparada por um request autenticado tem que
passar o dict do corretor logado.

Nunca deixa uma falha AQUI derrubar a operação real que está sendo logada —
perder uma linha de log é ruim, mas travar uma reserva/proposta de verdade
porque a gravação do log falhou seria muito pior."""
import logging

logger = logging.getLogger(__name__)


def registrar_log(
    sb,
    ator: dict | None,
    acao: str,
    entidade: str,
    entidade_id: str | None,
    descricao: str,
    detalhes: dict | None = None,
) -> None:
    try:
        sb.table("logs_auditoria").insert(
            {
                "ator_id": ator["id"] if ator else None,
                "ator_nome": ator["nome"] if ator else "Sistema (automático)",
                "ator_papel": ator["papel"] if ator else None,
                "acao": acao,
                "entidade": entidade,
                "entidade_id": entidade_id,
                "descricao": descricao,
                "detalhes": detalhes,
            }
        ).execute()
    except Exception:
        logger.exception("Falha ao gravar log de auditoria (ação=%s, entidade=%s/%s)", acao, entidade, entidade_id)
