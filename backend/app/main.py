import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import condominios, crm, qualificacao, reservas

logger = logging.getLogger(__name__)

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


@app.exception_handler(Exception)
async def erro_inesperado(request: Request, exc: Exception):
    """Sem isso, uma exceção não tratada (ex.: erro de query no Supabase)
    "escapa" por fora do CORSMiddleware — o navegador recebe a resposta de
    erro sem o header Access-Control-Allow-Origin, bloqueia ela por CORS, e
    o fetch() do painel rejeita com "Failed to fetch" (sem mensagem nenhuma
    pra saber o que houve, e sem sair do ar nem com o F5). Capturando aqui
    devolve um 500 de verdade, com CORS, e uma mensagem legível."""
    logger.exception("Erro não tratado em %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Erro interno no servidor. Tente novamente."})


app.include_router(condominios.router)
app.include_router(reservas.router)
app.include_router(reservas.admin_router)
app.include_router(crm.router, prefix="/crm")
app.include_router(qualificacao.router)
app.include_router(qualificacao.admin_router, prefix="/crm")


@app.get("/health")
def health():
    return {"status": "ok"}
