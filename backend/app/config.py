from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_key: str
    supabase_anon_key: str = ""
    notificacao_email: str = ""
    # Chave da API do Resend (resend.com) — usada só pelo botão de suporte
    # do painel (ver app/email_service.py e app/routers/suporte.py). Sem
    # essa chave configurada, abrir um chamado falha com um erro explícito
    # em vez de fingir que o e-mail foi enviado.
    resend_api_key: str = ""
    # Pra onde o chamado de suporte é mandado.
    suporte_email: str = "italonunesdev@proton.me"
    cors_origins: str = "http://localhost:5173"
    # URL pública do frontend — hoje não é mais usada por nenhum e-mail (o
    # login de corretor não depende mais disso, ver app/usuarios.py), mas
    # fica pra eventual uso futuro.
    frontend_url: str = "http://localhost:5173"
    # Segredo pra assinar/validar o JWT do login do painel (ver app/security.py
    # e app/usuarios.py) — login próprio, não passa mais pelo Supabase Auth.
    # OBRIGATÓRIO trocar em produção por um valor longo e aleatório (ex.:
    # `python -c "import secrets; print(secrets.token_hex(32))"`); se ficar
    # no valor padrão, qualquer um que leia o código consegue forjar um login.
    jwt_secret: str = "troque-este-segredo-em-producao"
    # Validade do login — depois disso a pessoa precisa entrar de novo.
    jwt_validade_horas: int = 24 * 30
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
