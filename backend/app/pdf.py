"""Geração do PDF de proposta de compra e venda em papel timbrado.

Não é o contrato definitivo (isso segue dependendo do modelo jurídico da
imobiliária) - é um documento de proposta comercial: identifica lote, cliente,
corretor e as condições (valores, entrada, parcelas) propostas, pra formalizar
e enviar ao cliente antes da negociação virar contrato.
"""

from datetime import datetime
from pathlib import Path
from typing import Optional

from fpdf import FPDF

LOGO_PATH = Path(__file__).parent / "assets" / "castel-logo.png"

# Logo de cada empreendimento (além da Castel) — usado no relatório de visão
# geral quando ele é filtrado por um empreendimento específico (ver
# gerar_visao_geral_pdf). Mapeado pelo slug do condomínio.
LOGO_POR_SLUG = {
    "rancho-texas": Path(__file__).parent / "assets" / "logo-rancho-texas.png",
    "porto-franco": Path(__file__).parent / "assets" / "logo-porto-franco.png",
}

AZUL = (26, 26, 74)
VERMELHO = (196, 42, 42)
CINZA = (110, 110, 120)
CINZA_CLARO = (240, 241, 245)


def _fmt_money(v: Optional[float]) -> str:
    if v is None:
        return "-"
    s = f"{v:,.2f}"
    s = s.replace(",", "_").replace(".", ",").replace("_", ".")
    return f"R$ {s}"


def _fmt_area(v: Optional[float]) -> str:
    """'m²' fica sem o glifo de superscrito nas fontes core do PDF (some
    silenciosamente, sem erro) — por isso 'm2' em texto puro, não 'm²'."""
    if v is None:
        return "-"
    s = f"{v:,.2f}"
    s = s.replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{s} m2"


def _fmt_emissor(pessoa: Optional[dict]) -> Optional[str]:
    """Linha de auditoria: quem gerou o documento e com que nível de acesso.
    Hífen normal, não travessão — a fonte core do PDF não tem o glifo "—"."""
    if not pessoa or not pessoa.get("nome"):
        return None
    papel = (pessoa.get("papel") or "-").upper()
    return f"Gerado por {pessoa['nome']} - perfil: {papel}"


def _fmt_data(dt: Optional[str]) -> str:
    if not dt:
        return "-"
    try:
        return datetime.fromisoformat(dt.replace("Z", "+00:00")).strftime("%d/%m/%Y")
    except Exception:
        return "-"


class _CastelPDF(FPDF):
    """Base do papel timbrado Castel — cada documento só troca o título do
    cabeçalho e o aviso do rodapé (ver TITULO/RODAPE nas subclasses)."""

    TITULO = ""
    RODAPE = ""
    # Rastro de auditoria: quem gerou o documento + o nível de perfil (admin/
    # corretor). Setado na instância (não na classe) antes do add_page() —
    # ver gerar_proposta_pdf/gerar_visao_geral_pdf. Aparece em toda página.
    EMISSOR: Optional[str] = None
    # Logo do empreendimento específico (além da Castel) — setado por
    # instância antes do add_page() quando o documento é de um empreendimento
    # só (ver gerar_visao_geral_pdf). None = mostra só a logo Castel.
    LOGO_EMPREENDIMENTO: Optional[Path] = None

    def header(self):
        if LOGO_PATH.exists():
            self.image(str(LOGO_PATH), x=15, y=12, w=45)
        largura_direita = self.w - 15
        if self.LOGO_EMPREENDIMENTO and Path(self.LOGO_EMPREENDIMENTO).exists():
            logo_w = 30
            self.image(str(self.LOGO_EMPREENDIMENTO), x=self.w - 15 - logo_w, y=10, w=logo_w)
            largura_direita = self.w - 15 - logo_w - 6
        self.set_xy(0, 14)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(*AZUL)
        self.cell(largura_direita, 8, self.TITULO, align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_xy(0, 22)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*CINZA)
        self.cell(
            largura_direita,
            6,
            datetime.now().strftime("Emitido em %d/%m/%Y às %H:%M"),
            align="R",
            new_x="LMARGIN",
            new_y="NEXT",
        )
        if self.EMISSOR:
            self.set_xy(0, 28)
            self.set_font("Helvetica", "BI", 8.5)
            self.set_text_color(*VERMELHO)
            self.cell(largura_direita, 5, self.EMISSOR, align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*AZUL)
        self.set_line_width(0.6)
        self.line(15, 34, self.w - 15, 34)
        self.set_y(42)

    def footer(self):
        self.set_y(-20)
        self.set_draw_color(*CINZA_CLARO)
        self.line(15, self.get_y(), self.w - 15, self.get_y())
        self.set_font("Helvetica", "I", 7.5)
        self.set_text_color(*CINZA)
        self.set_y(-16)
        self.multi_cell(0, 4, self.RODAPE, align="C")

    def secao(self, titulo: str):
        self.ln(3)
        self.set_font("Helvetica", "B", 10.5)
        self.set_text_color(*AZUL)
        self.cell(0, 7, titulo.upper(), new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*VERMELHO)
        self.set_line_width(0.8)
        self.line(15, self.get_y(), 40, self.get_y())
        self.ln(3)

    def _rotulo_valor(self, x: float, y: float, label: str, valor: str, largura: float):
        """Desenha um campo em duas linhas empilhadas (rótulo pequeno em cima,
        valor embaixo) numa posição x/y fixa — não mexe no cursor "de fluxo"."""
        self.set_xy(x, y)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(*CINZA)
        self.cell(largura, 4, label.upper())
        self.set_xy(x, y + 4.3)
        self.set_font("Helvetica", "", 10.5)
        self.set_text_color(30, 30, 35)
        self.multi_cell(largura, 5, valor)

    def linha(self, label1: str, valor1: str, label2: Optional[str] = None, valor2: Optional[str] = None):
        """Uma linha de campos (um ou dois lado a lado) e avança o cursor pro
        próximo bloco, já contando o espaço que o texto ocupou."""
        y0 = self.get_y()
        self._rotulo_valor(15, y0, label1, valor1, 88 if label2 else 180)
        y_fim = self.get_y()
        if label2:
            self._rotulo_valor(110, y0, label2, valor2 or "-", 85)
            y_fim = max(y_fim, self.get_y())
        self.set_xy(15, y_fim + 3)


class _PropostaPDF(_CastelPDF):
    TITULO = "PROPOSTA DE COMPRA E VENDA"
    RODAPE = (
        "Este documento é uma proposta comercial e não constitui contrato de compra e venda. "
        "Valores e condições sujeitos à confirmação e disponibilidade do lote no momento da formalização."
    )


def gerar_proposta_pdf(
    *,
    proposta: dict,
    lote: dict,
    cliente: dict,
    corretor: Optional[dict],
    condominio_nome: str,
    gerado_por: Optional[dict] = None,
) -> bytes:
    pdf = _PropostaPDF(format="A4", unit="mm")
    pdf.EMISSOR = _fmt_emissor(gerado_por)
    pdf.set_auto_page_break(auto=True, margin=24)
    pdf.add_page()

    pdf.secao("Empreendimento e lote")
    pdf.linha("Empreendimento", condominio_nome, "Lote", lote.get("identificador", "-"))
    pdf.linha("Tamanho", _fmt_area(lote.get("tamanho_m2")))

    pdf.secao("Cliente")
    pdf.linha("Nome", cliente.get("nome") or "-", "CPF", cliente.get("cpf") or "-")
    pdf.linha("Contato", " · ".join(filter(None, [cliente.get("telefone"), cliente.get("email")])) or "-")

    pdf.secao("Corretor responsável")
    if corretor:
        pdf.linha(
            "Nome",
            corretor.get("nome") or "-",
            "Contato",
            " · ".join(filter(None, [corretor.get("telefone"), corretor.get("email")])) or "-",
        )
    else:
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*CINZA)
        pdf.cell(0, 5, "Lead ainda sem corretor responsável definido.", new_x="LMARGIN", new_y="NEXT")

    pdf.secao("Condições comerciais")
    linhas = [
        ("Valor de tabela do lote", _fmt_money(lote.get("valor_total"))),
        ("Valor proposto", _fmt_money(proposta.get("valor_proposto"))),
        ("Entrada (tabela)", _fmt_money(lote.get("entrada"))),
        (
            "Parcelamento (tabela)",
            f"{lote.get('qtd_parcelas')}x de {_fmt_money(lote.get('parcela_mensal'))}"
            if lote.get("qtd_parcelas")
            else "-",
        ),
        ("Prazo de entrega", f"{lote['prazo_entrega_meses']} meses" if lote.get("prazo_entrega_meses") else "-"),
        ("Condições de pagamento propostas", proposta.get("condicoes_pagamento") or "A combinar"),
    ]
    pdf.set_font("Helvetica", "", 10)
    for i, (label, valor) in enumerate(linhas):
        if i % 2 == 0:
            pdf.set_fill_color(*CINZA_CLARO)
            pdf.rect(15, pdf.get_y(), 180, 7.2, style="F")
        pdf.set_font("Helvetica", "B", 9.5)
        pdf.set_text_color(*AZUL)
        pdf.set_x(17)
        pdf.cell(85, 7.2, label, new_x="RIGHT", new_y="TOP")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 35)
        pdf.cell(90, 7.2, str(valor), new_x="LMARGIN", new_y="NEXT")

    if proposta.get("observacoes"):
        pdf.secao("Observações")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 35)
        pdf.multi_cell(0, 5.5, proposta["observacoes"])

    pdf.ln(14)
    y = pdf.get_y()
    if y > 250:
        pdf.add_page()
        y = pdf.get_y() + 10
    pdf.set_draw_color(*CINZA)
    pdf.set_line_width(0.3)
    pdf.line(20, y, 90, y)
    pdf.line(120, y, 190, y)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*CINZA)
    pdf.set_xy(20, y + 2)
    pdf.cell(70, 5, "Corretor responsável", align="C")
    pdf.set_xy(120, y + 2)
    pdf.cell(70, 5, "Cliente", align="C")

    out = pdf.output()
    return bytes(out)


# ---------------------------------------------------------------------------
# Relatório de disponibilidade (visão geral, só admin) — números consolidados
# por empreendimento seguidos da tabela completa e atualizada dos lotes.
# ---------------------------------------------------------------------------

STATUS_LOTE_LABEL = {"disponivel": "Disponível", "reservado": "Reservado", "vendido": "Vendido"}
STATUS_LOTE_COR = {"disponivel": (31, 138, 87), "reservado": (193, 129, 11), "vendido": CINZA}


class _RelatorioPDF(_CastelPDF):
    TITULO = "RELATÓRIO DE DISPONIBILIDADE"
    RODAPE = "Documento de uso interno, gerado automaticamente a partir dos dados cadastrados no sistema."

    def stats(self, itens: list[tuple[str, str]]):
        largura = (self.w - 30) / len(itens)
        y0 = self.get_y()
        for i, (label, valor) in enumerate(itens):
            x = 15 + i * largura
            self.set_xy(x, y0)
            self.set_font("Helvetica", "B", 8)
            self.set_text_color(*CINZA)
            self.cell(largura, 4, label.upper())
            self.set_xy(x, y0 + 4.3)
            self.set_font("Helvetica", "B", 13)
            self.set_text_color(*AZUL)
            self.cell(largura, 7, valor)
        self.set_xy(15, y0 + 13)

    _LARGURAS = [18, 30, 24, 30, 26, 26, 42, 24, 26]
    _CABECALHO = [
        "Quadra",
        "Lote",
        "Tamanho",
        "Valor total",
        "Entrada",
        "Na entrega",
        "Parcelamento",
        "Prazo entrega",
        "Status",
    ]

    def _linha_cabecalho(self):
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(*AZUL)
        self.set_text_color(255, 255, 255)
        for w, titulo in zip(self._LARGURAS, self._CABECALHO):
            self.cell(w, 7, titulo, fill=True, align="L" if titulo in ("Quadra", "Lote") else "C")
        self.ln(7)
        self.set_font("Helvetica", "", 8)

    def tabela_lotes(self, lotes: list[dict]):
        self._linha_cabecalho()
        for i, lote in enumerate(sorted(lotes, key=lambda l: l.get("identificador", ""))):
            if self.get_y() > self.h - 32:
                self.add_page()
                self._linha_cabecalho()
            fill = i % 2 == 0
            if fill:
                self.set_fill_color(*CINZA_CLARO)
            self.set_text_color(30, 30, 35)
            parcelamento = (
                f"{lote.get('qtd_parcelas')}x de {_fmt_money(lote.get('parcela_mensal'))}"
                if lote.get("qtd_parcelas")
                else "-"
            )
            prazo = f"{lote['prazo_entrega_meses']} meses" if lote.get("prazo_entrega_meses") else "-"
            valores = [
                str(lote.get("quadra") or "-"),
                str(lote.get("identificador", "-")),
                _fmt_area(lote.get("tamanho_m2")),
                _fmt_money(lote.get("valor_total")),
                _fmt_money(lote.get("entrada")),
                _fmt_money(lote.get("entrega")),
                parcelamento,
                prazo,
            ]
            for w, valor, titulo in zip(self._LARGURAS, valores, self._CABECALHO):
                self.cell(w, 6.5, valor, fill=fill, align="L" if titulo in ("Quadra", "Lote") else "C")
            self.set_text_color(*STATUS_LOTE_COR.get(lote.get("status"), (30, 30, 35)))
            self.set_font("Helvetica", "B", 8)
            self.cell(self._LARGURAS[-1], 6.5, STATUS_LOTE_LABEL.get(lote.get("status"), "-"), fill=fill, align="C")
            self.set_font("Helvetica", "", 8)
            self.ln(6.5)


def gerar_visao_geral_pdf(
    *, resumo: list[dict], lotes_por_condominio: dict[str, list[dict]], gerado_por: Optional[dict] = None
) -> bytes:
    # Paisagem: a tabela de lotes tem 9 colunas (quadra, tamanho, valores,
    # parcelamento, prazo, status) — não cabe legível em retrato.
    pdf = _RelatorioPDF(format="A4", unit="mm", orientation="L")
    pdf.EMISSOR = _fmt_emissor(gerado_por)
    pdf.set_auto_page_break(auto=True, margin=24)

    # Cada empreendimento começa numa página nova — assim a logo do cabeçalho
    # (Castel + a do empreendimento) sempre corresponde ao que está naquela
    # página, mesmo quando o relatório sai com "todos os empreendimentos".
    for item in resumo:
        pdf.LOGO_EMPREENDIMENTO = LOGO_POR_SLUG.get(item.get("slug"))
        pdf.add_page()
        pdf.secao(item["nome"])
        pdf.stats(
            [
                ("Total de lotes", str(item["total_lotes"])),
                ("Disponíveis", str(item["disponiveis"])),
                ("Reservados", str(item["reservados"])),
                ("Vendidos", str(item["vendidos"])),
                ("Valor total vendido", _fmt_money(item["valor_total_vendido"])),
            ]
        )
        pdf.ln(2)
        pdf.tabela_lotes(lotes_por_condominio.get(item["condominio_id"], []))

    out = pdf.output()
    return bytes(out)
