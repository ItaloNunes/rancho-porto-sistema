"""Proteção anti-spam do formulário público de reserva (POST /lotes/{id}/reservar).

Como é um endpoint sem login, qualquer bot pode encontrá-lo e martelar pedidos
falsos. Três camadas simples, sem serviço externo (sem CAPTCHA/chave de API):

1. Honeypot: um campo escondido no formulário que nenhum humano vê nem
   preenche, mas que preenchedores automáticos costumam preencher. Se vier
   preenchido, é bot.
2. Tempo mínimo: o front manda quando o formulário foi carregado; um envio
   em menos de ~2,5s é rápido demais pra ter sido digitado por alguém.
3. Limite por IP: no máximo N pedidos de reserva por IP numa janela de tempo.
   Guardado em memória (reinicia se o servidor reiniciar) — suficiente pro
   volume desse sistema; não precisa de tabela nem serviço externo.

Nas três, a resposta ao "bot" é sempre um erro genérico — nunca dizemos qual
regra pegou, pra não ensinar como contornar.
"""

import time
from collections import defaultdict

from fastapi import HTTPException, Request

_MENSAGEM_GENERICA = "Não foi possível processar sua solicitação. Tente novamente."

_JANELA_SEGUNDOS = 60 * 60  # 1 hora
_LIMITE_POR_IP = 5  # no máx. 5 pedidos de reserva por IP por hora
_TEMPO_MINIMO_MS = 2500  # formulário respondido em menos de 2,5s = suspeito

_tentativas_por_ip: dict[str, list[float]] = defaultdict(list)


def client_ip(request: Request) -> str:
    """Render/atrás de proxy: o IP real do visitante vem no X-Forwarded-For
    (o primeiro da lista), não em request.client.host (que seria o proxy)."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "desconhecido"


def checar_rate_limit(ip: str) -> None:
    agora = time.time()
    tentativas = _tentativas_por_ip[ip]
    tentativas[:] = [t for t in tentativas if agora - t < _JANELA_SEGUNDOS]
    if len(tentativas) >= _LIMITE_POR_IP:
        raise HTTPException(429, "Muitos pedidos em pouco tempo. Tente novamente mais tarde.")
    tentativas.append(agora)


def checar_honeypot(valor: str | None) -> None:
    if valor:
        raise HTTPException(400, _MENSAGEM_GENERICA)


def checar_tempo_minimo(carregado_em_ms: int | None) -> None:
    if carregado_em_ms is None:
        return
    decorrido = int(time.time() * 1000) - carregado_em_ms
    if decorrido < _TEMPO_MINIMO_MS:
        raise HTTPException(400, _MENSAGEM_GENERICA)
