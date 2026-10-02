"""Regras do plano de pagamento (app/plano_pagamento.py) -- inclusive os
casos reais que motivaram a mudança de 02/10."""

from datetime import date

import pytest

from app.plano_pagamento import (
    conferir_contrato,
    data,
    dividir_em_parcelas,
    fmt_brl,
    ler_plano,
    normalizar,
    problemas_para_aprovar,
    resumo,
    validar,
    valor,
)

TABELA_PF = {"valor_total": 89990.0, "entrada": 8999.0, "parcela_mensal": 719.92, "qtd_parcelas": 100, "entrega": 8999.0}


def plano_ok(**extra):
    fp = {
        "a_vista": False,
        "renda": "7.000,00",
        "valor_proposto": 89990.0,
        "sinal": "8.999,00",
        "sinal_forma": "unica",
        "sinal_meio": "pix",
        "sinal_vencimento": "2026-10-05",
        "dividido_em_parcelas": 100,
        "valor_parcela": "719,92",
        "primeiro_mes": "2026-11-10",
        "chave_valor": "8.999,00",
        "confirmado": True,
    }
    fp.update(extra)
    return fp


@pytest.mark.parametrize(
    "texto,esperado",
    [
        ("8.999", 8999.0),  # caso real: virava R$ 9,00 no contrato
        ("8.999,00", 8999.0),
        ("R$ 8.999,00", 8999.0),
        ("8999", 8999.0),
        ("8999,50", 8999.5),
        ("8999.50", 8999.5),
        ("719,92", 719.92),
        ("1.234.567,89", 1234567.89),
        ("0,99", 0.99),
        ("abc", None),
        ("", None),
        (None, None),
        # formatos ambíguos/estranhos: recusa em vez de adivinhar (revisão 02/10)
        ("8,999.00", None),  # antes virava 8,999 (oito reais)
        ("333,333", None),
        ("1e3", None),
        ("nan", None),
        ("inf", None),
        ("8999.", None),
        (",5", None),
        ("1_000", None),
        ("-500", None),
        ("8.99", 8.99),
        (float("nan"), None),
    ],
)
def test_valor(texto, esperado):
    assert valor(texto) == esperado


def test_fmt_brl():
    assert fmt_brl(8999) == "8.999,00"
    assert fmt_brl(1234567.891) == "1.234.567,89"


@pytest.mark.parametrize(
    "texto,esperado",
    [
        ("2026-10-20", date(2026, 10, 20)),
        ("20/10/2026", date(2026, 10, 20)),
        ("20/10/206", None),  # caso real da proposta 0002
        ("2026-02-30", None),
        ("0206-10-20", None),
        ("", None),
        ("2026-1-5", None),
        ("2026-10-205", None),
        ("2026-10-20T00:00", None),
        ("5/10/2026", None),
    ],
)
def test_data(texto, esperado):
    assert data(texto) == esperado


def test_dividir_em_parcelas_fecha_centavos():
    v = dividir_em_parcelas(8999.0, 3)
    assert v == [2999.67, 2999.67, 2999.66]
    assert round(sum(v), 2) == 8999.0
    assert dividir_em_parcelas(9000.0, 3) == [3000.0, 3000.0, 3000.0]


def test_plano_de_tabela_valido():
    assert validar(plano_ok(), 89990.0, TABELA_PF["valor_total"]) == []


def test_entrada_obrigatoria():
    erros = validar(plano_ok(sinal=None), 89990.0, 89990.0)
    assert any("entrada é obrigatória" in e for e in erros)


def test_forma_meio_e_data_da_entrada_obrigatorios():
    erros = validar(plano_ok(sinal_forma=None, sinal_meio=None, sinal_vencimento=None), 89990.0, 89990.0)
    texto = " ".join(erros)
    assert "de uma vez ou parcelada" in texto
    assert "como a entrada será paga" in texto
    assert "data de pagamento da entrada" in texto


def test_soma_nao_fecha():
    # caso real da proposta 0003: "5x de R$ 1.798,00" num lote de R$ 89.990,00
    erros = validar(plano_ok(dividido_em_parcelas=5, valor_parcela="1.798,00"), 89990.0, 89990.0)
    assert any("A soma não fecha" in e for e in erros)


def test_valor_com_digitos_faltando_bloqueia():
    # caso real da proposta 0003: R$ 89,99 em vez de R$ 89.990,00
    erros = validar(plano_ok(valor_proposto=89.99), 89.99, 89990.0)
    assert any("muito diferente do valor de tabela" in e for e in erros)


def test_valor_fora_da_tabela_exige_confirmacao():
    fp = plano_ok(valor_proposto=85000.0, valor_parcela="670,00", dividido_em_parcelas=100, chave_valor="9.000,00",
                  sinal="9.000,00")
    erros = validar(fp, 85000.0, 89990.0)
    assert any("Marque a confirmação de valor diferente da tabela" in e for e in erros)
    assert validar({**fp, "confirma_valor_fora_tabela": True}, 85000.0, 89990.0) == []


def test_ano_invalido_bloqueia():
    erros = validar(plano_ok(primeiro_mes="0206-10-20"), 89990.0, 89990.0)
    assert any("1ª parcela mensal" in e for e in erros)


def test_primeira_parcela_antes_da_entrada():
    erros = validar(plano_ok(primeiro_mes="2026-10-01"), 89990.0, 89990.0)
    assert any("não pode vencer antes" in e for e in erros)


def test_entrada_parcelada():
    fp = plano_ok(sinal_forma="parcelada", sinal_parcelas=3, sinal_meio="boleto")
    assert validar(fp, 89990.0, 89990.0) == []
    p = ler_plano(fp)
    assert p.entrada_valores == [2999.67, 2999.67, 2999.66]
    erros = validar(plano_ok(sinal_forma="parcelada", sinal_parcelas=1), 89990.0, 89990.0)
    assert any("em quantas vezes" in e for e in erros)


def test_a_vista():
    fp = {"a_vista": True, "renda": "10000", "valor_proposto": 89990.0, "avista_meio": "transferencia",
          "avista_data": "2026-10-10", "confirmado": True}
    assert validar(fp, 89990.0, 89990.0) == []
    assert any("como o pagamento à vista" in e for e in validar({**fp, "avista_meio": None}, 89990.0, 89990.0))


def test_confirmacao_final_obrigatoria():
    erros = validar(plano_ok(confirmado=False), 89990.0, 89990.0)
    assert any("confirmação final" in e for e in erros)


def test_valor_proposto_divergente_do_plano():
    erros = validar(plano_ok(), 89000.0, 89990.0)
    assert any("não bate com o valor proposto da proposta" in e for e in erros)


def test_normalizar_e_resumo():
    fp = normalizar(plano_ok(sinal="8.999", valor_parcela="719.92", renda="7000", sinal_forma="parcelada", sinal_parcelas=3,
                             primeiro_mes="10/11/2026"))
    assert fp["sinal"] == "8.999,00"
    assert fp["valor_parcela"] == "719,92"
    assert fp["renda"] == "7.000,00"
    assert fp["primeiro_mes"] == "2026-11-10"
    assert fp["vencimento"] == "10"
    assert fp["sinal_valor_parcela"] == "2.999,67"
    assert resumo(fp) == "Entrada R$ 8.999,00 em 3x + 100x de R$ 719,92 + chave R$ 8.999,00"
    avista = normalizar({"a_vista": True, "valor_proposto": 80000.0, "avista_meio": "pix", "avista_data": "2026-10-10",
                         "sinal": "1.000,00", "dividido_em_parcelas": 3})
    assert avista["sinal"] is None and avista["dividido_em_parcelas"] is None
    assert resumo(avista) == "À vista: R$ 80.000,00 via PIX em 10/10/2026"


def test_soma_tem_que_bater_no_centavo():
    # 16 centavos de arredondamento do plano de tabela já não passam: o
    # formulário ajusta na chave antes de enviar
    erros = validar(plano_ok(chave_valor="8.998,84"), 89990.0, 89990.0)
    assert any("A soma não fecha" in e for e in erros)


def test_todos_os_lotes_de_tabela_fecham():
    """Os lotes reais seguem entrada + n x parcela + chave = total (conferido
    no banco em 02/10); amostra dos dois empreendimentos."""
    for vt, e, pm, q, en in [(89990.0, 8999.0, 719.92, 100, 8999.0), (260355.20, 26035.52, 2082.84, 100, 26035.68)]:
        fp = plano_ok(valor_proposto=vt, sinal=fmt_brl(e), valor_parcela=fmt_brl(pm), dividido_em_parcelas=q,
                      chave_valor=fmt_brl(en))
        assert validar(fp, vt, vt) == [], (vt, validar(fp, vt, vt))


def test_valor_digitado_em_formato_invalido_tem_mensagem_propria():
    erros = validar(plano_ok(sinal="8,999.00"), 89990.0, 89990.0)
    assert any("Valor da entrada inválido" in e for e in erros)
    erros = validar(plano_ok(chave_valor="oito mil"), 89990.0, 89990.0)
    assert any("Valor da chave inválido" in e for e in erros)


def test_renda_em_texto_livre_pede_numero():
    erros = validar(plano_ok(renda="7 mil"), 89990.0, 89990.0)
    assert any("renda mensal" in e for e in erros)


def test_aprovacao_nao_recompara_com_tabela_atual():
    # proposta negociada com desconto e confirmada; depois a tabela do lote mudou
    fp = normalizar(plano_ok(valor_proposto=80000.0, dividido_em_parcelas=100, valor_parcela="620,01",
                             chave_valor="9.000,00", confirma_valor_fora_tabela=True))
    lote_novo = {**TABELA_PF, "valor_total": 120000.0}
    assert problemas_para_aprovar(fp, 80000.0, lote_novo) == []


def test_aprovacao_recusa_plano_gravado_inconsistente():
    fp = normalizar(plano_ok())
    fp["valor_parcela"] = "700,00"  # alguém mexeu no banco
    assert any("soma não fecha" in e for e in problemas_para_aprovar(fp, 89990.0, TABELA_PF))


def test_conferir_contrato_casos_reais():
    # 0001/0002: antigas, fecham com a chave do lote
    leg = {"a_vista": False, "sinal": "8.999", "dividido_em_parcelas": 100, "valor_parcela": "719,92",
           "primeiro_mes": "20/10/2026"}
    assert conferir_contrato(leg, 89990.0, TABELA_PF) == []
    # 0003: R$ 89,99 e 5x 1.798,00
    leg3 = {**leg, "dividido_em_parcelas": 5, "valor_parcela": "1.798,00", "primeiro_mes": "02/10/2026"}
    assert any("não fecha" in e for e in conferir_contrato(leg3, 89.99, TABELA_PF))
    # sem forma de pagamento nenhuma (qualificação pelo link): plano de tabela do lote
    assert conferir_contrato({}, 89990.0, TABELA_PF) == []
    assert any("não fecha" in e for e in conferir_contrato({}, 80000.0, TABELA_PF))
    # data de 1ª parcela inválida no texto antigo
    assert any("inválida" in e for e in conferir_contrato({**leg, "primeiro_mes": "20/10/206"}, 89990.0, TABELA_PF))
    # à vista: nada a somar
    assert conferir_contrato({"a_vista": True, "avista_meio": "pix", "avista_data": "2026-10-10"}, 80000.0, TABELA_PF) == []
    # formulário novo: chave do próprio plano
    assert conferir_contrato(normalizar(plano_ok()), 89990.0, TABELA_PF) == []
