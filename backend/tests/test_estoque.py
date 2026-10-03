"""Travas de estoque e de status (revisão de 03/10): lote não pode voltar pro
catálogo enquanto alguém ainda segura ele; corretor não pula etapas;
reserva/proposta cancelada não volta à vida."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import crm, reservas
from app.security import get_current_corretor

from .test_api_proposta import ADMIN, _SupabaseFalso, payload

CORRETOR = {"id": "cor-1", "nome": "Corretor", "papel": "corretor", "ativo": True}
OUTRO = {"id": "cor-2", "nome": "Outro", "papel": "corretor", "ativo": True}


@pytest.fixture()
def ambiente(monkeypatch):
    sb = _SupabaseFalso()
    monkeypatch.setattr(crm, "get_supabase", lambda: sb)
    monkeypatch.setattr(reservas, "get_supabase", lambda: sb)
    quem = {"u": CORRETOR}
    app.dependency_overrides[get_current_corretor] = lambda: quem["u"]
    yield TestClient(app), sb, quem
    app.dependency_overrides.clear()


def _cria_proposta(api, sb):
    r = api.post("/crm/propostas", json=payload())
    assert r.status_code == 200, r.text
    return sb.banco["propostas"][-1]["id"]


def test_corretor_nao_vende_sem_aprovacao(ambiente):
    api, sb, quem = ambiente
    pid = _cria_proposta(api, sb)
    r = api.patch(f"/crm/propostas/{pid}/status", json={"status": "aceita"})
    assert r.status_code == 409
    assert sb.banco["lotes"][0]["status"] == "reservado"
    r = api.patch(f"/crm/propostas/{pid}/status", json={"status": "recusada"})
    assert r.status_code == 403


def test_fluxo_completo_e_reserva_confirmada(ambiente):
    api, sb, quem = ambiente
    pid = _cria_proposta(api, sb)
    quem["u"] = ADMIN
    assert api.patch(f"/crm/propostas/{pid}/status", json={"status": "aprovada"}).status_code == 200
    reserva = next(r for r in sb.banco["reservas"] if r.get("proposta_id") == pid)
    assert reserva["status"] == "confirmada"
    quem["u"] = CORRETOR
    assert api.patch(f"/crm/propostas/{pid}/status", json={"status": "enviada"}).status_code == 200
    assert api.patch(f"/crm/propostas/{pid}/status", json={"status": "aceita"}).status_code == 200
    assert sb.banco["lotes"][0]["status"] == "vendido"
    # corretor não desfaz venda; financeiro desfaz e o lote volta
    assert api.patch(f"/crm/propostas/{pid}/status", json={"status": "cancelada"}).status_code == 403
    quem["u"] = ADMIN
    assert api.patch(f"/crm/propostas/{pid}/status", json={"status": "cancelada"}).status_code == 200
    assert sb.banco["lotes"][0]["status"] == "disponivel"


def test_proposta_cancelada_nao_reabre(ambiente):
    api, sb, quem = ambiente
    pid = _cria_proposta(api, sb)
    assert api.patch(f"/crm/propostas/{pid}/status", json={"status": "cancelada"}).status_code == 200
    assert sb.banco["lotes"][0]["status"] == "disponivel"
    r = api.patch(f"/crm/propostas/{pid}/status", json={"status": "aguardando_aprovacao"})
    assert r.status_code == 409 and "reabrir" in r.text


def test_expiracao_nao_devolve_lote_de_venda_aprovada(ambiente):
    api, sb, quem = ambiente
    pid = _cria_proposta(api, sb)
    quem["u"] = ADMIN
    assert api.patch(f"/crm/propostas/{pid}/status", json={"status": "aprovada"}).status_code == 200
    for r in sb.banco["reservas"]:
        r["expira_em"] = "2000-01-01T00:00:00+00:00"
        r["status"] = "pendente"  # pior caso: reserva ainda "pendente"
    assert reservas._expirar_vencidas(sb) == 0
    assert sb.banco["lotes"][0]["status"] == "reservado"


def test_rascunho_abandonado_expira_junto_e_libera(ambiente):
    api, sb, quem = ambiente
    pid = _cria_proposta(api, sb)
    for r in sb.banco["reservas"]:
        r["expira_em"] = "2000-01-01T00:00:00+00:00"
    assert reservas._expirar_vencidas(sb) == 1
    assert next(p for p in sb.banco["propostas"] if p["id"] == pid)["status"] == "cancelada"
    assert sb.banco["lotes"][0]["status"] == "disponivel"


def test_rascunho_com_documentos_completos_nao_expira(ambiente):
    api, sb, quem = ambiente
    pid = _cria_proposta(api, sb)
    next(p for p in sb.banco["propostas"] if p["id"] == pid)["documentos_completos_em"] = "2026-10-01T00:00:00+00:00"
    for r in sb.banco["reservas"]:
        r["expira_em"] = "2000-01-01T00:00:00+00:00"
    assert reservas._expirar_vencidas(sb) == 0
    assert sb.banco["lotes"][0]["status"] == "reservado"


def test_reserva_da_proposta_nao_cancela_nem_exclui_sozinha(ambiente):
    api, sb, quem = ambiente
    _cria_proposta(api, sb)
    rid = sb.banco["reservas"][0]["id"]
    r = api.patch(f"/reservas/{rid}/status", json={"status": "cancelada"})
    assert r.status_code == 409 and "cancele a proposta" in r.text
    assert api.delete(f"/reservas/{rid}").status_code == 409
    assert sb.banco["lotes"][0]["status"] == "reservado"


def test_cancelar_de_novo_reserva_velha_nao_solta_lote_de_outro(ambiente):
    api, sb, quem = ambiente
    sb.banco["reservas"] = [
        {"id": "velha", "lote_id": "lote-1", "status": "cancelada", "corretor_id": "cor-1", "nome": "A",
         "created_at": "2026-10-01T00:00:00+00:00", "expira_em": "2026-10-04T00:00:00+00:00"},
        {"id": "nova", "lote_id": "lote-1", "status": "pendente", "corretor_id": "cor-2", "nome": "B",
         "created_at": "2026-10-02T00:00:00+00:00", "expira_em": "2026-10-05T00:00:00+00:00"},
    ]
    sb.banco["lotes"][0]["status"] = "reservado"
    r = api.patch("/reservas/velha/status", json={"status": "cancelada"})
    assert r.status_code == 200, r.text
    assert sb.banco["lotes"][0]["status"] == "reservado"
    # e reserva cancelada não volta à vida
    r = api.patch("/reservas/velha/status", json={"status": "pendente"})
    assert r.status_code == 409 and "não pode ser reaberta" in r.text


def test_corretor_nao_ve_nem_mexe_em_proposta_de_outro(ambiente):
    api, sb, quem = ambiente
    pid = _cria_proposta(api, sb)
    quem["u"] = OUTRO
    assert api.patch(f"/crm/propostas/{pid}/status", json={"status": "cancelada"}).status_code == 403
    # cliente de outro corretor não pode ser usado numa proposta
    sb.banco["lotes"].append({**sb.banco["lotes"][0], "id": "lote-2", "status": "disponivel"})
    corpo = payload()
    corpo["lote_id"] = "lote-2"
    assert api.post("/crm/propostas", json=corpo).status_code == 403
