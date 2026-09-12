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
    """Reproduz o layout do formulário em papel (Proposta de Compra/Venda
    Castel, operado com a JR Imóveis) — uma grade de campos com borda
    própria (rótulo em cima, valor embaixo), não os "cartões" com seção
    usados no relatório de visão geral. Ver `campo_grade`/`campo_titulo`."""

    TITULO = "PROPOSTA DE COMPRA E VENDA"
    RODAPE = (
        "Este documento é uma proposta comercial e não constitui contrato de compra e venda. "
        "Valores e condições sujeitos à confirmação e disponibilidade do lote no momento da formalização."
    )

    def campo_grade(self, *campos: tuple[str, str, float]):
        """Uma linha da grade: um ou mais campos lado a lado, cada um numa
        caixa com borda própria (rótulo pequeno em cima, valor embaixo) —
        igual ao formulário em papel. `campos`: cada um (rótulo, valor, peso
        de largura relativo dentro da linha)."""
        x0 = 15
        largura_total = self.w - 30
        soma_pesos = sum(peso for _, _, peso in campos)
        larguras = [largura_total * (peso / soma_pesos) for _, _, peso in campos]
        linhas = [self._estima_linhas(valor or "-", w - 4.4) for (_, valor, _), w in zip(campos, larguras)]
        altura = 5.6 + max(linhas) * 4.2 + 1.6
        self._garante_espaco(altura)
        y = self.get_y()
        x = x0
        for (label, valor, _), w in zip(campos, larguras):
            self.set_draw_color(180, 183, 192)
            self.set_line_width(0.25)
            self.rect(x, y, w, altura)
            self.set_xy(x + 2.2, y + 1.3)
            self.set_font("Helvetica", "B", 7.3)
            self.set_text_color(*CINZA)
            self.cell(w - 4.4, 3.4, label.upper())
            self.set_xy(x + 2.2, y + 5.1)
            self.set_font("Helvetica", "", 9.3)
            self.set_text_color(20, 20, 25)
            self.multi_cell(w - 4.4, 4.2, valor or "-")
            x += w
        self.set_xy(x0, y + altura)

    def campo_titulo(self, texto: str):
        """Cabeçalho de bloco dentro da grade (ex.: 'Dados complementares
        para contrato', 'Forma de pagamento') — negrito, sem caixa, igual ao
        formulário em papel."""
        self._garante_espaco(7.5)
        self.ln(1.5)
        self.set_font("Helvetica", "B", 9.7)
        self.set_text_color(*AZUL)
        self.cell(0, 6, texto.upper(), new_x="LMARGIN", new_y="NEXT")


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


def _checkbox_linha(opcoes: list[str], selecionado: Optional[str]) -> str:
    """'( X ) Casado(a)   (   ) Solteiro(a) ...' — mesma marcação por
    parênteses do formulário em papel (lá, preenchida à mão)."""
    return "     ".join(f"({'X' if o == selecionado else ' '}) {o}" for o in opcoes)


MESES_PT = [
    "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]


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

    # Grade de campos com borda própria (rótulo em cima, valor embaixo) —
    # mesma estrutura e ordem do formulário em papel (Proposta de
    # Compra/Venda Castel, operada com a JR Imóveis), campo a campo.
    pdf.campo_grade(
        ("Empreendimento", condominio_nome, 2),
        ("Quadra(s)", lote.get("quadra") or "-", 1),
        ("Lote(s)", lote.get("identificador", "-"), 1),
        ("Área (m²)", _fmt_area(lote.get("tamanho_m2")), 1),
    )

    pdf.campo_grade(("Proponente", proponente.get("nome") or cliente.get("nome") or "-", 1))
    if dq:
        pdf.campo_grade(
            ("RG", proponente.get("rg") or "-", 1),
            ("Órgão expedidor", proponente.get("orgao_expedidor") or "-", 1),
            ("CPF/CNPJ", proponente.get("cpf_cnpj") or cliente.get("cpf") or "-", 1),
            ("Data de nascimento", _fmt_data_livre(proponente.get("data_nascimento")), 1),
        )
        pdf.campo_grade(("Nacionalidade", proponente.get("nacionalidade") or "-", 1))
        pdf.campo_grade(
            ("E-mail", proponente.get("email") or cliente.get("email") or "-", 2),
            ("Profissão", proponente.get("profissao") or "-", 1),
        )
        opcoes_estado_civil = [ESTADO_CIVIL_LABEL[v] for v in ("solteiro", "casado", "viuvo", "divorciado", "outros")]
        pdf.campo_grade(("Estado civil", _checkbox_linha(opcoes_estado_civil, ESTADO_CIVIL_LABEL.get(estado_civil)), 1))
    else:
        pdf.campo_grade(
            ("CPF/CNPJ", cliente.get("cpf") or "-", 1),
            ("Contato", cliente.get("telefone") or cliente.get("email") or "-", 1),
        )

    if estado_civil == "casado":
        pdf.campo_grade(("Cônjuge", conjuge.get("nome") or "-", 1))
        pdf.campo_grade(
            ("RG", conjuge.get("rg") or "-", 1),
            ("Órgão expedidor", conjuge.get("orgao_expedidor") or "-", 1),
            ("CPF/CNPJ", conjuge.get("cpf_cnpj") or "-", 1),
            ("Data de nascimento", _fmt_data_livre(conjuge.get("data_nascimento")), 1),
        )
        pdf.campo_grade(("Nacionalidade", conjuge.get("nacionalidade") or "-", 1))
        pdf.campo_grade(
            ("E-mail", conjuge.get("email") or "-", 2),
            ("Profissão", conjuge.get("profissao") or "-", 1),
        )

    if end_res.get("rua") or end_res.get("bairro"):
        pdf.campo_grade(("Endereço residencial (Rua/Avenida)", _endereco_linha1(end_res), 1))
        pdf.campo_grade(
            ("Número", end_res.get("numero") or "-", 1),
            ("Complemento", end_res.get("complemento") or "-", 2),
        )
        pdf.campo_grade(
            ("Bairro", end_res.get("bairro") or "-", 1),
            ("Cidade", end_res.get("cidade") or "-", 1),
            ("Estado", end_res.get("estado") or "-", 1),
            ("CEP", end_res.get("cep") or "-", 1),
        )

    if dq.get("endereco_comercial_nao_possui"):
        pdf.campo_grade(("Endereço comercial", "Não possui", 1))
    elif end_com.get("rua") or end_com.get("bairro"):
        pdf.campo_grade(("Endereço comercial (Rua/Avenida)", _endereco_linha1(end_com), 1))
        pdf.campo_grade(
            ("Número", end_com.get("numero") or "-", 1),
            ("Complemento", end_com.get("complemento") or "-", 2),
        )
        pdf.campo_grade(
            ("Bairro", end_com.get("bairro") or "-", 1),
            ("Cidade", end_com.get("cidade") or "-", 1),
            ("Estado", end_com.get("estado") or "-", 1),
            ("CEP", end_com.get("cep") or "-", 1),
        )

    if dq.get("telefone_residencial") or dq.get("telefone_comercial") or dq.get("telefone_celular") or dq.get("telefone_recados"):
        pdf.campo_titulo("Dados complementares para contrato")
        pdf.campo_grade(
            ("Telefone residencial", dq.get("telefone_residencial") or "-", 1),
            ("Telefone comercial", dq.get("telefone_comercial") or "-", 1),
            ("Telefone celular", dq.get("telefone_celular") or cliente.get("telefone") or "-", 1),
        )
        pdf.campo_grade(
            ("Telefone para recados", dq.get("telefone_recados") or "-", 1),
            ("Falar com", dq.get("falar_com") or "-", 1),
        )

    pdf.campo_titulo("Corretor responsável")
    if corretor:
        pdf.campo_grade(
            ("Nome", corretor.get("nome") or "-", 1),
            ("Contato", " · ".join(filter(None, [corretor.get("telefone"), corretor.get("email")])) or "-", 1),
        )
    else:
        pdf.campo_grade(("Corretor", "Lead ainda sem corretor responsável definido.", 1))

    pdf.campo_titulo("Forma de pagamento")
    a_vista = fp.get("a_vista")
    if dq:
        pdf.campo_grade(
            ("À vista", _checkbox_linha(["Sim", "Não"], "Sim" if a_vista else ("Não" if a_vista is False else None)), 1),
            ("Renda informada", fp.get("renda") or "-", 1),
        )
    pdf.campo_grade(
        ("Valor de tabela do lote", _fmt_money(lote.get("valor_total")), 1),
        ("Valor proposto", _fmt_money(proposta.get("valor_proposto") or fp.get("valor_proposto")), 1),
    )
    if a_vista is False:
        if fp.get("sinal") or fp.get("sinal_banco"):
            pdf.campo_grade(
                ("Sinal", fp.get("sinal") or "-", 1),
                ("Banco/Agência do sinal", " / ".join(p for p in [fp.get("sinal_banco"), fp.get("sinal_agencia")] if p) or "-", 1),
            )
        pdf.campo_grade(
            ("Dividido em parcelas de", f"{fp['dividido_em_parcelas']}x de {fp.get('valor_parcela') or '-'}" if fp.get("dividido_em_parcelas") else "-", 1),
            ("Vencimento", fp.get("vencimento") or "-", 1),
            ("1ª parcela em", fp.get("primeiro_mes") or "-", 1),
        )
        if fp.get("intercaladas_valor") or fp.get("intercaladas_vencimento_dia"):
            pdf.campo_grade(
                ("Parcelas intercaladas no valor de", fp.get("intercaladas_valor") or "-", 1),
                ("Dia de vencimento", fp.get("intercaladas_vencimento_dia") or "-", 1),
            )
    pdf.campo_grade(("Condições de pagamento (resumo)", proposta.get("condicoes_pagamento") or "A combinar", 1))

    observacoes = " ".join(filter(None, [fp.get("observacoes"), proposta.get("observacoes")]))
    if observacoes:
        pdf.campo_grade(("Obs", observacoes, 1))

    pdf.ln(4)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*CINZA)
    pdf.multi_cell(0, 4.1, DISCLAIMER_PROPOSTA)

    agora = datetime.now()
    pdf._garante_espaco(8)
    pdf.ln(3)
    pdf.set_font("Helvetica", "", 9.5)
    pdf.set_text_color(30, 30, 35)
    pdf.cell(0, 6, f"Mossoró (RN), {agora.day} de {MESES_PT[agora.month]} de {agora.year}.", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(9)
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
