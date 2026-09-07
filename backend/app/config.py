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

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
