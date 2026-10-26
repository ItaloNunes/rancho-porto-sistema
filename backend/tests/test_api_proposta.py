"""Criação/edição de proposta pela API: o servidor recusa plano de
pagamento inconsistente mesmo que alguém chame a API direto (sem passar
pelo formulário), normaliza os valores e grava o resumo derivado do plano.
Usa um Supabase falso em memória -- nada toca o banco de verdade."""

import copy
import itertools

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import crm
from app.security import get_current_corretor

_ids = itertools.count(1)


class _Consulta:
    def __init__(self, banco, tabela):
        self.banco, self.tabela = banco, tabela
        self.filtros, self.op, self.dados = [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, campo, valor):
        if "->>" in campo:  # filtro em campo de JSON (detalhes->>ip)
            col, chave = campo.split("->>")
            self.filtros.append(lambda r: str((r.get(col) or {}).get(chave)) == str(valor))
        else:
            self.filtros.append(lambda r: r.get(campo) == valor)
        return self

    def neq(self, campo, valor):
        self.filtros.append(lambda r: r.get(campo) != valor)
        return self

    def in_(self, campo, valores):
        valores = list(valores)
        self.filtros.append(lambda r: r.get(campo) in valores)
        return self

    def gte(self, campo, valor):
        self.filtros.append(lambda r: r.get(campo) is not None and r.get(campo) >= valor)
        return self

    def lt(self, campo, valor):
        self.filtros.append(lambda r: r.get(campo) is not None and r.get(campo) < valor)
        return self

    def delete(self):
        self.op = "delete"
        return self

    def limit(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def insert(self, dados):
        self.op, self.dados = "insert", dados
        return self

    def update(self, dados):
        self.op, self.dados = "update", dados
        return self

    def execute(self):
        linhas = self.banco.setdefault(self.tabela, [])
        if self.op == "insert":
            nova = {"id": f"id-{next(_ids)}", **copy.deepcopy(self.dados)}
            if self.tabela == "logs_auditoria":
                import datetime as _dt
                nova.setdefault("created_at", _dt.datetime.now(_dt.timezone.utc).isoformat())
            if self.tabela == "propostas":
                nova.setdefault("numero", 1)
                nova.setdefault("versao", 1)
                nova.setdefault("status", "rascunho")
                nova.setdefault("created_at", "2026-10-02T12:00:00+00:00")
            linhas.append(nova)
            return type("R", (), {"data": [nova]})
        alvo = [r for r in linhas if all(f(r) for f in self.filtros)]
        if self.op == "update":
            for r in alvo:
                r.update(copy.deepcopy(self.dados))
        if self.op == "delete":
            for r in alvo:
                linhas.remove(r)
        return type("R", (), {"data": alvo})


class _SupabaseFalso:
    def __init__(self):
        self.banco = {
            "lotes": [{"id": "lote-1", "status": "disponivel", "valor_total": 89990.0, "entrada": 8999.0,
                       "entrega": 8999.0, "parcela_mensal": 719.92, "qtd_parcelas": 100}],
            "clientes": [{"id": "cli-1", "nome": "Cliente", "telefone": "84999990000", "cpf": "52998224725", "corretor_id": "cor-1"}],
        }

    def table(self, nome):
        return _Consulta(self.banco, nome)

    def rpc(self, nome, params):
        """atribuir_numero_contrato (migration 0027): sequência a partir do 91."""
        assert nome == "atribuir_numero_contrato"
        prop = next(p for p in self.banco["propostas"] if p["id"] == params["p_proposta"])
        if not prop.get("numero_contrato"):
            usados = [p.get("numero_contrato") or 0 for p in self.banco["propostas"]]
            prop["numero_contrato"] = max([90, *usados]) + 1
        n = prop["numero_contrato"]
        return type("Q", (), {"execute": lambda self_: type("R", (), {"data": n})})()


@pytest.fixture()
def cliente_api(monkeypatch):
    sb = _SupabaseFalso()
    monkeypatch.setattr(crm, "get_supabase", lambda: sb)
    app.dependency_overrides[get_current_corretor] = lambda: {"id": "cor-1", "nome": "Corretor", "papel": "corretor", "ativo": True}
    yield TestClient(app), sb
    app.dependency_overrides.clear()


def payload(**fp_extra):
    fp = {"a_vista": False, "renda": "7000", "valor_proposto": 89990.0, "sinal": "8.999", "sinal_forma": "unica",
          "sinal_meio": "pix", "sinal_vencimento": "2026-10-05", "dividido_em_parcelas": 100, "valor_parcela": "719,92",
          "primeiro_mes": "2026-11-10", "chave_valor": "8999", "confirmado": True}
    fp.update(fp_extra)
    return {"lote_id": "lote-1", "cliente_id": "cli-1", "valor_proposto": fp["valor_proposto"],
            "condicoes_pagamento": "texto livre qualquer",
            "dados_qualificacao": {"proponente": {"nome": "Cliente"}, "endereco_residencial": {},
                                   "endereco_comercial": {}, "forma_pagamento": fp}}


def test_cria_com_plano_valido_normaliza_e_gera_resumo(cliente_api):
    api, sb = cliente_api
    r = api.post("/crm/propostas", json=payload())
    assert r.status_code == 200, r.text
    gravada = sb.banco["propostas"][0]
    fp = gravada["dados_qualificacao"]["forma_pagamento"]
    assert fp["sinal"] == "8.999,00" and fp["chave_valor"] == "8.999,00" and fp["vencimento"] == "10"
    assert gravada["condicoes_pagamento"] == "Entrada R$ 8.999,00 + 100x de R$ 719,92 + chave R$ 8.999,00"
    assert sb.banco["lotes"][0]["status"] == "reservado"


@pytest.mark.parametrize(
    "extra,trecho",
    [
        ({"sinal": None}, "entrada é obrigatória"),
        ({"dividido_em_parcelas": 5, "valor_parcela": "1.798,00"}, "A soma não fecha"),
        ({"primeiro_mes": "0206-10-20"}, "1ª parcela mensal"),
        ({"valor_proposto": 89.99}, "muito diferente do valor de tabela"),
        ({"confirmado": False}, "confirmação final"),
        ({"sinal_meio": None}, "como a entrada será paga"),
    ],
)
def test_recusa_plano_inconsistente_sem_gravar_nada(cliente_api, extra, trecho):
    api, sb = cliente_api
    r = api.post("/crm/propostas", json=payload(**extra))
    assert r.status_code == 422, r.text
    assert trecho in r.text
    assert not sb.banco.get("propostas")
    assert sb.banco["lotes"][0]["status"] == "disponivel"  # lote não ficou preso


def test_nao_deixa_editar_valor_de_proposta_com_plano(cliente_api):
    api, sb = cliente_api
    assert api.post("/crm/propostas", json=payload()).status_code == 200
    pid = sb.banco["propostas"][0]["id"]
    r = api.patch(f"/crm/propostas/{pid}", json={"valor_proposto": 80000.0})
    assert r.status_code == 409
    assert sb.banco["propostas"][0]["valor_proposto"] == 89990.0


def _proposta_legada(sb, fp, valor):
    sb.banco.setdefault("propostas", []).append({"id": "leg-1", "numero": 3, "versao": 1, "lote_id": "lote-1",
        "cliente_id": "cli-1", "corretor_id": "cor-1", "valor_proposto": valor, "status": "aguardando_aprovacao",
        "created_at": "2026-09-24T00:00:00+00:00", "dados_qualificacao": {"forma_pagamento": fp}})


def test_aprovacao_trava_proposta_antiga_que_nao_fecha(cliente_api, monkeypatch):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: {"id": "adm", "nome": "Admin", "papel": "admin", "ativo": True}
    # caso real da 0003: R$ 89,99 e "5x de 1.798,00"
    _proposta_legada(sb, {"a_vista": False, "sinal": "8.999,00", "dividido_em_parcelas": 5, "valor_parcela": "1.798,00",
                          "primeiro_mes": "02/10/2026", "valor_proposto": 89.99}, 89.99)
    r = api.patch("/crm/propostas/leg-1/status", json={"status": "aprovada"})
    assert r.status_code == 422 and "Não dá pra aprovar" in r.text
    assert sb.banco["propostas"][0]["status"] == "aguardando_aprovacao"


def test_aprovacao_libera_proposta_antiga_que_fecha(cliente_api):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: {"id": "adm", "nome": "Admin", "papel": "admin", "ativo": True}
    # igual às propostas 0001/0002 (já corrigidas): fecham com a chave do lote
    _proposta_legada(sb, {"a_vista": False, "sinal": "8.999", "dividido_em_parcelas": 100, "valor_parcela": "719,92",
                          "primeiro_mes": "20/10/2026", "valor_proposto": 89990.0}, 89990.0)
    r = api.patch("/crm/propostas/leg-1/status", json={"status": "aprovada"})
    assert r.status_code == 200, r.text


def test_recusa_proposta_sem_forma_de_pagamento(cliente_api):
    api, sb = cliente_api
    corpo = payload()
    corpo.pop("dados_qualificacao")
    r = api.post("/crm/propostas", json=corpo)
    assert r.status_code == 422 and "forma de pagamento é obrigatória" in r.text
    assert not sb.banco.get("propostas")
    assert sb.banco["lotes"][0]["status"] == "disponivel"


def test_renda_em_texto_livre_nao_quebra_o_schema(cliente_api):
    # o formulário público de qualificação salva renda como texto livre; o
    # schema não pode recusar isso (só a proposta do painel exige número)
    from app.schemas import FormaPagamentoDados
    assert FormaPagamentoDados(renda="7 mil por mês").renda == "7 mil por mês"


def test_a_vista_com_restos_de_parcelado_e_limpo(cliente_api):
    api, sb = cliente_api
    corpo = payload(a_vista=True, avista_meio="pix", avista_data="2026-10-10", sinal_forma=None)
    r = api.post("/crm/propostas", json=corpo)
    assert r.status_code == 200, r.text
    fp = sb.banco["propostas"][0]["dados_qualificacao"]["forma_pagamento"]
    assert fp["sinal"] is None and fp["valor_parcela"] is None and fp["chave_valor"] is None
    assert sb.banco["propostas"][0]["condicoes_pagamento"] == "À vista: R$ 89.990,00 via PIX em 10/10/2026"


# --------------------------------------------------------------------------
# Financeiro corrige os dados da proposta (PUT /crm/propostas/{id}/dados)
# --------------------------------------------------------------------------

ADMIN = {"id": "adm", "nome": "Admin", "papel": "admin", "ativo": True}

# Caso real da 0003: R$ 89,99, "5x de 1.798,00" (era a entrada parcelada,
# segundo a observação do corretor) e o e-mail no lugar do celular.
FP_0003 = {"renda": "10.000,00", "sinal": "8.999,00", "a_vista": False, "vencimento": "02",
           "observacoes": "cliente quer esse parcelamento e começar a pagar a parcela mensal apos a terceira parcela do sinal",
           "primeiro_mes": "02/10/2026", "valor_parcela": "1.798,00", "valor_proposto": 89.99, "dividido_em_parcelas": 5}
DQ_0003 = {"proponente": {"nome": "JOAO BATISTA XAVIER DA SILVA", "cpf_cnpj": "79153160444", "rg": "13303",
                          "email": "xaviersilva37@hotmail.com", "profissao": "servidor publico estadual",
                          "nacionalidade": "brasileira", "data_nascimento": "1971-06-02"},
           "estado_civil": "divorciado", "endereco_residencial": {"rua": "rua prudente de morais", "numero": "170"},
           "endereco_comercial": {}, "endereco_comercial_nao_possui": True,
           "telefone_celular": "xaviersilva37@hotmail.com", "telefone_residencial": "84991703788",
           "forma_pagamento": FP_0003}


def _semear_0003(sb, status="aguardando_aprovacao"):
    sb.banco.setdefault("propostas", []).append({
        "id": "p3", "numero": 3, "versao": 1, "lote_id": "lote-1", "cliente_id": "cli-1", "corretor_id": "cor-1",
        "valor_proposto": 89.99, "status": status, "created_at": "2026-09-24T00:00:00+00:00",
        "condicoes_pagamento": "100 x719,92", "dados_qualificacao": copy.deepcopy(DQ_0003)})


def _dq_corrigido(**fp_extra):
    dq = copy.deepcopy(DQ_0003)
    dq["telefone_celular"] = "(84) 99170-3788"
    dq["forma_pagamento"] = {
        "a_vista": False, "renda": "10.000,00", "valor_proposto": 89990.0,
        "sinal": "8.999,00", "sinal_forma": "parcelada", "sinal_parcelas": 5, "sinal_meio": "boleto",
        "sinal_vencimento": "2026-10-02", "dividido_em_parcelas": 100, "valor_parcela": "719,92",
        "primeiro_mes": "2026-12-02", "chave_valor": "8.999,00", "observacoes": FP_0003["observacoes"],
        "confirmado": True, **fp_extra}
    return dq


def test_financeiro_corrige_a_0003_e_depois_aprova(cliente_api):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    _semear_0003(sb)
    # antes: aprovação travada
    assert api.patch("/crm/propostas/p3/status", json={"status": "aprovada"}).status_code == 422

    r = api.put("/crm/propostas/p3/dados", json={"dados_qualificacao": _dq_corrigido(), "motivo": "valor digitado errado"})
    assert r.status_code == 200, r.text
    p = sb.banco["propostas"][0]
    assert p["valor_proposto"] == 89990.0 and p["versao"] == 2
    assert p["condicoes_pagamento"] == "Entrada R$ 8.999,00 em 5x + 100x de R$ 719,92 + chave R$ 8.999,00"
    fp = p["dados_qualificacao"]["forma_pagamento"]
    assert fp["sinal_valor_parcela"] == "1.799,80" and fp["vencimento"] == "2"
    assert sb.banco["clientes"][0]["telefone"] == "(84) 99170-3788"
    assert sb.banco["clientes"][0]["email"] == "xaviersilva37@hotmail.com"
    log = sb.banco["logs_auditoria"][-1]
    assert log["acao"] == "editou_proposta" and "valor digitado errado" in log["descricao"]
    assert log["detalhes"]["alteracoes"]["telefone_celular"]["antes"] == "xaviersilva37@hotmail.com"
    assert log["detalhes"]["valor_proposto"] == {"antes": 89.99, "depois": 89990.0}

    # depois: aprova normalmente
    r = api.patch("/crm/propostas/p3/status", json={"status": "aprovada"})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize(
    "mexer,trecho",
    [
        (lambda dq: dq["forma_pagamento"].update(valor_parcela="700,00"), "A soma não fecha"),
        (lambda dq: dq["forma_pagamento"].update(sinal=None), "entrada é obrigatória"),
        (lambda dq: dq["forma_pagamento"].update(confirmado=False), "confirmação final"),
        (lambda dq: dq.update(telefone_celular="xaviersilva37@hotmail.com"), "Celular inválido"),
        (lambda dq: dq["proponente"].update(cpf_cnpj="791.531.604-45"), "CPF/CNPJ do comprador inválido"),
        (lambda dq: dq["proponente"].update(nome=""), "nome completo"),
    ],
)
def test_financeiro_nao_grava_correcao_errada(cliente_api, mexer, trecho):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    _semear_0003(sb)
    dq = _dq_corrigido()
    mexer(dq)
    r = api.put("/crm/propostas/p3/dados", json={"dados_qualificacao": dq})
    assert r.status_code == 422 and trecho in r.text, r.text
    assert sb.banco["propostas"][0]["versao"] == 1 and sb.banco["propostas"][0]["valor_proposto"] == 89.99


def test_so_admin_edita_dados(cliente_api):
    api, sb = cliente_api
    _semear_0003(sb)
    r = api.put("/crm/propostas/p3/dados", json={"dados_qualificacao": _dq_corrigido()})
    assert r.status_code == 403


def test_proposta_cancelada_nao_edita(cliente_api):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    _semear_0003(sb, status="cancelada")
    r = api.put("/crm/propostas/p3/dados", json={"dados_qualificacao": _dq_corrigido()})
    assert r.status_code == 409


# --------------------------------------------------------------------------
# Numeração e versão do contrato (03/10)
# --------------------------------------------------------------------------

def test_identificacao_do_contrato():
    from datetime import date
    from app.documentos_gerados import identificacao_contrato, titulo_contrato
    p = {"numero": 3, "versao": 2, "numero_contrato": 91, "created_at": "2026-09-24T23:31:38+00:00"}
    assert identificacao_contrato(p, date(2027, 1, 5)) == ("0091", 2)  # sequência própria, sem ano
    assert titulo_contrato(p) == "CONTRATO Nº 0091 – VERSÃO 2"
    assert identificacao_contrato({"numero": 3, "versao": 1}) == (None, 1)  # ainda não emitido


def test_contrato_sai_numerado_versionado_e_registrado(cliente_api, monkeypatch):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    _semear_0003(sb)
    assert api.put("/crm/propostas/p3/dados", json={"dados_qualificacao": _dq_corrigido()}).status_code == 200
    assert api.patch("/crm/propostas/p3/status", json={"status": "aprovada"}).status_code == 200
    # o select embutido (lote/cliente/corretor) não existe no Supabase falso: monta na mão
    prop = sb.banco["propostas"][0]
    prop["lote"] = {**sb.banco["lotes"][0], "identificador": "Q10-L8", "quadra": "10", "lote_numero": "8",
                    "tamanho_m2": 300, "condominio": {"nome": "Porto Franco"}}
    prop["cliente"] = sb.banco["clientes"][0]
    prop["corretor"] = {"nome": "Corretor", "cpf_cnpj": "52998224725", "creci": "123"}
    # sem o lote no memorial descritivo o contrato não sai (09/10)
    r = api.get("/crm/propostas/p3/contrato?comissao=0&data=2026-10-03")
    assert r.status_code == 422 and "memorial descritivo" in r.text
    assert not sb.banco["propostas"][0].get("numero_contrato")  # barrado não gasta número
    sb.banco["lotes_memorial"] = [{"condominio_slug": "porto-franco", "quadra": "10", "lote_numero": 8,
                                   "area_privativa": 300.0, "area_comum": 135.24, "area_real": 435.24,
                                   "area_texto": "Área privativa: 300,00m², Área comum: 135,24m² e Área real: 435,24m²",
                                   "confrontacoes": ["10,00m de frente com a Rua X", "10,00m de fundo com o lote 9",
                                                     "30,00m de comprimento pelo lado direito com o lote 7",
                                                     "30,00m de comprimento pelo lado esquerdo com o lote 9"]}]
    r = api.get("/crm/propostas/p3/contrato?comissao=0&data=2026-10-03")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert 'contrato-0091-v2-Q10-L8.pdf' in r.headers["content-disposition"]
    import io
    from pypdf import PdfReader
    texto = PdfReader(io.BytesIO(r.content)).pages[0].extract_text()
    assert "CONTRATO Nº 0091 – VERSÃO 2" in " ".join(texto.split())
    h = api.get("/crm/propostas/p3/contratos").json()
    assert h["numero_contrato"] == "0091" and h["versao_atual"] == 2
    # reemitir mantém o número (só a versão acompanha a proposta)
    r2 = api.get("/crm/propostas/p3/contrato?comissao=0&data=2026-10-04")
    assert r2.status_code == 200 and 'contrato-0091-v2' in r2.headers["content-disposition"]
    assert sb.banco["propostas"][0]["numero_contrato"] == 91
    assert h["emissoes"][0]["versao"] == 2 and h["emissoes"][0]["emitido_por"] == "Admin"


def test_conferencia_mostra_pendencias_da_0003_e_some_depois_de_corrigir(cliente_api):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    _semear_0003(sb)
    c = api.get("/crm/propostas/p3/conferencia").json()
    assert c["plano_estruturado"] is False
    assert any("muito diferente" in x for x in c["problemas_pagamento"])
    assert any("Celular inválido" in x for x in c["problemas_cadastro"])
    assert api.put("/crm/propostas/p3/dados", json={"dados_qualificacao": _dq_corrigido()}).status_code == 200
    c = api.get("/crm/propostas/p3/conferencia").json()
    assert c == {"plano_estruturado": True, "problemas_pagamento": [], "problemas_contrato": [], "problemas_cadastro": []}


def test_aprovacao_trava_celular_invalido(cliente_api):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    _semear_0003(sb)
    dq = _dq_corrigido()
    assert api.put("/crm/propostas/p3/dados", json={"dados_qualificacao": dq}).status_code == 200
    # alguém grava direto no banco um celular inválido depois da correção
    sb.banco["propostas"][0]["dados_qualificacao"]["telefone_celular"] = "fulano@email.com"
    r = api.patch("/crm/propostas/p3/status", json={"status": "aprovada"})
    assert r.status_code == 422 and "Celular inválido" in r.text


def _semear_0001(sb):
    # real: proposta antiga aprovada, plano fecha com a chave do lote, e-mail no celular
    fp = {"renda": "12.000,00", "sinal": "8.999,00", "a_vista": False, "vencimento": "10",
          "primeiro_mes": "10/10/2026", "valor_parcela": "719,92", "valor_proposto": 89990.0, "dividido_em_parcelas": 100}
    dq = {"proponente": {"nome": "ZAIRA", "cpf_cnpj": "52998224725", "email": "zaira@hotmail.com"},
          "estado_civil": "casado", "conjuge": {"nome": "TERCIO JUNIOR", "cpf_cnpj": "11144477735", "rg": "1700983",
          "data_nascimento": "1984-03-10", "nacionalidade": "brasileiro", "profissao": "Consultor"}, "endereco_residencial": {}, "endereco_comercial": {},
          "telefone_celular": "zaira@hotmail.com", "telefone_residencial": " 84 99917-6750", "forma_pagamento": fp}
    sb.banco.setdefault("propostas", []).append({
        "id": "p1", "numero": 1, "versao": 1, "lote_id": "lote-1", "cliente_id": "cli-1", "corretor_id": "cor-1",
        "valor_proposto": 89990.0, "status": "aprovada", "created_at": "2026-09-21T00:00:00+00:00",
        "dados_qualificacao": copy.deepcopy(dq)})
    return dq


def test_corrige_so_o_celular_de_proposta_antiga_sem_refazer_o_plano(cliente_api):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    dq = _semear_0001(sb)
    dq["telefone_celular"] = "(84) 99917-6750"
    dq["forma_pagamento"] = {**dq["forma_pagamento"], "primeiro_mes": "2026-10-10", "confirmado": True}  # como o form manda
    r = api.put("/crm/propostas/p1/dados", json={"dados_qualificacao": dq, "motivo": "celular"})
    assert r.status_code == 200, r.text
    p = sb.banco["propostas"][0]
    assert p["versao"] == 2 and p["dados_qualificacao"]["telefone_celular"] == "(84) 99917-6750"
    assert p["dados_qualificacao"]["forma_pagamento"]["primeiro_mes"] == "10/10/2026"  # plano antigo intacto
    assert p["valor_proposto"] == 89990.0
    assert p["condicoes_pagamento"] == "Entrada R$ 8.999,00 + 100x de R$ 719,92 + chave R$ 8.999,00"
    # mexer no valor da parcela de um plano antigo exige refazer o plano no formato novo
    dq["forma_pagamento"]["valor_parcela"] = "700,00"
    r = api.put("/crm/propostas/p1/dados", json={"dados_qualificacao": dq})
    assert r.status_code == 422 and "Informe se a entrada será paga" in r.text


# --------------------------------------------------------------------------
# Cônjuge / companheiro(a) (03/10)
# --------------------------------------------------------------------------

CONJUGE_OK = {"nome": "MARIA COMPANHEIRA", "cpf_cnpj": "11144477735", "rg": "998877", "orgao_expedidor": "SSP/RN",
              "data_nascimento": "1990-01-15", "nacionalidade": "brasileira", "profissao": "Professora",
              "email": "maria@example.com", "naturalidade": "Natal/RN"}


@pytest.mark.parametrize(
    "extra,trecho",
    [
        ({"estado_civil": "casado", "tem_conjuge": True, "conjuge": {"nome": "MARIA"}}, "Faltam dados do cônjuge"),
        ({"estado_civil": "casado", "conjuge": None}, "Faltam dados do cônjuge"),  # sem responder: pelo estado civil
        ({"estado_civil": "solteiro", "tem_conjuge": True, "conjuge": CONJUGE_OK}, "Casado(a) ou União estável"),
        ({"estado_civil": "uniao_estavel", "tem_conjuge": False}, "não tem cônjuge"),
    ],
)
def test_criacao_trava_conjuge_incompleto_ou_incoerente(cliente_api, extra, trecho):
    api, sb = cliente_api
    corpo = payload()
    corpo["dados_qualificacao"].update(extra)
    r = api.post("/crm/propostas", json=corpo)
    assert r.status_code == 422 and trecho in r.text, r.text
    assert not sb.banco.get("propostas")


def test_criacao_com_uniao_estavel_completa(cliente_api):
    api, sb = cliente_api
    corpo = payload()
    corpo["dados_qualificacao"].update({"estado_civil": "uniao_estavel", "tem_conjuge": True, "conjuge": CONJUGE_OK})
    r = api.post("/crm/propostas", json=corpo)
    assert r.status_code == 200, r.text


def test_contrato_rancho_texas_trava_sem_dados_do_conjuge(cliente_api):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    _semear_0003(sb, status="aprovada")
    p = sb.banco["propostas"][0]
    p["valor_proposto"] = 89990.0
    p["dados_qualificacao"] = _dq_corrigido()
    p["dados_qualificacao"].update({"estado_civil": "casado", "conjuge": {"nome": "ESPOSA"}})
    p["lote"] = {**sb.banco["lotes"][0], "identificador": "LOTE 12", "lote_numero": 12, "tamanho_m2": 800,
                 "condominio": {"nome": "Rancho Texas"}}
    p["cliente"] = sb.banco["clientes"][0]
    r = api.get("/crm/propostas/p3/contrato?comissao=0&data=2026-10-03")
    assert r.status_code == 422 and "Faltam dados do cônjuge" in r.text, r.text


# --------------------------------------------------------------------------
# PDF da proposta liberado pro corretor antes da aprovação (10/10)
# --------------------------------------------------------------------------

def _prop_com_joins(sb):
    prop = sb.banco["propostas"][0]
    prop["lote"] = {**sb.banco["lotes"][0], "identificador": "Q10-L8", "quadra": "10", "lote_numero": 8,
                    "tamanho_m2": 200, "condominio": {"nome": "Porto Franco"}}
    prop["cliente"] = sb.banco["clientes"][0]
    return prop


@pytest.mark.parametrize("status", ["rascunho", "aguardando_aprovacao", "aprovada"])
def test_corretor_gera_pdf_sem_esperar_aprovacao(cliente_api, status):
    api, sb = cliente_api  # corretor comum (cor-1), dono da proposta
    _semear_0003(sb, status=status)
    _prop_com_joins(sb)
    r = api.get("/crm/propostas/p3/documento")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"


@pytest.mark.parametrize("status", ["cancelada", "recusada"])
def test_corretor_nao_gera_pdf_de_proposta_cancelada_ou_recusada(cliente_api, status):
    api, sb = cliente_api
    _semear_0003(sb, status=status)
    _prop_com_joins(sb)
    r = api.get("/crm/propostas/p3/documento")
    assert r.status_code == 403 and "cancelada ou recusada" in r.text
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN  # financeiro continua podendo, pra conferência
    assert api.get("/crm/propostas/p3/documento").status_code == 200


# --------------------------------------------------------------------------
# Empreendimentos novos ocultos (10/10)
# --------------------------------------------------------------------------

def _semear_oculto(sb):
    sb.banco["condominios"] = [{"id": "c-pf", "nome": "Porto Franco Residencial", "slug": "porto-franco", "ativo": True},
                               {"id": "c-bv", "nome": "Boulevard Residence", "slug": "boulevard", "ativo": False}]
    sb.banco["lotes"][0].update({"condominio_id": "c-pf", "quadra": "10", "lote_numero": 8,
                                 "identificador": "LOTE 08 - QUADRA 10", "tamanho_m2": 200.0, "poligono": []})
    sb.banco["lotes"].append({"id": "lote-bv", "condominio_id": "c-bv", "quadra": "2", "lote_numero": 1,
                              "identificador": "LOTE 01 - QUADRA 2", "tamanho_m2": 389.03, "valor_total": 321000.0,
                              "status": "disponivel", "poligono": [], "detalhes": "Lote sombra"})


def test_corretor_nao_ve_nem_negocia_empreendimento_oculto(cliente_api):
    api, sb = cliente_api  # corretor comum
    _semear_oculto(sb)
    ids = [l["id"] for l in api.get("/crm/lotes").json()]
    assert "lote-bv" not in ids and "lote-1" in ids
    r = api.post("/crm/propostas", json={**payload(), "lote_id": "lote-bv"})
    assert r.status_code == 409 and "liberado" in r.text
    from app.routers import reservas as reservas_mod
    reservas_mod.get_supabase = lambda: sb
    r = api.post("/reservas", json={"lote_id": "lote-bv", "nome": "Fulano", "contato": "84999990000"})
    assert r.status_code == 409 and "liberado" in r.text


def test_financeiro_ve_empreendimento_oculto_marcado(cliente_api):
    api, sb = cliente_api
    app.dependency_overrides[get_current_corretor] = lambda: ADMIN
    _semear_oculto(sb)
    lotes = {l["id"]: l for l in api.get("/crm/lotes").json()}
    assert lotes["lote-bv"]["condominio_ativo"] is False and lotes["lote-bv"]["detalhes"] == "Lote sombra"
    assert lotes["lote-1"]["condominio_ativo"] is True


def test_empreendimento_sem_modelo_nao_gera_contrato_nem_recibo():
    from app.documentos_gerados import modelo_documentos
    assert modelo_documentos("Porto Franco Residencial") == "porto_franco"
    assert modelo_documentos("Rancho Texas") == "rancho_texas"
    for nome in ("Boulevard Residence", "Praia Mar", "Rota dos Ventos", "Riviera Residence Beach", "Veneza Residencial"):
        assert modelo_documentos(nome) is None


def test_lista_mostra_prazo_do_rascunho_e_expiracao(cliente_api):
    """26/10: rascunho sem documentos mostra quando a reserva vence; o que
    expirou junto com a reserva vem marcado com a data da expiração."""
    from app.routers.crm import _com_prazo_da_reserva
    _api, sb = cliente_api
    sb.banco["reservas"] = [{"id": "r1", "proposta_id": "p1", "status": "pendente", "expira_em": "2026-10-29T12:00:00+00:00"},
                            {"id": "r2", "proposta_id": "p2", "status": "cancelada", "expira_em": "2026-10-20T12:00:00+00:00"}]
    sb.banco["logs_auditoria"] = [{"acao": "proposta_expirou", "entidade_id": "p2", "created_at": "2026-10-20T12:05:00+00:00"}]
    props = [{"id": "p1", "status": "rascunho", "documentos_completos_em": None},
             {"id": "p2", "status": "cancelada"},
             {"id": "p3", "status": "aprovada", "documentos_completos_em": "2026-10-01T00:00:00+00:00"}]
    out = {p["id"]: p for p in _com_prazo_da_reserva(sb, props)}
    assert out["p1"]["reserva_expira_em"] == "2026-10-29T12:00:00+00:00"
    assert out["p2"]["expirou_em"] == "2026-10-20T12:05:00+00:00"
    assert "reserva_expira_em" not in out["p3"] and "expirou_em" not in out["p3"]
