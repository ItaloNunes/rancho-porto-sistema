from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_key: str
    supabase_anon_key: str = ""
    notificacao_email: str = ""
    cors_origins: str = "http://localhost:5173"
    # URL pública do frontend — usada só pra montar o link de "definir senha"
    # dentro do e-mail de convite de um corretor novo.
    frontend_url: str = "http://localhost:5173"
    # Documentação interativa da API (/docs, /redoc, /openapi.json) — desligada
    # por padrão (segura por padrão): em produção não tem motivo pra deixar
    # qualquer um ver a lista completa de rotas e formatos da API. Ligue só
    # localmente (ENABLE_DOCS=true no seu .env), nunca no Render.
    enable_docs: bool = False

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
