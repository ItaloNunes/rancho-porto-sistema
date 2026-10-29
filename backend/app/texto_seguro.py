"""Texto que chega dos formulários e vai para os PDFs (contrato, recibo,
proposta) sem sumir no caminho.

Por que existe (29/10, contrato do lote 06 da quadra 4 do Porto Franco): o
nome do cliente não saiu nem no QUADRO RESUMO nem na assinatura. O gerador de
PDF APAGA, sem avisar, qualquer caractere que a fonte não tenha. Nome colado
do WhatsApp/Instagram em letra "estilizada" (𝐌𝐀𝐑𝐈𝐀, 𝑱𝒐𝒔𝒆́, ＭＡＲＩＡ), com
espaço invisível (U+200B, U+FEFF) ou com acento solto (a + ́) some inteiro ou
sai pela metade.

- `ajustar_para_fonte`: troca SÓ o que a fonte não tem pela forma simples
  equivalente (NFKC: 𝐌 -> M, Ｍ -> M), junta acentos soltos, tira
  caracteres invisíveis de formatação. O que a fonte tem fica como está
  (º, ², –, “” do texto jurídico continuam iguais).
- `limpar_nome`: nome de pessoa normalizado (mesmas trocas + espaços
  repetidos/nas pontas), usado na gravação e na hora de preencher.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

_FONTS_DIR = Path(__file__).parent / "assets" / "fonts"

# Espaços "esquisitos" que viram espaço normal (sem quebra, fino, ideográfico...)
_ESPACOS = {" ", " ", " ", " ", " ", " ", " ", " ",
            " ", " ", " ", " ", " ", " ", "　"}
_HIFENS = {"‐": "-", "‑": "-"}


@lru_cache(maxsize=None)
def cobertura_fontes(arquivos: tuple[str, ...]) -> frozenset[int]:
    """Caracteres presentes em TODAS as fontes da lista (o que sobra sai em
    qualquer estilo: normal, negrito, itálico)."""
    from fontTools.ttLib import TTFont

    comum: Optional[set[int]] = None
    for arq in arquivos:
        cmap = set(TTFont(arq, lazy=True).getBestCmap().keys())
        comum = cmap if comum is None else comum & cmap
    return frozenset(comum or ())


def cobertura_padrao() -> frozenset[int]:
    """Fontes usadas na conversão dos contratos/recibos (docx_pdf)."""
    return cobertura_fontes(tuple(sorted(str(p) for p in _FONTS_DIR.glob("*.ttf"))))


def _simplificar(c: str, cabe) -> str:
    if unicodedata.category(c) == "Cf":  # invisível (zero-width, BOM, marcas de direção)
        return ""
    if c in _ESPACOS:
        return " "
    if c in _HIFENS:
        return _HIFENS[c]
    n = unicodedata.normalize("NFKC", c)
    if n and all(cabe(x) for x in n):
        return n
    # último recurso: tira o acento (letra com acento que a fonte não tem)
    base = "".join(x for x in unicodedata.normalize("NFKD", n or c) if not unicodedata.combining(x))
    if base and all(cabe(x) for x in base):
        return base
    return c


def ajustar_para_fonte(texto: str, cabe) -> str:
    """`cabe(ch) -> bool`: a fonte tem esse caractere?"""
    if not texto:
        return texto
    texto = unicodedata.normalize("NFC", texto)
    if all(cabe(c) for c in texto):
        return texto
    return "".join(c if cabe(c) else _simplificar(c, cabe) for c in texto)


def ajustar_para_cobertura(texto: str, cobertura: Iterable[int]) -> str:
    cob = cobertura if isinstance(cobertura, (set, frozenset)) else frozenset(cobertura)
    return ajustar_para_fonte(texto, lambda c: ord(c) in cob or c in "\n\t")


def ajustar_para_latin1(texto: str) -> str:
    """Para as fontes padrão do PDF (Helvetica, latin-1): mesma ideia."""
    def cabe(c: str) -> bool:
        return ord(c) < 256 and unicodedata.category(c) != "Cf"
    return ajustar_para_fonte(texto, cabe)


def limpar_nome(nome: Optional[str]) -> str:
    """'  𝐌𝐀𝐑𝐈𝐀​  DA   SILVA ' -> 'MARIA DA SILVA'. Vazio -> ''."""
    if not nome:
        return ""
    s = "".join(_simplificar(c, lambda x: False) if (unicodedata.category(c) == "Cf" or c in _ESPACOS)
                else c for c in str(nome))
    s = unicodedata.normalize("NFKC", s)
    s = "".join(c for c in s if unicodedata.category(c) not in ("Cf", "Cc"))
    return re.sub(r"\s+", " ", s).strip()
