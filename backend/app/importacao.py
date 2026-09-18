"""Importação de planilha de lotes (painel, só admin — ver
routers/condominios.py::preview_importacao_lotes/confirmar_importacao_lotes).

Cobre o caso de venda/reserva feita fora do sistema: o admin mantém sua
própria planilha/tabela de controle e sobe ela aqui de vez em quando pra
refletir no painel, em vez de marcar lote por lote na mão. Só o status é
lido daqui — tamanho/valores continuam só pela tabela oficial do
empreendimento (ver reset_e_atualizacao.sql).

Aceita três formatos:
- .xlsx/.csv com colunas Quadra, Lote, Status (cabeçalho flexível — ver
  _ALIASES_* abaixo);
- .pdf — a própria tabela oficial da construtora (mesmo arquivo que vem por
  WhatsApp/e-mail), onde o status NÃO é texto: é só a cor de fundo da linha
  inteira (vermelho = vendido, amarelo = reservado, sem cor = disponível).
  Ver ler_planilha_pdf abaixo.
"""

import csv
import io
import unicodedata
from collections import Counter
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


# Nas duas tabelas oficiais (Rancho Texas, Porto Franco) o número da
# quadra/lote fica sempre nos primeiros ~140pt da página — é essa faixa que
# a amostragem de pixel usa pra descobrir a cor de fundo da linha.
_LARGURA_COLUNA_IDENTIFICACAO_PT = 140
_DPI_RENDER_PDF = 150


def _classificar_cor_linha(rgb: tuple[int, int, int]) -> str:
    """Vermelho = vendido, amarelo = reservado, qualquer outra cor (inclui
    "sem cor", já que quem chama filtra preto/branco antes) = disponível."""
    r, g, b = rgb
    if r > 200 and g < 100 and b < 100:
        return "vendido"
    if r > 200 and g > 200 and b < 100:
        return "reservado"
    return "disponivel"


def ler_planilha_pdf(conteudo: bytes, tem_quadra_propria: bool) -> list[dict]:
    """Lê a tabela oficial em PDF do jeito que a construtora manda: o status
    não vem como texto, só como a COR DE FUNDO da linha inteira. Processo:
    1) pdfplumber acha onde cada linha começa/termina e qual quadra/lote ela
       é (pelas palavras); 2) PyMuPDF renderiza a página como imagem e a
       gente amostra os pixels dessa faixa da linha pra achar a cor de fundo
       predominante (ignorando preto de texto/borda e branco de fundo).

    `tem_quadra_propria` diz se esse empreendimento tem quadra separada do
    número do lote (Porto Franco: duas colunas) ou se quadra == número do
    lote (Rancho Texas: uma coluna só) — quem chama decide isso olhando os
    lotes já cadastrados desse condomínio (ver preview_importacao_lotes)."""
    try:
        import pymupdf
    except ImportError:
        raise HTTPException(500, "Suporte a PDF não está instalado no servidor.")
    try:
        import pdfplumber
    except ImportError:
        raise HTTPException(500, "Suporte a PDF não está instalado no servidor.")
    try:
        from PIL import Image
    except ImportError:
        raise HTTPException(500, "Suporte a PDF não está instalado no servidor.")

    try:
        doc_imagens = pymupdf.open(stream=conteudo, filetype="pdf")
    except Exception:
        raise HTTPException(422, "Não consegui abrir o PDF — confira se o arquivo não está corrompido.")

    resultado: list[dict] = []
    try:
        try:
            pdf = pdfplumber.open(io.BytesIO(conteudo))
        except Exception:
            raise HTTPException(422, "Não consegui abrir o PDF — confira se o arquivo não está corrompido.")
        with pdf:
            escala = _DPI_RENDER_PDF / 72
            for indice, page in enumerate(pdf.pages):
                if indice >= len(doc_imagens):
                    break
                palavras = page.extract_words()
                pix = doc_imagens[indice].get_pixmap(dpi=_DPI_RENDER_PDF)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

                linhas: dict[int, list] = {}
                for w in sorted(palavras, key=lambda w: (round(w["top"]), w["x0"])):
                    chave = round(w["top"] / 3)
                    linhas.setdefault(chave, []).append(w)

                for palavras_linha in linhas.values():
                    palavras_linha.sort(key=lambda w: w["x0"])
                    numeros = [
                        w
                        for w in palavras_linha
                        if w["text"].replace(",", "").replace(".", "").isdigit()
                        and w["x0"] < _LARGURA_COLUNA_IDENTIFICACAO_PT
                    ]
                    if not numeros:
                        continue
                    if tem_quadra_propria:
                        if len(numeros) < 2:
                            continue
                        quadra_txt, lote_txt = numeros[0]["text"], numeros[1]["text"]
                        ultima_palavra = numeros[1]
                    else:
                        quadra_txt = lote_txt = numeros[0]["text"]
                        ultima_palavra = numeros[0]
                    try:
                        lote_numero = int(lote_txt)
                        # A tabela em PDF imprime a quadra com zero à esquerda
                        # ("01", "08"...) mas o banco guarda sem ("1", "8"...)
                        # — sem isso a quadra nunca bate e a linha vira
                        # "não encontrado" à toa.
                        quadra = str(int(quadra_txt))
                    except ValueError:
                        continue

                    topo = min(w["top"] for w in palavras_linha)
                    base = max(w["bottom"] for w in palavras_linha)
                    cy = (topo + base) / 2 * escala
                    x_ini = int(numeros[0]["x0"] * escala) - 5
                    x_fim = int(ultima_palavra["x1"] * escala) + 5

                    cores = Counter()
                    for x in range(x_ini, x_fim, 2):
                        for dy in (-3, 0, 3):
                            y = int(cy + dy)
                            if 0 <= x < img.width and 0 <= y < img.height:
                                cores[img.getpixel((x, y))] += 1

                    melhor, melhor_contagem = None, 0
                    for cor, n in cores.items():
                        r, g, b = cor
                        if r < 80 and g < 80 and b < 80:  # texto/borda (preto)
                            continue
                        if r > 240 and g > 240 and b > 240:  # fundo branco (sem tingimento)
                            continue
                        if n > melhor_contagem:
                            melhor_contagem, melhor = n, cor

                    status = _classificar_cor_linha(melhor) if melhor else "disponivel"
                    resultado.append({"quadra": quadra, "lote_numero": lote_numero, "status": status})
    finally:
        doc_imagens.close()

    return resultado


async def ler_planilha(arquivo: UploadFile, tem_quadra_propria: bool = False) -> list[dict]:
    """Lê a planilha/tabela de importação e devolve uma lista de
    {quadra, lote_numero, status} — uma por linha reconhecida. Linhas em
    branco ou com status ilegível são simplesmente ignoradas (não interrompem
    o import inteiro); só erros que impedem ler o arquivo todo (formato
    errado, coluna obrigatória faltando) levantam HTTPException.

    `tem_quadra_propria` só é usado pra .pdf (ver ler_planilha_pdf) — o
    .xlsx/.csv já traz a quadra na própria coluna (ou cai pro número do lote
    quando não tem, via _normalizar_quadra)."""
    conteudo = await arquivo.read()
    if not conteudo:
        raise HTTPException(400, "Arquivo vazio.")
    if len(conteudo) > MAX_TAMANHO_BYTES:
        raise HTTPException(413, "Arquivo muito grande — envie até 5MB.")

    nome = (arquivo.filename or "").lower()
    if nome.endswith(".pdf"):
        return ler_planilha_pdf(conteudo, tem_quadra_propria)
    if nome.endswith(".csv"):
        linhas_brutas = _ler_csv(conteudo)
    elif nome.endswith(".xlsx") or nome.endswith(".xlsm"):
        linhas_brutas = _ler_xlsx(conteudo)
    else:
        raise HTTPException(422, "Formato não reconhecido — envie um arquivo .xlsx, .csv ou .pdf.")

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
