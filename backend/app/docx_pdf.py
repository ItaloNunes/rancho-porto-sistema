"""Converte os modelos .docx da imobiliária (contrato e recibo já
preenchidos por documentos_gerados.py) em PDF, sem LibreOffice nem Word.

Por que existe: todo contrato/recibo sai em PDF (pedido em 02/10), e o
servidor (Render, runtime Python nativo) não tem LibreOffice instalado nem
dá pra instalar. Em vez de reescrever o contrato "na mão" num gerador de PDF
(o que arriscaria mudar o texto jurídico), este módulo lê o próprio .docx
(parágrafos, estilos, numeração automática, tabela do QUADRO RESUMO,
bordas, cabeçalho com o logo e número de página no rodapé) e desenha o
mesmo conteúdo com fpdf2. O texto vem exatamente do .docx -- nada é
redigitado aqui.

Cobre o que os 4 modelos usam de fato (conferido no XML em 02/10): estilos
com herança (basedOn) e docDefaults, fontes de tema, negrito/itálico/
sublinhado/cor/realce/caixa alta, alinhamento (inclusive justificado),
recuos, espaçamento antes/depois e entre linhas (auto/exato/mínimo),
numeração automática (a), b)..., 1.1...), tabulações (esquerda/centro/
direita), quebra de página antes do parágrafo, bordas de parágrafo (caixas
de título), tabelas com células mescladas (gridSpan/gridBefore), bordas por
célula, altura mínima/exata de linha, alinhamento vertical e tabela dentro
de célula, imagem inline (logo do cabeçalho) e o campo PAGE do rodapé.

Fontes: Calibri -> Carlito, Arial -> Liberation Sans, Times New Roman ->
Liberation Serif. As três substitutas têm as MESMAS métricas das originais
(mesma largura de cada caractere), então a quebra de linha fica igual à do
Word. Arquivos em app/assets/fonts (licença SIL OFL).

QA: tests/test_docx_pdf.py confere, pros 4 modelos, que toda palavra do
.docx aparece no PDF na mesma ordem (nada some, nada é inventado).
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional

import docx
from docx.oxml.ns import qn
from fontTools.ttLib import TTFont
from fpdf import FPDF

_FONTS_DIR = Path(__file__).parent / "assets" / "fonts"

# família lógica -> prefixo do arquivo .ttf
_FAMILIAS = {
    "carlito": "Carlito",
    "libsans": "LiberationSans",
    "libserif": "LiberationSerif",
}
_ESTILO_ARQUIVO = {"": "Regular", "B": "Bold", "I": "Italic", "BI": "BoldItalic"}

_NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"

_REALCE = {
    "yellow": (255, 255, 0), "green": (0, 255, 0), "cyan": (0, 255, 255), "magenta": (255, 0, 255),
    "blue": (0, 0, 255), "red": (255, 0, 0), "darkBlue": (0, 0, 128), "darkCyan": (0, 128, 128),
    "darkGreen": (0, 128, 0), "darkMagenta": (128, 0, 128), "darkRed": (128, 0, 0),
    "darkYellow": (128, 128, 0), "darkGray": (128, 128, 128), "lightGray": (192, 192, 192),
    "black": (0, 0, 0), "white": (255, 255, 255),
}


def _familia_de(nome: Optional[str]) -> tuple[str, bool]:
    """Nome da fonte no .docx -> (família registrada, força negrito)."""
    n = (nome or "").lower()
    if "arial" in n or "helvetica" in n:
        return "libsans", "negrito" in n or "bold" in n
    if "times" in n:
        return "libserif", False
    return "carlito", False


@lru_cache(maxsize=None)
def _metricas(familia: str) -> tuple[float, float]:
    """(fração de ascendente, fator de altura de linha) -- mesma conta que o
    Word faz pra espaçamento "simples": winAscent+winDescent ou, se maior,
    ascender-descender+lineGap da tabela hhea."""
    f = TTFont(str(_FONTS_DIR / f"{_FAMILIAS[familia]}-Regular.ttf"), lazy=True)
    upem = f["head"].unitsPerEm
    hhea, os2 = f["hhea"], f["OS/2"]
    asc = os2.usWinAscent / upem
    fator = max((os2.usWinAscent + os2.usWinDescent) / upem, (hhea.ascent - hhea.descent + hhea.lineGap) / upem)
    return asc, fator


# --------------------------------------------------------------------------
# Leitura de propriedades (estilos com herança)
# --------------------------------------------------------------------------

def _val(el, attr: str = "val") -> Optional[str]:
    if el is None:
        return None
    return el.get(qn(f"w:{attr}"))


def _on(el) -> Optional[bool]:
    """Propriedade liga/desliga (w:b, w:i...): presente sem val = ligada."""
    if el is None:
        return None
    v = el.get(qn("w:val"))
    return v not in ("0", "false", "off")


@dataclass
class RunProps:
    fonte: Optional[str] = None
    tema: Optional[str] = None
    negrito: Optional[bool] = None
    italico: Optional[bool] = None
    sublinhado: Optional[bool] = None
    tachado: Optional[bool] = None
    caixa_alta: Optional[bool] = None
    tamanho: Optional[float] = None
    cor: Optional[tuple] = None
    realce: Optional[tuple] = None
    oculto: Optional[bool] = None

    def aplicar(self, rpr) -> None:
        if rpr is None:
            return
        rf = rpr.find(qn("w:rFonts"))
        if rf is not None:
            asc = rf.get(qn("w:ascii")) or rf.get(qn("w:hAnsi"))
            tema = rf.get(qn("w:asciiTheme")) or rf.get(qn("w:hAnsiTheme"))
            if tema:
                self.tema, self.fonte = tema, None
            elif asc:
                self.fonte, self.tema = asc, None
        for tag, attr in (("b", "negrito"), ("i", "italico"), ("strike", "tachado"), ("caps", "caixa_alta"),
                          ("vanish", "oculto")):
            v = _on(rpr.find(qn(f"w:{tag}")))
            if v is not None:
                setattr(self, attr, v)
        u = rpr.find(qn("w:u"))
        if u is not None:
            self.sublinhado = (_val(u) or "single") not in ("none", "0")
        sz = _val(rpr.find(qn("w:sz")))
        if sz:
            self.tamanho = int(sz) / 2
        cor = _val(rpr.find(qn("w:color")))
        if cor:
            self.cor = None if cor == "auto" else tuple(int(cor[i:i + 2], 16) for i in (0, 2, 4))
        hl = _val(rpr.find(qn("w:highlight")))
        if hl:
            self.realce = _REALCE.get(hl)

    def copia(self) -> "RunProps":
        return RunProps(**self.__dict__)


@dataclass
class ParaProps:
    alinhamento: str = "left"
    recuo_esq: float = 0.0
    recuo_dir: float = 0.0
    primeira: float = 0.0  # positivo = recuo de 1ª linha; negativo = deslocamento (hanging)
    antes: float = 0.0
    depois: float = 0.0
    linha: Optional[float] = None
    regra: str = "auto"
    num_id: Optional[str] = None
    nivel: int = 0
    quebra_antes: bool = False
    tabs: list = field(default_factory=list)  # [(pos_pt, tipo)]
    bordas: Optional[tuple] = None  # assinatura das bordas do parágrafo (pra agrupar)
    espaco_borda: float = 0.0

    def aplicar(self, ppr, numerado: bool = False) -> None:
        if ppr is None:
            return
        jc = _val(ppr.find(qn("w:jc")))
        if jc:
            self.alinhamento = {"both": "justify", "distribute": "justify", "center": "center", "right": "right",
                                "end": "right"}.get(jc, "left")
        ind = ppr.find(qn("w:ind"))
        if ind is not None:
            for attr, nome in (("left", "recuo_esq"), ("start", "recuo_esq"), ("right", "recuo_dir"), ("end", "recuo_dir")):
                v = ind.get(qn(f"w:{attr}"))
                if v is not None:
                    setattr(self, nome, int(v) / 20)
            fl, hg = ind.get(qn("w:firstLine")), ind.get(qn("w:hanging"))
            if hg is not None:
                self.primeira = -int(hg) / 20
            elif fl is not None:
                self.primeira = int(fl) / 20
        sp = ppr.find(qn("w:spacing"))
        if sp is not None:
            if sp.get(qn("w:before")) is not None:
                self.antes = int(sp.get(qn("w:before"))) / 20
            if sp.get(qn("w:after")) is not None:
                self.depois = int(sp.get(qn("w:after"))) / 20
            if sp.get(qn("w:line")) is not None:
                self.linha = int(sp.get(qn("w:line")))
                self.regra = sp.get(qn("w:lineRule")) or "auto"
        num = ppr.find(qn("w:numPr"))
        if num is not None:
            nid = _val(num.find(qn("w:numId")))
            ilvl = _val(num.find(qn("w:ilvl")))
            if nid is not None:
                self.num_id = None if nid == "0" else nid
            if ilvl is not None:
                self.nivel = int(ilvl)
        pb = _on(ppr.find(qn("w:pageBreakBefore")))
        if pb is not None:
            self.quebra_antes = pb
        tabs = ppr.find(qn("w:tabs"))
        if tabs is not None:
            atuais = {p: t for p, t in self.tabs}
            for tb in tabs.findall(qn("w:tab")):
                pos = int(tb.get(qn("w:pos"))) / 20
                tipo = tb.get(qn("w:val"))
                if tipo == "clear":
                    atuais.pop(pos, None)
                elif tipo in ("left", "start", "center", "right", "end", "decimal", "num"):
                    atuais[pos] = {"start": "left", "end": "right", "decimal": "right"}.get(tipo, tipo)
            self.tabs = sorted(atuais.items())
        bdr = ppr.find(qn("w:pBdr"))
        if bdr is not None:
            lados = {}
            for lado in ("top", "left", "bottom", "right"):
                el = bdr.find(qn(f"w:{lado}"))
                if el is not None:
                    v = _val(el)
                    lados[lado] = v not in (None, "nil", "none")
                    if lados[lado] and el.get(qn("w:space")):
                        self.espaco_borda = max(self.espaco_borda, float(el.get(qn("w:space"))))
            assinatura = tuple(lados.get(l, False) for l in ("top", "left", "bottom", "right"))
            self.bordas = assinatura if any(assinatura) else None

    def copia(self) -> "ParaProps":
        c = ParaProps(**{k: v for k, v in self.__dict__.items() if k != "tabs"})
        c.tabs = list(self.tabs)
        return c


class Estilos:
    def __init__(self, documento):
        part = documento.part
        self.estilos = {}
        st_el = part.styles.element
        self.padrao_par = None
        for s in st_el.findall(qn("w:style")):
            sid = s.get(qn("w:styleId"))
            self.estilos[sid] = s
            if s.get(qn("w:type")) == "paragraph" and s.get(qn("w:default")) in ("1", "true"):
                self.padrao_par = sid
        dd = st_el.find(qn("w:docDefaults"))
        self.rpr_padrao = dd.find(qn("w:rPrDefault") + "/" + qn("w:rPr")) if dd is not None else None
        self.ppr_padrao = dd.find(qn("w:pPrDefault") + "/" + qn("w:pPr")) if dd is not None else None
        # fontes de tema (minorHAnsi etc.)
        self.tema = {"minor": "Calibri", "major": "Calibri"}
        try:
            for rel in part.rels.values():
                if rel.reltype.endswith("/theme"):
                    xml = rel.target_part.blob.decode("utf8")
                    for chave in ("minor", "major"):
                        m = re.search(rf"<a:{chave}Font>\s*<a:latin typeface=\"([^\"]+)\"", xml)
                        if m:
                            self.tema[chave] = m.group(1)
        except Exception:
            pass
        settings = part.settings.element if hasattr(part, "settings") else None
        self.tab_padrao = 35.4  # 708 twips
        if settings is not None:
            dt = settings.find(qn("w:defaultTabStop"))
            if dt is not None and _val(dt):
                self.tab_padrao = int(_val(dt)) / 20

    def cadeia(self, sid: Optional[str]) -> list:
        out, vistos = [], set()
        while sid and sid in self.estilos and sid not in vistos:
            vistos.add(sid)
            s = self.estilos[sid]
            out.append(s)
            sid = _val(s.find(qn("w:basedOn")))
        return list(reversed(out))

    def fonte_tema(self, tema: str) -> str:
        return self.tema["major" if tema.startswith("major") else "minor"]


class Numeracao:
    def __init__(self, documento):
        self.niveis = {}  # num_id -> {ilvl: (fmt, texto, inicio, ppr, rpr)}
        self.contadores = {}
        try:
            numbering = documento.part.numbering_part.element
        except Exception:
            return
        abstratos = {}
        for an in numbering.findall(qn("w:abstractNum")):
            lv = {}
            for l in an.findall(qn("w:lvl")):
                ilvl = int(l.get(qn("w:ilvl")))
                lv[ilvl] = (
                    _val(l.find(qn("w:numFmt"))) or "decimal",
                    _val(l.find(qn("w:lvlText"))) or "",
                    int(_val(l.find(qn("w:start"))) or 1),
                    l.find(qn("w:pPr")),
                    l.find(qn("w:rPr")),
                    _val(l.find(qn("w:suff"))) or "tab",
                )
            abstratos[an.get(qn("w:abstractNumId"))] = lv
        for n in numbering.findall(qn("w:num")):
            nid = n.get(qn("w:numId"))
            base = dict(abstratos.get(_val(n.find(qn("w:abstractNumId"))), {}))
            for ov in n.findall(qn("w:lvlOverride")):
                ilvl = int(ov.get(qn("w:ilvl")))
                so = _val(ov.find(qn("w:startOverride")))
                if so and ilvl in base:
                    f, t, _, p, r, sfx = base[ilvl]
                    base[ilvl] = (f, t, int(so), p, r, sfx)
            self.niveis[nid] = base

    def proximo(self, num_id: str, nivel: int):
        lv = self.niveis.get(num_id, {})
        if nivel not in lv:
            return None
        cont = self.contadores.setdefault(num_id, {})
        cont[nivel] = cont.get(nivel, lv[nivel][2] - 1) + 1
        for k in list(cont):
            if k > nivel:
                del cont[k]
        fmt, texto, _, ppr, rpr, sufixo = lv[nivel]

        def formata(k: int) -> str:
            f = lv.get(k, ("decimal",))[0]
            v = cont.get(k, lv.get(k, (None, None, 1))[2])
            return _formatar_numero(v, f)

        if fmt == "bullet":
            rotulo = "•"
        else:
            rotulo = re.sub(r"%(\d)", lambda m: formata(int(m.group(1)) - 1), texto)
        return rotulo, ppr, rpr, sufixo


def _romano(n: int) -> str:
    vals = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
            (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    out = ""
    for v, s in vals:
        while n >= v:
            out += s
            n -= v
    return out


def _formatar_numero(v: int, fmt: str) -> str:
    if fmt == "lowerLetter":
        return chr(ord("a") + (v - 1) % 26) * ((v - 1) // 26 + 1)
    if fmt == "upperLetter":
        return chr(ord("A") + (v - 1) % 26) * ((v - 1) // 26 + 1)
    if fmt == "lowerRoman":
        return _romano(v)
    if fmt == "upperRoman":
        return _romano(v).upper()
    if fmt == "none":
        return ""
    return str(v)


# --------------------------------------------------------------------------
# Modelo de layout
# --------------------------------------------------------------------------

@dataclass
class Estilo:
    familia: str
    negrito: bool
    italico: bool
    tamanho: float
    sublinhado: bool = False
    tachado: bool = False
    cor: Optional[tuple] = None
    realce: Optional[tuple] = None

    @property
    def fpdf_estilo(self) -> str:
        return ("B" if self.negrito else "") + ("I" if self.italico else "")


@dataclass
class Pedaco:
    """Trecho de texto com um estilo só (ou uma imagem inline)."""
    texto: str
    estilo: Estilo
    largura: float = 0.0
    imagem: Optional[tuple] = None  # (bytes, largura_pt, altura_pt)


@dataclass
class Linha:
    altura: float
    desenhar: Callable  # (pdf, x, y) -> None
    tem_conteudo: bool = True


@dataclass
class Espaco:
    altura: float


@dataclass
class QuebraPagina:
    pass


@dataclass
class Caixa:
    """Bloco com borda/padding que pode quebrar entre páginas (célula de
    linha única da tabela, ou grupo de parágrafos com borda)."""
    filhos: list
    x: float
    largura: float
    pad_top: float = 0.0
    pad_bottom: float = 0.0
    bordas: tuple = (False, False, False, False)  # top, left, bottom, right
    altura_min: float = 0.0
    altura_exata: Optional[float] = None
    centralizar: bool = False
    manter_junto: bool = False  # bloco de assinatura: não divide entre páginas


@dataclass
class LinhaTabela:
    """Linha de tabela com várias células lado a lado -- não quebra entre
    páginas (se não couber, vai inteira pra próxima)."""
    celulas: list  # list[Caixa]
    altura_min: float = 0.0
    altura_exata: Optional[float] = None


def _altura(itens) -> float:
    total = 0.0
    for it in itens:
        if isinstance(it, (Linha, Espaco)):
            total += it.altura
        elif isinstance(it, Caixa):
            total += _altura_caixa(it)
        elif isinstance(it, LinhaTabela):
            total += _altura_linha_tabela(it)
    return total


def _altura_caixa(c: Caixa) -> float:
    if c.altura_exata is not None:
        return c.altura_exata
    return max(c.altura_min, c.pad_top + _altura(c.filhos) + c.pad_bottom)


def _altura_linha_tabela(lt: LinhaTabela) -> float:
    if lt.altura_exata is not None:
        return lt.altura_exata
    return max([lt.altura_min] + [c.pad_top + _altura(c.filhos) + c.pad_bottom for c in lt.celulas])


# --------------------------------------------------------------------------
# Conversor
# --------------------------------------------------------------------------

class _PDF(FPDF):
    def __init__(self, conv: "Conversor", **kw):
        super().__init__(**kw)
        self.conv = conv

    def header(self):
        self.conv._desenhar_cabecalho()

    def footer(self):
        self.conv._desenhar_rodape()


def _campo_pagina(instr) -> bool:
    """Só o campo PAGE (número da página atual). NUMPAGES/SECTIONPAGES/
    PAGEREF não são o número da página -- ficam com o resultado em cache
    do próprio documento."""
    partes = (instr or "").split()
    return bool(partes) and partes[0].upper() == "PAGE"


class Conversor:
    def __init__(self, dados_docx: bytes):
        self.doc = docx.Document(io.BytesIO(dados_docx))
        self.est = Estilos(self.doc)
        self.num = Numeracao(self.doc)
        sec = self.doc.sections[0]
        self.pag_w = sec.page_width.pt
        self.pag_h = sec.page_height.pt
        self.m_esq = sec.left_margin.pt
        self.m_dir = sec.right_margin.pt
        self.m_top = sec.top_margin.pt
        self.m_bot = sec.bottom_margin.pt
        self.dist_cab = (sec.header_distance.pt if sec.header_distance is not None else 35.4)
        self.dist_rod = (sec.footer_distance.pt if sec.footer_distance is not None else 35.4)
        self.largura = self.pag_w - self.m_esq - self.m_dir
        self.pdf = _PDF(self, unit="pt", format=(self.pag_w, self.pag_h))
        self.pdf.set_auto_page_break(False)
        self.pdf.set_margins(0, 0, 0)
        for fam, prefixo in _FAMILIAS.items():
            for est, sufixo in _ESTILO_ARQUIVO.items():
                self.pdf.add_font(fam, est, str(_FONTS_DIR / f"{prefixo}-{sufixo}.ttf"))
        self._larguras: dict = {}
        self._fonte_atual = None
        # cabeçalho/rodapé: layout pronto (cabeçalho é igual em toda página;
        # rodapé é refeito a cada página por causa do número)
        self._cab_itens = self._layout_blocos(sec.header._element, self.largura, cabecalho=True)
        self._cab_altura = _altura(self._cab_itens)
        self._rodape_el = sec.footer._element
        rod_itens = self._layout_blocos(self._rodape_el, self.largura, pagina=1)
        self._rod_altura = _altura(rod_itens)
        self.topo = max(self.m_top, self.dist_cab + self._cab_altura)
        self.base = self.pag_h - max(self.m_bot, self.dist_rod + self._rod_altura)
        self.y = self.topo
        self.caixas_abertas: list = []
        self._pagina_tem_conteudo = False

    # ---------------------------------------------------------------- fontes
    def _set_fonte(self, e: Estilo):
        chave = (e.familia, e.fpdf_estilo, e.tamanho)
        if chave != self._fonte_atual:
            self.pdf.set_font(e.familia, e.fpdf_estilo, e.tamanho)
            self._fonte_atual = chave

    def _larg(self, texto: str, e: Estilo) -> float:
        chave = (e.familia, e.fpdf_estilo, e.tamanho, texto)
        w = self._larguras.get(chave)
        if w is None:
            self._set_fonte(e)
            w = self.pdf.get_string_width(texto)
            self._larguras[chave] = w
        return w

    # ------------------------------------------------------------ propriedades
    def _props_par(self, p_el) -> tuple[ParaProps, RunProps, Optional[str]]:
        ppr = p_el.find(qn("w:pPr"))
        sid = _val(ppr.find(qn("w:pStyle"))) if ppr is not None else None
        sid = sid or self.est.padrao_par
        pp = ParaProps()
        pp.aplicar(self.est.ppr_padrao)
        rp = RunProps()
        rp.aplicar(self.est.rpr_padrao)
        for s in self.est.cadeia(sid):
            pp.aplicar(s.find(qn("w:pPr")))
            rp.aplicar(s.find(qn("w:rPr")))
        # numeração: recuo do nível entra antes do recuo direto do parágrafo
        num_ppr_direto = ppr.find(qn("w:numPr")) if ppr is not None else None
        pp_num = pp.copia()
        if ppr is not None:
            pp_num.aplicar(ppr)
        if pp_num.num_id and pp_num.num_id in self.num.niveis and pp_num.nivel in self.num.niveis[pp_num.num_id]:
            lvl_ppr = self.num.niveis[pp_num.num_id][pp_num.nivel][3]
            pp.aplicar(lvl_ppr)
        if ppr is not None:
            pp.aplicar(ppr)
        _ = num_ppr_direto
        return pp, rp, sid

    def _props_run(self, r_el, base: RunProps) -> RunProps:
        rp = base.copia()
        rpr = r_el.find(qn("w:rPr"))
        if rpr is not None:
            rs = _val(rpr.find(qn("w:rStyle")))
            if rs:
                for s in self.est.cadeia(rs):
                    rp.aplicar(s.find(qn("w:rPr")))
            rp.aplicar(rpr)
        return rp

    def _estilo(self, rp: RunProps) -> Estilo:
        nome = self.est.fonte_tema(rp.tema) if rp.tema else rp.fonte
        familia, forca_negrito = _familia_de(nome)
        return Estilo(
            familia=familia,
            negrito=bool(rp.negrito) or forca_negrito,
            italico=bool(rp.italico),
            tamanho=rp.tamanho or 11.0,
            sublinhado=bool(rp.sublinhado),
            tachado=bool(rp.tachado),
            cor=rp.cor,
            realce=rp.realce,
        )

    # ------------------------------------------------------------ parágrafo
    def _coletar(self, p_el, rp_par: RunProps, pagina: int = 0) -> list:
        """Lista de pedaços/tokens do parágrafo, na ordem: ('txt', Pedaco),
        ('tab', Estilo), ('br', Estilo), ('img', Pedaco)."""
        out = []
        campo = None  # estado de campo complexo (PAGE)

        def runs(el):
            for filho in el:
                tag = filho.tag
                if tag == qn("w:r"):
                    yield filho
                elif tag in (qn("w:hyperlink"), qn("w:smartTag"), qn("w:ins"), qn("w:fldSimple")):
                    if tag == qn("w:fldSimple") and _campo_pagina(filho.get(qn("w:instr"))):
                        yield ("PAGE", filho)
                        continue
                    yield from runs(filho)

        for r in runs(p_el):
            if isinstance(r, tuple):
                rr = r[1].find(qn("w:r"))
                rp = self._props_run(rr, rp_par) if rr is not None else rp_par
                out.append(("txt", Pedaco(str(pagina or 1), self._estilo(rp))))
                continue
            rp = self._props_run(r, rp_par)
            if rp.oculto:
                continue
            e = self._estilo(rp)
            for c in r:
                tag = c.tag
                if tag == qn("w:fldChar"):
                    tipo = c.get(qn("w:fldCharType"))
                    if tipo == "begin":
                        campo = {"instr": "", "fase": "instr"}
                    elif tipo == "separate" and campo is not None:
                        campo["fase"] = "resultado"
                        if _campo_pagina(campo["instr"]):
                            out.append(("txt", Pedaco(str(pagina or 1), e)))
                    elif tipo == "end":
                        campo = None
                elif tag == qn("w:instrText") and campo is not None:
                    campo["instr"] += c.text or ""
                elif campo is not None and campo.get("fase") == "resultado" and _campo_pagina(campo["instr"]):
                    continue  # resultado em cache do campo PAGE: já trocamos pelo número real
                elif campo is not None and campo.get("fase") == "instr":
                    continue
                elif tag == qn("w:t"):
                    txt = c.text or ""
                    if rp.caixa_alta:
                        txt = txt.upper()
                    out.append(("txt", Pedaco(txt, e)))
                elif tag == qn("w:tab"):
                    out.append(("tab", e))
                elif tag in (qn("w:br"), qn("w:cr")):
                    if c.get(qn("w:type")) == "page":
                        out.append(("pagebr", e))
                    else:
                        out.append(("br", e))
                elif tag == qn("w:noBreakHyphen"):
                    out.append(("txt", Pedaco("-", e)))
                elif tag == qn("w:sym"):
                    out.append(("txt", Pedaco("•", e)))
                elif tag == qn("w:drawing"):
                    img = self._imagem_inline(c)
                    if img is not None:
                        out.append(("img", Pedaco("", e, largura=img[1], imagem=img)))
        return out

    def _imagem_inline(self, drawing):
        ext = drawing.find(".//{%s}extent" % _NS_WP)
        blip = drawing.find(".//{%s}blip" % _NS_A)
        if ext is None or blip is None:
            return None
        rid = blip.get("{%s}embed" % _NS_R)
        part = drawing.getroottree().getroot()
        # acha a part dona deste XML (documento, cabeçalho ou rodapé)
        dono = self._part_de(part)
        try:
            dados = dono.related_parts[rid].blob
        except Exception:
            return None
        return dados, int(ext.get("cx")) / 12700, int(ext.get("cy")) / 12700

    def _part_de(self, raiz):
        doc_part = self.doc.part
        if doc_part.element is raiz:
            return doc_part
        for rel in doc_part.rels.values():
            try:
                if rel.target_part.element is raiz:
                    return rel.target_part
            except Exception:
                continue
        return doc_part

    def _layout_paragrafo(self, p_el, largura: float, pagina: int = 0) -> tuple[list, ParaProps]:
        pp, rp_par, _ = self._props_par(p_el)
        # fonte da marca de parágrafo (altura de parágrafo vazio)
        ppr = p_el.find(qn("w:pPr"))
        rp_marca = rp_par.copia()
        if ppr is not None:
            rp_marca.aplicar(ppr.find(qn("w:rPr")))
        e_marca = self._estilo(rp_marca)
        tokens = self._coletar(p_el, rp_par, pagina)

        rotulo = None
        if pp.num_id:
            r = self.num.proximo(pp.num_id, pp.nivel)
            if r is not None:
                texto, _, lvl_rpr, sufixo = r
                rp_rot = rp_marca.copia()
                rp_rot.aplicar(lvl_rpr)
                e_rot = self._estilo(rp_rot)
                rotulo = (texto, e_rot, sufixo)

        itens: list = []
        if pp.antes:
            itens.append(Espaco(pp.antes))
        linhas = self._quebrar_linhas(tokens, pp, largura, e_marca, rotulo)
        itens.extend(linhas)
        if pp.depois:
            itens.append(Espaco(pp.depois))
        return itens, pp

    def _altura_linha(self, pp: ParaProps, estilos: list) -> tuple[float, float]:
        tamanho_max, asc_max, nat = 0.0, 0.0, 0.0
        for e in estilos:
            asc, fator = _metricas(e.familia)
            nat = max(nat, e.tamanho * fator)
            asc_max = max(asc_max, e.tamanho * asc)
            tamanho_max = max(tamanho_max, e.tamanho)
        if pp.linha is None or pp.regra == "auto":
            mult = (pp.linha / 240) if pp.linha else 1.0
            h = nat * mult
            base = asc_max + (h - nat) * 0  # espaço extra vai abaixo (igual LibreOffice)
        elif pp.regra == "exact":
            h = pp.linha / 20
            base = asc_max - max(0.0, nat - h) * 0.5
        else:  # atLeast
            h = max(nat, pp.linha / 20)
            base = asc_max + (h - nat)
        return h, base

    def _quebrar_linhas(self, tokens, pp: ParaProps, largura: float, e_marca: Estilo, rotulo) -> list:
        x_esq = pp.recuo_esq
        x_dir = largura - pp.recuo_dir
        # Monta "caixas": palavras (lista de pedaços sem espaço), espaços, tabs, br, imagens
        caixas = []  # (tipo, conteudo)
        palavra: list = []

        def fecha():
            nonlocal palavra
            if palavra:
                caixas.append(("palavra", palavra))
                palavra = []

        if rotulo is not None:
            texto, e_rot, sufixo = rotulo
            caixas.append(("palavra", [Pedaco(texto, e_rot, self._larg(texto, e_rot))]))
            if sufixo == "tab":
                caixas.append(("tabnum", e_rot))
            elif sufixo == "space":
                caixas.append(("espaco", Pedaco(" ", e_rot, self._larg(" ", e_rot))))
        for tipo, conteudo in tokens:
            if tipo == "txt":
                partes = re.split(r"( +)", conteudo.texto)
                for parte in partes:
                    if not parte:
                        continue
                    if parte.startswith(" "):
                        fecha()
                        for _ in parte:
                            caixas.append(("espaco", Pedaco(" ", conteudo.estilo, self._larg(" ", conteudo.estilo))))
                    else:
                        anterior = palavra[-1] if palavra else None
                        if anterior is not None and anterior.imagem is None and anterior.estilo == conteudo.estilo:
                            # mesma formatação em runs diferentes (o Word quebra
                            # runs à toa): junta, pra palavra sair inteira no PDF
                            anterior.texto += parte
                            anterior.largura = self._larg(anterior.texto, anterior.estilo)
                        else:
                            palavra.append(Pedaco(parte, conteudo.estilo, self._larg(parte, conteudo.estilo)))
            elif tipo == "tab":
                fecha()
                caixas.append(("tab", conteudo))
            elif tipo == "br":
                fecha()
                caixas.append(("br", conteudo))
            elif tipo == "pagebr":
                fecha()
                caixas.append(("pagebr", conteudo))
            elif tipo == "img":
                fecha()
                caixas.append(("palavra", [conteudo]))
        fecha()

        linhas_out = []
        i = 0
        primeira = True
        n = len(caixas)
        if n == 0:
            h, base = self._altura_linha(pp, [e_marca])
            linhas_out.append(Linha(h, lambda pdf, x, y: None, tem_conteudo=False))
            return linhas_out
        while i < n:
            inicio = x_esq + (pp.primeira if primeira else 0.0)
            x = inicio
            linha: list = []  # (tipo, x, pedacos/obj, largura)
            fim_forcado = False
            quebra_pag = False
            while i < n:
                tipo, cont = caixas[i]
                if tipo == "palavra":
                    w = sum(p.largura for p in cont)
                    if x + w > x_dir + 0.01 and any(t == "palavra" for t, *_ in linha):
                        break
                    if x + w > x_dir + 0.01 and not linha:
                        # palavra maior que a linha inteira: quebra por caractere
                        cont = self._cortar_palavra(cont, x_dir - x, caixas, i)
                        w = sum(p.largura for p in cont)
                    linha.append(("palavra", x, cont, w))
                    x += w
                elif tipo == "espaco":
                    linha.append(("espaco", x, cont, cont.largura))
                    x += cont.largura
                elif tipo in ("tab", "tabnum"):
                    novo_x, alin = self._proxima_tab(x, pp, x_esq, tipo == "tabnum")
                    if novo_x > x_dir + 0.01 and any(t == "palavra" for t, *_ in linha):
                        break
                    linha.append(("tab", x, (novo_x, alin), novo_x - x))
                    x = novo_x
                elif tipo == "br":
                    i += 1
                    fim_forcado = True
                    break
                elif tipo == "pagebr":
                    i += 1
                    quebra_pag = True
                    fim_forcado = True
                    break
                i += 1
            ultima = i >= n or fim_forcado
            # remove espaços no fim da linha (não contam pra justificar/alinhar)
            while linha and linha[-1][0] == "espaco":
                linha.pop()
            linhas_out.append(self._montar_linha(linha, pp, x_esq, x_dir, inicio, ultima, e_marca))
            if quebra_pag:
                linhas_out.append(QuebraPagina())
            primeira = False
            # pula espaços no começo da próxima linha
            while i < n and caixas[i][0] == "espaco" and not fim_forcado:
                i += 1
        return linhas_out

    def _cortar_palavra(self, pedacos, disponivel, caixas, i):
        caber, resto, w = [], [], 0.0
        for p in pedacos:
            if resto:
                resto.append(p)
                continue
            if w + p.largura <= disponivel or p.imagem is not None:
                caber.append(p)
                w += p.largura
                continue
            k = 0
            while k < len(p.texto) and w + self._larg(p.texto[: k + 1], p.estilo) <= disponivel:
                k += 1
            k = max(k, 1)
            a, b = p.texto[:k], p.texto[k:]
            caber.append(Pedaco(a, p.estilo, self._larg(a, p.estilo)))
            if b:
                resto.append(Pedaco(b, p.estilo, self._larg(b, p.estilo)))
        if resto:
            caixas.insert(i + 1, ("palavra", resto))
        return caber

    def _proxima_tab(self, x: float, pp: ParaProps, x_esq: float, numeracao: bool):
        # deslocamento (hanging) da numeração funciona como tab implícita
        if numeracao and pp.primeira < 0 and x < x_esq - 0.01:
            return x_esq, "left"
        for pos, tipo in pp.tabs:
            if tipo == "num":
                continue
            if pos > x + 0.01:
                return pos, tipo
        if numeracao and x < x_esq - 0.01:
            return x_esq, "left"
        passo = self.est.tab_padrao
        k = int(x // passo) + 1
        return k * passo, "left"

    def _montar_linha(self, linha, pp: ParaProps, x_esq, x_dir, inicio, ultima, e_marca):
        estilos = [p.estilo for t, _, c, _ in linha if t == "palavra" for p in c if p.imagem is None]
        estilos += [c.estilo for t, _, c, _ in linha if t == "espaco"]
        img_h = max([p.imagem[2] for t, _, c, _ in linha if t == "palavra" for p in c if p.imagem is not None],
                    default=0.0)
        h, base = self._altura_linha(pp, estilos or [e_marca])
        if img_h > 0:
            # linha com imagem inline: a altura é a da imagem (+ descendente)
            h = max(h, img_h + (h - base))
            base = max(base, img_h)

        # tabs centralizadas/à direita: reposiciona o trecho seguinte
        segmentos = []  # cada segmento: (alinhamento, x_tab, itens)
        atual = ("left", None, [])
        for item in linha:
            if item[0] == "tab":
                segmentos.append(atual)
                novo_x, alin = item[2]
                atual = (alin, novo_x, [])
            else:
                atual[2].append(item)
        segmentos.append(atual)
        colocados = []  # (tipo, x, conteudo, largura)
        for alin, x_tab, itens in segmentos:
            if not itens:
                continue
            larg = sum(it[3] for it in itens)
            if alin == "center" and x_tab is not None:
                desloc = (x_tab - larg / 2) - itens[0][1]
            elif alin == "right" and x_tab is not None:
                desloc = (x_tab - larg) - itens[0][1]
            else:
                desloc = 0.0
            for t, x, c, w in itens:
                colocados.append((t, x + desloc, c, w))

        natural_fim = max((x + w for _, x, _, w in colocados), default=inicio)
        sobra = (x_dir - natural_fim)
        extra_por_espaco = 0.0
        desloc_total = 0.0
        tem_tab = any(it[0] == "tab" for it in linha)
        if pp.alinhamento == "center":
            desloc_total = sobra / 2
        elif pp.alinhamento == "right":
            desloc_total = sobra
        elif pp.alinhamento == "justify" and not ultima and not tem_tab:
            # só os espaços DEPOIS da última tabulação (e entre palavras) esticam
            espacos = [k for k, it in enumerate(colocados) if it[0] == "espaco"]
            if espacos and sobra > 0:
                extra_por_espaco = sobra / len(espacos)

        final = []
        acum = 0.0
        for t, x, c, w in colocados:
            if t == "espaco":
                acum += extra_por_espaco
                continue
            if t == "palavra":
                final.append((x + desloc_total + acum, c))

        def desenhar(pdf, x0, y0, final=final, base=base, conv=self):
            ultimo = len(final) - 1
            for k, (x, pedacos) in enumerate(final):
                cx = x0 + x
                for j, p in enumerate(pedacos):
                    if p.imagem is not None:
                        dados, w, hh = p.imagem
                        pdf.image(io.BytesIO(dados), x=cx, y=y0 + base - hh, w=w, h=hh)
                        cx += w
                        continue
                    e = p.estilo
                    if e.realce:
                        pdf.set_fill_color(*e.realce)
                        pdf.rect(cx, y0 + base - e.tamanho * 0.85, p.largura, e.tamanho * 1.1, style="F")
                    conv._set_fonte(e)
                    pdf.set_text_color(*(e.cor or (0, 0, 0)))
                    # espaço real no fim de cada palavra (menos a última da
                    # linha): invisível, mas faz copiar/buscar no PDF separar
                    # as palavras -- a posição da palavra seguinte continua
                    # explícita, então a justificação não muda.
                    texto = p.texto + (" " if (j == len(pedacos) - 1 and k < ultimo) else "")
                    pdf.text(cx, y0 + base, texto)
                    if e.sublinhado or e.tachado:
                        pdf.set_draw_color(*(e.cor or (0, 0, 0)))
                        pdf.set_line_width(max(0.4, e.tamanho * 0.05))
                        yy = y0 + base + e.tamanho * 0.12 if e.sublinhado else y0 + base - e.tamanho * 0.3
                        pdf.line(cx, yy, cx + p.largura, yy)
                    cx += p.largura

        return Linha(h, desenhar, tem_conteudo=bool(final))

    # ---------------------------------------------------------------- blocos
    def _layout_blocos(self, container_el, largura: float, cabecalho: bool = False, pagina: int = 0) -> list:
        itens: list = []
        grupo_borda = None  # (assinatura, [itens], ParaProps)

        def fecha_grupo():
            nonlocal grupo_borda
            if grupo_borda is not None:
                assin, filhos, ppb = grupo_borda
                pad = ppb.espaco_borda + 1.0
                caixa = Caixa(filhos=filhos, x=ppb.recuo_esq - pad - 4,
                              largura=largura - ppb.recuo_esq - ppb.recuo_dir + 2 * pad + 8,
                              pad_top=pad, pad_bottom=pad, bordas=assin)
                caixa.x_conteudo = -caixa.x  # type: ignore[attr-defined]  # linhas já trazem o próprio recuo
                itens.append(caixa)
                grupo_borda = None

        assinatura: Optional[list] = None  # linhas do bloco de assinatura em montagem

        def fecha_assinatura():
            nonlocal assinatura
            if assinatura:
                caixa = Caixa(filhos=assinatura, x=0.0, largura=largura, manter_junto=True)
                itens.append(caixa)
            assinatura = None

        for el in container_el:
            if el.tag == qn("w:p"):
                blocos, pp = self._layout_paragrafo(el, largura, pagina)
                texto = "".join(t.text or "" for t in el.iter(qn("w:t")))
                # Bloco de assinatura (linha "_____" + nome/CPF/papel logo
                # abaixo): fica inteiro na mesma página -- nunca a linha de
                # assinatura numa página e o nome de quem assina na outra.
                if not cabecalho and re.match(r"^\s*(\d+\.)?\s*_{8,}", texto):
                    fecha_assinatura()
                    assinatura = list(blocos)
                    continue
                if assinatura is not None:
                    if texto.strip() and not pp.quebra_antes:
                        assinatura.extend(blocos)
                        continue
                    fecha_assinatura()
                if pp.quebra_antes and not cabecalho:
                    fecha_grupo()
                    itens.append(QuebraPagina())
                if pp.bordas:
                    if grupo_borda is not None and grupo_borda[0] != pp.bordas:
                        fecha_grupo()
                    if grupo_borda is None:
                        grupo_borda = (pp.bordas, [], pp)
                    grupo_borda[1].extend(blocos)
                else:
                    fecha_grupo()
                    itens.extend(blocos)
            elif el.tag == qn("w:tbl"):
                fecha_assinatura()
                fecha_grupo()
                itens.extend(self._layout_tabela(el, largura))
            elif el.tag == qn("w:sdt"):
                fecha_grupo()
                conteudo = el.find(qn("w:sdtContent"))
                if conteudo is not None:
                    itens.extend(self._layout_blocos(conteudo, largura, cabecalho, pagina))
        fecha_assinatura()
        fecha_grupo()
        return itens

    def _layout_tabela(self, tbl, largura_disp: float) -> list:
        tblpr = tbl.find(qn("w:tblPr"))
        grade = [int(g.get(qn("w:w"))) / 20 for g in tbl.findall(qn("w:tblGrid") + "/" + qn("w:gridCol"))]
        ind = 0.0
        bordas_tab = {}
        mar = {"top": 0.0, "bottom": 0.0, "left": 5.4, "right": 5.4}
        if tblpr is not None:
            ti = tblpr.find(qn("w:tblInd"))
            if ti is not None and ti.get(qn("w:w")):
                ind = int(ti.get(qn("w:w"))) / 20
            tb = tblpr.find(qn("w:tblBorders"))
            if tb is not None:
                for lado in ("top", "left", "bottom", "right", "insideH", "insideV"):
                    el = tb.find(qn(f"w:{lado}"))
                    if el is not None:
                        bordas_tab[lado] = _val(el) not in (None, "nil", "none")
            cm = tblpr.find(qn("w:tblCellMar"))
            if cm is not None:
                for lado in ("top", "bottom", "left", "right"):
                    el = cm.find(qn(f"w:{lado}"))
                    if el is not None and el.get(qn("w:w")):
                        mar[lado] = int(el.get(qn("w:w"))) / 20
        # Word posiciona a tabela pela borda do texto da 1ª célula: o
        # tblInd é medido até o conteúdo, então a borda fica "margem
        # esquerda da célula" pra fora -- igual o LibreOffice faz.
        x_tab = ind
        linhas_el = tbl.findall(qn("w:tr"))
        n_linhas = len(linhas_el)
        out = []
        for li, tr in enumerate(linhas_el):
            trpr = tr.find(qn("w:trPr"))
            alt_min, alt_exata = 0.0, None
            grid_antes = 0
            if trpr is not None:
                th = trpr.find(qn("w:trHeight"))
                if th is not None and _val(th):
                    v = int(_val(th)) / 20
                    if th.get(qn("w:hRule")) == "exact":
                        alt_exata = v
                    else:
                        alt_min = v
                gb = trpr.find(qn("w:gridBefore"))
                if gb is not None:
                    grid_antes = int(_val(gb))
            col = grid_antes
            celulas = []
            tcs = tr.findall(qn("w:tc"))
            for ci, tc in enumerate(tcs):
                tcpr = tc.find(qn("w:tcPr"))
                span = 1
                bordas_cel = {}
                centralizar = False
                if tcpr is not None:
                    gs = tcpr.find(qn("w:gridSpan"))
                    if gs is not None:
                        span = int(_val(gs))
                    tcb = tcpr.find(qn("w:tcBorders"))
                    if tcb is not None:
                        for lado in ("top", "left", "bottom", "right"):
                            el = tcb.find(qn(f"w:{lado}"))
                            if el is not None:
                                bordas_cel[lado] = _val(el) not in (None, "nil", "none")
                    va = tcpr.find(qn("w:vAlign"))
                    centralizar = va is not None and _val(va) == "center"
                x_cel = x_tab + sum(grade[:col])
                w_cel = sum(grade[col:col + span]) if grade else largura_disp
                col += span
                primeira_col = ci == 0 and grid_antes == 0
                ultima_col = ci == len(tcs) - 1

                def lado(nome, padrao):
                    if nome in bordas_cel:
                        return bordas_cel[nome]
                    return bordas_tab.get(padrao, False)

                bordas = (
                    lado("top", "top" if li == 0 else "insideH"),
                    lado("left", "left" if primeira_col else "insideV"),
                    lado("bottom", "bottom" if li == n_linhas - 1 else "insideH"),
                    lado("right", "right" if ultima_col else "insideV"),
                )
                larg_conteudo = w_cel - mar["left"] - mar["right"]
                filhos = self._layout_blocos(tc, larg_conteudo)
                # célula de tabela: espaço "depois" do último parágrafo conta
                caixa = Caixa(filhos=filhos, x=x_cel, largura=w_cel, pad_top=mar["top"],
                              pad_bottom=mar["bottom"], bordas=bordas, altura_min=alt_min,
                              altura_exata=alt_exata, centralizar=centralizar)
                caixa.x_conteudo = mar["left"]  # type: ignore[attr-defined]
                celulas.append(caixa)
            if len(celulas) == 1:
                out.append(celulas[0])
            else:
                out.append(LinhaTabela(celulas=celulas, altura_min=alt_min, altura_exata=alt_exata))
        return out

    # ------------------------------------------------------------ paginação
    def _nova_pagina(self):
        # fecha (desenha) o pedaço atual de cada caixa aberta nesta página
        for cx in self.caixas_abertas:
            self._borda_segmento(cx, cx["y_ini"], self.base, cx["seg_inicio"], False)
        self.pdf.add_page()
        self._pagina_tem_conteudo = False
        self.y = self.topo
        for cx in self.caixas_abertas:
            cx["y_ini"] = self.y
            cx["seg_inicio"] = False
            self.y += 0  # padding superior não se repete na continuação

    def _borda_segmento(self, cx, y0, y1, inicio: bool, fim: bool):
        pdf = self.pdf
        top, left, bottom, right = cx["bordas"]
        x0, x1 = cx["x0"], cx["x1"]
        pdf.set_draw_color(0, 0, 0)
        pdf.set_line_width(0.5)
        if top:
            pdf.line(x0, y0, x1, y0)
        if bottom:
            pdf.line(x0, y1, x1, y1)
        if left:
            pdf.line(x0, y0, x0, y1)
        if right:
            pdf.line(x1, y0, x1, y1)

    def _fluir(self, itens, x_base: float):
        for it in itens:
            if isinstance(it, QuebraPagina):
                # quebra forçada com a página ainda vazia (só linhas em branco
                # sobrando do fim da anterior) não gera página em branco extra
                if self._pagina_tem_conteudo:
                    self._nova_pagina()
                else:
                    self.y = self.topo
            elif isinstance(it, Espaco):
                # espaço que não cabe no fim da página some (não empurra nada)
                self.y = min(self.y + it.altura, self.base)
            elif isinstance(it, Linha):
                if self.y + it.altura > self.base + 0.01:
                    if not it.tem_conteudo:
                        # linha em branco no pé da página: não abre página nova
                        # só pra ela (evita página vazia no fim do contrato)
                        self.y = self.base
                        continue
                    self._nova_pagina()
                if it.tem_conteudo:
                    self._pagina_tem_conteudo = True
                it.desenhar(self.pdf, x_base, self.y)
                self.y += it.altura
            elif isinstance(it, Caixa):
                self._fluir_caixa(it, x_base)
            elif isinstance(it, LinhaTabela):
                self._fluir_linha_tabela(it, x_base)

    def _fluir_caixa(self, c: Caixa, x_base: float):
        altura_total = _altura_caixa(c)
        disponivel = self.base - self.topo
        # Igual Word/LibreOffice: linha de tabela quebra entre páginas (só a
        # de altura exata -- espaçadores -- vai inteira pra próxima).
        if (c.altura_exata is not None or c.manter_junto) and altura_total <= disponivel \
                and self.y + altura_total > self.base + 0.01:
            self._nova_pagina()
        x0 = x_base + c.x
        estado = {"bordas": c.bordas, "x0": x0, "x1": x0 + c.largura, "y_ini": self.y, "seg_inicio": True}
        x_conteudo = x0 + getattr(c, "x_conteudo", 0.0)
        if c.altura_exata is not None:
            y_ini = self.y
            y_salvo = self.y
            self.y += c.pad_top
            # conteúdo cortado na altura exata (linhas espaçadoras)
            self._fluir_recortado(c.filhos, x_conteudo, y_ini + c.altura_exata)
            self._borda_segmento(estado, y_ini, y_ini + c.altura_exata, True, True)
            self.y = y_salvo + c.altura_exata
            return
        conteudo_h = _altura(c.filhos)
        self.caixas_abertas.append(estado)
        self.y += c.pad_top
        if c.centralizar and c.altura_min > conteudo_h + c.pad_top + c.pad_bottom:
            self.y += (c.altura_min - conteudo_h - c.pad_top - c.pad_bottom) / 2
        y_min_fim = estado["y_ini"] + c.altura_min
        self._fluir(c.filhos, x_conteudo)
        self.y += c.pad_bottom
        if self.caixas_abertas and self.caixas_abertas[-1] is estado:
            self.caixas_abertas.pop()
        if estado["seg_inicio"]:
            self.y = max(self.y, y_min_fim)
        self._borda_segmento(estado, estado["y_ini"], self.y, estado["seg_inicio"], True)

    def _fluir_recortado(self, itens, x, y_limite):
        for it in itens:
            if isinstance(it, Linha):
                if self.y + it.altura > y_limite + 0.01:
                    return
                it.desenhar(self.pdf, x, self.y)
                self.y += it.altura
            elif isinstance(it, Espaco):
                self.y += it.altura

    def _fluir_linha_tabela(self, lt: LinhaTabela, x_base: float):
        h = _altura_linha_tabela(lt)
        if self.y + h > self.base + 0.01 and h <= self.base - self.topo:
            self._nova_pagina()
        y0 = self.y
        for c in lt.celulas:
            self.y = y0 + c.pad_top
            x0 = x_base + c.x
            self._fluir_recortado(c.filhos, x0 + getattr(c, "x_conteudo", 0.0), y0 + h)
            self._borda_segmento({"bordas": c.bordas, "x0": x0, "x1": x0 + c.largura}, y0, y0 + h, True, True)
        self.y = y0 + h

    # -------------------------------------------------- cabeçalho / rodapé
    def _desenhar_cabecalho(self):
        y_salvo = self.y
        self.y = self.dist_cab
        abertas, self.caixas_abertas = self.caixas_abertas, []
        self._fluir_recortado(self._cab_itens, self.m_esq, self.pag_h)
        self.caixas_abertas = abertas
        self.y = y_salvo

    def _desenhar_rodape(self):
        y_salvo = self.y
        itens = self._layout_blocos(self._rodape_el, self.largura, pagina=self.pdf.page_no())
        h = _altura(itens)
        self.y = self.pag_h - self.dist_rod - h
        abertas, self.caixas_abertas = self.caixas_abertas, []
        self._fluir_recortado(itens, self.m_esq, self.pag_h)
        self.caixas_abertas = abertas
        self.y = y_salvo

    # -------------------------------------------------------------- execução
    def converter(self) -> bytes:
        corpo = self._layout_blocos(self.doc.element.body, self.largura)
        self.pdf.add_page()
        self.y = self.topo
        self._fluir(corpo, self.m_esq)
        return bytes(self.pdf.output())


def docx_para_pdf(dados_docx: bytes) -> bytes:
    """.docx (bytes) -> PDF (bytes). Ver docstring do módulo."""
    return Conversor(dados_docx).converter()
