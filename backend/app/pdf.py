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

    def _garante_espaco(self, altura: float):
        """Quebra a página ANTES de desenhar, se o bloco não couber inteiro
        no que resta dela — sem isso, uma `linha()`/`secao()` que estoura o
        fim da página é cortada ao meio pela quebra automática do fpdf
        (rótulo fica numa página, valor aparece sozinho na próxima)."""
        if self.get_y() + altura > self.page_break_trigger:
            self.add_page()

    def _estima_linhas(self, texto: str, largura_mm: float) -> int:
        """Estimativa (não exata) de quantas linhas um texto vai ocupar numa
        coluna de `largura_mm`, só pra reservar altura suficiente antes de
        desenhar — não precisa ser pixel-perfeito, só não subestimar muito."""
        texto = str(texto or "")
        if not texto:
            return 1
        caracteres_por_linha = max(int(largura_mm / 1.9), 10)
        return max(1, -(-len(texto) // caracteres_por_linha))

    def secao(self, titulo: str):
        self._garante_espaco(20)
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
        próximo bloco, já contando o espaço que o texto ocupou. Garante que
        rótulo+valor sempre caem na mesma página (ver _garante_espaco)."""
        largura1 = 88 if label2 else 180
        n1 = self._estima_linhas(valor1, largura1)
        n2 = self._estima_linhas(valor2, 85) if label2 else 0
        self._garante_espaco(4.3 + max(n1, n2, 1) * 5 + 4)

        y0 = self.get_y()
        self._rotulo_valor(15, y0, label1, valor1, largura1)
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


ESTADO_CIVIL_LABEL = {
    "solteiro": "Solteiro(a)",
    "casado": "Casado(a)",
    "viuvo": "Viúvo(a)",
    "divorciado": "Divorciado(a)",
    "outros": "Outros",
}

# Mesmo texto/condições exigidas do modelo em papel (Proposta de Compra/Venda
# Castel, operada em conjunto com a JR Imóveis | A&S Imobiliária) — ver
# painel-mudancas: adaptação do modelo real enviado pelo cliente.
DISCLAIMER_PROPOSTA = (
    "1. Todas as parcelas acima descritas serao corrigidas mensalmente pela variacao do INCC ate a entrega, "
    "e apos a entrega do lote, pelo IGPM/FGV + 1% a.m. (um por cento ao mes) sobre o saldo devedor.\n"
    "2. Esta proposta so sera aceita com copia legivel dos seguintes documentos: identidade (RG), CPF, "
    "comprovante de residencia do proponente, certidao de nascimento ou casamento, comprovante de renda "
    "e, em caso de casamento, os documentos do conjuge (RG e CPF).\n\n"
    "Estou de pleno acordo com esta proposta e comprometo-me a mante-la nas condicoes dos dados acima mencionados."
)

RODAPE_JR_IMOVEIS = (
    "JR IMOVEIS | A&S IMOBILIARIA\n"
    "Av. Joao da Escossia, 176 - Jr Center - Nova Betania - Mossoro/RN - CEP: 59.607-330\n"
    "Fones: (84) 3317-3493 / (84) 3312-4885 - www.jrcenter.com.br"
)


def _fmt_data_livre(v: Optional[str]) -> str:
    """Datas do formulário do cliente podem chegar como 'YYYY-MM-DD' (input
    date do navegador) ou já em texto livre — tenta o formato ISO primeiro,
    cai pro texto puro se não bater."""
    if not v:
        return "-"
    try:
        return datetime.strptime(v[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
    except Exception:
        return v


def _endereco_linha1(end: dict) -> str:
    partes = [end.get("rua"), end.get("complemento")]
    return ", ".join(p for p in partes if p) or "-"


def _cidade_uf(end: dict) -> str:
    cidade, estado = end.get("cidade"), end.get("estado")
    if cidade and estado:
        return f"{cidade}/{estado}"
    return cidade or estado or "-"


def gerar_proposta_pdf(
    *,
    proposta: dict,
    lote: dict,
    cliente: dict,
    corretor: Optional[dict],
    condominio_nome: str,
    gerado_por: Optional[dict] = None,
    dados_qualificacao: Optional[dict] = None,
) -> bytes:
    """Gera a Proposta de Compra/Venda em papel timbrado Castel (mantendo a
    JR Imóveis | A&S Imobiliária, parceira nas vendas, no rodapé — igual ao
    modelo em papel). Quando a proposta veio de uma qualificação de cliente
    (formulário público preenchido + documentos), `dados_qualificacao` traz
    todos os campos extras (RG, endereços, cônjuge, forma de pagamento
    detalhada); sem isso, cai de volta pro resumo simples (proposta criada
    manualmente pelo painel, sem qualificação)."""
    dq = dados_qualificacao or {}
    proponente = dq.get("proponente") or {}
    conjuge = dq.get("conjuge") or {}
    end_res = dq.get("endereco_residencial") or {}
    end_com = dq.get("endereco_comercial") or {}
    fp = dq.get("forma_pagamento") or {}
    estado_civil = dq.get("estado_civil")

    pdf = _PropostaPDF(format="A4", unit="mm")
    pdf.EMISSOR = _fmt_emissor(gerado_por)
    pdf.set_auto_page_break(auto=True, margin=26)
    pdf.add_page()

    pdf.secao("Empreendimento e lote")
    pdf.linha("Empreendimento", condominio_nome, "Lote", lote.get("identificador", "-"))
    pdf.linha("Quadra", lote.get("quadra") or "-", "Área", _fmt_area(lote.get("tamanho_m2")))

    pdf.secao("Proponente")
    pdf.linha(
        "Nome", proponente.get("nome") or cliente.get("nome") or "-",
        "CPF/CNPJ", proponente.get("cpf_cnpj") or cliente.get("cpf") or "-",
    )
    pdf.linha("RG", proponente.get("rg") or "-", "Órgão expedidor", proponente.get("orgao_expedidor") or "-")
    if dq:
        pdf.linha(
            "Data de nascimento", _fmt_data_livre(proponente.get("data_nascimento")),
            "Nacionalidade", proponente.get("nacionalidade") or "-",
        )
        pdf.linha("Profissão", proponente.get("profissao") or "-", "Estado civil", ESTADO_CIVIL_LABEL.get(estado_civil, "-"))
    pdf.linha(
        "E-mail", proponente.get("email") or cliente.get("email") or "-",
        "Celular", dq.get("telefone_celular") or cliente.get("telefone") or "-",
    )

    if estado_civil == "casado":
        pdf.secao("Cônjuge")
        pdf.linha("Nome", conjuge.get("nome") or "-", "CPF/CNPJ", conjuge.get("cpf_cnpj") or "-")
        pdf.linha("RG", conjuge.get("rg") or "-", "Órgão expedidor", conjuge.get("orgao_expedidor") or "-")
        pdf.linha(
            "Data de nascimento", _fmt_data_livre(conjuge.get("data_nascimento")),
            "Nacionalidade", conjuge.get("nacionalidade") or "-",
        )

    if end_res.get("rua") or end_res.get("bairro"):
        pdf.secao("Endereço residencial")
        pdf.linha("Rua/Avenida", _endereco_linha1(end_res), "Nº", end_res.get("numero") or "-")
        pdf.linha("Bairro", end_res.get("bairro") or "-", "Cidade/UF", _cidade_uf(end_res))
        pdf.linha("CEP", end_res.get("cep") or "-")

    if end_com.get("rua") or end_com.get("bairro"):
        pdf.secao("Endereço comercial")
        pdf.linha("Rua/Avenida", _endereco_linha1(end_com), "Nº", end_com.get("numero") or "-")
        pdf.linha("Bairro", end_com.get("bairro") or "-", "Cidade/UF", _cidade_uf(end_com))

    if dq.get("telefone_residencial") or dq.get("telefone_comercial") or dq.get("telefone_recados"):
        pdf.secao("Outros contatos")
        pdf.linha("Telefone residencial", dq.get("telefone_residencial") or "-", "Telefone comercial", dq.get("telefone_comercial") or "-")
        pdf.linha("Telefone para recados", dq.get("telefone_recados") or "-", "Falar com", dq.get("falar_com") or "-")

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

    pdf.secao("Forma de pagamento")
    if dq:
        a_vista = fp.get("a_vista")
        pdf.linha(
            "À vista", "Sim" if a_vista else ("Não" if a_vista is False else "-"),
            "Renda informada", fp.get("renda") or "-",
        )
    pdf.linha("Valor de tabela do lote", _fmt_money(lote.get("valor_total")), "Valor proposto", _fmt_money(proposta.get("valor_proposto")))
    if fp.get("sinal") or fp.get("sinal_banco"):
        pdf.linha(
            "Sinal", fp.get("sinal") or "-",
            "Banco/Agência", " / ".join(p for p in [fp.get("sinal_banco"), fp.get("sinal_agencia")] if p) or "-",
        )
    if fp.get("dividido_em_parcelas"):
        pdf.linha(
            "Parcelas", f"{fp['dividido_em_parcelas']}x de {fp.get('valor_parcela') or '-'}",
            "Vencimento", fp.get("vencimento") or "-",
        )
        if fp.get("primeiro_mes"):
            pdf.linha("1ª parcela em", fp.get("primeiro_mes"))
    if fp.get("intercaladas_valor"):
        pdf.linha("Parcelas intercaladas", fp.get("intercaladas_valor"), "Dia de vencimento", fp.get("intercaladas_vencimento_dia") or "-")
    pdf.linha("Condições de pagamento (resumo)", proposta.get("condicoes_pagamento") or "A combinar")

    observacoes = " ".join(filter(None, [fp.get("observacoes"), proposta.get("observacoes")]))
    if observacoes:
        pdf.secao("Observações")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 35)
        pdf.multi_cell(0, 5.5, observacoes)

    pdf.ln(5)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*CINZA)
    pdf.multi_cell(0, 4.1, DISCLAIMER_PROPOSTA)

    pdf.ln(10)
    y = pdf.get_y()
    if y > 246:
        pdf.add_page()
        y = pdf.get_y() + 10
    pdf.set_draw_color(*CINZA)
    pdf.set_line_width(0.3)
    pdf.line(20, y, 90, y)
    pdf.line(120, y, 190, y)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*CINZA)
    pdf.set_xy(20, y + 2)
    pdf.cell(70, 5, "Proponente", align="C")
    pdf.set_xy(120, y + 2)
    pdf.cell(70, 5, "Imobiliária - CRECI", align="C")

    pdf.ln(16)
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.set_text_color(*CINZA)
    pdf.multi_cell(0, 3.6, RODAPE_JR_IMOVEIS, align="C")

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
