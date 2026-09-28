"""Geração do recibo (e, futuramente, do contrato) preenchendo os modelos
.docx enviados pela imobiliária — nunca reescrevendo o texto jurídico à mão,
pra não arriscar errar uma cláusula ou uma condição legal. Só troca os
valores de exemplo do modelo (nome, CPF, valor, lote, data) pelos dados
reais da proposta. Pedido em 28/09.
"""

import io
from datetime import date
from pathlib import Path
from typing import Optional

import docx

_TEMPLATES_DIR = Path(__file__).parent / "templates" / "contratos"

_MESES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

_UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"]
_DEZ_A_DEZENOVE = [
    "dez", "onze", "doze", "treze", "quatorze", "quinze",
    "dezesseis", "dezessete", "dezoito", "dezenove",
]
_DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_CENTENAS = [
    "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
    "seiscentos", "setecentos", "oitocentos", "novecentos",
]


def _grupo_extenso(n: int) -> str:
    """0-999 -> texto, sem nome de escala (mil/milhão/etc). n==0 -> ''."""
    if n == 0:
        return ""
    centena, resto = divmod(n, 100)
    partes = []
    if centena:
        partes.append("cem" if n == 100 else _CENTENAS[centena])
    if resto:
        if resto < 10:
            partes.append(_UNIDADES[resto])
        elif resto < 20:
            partes.append(_DEZ_A_DEZENOVE[resto - 10])
        else:
            dezena, unidade = divmod(resto, 10)
            partes.append(_DEZENAS[dezena] + (f" e {_UNIDADES[unidade]}" if unidade else ""))
    return " e ".join(partes)


def _numero_extenso(n: int) -> str:
    """Número inteiro (>=0) por extenso, sempre no masculino -- "real(is)" e
    "centavo(s)" nunca pedem forma feminina, então não precisa tratar gênero.
    Grupos de milhar unidos só por espaço (sem vírgula nem "e" entre grupos)
    -- é a mesma convenção já usada nos modelos de recibo/contrato da
    imobiliária (ex.: "sessenta e nove mil novecentos e noventa reais", sem
    vírgula antes de "novecentos" -- ver CONTRATO_PORTO_FRANCO.docx, item VI)."""
    if n == 0:
        return "zero"
    escalas = [(10**9, "bilhão", "bilhões"), (10**6, "milhão", "milhões"), (10**3, "mil", "mil")]
    partes = []
    resto = n
    for valor_escala, singular, plural in escalas:
        grupo, resto = divmod(resto, valor_escala)
        if not grupo:
            continue
        if valor_escala == 10**3 and grupo == 1:
            partes.append("mil")  # "mil", nunca "um mil"
        else:
            partes.append(f"{_grupo_extenso(grupo)} {singular if grupo == 1 else plural}")
    if resto:
        partes.append(_grupo_extenso(resto))
    return " ".join(p for p in partes if p)


def _talvez_de(n: int) -> str:
    """"um milhão DE reais", "dois milhões DE reais" -- mas "um milhão e
    trezentos mil reais" (sem "de") quando sobra algo abaixo do milhão. Regra
    do português formal: só entra "de" quando o número é um milhão/bilhão
    "redondo" (múltiplo exato de 10**6), sem resto nenhum abaixo dele."""
    return " de" if n >= 10**6 and n % 10**6 == 0 else ""


def valor_por_extenso(valor: float) -> str:
    """999.0 -> 'novecentos e noventa e nove reais'; 1999.9 -> 'mil
    novecentos e noventa e nove reais e noventa centavos'; 1000000.0 -> 'um
    milhão de reais'."""
    centavos_totais = round(valor * 100)
    reais, centavos = divmod(centavos_totais, 100)
    partes = []
    if reais > 0:
        partes.append(f"{_numero_extenso(reais)}{_talvez_de(reais)} {'real' if reais == 1 else 'reais'}")
    if centavos > 0:
        partes.append(f"{_numero_extenso(centavos)} {'centavo' if centavos == 1 else 'centavos'}")
    return " e ".join(partes) if partes else "zero reais"


def formatar_valor(valor: float) -> str:
    """1999.9 -> '1.999,90' (sem "R$" -- os modelos já têm o "R$" fixo no texto)."""
    s = f"{valor:,.2f}"
    return s.replace(",", "_").replace(".", ",").replace("_", ".")


def _empreendimento_slug(condominio_nome: str) -> str:
    return "rancho_texas" if "rancho" in (condominio_nome or "").lower() else "porto_franco"


def preencher_recibo(
    *,
    condominio_nome: str,
    cliente_nome: str,
    cliente_cpf: str,
    valor: float,
    lote_quadra: Optional[str],
    lote_numero: str,
    data: Optional[date] = None,
) -> tuple[bytes, str]:
    """Preenche o modelo de recibo (Porto Franco ou Rancho Texas, conforme o
    empreendimento do lote) com os dados reais e devolve (bytes do .docx
    pronto, slug do empreendimento usado). Mantém a redação exata do modelo
    -- só troca os valores de exemplo (nome, CPF, valor, lote, data) pelos
    reais. Os índices de run abaixo foram conferidos direto no XML dos dois
    modelos (ver conversa de 28/09) -- se algum dia o modelo for reeditado no
    Word, esses índices podem mudar e essa função precisa ser conferida de
    novo."""
    data = data or date.today()
    slug = _empreendimento_slug(condominio_nome)
    caminho = _TEMPLATES_DIR / f"recibo_{slug}.docx"
    doc = docx.Document(str(caminho))

    valor_fmt = formatar_valor(valor)
    extenso = valor_por_extenso(valor)
    dia = f"{data.day:02d}"
    mes = _MESES[data.month - 1]
    ano = str(data.year)

    paragrafos = doc.paragraphs

    if slug == "porto_franco":
        corpo = paragrafos[5].runs
        corpo[6].text = valor_fmt
        # run 8 é só "(" + por extenso (sem "reais" -- essa palavra já vem
        # fixa no run 9 "reais) do" no modelo original); só que o extenso já
        # inclui "reais"/"centavos" (pra poder valer sozinho em outros
        # lugares), então aqui o "reais)" fixo do modelo tem que sumir do
        # run 9, senão duplica "reais" quando o valor tem centavos.
        corpo[8].text = f"({extenso}"
        corpo[9].text = ") do"
        corpo[11].text = cliente_nome
        # tab esquisito do modelo original antes de "CPF N°" -- vira espaço
        # normal, sem mudar o texto/sentido.
        corpo[13].text = " CPF N°"
        corpo[15].text = f"{cliente_cpf}, referente"
        corpo[18].text = f"{lote_numero} "
        corpo[21].text = f"{lote_quadra or '-'}."

        data_runs = paragrafos[11].runs
        data_runs[1].text = dia
        data_runs[5].text = mes.capitalize()
        data_runs[6].text = f" de {ano}"
    else:
        corpo = paragrafos[5].runs
        corpo[15].text = f"{valor_fmt} "
        corpo[17].text = extenso  # mesmo motivo do Porto Franco: sem espaço, o ")" do run 18 já vem colado
        corpo[20].text = cliente_nome
        corpo[21].text = f", inscrito no CPF N° {cliente_cpf}"
        corpo[24].text = lote_numero

        data_runs = paragrafos[11].runs
        data_runs[1].text = dia
        data_runs[5].text = mes
        data_runs[7].text = f"de {ano}"

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue(), slug
