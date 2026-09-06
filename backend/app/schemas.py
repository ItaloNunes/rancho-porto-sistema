from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

LoteStatus = Literal["disponivel", "reservado", "vendido"]
ReservaStatus = Literal["pendente", "confirmada", "cancelada"]


class CondominioResumo(BaseModel):
    """Usado na tela de seleção (home): não carrega a lista de lotes."""

    id: str
    slug: str
    nome: str
    incorporadora: Optional[str] = None
    cidade: Optional[str] = None
    segmento: Optional[str] = None
    descricao: Optional[str] = None
    logo_url: Optional[str] = None
    hero_image_url: Optional[str] = None
    total_lotes: int = 0
    total_disponiveis: int = 0


class PlanoDecoracao(BaseModel):
    river: list[list[float]] = Field(default_factory=list)
    lagoon: Optional[dict] = None
    entranceRoad: Optional[dict] = None
    roundabout1: Optional[dict] = None
    roundabout2: Optional[dict] = None


class QuadraZona(BaseModel):
    """Zona clicável aproximada usada no modo planta-em-imagem (ver
    CondominioDetalhe.plan_image_url). Coordenadas no mesmo espaço de plan_w/plan_h.

    Duas formas de casar a zona com os lotes da lista, dependendo do condomínio:
    - `quadra`: quando o empreendimento tem quadras reais (ex.: Porto Franco) — casa
      por igualdade com `Lote.quadra`.
    - `lote_min`/`lote_max`: quando não há agrupamento por quadra e a zona representa
      uma faixa de números de lote (ex.: Rancho Texas, onde cada lote é sua própria
      "quadra") — casa por `lote_min <= Lote.lote_numero <= lote_max`.
    `label`, quando presente, é o texto mostrado no lugar de "Quadra {quadra}".
    """

    quadra: Optional[str] = None
    lote_min: Optional[int] = None
    lote_max: Optional[int] = None
    label: Optional[str] = None
    x: float
    y: float
    w: float
    h: float


class Lote(BaseModel):
    id: str
    condominio_id: str
    quadra: str
    lote_numero: int
    identificador: str
    tamanho_m2: float
    valor_total: Optional[float] = None
    entrada: Optional[float] = None
    entrega: Optional[float] = None
    parcela_mensal: Optional[float] = None
    qtd_parcelas: Optional[int] = None
    prazo_entrega_meses: Optional[int] = None
    status: LoteStatus
    poligono: list[list[float]]
    foto_url: Optional[str] = None


class CondominioDetalhe(CondominioResumo):
    plan_w: Optional[float] = None
    plan_h: Optional[float] = None
    plan_minx: Optional[float] = None
    plan_miny: Optional[float] = None
    plan_decor: Optional[PlanoDecoracao] = None
    plan_image_url: Optional[str] = None
    plan_quadras: Optional[list[QuadraZona]] = None
    base_precos_em: Optional[date] = None
    lotes: list[Lote] = Field(default_factory=list)


class LoteStatusUpdate(BaseModel):
    status: LoteStatus


class ReservaCreate(BaseModel):
    nome: Optional[str] = None
    contato: Optional[str] = None
    observacao: Optional[str] = None


class Reserva(BaseModel):
    id: str
    lote_id: str
    nome: Optional[str] = None
    contato: Optional[str] = None
    observacao: Optional[str] = None
    status: ReservaStatus
    cliente_id: Optional[str] = None
    corretor_id: Optional[str] = None
    created_at: datetime


class ReservaComLote(Reserva):
    lote: Optional[Lote] = None


class ReservaStatusUpdate(BaseModel):
    status: ReservaStatus


# ---------------------------------------------------------------------------
# CRM: clientes/leads, corretores e propostas de compra e venda.
# ---------------------------------------------------------------------------

PropostaStatus = Literal["rascunho", "enviada", "aceita", "recusada", "cancelada"]


class ClienteCreate(BaseModel):
    nome: str
    telefone: Optional[str] = None
    email: Optional[str] = None
    cpf: Optional[str] = None
    observacoes: Optional[str] = None
    origem: Optional[str] = None


class Cliente(ClienteCreate):
    id: str
    created_at: datetime


class Corretor(BaseModel):
    id: str
    nome: str
    email: Optional[str] = None
    telefone: Optional[str] = None
    ativo: bool = True


class PropostaCreate(BaseModel):
    lote_id: str
    cliente_id: str
    corretor_id: Optional[str] = None
    valor_proposto: float
    condicoes_pagamento: Optional[str] = None
    observacoes: Optional[str] = None


class PropostaStatusUpdate(BaseModel):
    status: PropostaStatus


class Proposta(BaseModel):
    id: str
    lote_id: str
    cliente_id: str
    corretor_id: Optional[str] = None
    valor_proposto: float
    condicoes_pagamento: Optional[str] = None
    status: PropostaStatus
    documento_url: Optional[str] = None
    observacoes: Optional[str] = None
    created_at: datetime


class PropostaDetalhe(Proposta):
    lote: Optional[Lote] = None
    cliente: Optional[Cliente] = None
