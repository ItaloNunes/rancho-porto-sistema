"""Conferência dos dados cadastrais da proposta (comprador, cônjuge,
contatos) -- o que vai pro QUADRO RESUMO do contrato além da forma de
pagamento.

Por que existe (03/10): o financeiro passou a poder corrigir os dados da
proposta antes de aprovar (PUT /crm/propostas/{id}/dados). Correção sem
conferência só troca um erro por outro -- caso real da proposta 0003: o
celular do comprador estava preenchido com o e-mail dele. Mesmas regras de
frontend/src/lib/cadastro.ts (o navegador avisa na hora, o servidor confere
de novo antes de gravar).

Só confere o que estiver PREENCHIDO (CPF, celular, e-mail, nascimento); o
que é obrigatório ou não continua sendo decidido pelo formulário (cadastro
rápido deixa documentos/endereço pra depois)."""

from __future__ import annotations

import re
from datetime import date
from typing import Optional

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def so_digitos(texto: Optional[str]) -> str:
    return re.sub(r"\D", "", texto or "")


def cpf_valido(texto: Optional[str]) -> bool:
    d = so_digitos(texto)
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        dv = (soma * 10) % 11 % 10
        if dv != int(d[n]):
            return False
    return True


def cnpj_valido(texto: Optional[str]) -> bool:
    d = so_digitos(texto)
    if len(d) != 14 or d == d[0] * 14:
        return False
    for n in (12, 13):
        pesos = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] if n == 12 else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        soma = sum(int(d[i]) * pesos[i] for i in range(n))
        dv = 0 if soma % 11 < 2 else 11 - soma % 11
        if dv != int(d[n]):
            return False
    return True


def cpf_cnpj_valido(texto: Optional[str]) -> bool:
    d = so_digitos(texto)
    return cpf_valido(d) if len(d) <= 11 else cnpj_valido(d)


def telefone_valido(texto: Optional[str]) -> bool:
    """DDD + número: 10 (fixo) ou 11 (celular) dígitos, sem letras/@."""
    if not texto or "@" in texto or re.search(r"[A-Za-z]", texto):
        return False
    return len(so_digitos(texto)) in (10, 11)


def email_valido(texto: Optional[str]) -> bool:
    return bool(texto) and bool(_EMAIL_RE.match(texto.strip()))


def data_nascimento_valida(texto: Optional[str]) -> bool:
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", (texto or "").strip())
    if not m:
        return False
    try:
        d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return False
    return date(1900, 1, 1) <= d <= date.today()


def _preenchido(v) -> bool:
    return isinstance(v, str) and bool(v.strip())


def _pessoa(p: dict, quem: str) -> list[str]:
    erros: list[str] = []
    if _preenchido(p.get("cpf_cnpj")) and not cpf_cnpj_valido(p["cpf_cnpj"]):
        erros.append(f"CPF/CNPJ {quem} inválido ({p['cpf_cnpj']}) -- confira os dígitos.")
    if _preenchido(p.get("email")) and not email_valido(p["email"]):
        erros.append(f"E-mail {quem} inválido ({p['email']}).")
    if _preenchido(p.get("data_nascimento")) and not data_nascimento_valida(p["data_nascimento"]):
        erros.append(f"Data de nascimento {quem} inválida.")
    return erros


ESTADOS_COM_CONJUGE = ("casado", "uniao_estavel")

# O mínimo pra qualificar o cônjuge/companheiro(a) no contrato (bloco
# "B – COMPRADORA" do Rancho Texas) e pros documentos dele(a).
CAMPOS_CONJUGE = (
    ("nome", "nome"),
    ("cpf_cnpj", "CPF"),
    ("rg", "RG"),
    ("data_nascimento", "data de nascimento"),
    ("nacionalidade", "nacionalidade"),
    ("profissao", "profissão"),
)


def tem_conjuge(dados: Optional[dict]) -> bool:
    """Se o comprador tem cônjuge/companheiro(a) que entra no contrato.
    Resposta direta do formulário (tem_conjuge, 03/10); proposta antiga, sem
    essa resposta, decide pelo estado civil (casado/união estável)."""
    dados = dados or {}
    if dados.get("tem_conjuge") is not None:
        return bool(dados.get("tem_conjuge"))
    return dados.get("estado_civil") in ESTADOS_COM_CONJUGE


def problemas_conjuge(dados: Optional[dict]) -> list[str]:
    """Coerência entre a resposta "tem cônjuge?" e o estado civil, e dados
    mínimos do cônjuge quando ele existe. Vale até no cadastro rápido: sem
    isso o contrato do Rancho Texas sairia sem a COMPRADORA."""
    dados = dados or {}
    erros: list[str] = []
    estado = dados.get("estado_civil")
    resposta = dados.get("tem_conjuge")
    if resposta is True and estado not in ESTADOS_COM_CONJUGE:
        erros.append("Comprador com cônjuge/companheiro(a): o estado civil tem que ser Casado(a) ou União estável.")
    if resposta is False and estado in ESTADOS_COM_CONJUGE:
        erros.append("Estado civil Casado(a)/União estável, mas foi informado que o comprador não tem cônjuge -- confira.")
    if tem_conjuge(dados):
        conjuge = dados.get("conjuge") or {}
        faltando = [rotulo for campo, rotulo in CAMPOS_CONJUGE if not _preenchido(conjuge.get(campo))]
        if faltando:
            erros.append("Faltam dados do cônjuge/companheiro(a): " + ", ".join(faltando) + ".")
    return erros


def problemas_cadastro(dados: Optional[dict]) -> list[str]:
    dados = dados or {}
    erros: list[str] = []
    proponente = dados.get("proponente") or {}
    if not _preenchido(proponente.get("nome")):
        erros.append("Informe o nome completo do comprador.")
    erros += _pessoa(proponente, "do comprador")
    erros += problemas_conjuge(dados)
    if tem_conjuge(dados):
        erros += _pessoa(dados.get("conjuge") or {}, "do cônjuge")
    for campo, rotulo in (
        ("telefone_celular", "Celular"),
        ("telefone_residencial", "Telefone residencial"),
        ("telefone_comercial", "Telefone comercial"),
        ("telefone_recados", "Telefone para recados"),
    ):
        v = dados.get(campo)
        if _preenchido(v) and not telefone_valido(v):
            erros.append(f"{rotulo} inválido ({v}) -- informe DDD + número (10 ou 11 dígitos).")
    return erros
