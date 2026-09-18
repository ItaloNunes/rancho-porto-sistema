"""Importação de planilha de lotes (painel, só admin — ver
routers/condominios.py::preview_importacao_lotes/confirmar_importacao_lotes).

Cobre o caso de venda/reserva feita fora do sistema: o admin mantém sua
própria planilha de controle (mesmas colunas de sempre: quadra, lote,
status) e sobe ela aqui de vez em quando pra refletir no painel, em vez de
marcar lote por lote na mão. Só o status é lido daqui — tamanho/valores
continuam só pela tabela oficial do empreendimento (ver reset_e_atualizacao.sql).

Aceita .xlsx ou .csv, com cabeçalhos flexíveis (maiúsculo/minúsculo, com ou
sem acento, alguns sinônimos comuns) — ver _ALIASES_* abaixo.
"""

import csv
import io
import unicodedata
from typing import Optional

from fastapi import HTTPException, UploadFile

# Planilha de lotes é pequena (o maior empreendimento tem ~440 linhas) —
# 5MB já é bem mais que suficiente e evita segurar um upload gigante por engano.
MAX_TAMANHO_BYTES = 5 * 1024 * 1024

_ALIASES_QUADRA = {"quadra", "q", "qd"}
_ALIASES_LOTE = {"lote", "lotenumero", "numerodolote", "numero", "nlote", "nolote", "n", "no", "num"}
_ALIASES_STATUS = {"status", "situacao"}

_STATUS_MAP = {
    "disponivel": "disponivel",
    "disponible": "disponivel",
    "livre": "disponivel",
    "reservado": "reservado",
    "reservada": "reservado",
    "vendido": "vendido",
    "vendida": "vendido",
}


def _normalizar(texto: object) -> str:
    """minúsculo, sem acento, sem espaço nas pontas — pra casar cabeçalho ou
    valor de status escrito de qualquer jeito (maiúsculo, com acento etc.)."""
    bruto = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode("ascii")
    return bruto.strip().lower()


def _chave_cabecalho(texto: object) -> str:
    return _normalizar(texto).replace(" ", "").replace("_", "").replace(".", "").replace("º", "").replace("°", "")


def _mapear_colunas(cabecalho: list) -> dict[str, int]:
    """Acha em que coluna está quadra/lote/status pelo nome do cabeçalho."""
    indices: dict[str, int] = {}
    for i, nome in enumerate(cabecalho):
        chave = _chave_cabecalho(nome)
        if chave in _ALIASES_QUADRA and "quadra" not in indices:
            indices["quadra"] = i
        elif chave in _ALIASES_LOTE and "lote" not in indices:
            indices["lote"] = i
        elif chave in _ALIASES_STATUS and "status" not in indices:
            indices["status"] = i
    return indices


def _status_de(valor: object) -> Optional[str]:
    return _STATUS_MAP.get(_normalizar(valor))


def _normalizar_quadra(bruto: object, lote_numero: int) -> str:
    """Quadra vem em branco em empreendimentos onde ela é o próprio número
    do lote (ex.: Rancho Texas) — cai pro número do lote nesse caso. Excel
    às vezes manda número de quadra como float ("8.0") — normaliza pra "8"."""
    texto = str(bruto).strip() if bruto not in (None, "") else ""
    if not texto:
        return str(lote_numero)
    if texto.endswith(".0"):
        texto = texto[:-2]
    return texto


def _ler_csv(conteudo: bytes) -> list[list]:
    texto = None
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            texto = conteudo.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if texto is None:
        raise HTTPException(422, "Não consegui ler o CSV — verifique a codificação do arquivo.")
    amostra = texto[:2048]
    separador = ";" if amostra.count(";") > amostra.count(",") else ","
    leitor = csv.reader(io.StringIO(texto), delimiter=separador)
    return [linha for linha in leitor]


def _ler_xlsx(conteudo: bytes) -> list[list]:
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(500, "Suporte a .xlsx não está instalado no servidor.")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(422, "Não consegui abrir o arquivo — confira se é um .xlsx válido (não corrompido).")
    ws = wb.active
    return [["" if c is None else c for c in row] for row in ws.iter_rows(values_only=True)]


async def ler_planilha(arquivo: UploadFile) -> list[dict]:
    """Lê um .xlsx ou .csv de importação e devolve uma lista de
    {quadra, lote_numero, status} — uma por linha reconhecida. Linhas em
    branco ou com status ilegível são simplesmente ignoradas (não interrompem
    o import inteiro); só erros que impedem ler o arquivo todo (formato
    errado, coluna obrigatória faltando) levantam HTTPException."""
    conteudo = await arquivo.read()
    if not conteudo:
        raise HTTPException(400, "Arquivo vazio.")
    if len(conteudo) > MAX_TAMANHO_BYTES:
        raise HTTPException(413, "Arquivo muito grande — envie até 5MB.")

    nome = (arquivo.filename or "").lower()
    if nome.endswith(".csv"):
        linhas_brutas = _ler_csv(conteudo)
    elif nome.endswith(".xlsx") or nome.endswith(".xlsm"):
        linhas_brutas = _ler_xlsx(conteudo)
    else:
        raise HTTPException(422, "Formato não reconhecido — envie um arquivo .xlsx ou .csv.")

    linhas_brutas = [linha for linha in linhas_brutas if any(str(c).strip() for c in linha)]
    if not linhas_brutas:
        raise HTTPException(422, "A planilha está vazia.")

    cabecalho, *corpo = linhas_brutas
    indices = _mapear_colunas(cabecalho)
    faltando = {"lote", "status"} - indices.keys()
    if faltando:
        raise HTTPException(
            422,
            "Não encontrei a coluna de "
            + " e ".join(sorted(faltando))
            + " na planilha. Confira se a primeira linha tem os cabeçalhos (ex.: Quadra, Lote, Status).",
        )

    resultado = []
    for linha in corpo:
        if indices["lote"] >= len(linha) or indices["status"] >= len(linha):
            continue
        lote_bruto = linha[indices["lote"]]
        if str(lote_bruto).strip() == "":
            continue
        try:
            lote_numero = int(float(str(lote_bruto).strip().replace(",", ".")))
        except ValueError:
            continue
        status = _status_de(linha[indices["status"]])
        if status is None:
            continue
        quadra_bruta = linha[indices["quadra"]] if "quadra" in indices and indices["quadra"] < len(linha) else None
        quadra = _normalizar_quadra(quadra_bruta, lote_numero)
        resultado.append({"quadra": quadra, "lote_numero": lote_numero, "status": status})
    return resultado
