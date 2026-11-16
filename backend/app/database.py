from functools import lru_cache
import logging
import time

import httpx
from supabase import Client, create_client

from .config import settings

log = logging.getLogger(__name__)

# Erros de conexão "no meio do caminho": o servidor do Supabase fechou a
# conexão que o cliente ainda achava aberta. Em 11 e 12/11/2026 isso derrubou
# várias vezes as telas de Lotes, Reservas e Propostas ("Server disconnected")
# e deixou um lote preso como 'reservado' sem reserva nenhuma por trás.
ERROS_DE_CONEXAO = (httpx.RemoteProtocolError, httpx.ReadError, httpx.WriteError, httpx.ConnectError, httpx.PoolTimeout)
METODOS_SEGUROS = {"GET", "HEAD", "OPTIONS"}


class TransporteComNovaTentativa(httpx.HTTPTransport):
    """Leituras (GET) que caem por conexão perdida são repetidas sozinhas,
    numa conexão nova. Escritas (POST/PATCH/DELETE) NÃO são repetidas aqui:
    a escrita pode ter chegado ao banco antes da conexão cair, e repetir às
    cegas poderia gravar duas vezes. Quem escreve trata o erro (ver
    reservas.py::criar_reserva e crm.py::criar_proposta)."""

    def __init__(self, tentativas: int = 3, **kwargs):
        super().__init__(**kwargs)
        self.tentativas = tentativas

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        for tentativa in range(1, self.tentativas + 1):
            try:
                return super().handle_request(request)
            except ERROS_DE_CONEXAO as erro:
                if request.method not in METODOS_SEGUROS or tentativa == self.tentativas:
                    raise
                log.warning("Conexão com o banco caiu (%s) em %s %s; tentando de novo (%s).",
                            type(erro).__name__, request.method, request.url.path, tentativa)
                time.sleep(0.2 * tentativa)
        raise RuntimeError("inalcançável")


def _sessao_resiliente(antiga: httpx.Client) -> httpx.Client:
    """Mesma configuração da sessão do postgrest (URL, cabeçalhos, timeout),
    mas em HTTP/1.1 e com conexões ociosas descartadas cedo. O postgrest usa
    HTTP/2 por padrão; é na conexão HTTP/2 reaproveitada depois de ociosa
    que o Supabase derrubava as requisições."""
    return httpx.Client(
        base_url=antiga.base_url,
        headers=antiga.headers,
        timeout=antiga.timeout,
        follow_redirects=True,
        http2=False,
        transport=TransporteComNovaTentativa(
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=10.0),
        ),
    )


@lru_cache
def _cliente() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


def get_supabase() -> Client:
    """Cliente Supabase com a service role key.

    Usado só pelo backend: ignora RLS, então toda regra de negócio (por
    exemplo, só permitir reservar um lote que está 'disponivel') tem que
    ser garantida aqui no código da API, não no banco.

    A sessão HTTP do postgrest é trocada uma vez por uma resiliente (ver
    _sessao_resiliente). A checagem roda a cada chamada porque o cliente
    pode recriar o postgrest internamente.
    """
    cliente = _cliente()
    pg = cliente.postgrest
    if not getattr(pg, "_sessao_resiliente", False):
        antiga = pg.session
        pg.session = _sessao_resiliente(antiga)
        pg._sessao_resiliente = True
        try:
            antiga.close()
        except Exception:  # pragma: no cover - fechar a antiga é só limpeza
            pass
    return cliente
