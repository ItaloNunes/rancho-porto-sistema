"""Painel gerencial (CRM): clientes/leads, corretores e propostas de compra
e venda. Tudo aqui exige login (ver security.get_current_corretor) — nada é
exposto no catálogo público.

Dois papéis:
- **admin**: gerencia logins de corretores (cria/edita/desativa) e vê tudo.
- **corretor**: vê e edita só os próprios clientes/propostas — mais os
  "leads" ainda sem corretor_id definido, que qualquer um pode reivindicar
  (útil pra reservas feitas direto pelo cliente no catálogo público, sem
  corretor envolvido ainda).

O PDF da proposta de compra e venda (gerar_pdf_proposta, abaixo) reproduz o
layout exato do formulário em papel usado pela imobiliária (Proposta de
Compra/Venda Castel, operada com a JR Imóveis) — ver app/pdf.py.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ..data.corretores_iniciais import RAW as CORRETORES_INICIAIS
from ..database import get_supabase
from ..pdf import gerar_proposta_pdf, gerar_visao_geral_pdf
from ..schemas import (
    Cliente,
    ClienteCreate,
    ClienteUpdate,
    Corretor,
    CorretorCreate,
    CorretorCriado,
    CorretorImportadoItem,
    CorretorUpdate,
    LoginRequest,
    LoginResponse,
    LoteComCondominio,
    Proposta,
    PropostaCreate,
    PropostaDetalhe,
    PropostaStatusUpdate,
    PropostaUpdate,
    TrocarSenhaRequest,
    VisaoGeralCondominio,
)
from ..security import criar_token, get_current_corretor, require_admin
from ..usuarios import gerar_usuario_unico, hash_senha, senha_de_telefone, verificar_senha
from ..usuarios import slug as slug_usuario

router = APIRouter(tags=["crm"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    """Login próprio do painel — usuário + senha, sem Supabase Auth e sem
    e-mail em nenhuma etapa (ver app/security.py e app/usuarios.py)."""
    sb = get_supabase()
    usuario = payload.usuario.strip().lower()
    corretor = sb.table("corretores").select("*").eq("usuario", usuario).limit(1).execute().data
    if not corretor or not verificar_senha(payload.senha, corretor[0].get("senha_hash")):
        raise HTTPException(401, "Usuário ou senha incorretos.")
    if not corretor[0]["ativo"]:
        raise HTTPException(403, "Este login não tem acesso ao painel.")
    token = criar_token(corretor[0]["id"])
    return {"access_token": token, "corretor": corretor[0]}


@router.post("/me/senha", response_model=Corretor)
def trocar_minha_senha(payload: TrocarSenhaRequest, corretor: dict = Depends(get_current_corretor)):
    """O próprio corretor logado troca a senha (precisa confirmar a atual).
    Marca `senha_customizada=True` — daqui pra frente, corrigir o telefone
    dele não sobrescreve mais essa senha sozinho (ver atualizar_corretor)."""
    if not verificar_senha(payload.senha_atual, corretor.get("senha_hash")):
        raise HTTPException(401, "Senha atual incorreta.")
    if len(payload.senha_nova) < 6:
        raise HTTPException(400, "A senha nova precisa ter pelo menos 6 caracteres.")
    sb = get_supabase()
    return (
        sb.table("corretores")
        .update({"senha_hash": hash_senha(payload.senha_nova), "senha_customizada": True})
        .eq("id", corretor["id"])
        .execute()
        .data[0]
    )


@router.get("/me", response_model=Corretor)
def meu_perfil(corretor: dict = Depends(get_current_corretor)):
    """O front usa isso pra saber quem está logado e qual o papel (admin ou
    corretor), pra decidir o que mostrar no painel."""
    return corretor


# ---------------------------------------------------------------------------
# Corretores (logins do painel) — só admin gerencia.
# ---------------------------------------------------------------------------


@router.get("/corretores", response_model=list[Corretor])
def listar_corretores(_admin: dict = Depends(require_admin)):
    return get_supabase().table("corretores").select("*").order("nome").execute().data


@router.post("/corretores", response_model=CorretorCriado)
def criar_corretor(payload: CorretorCreate, _admin: dict = Depends(require_admin)):
    """Login por usuário (ver app/usuarios.py): a conta já nasce pronta pra
    usar, com senha = telefone (só dígitos). O admin repassa usuário+senha
    pro corretor por fora (WhatsApp, etc.); essa é a única resposta que traz
    a senha em texto puro."""
    sb = get_supabase()
    ja_usados = {
        c["usuario"] for c in sb.table("corretores").select("usuario").execute().data if c.get("usuario")
    }
    usuario = payload.usuario.strip().lower() if payload.usuario else None
    if usuario:
        if usuario in ja_usados:
            raise HTTPException(409, "Já existe um login com esse usuário.")
    else:
        usuario = gerar_usuario_unico(payload.nome, ja_usados)

    senha = senha_de_telefone(payload.telefone)
    if len(senha) < 6:
        raise HTTPException(400, "Telefone inválido pra gerar a senha (mínimo 6 dígitos).")

    row = {
        "nome": payload.nome,
        "usuario": usuario,
        "senha_hash": hash_senha(senha),
        "telefone": payload.telefone,
        "papel": payload.papel,
        "ativo": True,
    }
    inserido = sb.table("corretores").insert(row).execute().data[0]
    return {**inserido, "senha": senha}


@router.post("/corretores/importar", response_model=list[CorretorImportadoItem])
def importar_corretores(_admin: dict = Depends(require_admin)):
    """Cadastra de uma vez todos os corretores da planilha inicial (ver
    app/data/corretores_iniciais.py) — usuário = nome.sobrenome, senha =
    telefone (só dígitos). Quem estava marcado como "saiu do grupo" na
    planilha é cadastrado mesmo assim, mas já `ativo=False` (não some o
    registro, só não consegue logar até o admin reativar).

    Idempotente: roda de novo com segurança — usuário que já existe é
    pulado (status "ja_existia", sem repetir a criação nem reexibir a
    senha, que só sai uma vez, na hora da criação)."""
    sb = get_supabase()
    ja_usados = {
        c["usuario"] for c in sb.table("corretores").select("usuario").execute().data if c.get("usuario")
    }
    vistos_na_planilha: set[tuple[str, str]] = set()
    resultado: list[dict] = []

    for nome, telefone, saiu_do_grupo in CORRETORES_INICIAIS:
        chave = (nome.strip().lower(), telefone.strip())
        if chave in vistos_na_planilha:
            continue  # linha idêntica repetida na planilha original
        vistos_na_planilha.add(chave)

        # se já existe alguém com o mesmo "slug base" (com ou sem sufixo
        # numérico de desempate), pula por segurança em vez de arriscar
        # recriar/duplicar — é o que torna essa rota idempotente
        base = slug_usuario(nome)
        ja_importado = base in ja_usados or any(
            u == base or (u.startswith(base) and u[len(base) :].isdigit()) for u in ja_usados
        )
        if ja_importado:
            # provavelmente já importado numa rodada anterior — não dá pra
            # saber com 100% de certeza qual usuário exato ficou pra esse
            # nome sem guardar de-para, então só registra como "ja_existia"
            resultado.append(
                {
                    "nome": nome,
                    "usuario": base,
                    "senha": None,
                    "ativo": not saiu_do_grupo,
                    "status": "ja_existia",
                    "erro": None,
                }
            )
            continue

        usuario = gerar_usuario_unico(nome, ja_usados)
        senha = senha_de_telefone(telefone)
        if len(senha) < 6:
            resultado.append(
                {
                    "nome": nome,
                    "usuario": usuario,
                    "senha": None,
                    "ativo": False,
                    "status": "erro",
                    "erro": "Telefone inválido pra gerar senha.",
                }
            )
            continue

        try:
            sb.table("corretores").insert(
                {
                    "nome": nome,
                    "usuario": usuario,
                    "senha_hash": hash_senha(senha),
                    "telefone": telefone,
                    "papel": "corretor",
                    "ativo": not saiu_do_grupo,
                }
            ).execute()
            resultado.append(
                {
                    "nome": nome,
                    "usuario": usuario,
                    "senha": senha,
                    "ativo": not saiu_do_grupo,
                    "status": "criado",
                    "erro": None,
                }
            )
        except Exception as exc:
            resultado.append(
                {
                    "nome": nome,
                    "usuario": usuario,
                    "senha": None,
                    "ativo": False,
                    "status": "erro",
                    "erro": str(exc),
                }
            )

    return resultado


@router.patch("/corretores/{corretor_id}", response_model=Corretor)
def atualizar_corretor(corretor_id: str, payload: CorretorUpdate, _admin: dict = Depends(require_admin)):
    sb = get_supabase()
    existente = sb.table("corretores").select("*").eq("id", corretor_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Corretor não encontrado.")
    existente = existente[0]
    payload_dict = payload.model_dump()
    resetar_senha = payload_dict.pop("resetar_senha", None)
    updates = {k: v for k, v in payload_dict.items() if v is not None}

    telefone_novo = updates.get("telefone", existente.get("telefone"))
    telefone_mudou = "telefone" in updates and updates["telefone"] != existente.get("telefone")

    # Telefone é a senha de login por padrão (ver app/usuarios.py) — se o
    # admin corrige um telefone digitado errado, a senha de fato precisa
    # acompanhar, senão o corretor continua tomando "usuário ou senha
    # incorretos" com o telefone (certo) que acabou de receber.
    #
    # Exceção: se o corretor já trocou a própria senha (senha_customizada),
    # um telefone editado por outro motivo qualquer não deve sobrescrever
    # sem avisar a senha que a pessoa escolheu — nesse caso só sincroniza de
    # volta se o admin pedir explicitamente via `resetar_senha` (ex.: pra
    # destravar alguém que esqueceu a senha customizada).
    deve_sincronizar_senha = (telefone_mudou and not existente.get("senha_customizada")) or resetar_senha

    nova_senha = None
    if deve_sincronizar_senha:
        nova_senha = senha_de_telefone(telefone_novo)
        if len(nova_senha) < 6:
            raise HTTPException(400, "Telefone inválido pra gerar a senha (mínimo 6 dígitos).")
        updates["senha_hash"] = hash_senha(nova_senha)
        # Depois de sincronizar (seja pela mudança de telefone, seja por um
        # reset manual), a senha volta a ser "o telefone" — limpa a marca.
        updates["senha_customizada"] = False

    if not updates:
        return existente

    atualizado = sb.table("corretores").update(updates).eq("id", corretor_id).execute().data[0]

    resposta = dict(atualizado)
    if nova_senha:
        # Única vez que essa senha (re)sincronizada aparece em texto puro —
        # mesma regra de POST /corretores (CorretorCriado.senha).
        resposta["senha"] = nova_senha
    return resposta


@router.delete("/corretores/{corretor_id}", status_code=204)
def desativar_corretor(corretor_id: str, admin: dict = Depends(require_admin)):
    """"Excluir" aqui é desativar: mantém o histórico de clientes/propostas
    do corretor intacto e bloqueia o login dele (get_current_corretor
    checa `ativo` a cada request, então basta desligar essa flag)."""
    if corretor_id == admin["id"]:
        raise HTTPException(400, "Você não pode desativar o próprio login.")
    sb = get_supabase()
    existente = sb.table("corretores").select("id").eq("id", corretor_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Corretor não encontrado.")
    sb.table("corretores").update({"ativo": False}).eq("id", corretor_id).execute()


# ---------------------------------------------------------------------------
# Clientes / leads
# ---------------------------------------------------------------------------


def _pode_mexer_no_cliente(corretor: dict, cliente: dict) -> bool:
    return corretor["papel"] == "admin" or cliente.get("corretor_id") in (None, corretor["id"])


@router.get("/clientes", response_model=list[Cliente])
def listar_clientes(corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    query = sb.table("clientes").select("*").order("nome")
    if corretor["papel"] != "admin":
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    return query.execute().data


@router.post("/clientes", response_model=Cliente)
def criar_cliente(payload: ClienteCreate, corretor: dict = Depends(get_current_corretor)):
    data = payload.model_dump()
    if corretor["papel"] != "admin":
        data["corretor_id"] = corretor["id"]
    return get_supabase().table("clientes").insert(data).execute().data[0]


@router.patch("/clientes/{cliente_id}", response_model=Cliente)
def atualizar_cliente(cliente_id: str, payload: ClienteUpdate, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    existente = sb.table("clientes").select("*").eq("id", cliente_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Cliente não encontrado.")
    existente = existente[0]
    if not _pode_mexer_no_cliente(corretor, existente):
        raise HTTPException(403, "Este cliente é de outro corretor.")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if corretor["papel"] != "admin":
        updates.pop("corretor_id", None)  # corretor comum não reatribui cliente pra outro
    if not updates:
        return existente
    return sb.table("clientes").update(updates).eq("id", cliente_id).execute().data[0]


@router.delete("/clientes/{cliente_id}", status_code=204)
def excluir_cliente(cliente_id: str, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    existente = sb.table("clientes").select("*").eq("id", cliente_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Cliente não encontrado.")
    if not _pode_mexer_no_cliente(corretor, existente[0]):
        raise HTTPException(403, "Este cliente é de outro corretor.")
    sb.table("clientes").delete().eq("id", cliente_id).execute()


# ---------------------------------------------------------------------------
# Propostas de compra e venda
# ---------------------------------------------------------------------------


def _pode_mexer_na_proposta(corretor: dict, proposta: dict) -> bool:
    return corretor["papel"] == "admin" or proposta.get("corretor_id") in (None, corretor["id"])


@router.get("/propostas", response_model=list[PropostaDetalhe])
def listar_propostas(corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    query = sb.table("propostas").select("*, lote:lotes(*), cliente:clientes(*)").order(
        "created_at", desc=True
    )
    if corretor["papel"] != "admin":
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    return query.execute().data


@router.post("/propostas", response_model=Proposta)
def criar_proposta(payload: PropostaCreate, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    lote = sb.table("lotes").select("id").eq("id", payload.lote_id).limit(1).execute().data
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")
    cliente = sb.table("clientes").select("id").eq("id", payload.cliente_id).limit(1).execute().data
    if not cliente:
        raise HTTPException(404, "Cliente não encontrado.")
    # mode="json" pra dados_qualificacao (formulário completo, quando vem do
    # PropostaFormularioCompleto.tsx do painel) sair como dict puro, pronto
    # pro Supabase gravar na coluna jsonb.
    data = payload.model_dump(mode="json")
    if corretor["papel"] != "admin":
        data["corretor_id"] = corretor["id"]
    return sb.table("propostas").insert(data).execute().data[0]


@router.patch("/propostas/{proposta_id}", response_model=Proposta)
def atualizar_proposta(proposta_id: str, payload: PropostaUpdate, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    existente = sb.table("propostas").select("*").eq("id", proposta_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Proposta não encontrada.")
    existente = existente[0]
    if not _pode_mexer_na_proposta(corretor, existente):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        return existente
    return sb.table("propostas").update(updates).eq("id", proposta_id).execute().data[0]


@router.get("/propostas/{proposta_id}/documento")
def gerar_pdf_proposta(proposta_id: str, corretor: dict = Depends(get_current_corretor)):
    """Gera o PDF da proposta em papel timbrado (logo Castel), com os dados do
    lote, cliente, corretor e as condições comerciais — pra enviar ao cliente.

    Rota deliberadamente NÃO tem "pdf" na URL (era /propostas/{id}/pdf antes) —
    bloqueadores de anúncio/rastreadores (Brave Shields, uBlock, etc.) usam
    listas de filtro com regras genéricas tipo "*/pdf*" que casam com URL só
    pelo caminho, mesmo sendo uma API de negócio e não anúncio nenhum. Isso
    fazia o fetch() do navegador morrer com erro de rede puro (nem chegava a
    ter resposta), 100% reproduzível pra quem tivesse esse tipo de bloqueio
    ativado — indistinguível de "servidor fora do ar" do lado do frontend.
    """
    sb = get_supabase()
    # Antes eram até 4 idas e voltas ao Supabase em série (proposta, depois
    # condomínio, depois corretor, depois formulário) — cada uma soma latência
    # de rede, e é exatamente esse acúmulo que fazia "gerar PDF" parecer bem
    # mais lento que o resto do painel (que normalmente é 1 consulta só).
    # Como lote/cliente/corretor/formulário são todos ligados à proposta por
    # chave estrangeira direta (ver supabase/migrations/0002_crm.sql e
    # 0007_qualificacao_cliente.sql), o PostgREST consegue trazer tudo isso
    # embutido numa única consulta — mesmo truque já usado em
    # routers/qualificacao.py (corretores!corretor_id).
    proposta = (
        sb.table("propostas")
        .select(
            "*, lote:lotes(*, condominio:condominios(nome)), cliente:clientes(*), "
            "corretor_vinculado:corretores!corretor_id(nome, email, telefone), "
            "formulario:formularios_qualificacao!formulario_id(dados)"
        )
        .eq("id", proposta_id)
        .limit(1)
        .execute()
        .data
    )
    if not proposta:
        raise HTTPException(404, "Proposta não encontrada.")
    proposta = proposta[0]
    if not _pode_mexer_na_proposta(corretor, proposta):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    if proposta["status"] not in ("aprovada", "enviada", "aceita"):
        raise HTTPException(
            403,
            "Esta proposta ainda não foi aprovada por um administrador — o PDF só pode ser gerado depois da aprovação.",
        )
    lote = proposta.get("lote")
    cliente = proposta.get("cliente")
    if not lote or not cliente:
        raise HTTPException(409, "Proposta com lote ou cliente ausente — não é possível gerar o PDF.")

    condominio_nome = (lote.get("condominio") or {}).get("nome", "-")

    corretor_vinculado = proposta.get("corretor_vinculado")
    if corretor_vinculado:
        responsavel = corretor_vinculado
    elif corretor["papel"] != "admin":
        responsavel = corretor
    else:
        responsavel = None

    # Formulário completo pra preencher o PDF: preferência pro que veio
    # direto na criação da proposta (dados_qualificacao, preenchido pelo
    # corretor no painel — ver PropostaFormularioCompleto.tsx); só cai pro
    # formulário de qualificação vinculado (preenchido pelo cliente final
    # via link público) quando a proposta não carrega o próprio.
    dados_qualificacao = proposta.get("dados_qualificacao")
    if not dados_qualificacao:
        formulario = proposta.get("formulario")
        dados_qualificacao = formulario.get("dados") if formulario else None

    pdf_bytes = gerar_proposta_pdf(
        proposta=proposta,
        lote=lote,
        cliente=cliente,
        corretor=responsavel,
        condominio_nome=condominio_nome,
        gerado_por=corretor,
        dados_qualificacao=dados_qualificacao,
    )
    nome_arquivo = f"proposta-{lote.get('identificador', proposta_id)}.pdf".replace(" ", "-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nome_arquivo}"'},
    )


@router.patch("/propostas/{proposta_id}/status", response_model=Proposta)
def atualizar_status_proposta(
    proposta_id: str, payload: PropostaStatusUpdate, corretor: dict = Depends(get_current_corretor)
):
    sb = get_supabase()
    existente = sb.table("propostas").select("id, lote_id, cliente_id, corretor_id").eq("id", proposta_id).limit(
        1
    ).execute().data
    if not existente:
        raise HTTPException(404, "Proposta não encontrada.")
    existente = existente[0]
    if not _pode_mexer_na_proposta(corretor, existente):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    if payload.status == "aprovada" and corretor["papel"] != "admin":
        raise HTTPException(403, "Só um administrador pode aprovar a proposta.")
    atualizado = sb.table("propostas").update({"status": payload.status}).eq("id", proposta_id).execute().data[
        0
    ]
    if payload.status == "aceita":
        sb.table("lotes").update({"status": "vendido"}).eq("id", existente["lote_id"]).execute()
    elif payload.status == "aprovada":
        _gerar_reserva_da_proposta_aprovada(sb, proposta_id, existente)
    return atualizado


def _gerar_reserva_da_proposta_aprovada(sb, proposta_id: str, proposta: dict) -> None:
    """Aprovar a proposta já tranca o lote com esse cliente pra valer — em vez
    de o admin precisar abrir "Novo pedido" em Reservas e digitar tudo de
    novo, a reserva nasce sozinha aqui, reaproveitando nome/telefone/CPF do
    cliente que o corretor já cadastrou ao criar a proposta (ver
    PropostaFormularioCompleto.tsx). Confere antes se já não existe uma
    reserva com esse proposta_id: reprocessar a aprovação (ex.: um retry no
    front) não pode duplicar a reserva.
    """
    ja_existe = sb.table("reservas").select("id").eq("proposta_id", proposta_id).limit(1).execute().data
    if ja_existe:
        return

    cliente = (
        sb.table("clientes").select("nome, telefone, cpf").eq("id", proposta["cliente_id"]).limit(1).execute().data
    )
    cliente = cliente[0] if cliente else {}

    lote = sb.table("lotes").select("status").eq("id", proposta["lote_id"]).limit(1).execute().data
    lote_status = lote[0]["status"] if lote else None

    sb.table("reservas").insert(
        {
            "lote_id": proposta["lote_id"],
            "cliente_id": proposta["cliente_id"],
            "corretor_id": proposta.get("corretor_id"),
            "proposta_id": proposta_id,
            "nome": cliente.get("nome"),
            "contato": cliente.get("telefone"),
            "cpf": cliente.get("cpf"),
            "status": "pendente",
            "observacao": "Reserva gerada automaticamente pela aprovação da proposta.",
        }
    ).execute()
    # Só sobe o status se o lote ainda estava 'disponivel' — não sobrescreve
    # um lote que por algum motivo já esteja 'vendido' ou já 'reservado'.
    if lote_status == "disponivel":
        sb.table("lotes").update({"status": "reservado"}).eq("id", proposta["lote_id"]).execute()


# ---------------------------------------------------------------------------
# Visão geral (só admin): números consolidados por empreendimento + relatório
# em PDF com a tabela de lotes atualizada.
# ---------------------------------------------------------------------------

PROPOSTA_STATUS_ABERTA = ("rascunho", "aguardando_aprovacao", "aprovada", "enviada")


def _montar_visao_geral() -> tuple[list[dict], dict[str, list[dict]]]:
    sb = get_supabase()
    condominios = sb.table("condominios").select("id, nome, slug").order("nome").execute().data
    lotes = (
        sb.table("lotes")
        .select(
            "id, condominio_id, quadra, identificador, tamanho_m2, valor_total, entrada, entrega, "
            "parcela_mensal, qtd_parcelas, prazo_entrega_meses, status"
        )
        .execute()
        .data
    )
    propostas = sb.table("propostas").select("lote_id, status, valor_proposto").execute().data

    lote_condominio = {l["id"]: l["condominio_id"] for l in lotes}
    lotes_por_condominio: dict[str, list[dict]] = {c["id"]: [] for c in condominios}
    for l in lotes:
        lotes_por_condominio.setdefault(l["condominio_id"], []).append(l)

    resumo = []
    for c in condominios:
        do_condo = lotes_por_condominio.get(c["id"], [])
        propostas_do_condo = [
            p for p in propostas if lote_condominio.get(p["lote_id"]) == c["id"] and p["status"] in PROPOSTA_STATUS_ABERTA
        ]
        resumo.append(
            {
                "condominio_id": c["id"],
                "nome": c["nome"],
                "slug": c["slug"],
                "total_lotes": len(do_condo),
                "disponiveis": sum(1 for l in do_condo if l["status"] == "disponivel"),
                "reservados": sum(1 for l in do_condo if l["status"] == "reservado"),
                "vendidos": sum(1 for l in do_condo if l["status"] == "vendido"),
                "valor_total_vendido": sum(l.get("valor_total") or 0 for l in do_condo if l["status"] == "vendido"),
                "propostas_abertas": len(propostas_do_condo),
                "valor_em_propostas_abertas": sum(p["valor_proposto"] for p in propostas_do_condo),
            }
        )
    return resumo, lotes_por_condominio


@router.get("/visao-geral", response_model=list[VisaoGeralCondominio])
def visao_geral(_admin: dict = Depends(require_admin)):
    resumo, _ = _montar_visao_geral()
    return resumo


@router.get("/visao-geral/relatorio")
def visao_geral_pdf(
    condominio_id: str | None = None,
    status: str | None = None,
    busca: str | None = None,
    admin: dict = Depends(require_admin),
):
    """Exporta o relatório em PDF — de todos os empreendimentos, ou só de um
    (`?condominio_id=...`), conforme o seletor do painel.

    `status` e `busca` (opcionais) recortam só a TABELA de lotes de cada
    empreendimento — os mesmos filtros da tela de Disponibilidade, aplicados
    do mesmo jeito, pra o PDF sair batendo com o que está na tela quando ela
    os usa. Os cartões de totais no topo continuam mostrando o estoque
    inteiro do empreendimento (mesmo comportamento da legenda da tela, que
    também não muda com o filtro de status)."""
    resumo, lotes_por_condominio = _montar_visao_geral()
    sufixo_arquivo = "todos-os-empreendimentos"
    if condominio_id:
        item = next((r for r in resumo if r["condominio_id"] == condominio_id), None)
        if not item:
            raise HTTPException(404, "Empreendimento não encontrado.")
        resumo = [item]
        lotes_por_condominio = {condominio_id: lotes_por_condominio.get(condominio_id, [])}
        sufixo_arquivo = item["slug"]
    if status or busca:
        termo = (busca or "").strip().lower()

        def combina(lote: dict) -> bool:
            if status and lote.get("status") != status:
                return False
            if termo and termo not in f"{lote.get('identificador', '')} {lote.get('quadra', '')}".lower():
                return False
            return True

        lotes_por_condominio = {cid: [l for l in lotes if combina(l)] for cid, lotes in lotes_por_condominio.items()}
    pdf_bytes = gerar_visao_geral_pdf(resumo=resumo, lotes_por_condominio=lotes_por_condominio, gerado_por=admin)
    nome_arquivo = f"relatorio-disponibilidade-{sufixo_arquivo}-{datetime.now().strftime('%Y-%m-%d')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nome_arquivo}"'},
    )


# ---------------------------------------------------------------------------
# Lotes — listagem unificada (gestão rápida de status pelo painel).
# A mudança de status em si continua em PATCH /condominios/lotes/{id}/status.
# ---------------------------------------------------------------------------


@router.get("/lotes", response_model=list[LoteComCondominio])
def listar_todos_lotes(_corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    condos = {c["id"]: c for c in sb.table("condominios").select("id, nome, slug").execute().data}
    lotes = sb.table("lotes").select("*").order("condominio_id").order("lote_numero").execute().data

    # "Observação" com data/hora que a tela de Lotes mostra assim que um
    # corretor cria uma proposta (mesmo em rascunho) pra aquele lote — avisa
    # o admin que tem gente em negociação antes mesmo de virar reserva (ver
    # PainelLotes.tsx). Só propostas ainda abertas contam: aprovada já virou
    # reserva de verdade (ver _gerar_reserva_da_proposta_aprovada acima) e
    # recusada/cancelada encerram o assunto — em ambos os casos a observação
    # some sozinha. `.order("created_at")` + sobrescrever no dict garante
    # que, se por acaso existir mais de uma proposta aberta pro mesmo lote, é
    # a mais recente que aparece.
    propostas_abertas = (
        sb.table("propostas")
        .select("lote_id, status, created_at")
        .in_("status", ["rascunho", "aguardando_aprovacao"])
        .order("created_at")
        .execute()
        .data
    )
    proposta_por_lote = {p["lote_id"]: p for p in propostas_abertas}

    resultado = []
    for l in lotes:
        condo = condos.get(l["condominio_id"], {})
        proposta = proposta_por_lote.get(l["id"])
        resultado.append(
            {
                **l,
                "condominio_nome": condo.get("nome", "?"),
                "condominio_slug": condo.get("slug", ""),
                "proposta_pendente_status": proposta["status"] if proposta else None,
                "proposta_pendente_desde": proposta["created_at"] if proposta else None,
            }
        )
    return resultado
