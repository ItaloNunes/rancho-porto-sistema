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

import hashlib
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
from ..documentos_gerados import (
    identificacao_contrato,
    preencher_contrato_porto_franco,
    preencher_contrato_rancho_texas,
    preencher_recibo,
)
from ..docx_pdf import docx_para_pdf
from ..pdf import gerar_proposta_pdf, gerar_visao_geral_pdf, montar_relatorio_completo
from ..cadastro_proposta import problemas_cadastro, so_digitos, telefone_valido, email_valido
from ..plano_pagamento import conferir_contrato, ler_plano, problemas_para_aprovar, valores_contrato
from ..plano_pagamento import normalizar as normalizar_plano
from ..plano_pagamento import resumo as resumo_plano
from ..plano_pagamento import validar as validar_plano
from ..schemas import (
    AtividadeItem,
    Cliente,
    ClienteCreate,
    ClienteUpdate,
    Corretor,
    CorretorAutoUpdate,
    CorretorCreate,
    CorretorCriado,
    CorretorImportadoItem,
    CorretorUpdate,
    DOCUMENTOS_CONJUGE,
    DOCUMENTOS_OBRIGATORIOS,
    DocumentoProposta,
    DocumentoTipo,
    LoginRequest,
    LoginResponse,
    LogAuditoria,
    LoteComCondominio,
    Proposta,
    PropostaCreate,
    PropostaDadosFinanceiro,
    PropostaDetalhe,
    PropostaStatusUpdate,
    PropostaUpdate,
    TrocarSenhaRequest,
    VisaoGeralCondominio,
)
from ..security import criar_token, eh_admin, get_current_corretor, require_admin, require_developer
from ..auditoria import registrar_log
from ..precos import congelar_preco_lote
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
    corretor), pra decidir o que mostrar no painel -- inclusive
    `perfil_completo` (computed_field em schemas.Corretor), que decide se a
    tela obrigatória de "complete seu cadastro" aparece."""
    return corretor


@router.patch("/me", response_model=Corretor)
def atualizar_meu_perfil(payload: CorretorAutoUpdate, corretor: dict = Depends(get_current_corretor)):
    """O próprio corretor logado completa nome/CPF-CNPJ/CRECI/dados
    bancários -- é o PATCH que fecha a tela obrigatória de "complete seu
    cadastro" (ver PainelLayout.tsx/GateCompletarCadastro e
    schemas.Corretor.perfil_completo). Diferente de atualizar_corretor
    (admin): não mexe em papel/ativo/senha, e por isso não usa
    require_admin -- qualquer login válido pode chamar isso pros PRÓPRIOS
    dados (o id vem do token, nunca do body). Pedido em 28/09."""
    sb = get_supabase()
    updates = payload.model_dump()
    atualizado = sb.table("corretores").update(updates).eq("id", corretor["id"]).execute().data[0]
    registrar_log(
        sb, corretor, "completou_cadastro", "corretor", corretor["id"],
        "Completou o próprio cadastro (nome/CPF-CNPJ/CRECI/dados bancários).",
    )
    return atualizado


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
        "cpf_cnpj": payload.cpf_cnpj,
        "creci": payload.creci,
        "banco": payload.banco,
        "agencia": payload.agencia,
        "conta": payload.conta,
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


def _numero_proposta(proposta: dict) -> str:
    """"Nº 0001-v2" — mesmo formato usado no painel e no PDF (ver
    frontend/src/lib/api.ts::formatarNumeroProposta e pdf.py). Usado só pra
    deixar as descrições do log de auditoria fáceis de reconhecer sem abrir
    a proposta."""
    numero = proposta.get("numero")
    if numero is None:
        return "?"
    return f"{numero:04d}-v{proposta.get('versao') or 1}"


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
    lote = sb.table("lotes").select("id, status, valor_total").eq("id", lote_id).limit(1).execute().data
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")

    # Plano de pagamento (formulário de 02/10): só cria a proposta se a conta
    # fechar -- entrada obrigatória, datas válidas, entrada + parcelas + chave
    # = valor proposto e confirmação do corretor. Mesma regra que o
    # navegador já aplicou (frontend/src/lib/pagamento.ts); repetida aqui pra
    # nada inconsistente chegar no banco/contrato nem por chamada direta à API.
    fp_validado = None
    if payload.dados_qualificacao is None:
        raise HTTPException(422, "A forma de pagamento é obrigatória: preencha a proposta pelo formulário completo.")
    else:
        fp_bruto = payload.dados_qualificacao.forma_pagamento.model_dump(mode="json")
        problemas = validar_plano(fp_bruto, payload.valor_proposto, lote[0].get("valor_total"))
        if problemas:
            raise HTTPException(422, " ".join(problemas))
        fp_validado = normalizar_plano(fp_bruto)
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
    if fp_validado is not None:
        data["dados_qualificacao"]["forma_pagamento"] = fp_validado
        # resumo sempre derivado do plano -- nunca um texto solto que pode
        # contradizer os valores (caso real: "100x de R$ 719,92" no resumo e
        # "5x de R$ 1.798,00" nos campos da mesma proposta)
        data["condicoes_pagamento"] = resumo_plano(fp_validado)
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
        f"Gerou a proposta {_numero_proposta(proposta)} pro lote {lote_id} ({origem}).",
        {"lote_id": lote_id, "reserva_id": reserva["id"] if reserva else None, "numero": proposta.get("numero")},
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
    fp_existente = (existente.get("dados_qualificacao") or {}).get("forma_pagamento") or {}
    if ler_plano(fp_existente).estruturado and ({"valor_proposto", "condicoes_pagamento"} & set(updates)):
        raise HTTPException(
            409,
            "Valor e condições desta proposta fazem parte do plano de pagamento conferido no formulário -- "
            "pra mudar, cancele e gere uma nova proposta (assim o plano inteiro é conferido de novo).",
        )
    # Qualquer edição de verdade sobe a versão — é o "carimbo" que deixa
    # claro, só de olhar o número (ex.: "0007-v2"), que aquele PDF/print em
    # mãos de alguém pode não ser mais a versão vigente da proposta. Pedido
    # explícito: rastreabilidade de qual versão é a atual.
    versao_anterior = existente.get("versao") or 1
    updates["versao"] = versao_anterior + 1
    atualizado = sb.table("propostas").update(updates).eq("id", proposta_id).execute().data[0]
    campos_alterados = [k for k in updates if k != "versao"]
    registrar_log(
        sb, corretor, "editou_proposta", "proposta", proposta_id,
        f"Editou a proposta {_numero_proposta(existente)} (campos: {', '.join(campos_alterados)}) "
        f"— agora {_numero_proposta(atualizado)}.",
        {"campos_alterados": campos_alterados, "versao_anterior": versao_anterior, "versao_nova": updates["versao"]},
    )
    return atualizado


# Proposta recusada/cancelada não volta a valer -- não faz sentido corrigir.
STATUS_EDITAVEIS_FINANCEIRO = ("rascunho", "aguardando_aprovacao", "aprovada", "enviada", "aceita")


def _achatar(d, prefixo: str = "") -> dict:
    """{"proponente": {"nome": "X"}} -> {"proponente.nome": "X"} (pro
    antes/depois do log de auditoria)."""
    out: dict = {}
    if isinstance(d, dict):
        for k, v in d.items():
            out.update(_achatar(v, f"{prefixo}{k}."))
    else:
        out[prefixo.rstrip(".")] = d
    return out


def _vazio(v) -> bool:
    return v is None or v == "" or v == {} or v is False


def _plano_antigo_mantido(fp_novo: dict, fp_antigo: dict, vp_novo, vp_antigo, lote: dict) -> bool:
    """True quando a proposta é do formulário antigo e a correção não mexeu
    em nada que vá pro contrato: o plano continua não-estruturado e os
    números impressos (entrada, parcelas, 1ª parcela, chave) e o preço são
    os mesmos de antes."""
    if ler_plano(fp_antigo).estruturado or ler_plano(fp_novo).estruturado:
        return False
    if vp_novo is None or vp_antigo is None or abs(float(vp_novo) - float(vp_antigo)) > 0.005:
        return False
    if bool(fp_novo.get("a_vista")) != bool(fp_antigo.get("a_vista")):
        return False
    a, b = valores_contrato(fp_novo, lote), valores_contrato(fp_antigo, lote)
    # o texto da 1ª parcela pode vir só reformatado (10/10/2026 -> 2026-10-10)
    campos = ("a_vista", "entrada", "parcelas", "parcela_valor", "chave", "primeira_parcela")
    return all(getattr(a, c) == getattr(b, c) for c in campos)


@router.put("/propostas/{proposta_id}/dados", response_model=Proposta)
def editar_dados_proposta(
    proposta_id: str, payload: PropostaDadosFinanceiro, corretor: dict = Depends(get_current_corretor)
):
    """O financeiro (admin/developer) corrige os dados da proposta direto na
    tela do Financeiro -- comprador, cônjuge, endereços, contatos e a forma
    de pagamento inteira (valor, entrada, parcelas, chave). Pedido de 03/10:
    resolve propostas que chegaram com dado errado (ex.: 0003, R$ 89,99 e
    parcelas que não fechavam) sem precisar cancelar e refazer.

    Passa pelas MESMAS conferências da criação: plano de pagamento fechando
    no centavo, entrada obrigatória, datas válidas, confirmação dupla (agora
    de quem corrigiu) e CPF/telefone/e-mail válidos. Sobe a versão da
    proposta (0003 -> 0003-v2), atualiza o cadastro do cliente (nome/CPF/
    contato, que o recibo usa) e grava no log o antes/depois de cada campo.
    O lote não muda por aqui (trocar de lote mexe no estoque -- isso é
    cancelar e fazer outra proposta)."""
    if not eh_admin(corretor):
        raise HTTPException(403, "Só o financeiro (administrador) pode editar os dados da proposta.")
    sb = get_supabase()
    existente = _carregar_proposta_ou_404(sb, proposta_id)
    if existente["status"] not in STATUS_EDITAVEIS_FINANCEIRO:
        raise HTTPException(409, "Proposta recusada ou cancelada não pode ser editada.")
    lote = (
        sb.table("lotes")
        .select("id, valor_total, entrada, qtd_parcelas, parcela_mensal, entrega")
        .eq("id", existente["lote_id"])
        .limit(1)
        .execute()
        .data
    )
    if not lote:
        raise HTTPException(409, "O lote desta proposta não foi encontrado.")
    lote = lote[0]

    dados = payload.dados_qualificacao.model_dump(mode="json")
    fp = dados.get("forma_pagamento") or {}
    valor_proposto = fp.get("valor_proposto")
    fp_antigo = (existente.get("dados_qualificacao") or {}).get("forma_pagamento") or {}
    if _plano_antigo_mantido(fp, fp_antigo, valor_proposto, existente.get("valor_proposto"), lote):
        # Proposta do formulário antigo em que só os dados cadastrais mudaram
        # (ex.: celular de 0001/0002): o plano fica exatamente como estava e
        # é conferido pelas regras dele (os números do contrato fecham) --
        # não obriga a refazer a forma de pagamento só pra corrigir um telefone.
        valor_proposto = existente.get("valor_proposto")
        problemas = problemas_para_aprovar(fp_antigo, valor_proposto, lote) + problemas_cadastro(dados)
        if problemas:
            raise HTTPException(422, "\n".join(problemas))
        if not fp.get("confirmado"):
            raise HTTPException(422, "Falta a confirmação final: marque que conferiu os dados corrigidos.")
        fp = dict(fp_antigo)
    else:
        problemas = validar_plano(fp, valor_proposto, lote.get("valor_total")) + problemas_cadastro(dados)
        if problemas:
            raise HTTPException(422, "\n".join(problemas))
        fp = normalizar_plano(fp)
    dados["forma_pagamento"] = fp
    # cinto e suspensório: exatamente os números que o contrato vai imprimir
    problemas = conferir_contrato(fp, valor_proposto, lote)
    if problemas:
        raise HTTPException(422, "\n".join(problemas))

    antes = _achatar(existente.get("dados_qualificacao") or {})
    depois = _achatar(dados)
    alterados = sorted(
        k for k in set(antes) | set(depois)
        if not (_vazio(antes.get(k)) and _vazio(depois.get(k))) and antes.get(k) != depois.get(k)
        # confirmações mudam sempre (quem corrigiu confirma de novo) -- não é "dado alterado"
        and not k.startswith(("forma_pagamento.confirmado", "forma_pagamento.confirma_valor_fora_tabela"))
    )
    valor_antes = existente.get("valor_proposto")
    if valor_antes != valor_proposto and "forma_pagamento.valor_proposto" not in alterados:
        alterados.append("forma_pagamento.valor_proposto")

    versao_anterior = existente.get("versao") or 1
    numero_antes = _numero_proposta(existente)
    updates = {
        "dados_qualificacao": dados,
        "valor_proposto": valor_proposto,
        "condicoes_pagamento": resumo_plano(fp),
        "observacoes": (fp.get("observacoes") or "").strip() or None,
        "versao": versao_anterior + 1,
    }
    atualizado = sb.table("propostas").update(updates).eq("id", proposta_id).execute().data[0]

    # Cadastro do cliente acompanha (o recibo usa nome/CPF de lá).
    proponente = dados.get("proponente") or {}
    cliente_upd = {}
    if (proponente.get("nome") or "").strip():
        cliente_upd["nome"] = proponente["nome"].strip()
    if so_digitos(proponente.get("cpf_cnpj")):
        cliente_upd["cpf"] = so_digitos(proponente.get("cpf_cnpj"))
    if telefone_valido(dados.get("telefone_celular")):
        cliente_upd["telefone"] = dados["telefone_celular"].strip()
    if email_valido(proponente.get("email")):
        cliente_upd["email"] = proponente["email"].strip()
    if cliente_upd and existente.get("cliente_id"):
        sb.table("clientes").update(cliente_upd).eq("id", existente["cliente_id"]).execute()

    registrar_log(
        sb, corretor, "editou_proposta", "proposta", proposta_id,
        f"Financeiro corrigiu os dados da proposta {numero_antes} "
        f"({len(alterados)} campo(s)) -- agora {_numero_proposta(atualizado)}."
        + (f" Motivo: {payload.motivo.strip()}" if payload.motivo and payload.motivo.strip() else ""),
        {
            "versao_anterior": versao_anterior,
            "versao_nova": updates["versao"],
            "motivo": payload.motivo,
            "alteracoes": {k: {"antes": antes.get(k), "depois": depois.get(k)} for k in alterados},
            "valor_proposto": {"antes": valor_antes, "depois": valor_proposto},
        },
    )
    return atualizado


def _carregar_proposta_ou_404(sb, proposta_id: str) -> dict:
    proposta = sb.table("propostas").select("*").eq("id", proposta_id).limit(1).execute().data
    if not proposta:
        raise HTTPException(404, "Proposta não encontrada.")
    return proposta[0]


def _documentos_obrigatorios_da_proposta(dados_qualificacao: Optional[dict]) -> tuple[DocumentoTipo, ...]:
    """Mesma lista (e mesma regra do cônjuge) usada pra qualificação pública
    — ver _valida_documentos_obrigatorios em routers/qualificacao.py. Uma
    proposta só sabe o estado civil quando nasceu do formulário completo ou
    de uma qualificação aprovada (dados_qualificacao preenchido); sem isso,
    assume solteiro, igual ao checklist do frontend (PropostaDocumentos.tsx)."""
    dados = dados_qualificacao or {}
    obrigatorios = list(DOCUMENTOS_OBRIGATORIOS)
    if dados.get("estado_civil") == "casado":
        obrigatorios += list(DOCUMENTOS_CONJUGE)
    return tuple(obrigatorios)


def _atualizar_documentos_completos_em(sb, proposta_id: str, dados_qualificacao: Optional[dict]) -> None:
    """Chamada depois de anexar ou remover um documento de proposta: se todos
    os obrigatórios já estão presentes, grava o instante em que isso passou a
    ser verdade — só na primeira vez (não empurra o prazo de 72h toda vez que
    alguém reenvia ou troca um anexo). Se um documento obrigatório for
    removido depois e a proposta deixar de estar completa, desfaz a marca —
    não faz sentido o corretor ver "em análise" com um documento faltando de
    novo. O painel usa esse campo + 72h pra mostrar o prazo da análise
    financeira desta etapa (ver PropostaDocumentos.tsx)."""
    obrigatorios = _documentos_obrigatorios_da_proposta(dados_qualificacao)
    tipos_presentes = {
        d["tipo"]
        for d in sb.table("documentos_proposta").select("tipo").eq("proposta_id", proposta_id).execute().data
    }
    completo = all(tipo in tipos_presentes for tipo in obrigatorios)
    atual = (
        sb.table("propostas").select("documentos_completos_em").eq("id", proposta_id).limit(1).execute().data
    )
    ja_marcado = bool(atual and atual[0].get("documentos_completos_em"))
    if completo and not ja_marcado:
        sb.table("propostas").update(
            {"documentos_completos_em": datetime.now(timezone.utc).isoformat()}
        ).eq("id", proposta_id).execute()
    elif not completo and ja_marcado:
        sb.table("propostas").update({"documentos_completos_em": None}).eq("id", proposta_id).execute()


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
    # Comprovante de PIX/TED só faz sentido depois que a proposta já foi
    # aprovada — antes disso não existe pagamento nenhum pra comprovar.
    # Corretor, admin ou financeiro (mesma regra de quem já mexe na
    # proposta, ver _pode_mexer_na_proposta acima) podem anexar. Pedido em
    # 28/09.
    if tipo == "comprovante_pagamento" and proposta["status"] not in ("aprovada", "enviada", "aceita"):
        raise HTTPException(
            409,
            "Só é possível anexar comprovante de pagamento depois que a proposta for aprovada.",
        )

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
        f"Anexou documento '{tipo}' ({arquivo.filename or 'sem nome'}) na proposta {_numero_proposta(proposta)}.",
        {"tipo": tipo, "documento_id": inserido["id"]},
    )
    await run_in_threadpool(
        _atualizar_documentos_completos_em, sb, proposta_id, proposta.get("dados_qualificacao")
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
        f"Removeu documento '{doc[0].get('tipo')}' ({doc[0].get('nome_arquivo')}) da proposta {_numero_proposta(proposta)}.",
        {"documento_id": documento_id},
    )
    _atualizar_documentos_completos_em(sb, proposta_id, proposta.get("dados_qualificacao"))
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
    # A trava abaixo é só pro corretor comum: ele não deve mandar pro cliente
    # (nem baixar) um contrato de uma proposta que o financeiro ainda nem
    # decidiu. Pra quem já é o financeiro (admin/developer, ver eh_admin) a
    # trava não faz sentido: é essa mesma pessoa que aprova, então ela pode
    # gerar o documento (inclusive o relatório completo) pra conferir/revisar
    # ANTES de decidir, e aprovar a compra do lote em seguida — não precisa
    # esperar uma aprovação anterior de ninguém pra isso. Pedido em 28/09.
    if proposta["status"] not in ("aprovada", "enviada", "aceita") and not eh_admin(corretor):
        raise HTTPException(
            403,
            "Esta proposta ainda não foi aprovada — o PDF só pode ser gerado depois da aprovação.",
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


@router.get("/propostas/{proposta_id}/recibo")
def gerar_recibo_proposta(
    proposta_id: str,
    valor: float,
    data: Optional[str] = None,
    corretor: dict = Depends(get_current_corretor),
):
    """Gera o recibo (modelo .docx da própria imobiliária, Porto Franco ou
    Rancho Texas conforme o empreendimento do lote) do valor efetivamente
    recebido do cliente -- normalmente parte ou todo da entrada, um recibo
    por pagamento. Preenche só nome/CPF/valor/lote/data no modelo, mantendo a
    redação jurídica exata que a imobiliária já usa.

    Só financeiro (admin/developer) gera -- é quem de fato recebe o
    pagamento e emite o recibo, sem depender da proposta já estar 'aprovada'
    (mesma lógica de exceção do "gerar PDF", ver _montar_pdf_proposta).
    Pedido em 28/09."""
    if not eh_admin(corretor):
        raise HTTPException(403, "Só o financeiro pode gerar recibo.")
    if valor <= 0:
        raise HTTPException(422, "Informe um valor maior que zero.")

    data_recibo = None
    if data:
        try:
            data_recibo = datetime.strptime(data, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(422, "Data inválida -- use o formato AAAA-MM-DD.")

    sb = get_supabase()
    proposta = (
        sb.table("propostas")
        .select("*, lote:lotes(*, condominio:condominios(nome)), cliente:clientes(*)")
        .eq("id", proposta_id)
        .limit(1)
        .execute()
        .data
    )
    if not proposta:
        raise HTTPException(404, "Proposta não encontrada.")
    proposta = proposta[0]
    lote = proposta.get("lote")
    cliente = proposta.get("cliente")
    if not lote or not cliente:
        raise HTTPException(409, "Proposta com lote ou cliente ausente -- não é possível gerar o recibo.")
    if not cliente.get("cpf"):
        raise HTTPException(409, "Cliente sem CPF cadastrado -- não é possível gerar o recibo sem isso.")

    condominio_nome = (lote.get("condominio") or {}).get("nome", "")
    docx_bytes, _slug = preencher_recibo(
        condominio_nome=condominio_nome,
        cliente_nome=cliente["nome"],
        cliente_cpf=cliente["cpf"],
        valor=valor,
        lote_quadra=lote.get("quadra"),
        lote_numero=str(lote.get("lote_numero") or lote.get("identificador") or "-"),
        data=data_recibo,
    )
    # Recibo sai em PDF (pedido de 02/10) -- conversão própria, mesmo
    # conteúdo do modelo .docx (ver app/docx_pdf.py).
    pdf_bytes = docx_para_pdf(docx_bytes)
    nome_arquivo = f"recibo-{lote.get('identificador', proposta_id)}.pdf".replace(" ", "-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nome_arquivo}"'},
    )


@router.get("/propostas/{proposta_id}/contrato")
def gerar_contrato_proposta(
    proposta_id: str,
    comissao: float,
    data: Optional[str] = None,
    corretor: dict = Depends(get_current_corretor),
):
    """Gera o contrato completo (modelo .docx real da imobiliária, alienação
    fiduciária) preenchido com os dados da proposta -- mantendo a redação
    jurídica exata do modelo, só trocando os campos do QUADRO RESUMO e a
    cláusula de comissão. Por enquanto só o Porto Franco está implementado
    (é o único dos dois modelos com cláusula de comissão qualificando o
    corretor -- o Rancho Texas não tem essa cláusula, mas também tem campos
    de confrontação do lote que não existem em lugar nenhum do sistema hoje;
    fica pra depois). Atualizado em 28/09: Rancho Texas também sai pronto
    agora -- só que sem cláusula de comissão (esse modelo não qualifica
    corretor nenhum) e com os campos de confrontação do lote (frente/fundo/
    laterais, áreas privativa/comum/real) deixados com os valores de
    exemplo do modelo, porque o sistema não guarda essa medição em lugar
    nenhum hoje; alguém completa à mão antes da assinatura. `comissao`
    continua obrigatório no endpoint pra não duplicar a rota -- pro Rancho
    Texas ele simplesmente não é usado.

    Só financeiro (admin/developer) gera, e só depois que a proposta já foi
    decidida (aprovada/enviada/aceita) -- diferente do recibo e do PDF
    informal, que não esperam decisão nenhuma: aqui é o contrato de verdade,
    não faz sentido emitir antes de aprovar a venda."""
    if not eh_admin(corretor):
        raise HTTPException(403, "Só o financeiro pode gerar o contrato.")
    if comissao < 0:
        raise HTTPException(422, "O valor da comissão não pode ser negativo.")

    data_contrato = None
    if data:
        try:
            data_contrato = datetime.strptime(data, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(422, "Data inválida -- use o formato AAAA-MM-DD.")

    sb = get_supabase()
    proposta = (
        sb.table("propostas")
        .select("*, lote:lotes(*, condominio:condominios(nome)), cliente:clientes(*), corretor:corretores(*)")
        .eq("id", proposta_id)
        .limit(1)
        .execute()
        .data
    )
    if not proposta:
        raise HTTPException(404, "Proposta não encontrada.")
    proposta = proposta[0]
    if proposta["status"] not in ("aprovada", "enviada", "aceita"):
        raise HTTPException(409, "Só é possível gerar o contrato depois que a proposta for aprovada.")
    lote = proposta.get("lote")
    cliente = proposta.get("cliente")
    if not lote or not cliente:
        raise HTTPException(409, "Proposta com lote ou cliente ausente -- não é possível gerar o contrato.")
    if not cliente.get("cpf"):
        raise HTTPException(409, "Cliente sem CPF cadastrado -- não é possível gerar o contrato sem isso.")

    # Última trava (02/10): os números que vão ser impressos no QUADRO
    # RESUMO (entrada + parcelas + chave) têm que fechar com o preço, no
    # centavo -- senão o contrato nem é emitido. Vale pra proposta de
    # qualquer origem (formulário novo, antiga, qualificação pelo link).
    fp_contrato = (proposta.get("dados_qualificacao") or {}).get("forma_pagamento") or {}
    preco = proposta.get("valor_proposto") or lote.get("valor_total") or 0.0
    problemas = conferir_contrato(fp_contrato, preco, lote)
    if problemas:
        raise HTTPException(
            422,
            "O contrato não foi gerado porque a forma de pagamento da proposta não fecha: " + " ".join(problemas)
            + " Cancele a proposta e gere de novo pelo formulário, com os valores corretos.",
        )

    condominio_nome = (lote.get("condominio") or {}).get("nome", "")
    if "rancho" in condominio_nome.lower():
        docx_bytes = preencher_contrato_rancho_texas(
            proposta=proposta,
            lote=lote,
            cliente=cliente,
            data_contrato=data_contrato,
        )
    else:
        docx_bytes = preencher_contrato_porto_franco(
            proposta=proposta,
            lote=lote,
            cliente=cliente,
            corretor=proposta.get("corretor"),
            valor_comissao=comissao,
            data_contrato=data_contrato,
        )
    # Todo contrato sai em PDF (pedido de 02/10) -- ver app/docx_pdf.py.
    pdf_bytes = docx_para_pdf(docx_bytes)
    # Numeração e versão (03/10): "0003/2026", versão = versão da proposta.
    # Cada emissão fica registrada (quem, quando, qual versão, impressão
    # digital do PDF) -- é o histórico mostrado no Financeiro.
    numero_contrato, versao_contrato = identificacao_contrato(proposta, data_contrato)
    registrar_log(
        sb, corretor, "gerou_contrato", "proposta", proposta_id,
        f"Emitiu o contrato Nº {numero_contrato} – versão {versao_contrato} "
        f"(proposta {_numero_proposta(proposta)}).",
        {
            "numero_contrato": numero_contrato,
            "versao": versao_contrato,
            "data_contrato": (data_contrato or datetime.now(timezone.utc).date()).isoformat(),
            "comissao": comissao,
            "valor_proposto": proposta.get("valor_proposto"),
            "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
        },
    )
    nome_arquivo = (
        f"contrato-{numero_contrato.replace('/', '-')}-v{versao_contrato}-{lote.get('identificador', proposta_id)}.pdf"
    ).replace(" ", "-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nome_arquivo}"'},
    )


@router.get("/propostas/{proposta_id}/conferencia")
def conferencia_proposta(proposta_id: str, corretor: dict = Depends(get_current_corretor)):
    """O que o servidor acha desta proposta AGORA -- as mesmas checagens da
    aprovação e da emissão do contrato, pra tela do Financeiro mostrar as
    pendências antes de alguém clicar em "aprovar" (03/10)."""
    if not eh_admin(corretor):
        raise HTTPException(403, "Só o financeiro pode conferir a proposta.")
    sb = get_supabase()
    proposta = _carregar_proposta_ou_404(sb, proposta_id)
    lote = (
        sb.table("lotes")
        .select("id, valor_total, entrada, qtd_parcelas, parcela_mensal, entrega")
        .eq("id", proposta["lote_id"])
        .limit(1)
        .execute()
        .data
    )
    lote = lote[0] if lote else {}
    dados = proposta.get("dados_qualificacao") or {}
    fp = dados.get("forma_pagamento") or {}
    preco = proposta.get("valor_proposto") or lote.get("valor_total") or 0.0
    return {
        "plano_estruturado": ler_plano(fp).estruturado,
        "problemas_pagamento": problemas_para_aprovar(fp, proposta.get("valor_proposto"), lote),
        "problemas_contrato": conferir_contrato(fp, preco, lote),
        "problemas_cadastro": problemas_cadastro(dados) if dados else ["A proposta não tem os dados do comprador."],
    }


@router.get("/propostas/{proposta_id}/contratos")
def historico_contratos(proposta_id: str, corretor: dict = Depends(get_current_corretor)):
    """Contratos já emitidos desta proposta (mais recente primeiro): número,
    versão, quem emitiu e quando -- e se a versão atual da proposta ainda é
    a mesma do último emitido (senão, o contrato em mãos está desatualizado)."""
    if not eh_admin(corretor):
        raise HTTPException(403, "Só o financeiro pode ver o histórico de contratos.")
    sb = get_supabase()
    proposta = _carregar_proposta_ou_404(sb, proposta_id)
    logs = (
        sb.table("logs_auditoria")
        .select("created_at, ator_nome, detalhes")
        .eq("entidade", "proposta")
        .eq("entidade_id", proposta_id)
        .eq("acao", "gerou_contrato")
        .order("created_at", desc=True)
        .execute()
        .data
    ) or []
    numero, versao_atual = identificacao_contrato(proposta)
    emissoes = [
        {
            "emitido_em": l.get("created_at"),
            "emitido_por": l.get("ator_nome"),
            "numero_contrato": (l.get("detalhes") or {}).get("numero_contrato"),
            "versao": (l.get("detalhes") or {}).get("versao"),
            "data_contrato": (l.get("detalhes") or {}).get("data_contrato"),
            "comissao": (l.get("detalhes") or {}).get("comissao"),
        }
        for l in logs
    ]
    return {"numero_contrato": numero, "versao_atual": versao_atual, "emissoes": emissoes}


@router.get("/propostas/{proposta_id}/documento-completo")
def gerar_relatorio_completo(proposta_id: str, corretor: dict = Depends(get_current_corretor)):
    """Gera UM ÚNICO PDF: a proposta (mesmo documento de `gerar_pdf_proposta`
    acima) seguida de todos os documentos anexados (RG, CPF, comprovantes...),
    nessa ordem — pra ter tudo junto pra enviar/arquivar de uma vez, em vez de
    baixar a proposta e cada anexo separado. Documento que já é PDF entra com
    todas as páginas; imagem (JPG/PNG/WEBP/HEIC) vira uma página só com a
    foto. Mesma trava de status do "gerar PDF" (ver _montar_pdf_proposta) —
    inclusive a mesma exceção pra quem já é financeiro/admin/developer."""
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
    existente = sb.table("propostas").select("id, numero, versao, lote_id, cliente_id, corretor_id").eq(
        "id", proposta_id
    ).limit(1).execute().data
    if not existente:
        raise HTTPException(404, "Proposta não encontrada.")
    existente = existente[0]
    if not _pode_mexer_na_proposta(corretor, existente):
        raise HTTPException(403, "Esta proposta é de outro corretor.")
    if payload.status == "aprovada" and not eh_admin(corretor):
        raise HTTPException(403, "Só um administrador pode aprovar a proposta.")
    if payload.status == "aprovada":
        # Trava (02/10): forma de pagamento que não fecha não vira contrato.
        completa = sb.table("propostas").select("valor_proposto, dados_qualificacao").eq("id", proposta_id).limit(1).execute().data
        lote_aprov = sb.table("lotes").select("valor_total, entrada, qtd_parcelas, parcela_mensal, entrega").eq("id", existente["lote_id"]).limit(1).execute().data
        if completa:
            dados_aprov = completa[0].get("dados_qualificacao") or {}
            fp_aprov = dados_aprov.get("forma_pagamento") or {}
            problemas = problemas_para_aprovar(fp_aprov, completa[0].get("valor_proposto"), lote_aprov[0] if lote_aprov else None)
            # Dados do comprador inválidos (ex.: e-mail no campo de celular)
            # também seguram a aprovação -- mesma regra da tela do Financeiro.
            if dados_aprov.get("proponente"):
                problemas += problemas_cadastro(dados_aprov)
            if problemas:
                raise HTTPException(
                    422,
                    "Não dá pra aprovar esta proposta: " + " ".join(problemas) + " Cancele e gere a proposta de "
                    "novo pelo formulário, com a forma de pagamento correta.",
                )
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
        f"Mudou status da proposta {_numero_proposta(existente)} pra '{payload.status}'.",
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

    Bug real encontrado em 26/09 (proposta da Zaira Suzana, lote 08-quadra
    10): a reserva original tinha expirado sozinha (72h sem confirmar — ver
    _expirar_vencidas em routers/reservas.py) e o lote tinha voltado a
    'disponivel'. Quando a proposta foi aprovada depois disso, essa função
    via que a reserva JÁ existia (mesmo cancelada/expirada) e devolvia sem
    travar o lote de novo — o corretor viu o lote como disponível e criou
    uma reserva duplicada por cima de uma proposta que já estava aprovada.
    Por isso o travamento do lote agora roda incondicionalmente, mesmo
    quando a reserva já existe — só o INSERT da reserva (que geraria
    duplicata) que continua pulado nesse caso.
    """
    ja_existe = sb.table("reservas").select("id").eq("proposta_id", proposta_id).limit(1).execute().data
    if not ja_existe:
        cliente = (
            sb.table("clientes").select("nome, telefone, cpf").eq("id", proposta["cliente_id"]).limit(1).execute().data
        )
        cliente = cliente[0] if cliente else {}

        # Congela o preço do lote (ver ..precos.congelar_preco_lote) nesta
        # reserva gerada automaticamente, do mesmo jeito que criar_reserva
        # faz pra uma reserva criada na mão — sem isso, uma proposta que vira
        # reserva ficaria sem essa "data corte" de preço.
        lote_preco = (
            sb.table("lotes")
            .select("valor_total, entrada, entrega, parcela_mensal, qtd_parcelas, prazo_entrega_meses")
            .eq("id", proposta["lote_id"])
            .limit(1)
            .execute()
            .data
        )
        dados_reserva = {
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
        if lote_preco:
            dados_reserva.update(congelar_preco_lote(lote_preco[0]))
        sb.table("reservas").insert(dados_reserva).execute()
    # Atualização condicional (atômica no Postgres): só sobe pra 'reservado'
    # se o lote AINDA estiver 'disponivel' neste instante — não confia num
    # status lido antes da escrita (podia ter mudado entre a leitura e aqui,
    # ex.: duas propostas pro mesmo lote aprovadas quase juntas). Se não
    # estiver mais disponível, não faz nada — mesma regra de sempre: nunca
    # destrava um lote já 'vendido' ou já travado por outra reserva. Roda
    # sempre (não só quando a reserva é nova — ver comentário acima).
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
    propostas = sb.table("propostas").select("lote_id, status, valor_proposto, created_at").order("created_at").execute().data

    lote_condominio = {l["id"]: l["condominio_id"] for l in lotes}
    lotes_por_condominio: dict[str, list[dict]] = {c["id"]: [] for c in condominios}
    for l in lotes:
        lotes_por_condominio.setdefault(l["condominio_id"], []).append(l)

    # Preço de venda "de verdade" de cada lote vendido: o valor_proposto da
    # proposta ACEITA daquele lote, não o valor_total (atual) do lote —
    # sem isso, um reajuste de preço do empreendimento feito DEPOIS da venda
    # mudaria retroativamente quanto o relatório financeiro diz que aquele
    # lote foi vendido por (mesmo bug de fundo do caso da planilha da
    # Sheyla, só que no Financeiro em vez do estoque). `.order("created_at")`
    # acima + sobrescrever no dict garante que, na rara hipótese de mais de
    # uma proposta aceita pro mesmo lote, prevalece a mais recente. Só cai no
    # valor_total do lote quando ele foi marcado "vendido" sem nenhuma
    # proposta aceita por trás (ex.: ajuste manual de status).
    valor_aceito_por_lote = {p["lote_id"]: p["valor_proposto"] for p in propostas if p["status"] == "aceita"}

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
                "valor_total_vendido": sum(
                    valor_aceito_por_lote.get(l["id"], l.get("valor_total") or 0)
                    for l in do_condo
                    if l["status"] == "vendido"
                ),
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

    # Ver migração 0025_historico_precos_lotes.sql: toda vez que o preço de
    # um lote muda, a linha vigente anterior ganha vigente_ate preenchido.
    # Um lote só tem pra onde "desfazer" (ver POST .../preco/reverter em
    # condominios.py) se já existe pelo menos uma linha fechada dessas —
    # lote no preço original desde sempre não tem nenhuma. Tudo dentro de um
    # try/except só pra esta listagem (uma das mais usadas do painel) nunca
    # quebrar caso a migração 0025 ainda não tenha rodado no banco.
    ids_com_preco_anterior: set[str] = set()
    vigente_desde_por_lote: dict[str, str] = {}
    try:
        historico_fechado = (
            sb.table("lotes_precos_historico")
            .select("lote_id")
            .not_.is_("vigente_ate", "null")
            .execute()
            .data
        )
        ids_com_preco_anterior = {h["lote_id"] for h in historico_fechado}
        historico_vigente = (
            sb.table("lotes_precos_historico")
            .select("lote_id, vigente_desde")
            .is_("vigente_ate", "null")
            .execute()
            .data
        )
        vigente_desde_por_lote = {h["lote_id"]: h["vigente_desde"] for h in historico_vigente}
    except Exception:
        logger.warning("lotes_precos_historico indisponível (migração 0025 já rodou no banco?) — seguindo sem histórico de preço.")

    resultado = []
    for l in lotes:
        condo = condos.get(l["condominio_id"], {})
        proposta = proposta_por_lote.get(l["id"])
        pode_reverter = l["id"] in ids_com_preco_anterior
        resultado.append(
            {
                **l,
                "condominio_nome": condo.get("nome", "?"),
                "condominio_slug": condo.get("slug", ""),
                "proposta_pendente_status": proposta["status"] if proposta else None,
                "proposta_pendente_desde": proposta["created_at"] if proposta else None,
                "preco_pode_reverter": pode_reverter,
                "preco_alterado_em": vigente_desde_por_lote.get(l["id"]) if pode_reverter else None,
            }
        )
    return resultado
