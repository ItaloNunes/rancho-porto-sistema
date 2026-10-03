"""Login e sessão (revisão de segurança de 03/10)."""

import jwt
import pytest
from fastapi.testclient import TestClient

from app import security
from app.config import settings
from app.main import app
from app.routers import crm
from app.usuarios import hash_senha

from .test_api_proposta import _SupabaseFalso


@pytest.fixture()
def api(monkeypatch):
    sb = _SupabaseFalso()
    sb.banco["corretores"] = [
        {"id": "c1", "nome": "Elaine", "usuario": "elaine.cristina", "telefone": "84987031612", "papel": "admin",
         "ativo": True, "senha_hash": hash_senha("84987031612"), "senha_customizada": False},
        {"id": "c2", "nome": "Joana", "usuario": "joana.lima", "telefone": "84999998888", "papel": "corretor",
         "ativo": True, "senha_hash": hash_senha("Joana2026x"), "senha_customizada": True},
    ]
    monkeypatch.setattr(crm, "get_supabase", lambda: sb)
    monkeypatch.setattr(security, "get_supabase", lambda: sb)
    app.dependency_overrides.clear()
    yield TestClient(app), sb


def _login(c, usuario, senha):
    return c.post("/crm/login", json={"usuario": usuario, "senha": senha})


def test_bloqueia_depois_de_5_erros(api):
    c, sb = api
    for i in range(4):
        assert _login(c, "joana.lima", "errada").status_code == 401
    r = _login(c, "joana.lima", "errada")
    assert r.status_code == 429 and "Aguarde 15 minutos" in r.text
    # nem com a senha certa, até passar a janela
    assert _login(c, "joana.lima", "Joana2026x").status_code == 429
    assert any(l["acao"] == "login_falhou" for l in sb.banco["logs_auditoria"])


def test_usuario_inexistente_mesma_mensagem(api):
    c, _ = api
    r = _login(c, "nao.existe", "x")
    assert r.status_code == 401 and "Usuário ou senha incorretos" in r.text


def test_senha_inicial_obriga_troca_e_troca_derruba_sessoes_antigas(api):
    c, sb = api
    r = _login(c, "elaine.cristina", "84987031612")
    assert r.status_code == 200
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    # admin: sessão de 12h
    claims = jwt.decode(tok, settings.jwt_secret, algorithms=["HS256"])
    assert claims["exp"] - claims["iat"] == 12 * 3600
    assert c.get("/crm/me", headers=h).status_code == 200
    r = c.get("/crm/propostas", headers=h)
    assert r.status_code == 403 and "Troque sua senha" in r.text
    # senha fraca / com telefone / igual ao usuário
    for fraca in ("1234567", "84987031612", "elaine2026", "senha123"):
        r = c.post("/crm/me/senha", headers=h, json={"senha_atual": "84987031612", "senha_nova": fraca})
        assert r.status_code == 400, fraca
    r = c.post("/crm/me/senha", headers=h, json={"senha_atual": "84987031612", "senha_nova": "Mossoro2026"})
    assert r.status_code == 200, r.text
    novo = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert c.get("/crm/me", headers=h).status_code == 401  # token antigo morreu
    assert c.get("/crm/propostas", headers=novo).status_code == 200


def test_corretor_sessao_de_7_dias(api):
    c, _ = api
    tok = _login(c, "joana.lima", "Joana2026x").json()["access_token"]
    claims = jwt.decode(tok, settings.jwt_secret, algorithms=["HS256"])
    assert claims["exp"] - claims["iat"] == 7 * 24 * 3600


def test_cabecalhos_de_seguranca(api):
    c, _ = api
    r = _login(c, "nao.existe", "x")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"
