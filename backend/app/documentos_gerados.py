"""Geração do recibo e do contrato completo preenchendo os modelos .docx
enviados pela imobiliária — nunca reescrevendo o texto jurídico à mão, pra
não arriscar errar uma cláusula ou uma condição legal. Só troca os valores
de exemplo do modelo (nome, CPF, valor, lote, data...) pelos dados reais da
proposta. Pedido em 28/09.
"""

import io
from datetime import date
from pathlib import Path
from typing import Optional

import docx

# Reaproveita o mapa de rótulos e o parser de data "livre" (aceita
# 'AAAA-MM-DD' do input do navegador ou texto solto) já usados no PDF da
# proposta completa (gerar_proposta_pdf) -- mesma fonte de dados
# (dados_qualificacao), sem duplicar a lógica.
from .pdf import ESTADO_CIVIL_LABEL, _fmt_data_livre

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


def _para_float(texto: Optional[str]) -> Optional[float]:
    """Mesma tolerância de formato do validador de FormaPagamentoDados
    (schemas.py::_parse_valor_monetario) -- "5000", "5000.00", "5000,00" ou
    "R$ 5.000,00" -- só que devolvendo o float de verdade (o validador
    devolve o texto original, só validado; aqui precisamos calcular e
    formatar o valor pro contrato)."""
    if not texto:
        return None
    limpo = str(texto).strip().replace("R$", "").replace(" ", "")
    if "," in limpo and "." in limpo:
        limpo = limpo.replace(".", "").replace(",", ".")
    elif "," in limpo:
        limpo = limpo.replace(",", ".")
    try:
        return float(limpo)
    except ValueError:
        return None


def _identidade(proponente: dict) -> str:
    rg, orgao = proponente.get("rg"), proponente.get("orgao_expedidor")
    if rg and orgao:
        return f"{rg} {orgao}"
    return rg or "-"


def _endereco_completo(endereco: dict) -> str:
    """'Rua X, nº 123 - complemento' -- o `_endereco_linha1` do pdf.py não
    inclui o número (o modelo em papel tem outro campo pra isso; aqui, no
    contrato, é tudo uma linha só: "ENDEREÇO RESIDENCIAL")."""
    rua = endereco.get("rua")
    numero = endereco.get("numero")
    complemento = endereco.get("complemento")
    partes = [rua]
    if numero:
        partes.append(f"nº {numero}")
    linha = ", ".join(p for p in partes if p)
    if complemento:
        linha = f"{linha} - {complemento}" if linha else complemento
    return linha or "-"


def _substituir_texto(paragrafo, velho: str, novo: str) -> None:
    """Troca um trecho de texto dentro de um parágrafo, mesmo que o Word
    tenha fragmentado esse trecho em vários <w:r> -- muito comum em
    documento com correção ortográfica ligada, onde cada letra acentuada às
    vezes vira um run só dela (ver contrato do Porto Franco: "COMISSÃO" virou
    'COMISS' + 'Ã' + 'O...'). O jeito usado no recibo (mexer em runs[i].text
    direto, por índice) só funciona pra parágrafo curto e sem essa
    fragmentação -- não dava pra confiar nisso pra um contrato de 5-6
    páginas. Acha `velho` inteiro no texto concatenado do parágrafo, escreve
    `novo` no primeiro run que sobrepõe o trecho e esvazia o resto dos runs
    sobrepostos, preservando o texto de fora do trecho em cada ponta.
    Lança ValueError se não achar -- silêncio aqui seria pior: um campo do
    contrato ficando sem preencher sem ninguém notar."""
    runs = paragrafo.runs
    texto_completo = "".join(r.text for r in runs)
    inicio = texto_completo.find(velho)
    if inicio == -1:
        raise ValueError(f"Texto não encontrado no modelo do contrato: {velho!r}")
    fim = inicio + len(velho)

    pos = 0
    novo_aplicado = False
    for r in runs:
        r_inicio, r_fim = pos, pos + len(r.text)
        if r_fim <= inicio or r_inicio >= fim:
            pos = r_fim
            continue
        antes = r.text[: max(0, inicio - r_inicio)]
        depois = r.text[max(0, fim - r_inicio):] if r_fim > fim else ""
        r.text = (antes + novo + depois) if not novo_aplicado else (antes + depois)
        novo_aplicado = True
        pos = r_fim


def preencher_contrato_porto_franco(
    *,
    proposta: dict,
    lote: dict,
    cliente: dict,
    corretor: Optional[dict],
    valor_comissao: float,
    data_contrato: Optional[date] = None,
) -> bytes:
    """Preenche o modelo real do contrato do Porto Franco (alienação
    fiduciária) com os dados da proposta, do lote e da qualificação do
    comprador -- mantendo a redação jurídica exata do modelo, só trocando os
    campos em branco do QUADRO RESUMO e a cláusula de comissão. Os dados de
    qualificação (nome completo, RG, nacionalidade, profissão, estado civil,
    endereço) vêm de `proposta['dados_qualificacao']` -- o mesmo formulário
    já usado no PDF da "Proposta de Compra/Venda" (ver pdf.py). Campo sem
    dado disponível em lugar nenhum do sistema (ex.: "LOCAL" de nascimento,
    que não existe na qualificação) fica em branco de propósito, pronto pra
    alguém completar à mão antes da assinatura. Pedido em 28/09."""
    data_contrato = data_contrato or date.today()
    dq = proposta.get("dados_qualificacao") or {}
    proponente = dq.get("proponente") or {}
    endereco = dq.get("endereco_residencial") or {}
    fp = dq.get("forma_pagamento") or {}
    estado_civil = dq.get("estado_civil")

    doc = docx.Document(str(_TEMPLATES_DIR / "contrato_porto_franco.docx"))
    t = doc.tables[0]

    # --- III. COMPRADOR (QUADRO RESUMO) ----------------------------------
    p = t.rows[4].cells[0].paragraphs
    nome = proponente.get("nome") or cliente.get("nome") or "-"
    cpf = proponente.get("cpf_cnpj") or cliente.get("cpf") or "-"
    _substituir_texto(p[2], "NOME: ", f"NOME: {nome}")
    _substituir_texto(p[3], "NACIONALIDADE: ", f"NACIONALIDADE: {proponente.get('nacionalidade') or '-'}")
    _substituir_texto(p[4], "PROFISSÃO: ", f"PROFISSÃO: {proponente.get('profissao') or '-'}")
    _substituir_texto(
        p[5], "DATA DE NASCIMENTO: ", f"DATA DE NASCIMENTO: {_fmt_data_livre(proponente.get('data_nascimento'))}"
    )
    # "LOCAL" = naturalidade (cidade de nascimento) -- não existe em nenhum
    # lugar do sistema hoje (QualificacaoDados não coleta isso); fica em
    # branco de propósito.
    _substituir_texto(p[7], "CPF: ", f"CPF: {cpf}")
    _substituir_texto(p[8], "IDENTIDADE: ", f"IDENTIDADE: {_identidade(proponente)}")
    _substituir_texto(p[9], "ESTADO CIVIL: ", f"ESTADO CIVIL: {ESTADO_CIVIL_LABEL.get(estado_civil, '-')}")
    _substituir_texto(
        p[10], "ENDEREÇO RESIDENCIAL: ", f"ENDEREÇO RESIDENCIAL: {_endereco_completo(endereco)}"
    )
    _substituir_texto(p[11], "BAIRRO: ", f"BAIRRO: {endereco.get('bairro') or '-'}")
    _substituir_texto(p[12], " MUNICÍPIO: ", f" MUNICÍPIO: {endereco.get('cidade') or '-'}")
    _substituir_texto(p[13], " UF: ", f" UF: {endereco.get('estado') or '-'}")
    _substituir_texto(p[14], "CEP: ", f"CEP: {endereco.get('cep') or '-'}")

    # --- V. OBJETIVO (lote, quadra, área) --------------------------------
    p_objetivo = t.rows[7].cells[0].paragraphs[1]
    area_fmt = formatar_valor(lote.get("tamanho_m2") or 0)
    _substituir_texto(
        p_objetivo,
        "LOTE N°  QUADRA N° , com área total de 200,00 m²",
        f"LOTE N° {lote.get('lote_numero', '-')} QUADRA N° {lote.get('quadra', '-')}, "
        f"com área total de {area_fmt} m²",
    )

    # --- VI. PREÇO --------------------------------------------------------
    valor_total = proposta.get("valor_proposto") or lote.get("valor_total") or 0.0
    p_preco = t.rows[9].cells[0].paragraphs[1]
    _substituir_texto(
        p_preco,
        "R$ 69.990,00 (Sessenta e nove mil novecentos e noventa reais)",
        f"R$ {formatar_valor(valor_total)} ({valor_por_extenso(valor_total)})",
    )

    # --- VII. FORMA DE PAGAMENTO -------------------------------------------
    pp = t.rows[11].cells[0].paragraphs

    # Prioriza a forma de pagamento negociada nesta proposta específica
    # (dados_qualificacao.forma_pagamento); só cai pro plano padrão do lote
    # se a qualificação não tiver esse detalhamento.
    entrada = _para_float(fp.get("sinal")) or lote.get("entrada")
    if entrada:
        _substituir_texto(
            pp[3],
            "Entrada / Arras confirmatórias: ",
            f"Entrada / Arras confirmatórias: R$ {formatar_valor(entrada)} ({valor_por_extenso(entrada)})",
        )

    qtd_parcelas = fp.get("dividido_em_parcelas") or lote.get("qtd_parcelas")
    valor_parcela = _para_float(fp.get("valor_parcela")) or lote.get("parcela_mensal")
    if qtd_parcelas and valor_parcela:
        texto_parcelas = (
            f"{qtd_parcelas} ({_numero_extenso(qtd_parcelas)}) parcelas mensais e sucessivas de "
            f"R$ {formatar_valor(valor_parcela)} ({valor_por_extenso(valor_parcela)}) cada"
        )
        vencimento, primeiro_mes = fp.get("vencimento"), fp.get("primeiro_mes")
        if vencimento or primeiro_mes:
            # "vencimento" é só o dia (campo "Dia de vencimento" do
            # formulário) e "primeiro_mes" é texto livre pro mês/ano (campo
            # "1ª parcela em") -- concatenar com "/" (ex.: "5/outubro/2026")
            # lia estranho; mesma frase clara já usada no Rancho Texas
            # (revisão de 28/09).
            texto_parcelas += (
                f", vencendo a primeira em {primeiro_mes or '-'}, dia {vencimento or '-'}, "
                "e as demais no mesmo dia dos meses subsequentes"
            )
        _substituir_texto(pp[5], "Parcelas mensais", f"Parcelas mensais: {texto_parcelas}.")

    entrega = lote.get("entrega")
    if entrega:
        _substituir_texto(
            pp[7],
            "Chave: ",
            f"Chave: R$ {formatar_valor(entrega)} ({valor_por_extenso(entrega)}), a ser paga na entrega das chaves.",
        )

    # DA COMISSÃO DE CORRETAGEM -- corretor responsável pela venda,
    # qualificado com os dados do próprio cadastro dele (ver
    # PainelCorretores.tsx: CRECI, CPF/CNPJ e dados bancários, adicionados
    # justamente pra preencher essa cláusula sozinhos).
    corretor = corretor or {}
    qualificacao_corretor = corretor.get("nome") or "-"
    if corretor.get("cpf_cnpj"):
        qualificacao_corretor += f", CPF/CNPJ {corretor['cpf_cnpj']}"
    if corretor.get("creci"):
        qualificacao_corretor += f", CRECI {corretor['creci']}"
    if corretor.get("banco") and corretor.get("agencia") and corretor.get("conta"):
        qualificacao_corretor += (
            f", dados bancários: {corretor['banco']}, Ag. {corretor['agencia']}, C/C {corretor['conta']}"
        )
    _substituir_texto(
        pp[17],
        "fixada em R$  (), a ser paga diretamente ao CORRETOR/IMOBILIÁRIA "
        "[QUALIFICAR: nome/razão social, CPF/CNPJ, CRECI e dados bancários], "
        "mediante transferência bancária ou PIX para conta por este indicada",
        f"fixada em R$ {formatar_valor(valor_comissao)} ({valor_por_extenso(valor_comissao)}), "
        f"a ser paga diretamente ao CORRETOR/IMOBILIÁRIA {qualificacao_corretor}, "
        "mediante transferência bancária ou PIX para conta por este indicada",
    )

    # --- XII. LOCAL E DATA DE CELEBRAÇÃO -----------------------------------
    p_data = t.rows[19].cells[0].paragraphs[1]
    _substituir_texto(
        p_data,
        "neste dia 11 de Abril de 2026.",
        f"neste dia {data_contrato.day} de {_MESES[data_contrato.month - 1].capitalize()} de {data_contrato.year}.",
    )

    # --- Título (número do contrato) ---------------------------------------
    _substituir_texto(
        doc.paragraphs[0],
        "CONTRATO Nº  0/2026",
        f"CONTRATO Nº {proposta.get('numero', 0):04d}/{data_contrato.year}",
    )

    # --- Assinatura: CPF do comprador ---------------------------------------
    # Único "CPF: " isolado fora da tabela do QUADRO RESUMO -- confirmado
    # direto no índice de parágrafos do modelo (ver conversa de 28/09); se o
    # modelo for reeditado no Word essa posição pode mudar.
    _substituir_texto(doc.paragraphs[314], "CPF: ", f"CPF: {cpf}")

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def preencher_contrato_rancho_texas(
    *,
    proposta: dict,
    lote: dict,
    cliente: dict,
    data_contrato: Optional[date] = None,
) -> bytes:
    """Preenche o modelo real do contrato do Rancho Texas (alienação
    fiduciária) com os dados da proposta, do lote e da qualificação do(s)
    comprador(es) -- mesma lógica do Porto Franco (preencher_contrato_
    porto_franco), com três diferenças de fato:

    1. Não tem cláusula de comissão de corretagem qualificando o corretor
       (o Rancho Texas trata isso só como desconto na devolução em caso de
       desistência, sem "R$ X, pago ao CORRETOR Y" pra preencher) -- por
       isso não pede corretor nem comissão.
    2. Tem estrutura de DOIS compradores (A - COMPRADOR / B - COMPRADORA,
       pensada pra casal) -- só preenche o bloco da COMPRADORA se
       estado_civil vier "casado" e a qualificação tiver dados do cônjuge;
       senão limpa os placeholders de exemplo do modelo ("XXXX") sem
       inventar nome/CPF.
    3. O item V (OBJETIVO) tem confrontação do lote (frente/fundo/laterais,
       área privativa/comum/real) que não existe em lugar nenhum do sistema
       -- fica com os valores de exemplo do modelo, pra alguém completar à
       mão. Só o número do lote e a área total (que o sistema tem) são
       preenchidos.

    Datas específicas de vencimento da entrada/chave que o modelo trouxe
    como exemplo (ex.: "para o dia 08/09/2026") são removidas em vez de
    mantidas erradas -- não existe, hoje, um campo de "data de vencimento
    da entrada" separado do vencimento das parcelas. Pedido em 28/09."""
    data_contrato = data_contrato or date.today()
    dq = proposta.get("dados_qualificacao") or {}
    proponente = dq.get("proponente") or {}
    conjuge = dq.get("conjuge") or {}
    endereco = dq.get("endereco_residencial") or {}
    fp = dq.get("forma_pagamento") or {}
    estado_civil = dq.get("estado_civil")
    tem_compradora = estado_civil == "casado" and bool(conjuge.get("nome"))

    doc = docx.Document(str(_TEMPLATES_DIR / "contrato_rancho_texas.docx"))
    t = doc.tables[0]

    # --- III. COMPRADOR / COMPRADORA (QUADRO RESUMO) ----------------------
    p = t.rows[4].cells[0].paragraphs
    nome = proponente.get("nome") or cliente.get("nome") or "-"
    cpf = proponente.get("cpf_cnpj") or cliente.get("cpf") or "-"
    _substituir_texto(p[2], "NOME: ", f"NOME: {nome}")
    _substituir_texto(
        p[3], p[3].text, f"NACIONALIDADE: {proponente.get('nacionalidade') or '-'}   PROFISSÃO: {proponente.get('profissao') or '-'}"
    )
    _substituir_texto(
        p[4],
        p[4].text,
        f"DATA DE NASCIMENTO: {_fmt_data_livre(proponente.get('data_nascimento'))}   LOCAL: -",
    )
    _substituir_texto(p[5], p[5].text, f"CPF: {cpf}   IDENTIDADE: {_identidade(proponente)}")
    _substituir_texto(p[6], "ESTADO CIVIL: ", f"ESTADO CIVIL: {ESTADO_CIVIL_LABEL.get(estado_civil, '-')}")

    if tem_compradora:
        nome_c = conjuge.get("nome") or "-"
        cpf_c = conjuge.get("cpf_cnpj") or "-"
        _substituir_texto(p[8], "NOME: ", f"NOME: {nome_c}")
        _substituir_texto(
            p[9],
            p[9].text,
            f"NACIONALIDADE: {conjuge.get('nacionalidade') or '-'}   PROFISSÃO: {conjuge.get('profissao') or '-'}",
        )
        _substituir_texto(
            p[10], p[10].text, f"DATA DE NASCIMENTO: {_fmt_data_livre(conjuge.get('data_nascimento'))} LOCAL: -"
        )
        _substituir_texto(p[11], p[11].text, f"CPF: {cpf_c} IDENTIDADE: {_identidade(conjuge)}")
        _substituir_texto(p[12], "ESTADO CIVIL: ", f"ESTADO CIVIL: {ESTADO_CIVIL_LABEL.get(estado_civil, '-')}")
    # Sem cônjuge na qualificação: o bloco "B – COMPRADORA" fica como o
    # modelo já traz (rótulos em branco, sem exemplo nenhum pra tirar) --
    # nada a fazer aqui.

    _substituir_texto(p[13], "ENDEREÇO RESIDENCIAL: ", f"ENDEREÇO RESIDENCIAL: {_endereco_completo(endereco)}")
    _substituir_texto(
        p[14],
        p[14].text,
        f"BAIRRO: {endereco.get('bairro') or '-'}   MUNICÍPIO: {endereco.get('cidade') or '-'}   "
        f"UF: {endereco.get('estado') or '-'}   CEP: {endereco.get('cep') or '-'}",
    )

    # --- V. OBJETIVO (só número do lote e área total -- confrontação do
    # lote não existe em lugar nenhum do sistema, fica de exemplo) --------
    p_objetivo = t.rows[7].cells[0].paragraphs[1]
    area_fmt = formatar_valor(lote.get("tamanho_m2") or 0)
    _substituir_texto(
        p_objetivo,
        "LOTE Nº XX , com área total de XX m²,",
        f"LOTE Nº {lote.get('lote_numero', '-')}, com área total de {area_fmt} m²,",
    )

    # --- VI. PREÇO ----------------------------------------------------------
    valor_total = proposta.get("valor_proposto") or lote.get("valor_total") or 0.0
    p_preco = t.rows[9].cells[0].paragraphs[1]
    _substituir_texto(
        p_preco,
        "R$: XXX  (XX) (“Preço”)",
        f"R$: {formatar_valor(valor_total)} ({valor_por_extenso(valor_total)}) (“Preço”)",
    )

    # --- VII. FORMA DE PAGAMENTO ---------------------------------------------
    # As três linhas abaixo (Sinal, Parcelas, Chave) e a restauração das
    # arras no §-fixo NÃO são rótulos em branco no modelo -- o Rancho Texas
    # já vem com uma frase de exemplo pronta (valor "R$ XX (XXX)", data
    # "08/09/2026" etc.). Diferente do Porto Franco (rótulo realmente vazio
    # no modelo), aqui a substituição tem que ser SEMPRE feita, mesmo sem
    # dado disponível -- senão o exemplo fictício do modelo vaza pro
    # contrato de verdade sem ninguém notar (bug encontrado em revisão,
    # 28/09: um lote sem "entrada"/"entrega" configurados e uma proposta
    # sem qualificação completa geravam contrato com a data 08/09/2026 e o
    # valor de exemplo ainda dentro do texto).
    pp = t.rows[11].cells[0].paragraphs
    entrada = _para_float(fp.get("sinal")) or lote.get("entrada")
    if entrada:
        entrada_fmt = f"R$ {formatar_valor(entrada)} ({valor_por_extenso(entrada)})"
        _substituir_texto(
            pp[3],
            "Sinal/Arras confirmatórias: R$ XX (XXX) sendo pago em boleto bancário para o dia 08/09/2026.",
            f"Sinal/Arras confirmatórias: {entrada_fmt}.",
        )
        _substituir_texto(
            pp[11],
            "R$ 20.175,40 (Vinte mil cento e setenta e cinco reais e quarenta centavos)",
            entrada_fmt,
        )
    else:
        _substituir_texto(
            pp[3],
            "Sinal/Arras confirmatórias: R$ XX (XXX) sendo pago em boleto bancário para o dia 08/09/2026.",
            "Sinal/Arras confirmatórias: -.",
        )
        _substituir_texto(
            pp[11],
            "R$ 20.175,40 (Vinte mil cento e setenta e cinco reais e quarenta centavos)",
            "-",
        )

    qtd_parcelas = fp.get("dividido_em_parcelas") or lote.get("qtd_parcelas")
    valor_parcela = _para_float(fp.get("valor_parcela")) or lote.get("parcela_mensal")
    if qtd_parcelas and valor_parcela:
        vencimento = fp.get("vencimento") or "-"
        primeiro_mes = fp.get("primeiro_mes") or "-"
        _substituir_texto(
            pp[5],
            "Parcelas: 100 parcelas mensais e sucessivas no valor de R$ XX (X X), vencendo a primeira em "
            "XX/XX/XXXX e as demais todo dia cinco dos meses subsequentes.",
            f"Parcelas: {qtd_parcelas} ({_numero_extenso(qtd_parcelas)}) parcelas mensais e sucessivas no valor "
            f"de R$ {formatar_valor(valor_parcela)} ({valor_por_extenso(valor_parcela)}), vencendo a primeira "
            f"em {primeiro_mes}, dia {vencimento}, e as demais todo dia {vencimento} dos meses subsequentes.",
        )
    else:
        _substituir_texto(
            pp[5],
            "Parcelas: 100 parcelas mensais e sucessivas no valor de R$ XX (X X), vencendo a primeira em "
            "XX/XX/XXXX e as demais todo dia cinco dos meses subsequentes.",
            "Parcelas: -.",
        )

    entrega = lote.get("entrega")
    if entrega:
        _substituir_texto(
            pp[7],
            "Chave: R$ XXX  (XXX) a ser pago até 30/09/2029.",
            f"Chave: R$ {formatar_valor(entrega)} ({valor_por_extenso(entrega)}), a ser paga na entrega das chaves.",
        )
    else:
        _substituir_texto(
            pp[7],
            "Chave: R$ XXX  (XXX) a ser pago até 30/09/2029.",
            "Chave: -.",
        )

    # --- XII. LOCAL E DATA DE CELEBRAÇÃO --------------------------------------
    p_data = t.rows[19].cells[0].paragraphs[1]
    _substituir_texto(
        p_data,
        "neste dia XX de XXX de 2026.",
        f"neste dia {data_contrato.day} de {_MESES[data_contrato.month - 1].capitalize()} de {data_contrato.year}.",
    )

    # --- Título (número do contrato) -------------------------------------------
    _substituir_texto(
        doc.paragraphs[0], "CONTRATO Nº /2026", f"CONTRATO Nº {proposta.get('numero', 0):04d}/{data_contrato.year}"
    )

    # --- Assinaturas: nome e CPF do(s) comprador(es) ----------------------------
    # Índices conferidos direto no modelo (ver conversa de 28/09); se o
    # modelo for reeditado no Word essas posições podem mudar.
    _substituir_texto(doc.paragraphs[341], "XXXXX", nome)
    _substituir_texto(doc.paragraphs[342], "CPF: XXX", f"CPF: {cpf}")
    if tem_compradora:
        _substituir_texto(doc.paragraphs[348], "XXXX", conjuge.get("nome") or "-")
        _substituir_texto(doc.paragraphs[349], "CPF: XXXX", f"CPF: {conjuge.get('cpf_cnpj') or '-'}")
    else:
        # Sem cônjuge: limpa os placeholders de exemplo do modelo em vez de
        # deixar "XXXX" (texto de exemplo, nunca deveria ir pra um contrato
        # de verdade) -- fica como um campo em branco de fato, igual ao
        # resto do bloco "B – COMPRADORA" no QUADRO RESUMO.
        _substituir_texto(doc.paragraphs[348], "XXXX", "")
        _substituir_texto(doc.paragraphs[349], "CPF: XXXX", "CPF: ")

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()
