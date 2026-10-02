"""Plano de pagamento da proposta: leitura, normalização e validação.

Por que existe (pedido de 02/10): a forma de pagamento era um monte de
campos de texto livre (sinal, parcelas, "1ª parcela em"...) sem nenhuma
conferência entre eles. Resultado real em produção: entrada "8.999" lida
como R$ 9,00, 1ª parcela "20/10/206", proposta de R$ 89,99 em vez de
R$ 89.990,00, e um resumo "100x de R$ 719,92" que não batia com "5x de
R$ 1.798,00" nos campos. Tudo isso foi parar no contrato.

Agora a proposta só é criada se o plano fechar:

    entrada + (nº de parcelas x valor da parcela) + chave = valor proposto

(no centavo), com entrada obrigatória (valor, forma
-- pagamento único ou parcelada --, meio e data), datas de verdade (nada de
ano "206") e confirmação explícita do corretor. A mesma regra roda no
navegador (frontend/src/lib/pagamento.ts) pra avisar na hora, e aqui no
servidor pra garantir que nada inconsistente seja gravado, mesmo que
alguém chame a API direto.

Todos os 661 lotes cadastrados seguem exatamente essa soma no plano de
tabela (conferido no banco em 02/10), então a regra não barra nenhuma
venda legítima.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

MEIOS_PAGAMENTO = {
    "pix": "PIX",
    "transferencia": "transferência bancária (TED)",
    "boleto": "boleto bancário",
    "cheque": "cheque",
    "dinheiro": "dinheiro",
}

# Valor proposto pode ser diferente da tabela (desconto negociado), mas fora
# dessa faixa é quase certamente dígito a mais/a menos -- bloqueia.
LIMITE_INFERIOR_TABELA = 0.5
LIMITE_SUPERIOR_TABELA = 1.5
MAX_PARCELAS_ENTRADA = 24
MAX_PARCELAS = 480
ANO_MIN, ANO_MAX = 2020, 2100


# --------------------------------------------------------------------------
# Valores e datas
# --------------------------------------------------------------------------

# Formatos aceitos (depois de tirar "R$" e espaços) -- os MESMOS de
# frontend/src/lib/pagamento.ts::lerValor:
#   8.999 / 8.999,00 / 1.234.567,8   (milhar com ponto, centavos com vírgula)
#   8999 / 8999,5 / 8999,50          (sem milhar, centavos com vírgula)
#   8999.5 / 8999.50                 (centavos com ponto, 1 ou 2 casas)
# Qualquer outra coisa ("8,999.00", "333,333", "1e3", "nan", "8999.",
# ",5", "1_000", negativo) é inválida -- melhor recusar e pedir pra digitar
# de novo do que adivinhar e o contrato sair com valor errado.
_RE_MILHAR_BR = re.compile(r"\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?")
_RE_SIMPLES_BR = re.compile(r"\d+(?:,\d{1,2})?")
_RE_DECIMAL_PONTO = re.compile(r"\d+\.\d{1,2}")


def normalizar_valor_br(texto: str) -> str:
    """'R$ 8.999,00' / '8.999' / '8999.50' / '8999,50' -> '8999.00' / '8999' /
    '8999.50' / '8999.50' (string pronta pro float()). Ponto seguido de
    EXATAMENTE 3 dígitos é separador de milhar no padrão brasileiro ("8.999" =
    oito mil novecentos e noventa e nove) -- antes isso virava 8,999 e o
    contrato da proposta 0002 saiu com "Entrada: R$ 9,00" (achado em 02/10).
    Formato não reconhecido -> "" (float("") levanta ValueError)."""
    limpo = str(texto).strip().replace("R$", "")
    limpo = re.sub(r"\s", "", limpo)
    if _RE_MILHAR_BR.fullmatch(limpo):
        return limpo.replace(".", "").replace(",", ".")
    if _RE_SIMPLES_BR.fullmatch(limpo):
        return limpo.replace(",", ".")
    if _RE_DECIMAL_PONTO.fullmatch(limpo):
        return limpo
    return ""


def valor(texto) -> Optional[float]:
    """Texto/número -> float (ou None se vazio/inválido)."""
    if texto is None or texto == "" or isinstance(texto, bool):
        return None
    if isinstance(texto, (int, float)):
        v = float(texto)
        return v if math.isfinite(v) else None
    try:
        return float(normalizar_valor_br(str(texto)))
    except ValueError:
        return None


def fmt_brl(v: Optional[float]) -> str:
    """8999.5 -> '8.999,50' (sem o 'R$')."""
    if v is None:
        return "-"
    return f"{v:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


_RE_DATA_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_RE_DATA_BR = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def data(texto) -> Optional[date]:
    """'AAAA-MM-DD' (input date do navegador) ou 'DD/MM/AAAA' -> date, só se
    for uma data real com ano entre 2020 e 2100 (pega "20/10/206"). Formato
    exato -- "2026-1-5" ou "2026-10-205" são inválidos (mesma regra de
    frontend/src/lib/pagamento.ts::lerData)."""
    if not texto or not isinstance(texto, str):
        return None
    s = texto.strip()
    m = _RE_DATA_ISO.fullmatch(s)
    if m:
        a, mes, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = _RE_DATA_BR.fullmatch(s)
        if not m:
            return None
        d, mes, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (ANO_MIN <= a <= ANO_MAX):
        return None
    try:
        return date(a, mes, d)
    except ValueError:
        return None


def fmt_data(d: Optional[date]) -> str:
    return d.strftime("%d/%m/%Y") if d else "-"


def dividir_em_parcelas(total: float, n: int) -> list[float]:
    """Divide em n parcelas de centavos iguais; o resto do arredondamento vai
    nas primeiras (ex.: 8.999,00 em 3 = 2.999,67 + 2.999,67 + 2.999,66)."""
    centavos = round(total * 100)
    base = centavos // n
    valores = [base] * n
    # distribui o resto (se houver) nas primeiras, igual boleto bancário
    resto = centavos - base * n
    for i in range(resto):
        valores[i] += 1
    return [v / 100 for v in valores]


# --------------------------------------------------------------------------
# Plano lido do formulário
# --------------------------------------------------------------------------

@dataclass
class Plano:
    a_vista: Optional[bool]
    valor_proposto: Optional[float]
    renda: Optional[float]
    # à vista
    avista_meio: Optional[str] = None
    avista_data: Optional[date] = None
    # entrada
    entrada: Optional[float] = None
    entrada_forma: Optional[str] = None  # "unica" | "parcelada"
    entrada_parcelas: int = 1
    entrada_meio: Optional[str] = None
    entrada_data: Optional[date] = None
    # parcelas mensais
    parcelas: Optional[int] = None
    parcela_valor: Optional[float] = None
    primeira_parcela: Optional[date] = None
    primeira_parcela_texto: Optional[str] = None  # legado (texto livre)
    dia_vencimento: Optional[str] = None
    # chave
    chave: Optional[float] = None
    chave_data: Optional[date] = None
    # metadado
    estruturado: bool = False  # True = proposta feita no formulário novo (02/10)
    erros: list = field(default_factory=list)

    @property
    def entrada_valores(self) -> list[float]:
        if not self.entrada:
            return []
        n = self.entrada_parcelas if self.entrada_forma == "parcelada" else 1
        return dividir_em_parcelas(self.entrada, max(1, n))

    @property
    def total_calculado(self) -> float:
        if self.a_vista:
            return self.valor_proposto or 0.0
        return (self.entrada or 0.0) + (self.parcelas or 0) * (self.parcela_valor or 0.0) + (self.chave or 0.0)


def ler_plano(fp: Optional[dict]) -> Plano:
    """Lê o plano de forma tolerante (propostas antigas, feitas antes do
    formulário novo, também passam por aqui na hora de gerar contrato)."""
    fp = fp or {}
    try:
        parcelas = int(fp.get("dividido_em_parcelas")) if fp.get("dividido_em_parcelas") not in (None, "") else None
    except (TypeError, ValueError):
        parcelas = None
    try:
        n_entrada = int(fp.get("sinal_parcelas") or 1) if fp.get("sinal_forma") == "parcelada" else 1
    except (TypeError, ValueError):
        n_entrada = 1
    primeira_txt = fp.get("primeiro_mes")
    return Plano(
        a_vista=fp.get("a_vista"),
        valor_proposto=valor(fp.get("valor_proposto")),
        renda=valor(fp.get("renda")),
        avista_meio=fp.get("avista_meio"),
        avista_data=data(fp.get("avista_data")),
        entrada=valor(fp.get("sinal")),
        entrada_forma=fp.get("sinal_forma"),
        entrada_parcelas=max(1, n_entrada),
        entrada_meio=fp.get("sinal_meio"),
        entrada_data=data(fp.get("sinal_vencimento")),
        parcelas=parcelas,
        parcela_valor=valor(fp.get("valor_parcela")),
        primeira_parcela=data(primeira_txt),
        primeira_parcela_texto=primeira_txt,
        dia_vencimento=(str(fp.get("vencimento")).strip() if fp.get("vencimento") not in (None, "") else None),
        chave=valor(fp.get("chave_valor")),
        chave_data=data(fp.get("chave_vencimento")),
        estruturado=bool(fp.get("sinal_forma") or fp.get("avista_meio")),
    )


def tolerancia(plano: Plano) -> float:
    """A soma tem que bater no centavo: o contrato lista entrada, parcelas e
    chave E o preço total, e os dois precisam fechar. (O plano de tabela de
    alguns lotes tem centavos de arredondamento -- o formulário já ajusta
    isso na chave, ver frontend planoDeTabela/ajuste de centavos.)"""
    return 0.005


FORMATO_VALOR = "digite só o número em reais, no formato 8.999,00."


def _invalido(fp: dict, chave: str) -> bool:
    """Campo preenchido mas que não é um valor em reais reconhecível (ex.:
    "8,999.00", "oito mil") -- diferente de vazio, que tem outra mensagem."""
    bruto = fp.get(chave)
    return bruto not in (None, "") and valor(bruto) is None


def validar(fp: Optional[dict], valor_proposto: Optional[float], valor_tabela: Optional[float]) -> list[str]:
    """Regras do formulário novo -- lista de problemas em português (vazia =
    tudo certo). Mesmas regras de frontend/src/lib/pagamento.ts."""
    fp = fp or {}
    p = ler_plano(fp)
    erros: list[str] = []
    vp = valor_proposto if valor_proposto is not None else p.valor_proposto

    if not vp or vp <= 0:
        erros.append("Informe o valor proposto.")
        return erros
    if p.valor_proposto is not None and abs(p.valor_proposto - vp) > 0.005:
        erros.append("O valor proposto da forma de pagamento não bate com o valor proposto da proposta.")
    if not p.renda or p.renda <= 0:
        erros.append("Informe a renda mensal do cliente em reais (ex.: 7.000,00).")

    if valor_tabela:
        razao = vp / valor_tabela
        if razao < LIMITE_INFERIOR_TABELA or razao > LIMITE_SUPERIOR_TABELA:
            erros.append(
                f"O valor proposto (R$ {fmt_brl(vp)}) está muito diferente do valor de tabela do lote "
                f"(R$ {fmt_brl(valor_tabela)}). Confira se não faltou ou sobrou algum dígito."
            )
        elif abs(vp - valor_tabela) > 1.0 and not fp.get("confirma_valor_fora_tabela"):
            erros.append(
                f"O valor proposto (R$ {fmt_brl(vp)}) é diferente do valor de tabela (R$ {fmt_brl(valor_tabela)}). "
                "Marque a confirmação de valor diferente da tabela."
            )

    if p.a_vista is None:
        erros.append("Escolha se o pagamento é à vista ou parcelado.")
    elif p.a_vista:
        if p.avista_meio not in MEIOS_PAGAMENTO:
            erros.append("Informe como o pagamento à vista será feito (PIX, transferência, boleto, cheque ou dinheiro).")
        if not p.avista_data:
            erros.append("Informe a data do pagamento à vista (dia/mês/ano).")
    else:
        if _invalido(fp, "sinal"):
            erros.append(f"Valor da entrada inválido: {FORMATO_VALOR}")
        elif not p.entrada or p.entrada <= 0:
            erros.append("A entrada é obrigatória: informe o valor da entrada.")
        elif p.entrada >= vp:
            erros.append("A entrada não pode ser igual ou maior que o valor proposto -- se for tudo de uma vez, escolha \"À vista\".")
        if p.entrada_forma not in ("unica", "parcelada"):
            erros.append("Informe se a entrada será paga de uma vez ou parcelada.")
        elif p.entrada_forma == "parcelada":
            n_bruto = fp.get("sinal_parcelas")
            try:
                n_ok = 2 <= int(n_bruto) <= MAX_PARCELAS_ENTRADA
            except (TypeError, ValueError):
                n_ok = False
            if not n_ok:
                erros.append(f"Entrada parcelada: informe em quantas vezes (de 2 a {MAX_PARCELAS_ENTRADA}).")
        if p.entrada_meio not in MEIOS_PAGAMENTO:
            erros.append("Informe como a entrada será paga (PIX, transferência, boleto, cheque ou dinheiro).")
        if not p.entrada_data:
            erros.append(
                "Informe a data de pagamento da entrada (dia/mês/ano)."
                if p.entrada_forma != "parcelada"
                else "Informe a data da 1ª parcela da entrada (dia/mês/ano)."
            )
        if not p.parcelas or not (1 <= p.parcelas <= MAX_PARCELAS):
            erros.append(f"Informe a quantidade de parcelas mensais (de 1 a {MAX_PARCELAS}).")
        if _invalido(fp, "valor_parcela"):
            erros.append(f"Valor da parcela mensal inválido: {FORMATO_VALOR}")
        elif not p.parcela_valor or p.parcela_valor <= 0:
            erros.append("Informe o valor de cada parcela mensal.")
        if not p.primeira_parcela:
            erros.append("Informe a data da 1ª parcela mensal (dia/mês/ano).")
        elif p.entrada_data and p.primeira_parcela < p.entrada_data:
            erros.append("A 1ª parcela mensal não pode vencer antes do pagamento da entrada.")
        if _invalido(fp, "chave_valor"):
            erros.append(f"Valor da chave inválido: {FORMATO_VALOR}")
        if fp.get("chave_vencimento") and not p.chave_data:
            erros.append("Data da chave inválida (use dia/mês/ano).")
        if not erros:
            total = p.total_calculado
            if abs(total - vp) > tolerancia(p):
                erros.append(
                    f"A soma não fecha: entrada R$ {fmt_brl(p.entrada)} + {p.parcelas} x R$ {fmt_brl(p.parcela_valor)}"
                    f" + chave R$ {fmt_brl(p.chave or 0)} = R$ {fmt_brl(total)}, mas o valor proposto é "
                    f"R$ {fmt_brl(vp)} (diferença de R$ {fmt_brl(abs(total - vp))})."
                )

    if not fp.get("confirmado"):
        erros.append("Falta a confirmação final: marque que conferiu todos os valores com o cliente.")
    return erros


def normalizar(fp: dict) -> dict:
    """Grava os valores sempre no mesmo formato ('8.999,00', datas
    AAAA-MM-DD) e preenche os campos derivados (dia de vencimento, valor de
    cada parcela da entrada), pra PDF/contrato/listas lerem tudo igual."""
    out = dict(fp)
    p = ler_plano(fp)
    for chave in ("sinal", "valor_parcela", "chave_valor", "renda"):
        v = valor(fp.get(chave))
        if v is not None:
            out[chave] = fmt_brl(v)
    for chave, d in (("avista_data", p.avista_data), ("sinal_vencimento", p.entrada_data),
                     ("primeiro_mes", p.primeira_parcela), ("chave_vencimento", p.chave_data)):
        if d:
            out[chave] = d.isoformat()
    if p.primeira_parcela:
        out["vencimento"] = str(p.primeira_parcela.day)
    if p.a_vista:
        # à vista não tem entrada/parcelas -- limpa resto de digitação anterior
        for chave in ("sinal", "sinal_forma", "sinal_parcelas", "sinal_meio", "sinal_vencimento",
                      "sinal_valor_parcela", "dividido_em_parcelas", "valor_parcela", "vencimento",
                      "primeiro_mes", "chave_valor", "chave_vencimento"):
            out[chave] = None
    elif p.entrada_forma == "parcelada" and p.entrada:
        out["sinal_valor_parcela"] = fmt_brl(p.entrada_valores[0])
    else:
        out["sinal_parcelas"] = 1 if p.entrada_forma == "unica" else out.get("sinal_parcelas")
        out["sinal_valor_parcela"] = None
    return out


def resumo(fp: Optional[dict]) -> str:
    """Resumo de uma linha (vai em propostas.condicoes_pagamento, nas listas
    e no PDF) -- sempre gerado do plano, nunca digitado à parte."""
    p = ler_plano(fp)
    if p.a_vista:
        meio = MEIOS_PAGAMENTO.get(p.avista_meio or "", "")
        return f"À vista: R$ {fmt_brl(p.valor_proposto)}" + (f" via {meio}" if meio else "") + \
            (f" em {fmt_data(p.avista_data)}" if p.avista_data else "")
    partes = []
    if p.entrada:
        if p.entrada_forma == "parcelada" and p.entrada_parcelas > 1:
            partes.append(f"Entrada R$ {fmt_brl(p.entrada)} em {p.entrada_parcelas}x")
        else:
            partes.append(f"Entrada R$ {fmt_brl(p.entrada)}")
    if p.parcelas and p.parcela_valor:
        partes.append(f"{p.parcelas}x de R$ {fmt_brl(p.parcela_valor)}")
    if p.chave:
        partes.append(f"chave R$ {fmt_brl(p.chave)}")
    return " + ".join(partes) or "A combinar"


@dataclass
class ValoresContrato:
    """Exatamente os números que vão pro QUADRO RESUMO do contrato (mesma
    fonte que documentos_gerados._textos_pagamento usa pra escrever)."""
    a_vista: bool
    entrada: Optional[float]
    parcelas: Optional[int]
    parcela_valor: Optional[float]
    chave: float
    primeira_parcela: Optional[date]
    primeira_parcela_texto: Optional[str]

    @property
    def total(self) -> float:
        return (self.entrada or 0.0) + (self.parcelas or 0) * (self.parcela_valor or 0.0) + (self.chave or 0.0)


def valores_contrato(fp: Optional[dict], lote: Optional[dict]) -> ValoresContrato:
    """Proposta do formulário novo: tudo vem do plano dela. Proposta antiga
    (ou sem forma de pagamento): o que faltar cai pro plano de tabela do
    lote, e a chave é sempre a 'entrega' do lote -- como sempre foi."""
    p = ler_plano(fp)
    lote = lote or {}
    if p.a_vista:
        return ValoresContrato(True, None, None, None, 0.0, None, None)
    try:
        qtd = p.parcelas or (int(lote["qtd_parcelas"]) if lote.get("qtd_parcelas") else None)
    except (TypeError, ValueError):
        qtd = None
    return ValoresContrato(
        a_vista=False,
        entrada=p.entrada or valor(lote.get("entrada")),
        parcelas=qtd,
        parcela_valor=p.parcela_valor or valor(lote.get("parcela_mensal")),
        chave=(p.chave or 0.0) if p.estruturado else (valor(lote.get("entrega")) or 0.0),
        primeira_parcela=p.primeira_parcela,
        primeira_parcela_texto=p.primeira_parcela_texto,
    )


def conferir_contrato(fp: Optional[dict], valor_total: Optional[float], lote: Optional[dict]) -> list[str]:
    """Última trava, antes de emitir o contrato (e na aprovação): os números
    que VÃO ser impressos têm que fechar com o preço impresso, no centavo.
    Vale pra qualquer proposta, venha de onde vier (formulário novo,
    proposta antiga, qualificação pelo link público)."""
    problemas: list[str] = []
    if not valor_total or valor_total <= 0:
        return ["A proposta não tem valor."]
    v = valores_contrato(fp, lote)
    if v.a_vista:
        return problemas
    if not v.entrada or v.entrada <= 0:
        problemas.append("A proposta não tem o valor da entrada.")
    if not v.parcelas or not v.parcela_valor:
        problemas.append("A proposta não tem a quantidade e o valor das parcelas mensais.")
    if v.primeira_parcela_texto and not v.primeira_parcela:
        problemas.append(f"A data da 1ª parcela (\"{v.primeira_parcela_texto}\") é inválida.")
    if not problemas and abs(v.total - valor_total) > 0.005:
        problemas.append(
            f"A forma de pagamento não fecha: entrada R$ {fmt_brl(v.entrada)} + {v.parcelas} x "
            f"R$ {fmt_brl(v.parcela_valor)} + chave R$ {fmt_brl(v.chave)} = R$ {fmt_brl(v.total)}, "
            f"mas o preço da proposta é R$ {fmt_brl(valor_total)} (diferença de R$ {fmt_brl(abs(v.total - valor_total))})."
        )
    return problemas


def problemas_para_aprovar(fp: Optional[dict], valor_proposto: Optional[float], lote: Optional[dict]) -> list[str]:
    """Trava da aprovação: proposta cuja forma de pagamento não fecha não
    vira contrato.

    - Formulário novo: confere de novo o plano GRAVADO (entrada, meios,
      datas, soma, confirmação do corretor). NÃO compara de novo com o valor
      de tabela atual do lote -- isso já foi conferido (e confirmado pelo
      corretor) na criação; se a tabela mudar depois, a proposta já
      negociada continua valendo.
    - Proposta antiga / sem plano: valor perto da tabela (pega dígito a
      mais/a menos) e os números do contrato fechando com o preço."""
    fp = fp or {}
    lote = lote or {}
    p = ler_plano(fp)
    vp = valor_proposto or p.valor_proposto
    if p.estruturado:
        return validar(fp, vp, None) or conferir_contrato(fp, vp, lote)
    problemas: list[str] = []
    vt = valor(lote.get("valor_total"))
    if vp and vt and not (LIMITE_INFERIOR_TABELA <= vp / vt <= LIMITE_SUPERIOR_TABELA):
        problemas.append(
            f"O valor proposto (R$ {fmt_brl(vp)}) está muito diferente do valor de tabela do lote (R$ {fmt_brl(vt)})."
        )
    return problemas + conferir_contrato(fp, vp, lote)
