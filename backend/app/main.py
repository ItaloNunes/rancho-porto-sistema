from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import condominios, crm, qualificacao, reservas

app = FastAPI(
    title="Rancho Porto | Catálogo de Lotes",
    description="API do catálogo de lotes (Rancho Texas / Porto Franco) e do painel gerencial interno.",
    version="0.1.0",
    # Desligado por padrão (ver Settings.enable_docs) — em produção não expõe
    # a lista completa de rotas/schemas pra quem não precisa ver.
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(condominios.router)
app.include_router(reservas.router)
app.include_router(reservas.admin_router)
app.include_router(crm.router, prefix="/crm")
app.include_router(qualificacao.router)
app.include_router(qualificacao.admin_router, prefix="/crm")


@app.get("/health")
def health():
    return {"status": "ok"}
