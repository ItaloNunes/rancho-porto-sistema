from functools import lru_cache

from supabase import Client, create_client

from .config import settings


@lru_cache
def get_supabase() -> Client:
    """Cliente Supabase com a service role key.

    Usado só pelo backend: ignora RLS, então toda regra de negócio (por
    exemplo, só permitir reservar um lote que está 'disponivel') tem que
    ser garantida aqui no código da API, não no banco.
    """
    return create_client(settings.supabase_url, settings.supabase_service_key)
