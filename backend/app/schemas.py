import re
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

LoteStatus = Literal["disponivel", "reservado", "vendido"]
ReservaStatus = Literal[
    "pendente", "em_atendimento", "aguardando_qualificacao", "em_analise_financeira", "confirmada", "cancelada"
]

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _valida_contato(v: str) -> str:
    """Aceita telefone (com DDD, 10 ou 11 dígitos) ou e-mail — o que vier no
    campo único "telefone ou e-mail" do formulário de reserva."""
    if "@" in v:
        if not _EMAIL_RE.match(v):
            raise ValueError("E-mail inválido.")
        return v
    digitos = re.sub(r"\D", "", v)
    if len(digitos) < 10 or len(digitos) > 11:
        raise ValueError("Telefone inválido — informe o DDD + número (10 ou 11 dígitos).")
    return v


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
    landing_page_url: Optional[str] = None
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
    # Só True depois que um admin marcou manualmente os cantos do lote sobre a
    # planta real, na ferramenta do painel — até lá, `poligono` é apenas um
    # placeholder de grade (ver migração 0008) e não deve ser desenhado como
    # a forma real do lote.
    poligono_definido: bool = False
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


class ImportacaoLinha(BaseModel):
    """Uma linha da planilha importada cujo status difere do que está hoje no
    banco (ver POST /condominios/lotes/importar/preview) — só as diferenças
    aparecem aqui, não a planilha inteira."""

    lote_id: str
    quadra: str
    lote_numero: int
    identificador: str
    status_atual: LoteStatus
    status_planilha: LoteStatus


class ImportacaoPreview(BaseModel):
    condominio_id: str
    condominio_nome: str
    total_linhas_planilha: int
    total_casadas: int
    total_alteracoes: int
    linhas: list[ImportacaoLinha]
    # Linhas da planilha (quadra/lote) que não bateram com nenhum lote do
    # empreendimento — normalmente erro de digitação na planilha do admin.
    nao_encontrados: list[str]


class ImportacaoConfirmarItem(BaseModel):
    lote_id: str
    status: LoteStatus


class ImportacaoConfirmarPayload(BaseModel):
    """O front manda de volta só os itens que ficaram marcados na tela de
    preview — não reprocessa a planilha, evitando reler o arquivo (que já
    pode ter sido fechado/trocado do lado do admin) uma segunda vez."""

    itens: list[ImportacaoConfirmarItem]


class LotePoligonoUpdate(BaseModel):
    """Marca manual dos cantos do lote sobre a planta real (ferramenta do
    painel, admin) — mesmo espaço de coordenadas de CondominioDetalhe
    (plan_w/plan_h/plan_minx/plan_miny). Lista vazia "desmarca" o lote (volta
    a cair no fallback de zona por quadra)."""

    poligono: list[list[float]]


class ReservaCreate(BaseModel):
    """Pedido de reserva feito pelo cliente no catálogo público — contato é
    obrigatório (telefone ou e-mail) pra evitar leads sem nenhum jeito de
    retorno; nome fica opcional.

    `cpf` existe pra suportar o fluxo novo (corretor loga, informa nome
    completo + CPF opcional + lote na hora de reservar, sem precisar de um
    Cadastro de Cliente separado) — nunca obrigatório."""

    nome: Optional[str] = None
    contato: str
    cpf: Optional[str] = None
    observacao: Optional[str] = None

    @field_validator("contato")
    @classmethod
    def _contato_obrigatorio(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Informe um telefone ou e-mail para contato.")
        return _valida_contato(v)


class ReservaPublicaCreate(ReservaCreate):
    """Pedido vindo do formulário público (sem login) — carrega, além dos
    campos normais, dois sinais anti-spam que só fazem sentido nesse
    contexto (ver backend/app/antispam.py): um honeypot (`website`, campo
    escondido que só um bot preenche) e o instante em que o formulário foi
    carregado (`carregado_em`, epoch em ms — usado pra rejeitar envios rápidos
    demais pra terem sido digitados). Nenhum dos dois é salvo no banco."""

    website: Optional[str] = None
    carregado_em: Optional[int] = None


class ReservaCreateInterna(ReservaCreate):
    """Criação manual de um pedido pelo painel (corretor/admin) — diferente do
    pedido público (POST /lotes/{id}/reservar), aqui quem cria escolhe o lote
    e o contato pode ficar em branco por enquanto (é o formulário público que
    precisa garantir um jeito de retorno; internamente o corretor já sabe
    quem é o lead)."""

    lote_id: str
    contato: Optional[str] = None

    @field_validator("contato")
    @classmethod
    def _contato_opcional(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip() or None
        return _valida_contato(v) if v else v


class ReservaUpdate(BaseModel):
    """Edição dos dados do pedido (não do status — ver ReservaStatusUpdate).
    Contato aqui também é opcional (pode já estar preenchido, ou o corretor
    só quer corrigir o nome) — mas se vier preenchido, precisa ser válido."""

    nome: Optional[str] = None
    contato: Optional[str] = None
    cpf: Optional[str] = None
    observacao: Optional[str] = None

    @field_validator("contato")
    @classmethod
    def _contato_valido_se_preenchido(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip() or None
        return _valida_contato(v) if v else v


class Reserva(BaseModel):
    id: str
    lote_id: str
    nome: Optional[str] = None
    contato: Optional[str] = None
    cpf: Optional[str] = None
    observacao: Optional[str] = None
    status: ReservaStatus
    cliente_id: Optional[str] = None
    corretor_id: Optional[str] = None
    # Preenchido só quando a própria reserva nasceu sozinha, a partir da
    # aprovação de uma proposta (ver atualizar_status_proposta em
    # routers/crm.py) — None em toda reserva criada do jeito normal (link
    # público ou formulário do painel).
    proposta_id: Optional[str] = None
    analise_prazo_em: Optional[datetime] = None
    # Prazo duro de 24h — passou disso sem confirmar, a reserva expira
    # sozinha (ver _expirar_vencidas em routers/reservas.py). Só None em
    # reserva já 'confirmada'/'cancelada' criada antes desta regra existir.
    expira_em: Optional[datetime] = None
    created_at: datetime


class ReservaComLote(Reserva):
    lote: Optional[Lote] = None


class ReservaStatusUpdate(BaseModel):
    status: ReservaStatus
    corretor_id: Optional[str] = None


class LoteComCondominio(Lote):
    """Lote com o nome/slug do condomínio embutido — usado só na listagem
    unificada do painel (ver GET /crm/lotes)."""

    condominio_nome: str
    condominio_slug: str
    # "Observação" com data/hora que a tela de Lotes mostra assim que um
    # corretor cria uma proposta (mesmo em rascunho) pra esse lote — avisa o
    # admin que tem gente em negociação antes mesmo de virar reserva. Vem só
    # de propostas ainda abertas (rascunho/aguardando_aprovacao); some
    # sozinho quando a proposta é aprovada (aí já virou reserva, ver
    # atualizar_status_proposta) ou é recusada/cancelada. Tipado como str
    # solto (não PropostaStatus) só porque esse Literal é definido mais
    # abaixo no arquivo, depois da seção de lotes.
    proposta_pendente_status: Optional[str] = None
    proposta_pendente_desde: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Campos do formulário completo (RG, endereços, cônjuge, forma de pagamento
# detalhada etc.) — mesmos da Proposta de Compra/Venda em papel. Usado tanto
# pelo formulário público de qualificação (dados guardados em
# formularios_qualificacao.dados, ver mais abaixo) quanto por
# PropostaCreate.dados_qualificacao (formulário completo preenchido direto
# pelo corretor no painel, sem link de qualificação — daí precisar estar
# definido antes do bloco de CRM/propostas, logo abaixo).
# ---------------------------------------------------------------------------

EstadoCivil = Literal["solteiro", "casado", "viuvo", "divorciado", "outros"]


class EnderecoDados(BaseModel):
    rua: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    cep: Optional[str] = None


class PessoaDados(BaseModel):
    """Campos de identificação — usado tanto para o proponente quanto (se
    casado) para o cônjuge, igual ao formulário em papel."""

    nome: Optional[str] = None
    rg: Optional[str] = None
    orgao_expedidor: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    data_nascimento: Optional[str] = None
    nacionalidade: Optional[str] = None
    email: Optional[str] = None
    profissao: Optional[str] = None


class FormaPagamentoDados(BaseModel):
    a_vista: Optional[bool] = None
    renda: Optional[str] = None
    valor_proposto: Optional[float] = None
    sinal: Optional[str] = None
    sinal_cheque_numero: Optional[str] = None
    sinal_banco: Optional[str] = None
    sinal_agencia: Optional[str] = None
    dividido_em_parcelas: Optional[int] = None
    valor_parcela: Optional[str] = None
    vencimento: Optional[str] = None
    primeiro_mes: Optional[str] = None
    intercaladas_valor: Optional[str] = None
    intercaladas_vencimento_dia: Optional[str] = None
    observacoes: Optional[str] = None


class QualificacaoDados(BaseModel):
    """Corpo completo do formulário (mesmos campos da Proposta de
    Compra/Venda em papel) — guardado como JSON, seja em
    `formularios_qualificacao.dados` (preenchido pelo cliente final via link
    público) ou em `propostas.dados_qualificacao` (preenchido direto pelo
    corretor no painel). Tudo opcional no schema porque pode ser salvo
    parcialmente entre etapas; a validação de "está completo o bastante"
    é feita à parte, em cada fluxo (ver qualificacao.py e routers/crm.py)."""

    proponente: PessoaDados = Field(default_factory=PessoaDados)
    estado_civil: Optional[EstadoCivil] = None
    conjuge: Optional[PessoaDados] = None
    endereco_residencial: EnderecoDados = Field(default_factory=EnderecoDados)
    endereco_comercial: EnderecoDados = Field(default_factory=EnderecoDados)
    # Nem todo proponente tem endereço comercial próprio (autônomo, aposentado
    # etc.) — sem essa flag não dá pra distinguir "não preencheu ainda" de
    # "não se aplica" na validação do envio final (ver enviar_para_analise).
    endereco_comercial_nao_possui: Optional[bool] = None
    # Pra qual dos dois endereços vai a correspondência — mesmo campo
    # "Comercial ( ) / Residencial ( )" da lateral do formulário em papel.
    endereco_correspondencia: Optional[Literal["residencial", "comercial"]] = None
    telefone_residencial: Optional[str] = None
    telefone_comercial: Optional[str] = None
    telefone_celular: Optional[str] = None
    telefone_recados: Optional[str] = None
    falar_com: Optional[str] = None
    forma_pagamento: FormaPagamentoDados = Field(default_factory=FormaPagamentoDados)


# ---------------------------------------------------------------------------
# CRM: clientes/leads, corretores e propostas de compra e venda.
# ---------------------------------------------------------------------------

PropostaStatus = Literal[
    "rascunho", "aguardando_aprovacao", "aprovada", "enviada", "aceita", "recusada", "cancelada"
]


class ClienteCreate(BaseModel):
    nome: str
    telefone: Optional[str] = None
    email: Optional[str] = None
    cpf: Optional[str] = None
    observacoes: Optional[str] = None
    origem: Optional[str] = None
    corretor_id: Optional[str] = None


class ClienteUpdate(BaseModel):
    """Todos os campos opcionais: só entra na atualização o que vier preenchido."""

    nome: Optional[str] = None
    telefone: Optional[str] = None
    email: Optional[str] = None
    cpf: Optional[str] = None
    observacoes: Optional[str] = None
    origem: Optional[str] = None
    corretor_id: Optional[str] = None


class Cliente(ClienteCreate):
    id: str
    created_at: datetime


Papel = Literal["admin", "corretor"]


class CorretorCreate(BaseModel):
    """Login por usuário (não mais convite por e-mail — ver
    routers/crm.py::criar_corretor e app/usuarios.py). `telefone` é
    obrigatório porque vira a senha inicial (só os dígitos); `usuario` é
    opcional — se não vier, é gerado a partir do nome (nome.sobrenome)."""

    nome: str
    telefone: str
    usuario: Optional[str] = None
    papel: Papel = "corretor"


class CorretorUpdate(BaseModel):
    nome: Optional[str] = None
    telefone: Optional[str] = None
    papel: Optional[Papel] = None
    ativo: Optional[bool] = None
    # Força a senha de login de volta pro telefone atual, mesmo que o
    # corretor já tenha trocado a própria senha (senha_customizada=True) —
    # via manual do admin pra destravar quem esqueceu a senha. Ver
    # atualizar_corretor em routers/crm.py.
    resetar_senha: Optional[bool] = None


class Corretor(BaseModel):
    id: str
    nome: str
    usuario: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    papel: Papel = "corretor"
    ativo: bool = True
    # True assim que o corretor troca a própria senha (POST /crm/me/senha)
    # — impede que uma correção de telefone sobrescreva sem avisar uma
    # senha que a pessoa escolheu.
    senha_customizada: bool = False
    # Só vem preenchido na resposta de PATCH /crm/corretores/{id} quando a
    # senha acabou de ser (re)sincronizada com o telefone — mesma ideia do
    # `senha` de CorretorCriado: única vez que aparece em texto puro.
    senha: Optional[str] = None


class CorretorCriado(Corretor):
    """Resposta de POST /crm/corretores — a única vez que a senha inicial
    (texto puro) aparece em algum lugar, pro admin poder repassar pro
    corretor. Depois disso ninguém mais consegue ver essa senha (o Supabase
    Auth só guarda o hash)."""

    senha: str


class LoginRequest(BaseModel):
    """Body de POST /crm/login — login próprio, sem Supabase Auth (ver
    app/security.py e app/usuarios.py)."""

    usuario: str
    senha: str


class LoginResponse(BaseModel):
    """Resposta de POST /crm/login — o front guarda `access_token` (JWT) e
    manda ele em `Authorization: Bearer` nas próximas chamadas."""

    access_token: str
    corretor: Corretor


class TrocarSenhaRequest(BaseModel):
    """Body de POST /crm/me/senha — o próprio corretor logado troca a
    senha, precisa confirmar a atual (evita que alguém que ache uma sessão
    aberta troque a senha sem saber a antiga)."""

    senha_atual: str
    senha_nova: str


class CorretorImportadoItem(BaseModel):
    """Uma linha do resultado de POST /crm/corretores/importar."""

    nome: str
    usuario: str
    senha: Optional[str] = None
    ativo: bool
    status: Literal["criado", "ja_existia", "erro"]
    erro: Optional[str] = None


class PropostaCreate(BaseModel):
    lote_id: str
    cliente_id: str
    corretor_id: Optional[str] = None
    valor_proposto: float
    condicoes_pagamento: Optional[str] = None
    observacoes: Optional[str] = None
    # Formulário completo (RG, endereços, cônjuge, forma de pagamento
    # detalhada etc.) — preenchido quando o corretor cria a proposta com o
    # formulário completo direto no painel (PropostaFormularioCompleto.tsx),
    # sem passar pelo link de qualificação do cliente final. Mesmo formato
    # de formularios_qualificacao.dados — usado por gerar_proposta_pdf.
    dados_qualificacao: Optional[QualificacaoDados] = None


class PropostaStatusUpdate(BaseModel):
    status: PropostaStatus


class PropostaUpdate(BaseModel):
    """Edição dos dados da proposta (não do status — ver PropostaStatusUpdate)."""

    valor_proposto: Optional[float] = None
    condicoes_pagamento: Optional[str] = None
    observacoes: Optional[str] = None


class Proposta(BaseModel):
    id: str
    lote_id: str
    cliente_id: str
    corretor_id: Optional[str] = None
    formulario_id: Optional[str] = None
    valor_proposto: float
    condicoes_pagamento: Optional[str] = None
    status: PropostaStatus
    documento_url: Optional[str] = None
    observacoes: Optional[str] = None
    dados_qualificacao: Optional[dict] = None
    created_at: datetime


class PropostaDetalhe(Proposta):
    lote: Optional[Lote] = None
    cliente: Optional[Cliente] = None
    # Forward ref (classe "DocumentoProposta" só é definida mais abaixo,
    # depois de DocumentoTipo) — mesmo padrão já usado por
    # QualificacaoComRelacoes.documentos logo abaixo neste arquivo.
    documentos: list["DocumentoProposta"] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Visão geral (painel gerencial, só admin): números consolidados por
# empreendimento — pra dashboard e pro relatório em PDF.
# ---------------------------------------------------------------------------


class VisaoGeralCondominio(BaseModel):
    condominio_id: str
    nome: str
    slug: str
    total_lotes: int
    disponiveis: int
    reservados: int
    vendidos: int
    valor_total_vendido: float
    propostas_abertas: int
    valor_em_propostas_abertas: float


# ---------------------------------------------------------------------------
# Qualificação do cliente: o corretor reserva o lote, cadastra o cliente com
# o mínimo (nome/telefone/CPF) e gera um link público. O cliente final
# preenche, sem login, os mesmos campos da Proposta de Compra/Venda em papel
# e anexa os documentos exigidos. Vai pra análise financeira manual no
# painel — aprovado já gera a proposta.
# ---------------------------------------------------------------------------

QualificacaoStatus = Literal["aguardando_preenchimento", "em_analise", "aprovada", "reprovada"]
DocumentoTipo = Literal[
    "rg", "cpf", "comprovante_residencia", "certidao_nascimento_casamento",
    "conjuge_rg", "conjuge_cpf", "comprovante_renda", "outro",
]

DOCUMENTOS_OBRIGATORIOS: tuple[DocumentoTipo, ...] = (
    "rg", "cpf", "comprovante_residencia", "certidao_nascimento_casamento", "comprovante_renda",
)
# Exigidos só quando estado_civil == "casado" (ver _valida_documentos_obrigatorios em qualificacao.py).
DOCUMENTOS_CONJUGE: tuple[DocumentoTipo, ...] = ("conjuge_rg", "conjuge_cpf")

# EstadoCivil, EnderecoDados, PessoaDados, FormaPagamentoDados e
# QualificacaoDados moraram aqui antes — subiram pra antes do bloco de CRM
# (ver acima de PropostaStatus) porque PropostaCreate.dados_qualificacao
# (formulário completo preenchido direto pelo corretor no painel, sem link
# de qualificação) passou a referenciar QualificacaoDados também.


class QualificacaoCreate(BaseModel):
    """O corretor gera o link a partir de uma reserva existente — escolhendo
    um cliente já cadastrado ou cadastrando um novo ali mesmo (mínimo:
    nome/telefone/CPF)."""

    cliente_id: Optional[str] = None
    cliente_novo: Optional[ClienteCreate] = None


class Qualificacao(BaseModel):
    id: str
    reserva_id: str
    lote_id: str
    cliente_id: str
    corretor_id: Optional[str] = None
    token: str
    status: QualificacaoStatus
    dados: dict = Field(default_factory=dict)
    enviado_em: Optional[datetime] = None
    analisado_em: Optional[datetime] = None
    analisado_por: Optional[str] = None
    motivo_reprovacao: Optional[str] = None
    created_at: datetime


class QualificacaoComRelacoes(Qualificacao):
    lote: Optional[Lote] = None
    cliente: Optional[Cliente] = None
    corretor: Optional[Corretor] = None
    documentos: list["DocumentoQualificacao"] = Field(default_factory=list)


class DocumentoQualificacao(BaseModel):
    id: str
    formulario_id: str
    tipo: DocumentoTipo
    nome_arquivo: str
    tamanho_bytes: Optional[int] = None
    enviado_em: datetime


class DocumentoProposta(BaseModel):
    """Documento anexado direto numa proposta pelo corretor logado, pelo
    painel — independente do fluxo (mais antigo, por link público) de
    documentos_qualificacao acima. Ver routers/crm.py."""

    id: str
    proposta_id: str
    tipo: DocumentoTipo
    nome_arquivo: str
    tamanho_bytes: Optional[int] = None
    enviado_por: Optional[str] = None
    enviado_em: datetime


class QualificacaoPublica(BaseModel):
    """O que o cliente final vê ao abrir o link — só o necessário pra
    preencher o formulário, nada de dados internos (corretor, ids de
    outros clientes etc.)."""

    status: QualificacaoStatus
    dados: dict = Field(default_factory=dict)
    documentos: list[DocumentoQualificacao] = Field(default_factory=list)
    lote_identificador: str
    condominio_nome: str
    motivo_reprovacao: Optional[str] = None


class QualificacaoDecisao(BaseModel):
    aprovado: bool
    motivo_reprovacao: Optional[str] = None
