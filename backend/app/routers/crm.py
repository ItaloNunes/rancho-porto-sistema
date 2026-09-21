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

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from postgrest.exceptions import APIError
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

from ..data.corretores_iniciais import RAW as CORRETORES_INICIAIS
from ..database import get_supabase
from ..documentos import BUCKET, caminho_no_bucket, excluir_do_storage_silenciosamente, validar_e_ler
from ..pdf import gerar_proposta_pdf, gerar_visao_geral_pdf, montar_relatorio_completo
from ..schemas import (
    AtividadeItem,
    Cliente,
    ClienteCreate,
    ClienteUpdate,
    Corretor,
    CorretorCreate,
    CorretorCriado,
    CorretorImportadoItem,
    CorretorUpdate,
    DocumentoProposta,
    DocumentoTipo,
    LoginRequest,
    LoginResponse,
    LogAuditoria,
    LoteComCondominio,
    Proposta,
    PropostaCreate,
    PropostaDetalhe,
    PropostaStatusUpdate,
    PropostaUpdate,
    TrocarSenhaRequest,
    VisaoGeralCondominio,
)
from ..security import criar_token, eh_admin, get_current_corretor, require_admin, require_developer
from ..auditoria import registrar_log
from .reservas import _pode_mexer_na_reserva
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
    registrar_log(sb, corretor[0], "login", "corretor", corretor[0]["id"], "Fez login no painel.")
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
def criar_corretor(payload: CorretorCreate, admin: dict = Depends(require_admin)):
    """Login por usuário (ver app/usuarios.py): a conta já nasce pronta pra
    usar, com senha = telefone (só dígitos). O admin repassa usuário+senha
    pro corretor por fora (WhatsApp, etc.); essa é a única resposta que traz
    a senha em texto puro."""
    if payload.papel == "developer":
        # 'developer' não é um papel que se escolhe num formulário — ver
        # comentário em schemas.py::Papel. Setado direto no banco, de
        # propósito, pra continuar sendo só de uma conta mesmo com alguém
        # chamando essa API na mão.
        raise HTTPException(400, "Este papel não pode ser atribuído por aqui.")
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
    try:
        inserido = sb.table("corretores").insert(row).execute().data[0]
    except APIError as e:
        # A checagem de "já usado" lá em cima lê a lista antes de gravar —
        # se dois admins cadastrarem corretor quase ao mesmo tempo com o
        # mesmo usuário (ou o mesmo nome, gerando o mesmo slug), os dois
        # podem passar na checagem antes de qualquer um gravar. Quem grava
        # por último esbarra na constraint unique(usuario) do banco — o
        # 23505 é o código padrão do Postgres pra isso; convertido aqui pra
        # um 409 com mensagem clara em vez do 500 genérico do handler global.
        if e.code == "23505":
            raise HTTPException(409, "Já existe um login com esse usuário — tente outro.")
        raise
    registrar_log(
        sb, admin, "criou_corretor", "corretor", inserido["id"],
        f"Criou o login de {inserido['nome']} (usuário: {inserido['usuario']}, papel: {inserido['papel']}).",
    )
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
def atualizar_corretor(corretor_id: str, payload: CorretorUpdate, admin: dict = Depends(require_admin)):
    if payload.papel == "developer":
        raise HTTPException(400, "Este papel não pode ser atribuído por aqui.")
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

    campos_logados = [c for c in updates if c not in ("senha_hash", "senha_customizada")]
    if campos_logados or nova_senha:
        detalhe_senha = " (+ senha redefinida)" if nova_senha else ""
        registrar_log(
            sb, admin, "editou_corretor", "corretor", corretor_id,
            f"Editou o cadastro de {existente['nome']} (campos: {', '.join(campos_logados) or 'senha'}){detalhe_senha}.",
            {"campos_alterados": campos_logados, "senha_redefinida": bool(nova_senha)},
        )

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
    existente = sb.table("corretores").select("id, nome").eq("id", corretor_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Corretor não encontrado.")
    sb.table("corretores").update({"ativo": False}).eq("id", corretor_id).execute()
    registrar_log(
        sb, admin, "desativou_corretor", "corretor", corretor_id,
        f"Desativou o login de {existente[0]['nome']}.",
    )


# ---------------------------------------------------------------------------
# Clientes / leads
# ---------------------------------------------------------------------------


def _pode_mexer_no_cliente(corretor: dict, cliente: dict) -> bool:
    return eh_admin(corretor) or cliente.get("corretor_id") in (None, corretor["id"])


@router.get("/clientes", response_model=list[Cliente])
def listar_clientes(corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    query = sb.table("clientes").select("*").order("nome")
    if not eh_admin(corretor):
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    return query.execute().data


@router.post("/clientes", response_model=Cliente)
def criar_cliente(payload: ClienteCreate, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    data = payload.model_dump()
    if not eh_admin(corretor):
        data["corretor_id"] = corretor["id"]
    criado = sb.table("clientes").insert(data).execute().data[0]
    registrar_log(sb, corretor, "criou_cliente", "cliente", criado["id"], f"Cadastrou o cliente {criado['nome']}.")
    return criado


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
    if not eh_admin(corretor):
        updates.pop("corretor_id", None)  # corretor comum não reatribui cliente pra outro
    if not updates:
        return existente
    atualizado = sb.table("clientes").update(updates).eq("id", cliente_id).execute().data[0]
    registrar_log(
        sb, corretor, "editou_cliente", "cliente", cliente_id,
        f"Editou o cadastro de {existente.get('nome')} (campos: {', '.join(updates.keys())}).",
        {"campos_alterados": list(updates.keys())},
    )
    return atualizado


@router.delete("/clientes/{cliente_id}", status_code=204)
def excluir_cliente(cliente_id: str, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    existente = sb.table("clientes").select("*").eq("id", cliente_id).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Cliente não encontrado.")
    if not _pode_mexer_no_cliente(corretor, existente[0]):
        raise HTTPException(403, "Este cliente é de outro corretor.")
    sb.table("clientes").delete().eq("id", cliente_id).execute()
    registrar_log(
        sb, corretor, "excluiu_cliente", "cliente", cliente_id,
        f"Excluiu o cliente {existente[0].get('nome')}.",
    )


# ---------------------------------------------------------------------------
# Propostas de compra e venda
# ---------------------------------------------------------------------------


def _pode_mexer_na_proposta(corretor: dict, proposta: dict) -> bool:
    return eh_admin(corretor) or proposta.get("corretor_id") in (None, corretor["id"])


def _query_propostas(sb, corretor: dict, com_documentos: bool):
    campos = "*, lote:lotes(*), cliente:clientes(*)"
    if com_documentos:
        campos += ", documentos:documentos_proposta(*)"
    query = sb.table("propostas").select(campos).order("created_at", desc=True)
    if not eh_admin(corretor):
        query = query.or_(f"corretor_id.is.null,corretor_id.eq.{corretor['id']}")
    return query


@router.get("/propostas", response_model=list[PropostaDetalhe])
def listar_propostas(corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    try:
        return _query_propostas(sb, corretor, com_documentos=True).execute().data
    except APIError as e:
        # documentos_proposta só existe depois que a migration 0015 rodar no
        # banco (ver supabase/migrations/0015_documentos_proposta.sql) — até
        # lá, o PostgREST rejeita esse embed com "relationship not found".
        # Em vez de derrubar a tela inteira de Propostas (como fazia antes
        # dessa proteção), cai pro comportamento de antes: lista sem a coluna
        # de documentos, que volta a aparecer sozinha assim que a migration
        # rodar — sem precisar de outro deploy.
        logger.warning("Consulta de propostas sem documentos_proposta (migration 0015 pendente?): %s", e)
        dados = _query_propostas(sb, corretor, com_documentos=False).execute().data
        for proposta in dados:
            proposta["documentos"] = []
        return dados


@router.post("/propostas", response_model=Proposta)
def criar_proposta(payload: PropostaCreate, corretor: dict = Depends(get_current_corretor)):
    """Assim que o corretor cria a proposta, o lote já sai do estoque na hora
    (vira 'reservado') — não espera um admin aprovar. A aprovação
    ('aprovada', ver atualizar_status_proposta/_gerar_reserva_da_proposta_aprovada)
    continua existindo pra liberar a geração do PDF formal e outras etapas
    administrativas, mas não é mais o que trava o lote — isso já acontece
    aqui, na criação.

    Dois caminhos:
    - **normal** (sem reserva_id): o lote precisa estar 'disponivel' — a
      trava é atômica (só marca 'reservado' se ainda estiver 'disponivel'
      nesse instante) e uma reserva nova é gerada sozinha pra essa proposta
      aparecer também na fila de Reservas (ver _gerar_reserva_da_proposta_aprovada).
    - **a partir de uma reserva já existente** (payload.reserva_id, botão
      "Gerar proposta" em PainelReservas.tsx): o lote já está 'reservado'
      por causa dessa reserva — não faz sentido exigir 'disponivel' nem
      travar de novo. Só quem pode mexer na reserva (o corretor que
      reservou, ou admin — mesma regra de sempre, ver
      reservas.py::_pode_mexer_na_reserva) pode gerar a proposta dela, e só
      uma vez (reserva já com proposta_id preenchido não gera outra)."""
    sb = get_supabase()

    reserva = None
    if payload.reserva_id:
        encontrada = sb.table("reservas").select("*").eq("id", payload.reserva_id).limit(1).execute().data
        if not encontrada:
            raise HTTPException(404, "Reserva não encontrada.")
        reserva = encontrada[0]
        if not _pode_mexer_na_reserva(corretor, reserva):
            raise HTTPException(403, "Esta reserva é de outro corretor — só quem reservou (ou um admin) pode gerar a proposta.")
        if reserva["status"] == "cancelada":
            raise HTTPException(
                409,
                "Esta reserva já foi cancelada (provavelmente expirou) — não dá pra gerar proposta a "
                "partir dela. Se o lote ainda estiver disponível, crie uma nova reserva pra esse cliente "
                "e gere a proposta a partir dela.",
            )
        if reserva.get("proposta_id"):
            raise HTTPException(409, "Esta reserva já tem uma proposta gerada.")

    lote_id = reserva["lote_id"] if reserva else payload.lote_id
    lote = sb.table("lotes").select("id, status").eq("id", lote_id).limit(1).execute().data
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")
    cliente = sb.table("clientes").select("id").eq("id", payload.cliente_id).limit(1).execute().data
    if not cliente:
        raise HTTPException(404, "Cliente não encontrado.")

    if reserva is None:
        if lote[0]["status"] != "disponivel":
            raise HTTPException(409, f"Este lote não está disponível (status atual: {lote[0]['status']}).")

        # Trava o lote de forma atômica — mesmo padrão de reservas.py::criar_reserva:
        # só marca 'reservado' se ele AINDA estiver 'disponivel' nesse exato
        # instante (0 linhas afetadas = outra proposta/reserva ganhou a corrida
        # entre a checagem acima e esta escrita).
        travou = (
            sb.table("lotes")
            .update({"status": "reservado"})
            .eq("id", lote_id)
            .eq("status", "disponivel")
            .execute()
            .data
        )
        if not travou:
            raise HTTPException(409, "Este lote acabou de ser reservado por outra proposta — atualize a página.")
    else:
        # O lote já está travado pela própria reserva — nada a fazer aqui,
        # só um sanity check: se por algum motivo ele já não estiver mais
        # 'reservado' (ex.: alguém marcou "vendido" na mão nesse meio
        # tempo), não deixa gerar uma proposta órfã por cima.
        if lote[0]["status"] != "reservado":
            raise HTTPException(
                409, f"O lote desta reserva não está mais 'reservado' (status atual: {lote[0]['status']}) — atualize a página."
            )

    # mode="json" pra dados_qualificacao (formulário completo, quando vem do
    # PropostaFormularioCompleto.tsx do painel) sair como dict puro, pronto
    # pro Supabase gravar na coluna jsonb.
    data = payload.model_dump(mode="json", exclude={"reserva_id"})
    data["lote_id"] = lote_id
    if reserva is not None:
        # Mantém o dono original da reserva na proposta gerada a partir
        # dela, mesmo que seja um admin clicando "Gerar proposta" em nome
        # de outra pessoa — sem isso a proposta nasceria sem corretor_id.
        data["corretor_id"] = reserva.get("corretor_id")
    elif not eh_admin(corretor):
        data["corretor_id"] = corretor["id"]

    try:
        proposta = sb.table("propostas").insert(data).execute().data[0]
    except Exception:
        # A proposta não chegou a ser criada — desfaz a trava pra não deixar
        # o lote preso em 'reservado' sem nenhuma proposta por trás. Só se
        # foi esta função que travou agora (reserva pré-existente já estava
        # 'reservado' antes, não é essa gravação que deve destravar ela).
        if reserva is None:
            sb.table("lotes").update({"status": "disponivel"}).eq("id", lote_id).execute()
        raise

    if reserva is not None:
        # Linka a proposta de volta na reserva de origem, em vez de gerar
        # uma segunda reserva duplicada — ver docstring acima.
        sb.table("reservas").update({"proposta_id": proposta["id"]}).eq("id", reserva["id"]).execute()
    else:
        try:
            # Mesmo registro de reserva que antes só nascia na aprovação — criado
            # aqui já na origem, pra a fila de Reservas do painel refletir a
            # proposta desde o início. Idempotente/defensivo (checa duplicata,
            # só mexe no lote se ainda precisar) — ver a função abaixo.
            _gerar_reserva_da_proposta_aprovada(sb, proposta["id"], proposta)
        except Exception:
            logger.warning(
                "Não foi possível criar o registro de reserva da proposta %s — o lote já está reservado, "
                "mas a fila de Reservas não vai mostrar esse pedido.",
                proposta["id"],
            )

    origem = f"a partir da reserva {reserva['id']}" if reserva is not None else "direto (sem reserva prévia)"
    registrar_log(
        sb, corretor, "criou_proposta", "proposta", proposta["id"],
        f"Gerou proposta pro lote {lote_id} ({origem}).",
        {"lote_id": lote_id, "reserva_id": reserva["id"] if reserva else None},
    )
    return proposta


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
    atualizado = sb.table("propostas").update(updates).eq("id", proposta_id).execute().data[0]
    registrar_log(
        sb, corretor, "editou_proposta", "proposta", proposta_id,
        f"Editou a proposta (campos: {', '.join(updates.keys())}).",
        {"campos_alterados": list(updates.keys())},
    )
    return atualizado


def _carregar_proposta_ou_404(sb, proposta_id: str) -> dict:
    proposta = sb.table("propostas").select("*").eq("id", proposta_id).limit(1).execute().data
    if not proposta:
        raise HTTPException(404, "Proposta não encontrada.")
    return proposta[0]


@router.get("/propostas/{proposta_id}/documentos", response_model=list[DocumentoProposta])
def listar_documentos_proposta(proposta_id: str, corretor: dict = Depends(get_current_corretor)):
    sb = get_supabase()
    proposta = _carregar_proposta_ou_404(sb, proposta_id)
    if not _pode_mexer_na_proposta(corretor, proposta):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    return (
        sb.table("documentos_proposta")
        .select("*")
        .eq("proposta_id", proposta_id)
        .order("enviado_em", desc=True)
        .execute()
        .data
    )


@router.post("/propostas/{proposta_id}/documentos", response_model=DocumentoProposta)
async def anexar_documento_proposta(
    proposta_id: str,
    tipo: DocumentoTipo,
    arquivo: UploadFile = File(...),
    corretor: dict = Depends(get_current_corretor),
):
    """Anexo de documento numa proposta já existente — ao contrário do
    formulário de qualificação (routers/qualificacao.py), aqui não há
    trava de status: a proposta pode ser editada e ganhar novos documentos
    a qualquer momento, é assim que o corretor completa depois o que faltou
    na hora de montar a proposta. `tipo: DocumentoTipo` faz o FastAPI
    rejeitar sozinho (422) um tipo fora da lista aceita, antes mesmo de
    chegar aqui."""
    sb = get_supabase()
    # _carregar_proposta_ou_404, o upload pro Storage e o insert abaixo são
    # todos chamadas SÍNCRONAS (bloqueantes) do cliente do Supabase. Numa
    # rota "async def" como essa (precisa ser async por causa do
    # `await validar_e_ler`, que lê o arquivo enviado de forma assíncrona),
    # chamar uma função bloqueante direto — sem `run_in_threadpool` — trava
    # a ÚNICA thread do event loop do uvicorn até ela terminar. Na prática
    # isso significa: enquanto um anexo está subindo, TODO o resto do
    # sistema (outros corretores, outras abas, até o /health) fica sem
    # resposta — foi o que causava aqueles erros "não foi possível
    # conectar"/CORS aleatórios em telas completamente diferentes. As rotas
    # "def" (não-async) do resto do arquivo não têm esse problema porque o
    # FastAPI já roda elas numa threadpool sozinho.
    proposta = await run_in_threadpool(_carregar_proposta_ou_404, sb, proposta_id)
    if not _pode_mexer_na_proposta(corretor, proposta):
        raise HTTPException(403, "Esta proposta é de outro corretor.")

    conteudo, content_type = await validar_e_ler(arquivo)

    storage_path = caminho_no_bucket(f"proposta/{proposta_id}", tipo, arquivo.filename)
    try:
        await run_in_threadpool(
            sb.storage.from_(BUCKET).upload, storage_path, conteudo, {"content-type": content_type}
        )
    except Exception:
        raise HTTPException(502, "Não foi possível enviar o arquivo agora. Tente novamente em instantes.")

    row = {
        "proposta_id": proposta_id,
        "tipo": tipo,
        "nome_arquivo": arquivo.filename or tipo,
        "storage_path": storage_path,
        "tamanho_bytes": len(conteudo),
        "enviado_por": corretor["id"],
        "enviado_em": datetime.now(timezone.utc).isoformat(),
    }
    try:
        inserido = await run_in_threadpool(lambda: sb.table("documentos_proposta").insert(row).execute().data[0])
    except Exception as e:
        # O arquivo já subiu pro Storage — sem isso, uma falha só na gravação
        # da linha (ex.: Supabase instável por um instante) deixaria um
        # arquivo órfão no bucket, sem nenhum registro apontando pra ele.
        await run_in_threadpool(excluir_do_storage_silenciosamente, sb, storage_path)
        if isinstance(e, APIError) and e.code == "42P01":
            # undefined_table: a migration 0015 (cria documentos_proposta)
            # ainda não rodou no banco. Isso é permanente, não uma
            # instabilidade passageira — devolver 502 aqui faria o
            # `fetchComRetry` do frontend insistir por até ~75s achando que
            # é algo temporário, travando a tela em "Enviando..." sem motivo.
            # Um 500 imediato evita o retry e mostra o erro real na hora.
            logger.error("documentos_proposta não existe — migration 0015 pendente: %s", e)
            raise HTTPException(
                500,
                "O sistema de documentos ainda não foi configurado no banco de dados "
                "(falta rodar uma migration pendente). Avise o administrador do sistema.",
            )
        raise HTTPException(502, "Não foi possível salvar o documento enviado. Tente novamente.")
    await run_in_threadpool(
        registrar_log, sb, corretor, "anexou_documento", "proposta", proposta_id,
        f"Anexou documento '{tipo}' ({arquivo.filename or 'sem nome'}) na proposta.",
        {"tipo": tipo, "documento_id": inserido["id"]},
    )
    return inserido


@router.get("/propostas/{proposta_id}/documentos/{documento_id}/arquivo")
def baixar_documento_proposta(proposta_id: str, documento_id: str, corretor: dict = Depends(get_current_corretor)):
    """Gera uma URL assinada (curta duração) pro documento — o painel nunca
    fala direto com o Storage, sempre passa por aqui, autenticado."""
    sb = get_supabase()
    proposta = _carregar_proposta_ou_404(sb, proposta_id)
    if not _pode_mexer_na_proposta(corretor, proposta):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    doc = (
        sb.table("documentos_proposta")
        .select("*")
        .eq("id", documento_id)
        .eq("proposta_id", proposta_id)
        .limit(1)
        .execute()
        .data
    )
    if not doc:
        raise HTTPException(404, "Documento não encontrado.")
    assinada = sb.storage.from_(BUCKET).create_signed_url(doc[0]["storage_path"], 300)
    url = assinada.get("signedURL") or assinada.get("signed_url")
    if not url:
        raise HTTPException(502, "Não foi possível gerar o link do documento.")
    return {"url": url}


@router.delete("/propostas/{proposta_id}/documentos/{documento_id}")
def excluir_documento_proposta(proposta_id: str, documento_id: str, corretor: dict = Depends(get_current_corretor)):
    """Deixa o corretor corrigir um anexo errado (documento ilegível, tipo
    trocado etc.) sem precisar recriar a proposta inteira."""
    sb = get_supabase()
    proposta = _carregar_proposta_ou_404(sb, proposta_id)
    if not _pode_mexer_na_proposta(corretor, proposta):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    doc = (
        sb.table("documentos_proposta")
        .select("*")
        .eq("id", documento_id)
        .eq("proposta_id", proposta_id)
        .limit(1)
        .execute()
        .data
    )
    if not doc:
        raise HTTPException(404, "Documento não encontrado.")
    sb.table("documentos_proposta").delete().eq("id", documento_id).execute()
    excluir_do_storage_silenciosamente(sb, doc[0]["storage_path"])
    registrar_log(
        sb, corretor, "removeu_documento", "proposta", proposta_id,
        f"Removeu documento '{doc[0].get('tipo')}' ({doc[0].get('nome_arquivo')}) da proposta.",
        {"documento_id": documento_id},
    )
    return {"ok": True}


def _montar_pdf_proposta(sb, proposta_id: str, corretor: dict) -> tuple[bytes, str]:
    """Busca a proposta e gera os bytes do PDF em papel timbrado — usado tanto
    pelo "gerar PDF" de só a proposta quanto pelo relatório completo (proposta
    + documentos anexados) abaixo, pra não duplicar essa lógica em dois
    lugares. Retorna (pdf_bytes, identificador_do_lote) — o identificador serve
    só pra montar o nome do arquivo baixado."""
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
    elif not eh_admin(corretor):
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
    return pdf_bytes, lote.get("identificador", proposta_id)


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
    pdf_bytes, identificador_lote = _montar_pdf_proposta(sb, proposta_id, corretor)
    nome_arquivo = f"proposta-{identificador_lote}.pdf".replace(" ", "-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nome_arquivo}"'},
    )


@router.get("/propostas/{proposta_id}/documento-completo")
def gerar_relatorio_completo(proposta_id: str, corretor: dict = Depends(get_current_corretor)):
    """Gera UM ÚNICO PDF: a proposta (mesmo documento de `gerar_pdf_proposta`
    acima) seguida de todos os documentos anexados (RG, CPF, comprovantes...),
    nessa ordem — pra ter tudo junto pra enviar/arquivar de uma vez, em vez de
    baixar a proposta e cada anexo separado. Documento que já é PDF entra com
    todas as páginas; imagem (JPG/PNG/WEBP/HEIC) vira uma página só com a
    foto. Mesma trava de status do "gerar PDF" (só depois de aprovada) — sem
    isso o relatório completo destravaria o PDF antes da hora."""
    sb = get_supabase()
    pdf_proposta, identificador_lote = _montar_pdf_proposta(sb, proposta_id, corretor)

    documentos = (
        sb.table("documentos_proposta")
        .select("storage_path, nome_arquivo")
        .eq("proposta_id", proposta_id)
        .order("enviado_em")
        .execute()
        .data
    )
    anexos: list[bytes] = []
    for doc in documentos:
        try:
            anexos.append(sb.storage.from_(BUCKET).download(doc["storage_path"]))
        except Exception:
            # Um anexo sumido/corrompido no Storage não pode derrubar o
            # relatório inteiro — melhor entregar com o que existe do que
            # falhar tudo por causa de 1 arquivo problemático.
            logger.warning(
                "Documento %s da proposta %s não pôde ser baixado do Storage — pulando no relatório completo.",
                doc.get("nome_arquivo"),
                proposta_id,
            )

    pdf_bytes = montar_relatorio_completo(pdf_proposta, anexos)
    nome_arquivo = f"proposta-completa-{identificador_lote}.pdf".replace(" ", "-")
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
    if payload.status == "aprovada" and not eh_admin(corretor):
        raise HTTPException(403, "Só um administrador pode aprovar a proposta.")
    atualizado = sb.table("propostas").update({"status": payload.status}).eq("id", proposta_id).execute().data[
        0
    ]
    if payload.status == "aceita":
        # Nada no fluxo hoje obriga passar por 'aprovada' antes de 'aceita'
        # (um corretor pode pular direto pra cá) — então duas propostas
        # diferentes pro mesmo lote podem chegar em 'aceita' sem que a etapa
        # de aprovação tenha travado o lote antes. O UPDATE condicional
        # abaixo garante, na escrita, que não existe venda dupla: só marca
        # 'vendido' se o lote AINDA não estiver 'vendido' nesse instante: 0
        # linhas afetadas quer dizer que outra proposta já venceu essa
        # corrida, e essa é rejeitada com um erro claro em vez de sobrescrever
        # silenciosamente quem já comprou.
        vendeu = (
            sb.table("lotes")
            .update({"status": "vendido"})
            .eq("id", existente["lote_id"])
            .neq("status", "vendido")
            .execute()
            .data
        )
        if not vendeu:
            raise HTTPException(
                409, "Este lote já consta como vendido (por outra proposta) — confira antes de aceitar esta."
            )
    elif payload.status == "aprovada":
        _gerar_reserva_da_proposta_aprovada(sb, proposta_id, existente)
    elif payload.status in ("recusada", "cancelada"):
        _liberar_lote_da_proposta(sb, proposta_id, existente["lote_id"])
    registrar_log(
        sb, corretor, "mudou_status_proposta", "proposta", proposta_id,
        f"Mudou status da proposta pra '{payload.status}'.",
        {"status_novo": payload.status},
    )
    return atualizado


def _liberar_lote_da_proposta(sb, proposta_id: str, lote_id: str) -> None:
    """Recusar ou cancelar uma proposta libera o lote de volta pra
    'disponivel'. Necessário desde que criar_proposta passou a reservar o
    lote já na criação (sem esperar aprovação de admin): sem isso, toda
    proposta recusada deixaria o lote travado em 'reservado' pra sempre, sem
    ninguém mais poder propor por ele. Só mexe no lote se ele AINDA estiver
    'reservado' nesse instante — nunca destrava um lote que já virou
    'vendido' por outra via (ex.: outra proposta pro mesmo lote que já foi
    aceita antes desta ser recusada)."""
    sb.table("lotes").update({"status": "disponivel"}).eq("id", lote_id).eq("status", "reservado").execute()
    # Mantém a fila de Reservas em sincronia: se essa proposta já tinha
    # gerado uma reserva (ver _gerar_reserva_da_proposta_aprovada), cancela
    # ela também — sem isso ficaria um registro "pendente" órfão apontando
    # pra um lote que já voltou a ficar disponível.
    sb.table("reservas").update({"status": "cancelada"}).eq("proposta_id", proposta_id).neq(
        "status", "cancelada"
    ).execute()


def _gerar_reserva_da_proposta_aprovada(sb, proposta_id: str, proposta: dict) -> None:
    """Gera o registro de reserva atrelado a uma proposta, reaproveitando
    nome/telefone/CPF do cliente que o corretor já cadastrou ao criar a
    proposta (ver PropostaFormularioCompleto.tsx), em vez de alguém precisar
    abrir "Novo pedido" em Reservas e digitar tudo de novo.

    Chamada em dois pontos: (1) direto em criar_proposta — hoje o caminho
    normal, já que a proposta reserva o lote assim que é criada, sem esperar
    aprovação de admin; e (2) aqui em atualizar_status_proposta, quando a
    proposta é aprovada — mantida como rede de segurança pra proposta antiga
    (criada antes dessa mudança) que ainda não tinha reserva. Confere antes
    se já não existe uma reserva com esse proposta_id, então é seguro chamar
    dos dois lugares sem duplicar nada.
    """
    ja_existe = sb.table("reservas").select("id").eq("proposta_id", proposta_id).limit(1).execute().data
    if ja_existe:
        return

    cliente = (
        sb.table("clientes").select("nome, telefone, cpf").eq("id", proposta["cliente_id"]).limit(1).execute().data
    )
    cliente = cliente[0] if cliente else {}

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
            "observacao": "Reserva gerada automaticamente pela criação/aprovação da proposta.",
        }
    ).execute()
    # Atualização condicional (atômica no Postgres): só sobe pra 'reservado'
    # se o lote AINDA estiver 'disponivel' neste instante — não confia num
    # status lido antes da escrita (podia ter mudado entre a leitura e aqui,
    # ex.: duas propostas pro mesmo lote aprovadas quase juntas). Se não
    # estiver mais disponível, não faz nada — mesma regra de sempre: nunca
    # destrava um lote já 'vendido' ou já travado por outra reserva.
    sb.table("lotes").update({"status": "reservado"}).eq("id", proposta["lote_id"]).eq(
        "status", "disponivel"
    ).execute()


# ---------------------------------------------------------------------------
# Atividade (só a conta 'developer', ver security.py::require_developer) —
# feed de "quem fez o quê e quando" pra acompanhar o painel de fora, sem
# depender de ninguém avisar. Hoje só cobre criação (reserva, proposta,
# cliente) porque nenhuma tabela guarda histórico de mudança de status —
# uma reserva confirmada ou um lote marcado na mão (ver
# condominios.py::atualizar_status_lote) não deixa rastro de "quando" além
# do updated_at, que sobrescreve a cada mudança. Dá pra evoluir isso com uma
# tabela de auditoria de verdade se precisar rastrear mudança de status
# também, não só criação.
# ---------------------------------------------------------------------------


@router.get("/atividade", response_model=list[AtividadeItem])
def listar_atividade(_dev: dict = Depends(require_developer)):
    sb = get_supabase()
    corretor_nome_por_id = {c["id"]: c["nome"] for c in sb.table("corretores").select("id, nome").execute().data}

    itens: list[dict] = []

    reservas = (
        sb.table("reservas")
        .select("nome, corretor_id, status, created_at, lote:lotes(identificador)")
        .order("created_at", desc=True)
        .limit(80)
        .execute()
        .data
    )
    for r in reservas:
        itens.append(
            {
                "tipo": "reserva",
                "lote_identificador": (r.get("lote") or {}).get("identificador"),
                "nome_pessoa": r.get("nome"),
                "status": r.get("status"),
                "corretor_nome": corretor_nome_por_id.get(r.get("corretor_id")),
                "created_at": r["created_at"],
            }
        )

    propostas = (
        sb.table("propostas")
        .select("valor_proposto, corretor_id, status, created_at, lote:lotes(identificador), cliente:clientes(nome)")
        .order("created_at", desc=True)
        .limit(80)
        .execute()
        .data
    )
    for p in propostas:
        itens.append(
            {
                "tipo": "proposta",
                "lote_identificador": (p.get("lote") or {}).get("identificador"),
                "nome_pessoa": (p.get("cliente") or {}).get("nome"),
                "valor_proposto": p.get("valor_proposto"),
                "status": p.get("status"),
                "corretor_nome": corretor_nome_por_id.get(p.get("corretor_id")),
                "created_at": p["created_at"],
            }
        )

    clientes = (
        sb.table("clientes")
        .select("nome, corretor_id, created_at")
        .order("created_at", desc=True)
        .limit(80)
        .execute()
        .data
    )
    for c in clientes:
        itens.append(
            {
                "tipo": "cliente",
                "nome_pessoa": c.get("nome"),
                "corretor_nome": corretor_nome_por_id.get(c.get("corretor_id")),
                "created_at": c["created_at"],
            }
        )

    itens.sort(key=lambda i: i["created_at"], reverse=True)
    return itens[:150]


@router.get("/logs", response_model=list[LogAuditoria])
def listar_logs(
    _dev: dict = Depends(require_developer),
    entidade: Optional[str] = Query(None, description="Filtra por tipo: reserva, proposta, cliente, lote, corretor, qualificacao"),
    ator_id: Optional[str] = Query(None, description="Filtra pelas ações de um corretor/admin específico"),
    acao: Optional[str] = Query(None, description="Filtra por ação exata (ex.: cancelou_reserva)"),
    limite: int = Query(200, ge=1, le=500),
    antes_de: Optional[datetime] = Query(None, description="Pagina pro passado: só logs criados antes desse instante"),
):
    """Log de auditoria completo — toda ação relevante do painel (criar,
    editar, excluir, mudar status, login, anexar/remover documento etc.),
    com quem fez, quando e em qual registro (ver app/auditoria.py). Só
    developer, mesmo padrão de /crm/atividade — é a trilha de quem fez o
    quê, então fica restrita ao mesmo login exclusivo.

    Paginação simples por cursor de tempo (antes_de) em vez de offset —
    mais barato no Postgres e não perde/repete linha se um log novo chegar
    entre uma página e outra."""
    sb = get_supabase()
    query = sb.table("logs_auditoria").select("*").order("created_at", desc=True).limit(limite)
    if entidade:
        query = query.eq("entidade", entidade)
    if ator_id:
        query = query.eq("ator_id", ator_id)
    if acao:
        query = query.eq("acao", acao)
    if antes_de:
        query = query.lt("created_at", antes_de.isoformat())
    return query.execute().data


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
            "id, condominio_id, quadra, lote_numero, identificador, tamanho_m2, valor_total, entrada, entrega, "
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
    quadra: str | None = None,
    admin: dict = Depends(require_admin),
):
    """Exporta o relatório em PDF — de todos os empreendimentos, ou só de um
    (`?condominio_id=...`), conforme o seletor do painel.

    `status`, `busca` e `quadra` (opcionais) recortam só a TABELA de lotes de
    cada empreendimento — os mesmos filtros da tela de Disponibilidade,
    aplicados do mesmo jeito, pra o PDF sair batendo com o que está na tela
    quando ela os usa. `quadra` é comparação exata (vem de um seletor, não de
    texto livre) — diferente de `busca`, que casa por substring em
    identificador OU quadra. Os cartões de totais no topo continuam
    mostrando o estoque inteiro do empreendimento (mesmo comportamento da
    legenda da tela, que também não muda com esses filtros)."""
    resumo, lotes_por_condominio = _montar_visao_geral()
    sufixo_arquivo = "todos-os-empreendimentos"
    if condominio_id:
        item = next((r for r in resumo if r["condominio_id"] == condominio_id), None)
        if not item:
            raise HTTPException(404, "Empreendimento não encontrado.")
        resumo = [item]
        lotes_por_condominio = {condominio_id: lotes_por_condominio.get(condominio_id, [])}
        sufixo_arquivo = item["slug"]
    if status or busca or quadra:
        termo = (busca or "").strip().lower()

        def combina(lote: dict) -> bool:
            if status and lote.get("status") != status:
                return False
            if quadra and lote.get("quadra") != quadra:
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
