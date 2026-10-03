"""Contrato e recibo: preenchimento a partir do plano de pagamento e
conversão pra PDF (app/docx_pdf.py).

O teste mais importante aqui é o de equivalência de texto: o PDF gerado
pelo nosso conversor tem que ter EXATAMENTE as mesmas palavras, na mesma
ordem, que o LibreOffice produz a partir do mesmo .docx (referência de
fidelidade). Nada pode sumir do texto jurídico nem ser inventado. Roda
quando o LibreOffice (soffice) está instalado na máquina de teste."""

import io
import re
import shutil
import subprocess
import tempfile
from datetime import date
from pathlib import Path

import docx
import pytest
from pypdf import PdfReader

from app.docx_pdf import docx_para_pdf
from app.documentos_gerados import preencher_contrato_porto_franco, preencher_contrato_rancho_texas, preencher_recibo

LOTE_PF = {"identificador": "LOTE 08 - QUADRA 10", "lote_numero": 8, "quadra": "10", "tamanho_m2": 200.0,
           "valor_total": 89990.0, "entrada": 8999.0, "entrega": 8999.0, "parcela_mensal": 719.92, "qtd_parcelas": 100}
LOTE_RT = {"identificador": "LOTE 012", "lote_numero": 12, "quadra": "12", "tamanho_m2": 810.84,
           "valor_total": 227035.20, "entrada": 22703.52, "entrega": 22703.68, "parcela_mensal": 1816.28, "qtd_parcelas": 100}
CLIENTE = {"nome": "Maria Teste da Silva", "cpf": "01147332444"}
CORRETOR = {"nome": "Corretor Teste", "cpf_cnpj": "12345678909", "creci": "1234", "banco": "Caixa", "agencia": "0001",
            "conta": "12345-6"}


def dq(fp, casado=False):
    d = {
        "proponente": {"nome": "Maria Teste da Silva", "cpf_cnpj": "01147332444", "rg": "123", "orgao_expedidor": "SSP/RN",
                       "nacionalidade": "brasileira", "profissao": "Analista", "data_nascimento": "1981-11-01"},
        "estado_civil": "casado" if casado else "solteiro",
        "endereco_residencial": {"rua": "Rua A", "numero": "10", "bairro": "Centro", "cidade": "Mossoró", "estado": "RN",
                                 "cep": "59600000"},
        "forma_pagamento": fp,
    }
    if casado:
        d["conjuge"] = {"nome": "João Teste", "cpf_cnpj": "52998224725", "rg": "456", "nacionalidade": "brasileiro",
                        "profissao": "Médico", "data_nascimento": "1980-01-01"}
    return d


def fp_unica(lote):
    return {"a_vista": False, "renda": "7.000,00", "valor_proposto": lote["valor_total"],
            "sinal": f"{lote['entrada']:.2f}".replace(".", ","), "sinal_forma": "unica", "sinal_meio": "pix",
            "sinal_vencimento": "2026-10-05", "dividido_em_parcelas": 100,
            "valor_parcela": f"{lote['parcela_mensal']:.2f}".replace(".", ","), "primeiro_mes": "2026-11-10",
            "vencimento": "10", "chave_valor": f"{lote['entrega']:.2f}".replace(".", ","), "confirmado": True}


FP_PARCELADA = {**fp_unica(LOTE_PF), "sinal_forma": "parcelada", "sinal_parcelas": 3, "sinal_meio": "boleto"}
FP_AVISTA = {"a_vista": True, "renda": "10.000,00", "valor_proposto": 89990.0, "avista_meio": "transferencia",
             "avista_data": "2026-10-10", "confirmado": True}
# proposta antiga (antes do formulário de 02/10), igual à 0002 do Lucas
FP_LEGADO = {"renda": "7000", "sinal": "8.999", "a_vista": False, "vencimento": "20", "primeiro_mes": "20/10/2026",
             "valor_parcela": "719,92", "valor_proposto": 89990.0, "dividido_em_parcelas": 100}


def proposta(fp, lote=LOTE_PF, casado=False):
    return {"numero": 99, "valor_proposto": fp.get("valor_proposto") or lote["valor_total"],
            "dados_qualificacao": dq(fp, casado)}


def texto_docx(b: bytes) -> str:
    d = docx.Document(io.BytesIO(b))
    partes = [p.text for p in d.paragraphs]
    for t in d.tables:
        for r in t.rows:
            for c in r.cells:
                partes.append(c.text)
    return re.sub(r"\s+", " ", " ".join(partes))


def texto_pdf(b: bytes) -> str:
    r = PdfReader(io.BytesIO(b))
    return re.sub(r"\s+", " ", " ".join(p.extract_text() or "" for p in r.pages))


def pf(fp, **kw):
    return preencher_contrato_porto_franco(proposta=proposta(fp), lote=LOTE_PF, cliente=CLIENTE, corretor=CORRETOR,
                                           valor_comissao=4499.5, data_contrato=date(2026, 10, 2), **kw)


def rt(fp, casado=False):
    return preencher_contrato_rancho_texas(proposta=proposta(fp, LOTE_RT, casado), lote=LOTE_RT, cliente=CLIENTE,
                                           data_contrato=date(2026, 10, 2))


# ------------------------------------------------------------------ Porto Franco
def test_pf_entrada_unica():
    t = texto_docx(pf(fp_unica(LOTE_PF)))
    assert ("Entrada / Arras confirmatórias: R$ 8.999,00 (oito mil novecentos e noventa e nove reais), "
            "paga via PIX em 05/10/2026") in t
    assert ("Parcelas mensais: 100 (cem) parcelas mensais e sucessivas de R$ 719,92 (setecentos e dezenove reais e "
            "noventa e dois centavos) cada, vencendo a primeira em 10/11/2026, dia 10") in t
    assert "Chave: R$ 8.999,00 (oito mil novecentos e noventa e nove reais), a ser paga na entrega das chaves." in t
    assert "Maria Teste da Silva" in t and "011.473.324-44" in t


def test_pf_entrada_parcelada():
    t = texto_docx(pf(FP_PARCELADA))
    assert ("paga em 3 (três) parcelas mensais, 2 (duas) de R$ 2.999,67 (dois mil novecentos e noventa e nove "
            "reais e sessenta e sete centavos) e 1 (uma) de R$ 2.999,66 (dois mil novecentos e noventa e nove reais e "
            "sessenta e seis centavos), via boleto bancário, vencendo a primeira em 05/10/2026") in t


def test_pf_a_vista():
    t = texto_docx(pf(FP_AVISTA))
    assert ("Entrada / Arras confirmatórias: R$ 89.990,00 (oitenta e nove mil novecentos e noventa reais), "
            "correspondente ao pagamento à vista do preço, via transferência bancária (TED), em 10/10/2026") in t
    assert "Parcelas mensais: não há (pagamento à vista)." in t
    assert "Chave: não há (pagamento à vista)." in t
    assert "719,92" not in t  # nada do plano de tabela vaza pra venda à vista


def test_pf_legado_continua_funcionando():
    t = texto_docx(pf(FP_LEGADO))
    assert "Entrada / Arras confirmatórias: R$ 8.999,00 (oito mil novecentos e noventa e nove reais)" in t
    assert "vencendo a primeira em 20/10/2026, dia 20" in t
    assert "R$ 9,00" not in t


def test_pf_nome_na_assinatura_com_mesma_fonte_do_cpf():
    d = docx.Document(io.BytesIO(pf(fp_unica(LOTE_PF))))
    nome, cpf = d.paragraphs[313], d.paragraphs[314]
    assert nome.text == "Maria Teste da Silva"
    assert nome.runs[0]._r.rPr.xml == cpf.runs[0]._r.rPr.xml


# ------------------------------------------------------------------ Rancho Texas
def test_rt_entrada_unica_e_chave():
    t = texto_docx(rt({**fp_unica(LOTE_RT), "chave_vencimento": "2030-09-30"}))
    assert ("Sinal/Arras confirmatórias: R$ 22.703,52 (vinte e dois mil setecentos e três reais e cinquenta e dois "
            "centavos) sendo pago via PIX para o dia 05/10/2026.") in t
    assert "Chave: R$ 22.703,68 (vinte e dois mil setecentos e três reais e sessenta e oito centavos) a ser pago até 30/09/2030." in t
    assert "XX" not in t and "08/09/2026" not in t and "20.175,40" not in t
    # medidas de exemplo de outro lote não podem sair no contrato (PDF não se edita)
    for exemplo in ("720,55", "Alameda Georgia", "lote 82", "37,14m", "38,04m"):
        assert exemplo not in t
    assert "__________m de frente com" in t


def test_rt_a_vista():
    fp = {**FP_AVISTA, "valor_proposto": 227035.20}
    t = texto_docx(rt(fp))
    assert "Parcelas: não há (pagamento à vista)." in t
    assert "Chave: não há (pagamento à vista)." in t


def test_rt_casado_tem_compradora():
    t = texto_docx(rt(fp_unica(LOTE_RT), casado=True))
    assert "João Teste" in t and "529.982.247-25" in t


# ------------------------------------------------------------------ PDF
@pytest.mark.parametrize(
    "nome,gerar,trechos",
    [
        ("pf_unica", lambda: pf(fp_unica(LOTE_PF)), ["paga via PIX em 05/10/2026", "CONTRATO Nº 0099/2026"]),
        ("pf_avista", lambda: pf(FP_AVISTA), ["correspondente ao pagamento à vista do preço"]),
        ("rt_parcelada", lambda: rt({**fp_unica(LOTE_RT), "sinal_forma": "parcelada", "sinal_parcelas": 2}),
         ["sendo pago em 2 (duas) parcelas mensais de R$ 11.351,76"]),
        ("recibo_pf", lambda: preencher_recibo(condominio_nome="Porto Franco Residencial", cliente_nome="Maria Teste",
                                               cliente_cpf="01147332444", valor=8999.0, lote_quadra="10",
                                               lote_numero="8", data=date(2026, 10, 2))[0],
         ["R$ 8.999,00", "011.473.324-44", "02 de Outubro de 2026"]),
        ("recibo_rt", lambda: preencher_recibo(condominio_nome="Rancho Texas", cliente_nome="Maria Teste",
                                               cliente_cpf="01147332444", valor=8999.0, lote_quadra=None,
                                               lote_numero="LOTE 012", data=date(2026, 10, 2))[0],
         ["R$ 8.999,00", "LOTE 012"]),
    ],
)
def test_pdf_tem_o_conteudo(nome, gerar, trechos):
    b = gerar()
    pdf = docx_para_pdf(b)
    assert pdf[:5] == b"%PDF-"
    t = texto_pdf(pdf)
    for trecho in trechos:
        assert trecho in t, (nome, trecho)


def _tokens(texto: str) -> list[str]:
    return re.findall(r"\w+|[^\w\s]", texto)


def _sem_numeros_de_pagina(tokens: list[str]) -> list[str]:
    return [t for t in tokens if not t.isdigit() or len(t) > 2]


@pytest.mark.skipif(not shutil.which("soffice"), reason="LibreOffice não instalado")
@pytest.mark.parametrize(
    "gerar",
    [
        lambda: pf(fp_unica(LOTE_PF)),
        lambda: pf(FP_PARCELADA),
        lambda: rt(fp_unica(LOTE_RT), casado=True),
        lambda: preencher_recibo(condominio_nome="Rancho Texas", cliente_nome="Maria Teste", cliente_cpf="01147332444",
                                 valor=8999.0, lote_quadra=None, lote_numero="LOTE 012", data=date(2026, 10, 2))[0],
        lambda: preencher_recibo(condominio_nome="Porto Franco", cliente_nome="Maria Teste", cliente_cpf="01147332444",
                                 valor=1234567.89, lote_quadra="10", lote_numero="8", data=date(2026, 10, 2))[0],
    ],
)
def test_pdf_tem_exatamente_o_texto_do_libreoffice(gerar):
    b = gerar()
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "doc.docx"
        src.write_bytes(b)
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, str(src)],
                       check=True, capture_output=True, timeout=180)
        ref = (Path(tmp) / "doc.pdf").read_bytes()
    esperado = _sem_numeros_de_pagina(_tokens(texto_pdf(ref)))
    obtido = _sem_numeros_de_pagina(_tokens(texto_pdf(docx_para_pdf(b))))
    assert obtido == esperado


# ------------------------------------------------------------------ cônjuge / naturalidade (03/10)
def test_rt_uniao_estavel_entra_como_compradora_com_naturalidade():
    d = dq(fp_unica(LOTE_RT), casado=True)
    d["estado_civil"] = "uniao_estavel"
    d["tem_conjuge"] = True
    d["proponente"]["naturalidade"] = "Mossoró/RN"
    d["conjuge"]["naturalidade"] = "Natal/RN"
    prop = {"numero": 99, "valor_proposto": LOTE_RT["valor_total"], "dados_qualificacao": d}
    t = texto_docx(preencher_contrato_rancho_texas(proposta=prop, lote=LOTE_RT, cliente=CLIENTE, data_contrato=date(2026, 10, 2)))
    assert "João Teste" in t and "529.982.247-25" in t
    assert "União estável" in t
    assert "LOCAL: Mossoró/RN" in t and "LOCAL: Natal/RN" in t


def test_rt_sem_conjuge_respondido_nao_tem_compradora():
    d = dq(fp_unica(LOTE_RT), casado=True)
    d["tem_conjuge"] = False  # resposta direta manda (dados de cônjuge esquecidos não entram)
    prop = {"numero": 99, "valor_proposto": LOTE_RT["valor_total"], "dados_qualificacao": d}
    t = texto_docx(preencher_contrato_rancho_texas(proposta=prop, lote=LOTE_RT, cliente=CLIENTE, data_contrato=date(2026, 10, 2)))
    assert "João Teste" not in t


def test_pf_local_de_nascimento():
    d = dq(fp_unica(LOTE_PF))
    d["proponente"]["naturalidade"] = "Mossoró/RN"
    prop = {"numero": 99, "valor_proposto": LOTE_PF["valor_total"], "dados_qualificacao": d}
    t = texto_docx(preencher_contrato_porto_franco(proposta=prop, lote=LOTE_PF, cliente=CLIENTE, corretor=CORRETOR,
                                                   valor_comissao=0, data_contrato=date(2026, 10, 2)))
    assert "LOCAL: Mossoró/RN" in t
    # sem naturalidade: continua em branco, como sempre foi
    assert "LOCAL: Mossoró" not in texto_docx(pf(fp_unica(LOTE_PF)))
