from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import condominios, crm, reservas

app = FastAPI(
    title="Rancho Porto | Catálogo de Lotes",
    description="API do catálogo de lotes (Rancho Texas / Porto Franco) e do painel gerencial interno.",
    version="0.1.0",
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


@app.get("/health")
def health():
    return {"status": "ok"}
